"""Small DynamoDB adapter with conditional writes and injectable in-memory test double."""
from copy import deepcopy
from decimal import Decimal
import os

from .errors import Conflict

KEYS = {'users': ('userId',), 'scholarships': ('id',),
        'activity': ('userId', 'recordKey'), 'notifications': ('userId', 'id'),
        'documents': ('id',)}


def dynamo_value(value):
    """Preserve Decimal values read from DynamoDB; convert nested JSON floats."""
    if isinstance(value, float):
        value = Decimal(str(value))
    if isinstance(value, Decimal):
        if not value.is_finite():
            raise ValueError('Non-finite DynamoDB number.')
        return value
    if isinstance(value, dict):
        return {key: dynamo_value(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [dynamo_value(item) for item in value]
    return value


class MemoryRepository:
    def __init__(self):
        self.data = {name: {} for name in KEYS}

    def get(self, table, **key):
        return deepcopy(self.data[table].get(tuple(key[k] for k in KEYS[table])))

    def put(self, table, item, expected=None):
        key = {k: item[k] for k in KEYS[table]}
        old = self.get(table, **key)
        if (expected is None and old is not None) or (expected is not None and (not old or old['version'] != expected)):
            raise Conflict()
        record = deepcopy({**item, 'version': (expected or 0) + 1})
        self.data[table][tuple(key.values())] = record
        return record

    def delete(self, table, **key):
        self.data[table].pop(tuple(key[k] for k in KEYS[table]), None)

    def query(self, table, key, value, index=None):
        return [deepcopy(v) for v in self.data[table].values() if v.get(key) == value]

    def all(self, table):
        return deepcopy(list(self.data[table].values()))


class DynamoRepository:
    def __init__(self, resource=None, table_names=None):
        if resource is None:
            import boto3
            resource = boto3.resource('dynamodb')
        names = table_names if table_names is not None else {
            name: os.environ[f'{name.upper()}_TABLE'] for name in KEYS if f'{name.upper()}_TABLE' in os.environ}
        self.tables = {name: resource.Table(table_name) for name, table_name in names.items()}

    def get(self, table, **key):
        return self.tables[table].get_item(Key=key, ConsistentRead=True).get('Item')

    def put(self, table, item, expected=None):
        from botocore.exceptions import ClientError
        record = {**item, 'version': (expected or 0) + 1}
        args = {'Item': dynamo_value(record),
                'ExpressionAttributeNames': {'#v': 'version'}}
        if expected is None:
            args['ConditionExpression'] = 'attribute_not_exists(#pk)'
            args['ExpressionAttributeNames'] = {'#pk': KEYS[table][0]}
        else:
            args.update(ConditionExpression='#v = :v', ExpressionAttributeValues={':v': expected})
        try:
            self.tables[table].put_item(**args)
        except ClientError as error:
            if error.response['Error']['Code'] == 'ConditionalCheckFailedException':
                raise Conflict() from error
            raise
        return record

    def delete(self, table, **key):
        self.tables[table].delete_item(Key=key)

    def query(self, table, key, value, index=None):
        from boto3.dynamodb.conditions import Key
        args = {'KeyConditionExpression': Key(key).eq(value)}
        if index:
            args['IndexName'] = index
        else:
            args['ConsistentRead'] = True
        return self._pages(table, 'query', args)

    def all(self, table):
        # Admin statistics only. Public/owner/private access uses Query, never Scan.
        return self._pages(table, 'scan', {})

    def _pages(self, table, method, args):
        records = []
        while True:
            page = getattr(self.tables[table], method)(**args)
            records.extend(page.get('Items', []))
            if not page.get('LastEvaluatedKey'):
                return records
            args['ExclusiveStartKey'] = page['LastEvaluatedKey']
