"""Trust only API Gateway's verified JWT context, then check live account state.

Never decode a browser Authorization header as proof of identity. The deployed
HTTP API authorizer verifies signatures; the Lambda checks intended token use,
issuer, client, expiry, current account role and current account activation.
"""
import time
import math
from .validation import require


def identity(event, repo, issuer, client_id):
    claims = event.get('requestContext', {}).get('authorizer', {}).get('jwt', {}).get('claims', {})
    require(bool(issuer and client_id), 'Authentication configuration missing.', 503)
    require(claims.get('token_use') == 'access' and claims.get('iss') == issuer
            and claims.get('client_id') == client_id, 'Valid Cognito access token required.', 401)
    try:
        expiry = float(claims.get('exp', 0))
        valid = math.isfinite(expiry) and expiry > time.time()
    except (TypeError, ValueError):
        valid = False
    require(valid and isinstance(claims.get('sub'), str) and bool(claims['sub'].strip()), 'Token expired or invalid.', 401)
    user = repo.get('users', userId=claims['sub'])
    require(user and user.get('active') is True, 'Account is inactive or not provisioned.', 403)
    # Role is server-controlled in DynamoDB, never accepted from a request body.
    require(user.get('role') in ['student', 'university', 'admin'], 'Account role is invalid.', 403)
    return user


def role(user, *roles):
    require(user['role'] in roles, 'This role cannot perform this action.', 403)


def own_scholarship(repo, user, scholarship_id):
    role(user, 'university', 'admin')
    item = repo.get('scholarships', id=scholarship_id)
    require(item is not None, 'Scholarship not found.', 404)
    require(user['role'] == 'admin' or item['ownerId'] == user['userId'], 'Scholarship belongs to another university.', 403)
    return item
