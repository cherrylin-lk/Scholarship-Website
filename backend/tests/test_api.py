import base64
from copy import deepcopy
from datetime import timedelta
import json
from pathlib import Path
import time
import unittest

from scholarrise.app import Application, today
from scholarrise.repository import MemoryRepository


class ApiTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()
        self.app = Application(self.repo, 'issuer', 'client')
        for uid, role in [('student', 'student'), ('other', 'student'), ('uni', 'university'), ('rival', 'university'), ('admin', 'admin')]:
            self.repo.put('users', {'userId': uid, 'role': role, 'active': True, 'name': uid,
                'university': 'Test University', 'profile': {'degree': "Master's", 'gpa': 3.8, 'reminders': True, 'reminderDays': 14}})
        self.record = {'id': 'award', 'name': 'Japan Research Award', 'university': 'Test University', 'country': 'Japan',
            'studyLevels': ["Master's", 'PhD'], 'fundingType': 'Fully Funded', 'amount': 'Tuition', 'coverage': 'Stipend',
            'description': 'Research opportunity', 'field': 'All fields', 'deadline': (today() + timedelta(days=7)).isoformat(),
            'minGpa': 3.5, 'ownerId': 'uni', 'published': True, 'approvalStatus': 'approved', 'documents': '', 'eligibility': '', 'applicationUrl': ''}
        self.repo.put('scholarships', self.record)

    def call(self, method, path, user=None, body=None, query=None, claims=None):
        event = {'rawPath': path, 'body': json.dumps(body or {}), 'queryStringParameters': query or {}, 'requestContext': {'http': {'method': method}}}
        if user:
            event['requestContext']['authorizer'] = {'jwt': {'claims': claims or {'sub': user, 'iss': 'issuer', 'client_id': 'client', 'token_use': 'access', 'exp': str(time.time() + 300)}}}
        result = self.app.handle(event)
        return result['statusCode'], json.loads(result['body'])

    def write_body(self):
        allowed = ['name', 'country', 'studyLevels', 'fundingType', 'amount', 'coverage', 'description', 'field', 'deadline', 'minGpa', 'documents', 'eligibility', 'applicationUrl']
        return {k: self.record[k] for k in allowed}

    def test_public_discovery_filters_and_private_redaction(self):
        for query in [{'country': 'Japan'}, {'level': 'PhD'}, {'university': 'Test University'}, {'funding': 'Fully Funded'},
                      {'country': 'Japan', 'level': "Master's", 'funding': 'Fully Funded', 'query': ' research '}]:
            status, body = self.call('GET', '/scholarships', query=query)
            self.assertEqual(status, 200)
            self.assertEqual(body['total'], 1)
            self.assertNotIn('ownerId', body['items'][0])
        self.assertEqual(self.call('GET', '/scholarships', query={'country': 'Thailand'})[1]['total'], 0)
        self.assertEqual(self.call('GET', '/scholarships', query={'limit': '0'})[0], 400)
        self.assertEqual(self.call('GET', '/scholarships', query={'level': 'invalid'})[0], 400)

    def test_authentication_is_fail_closed(self):
        self.assertEqual(self.call('GET', '/me')[0], 401)
        self.assertEqual(self.call('GET', '/admin/users', 'student')[0], 403)
        for override in [{'token_use': 'id'}, {'client_id': 'wrong'}, {'iss': 'wrong'}, {'exp': '0'}, {'exp': 'bad'}]:
            claims = {'sub': 'student', 'iss': 'issuer', 'client_id': 'client', 'token_use': 'access', 'exp': str(time.time() + 300), **override}
            self.assertEqual(self.call('GET', '/me', 'student', claims=claims)[0], 401)
        # Headers alone never establish a trusted API Gateway identity.
        result = self.app.handle({'rawPath': '/me', 'headers': {'Authorization': 'Bearer local-admin'}, 'requestContext': {'http': {'method': 'GET'}}})
        self.assertEqual(result['statusCode'], 401)

    def test_university_ownership_moderation_and_optimistic_lock(self):
        body = self.write_body()
        self.assertEqual(self.call('POST', '/university/scholarships', 'student', body)[0], 403)
        self.assertEqual(self.call('POST', '/university/scholarships', 'uni', {**body, 'ownerId': 'admin'})[0], 400)
        self.assertEqual(self.call('PUT', '/university/scholarships/award', 'rival', {**body, 'version': 1})[0], 403)
        status, created = self.call('POST', '/university/scholarships', 'uni', body)
        self.assertEqual(status, 201)
        self.assertFalse(created['published'])
        self.assertEqual(self.call('GET', f'/scholarships/{created["id"]}')[0], 404)
        endpoint = f'/admin/scholarships/{created["id"]}/moderation'
        self.assertEqual(self.call('POST', endpoint, 'uni', {'decision': 'approve', 'version': 1})[0], 403)
        self.assertEqual(self.call('POST', endpoint, 'admin', {'decision': 'approve', 'version': 1})[0], 200)
        self.assertEqual(self.call('POST', endpoint, 'admin', {'decision': 'reject', 'version': 1})[0], 409)
        self.assertEqual(self.call('GET', f'/scholarships/{created["id"]}')[0], 200)
        self.assertEqual(self.call('PUT', f'/university/scholarships/{created["id"]}', 'uni', {**body, 'version': 2})[0], 200)
        self.assertEqual(self.call('GET', f'/scholarships/{created["id"]}')[0], 404)

    def test_private_student_data_and_disabled_tokens(self):
        self.assertEqual(self.call('PUT', '/me/saved/award', 'student')[0], 200)
        self.assertEqual(self.call('GET', '/me/saved', 'other')[1]['items'], [])
        self.assertEqual(self.call('PUT', '/me/applications/award', 'student', {'status': 'Planning', 'notes': 'Private'})[0], 200)
        self.assertEqual(self.call('GET', '/me/applications', 'other')[1]['items'], [])
        self.assertEqual(self.call('PUT', '/me/applications/award', 'student', {'status': 'Invalid', 'version': 1})[0], 400)
        self.assertEqual(self.call('PATCH', '/admin/users/student', 'admin', {'active': False, 'version': 1})[0], 200)
        self.assertEqual(self.call('GET', '/me', 'student')[0], 403)
        self.assertEqual(self.call('PATCH', '/admin/users/admin', 'admin', {'active': False, 'version': 1})[0], 403)

    def test_profile_validation_recommendation_and_reminders(self):
        self.assertEqual(len(self.call('GET', '/me/recommendations', 'student')[1]['items']), 1)
        bad = {'name': 'Student', 'degree': "Master's", 'gpa': 'NaN', 'version': 1}
        self.assertEqual(self.call('PUT', '/me/profile', 'student', bad)[0], 400)
        self.assertEqual(self.call('PUT', '/me/profile', 'student', {**bad, 'gpa': 3.9, 'role': 'admin'})[0], 400)
        self.assertEqual(self.call('PUT', '/me/profile', 'student', {**bad, 'gpa': 3.9})[0], 200)
        self.call('PUT', '/me/saved/award', 'student')
        rows = self.call('GET', '/me/notifications', 'student')[1]['items']
        self.assertEqual(len(rows), 1)
        self.assertEqual(self.call('GET', '/me/notifications', 'other')[1]['items'], [])
        notification_id = rows[0]['id']
        self.assertEqual(self.call('POST', f'/me/notifications/{notification_id}/dismiss', 'other')[0], 404)
        self.call('POST', f'/me/notifications/{notification_id}/dismiss', 'student')
        self.assertEqual(self.call('GET', '/me/notifications', 'student')[1]['items'], [])

    def test_input_bounds_and_unconfirmed_deadlines(self):
        for body in [{**self.write_body(), 'studyLevels': []}, {**self.write_body(), 'deadline': 'invalid'},
                     {**self.write_body(), 'applicationUrl': 'javascript:alert(1)'}, {**self.write_body(), 'published': True}]:
            self.assertEqual(self.call('POST', '/university/scholarships', 'uni', body)[0], 400)
        row = self.repo.get('scholarships', id='award')
        self.repo.put('scholarships', {**row, 'deadline': None}, row['version'])
        self.assertEqual(self.call('PUT', '/me/applications/award', 'student', {'status': 'Planning'})[0], 400)
        self.assertEqual(self.call('GET', '/me/recommendations', 'student')[1]['items'], [])
        self.assertEqual(self.app.handle({'body': '[1]', 'requestContext': {}})['statusCode'], 400)
        self.assertEqual(self.app.handle({'body': '{', 'requestContext': {}})['statusCode'], 400)

    def test_documents_require_owner_and_ready_state(self):
        self.assertEqual(self.call('POST', '/documents/uploads', 'student', {'scholarshipId': 'award', 'filename': 'x.pdf'})[0], 403)
        self.assertEqual(self.call('POST', '/documents/uploads', 'rival', {'scholarshipId': 'award', 'filename': 'x.pdf'})[0], 403)
        self.assertEqual(self.call('POST', '/documents/uploads', 'uni', {'scholarshipId': 'award', 'filename': 'x.pdf'})[0], 503)

    def test_document_completion_requires_reapproval_and_preserves_object_version(self):
        class Storage:
            def upload(self, key):
                return {'url': 'https://example.invalid', 'fields': {'key': key}}
            def check(self, key):
                return 'immutable-v1'
            def download(self, key, version):
                assert version == 'immutable-v1'
                return 'https://example.invalid/download'
        self.app.storage = Storage()
        status, doc = self.call('POST', '/documents/uploads', 'uni', {'scholarshipId': 'award', 'filename': '../../x.pdf'})
        self.assertEqual(status, 201)
        document_id = doc['documentId']
        self.assertNotIn('..', doc['upload']['fields']['key'])
        self.assertEqual(self.call('POST', f'/documents/{document_id}/complete', 'rival')[0], 404)
        self.assertEqual(self.call('POST', f'/documents/{document_id}/complete', 'uni')[0], 200)
        self.assertEqual(self.call('POST', f'/documents/{document_id}/complete', 'uni')[0], 409)
        self.assertEqual(self.call('GET', '/scholarships/award')[0], 404)
        self.assertEqual(self.call('GET', f'/documents/{document_id}/download', 'student')[0], 403)
        item = self.repo.get('scholarships', id='award')
        self.call('POST', '/admin/scholarships/award/moderation', 'admin', {'decision': 'approve', 'version': item['version']})
        self.assertEqual(self.call('GET', f'/documents/{document_id}/download', 'student')[0], 200)


if __name__ == '__main__':
    unittest.main()
