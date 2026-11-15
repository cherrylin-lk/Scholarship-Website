"""Discovery operations shared by the Lambda handler and offline runner."""
from .models import Scholarship, ScholarshipFilters
from .validation import require


class ScholarshipRepository:
    def __init__(self, repository):
        self.repository = repository

    def get_public(self, scholarship_id):
        item = self.repository.get('scholarships', id=scholarship_id)
        require(item is not None and Scholarship(item).is_public, 'Scholarship not found.', 404)
        return Scholarship(item).public_dict()

    def public_items(self):
        # GSIs are eventually consistent. Check current base records so a stale
        # approved-index entry cannot expose an edited/unpublished scholarship.
        candidates = self.repository.query('scholarships', 'approvalStatus', 'approved', 'StatusIndex')
        current = [self.repository.get('scholarships', id=row['id']) for row in candidates]
        return [row for row in current if row and Scholarship(row).is_public]

    def search(self, query):
        filters = ScholarshipFilters.from_query(query)
        all_rows = self.public_items()
        rows = sorted((row for row in all_rows if filters.matches(row)), key=lambda row: row['id'])
        end = filters.offset + filters.limit
        return {'items': [Scholarship(row).public_dict() for row in rows[filters.offset:end]],
                'total': len(rows), 'nextOffset': end if end < len(rows) else None,
                'facets': {field: sorted({row[field] for row in all_rows if row.get(field)}) for field in ['country', 'university']}}
