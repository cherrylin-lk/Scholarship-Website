"""Scholarship records and validated search criteria, independent of AWS clients."""
from copy import deepcopy
from dataclasses import asdict, dataclass
from typing import Any, Mapping

from .validation import FUNDING, LEVELS, require, scholarship as validate_scholarship


# Explicit response fields prevent future private database attributes leaking publicly.
PUBLIC_FIELDS = frozenset([
    'id', 'name', 'university', 'country', 'studyLevels', 'fundingType', 'amount',
    'coverage', 'description', 'field', 'deadline', 'minGpa', 'eligibility', 'documents',
    'applicationUrl', 'published', 'approvalStatus', 'version', 'documentIds',
    'initials', 'color', 'tag', 'realProgram', 'verifiedOn', 'sourceUrl', 'deadlineNote',
])


@dataclass(frozen=True)
class ScholarshipDraft:
    """Validated editable fields. IDs, owners and approval are assigned by the server."""
    name: str
    country: str
    studyLevels: tuple[str, ...]
    fundingType: str
    amount: str
    description: str
    coverage: str
    field: str
    deadline: str | None
    minGpa: float | None
    eligibility: str
    documents: str
    applicationUrl: str

    @classmethod
    def from_body(cls, body):
        data = validate_scholarship(body)
        data['studyLevels'] = tuple(data['studyLevels'])
        return cls(**data)

    def to_record(self):
        return {**asdict(self), 'studyLevels': list(self.studyLevels)}


@dataclass(frozen=True)
class Scholarship:
    record: Mapping[str, Any]

    @property
    def is_public(self):
        return self.record.get('published') is True and self.record.get('approvalStatus') == 'approved'

    def public_dict(self):
        return deepcopy({key: value for key, value in self.record.items() if key in PUBLIC_FIELDS})


@dataclass(frozen=True)
class ScholarshipFilters:
    country: str = ''
    level: str = ''
    university: str = ''
    funding: str = ''
    query: str = ''
    limit: int = 50
    offset: int = 0

    @classmethod
    def from_query(cls, query):
        allowed = {'country', 'level', 'university', 'funding', 'query', 'limit', 'offset'}
        require(isinstance(query, dict) and not set(query) - allowed, 'Unknown search filter.')
        require(all(isinstance(value, str) and len(value) <= 200 for value in query.values()), 'Invalid search query.')
        values = {key: query.get(key, '').strip() for key in ['country', 'level', 'university', 'funding', 'query']}
        require(not values['level'] or values['level'] in LEVELS, 'Invalid study level.')
        require(not values['funding'] or values['funding'] in FUNDING, 'Invalid funding type.')
        # Reject signed/decimal/exponential values before conversion.
        raw_limit, raw_offset = query.get('limit', '50'), query.get('offset', '0')
        require(raw_limit.isascii() and raw_limit.isdigit() and raw_offset.isascii() and raw_offset.isdigit(), 'Invalid pagination.')
        limit, offset = int(raw_limit), int(raw_offset)
        require(1 <= limit <= 100 and 0 <= offset <= 100000, 'Invalid pagination.')
        return cls(**values, limit=limit, offset=offset)

    def matches(self, item):
        if not Scholarship(item).is_public:
            return False
        for value, field in [(self.country, 'country'), (self.university, 'university'), (self.funding, 'fundingType')]:
            if value and item.get(field) != value:
                return False
        if self.level and self.level not in item.get('studyLevels', []):
            return False
        searchable = ' '.join(str(item.get(key, '')) for key in
                              ['name', 'description', 'field', 'country', 'university', 'fundingType', 'amount'])
        return self.query.casefold() in searchable.casefold()
