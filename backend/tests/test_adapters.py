from copy import deepcopy
import importlib
import unittest
from unittest.mock import patch

from scholarrise.repository import DynamoRepository, MemoryRepository
from scholarrise.storage import S3Storage, MAX_BYTES
from scholarrise.errors import ApiError


class AdapterTests(unittest.TestCase):
    def test_dynamo_query_follows_all_pages_and_uses_index(self):
        calls = []
        class Table:
            def query(self, **kwargs):
                calls.append(deepcopy(kwargs))
                if len(calls) == 1:
                    return {'Items': [{'id': 'one'}], 'LastEvaluatedKey': {'id': 'one'}}
                return {'Items': [{'id': 'two'}]}
        # Exercise pagination without network access or even boto3 installed.
        repo = DynamoRepository.__new__(DynamoRepository)
        repo.tables = {'scholarships': Table()}
        result = repo._pages('scholarships', 'query', {'IndexName': 'StatusIndex'})
        self.assertEqual([r['id'] for r in result], ['one', 'two'])
        self.assertEqual(calls[1]['ExclusiveStartKey'], {'id': 'one'})

    def test_s3_policy_limits_content_and_download_pins_checked_version(self):
        class Body:
            def read(self):
                return b'%PDF-'
        class Client:
            def generate_presigned_post(self, **args):
                self.post = args
                return {'url': 'https://example.invalid', 'fields': {}}
            def head_object(self, **args):
                return {'ContentLength': 100, 'ContentType': 'application/pdf', 'VersionId': 'checked-version'}
            def get_object(self, **args):
                self.get = args
                return {'Body': Body()}
            def generate_presigned_url(self, operation, **args):
                self.download = args
                return 'https://example.invalid/download'
        storage = S3Storage.__new__(S3Storage)
        storage.bucket, storage.s3 = 'test-private-bucket', Client()
        storage.upload('universities/uni/award/file.pdf')
        self.assertIn(['content-length-range', 1, MAX_BYTES], storage.s3.post['Conditions'])
        self.assertEqual(storage.s3.post['ExpiresIn'], 300)
        verified_version = storage.check('key')
        self.assertEqual(verified_version, 'checked-version')
        self.assertEqual(storage.s3.get['VersionId'], 'checked-version')
        storage.download('key', verified_version)
        self.assertEqual(storage.s3.download['Params']['VersionId'], 'checked-version')
        self.assertEqual(storage.s3.download['Params']['ResponseContentType'], 'application/octet-stream')

    def test_post_confirmation_ignores_requested_admin_role_and_is_idempotent(self):
        from scholarrise import provision
        repo = MemoryRepository()
        event = {'triggerSource': 'PostConfirmation_ConfirmSignUp', 'userPoolId': 'test-pool', 'request': {
            'userAttributes': {'sub': 'new-student', 'name': 'Sample', 'custom:role': 'admin'}, 'clientMetadata': {'role': 'admin'}}}
        with patch.dict('os.environ', {'COGNITO_USER_POOL_ID': 'test-pool'}), patch.object(provision, 'DynamoRepository', return_value=repo):
            provision.lambda_handler(event, None)
            provision.lambda_handler(event, None)
        user = repo.get('users', userId='new-student')
        self.assertEqual(user['role'], 'student')
        self.assertEqual(user['version'], 1)


if __name__ == '__main__':
    unittest.main()
