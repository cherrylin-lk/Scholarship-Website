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
        self.assertEqual(public, {('GET', '/health'), ('GET', '/scholarships'), ('GET', '/scholarships/{id}'), ('OPTIONS', '/{proxy+}')})
        self.assertFalse(any(row['Type'].startswith('AWS::Cognito::') for row in resources.values()))
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

    def test_preflight_reuses_api_integration_without_jwt_or_data_access(self):
        resources = json.loads((Path(__file__).resolve().parents[2] / 'infrastructure/template.json').read_text())['Resources']
        api = resources['HttpApi']['Properties']
        events = resources['ApiFunction']['Properties']['Events']
        preflight = events['Preflight']['Properties']
        self.assertEqual(preflight, {'ApiId': {'Ref': 'HttpApi'}, 'Path': '/{proxy+}',
                                    'Method': 'OPTIONS', 'PayloadFormatVersion': '2.0', 'Auth': {'Authorizer': 'NONE'}})
        self.assertEqual(events['Private']['Properties']['Method'], 'ANY')
        self.assertNotIn('Auth', events['Private']['Properties'])
        self.assertEqual(api['Auth']['DefaultAuthorizer'], 'CognitoJwt')
        self.assertEqual(api['Auth']['Authorizers']['CognitoJwt']['AuthorizationScopes'], ['openid'])
        self.assertEqual(api['CorsConfiguration']['AllowOrigins'], [{'Ref': 'FrontendOrigin'}])
        self.assertIn('authorization', api['CorsConfiguration']['AllowHeaders'])
        self.assertTrue(set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']).issubset(api['CorsConfiguration']['AllowMethods']))
        app = Application(MemoryRepository(), 'issuer', 'client')
        with patch('scholarrise.app.identity', side_effect=AssertionError('OPTIONS must not authenticate')), \
             patch.object(app.repo, 'get', side_effect=AssertionError('OPTIONS must not read data')), \
             patch.object(app.repo, 'put', side_effect=AssertionError('OPTIONS must not write data')):
            for path in ['/me', '/me/profile', '/documents/uploads']:
                response = app.handle({'rawPath': path, 'body': 'not JSON',
                                       'requestContext': {'http': {'method': 'OPTIONS'}}})
                self.assertEqual(response['statusCode'], 204)
                self.assertEqual(response['body'], '')
                # No wildcard or reflected origins from Lambda; Gateway supplies CORS.
                self.assertNotIn('Access-Control-Allow-Origin', response['headers'])
        for path in ['/me', '/me/saved', '/admin/users', '/university/scholarships']:
            denied = app.handle({'rawPath': path, 'requestContext': {'http': {'method': 'GET'}}})
            self.assertEqual(denied['statusCode'], 401)

    def test_existing_pool_is_referenced_without_cognito_mutation(self):
        template = json.loads((Path(__file__).resolve().parents[2] / 'infrastructure/template.json').read_text())
        resources, params = template['Resources'], template['Parameters']
        self.assertEqual(params['ExistingUserPoolId']['Default'], 'ap-southeast-2_ONSDhlqBo')
        self.assertEqual(params['ExistingUserPoolClientId']['Default'], '4tdlqbsg2jrr3qvbj5atjh7qig')
        self.assertEqual(params['FrontendOrigin']['Default'], 'https://main.d1s9suck9hx25r.amplifyapp.com')
        self.assertEqual(template['Rules']['SydneyOnly']['Assertions'][0]['Assert'],
                         {'Fn::Equals': [{'Ref': 'AWS::Region'}, 'ap-southeast-2']})
        jwt = resources['HttpApi']['Properties']['Auth']['Authorizers']['CognitoJwt']
        issuer = {'Fn::Sub': 'https://cognito-idp.${AWS::Region}.amazonaws.com/${ExistingUserPoolId}'}
        self.assertEqual(jwt['JwtConfiguration'], {'issuer': issuer, 'audience': [{'Ref': 'ExistingUserPoolClientId'}]})
        self.assertEqual(jwt['AuthorizationScopes'], ['openid'])
        env = resources['ApiFunction']['Properties']['Environment']['Variables']
        self.assertEqual(env['COGNITO_ISSUER'], issuer)
        self.assertEqual(env['COGNITO_CLIENT_ID'], {'Ref': 'ExistingUserPoolClientId'})
        permission = resources['ProvisionPermission']['Properties']
        self.assertEqual(permission['SourceAccount'], {'Ref': 'AWS::AccountId'})
        self.assertEqual(permission['SourceArn'], {'Fn::Sub': 'arn:${AWS::Partition}:cognito-idp:${AWS::Region}:${AWS::AccountId}:userpool/${ExistingUserPoolId}'})
        self.assertFalse(any(r['Type'].startswith('Custom::') or r['Type'] == 'AWS::CloudFormation::CustomResource' for r in resources.values()))
        for name in ['ApiRole', 'ProvisionRole']:
            for policy in resources[name]['Properties']['Policies']:
                for statement in policy['PolicyDocument']['Statement']:
                    self.assertNotEqual(statement['Resource'], '*')
                    self.assertFalse(any(a.startswith(('iam:', 'cognito-idp:')) or a == '*' for a in statement['Action']))
        cors = resources['HttpApi']['Properties']['CorsConfiguration']
        self.assertEqual(cors['AllowOrigins'], [{'Ref': 'FrontendOrigin'}])
        self.assertEqual(resources['DocumentBucket']['Properties']['CorsConfiguration']['CorsRules'][0]['AllowedOrigins'], [{'Ref': 'FrontendOrigin'}])

    def test_five_tables_keep_application_keys_indexes_and_retention(self):
        resources = json.loads((Path(__file__).resolve().parents[2] / 'infrastructure/template.json').read_text())['Resources']
        expected = {'UsersTable': ['userId'], 'ScholarshipsTable': ['id'],
                    'ActivityTable': ['userId', 'recordKey'], 'NotificationsTable': ['userId', 'id'], 'DocumentsTable': ['id']}
        self.assertEqual({n for n, r in resources.items() if r['Type'] == 'AWS::DynamoDB::Table'}, set(expected))
        for name, keys in expected.items():
            resource, props = resources[name], resources[name]['Properties']
            self.assertEqual(props['KeySchema'], [{'AttributeName': key, 'KeyType': 'HASH' if i == 0 else 'RANGE'} for i, key in enumerate(keys)])
            self.assertEqual(resource['DeletionPolicy'], 'Retain')
            self.assertEqual(resource['UpdateReplacePolicy'], 'Retain')
            self.assertEqual(props['BillingMode'], 'PAY_PER_REQUEST')
            self.assertTrue(props['PointInTimeRecoverySpecification']['PointInTimeRecoveryEnabled'])
            self.assertNotIn('TableName', props)
        indexes = resources['ScholarshipsTable']['Properties']['GlobalSecondaryIndexes']
        self.assertEqual({i['IndexName']: [k['AttributeName'] for k in i['KeySchema']] for i in indexes},
                         {'StatusIndex': ['approvalStatus', 'id'], 'OwnerIndex': ['ownerId', 'id']})
