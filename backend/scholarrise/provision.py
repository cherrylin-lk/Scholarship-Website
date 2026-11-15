"""Cognito post-confirmation trigger: self-registration can only create students."""
from .repository import DynamoRepository
from .errors import Conflict


def lambda_handler(event, context):
    if event.get('triggerSource') != 'PostConfirmation_ConfirmSignUp':
        return event
    # Lambda resource policy restricts invocation to this stack's Cognito pool.
    attrs = event['request']['userAttributes']
    repo = DynamoRepository()
    try:
        repo.put('users', {'userId': attrs['sub'], 'role': 'student', 'active': True,
                          'name': attrs.get('name', ''), 'profile': {'reminders': True, 'reminderDays': 14}})
    except Conflict:
        pass
    # Ignore clientMetadata, custom:role and any requested staff role.
    return event
