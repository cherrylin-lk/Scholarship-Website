"""Allowlisted, bounded request fields; ownership and approval fields are server-only."""
from datetime import date
from urllib.parse import urlparse
import math

from .errors import ApiError

LEVELS = ["Bachelor's", "Master's", 'PhD']
FUNDING = ['Fully Funded', 'Partially Funded', 'Tuition Waiver', 'Fixed Amount']
STATUSES = ['Planning', 'Preparing', 'Submitted', 'Under review', 'Accepted', 'Rejected']


def require(condition, message, status=400):
    if not condition:
        raise ApiError(status, message)


def only(body, allowed):
    require(isinstance(body, dict), 'Expected a JSON object.')
    require(not set(body) - set(allowed), 'Unknown or protected fields in request.')


def text(body, name, limit=200, required=False):
    value = body.get(name, '')
    require(isinstance(value, str) and len(value) <= limit, f'Invalid {name}.')
    value = value.strip()
    require(not required or bool(value), f'{name} is required.')
    return value


def number(value, name, low, high, nullable=False):
    if nullable and value is None:
        return None
    require(not isinstance(value, bool), f'Invalid {name}.')
    try:
        result = float(value)
    except (ValueError, TypeError):
        raise ApiError(400, f'Invalid {name}.')
    require(math.isfinite(result) and low <= result <= high, f'Invalid {name}.')
    return result


def profile(body):
    only(body, ['name', 'degree', 'field', 'country', 'gpa', 'bio', 'fullFunding', 'reminders', 'reminderDays', 'version'])
    require(body.get('degree') in LEVELS, 'Select a supported study level.')
    result = {name: text(body, name, limit, name == 'name') for name, limit in
              [('name', 80), ('field', 100), ('country', 80), ('bio', 2000)]}
    result.update(degree=body['degree'], gpa=number(body.get('gpa'), 'gpa', 0, 4, True))
    for key, default in [('fullFunding', False), ('reminders', True)]:
        require(isinstance(body.get(key, default), bool), f'Invalid {key}.')
        result[key] = body.get(key, default)
    require(body.get('reminderDays', 14) in [7, 14, 30], 'Invalid reminder window.')
    result['reminderDays'] = body.get('reminderDays', 14)
    return result


def scholarship(body):
    limits = {'name': 160, 'country': 80, 'description': 10000, 'field': 100,
              'amount': 100, 'coverage': 1000, 'eligibility': 6000, 'documents': 4000,
              'applicationUrl': 2000}
    only(body, [*limits, 'studyLevels', 'fundingType', 'deadline', 'minGpa', 'version'])
    result = {key: text(body, key, limit, key in ['name', 'country', 'description', 'amount'])
              for key, limit in limits.items()}
    levels = body.get('studyLevels')
    require(isinstance(levels, list) and 0 < len(levels) <= 3 and all(v in LEVELS for v in levels), 'Invalid study levels.')
    require(body.get('fundingType') in FUNDING, 'Invalid funding type.')
    deadline = body.get('deadline')
    if deadline is not None:
        try:
            require(isinstance(deadline, str) and len(deadline) == 10, 'Invalid deadline.')
            date.fromisoformat(deadline)
        except ValueError:
            raise ApiError(400, 'Invalid deadline.')
    url = result['applicationUrl']
    if url:
        parsed = urlparse(url)
        require(parsed.scheme == 'https' and bool(parsed.hostname) and not parsed.username and not parsed.password, 'Application URL must use HTTPS.')
    return {**result, 'studyLevels': list(dict.fromkeys(levels)), 'fundingType': body['fundingType'],
            'deadline': deadline, 'minGpa': number(body.get('minGpa'), 'minGpa', 0, 4, True)}
