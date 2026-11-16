"""Cognito post-confirmation trigger: self-registration can only create students."""
from .repository import DynamoRepository
from .errors import Conflict
import os


def lambda_handler(event, context):
    if event.get('triggerSource') != 'PostConfirmation_ConfirmSignUp':
        return event
    # Defense in depth in addition to the pool/account-scoped Lambda permission.
    pool = os.environ.get('COGNITO_USER_POOL_ID')
    if not pool or event.get('userPoolId') != pool:
        raise ValueError('Unexpected provisioning source.')
    attrs = event['request']['userAttributes']
    subject = attrs.get('sub')
    if not isinstance(subject, str) or not subject.strip() or len(subject) > 128:
        raise ValueError('Invalid provisioning identity.')
    repo = DynamoRepository()
    try:
        repo.put('users', {'userId': subject, 'role': 'student', 'active': True,
                          'name': str(attrs.get('name', ''))[:80], 'profile': {'reminders': True, 'reminderDays': 14}})
    except Conflict:
        pass
    # Ignore clientMetadata, custom:role and any requested staff role.
    return event
