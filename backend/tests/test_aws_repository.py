"""Exercise real boto3 serialization/operations with Botocore Stubber, never AWS."""
from decimal import Decimal
import json
import unittest

import boto3
from boto3.dynamodb.types import TypeSerializer
from botocore.stub import ANY, Stubber

from scholarrise.app import Application
from scholarrise.errors import Conflict
from scholarrise.repository import DynamoRepository, dynamo_value
from scholarrise.storage import S3Storage
from botocore.response import StreamingBody
from io import BytesIO
import base64
from urllib.parse import parse_qs, urlsplit


def wire(record):
    serializer = TypeSerializer()
    return {key: serializer.serialize(value) for key, value in record.items()}


class AwsRepositoryTests(unittest.TestCase):
    def setUp(self):
        # Explicit dummy credentials bypass credential lookup/instance metadata.
        # Stubber intercepts all service calls and fails any unexpected request.
        self.resource = boto3.resource('dynamodb', region_name='ap-southeast-1',
            aws_access_key_id='offline-test', aws_secret_access_key='offline-not-a-secret')
        self.repo = DynamoRepository(self.resource, {'scholarships': 'TestScholarships', 'users': 'TestUsers'})
        self.stub = Stubber(self.resource.meta.client)
        self.stub.activate()
        self.addCleanup(self.stub.deactivate)

    def test_details_use_consistent_read_and_hide_private_attributes(self):
        record = {'id': 'award', 'name': 'Test Award', 'published': True, 'approvalStatus': 'approved',
                  'minGpa': Decimal('3.25'), 'ownerId': 'private-owner', 'internalAudit': 'private', 'version': Decimal(1)}
        self.stub.add_response('get_item', {'Item': wire(record)},
            {'TableName': 'TestScholarships', 'Key': {'id': 'award'}, 'ConsistentRead': True})
        app = Application(self.repo)
        response = app.handle({'rawPath': '/scholarships/award', 'requestContext': {'http': {'method': 'GET'}}})
        self.assertEqual(response['statusCode'], 200)
        body = json.loads(response['body'])
        self.assertEqual(body['minGpa'], 3.25)
        self.assertNotIn('ownerId', body)
        self.assertNotIn('internalAudit', body)
        self.stub.assert_no_pending_responses()

    def test_create_uses_key_existence_condition_and_nested_decimal_conversion(self):
        record = {'id': 'new', 'minGpa': 3.5, 'levels': [3.25], 'metadata': {'existing': Decimal('2.5')}}
        expected = {**dynamo_value(record), 'version': 1}
        self.stub.add_response('put_item', {}, {'TableName': 'TestScholarships', 'Item': expected,
            'ConditionExpression': 'attribute_not_exists(#pk)', 'ExpressionAttributeNames': {'#pk': 'id'}})
        self.repo.put('scholarships', record)
        self.stub.assert_no_pending_responses()

    def test_update_round_trip_preserves_numbers_read_from_dynamodb(self):
        old = {'id': 'award', 'minGpa': Decimal('3.50'), 'version': Decimal(1), 'nested': {'score': Decimal('7.125')}}
        self.stub.add_response('get_item', {'Item': wire(old)},
            {'TableName': 'TestScholarships', 'Key': {'id': 'award'}, 'ConsistentRead': True})
        self.stub.add_response('put_item', {}, {'TableName': 'TestScholarships', 'Item': {**old, 'version': Decimal(2)},
            'ConditionExpression': '#v = :v', 'ExpressionAttributeNames': {'#v': 'version'}, 'ExpressionAttributeValues': {':v': Decimal(1)}})
        item = self.repo.get('scholarships', id='award')
        saved = self.repo.put('scholarships', item, item['version'])
        self.assertEqual(saved['nested']['score'], Decimal('7.125'))
        self.stub.assert_no_pending_responses()

    def test_conflicting_writes_return_domain_conflict(self):
        self.stub.add_client_error('put_item', service_error_code='ConditionalCheckFailedException', expected_params={
            'TableName': 'TestScholarships', 'Item': {'id': 'award', 'version': 3}, 'ConditionExpression': '#v = :v',
            'ExpressionAttributeNames': {'#v': 'version'}, 'ExpressionAttributeValues': {':v': 2}})
        with self.assertRaises(Conflict):
            self.repo.put('scholarships', {'id': 'award'}, expected=2)
        self.stub.assert_no_pending_responses()

    def test_public_query_paginates_then_rechecks_stale_index_entries(self):
        public = {'id': 'public', 'name': 'Japan Research', 'country': 'Japan', 'university': 'Sample University',
                  'studyLevels': ["Master's", 'PhD'], 'fundingType': 'Fully Funded', 'published': True, 'approvalStatus': 'approved'}
        stale = {**public, 'id': 'stale', 'published': False}
        query = {'TableName': 'TestScholarships', 'IndexName': 'StatusIndex', 'KeyConditionExpression': ANY}
        self.stub.add_response('query', {'Items': [wire(public)], 'LastEvaluatedKey': wire({'id': 'public', 'approvalStatus': 'approved'})}, query)
        self.stub.add_response('query', {'Items': [wire(stale)]},
            {**query, 'ExclusiveStartKey': {'id': 'public', 'approvalStatus': 'approved'}})
        for item in [public, stale]:
            self.stub.add_response('get_item', {'Item': wire(item)},
                {'TableName': 'TestScholarships', 'Key': {'id': item['id']}, 'ConsistentRead': True})
        result = Application(self.repo).discover({'country': 'Japan', 'level': "Master's", 'funding': 'Fully Funded'})
        self.assertEqual(result['total'], 1)
        self.assertEqual(result['items'][0]['id'], 'public')
        self.stub.assert_no_pending_responses()

    def test_missing_detail_returns_404(self):
        self.stub.add_response('get_item', {}, {'TableName': 'TestScholarships', 'Key': {'id': 'missing'}, 'ConsistentRead': True})
        response = Application(self.repo).handle({'rawPath': '/scholarships/missing', 'requestContext': {'http': {'method': 'GET'}}})
        self.assertEqual(response['statusCode'], 404)
        self.stub.assert_no_pending_responses()

    def test_non_finite_numbers_are_rejected_before_an_aws_request(self):
        for value in [float('nan'), float('inf'), Decimal('NaN'), Decimal('Infinity')]:
            with self.assertRaises(ValueError):
                self.repo.put('scholarships', {'id': 'bad', 'minGpa': value})
        self.stub.assert_no_pending_responses()

    def test_s3_upload_policy_and_versioned_download_use_real_sdk_without_network(self):
        s3 = boto3.client('s3', region_name='ap-southeast-1', aws_access_key_id='offline-test', aws_secret_access_key='offline-not-a-secret')
        storage = S3Storage.__new__(S3Storage)
        storage.s3, storage.bucket = s3, 'test-document-bucket'
        key = 'universities/uni/award/file.pdf'
        with Stubber(s3) as stub:
            post = storage.upload(key)
            policy = json.loads(base64.b64decode(post['fields']['policy']))
            self.assertIn(['content-length-range', 1, 5 * 1024 * 1024], policy['conditions'])
            self.assertIn({'key': key}, policy['conditions'])
            stub.add_response('head_object', {'ContentLength': 5, 'ContentType': 'application/pdf', 'VersionId': 'pdf-v1'}, {'Bucket': storage.bucket, 'Key': key})
            stub.add_response('get_object', {'Body': StreamingBody(BytesIO(b'%PDF-'), 5)},
                {'Bucket': storage.bucket, 'Key': key, 'VersionId': 'pdf-v1', 'Range': 'bytes=0-4'})
            self.assertEqual(storage.check(key), 'pdf-v1')
            url = storage.download(key, 'pdf-v1')
            params = parse_qs(urlsplit(url).query)
            self.assertEqual(params['versionId'], ['pdf-v1'])
            self.assertEqual(params['response-content-type'], ['application/octet-stream'])
            stub.assert_no_pending_responses()
