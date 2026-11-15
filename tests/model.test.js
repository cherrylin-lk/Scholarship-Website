import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysLeft, notifications, passwordHash, recommend, seedStore } from '../src/model.js';

const today = '2026-11-12';
const scholarship = { id: 1, published: true, degree: 'Undergraduate', field: 'All fields', country: 'Thailand', amount: 'Full tuition', minGpa: 3, deadline: '2026-11-19' };
const profile = { degree: 'Undergraduate', field: 'Engineering & Technology', country: 'Thailand', gpa: '3.7', fullFunding: true, reminders: true, reminderDays: 14 };
test('recommendations exclude unmet requirements, closed and unpublished listings', () => {
  assert.equal(recommend(scholarship, profile, today).score, 100);
  assert.equal(recommend(scholarship, { ...profile, gpa: '' }, today), null);
  assert.equal(recommend(scholarship, { ...profile, gpa: '2.9' }, today), null);
  assert.equal(recommend(scholarship, { ...profile, degree: 'Postgraduate' }, today), null);
  assert.equal(recommend({ ...scholarship, deadline: '2026-11-11' }, profile, today), null);
  assert.equal(recommend({ ...scholarship, published: false }, profile, today), null);
});
test('ranking rewards field, destination and funding preferences', () => {
  assert.equal(recommend({ ...scholarship, field: 'Arts & Design', country: 'Canada', amount: '$1000' }, profile, today).score, 50);
});
test('deadlines handle calendar boundaries and today inclusively', () => {
  assert.equal(daysLeft('2027-01-01', '2026-12-31'), 1);
  assert.equal(daysLeft(today, today), 0);
  assert.equal(daysLeft('2026-11-11', today), -1);
});
test('reminders are scoped, deduplicated, dismissible and respect preferences', () => {
  const store = { scholarships: [scholarship], bookmarks: { student: [1], other: [1] }, applications: [{ userId: 'student', scholarshipId: 1, status: 'Preparing' }], dismissed: {} };
  const user = { id: 'student', role: 'student', profile };
  assert.equal(notifications(store, user, today).length, 1);
  assert.equal(notifications(store, { ...user, id: 'stranger' }, today).length, 0);
  assert.equal(notifications(store, { ...user, profile: { ...profile, reminders: false } }, today).length, 0);
  assert.equal(notifications(store, { ...user, role: 'admin' }, today).length, 0);
  assert.equal(notifications({ ...store, dismissed: { student: ['1:2026-11-19'] } }, user, today).length, 0);
  assert.equal(notifications(store, user, '2026-11-20').length, 0);
  assert.equal(notifications({ ...store, bookmarks: {}, applications: [{ userId: 'student', scholarshipId: 1, status: 'Submitted' }] }, user, today).length, 0);
});
test('password hashing is deterministic for a salt and changes with password or salt', async () => {
  const hash = await passwordHash('DemoPassword123', 'salt-one');
  assert.equal(hash.length, 64);
  assert.equal(hash, await passwordHash('DemoPassword123', 'salt-one'));
  assert.notEqual(hash, await passwordHash('wrong-password', 'salt-one'));
  assert.notEqual(hash, await passwordHash('DemoPassword123', 'salt-two'));
});
test('seed records have unique identifiers and valid scholarship owners', () => {
  const store = seedStore();
  assert.equal(new Set(store.scholarships.map(s => s.id)).size, store.scholarships.length);
  assert.equal(store.scholarships.filter(s => s.ownerId === 'demo-university').length, 1);
  assert.equal(store.users.filter(u => u.role === 'admin').length, 1);
});


// Synthetic fixtures exercise destinations and multi-level eligibility without changing the catalog.
import { filterScholarships, normalizeScholarship, levelsOf, fundingOf } from '../src/model.js';
const listings = [
 { ...scholarship, id: 'jp', name: 'Japan Research Award', university: 'Tokyo Example', country: 'Japan', studyLevels: ["Master's", 'PhD'], fundingType: 'Fully Funded', approvalStatus: 'approved' },
 { ...scholarship, id: 'th', name: 'Thailand Tuition Award', university: 'Bangkok Example', studyLevels: ["Bachelor's"], fundingType: 'Tuition Waiver', approvalStatus: 'approved' },
 { ...scholarship, id: 'pending', name: 'Pending award', country: 'Japan', approvalStatus: 'pending' },
];
test('four filters work independently, together and with immediate keyword matching', () => {
 for (const filters of [{ country: 'Japan' }, { level: "Master's" }, { university: 'Tokyo Example' }, { funding: 'Fully Funded' }]) assert.deepEqual(filterScholarships(listings, filters).map(s => s.id), ['jp']);
 assert.deepEqual(filterScholarships(listings, { country: 'Japan', level: "Master's", funding: 'Fully Funded', university: 'Tokyo Example', query: ' RESEARCH ' }).map(s => s.id), ['jp']);
 assert.equal(filterScholarships(listings, { country: 'Japan', level: "Bachelor's" }).length, 0);
 assert.equal(filterScholarships(listings, { level: 'PhD' }).length, 1);
 assert.equal(filterScholarships(listings, { university: 'Tokyo' }).length, 0);
 assert.equal(filterScholarships(listings).length, 2);
 assert.equal(filterScholarships(listings, { query: 'missing keyword' }).length, 0);
});
test('legacy normalization preserves data and classifies full tuition separately from full funding', () => {
 const normalized = normalizeScholarship(scholarship);
 assert.equal(normalized.id, scholarship.id);
 assert.deepEqual(levelsOf(normalized), ["Bachelor's"]);
 assert.equal(normalized.fundingType, 'Tuition Waiver');
 assert.equal(fundingOf({ ...scholarship, coverage: '+ living allowance' }), 'Fully Funded');
 assert.deepEqual(levelsOf({ degree: 'Postgraduate' }), ["Master's", 'PhD']);
 assert.equal(filterScholarships([{ ...listings[0], published: false }]).length, 0);
 assert.equal(recommend({ ...listings[0], approvalStatus: 'pending' }, profile, today), null);
});


import { addThaiScholarships, dateLabel } from '../src/model.js';
import { thaiScholarships } from '../src/thaiScholarships.js';
test('real Thai catalog is added once without replacing accounts, history or edited listings', () => {
 const store = seedStore();
 assert.equal(thaiScholarships.length, 5);
 const real = filterScholarships(store.scholarships, { country: 'Thailand' }).filter(s => s.realProgram);
 assert.equal(real.length, 5);
 assert.equal(new Set(real.map(s => s.university)).size, 5);
 assert.ok(real.every(s => s.applicationUrl.startsWith('https://') && s.verifiedOn));
 const existing = { ...store, scholarships: [store.scholarships[0], { ...thaiScholarships[1], name: 'Saved edit' }] };
 const migrated = addThaiScholarships(existing);
 assert.equal(migrated.users, existing.users);
 assert.equal(migrated.applications, existing.applications);
 assert.equal(migrated.bookmarks, existing.bookmarks);
 assert.equal(migrated.scholarships.find(s => s.id === thaiScholarships[1].id).name, 'Saved edit');
 assert.equal(addThaiScholarships(migrated).scholarships.length, migrated.scholarships.length);
 assert.equal(dateLabel(null), 'Check official announcement');
 assert.equal(recommend(thaiScholarships.find(s => !s.deadline), profile, today), null);
 assert.equal(filterScholarships(real, { level: "Master's", funding: 'Fully Funded' }).length, 3);
 assert.equal(real.find(s => s.id === 'th-ait-rtg-2027').deadline, '2027-03-31');
});
