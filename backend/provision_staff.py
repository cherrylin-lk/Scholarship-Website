"""Operator-only conditional role assignment; offline dry run by default.
No Cognito users, groups or memberships are created or changed.
Existing records require explicit expected role/version. Profiles stay intact.
"""
import argparse


def provision_record(table, account, role, university=None, expected_role=None, expected_version=None):
    if role not in ['student', 'university', 'admin'] or (role == 'university' and not university):
        raise ValueError('Select a supported role and assigned university.')
    if account.get('UserStatus') != 'CONFIRMED' or account.get('Enabled') is not True:
        raise ValueError('Account must be confirmed and enabled.')
    attrs = {a['Name']: a['Value'] for a in account['UserAttributes']}
    subject = attrs.get('sub')
    if not isinstance(subject, str) or not subject.strip():
        raise ValueError('Missing Cognito subject.')
    old = table.get_item(Key={'userId': subject}, ConsistentRead=True).get('Item')
    if old and (old.get('role') != expected_role or old.get('version') != expected_version):
        raise ValueError('Existing record requires matching --expected-role and --expected-version. Nothing written.')
    if not old and (expected_role is not None or expected_version is not None):
        raise ValueError('Expected existing record was not found. Nothing written.')
    item = {**(old or {'name': attrs.get('name', '')[:80], 'active': True,
                     'profile': {'reminders': True, 'reminderDays': 14}}),
            'userId': subject, 'role': role, 'university': university if role == 'university' else '',
            'version': int(old['version']) + 1 if old else 1}
    options = {'Item': item, 'ExpressionAttributeNames': {'#pk': 'userId'}}
    if old:
        options.update(ConditionExpression='attribute_exists(#pk) AND #v = :v AND #r = :r',
                       ExpressionAttributeNames={'#pk': 'userId', '#v': 'version', '#r': 'role'},
                       ExpressionAttributeValues={':v': old['version'], ':r': old['role']})
    else:
        options['ConditionExpression'] = 'attribute_not_exists(#pk)'
    table.put_item(**options)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--region', default='ap-southeast-2', choices=['ap-southeast-2'])
    parser.add_argument('--pool-id', required=True, choices=['ap-southeast-2_ONSDhlqBo'])
    parser.add_argument('--username', required=True)
    parser.add_argument('--users-table', required=True)
    parser.add_argument('--role', required=True, choices=['student', 'university', 'admin'])
    parser.add_argument('--university')
    parser.add_argument('--expected-role', choices=['student', 'university', 'admin'])
    parser.add_argument('--expected-version', type=int)
    parser.add_argument('--apply', action='store_true', help='Explicit operator authorization; writes only the selected DynamoDB record.')
    args = parser.parse_args()
    if args.role == 'university' and not args.university:
        parser.error('--university is required for university staff')
    if (args.expected_role is None) != (args.expected_version is None) or (args.expected_version is not None and args.expected_version < 1):
        parser.error('Provide both a positive --expected-version and --expected-role, or neither for a new record.')
    if not args.apply:
        print('DRY RUN: no AWS calls or changes. Review the target account, table and intended role before approval.')
        return
    import boto3
    client = boto3.client('cognito-idp', region_name=args.region)
    account = client.admin_get_user(UserPoolId=args.pool_id, Username=args.username)
    table = boto3.resource('dynamodb', region_name=args.region).Table(args.users_table)
    provision_record(table, account, args.role, args.university, args.expected_role, args.expected_version)
    print('Conditional DynamoDB role assignment completed. No Cognito or group changes. Sign in again.')


if __name__ == '__main__':
    main()
