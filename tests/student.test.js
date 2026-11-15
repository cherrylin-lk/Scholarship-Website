import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createStudentWorkspace, profileRequest } from '../src/services/student.js';
import { createApi, ApiError } from '../src/services/api.js';

const account = (id = 'a') => ({ userId: id, name: 'Test student', role: 'student', active: true, version: 1,
  profile: { degree: "Bachelor's", gpa: 3.5, reminders: true, reminderDays: 14 } });
const identity = id => ({ id, role: 'student' });
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup() {
  let user = account(), saved = [], applications = [], writes = [];
  const api = {
    me: async () => structuredClone(user), saved: async () => ({ items: structuredClone(saved) }),
    applications: async () => ({ items: structuredClone(applications) }),
    saveProfile: async body => { writes.push(body); user = { ...user, name: body.name, version: user.version + 1, profile: { ...body } }; return structuredClone(user); },
    save: async id => { const row = { userId: user.userId, recordKey: `SAVED#${id}`, scholarshipId: id, version: 1 }; saved.push(row); return row; },
    unsave: async id => { saved = saved.filter(row => row.scholarshipId !== id); },
    saveApplication: async (id, body) => { writes.push(body); const row = { ...body, userId: user.userId, recordKey: `APPLICATION#${id}`, scholarshipId: id, version: (body.version || 0) + 1 }; applications = [row]; return row; },
    deleteApplication: async () => { applications = []; },
  };
  const failures = [], workspace = createStudentWorkspace({ api, onUnauthorized: status => failures.push(status) });
  return { api, workspace, writes, failures, changeUser: id => { user = account(id); saved = []; applications = []; } };
}

test('profile mapping is allowlisted, versioned and does not guess ambiguous postgraduate degrees', () => {
  const record = account();
  const body = profileRequest(record, { name: 'Student', degree: 'Undergraduate', gpa: '3.8', role: 'admin', userId: 'other' });
  assert.equal(body.degree, "Bachelor's"); assert.equal(body.gpa, 3.8); assert.equal(body.version, 1);
  assert.equal(body.role, undefined); assert.equal(body.userId, undefined);
  assert.throws(() => profileRequest(record, { degree: 'Postgraduate' }), /Choose/);
  assert.throws(() => profileRequest(record, { gpa: 'Infinity' }), /GPA/);
});

test('cloud profile, saves and application versions round-trip without any local storage', async () => {
  const { workspace: ws, writes } = setup(); ws.start(identity('a')); await tick();
  assert.equal(await ws.saveProfile({ name: 'Updated' }), true);
  assert.equal(ws.getState().account.version, 2);
  await ws.toggleSaved('aws-award'); await ws.reload();
  assert.equal(ws.getState().saved[0].scholarshipId, 'aws-award');
  await ws.saveApplication('aws-award', { status: 'Planning', notes: '' });
  await ws.saveApplication('aws-award', { status: 'Preparing', notes: 'Synthetic note' });
  assert.equal(writes.at(-1).version, 1); assert.equal(ws.getState().applications[0].version, 2);
  await ws.reload(); assert.equal(ws.getState().applications[0].notes, 'Synthetic note');
  await ws.toggleSaved('aws-award'); await ws.removeApplication('aws-award');
  assert.equal(ws.getState().saved.length, 0); assert.equal(ws.getState().applications.length, 0);
});

test('profile and application conflicts refresh latest data and never auto-overwrite', async () => {
  for (const method of ['saveProfile', 'saveApplication']) {
    const { api, workspace: ws } = setup(); ws.start(identity('a')); await tick();
    let calls = 0;
    api[method] = async () => { calls++; throw new ApiError('Conflict', 409); };
    api.me = async () => ({ ...account(), version: 5, name: 'Other session' });
    const success = method === 'saveProfile' ? await ws.saveProfile({ name: 'Old edit' }) : await ws.saveApplication('award', { status: 'Planning' });
    assert.equal(success, false); assert.equal(calls, 1);
    assert.equal(ws.getState().account.version, 5); assert.match(ws.getState().error, /Another session/);
  }
});

test('expired access and disabled accounts clear private state without fallback', async () => {
  for (const status of [401, 403]) {
    const { api, workspace: ws, failures } = setup(); ws.start(identity('a')); await tick();
    await ws.toggleSaved('award'); api.saved = async () => { throw new ApiError('Denied', status); };
    await ws.reload();
    assert.equal(ws.getState().userId, null); assert.equal(ws.getState().saved.length, 0);
    assert.deepEqual(failures, [status]);
  }
});

test('old responses cannot repopulate private state after logout or another login', async () => {
  const { api, workspace: ws, changeUser } = setup(); ws.start(identity('a')); await tick();
  let release;
  api.save = () => new Promise(resolve => { release = resolve; });
  const pending = ws.toggleSaved('a-private'); ws.reset(); changeUser('b'); ws.start(identity('b')); await tick();
  release({ userId: 'a', recordKey: 'SAVED#a-private', scholarshipId: 'a-private', version: 1 });
  assert.equal(await pending, false);
  assert.equal(ws.getState().userId, 'b'); assert.equal(ws.getState().saved.length, 0);
});

test('session-scoped transport refuses writes if identity changes while token refresh waits', async () => {
  let active = true, resolveToken, fetched = 0;
  const api = createApi({ baseUrl: 'https://example.invalid', getAccessToken: () => new Promise(resolve => { resolveToken = resolve; }),
    fetchImpl: async () => { fetched++; } }).forSession(() => active);
  const pending = api.saveProfile({ name: 'Old user' }); active = false; resolveToken('synthetic-new-user-token');
  await assert.rejects(pending, error => error.status === 401); assert.equal(fetched, 0);
});

test('mismatched server identity or private row owner cannot populate the workspace', async () => {
  for (const mismatch of ['account', 'row']) {
    const { api, workspace: ws } = setup();
    if (mismatch === 'account') api.me = async () => account('other');
    else api.saved = async () => ({ items: [{ userId: 'other', scholarshipId: 'award', recordKey: 'SAVED#award', version: 1 }] });
    ws.start(identity('a')); await tick();
    assert.equal(ws.getState().saved.length, 0);
    assert.ok(ws.getState().error || ws.getState().userId === null);
  }
});

test('an older reload cannot replace a newer server snapshot', async () => {
  const { api, workspace: ws } = setup();
  let release, reads = 0;
  api.me = () => ++reads === 1 ? new Promise(resolve => { release = resolve; }) : Promise.resolve({ ...account(), version: 3 });
  ws.start(identity('a'));
  await ws.reload();
  release(account()); await tick();
  assert.equal(ws.getState().account.version, 3);
});

test('failed conflict reload never claims latest data was loaded or retries a write', async () => {
  const { api, workspace: ws } = setup(); ws.start(identity('a')); await tick();
  let writes = 0;
  api.saveProfile = async () => { writes++; throw new ApiError('Conflict', 409); };
  api.me = async () => { throw new Error('Offline'); };
  assert.equal(await ws.saveProfile({ name: 'Old edit' }), false);
  assert.equal(writes, 1); assert.match(ws.getState().error, /Could not refresh/);
  assert.equal(ws.getState().busy, false); assert.equal(ws.getState().loading, false);
});
