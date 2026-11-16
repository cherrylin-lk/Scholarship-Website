import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStaffWorkspace, scholarshipRequest } from '../src/services/staff.js';
import { ApiError, createApi } from '../src/services/api.js';

function setup(role = 'university') {
  const identity = { id: 'staff', role };
  const rows = [{ id: 'award', ownerId: 'staff', version: 1 }], writes = [];
  const api = { me: async () => ({ userId: 'staff', role, active: true }),
    universityScholarships: async () => ({ items: rows }), adminScholarships: async () => ({ items: rows }),
    adminUsers: async () => ({ items: [{ userId: 'student', role: 'student', active: true, version: 1 }] }), statistics: async () => ({ users: 2 }),
    createScholarship: async body => writes.push(body), updateScholarship: async (id, body) => writes.push({ id, ...body }),
    unpublishScholarship: async (id, version) => writes.push({ id, version }),
    moderate: async (id, body) => writes.push({ id, ...body }), updateUser: async (id, body) => writes.push({ id, ...body }),
  };
  let denied = 0;
  const workspace = createStaffWorkspace({ api, identity, onUnauthorized: () => denied++ });
  return { workspace, api, rows, writes, denied: () => denied };
}

test('staff drafts allowlist fields, preserve multiple levels and versions, omit server authority', () => {
  const body = scholarshipRequest({ name: ' Award ', country: 'Thailand', amount: 'Tuition', description: 'Example', fundingType: 'Fully Funded', minGpa: '3.2', ownerId: 'attacker', published: true }, ["Master's", 'PhD'], 4);
  assert.equal(body.name, 'Award'); assert.equal(body.version, 4); assert.equal(body.minGpa, 3.2);
  assert.deepEqual(body.studyLevels, ["Master's", 'PhD']); assert.equal(body.ownerId, undefined); assert.equal(body.published, undefined);
  assert.throws(() => scholarshipRequest({}, []));
  assert.throws(() => scholarshipRequest({ applicationUrl: 'http://unsafe.test' }, ['PhD']));
});
test('university operations use server versions and refresh authoritative listings', async () => {
  const { workspace: w, writes } = setup(); await w.reload();
  assert.equal(await w.save(null, { name: 'New' }), true);
  await w.save('award', { version: 1 }); await w.unpublish(w.getState().scholarships[0]);
  assert.deepEqual(writes, [{ name: 'New' }, { id: 'award', version: 1 }, { id: 'award', version: 1 }]);
});
test('admin moderation and activation send only supported versioned actions', async () => {
  const { workspace: w, writes } = setup('admin'); await w.reload();
  await w.moderate(w.getState().scholarships[0], 'reject', 'Eligibility unclear');
  await w.setActive(w.getState().users[0]);
  assert.deepEqual(writes, [{ id: 'award', decision: 'reject', note: 'Eligibility unclear', version: 1 }, { id: 'student', active: false, version: 1 }]);
  assert.equal(await w.save(null, {}), false);
});
test('foreign ownership, student roles and mismatched identity fail closed', async () => {
  const f = setup(); f.rows[0].ownerId = 'other'; assert.equal(await f.workspace.reload(), false); assert.deepEqual(f.workspace.getState().scholarships, []);
  const student = setup('student'); assert.equal(await student.workspace.reload(), false); assert.equal(student.denied(), 1);
  const mismatch = setup(); mismatch.api.me = async () => ({ userId: 'other', role: 'university', active: true });
  assert.equal(await mismatch.workspace.reload(), false); assert.equal(mismatch.denied(), 1);
});
test('conflicts refresh without replay, read errors retry, and expired sessions clear staff data', async () => {
  const f = setup(); await f.workspace.reload();
  let calls = 0; f.api.updateScholarship = async () => { calls++; f.rows[0].version++; throw new ApiError('Conflict', 409); };
  assert.equal(await f.workspace.save('award', { version: 1 }), false); assert.equal(calls, 1);
  assert.equal(f.workspace.getState().scholarships[0].version, 2); assert.match(f.workspace.getState().error, /Another session/);
  await f.workspace.reload();
  f.api.universityScholarships = async () => { throw new ApiError('Unavailable', 503); };
  assert.equal(await f.workspace.reload(), false); assert.match(f.workspace.getState().error, /Retry/);
  f.api.me = async () => { throw new ApiError('Expired', 401); };
  await f.workspace.reload(); assert.equal(f.denied(), 1); assert.deepEqual(f.workspace.getState().scholarships, []);
});
test('unmount/logout discards pending reads and mutation responses', async () => {
  const f = setup(); await f.workspace.reload();
  let finish; f.api.updateScholarship = () => new Promise(resolve => { finish = resolve; });
  const write = f.workspace.save('award', { version: 1 }); f.workspace.dispose(); finish({});
  assert.equal(await write, false); assert.deepEqual(f.workspace.getState().scholarships, []);
  assert.equal(await f.workspace.save(null, {}), false);
  const reading = setup(); let finishRead;
  reading.api.universityScholarships = () => new Promise(resolve => { finishRead = resolve; });
  const read = reading.workspace.reload();
  await new Promise(resolve => setTimeout(resolve, 0));
  reading.workspace.dispose(); finishRead({ items: reading.rows });
  assert.equal(await read, false); assert.deepEqual(reading.workspace.getState().scholarships, []);
});
test('nested staff session transport keeps identity and unmount guards during token refresh', async () => {
  let sameUser = true, tokenReady, requests = 0;
  const api = createApi({ baseUrl: 'https://api.example.test', getAccessToken: () => new Promise(resolve => { tokenReady = resolve; }), fetchImpl: async () => { requests++; return { ok: true, json: async () => ({}) }; } });
  const scoped = api.forSession(() => sameUser).forSession(() => true);
  const pending = scoped.createScholarship({ name: 'Old session input' });
  sameUser = false; tokenReady('synthetic');
  await assert.rejects(pending, error => error.status === 401); assert.equal(requests, 0);
});
