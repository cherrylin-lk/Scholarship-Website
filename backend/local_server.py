"""OFFLINE ONLY. Fixed fixture tokens, loopback binding, no AWS SDK or credentials.

Run from repository root: python backend/local_server.py
Never configure this file as a cloud handler or expose it to a LAN/public interface.
"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit, parse_qs
from pathlib import Path
import json
import time

from scholarrise.app import Application
from scholarrise.repository import MemoryRepository

ISSUER, CLIENT = 'http://offline.invalid', 'offline-fixture-client'


def fixture_app():
    repo = MemoryRepository()
    for uid, role in [('local-student', 'student'), ('local-university', 'university'), ('local-admin', 'admin')]:
        repo.put('users', {'userId': uid, 'role': role, 'name': f'Sample {role}', 'active': True,
                          'university': 'Local Example University' if role == 'university' else '',
                          'profile': {'degree': "Master's", 'gpa': 3.8, 'field': 'All fields', 'reminders': True, 'reminderDays': 14}})
    records = json.loads((Path(__file__).parent / 'fixtures' / 'scholarships.json').read_text(encoding='utf-8'))
    for row in records:
        repo.put('scholarships', row)
    return Application(repo, ISSUER, CLIENT)


class Handler(BaseHTTPRequestHandler):
    app = None

    def do_OPTIONS(self):
        self.respond(204, {})

    def do_GET(self):
        self.dispatch()

    do_POST = do_PUT = do_PATCH = do_DELETE = do_GET

    def dispatch(self):
        length = int(self.headers.get('Content-Length', '0'))
        if length > 32768:
            self.respond(413, {'message': 'Request body too large.'})
            return
        url = urlsplit(self.path)
        event = {'rawPath': url.path, 'queryStringParameters': {k: v[0] for k, v in parse_qs(url.query).items()},
                 'requestContext': {'http': {'method': self.command}}, 'body': self.rfile.read(length).decode('utf-8') or '{}'}
        # Fixture identity injection exists ONLY in this offline runner, never in Lambda.
        fixture = self.headers.get('Authorization', '').removeprefix('Bearer ')
        if fixture in ['local-student', 'local-university', 'local-admin']:
            event['requestContext']['authorizer'] = {'jwt': {'claims': {'sub': fixture, 'token_use': 'access',
                'iss': ISSUER, 'client_id': CLIENT, 'exp': str(time.time() + 3600)}}}
        response = self.app.handle(event)
        self.respond(response['statusCode'], json.loads(response['body']))

    def respond(self, status, body):
        self.send_response(status)
        origin = self.headers.get('Origin')
        if origin in ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:5174', 'http://127.0.0.1:5174']:
            self.send_header('Access-Control-Allow-Origin', origin)
            self.send_header('Vary', 'Origin')
        self.send_header('Access-Control-Allow-Headers', 'Authorization, Content-Type')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS')
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if status != 204:
            self.wfile.write(json.dumps(body).encode())

    def log_message(self, *_):
        pass  # Don't log query strings or credentials.


if __name__ == '__main__':
    Handler.app = fixture_app()
    print('OFFLINE ScholarRise API: http://127.0.0.1:8000 (in-memory; resets on restart)', flush=True)
    ThreadingHTTPServer(('127.0.0.1', 8000), Handler).serve_forever()
