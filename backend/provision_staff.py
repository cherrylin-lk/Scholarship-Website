"""Manual preparation tool, NOT an HTTP endpoint. Uses operator AWS identity.

Existing Cognito accounts only. Explicit operator action is required to run this.
Never derive a staff role from self-registration, request bodies or client claims.
"""
import argparse


def main():
    parser = argparse.ArgumentParser(description='Explicitly provision an existing confirmed Cognito account.')
    parser.add_argument('--pool-id', required=True)
    parser.add_argument('--username', required=True)
    parser.add_argument('--users-table', required=True)
    parser.add_argument('--role', required=True, choices=['student', 'university', 'admin'])
    parser.add_argument('--university')
    parser.add_argument('--apply', action='store_true', help='Without this flag, only print the intended action.')
    args = parser.parse_args()
    if args.role == 'university' and not args.university:
        parser.error('--university is required for university staff')
    if not args.apply:
        print(f'DRY RUN: assign {args.role} in the selected user pool and users table. Nothing written.')
        return
    import boto3
    client = boto3.client('cognito-idp')
    account = client.admin_get_user(UserPoolId=args.pool_id, Username=args.username)
    if account.get('UserStatus') != 'CONFIRMED' or not account.get('Enabled'):
        raise ValueError('Account must be confirmed and enabled.')
    attrs = {a['Name']: a['Value'] for a in account['UserAttributes']}
    # All role changes pass through a live database record. Conditional write
    # avoids replacing a profile edited concurrently by the account owner.
    table = boto3.resource('dynamodb').Table(args.users_table)
    old = table.get_item(Key={'userId': attrs['sub']}, ConsistentRead=True).get('Item')
    item = {**(old or {}), 'userId': attrs['sub'], 'name': attrs.get('name', ''), 'role': args.role,
            'university': args.university or '', 'active': True, 'version': int((old or {}).get('version', 0)) + 1}
    options = {'Item': item, 'ExpressionAttributeNames': {'#v': 'version'}}
    if old:
        options.update(ConditionExpression='#v = :old', ExpressionAttributeValues={':old': old['version']})
    else:
        options['ConditionExpression'] = 'attribute_not_exists(#v)'
    table.put_item(**options)
    # Groups mirror the authoritative DB role; they are not the authorization boundary.
    for group in ['student', 'university', 'admin']:
        if group != args.role:
            client.admin_remove_user_from_group(UserPoolId=args.pool_id, Username=args.username, GroupName=group)
    client.admin_add_user_to_group(UserPoolId=args.pool_id, Username=args.username, GroupName=args.role)
    print('Staff provisioning completed. Sign in again to refresh tokens.')


if __name__ == '__main__':
    main()
