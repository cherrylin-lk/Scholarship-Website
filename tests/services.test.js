import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/services/api.js';
import { createDiscovery } from '../src/services/discovery.js';

const ok = body => ({ ok: true, status: 200, json: async () => body });
test('API service isolates auth and encodes parameters without exposing credentials in URLs', async () => {
  const calls = [];
  const api = createApi({ baseUrl: 'https://api.example.test', getAccessToken: async () => 'fixture-access', fetchImpl: async (...args) => { calls.push(args); return ok({ items: [] }); } });
  await api.listScholarships({ country: 'United States', level: "Master's" });
  assert.equal(calls[0][1].headers.Authorization, undefined);
  assert.equal(new URL(calls[0][0]).searchParams.get('country'), 'United States');
  await api.save('award/with spaces');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer fixture-access');
  assert.ok(calls[1][0].endsWith('/me/saved/award%2Fwith%20spaces'));
  assert.ok(!calls[1][0].includes('fixture-access'));
  assert.throws(() => createApi({ baseUrl: 'http://public.example.test' }), /HTTPS/);
});

test('API service propagates authorization and conflict failures without demo fallback', async () => {
  for (const status of [401, 403, 409]) {
    const api = createApi({ baseUrl: 'http://localhost:8000', getAccessToken: async () => 'test', fetchImpl: async () => ({ ok: false, status, json: async () => ({ message: 'Denied', requestId: 'sample' }) }) });
    await assert.rejects(api.me(), error => error.status === status && error.requestId === 'sample');
  }
  const noSession = createApi({ baseUrl: 'http://localhost:8000', fetchImpl: async () => { throw new Error('Must not fetch'); } });
  await assert.rejects(noSession.me(), error => error.status === 401);
});

test('discovery follows pagination and keeps demo mode local', async () => {
  let calls = 0;
  const discovery = createDiscovery({ source: 'api', baseUrl: 'http://localhost:8000', fetchImpl: async () => ok(++calls === 1 ? { items: [{ id: 'a' }], nextOffset: 100 } : { items: [{ id: 'b' }], nextOffset: null }) });
  assert.deepEqual((await discovery.catalog([])).map(r => r.id), ['a', 'b']);
  const local = createDiscovery();
  assert.equal((await local.catalog([{ id: 1, published: true, name: 'Demo' }, { id: 2, published: false }])).length, 1);
});

test('AWS discovery requests are public and failures never substitute demo records', async () => {
  const records = [{ id: 'demo', name: 'Local demo', published: true, approvalStatus: 'approved' }];
  let calls = 0;
  const discovery = createDiscovery({ source: 'api', baseUrl: 'https://iwiirfnp4a7.execute-api.ap-southeast-2.amazonaws.com',
    fetchImpl: async (url, options) => {
      calls++;
      assert.equal(options.headers.Authorization, undefined);
      assert.equal(new URL(url).pathname, '/scholarships');
      return { ok: false, status: 503, json: async () => ({ message: 'Temporarily unavailable' }) };
    } });
  await assert.rejects(discovery.catalog(records), /Temporarily unavailable/);
  assert.equal(calls, 1);
  const demo = createDiscovery({ source: 'demo', fetchImpl: () => { throw new Error('Demo must stay offline'); } });
  assert.deepEqual((await demo.catalog(records)).map(record => record.id), ['demo']);
});
