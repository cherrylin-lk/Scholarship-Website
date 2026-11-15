import json
from pathlib import Path
import time
import unittest
from unittest.mock import patch

from scholarrise import handler
from scholarrise.app import Application
from scholarrise.repository import MemoryRepository


class LambdaInfrastructureTests(unittest.TestCase):
    def test_real_lambda_entry_point_initializes_once_and_uses_injected_clients(self):
        repo = MemoryRepository()
        record = {'id': 'lambda-award', 'name': 'Lambda fixture', 'published': True, 'approvalStatus': 'approved'}
        repo.put('scholarships', record)
        with patch.object(handler, '_app', None), patch.object(handler, 'DynamoRepository', return_value=repo) as factory, \
             patch.object(handler, 'S3Storage'), patch.dict('os.environ', {'COGNITO_ISSUER': 'test-issuer', 'COGNITO_CLIENT_ID': 'test-client'}):
            response = handler.lambda_handler({'rawPath': '/scholarships/lambda-award', 'requestContext': {'http': {'method': 'GET'}}}, None)
            self.assertEqual(response['statusCode'], 200)
            self.assertEqual(json.loads(response['body'])['id'], 'lambda-award')
            denied = handler.lambda_handler({'rawPath': '/me', 'requestContext': {'http': {'method': 'GET'}}}, None)
            self.assertEqual(denied['statusCode'], 401)
            factory.assert_called_once()

    def test_invalid_subject_and_infinite_expiry_cannot_authenticate(self):
        app = Application(MemoryRepository(), 'issuer', 'client')
        for overrides in [{'sub': ''}, {'sub': ' '}, {'exp': 'Infinity'}, {'exp': 'NaN'}]:
            claims = {'sub': 'student', 'iss': 'issuer', 'client_id': 'client', 'token_use': 'access', 'exp': str(time.time() + 600), **overrides}
            response = app.handle({'rawPath': '/me', 'requestContext': {'http': {'method': 'GET'}, 'authorizer': {'jwt': {'claims': claims}}}})
            self.assertEqual(response['statusCode'], 401)

    def test_template_protects_private_routes_and_limits_runtime_permissions(self):
        path = Path(__file__).resolve().parents[2] / 'infrastructure' / 'template.json'
        resources = json.loads(path.read_text())['Resources']
        api = resources['HttpApi']['Properties']
        self.assertEqual(api['Auth']['DefaultAuthorizer'], 'CognitoJwt')
        events = resources['ApiFunction']['Properties']['Events']
        self.assertNotIn('Auth', events['Private']['Properties'])
        public = {(event['Properties']['Method'], event['Properties']['Path']) for event in events.values()
                  if event['Properties'].get('Auth', {}).get('Authorizer') == 'NONE'}
        self.assertEqual(public, {('GET', '/health'), ('GET', '/scholarships'), ('GET', '/scholarships/{id}')})
        self.assertEqual(resources['UserPoolClient']['Properties']['GenerateSecret'], False)
        self.assertEqual(resources['DocumentBucket']['Properties']['PublicAccessBlockConfiguration']['BlockPublicPolicy'], True)
        statements = resources['ApiRole']['Properties']['Policies'][0]['PolicyDocument']['Statement']
        for statement in statements:
            self.assertNotEqual(statement['Resource'], '*')
            for action in statement['Action']:
                self.assertNotEqual(action, '*')
                self.assertFalse(action.startswith(('iam:', 'cognito-idp:')))
        self.assertFalse(any(row['Type'] == 'AWS::Lambda::Url' for row in resources.values()))
        alarm = resources['ApiHttpErrorAlarm']['Properties']
        self.assertEqual(alarm['Namespace'], 'AWS/ApiGateway')
        self.assertEqual(alarm['MetricName'], '5xx')
        self.assertNotIn('AlarmActions', alarm)
