import unittest
from copy import deepcopy
from itertools import combinations

from scholarrise.errors import ApiError
from scholarrise.models import Scholarship, ScholarshipFilters
from scholarrise.repository import MemoryRepository
from scholarrise.scholarships import ScholarshipRepository


class ScholarshipModelTests(unittest.TestCase):
    def setUp(self):
        self.repo = MemoryRepository()
        self.discovery = ScholarshipRepository(self.repo)
        self.award = {'id': 'a', 'name': 'Japan Research Award', 'country': 'Japan', 'university': 'Example University',
                      'studyLevels': ["Master's", 'PhD'], 'fundingType': 'Fully Funded', 'amount': 'Full tuition',
                      'published': True, 'approvalStatus': 'approved'}
        for item in [self.award, {**self.award, 'id': 'b', 'country': 'Thailand', 'studyLevels': ["Bachelor's"], 'fundingType': 'Tuition Waiver'},
                     {**self.award, 'id': 'pending', 'approvalStatus': 'pending'}, {**self.award, 'id': 'hidden', 'published': False}]:
            self.repo.put('scholarships', item)

    def test_every_nonempty_combination_of_four_filters(self):
        choices = [('country', 'Japan'), ('level', "Master's"), ('university', 'Example University'), ('funding', 'Fully Funded')]
        for size in range(1, 5):
            for selection in combinations(choices, size):
                with self.subTest(selection=selection):
                    result = self.discovery.search(dict(selection))
                    expected = ['a', 'b'] if list(selection) == [('university', 'Example University')] else ['a']
                    self.assertEqual([r['id'] for r in result['items']], expected)

    def test_multi_level_keywords_empty_results_and_stable_pages(self):
        self.assertEqual(self.discovery.search({'level': 'PhD', 'query': ' TUITION '})['total'], 1)
        self.assertEqual(self.discovery.search({'country': 'Japan', 'level': "Bachelor's"})['total'], 0)
        page = self.discovery.search({'limit': '1'})
        self.assertEqual([r['id'] for r in page['items']], ['a'])
        self.assertEqual(page['nextOffset'], 1)
        self.assertEqual(page['total'], 2)
        last = self.discovery.search({'limit': '1', 'offset': '1'})
        self.assertEqual([r['id'] for r in last['items']], ['b'])
        self.assertIsNone(last['nextOffset'])
        self.assertEqual(self.discovery.search({'offset': '20'})['items'], [])

    def test_invalid_filters_have_explicit_client_errors(self):
        for query in [{'level': 'Undergraduate'}, {'funding': 'anything'}, {'ownerId': 'student'}, {'query': 'x' * 201},
                      {'limit': '0'}, {'limit': '101'}, {'offset': '-1'}, {'offset': '1.5'}, {'limit': '1e2'}, {'country': ['Japan']}]:
            with self.subTest(query=query), self.assertRaises(ApiError) as caught:
                ScholarshipFilters.from_query(query)
            self.assertEqual(caught.exception.status, 400)

    def test_only_approved_published_records_are_public_and_facets_exclude_hidden(self):
        self.assertFalse(Scholarship({**self.award, 'approvalStatus': 'pending'}).is_public)
        self.assertFalse(Scholarship({**self.award, 'published': False}).is_public)
        self.assertFalse(Scholarship({**self.award, 'published': 'true'}).is_public)
        result = self.discovery.search({'country': 'Japan'})
        self.assertEqual(result['facets']['country'], ['Japan', 'Thailand'])
        for identifier in ['pending', 'hidden', 'missing']:
            with self.assertRaises(ApiError) as caught:
                self.discovery.get_public(identifier)
            self.assertEqual(caught.exception.status, 404)

    def test_public_model_allowlist_is_non_mutating(self):
        item = {**self.award, 'ownerId': 'private', 'moderationNote': 'private', 'futureSecret': 'private'}
        exposed = Scholarship(item).public_dict()
        for field in ['ownerId', 'moderationNote', 'futureSecret']:
            self.assertNotIn(field, exposed)
        exposed['studyLevels'].clear()
        self.assertEqual(item['studyLevels'], ["Master's", 'PhD'])
