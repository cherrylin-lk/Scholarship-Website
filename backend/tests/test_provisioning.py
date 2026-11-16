from copy import deepcopy
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from scholarrise import provision
from scholarrise.repository import MemoryRepository

spec = importlib.util.spec_from_file_location('staff_tool', Path(__file__).resolve().parents[1] / 'provision_staff.py')
staff = importlib.util.module_from_spec(spec)
spec.loader.exec_module(staff)


class ProvisioningTests(unittest.TestCase):
    def event(self, **changes):
        return {'triggerSource': 'PostConfirmation_ConfirmSignUp', 'userPoolId': 'pool',
                'request': {'userAttributes': {'sub': 'subject', 'name': 'Fictional Student', 'custom:role': 'admin'},
                            'clientMetadata': {'role': 'university'}}, **changes}

    def test_signup_and_repeat_preserve_every_existing_role_and_profile(self):
        for role in ['student', 'university', 'admin']:
            repo = MemoryRepository()
            original = repo.put('users', {'userId': 'subject', 'role': role, 'active': False, 'name': 'Keep', 'profile': {'bio': 'Keep'}})
            with patch.dict('os.environ', {'COGNITO_USER_POOL_ID': 'pool'}), patch.object(provision, 'DynamoRepository', return_value=repo):
                event = self.event()
                self.assertIs(provision.lambda_handler(event, None), event)
                self.assertEqual(repo.get('users', userId='subject'), original)
        repo = MemoryRepository()
        with patch.dict('os.environ', {'COGNITO_USER_POOL_ID': 'pool'}), patch.object(provision, 'DynamoRepository', return_value=repo):
            provision.lambda_handler(self.event(), None)
            provision.lambda_handler(self.event(), None)
        self.assertEqual(repo.get('users', userId='subject'), {
            'userId': 'subject', 'name': 'Fictional Student', 'role': 'student', 'active': True,
            'profile': {'reminders': True, 'reminderDays': 14}, 'version': 1})

    def test_other_triggers_do_not_write_and_wrong_pool_or_subject_fails_closed(self):
        with patch.object(provision, 'DynamoRepository') as factory, patch.dict('os.environ', {'COGNITO_USER_POOL_ID': 'pool'}):
            provision.lambda_handler(self.event(triggerSource='PostConfirmation_ConfirmForgotPassword'), None)
            for event in [self.event(userPoolId='other'), self.event(request={'userAttributes': {'sub': ''}})]:
                with self.assertRaises(ValueError):
                    provision.lambda_handler(event, None)
            factory.assert_not_called()

    def test_database_failure_is_not_reported_as_success(self):
        repo = Mock()
        repo.put.side_effect = RuntimeError('mock database unavailable')
        with patch.dict('os.environ', {'COGNITO_USER_POOL_ID': 'pool'}), patch.object(provision, 'DynamoRepository', return_value=repo):
            with self.assertRaises(RuntimeError):
                provision.lambda_handler(self.event(), None)

    def account(self):
        return {'UserStatus': 'CONFIRMED', 'Enabled': True, 'UserAttributes': [{'Name': 'sub', 'Value': 'subject'}]}

    def test_operator_requires_expected_role_version_and_preserves_private_data(self):
        table = Mock()
        old = {'userId': 'subject', 'role': 'student', 'active': False, 'version': 3, 'name': 'Keep', 'profile': {'bio': 'Keep'}}
        table.get_item.return_value = {'Item': deepcopy(old)}
        for expected in [(None, None), ('admin', 3), ('student', 2)]:
            with self.assertRaises(ValueError):
                staff.provision_record(table, self.account(), 'university', 'Fictional University', *expected)
        table.put_item.assert_not_called()
        staff.provision_record(table, self.account(), 'university', 'Fictional University', 'student', 3)
        options = table.put_item.call_args.kwargs
        self.assertEqual(options['Item']['profile'], old['profile'])
        self.assertEqual(options['Item']['name'], 'Keep')
        self.assertFalse(options['Item']['active'])
        self.assertEqual(options['Item']['version'], 4)
        self.assertEqual(options['ExpressionAttributeValues'], {':v': 3, ':r': 'student'})

    def test_new_operator_record_is_conditional_and_rejects_unconfirmed_accounts(self):
        table = Mock()
        table.get_item.return_value = {}
        staff.provision_record(table, self.account(), 'admin')
        self.assertEqual(table.put_item.call_args.kwargs['ConditionExpression'], 'attribute_not_exists(#pk)')
        self.assertEqual(table.put_item.call_args.kwargs['Item']['role'], 'admin')
        table.reset_mock()
        with self.assertRaises(ValueError):
            staff.provision_record(table, {**self.account(), 'Enabled': False}, 'admin')
        table.put_item.assert_not_called()

    def test_trigger_permission_and_configuration_do_not_manage_cognito(self):
        import json
        template = json.loads((Path(__file__).resolve().parents[2] / 'infrastructure/template.json').read_text())
        resources = template['Resources']
        self.assertEqual(resources['ProvisionFunction']['Properties']['Environment']['Variables']['COGNITO_USER_POOL_ID'], {'Ref': 'ExistingUserPoolId'})
        self.assertEqual(resources['ProvisionPermission']['Properties']['Principal'], 'cognito-idp.amazonaws.com')
        self.assertFalse(any('Cognito' in row['Type'] or row['Type'].startswith('Custom::') for row in resources.values()))
        actions = resources['ProvisionRole']['Properties']['Policies'][0]['PolicyDocument']['Statement'][-1]['Action']
        self.assertEqual(actions, ['dynamodb:PutItem'])
