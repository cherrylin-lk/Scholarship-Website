import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi } from '../src/services/api.js';
import { createCognitoAuth } from '../src/services/cognito.js';
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

test('Cognito registration cannot request staff roles and tokens stay in the auth adapter', async () => {
  const requests = [];
  const auth = createCognitoAuth({ region: 'ap-southeast-1', clientId: 'public-client', fetchImpl: async (_url, args) => { requests.push(args); return ok(args.headers['X-Amz-Target'].endsWith('InitiateAuth') ? { AuthenticationResult: { AccessToken: 'test-access', ExpiresIn: 3600 } } : {}); } });
  await auth.register('sample@example.test', 'NotARealPassword123!', 'Sample');
  assert.deepEqual(JSON.parse(requests[0].body).UserAttributes.map(a => a.Name), ['email', 'name']);
  assert.equal(await auth.getAccessToken(), null);
  await auth.signIn('sample@example.test', 'NotARealPassword123!');
  assert.equal(await auth.getAccessToken(), 'test-access');
  await auth.signOut();
  assert.equal(await auth.getAccessToken(), null);
});
