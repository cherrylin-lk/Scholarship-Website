"""API Gateway HTTP API v2 routes. Dependencies are injected for offline tests."""
from datetime import datetime, timezone, timedelta, date
from decimal import Decimal
import base64
import json
import logging
import uuid

from . import validation as v
from .auth import identity, own_scholarship, role
from .errors import ApiError, Conflict
from .models import Scholarship, ScholarshipDraft
from .scholarships import ScholarshipRepository

LOG = logging.getLogger(__name__)


def today():
    return datetime.now(timezone(timedelta(hours=7))).date()


def public(item):
    return bool(item and Scholarship(item).is_public)


def public_record(item):
    return Scholarship(item).public_dict()


def version(body):
    value = body.get('version')
    v.require(type(value) is int and value > 0, 'A positive integer version is required.')
    return value


class Application:
    def __init__(self, repo, issuer='', client_id='', storage=None, accounts=None):
        self.repo, self.issuer, self.client_id = repo, issuer, client_id
        self.scholarships = ScholarshipRepository(repo)
        self.storage, self.accounts = storage, accounts

    def handle(self, event, context=None):
        request_id = event.get('requestContext', {}).get('requestId', str(uuid.uuid4()))
        try:
            raw = event.get('body') or '{}'
            if event.get('isBase64Encoded'):
                raw = base64.b64decode(raw, validate=True).decode('utf-8')
            v.require(len(raw.encode('utf-8')) <= 32768, 'Request body too large.', 413)
            body = json.loads(raw)
            v.require(isinstance(body, dict), 'Expected a JSON object.')
            result, status = self.route(event, body)
        except ApiError as error:
            result, status = {'message': str(error), 'requestId': request_id}, error.status
        except (ValueError, UnicodeError, TypeError):
            result, status = {'message': 'Malformed request.', 'requestId': request_id}, 400
        except Exception:
            # Never log tokens, request bodies, names, email addresses or private notes.
            LOG.error('Unhandled backend failure requestId=%s', request_id)
            result, status = {'message': 'Internal server error.', 'requestId': request_id}, 500
        LOG.info('requestId=%s status=%s', request_id, status)
        return {'statusCode': status, 'headers': {'Content-Type': 'application/json',
                'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'},
                'body': json.dumps(result, default=lambda n: float(n) if isinstance(n, Decimal) else str(n))}

    def route(self, event, body):
        method = event.get('requestContext', {}).get('http', {}).get('method', '')
        path = event.get('rawPath', '').rstrip('/') or '/'
        parts = path.strip('/').split('/')
        query = event.get('queryStringParameters') or {}
        repo = self.repo
        if method == 'GET' and path == '/health':
            return {'service': 'ScholarRise API', 'status': 'ok'}, 200
        if method == 'GET' and path == '/scholarships':
            return self.discover(query), 200
        if method == 'GET' and len(parts) == 2 and parts[0] == 'scholarships':
            return self.scholarships.get_public(parts[1]), 200

        user = identity(event, repo, self.issuer, self.client_id)
        uid = user['userId']
        if path == '/me' and method == 'GET':
            return user, 200
        if path == '/me/profile' and method == 'PUT':
            role(user, 'student')
            profile = v.profile(body)
            return repo.put('users', {**user, 'name': profile.pop('name'), 'profile': profile}, version(body)), 200
        if path == '/me/recommendations' and method == 'GET':
            role(user, 'student')
            return {'items': self.recommend(user)}, 200
        if path == '/me/saved' and method == 'GET':
            role(user, 'student')
            return {'items': [r for r in repo.query('activity', 'userId', uid) if r['recordKey'].startswith('SAVED#')]}, 200
        if len(parts) == 3 and parts[:2] == ['me', 'saved'] and method in ['PUT', 'DELETE']:
            role(user, 'student')
            key = {'userId': uid, 'recordKey': f'SAVED#{parts[2]}'}
            if method == 'DELETE':
                repo.delete('activity', **key)
                return {'deleted': True}, 200
            self.visible(parts[2])
            old = repo.get('activity', **key)
            return (old or repo.put('activity', {**key, 'scholarshipId': parts[2]})), 200
        if path == '/me/applications' and method == 'GET':
            role(user, 'student')
            return {'items': [r for r in repo.query('activity', 'userId', uid) if r['recordKey'].startswith('APPLICATION#')]}, 200
        if len(parts) == 3 and parts[:2] == ['me', 'applications'] and method in ['PUT', 'DELETE']:
            role(user, 'student')
            key = {'userId': uid, 'recordKey': f'APPLICATION#{parts[2]}'}
            if method == 'DELETE':
                repo.delete('activity', **key)
                return {'deleted': True}, 200
            v.only(body, ['status', 'notes', 'version'])
            v.require(body.get('status') in v.STATUSES, 'Invalid application status.')
            old = repo.get('activity', **key)
            if not old:
                item = self.visible(parts[2])
                v.require(item.get('deadline') and date.fromisoformat(item['deadline']) >= today(), 'Deadline has passed or is unconfirmed.')
                v.require(body.get('version') is None, 'New applications must omit version.')
            return repo.put('activity', {**key, 'scholarshipId': parts[2], 'status': body['status'],
                            'notes': v.text(body, 'notes', 4000), 'updatedAt': datetime.now(timezone.utc).isoformat()},
                            version(body) if old else None), 200
        if path == '/me/notifications' and method == 'GET':
            role(user, 'student')
            self.generate_reminders(user)
            if not user.get('profile', {}).get('reminders', True):
                return {'items': []}, 200
            rows = repo.query('notifications', 'userId', uid)
            watched = self.watched(user)
            window = user.get('profile', {}).get('reminderDays', 14)
            return {'items': [r for r in rows if not r.get('dismissed') and r.get('deadline', '') >= today().isoformat()
                              and r['scholarshipId'] in watched and (date.fromisoformat(r['deadline']) - today()).days <= window
                              and public(repo.get('scholarships', id=r['scholarshipId']))]}, 200
        if len(parts) == 4 and parts[:2] == ['me', 'notifications'] and parts[3] == 'dismiss' and method == 'POST':
            role(user, 'student')
            item = repo.get('notifications', userId=uid, id=parts[2])
            v.require(item is not None, 'Notification not found.', 404)
            return repo.put('notifications', {**item, 'dismissed': True}, item['version']), 200

        if path == '/university/scholarships' and method == 'GET':
            role(user, 'university')
            return {'items': repo.query('scholarships', 'ownerId', uid, 'OwnerIndex')}, 200
        if path == '/university/scholarships' and method == 'POST':
            role(user, 'university')
            v.require(bool(user.get('university')), 'University account needs an assigned institution.', 403)
            record = ScholarshipDraft.from_body(body).to_record()
            return repo.put('scholarships', {**record, 'id': str(uuid.uuid4()), 'ownerId': uid,
                            'university': user['university'], 'published': False, 'approvalStatus': 'pending', 'initials': user['university'][:2].upper()}), 201
        if len(parts) == 3 and parts[:2] == ['university', 'scholarships'] and method == 'PUT':
            role(user, 'university')
            item = own_scholarship(repo, user, parts[2])
            record = ScholarshipDraft.from_body(body).to_record()
            return repo.put('scholarships', {**item, **record, 'published': False, 'approvalStatus': 'pending'}, version(body)), 200
        if len(parts) == 4 and parts[:2] == ['university', 'scholarships'] and parts[3] == 'unpublish' and method == 'POST':
            role(user, 'university')
            item = own_scholarship(repo, user, parts[2])
            return repo.put('scholarships', {**item, 'published': False}, version(body)), 200
        if path == '/admin/scholarships' and method == 'GET':
            role(user, 'admin')
            return {'items': repo.all('scholarships')}, 200
        if len(parts) == 4 and parts[:2] == ['admin', 'scholarships'] and parts[3] == 'moderation' and method == 'POST':
            role(user, 'admin')
            v.only(body, ['decision', 'note', 'version'])
            decision = body.get('decision')
            v.require(decision in ['approve', 'reject', 'unpublish'], 'Invalid moderation decision.')
            item = own_scholarship(repo, user, parts[2])
            if decision == 'approve':
                for document_id in item.get('documentIds', []):
                    doc = repo.get('documents', id=document_id)
                    v.require(doc and doc.get('status') == 'ready' and doc.get('scholarshipId') == item['id'],
                              'All attached documents must be ready before approval.', 409)
            return repo.put('scholarships', {**item, 'published': decision == 'approve',
                            'approvalStatus': 'approved' if decision != 'reject' else 'rejected',
                            'moderationNote': v.text(body, 'note', 2000)}, version(body)), 200
        if path == '/admin/users' and method == 'GET':
            role(user, 'admin')
            return {'items': [{k: r.get(k) for k in ['userId', 'name', 'role', 'active', 'university', 'version']} for r in repo.all('users')]}, 200
        if len(parts) == 3 and parts[:2] == ['admin', 'users'] and method == 'PATCH':
            role(user, 'admin')
            v.only(body, ['active', 'version'])
            v.require(isinstance(body.get('active'), bool), 'active must be boolean.')
            target = repo.get('users', userId=parts[2])
            v.require(target is not None, 'User not found.', 404)
            v.require(target['role'] != 'admin', 'Administrator activation is managed out of band.', 403)
            # DB enforcement is immediate, including already issued JWTs. Cognito sync
            # is separate provisioning work; this API never grants staff privileges.
            return repo.put('users', {**target, 'active': body['active']}, version(body)), 200
        if path == '/admin/statistics' and method == 'GET':
            role(user, 'admin')
            rows = repo.all('scholarships')
            return {'users': len(repo.all('users')), 'scholarships': len(rows),
                    'published': sum(public(s) for s in rows), 'pending': sum(s.get('approvalStatus') == 'pending' for s in rows)}, 200
        if path == '/documents/uploads' and method == 'POST':
            role(user, 'university')
            v.only(body, ['scholarshipId', 'filename'])
            item = own_scholarship(repo, user, v.text(body, 'scholarshipId', 100, True))
            v.text(body, 'filename', 160, True)
            v.require(self.storage is not None, 'Document storage not configured.', 503)
            document_id = str(uuid.uuid4())
            key = f'universities/{uid}/{item["id"]}/{document_id}.pdf'
            doc = repo.put('documents', {'id': document_id, 'scholarshipId': item['id'], 'ownerId': uid,
                           'key': key, 'status': 'pending'})
            return {'documentId': doc['id'], 'upload': self.storage.upload(key)}, 201
        if len(parts) == 3 and parts[0] == 'documents' and parts[2] == 'complete' and method == 'POST':
            role(user, 'university')
            doc = repo.get('documents', id=parts[1])
            v.require(doc is not None and doc['ownerId'] == uid, 'Document not found.', 404)
            v.require(doc['status'] == 'pending', 'Document has already been completed. Request a new upload to replace it.', 409)
            item = own_scholarship(repo, user, doc['scholarshipId'])
            v.require(self.storage is not None, 'Document storage not configured.', 503)
            storage_version = self.storage.check(doc['key'])
            # Freeze a versioned S3 object; the upload policy cannot replace a
            # previously approved download because downloads specify VersionId.
            repo.put('scholarships', {**item, 'published': False, 'approvalStatus': 'pending',
                     'documentIds': list(dict.fromkeys([*item.get('documentIds', []), doc['id']]))}, item['version'])
            return repo.put('documents', {**doc, 'status': 'ready', 'storageVersion': storage_version}, doc['version']), 200
        if len(parts) == 3 and parts[0] == 'documents' and parts[2] == 'download' and method == 'GET':
            doc = repo.get('documents', id=parts[1])
            v.require(doc and doc['status'] == 'ready', 'Document not found.', 404)
            item = repo.get('scholarships', id=doc['scholarshipId'])
            v.require(public(item) or user['role'] == 'admin' or doc['ownerId'] == uid, 'Document access denied.', 403)
            v.require(self.storage is not None, 'Document storage not configured.', 503)
            return {'url': self.storage.download(doc['key'], doc['storageVersion']), 'expiresIn': 300}, 200
        raise ApiError(404, 'Endpoint not found.')

    def visible(self, scholarship_id):
        item = self.repo.get('scholarships', id=scholarship_id)
        v.require(public(item), 'Scholarship not found.', 404)
        return item

    def public_items(self):
        return self.scholarships.public_items()

    def discover(self, query):
        return self.scholarships.search(query)

    def recommend(self, user):
        p = user.get('profile', {})
        if p.get('gpa') is None or p.get('degree') not in v.LEVELS:
            return []
        matches = []
        for s in self.public_items():
            if not s.get('deadline') or s['deadline'] < today().isoformat() or s.get('minGpa') is None:
                continue
            if p['degree'] not in s.get('studyLevels', []) or float(p['gpa']) < float(s['minGpa']):
                continue
            score, reasons = 50, ['Study level matches', 'Meets listed GPA threshold']
            if s.get('field') in [p.get('field'), 'All fields']:
                score += 30
                reasons.append('Field matches')
            if p.get('country') == s.get('country'):
                score += 10
                reasons.append('Preferred country')
            if not p.get('fullFunding') or s.get('fundingType') == 'Fully Funded':
                score += 10
            matches.append({**public_record(s), 'match': {'score': score, 'reasons': reasons}})
        return sorted(matches, key=lambda s: (-s['match']['score'], s['id']))

    def generate_reminders(self, user):
        p = user.get('profile', {})
        if not p.get('reminders', True):
            return
        for scholarship_id in self.watched(user):
            s = self.repo.get('scholarships', id=scholarship_id)
            if not public(s) or not s.get('deadline'):
                continue
            days = (date.fromisoformat(s['deadline']) - today()).days
            if 0 <= days <= p.get('reminderDays', 14):
                try:
                    self.repo.put('notifications', {'userId': user['userId'], 'id': f'{s["id"]}:{s["deadline"]}',
                                  'scholarshipId': s['id'], 'name': s['name'], 'deadline': s['deadline'], 'dismissed': False})
                except Conflict:
                    pass  # Idempotent: never resurrect a dismissed reminder.

    def watched(self, user):
        return {row['scholarshipId'] for row in self.repo.query('activity', 'userId', user['userId'])
                if row['recordKey'].startswith('SAVED#') or row.get('status') in ['Planning', 'Preparing']}
