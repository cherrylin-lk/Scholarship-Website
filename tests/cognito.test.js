import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanCallbackUrl, createCognitoAuth, oidcSettings, readCognitoConfig, verifiedIdentity } from '../src/services/cognito.js';

class MemoryStorage {
  data = new Map();
  get length() { return this.data.size; }
  getItem(key) { return this.data.get(key) ?? null; }
  setItem(key, value) { this.data.set(key, value); }
  removeItem(key) { this.data.delete(key); }
  key(index) { return [...this.data.keys()][index]; }
}
const env = { VITE_COGNITO_REGION: 'ap-southeast-2', VITE_COGNITO_USER_POOL_ID: 'ap-southeast-2_TestPool', VITE_COGNITO_CLIENT_ID: 'testclient', VITE_COGNITO_DOMAIN: 'https://auth.example.invalid' };
const location = { origin: 'http://localhost:5173', href: 'http://localhost:5173/' };
const config = readCognitoConfig(env, location);
const base = () => ({ config, location, storage: new MemoryStorage(), history: { replaceState() {} } });

test('configuration requires real supplied identifiers and same-origin callbacks', () => {
  assert.equal(readCognitoConfig({}, location).configured, false);
  assert.equal(config.configured, true);
  assert.equal(config.redirectUri, 'http://localhost:5173/');
  assert.equal(readCognitoConfig({ ...env, VITE_COGNITO_DOMAIN: 'http://auth.invalid' }, location).configured, false);
  assert.equal(readCognitoConfig({ ...env, VITE_COGNITO_REDIRECT_URI: 'https://other.invalid/' }, location).configured, false);
  assert.equal(readCognitoConfig({ ...env, VITE_COGNITO_REGION: 'ap-southeast-1' }, location).configured, false);
});
test('OIDC uses code + PKCE, exact scopes, separate session stores, and no secret', () => {
  const settings = oidcSettings(config, new MemoryStorage());
  assert.equal(settings.response_type, 'code'); assert.equal(settings.disablePKCE, false);
  assert.equal(settings.scope, 'openid email profile'); assert.equal(settings.client_secret, undefined);
  assert.equal(settings.automaticSilentRenew, false);
});
test('signup and recovery use library-generated PKCE/state and never put verifier in URL', async () => {
  const options = base(); let target;
  const auth = createCognitoAuth({ ...options, navigate: value => { target = new URL(value); } });
  await auth.register();
  assert.equal(target.pathname, '/signup'); assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(target.searchParams.get('state')); assert.ok(target.searchParams.get('nonce'));
  assert.equal(target.searchParams.has('code_verifier'), false);
  assert.ok(options.storage.length > 0);
  await auth.recoverPassword(); assert.equal(target.pathname, '/forgotPassword');
});
test('callback is consumed once and OAuth response data is removed from the address bar', async () => {
  let calls = 0, cleaned;
  const auth = createCognitoAuth({ ...base(), location: { ...location, href: location.href + '?code=offline&state=offline' },
    history: { replaceState: (_state, _title, url) => { cleaned = url; } },
    manager: { signinRedirectCallback: async () => { calls++; return { profile: { sub: 'test' } }; } }, client: {} });
  await Promise.all([auth.initialize(), auth.initialize()]);
  assert.equal(calls, 1); assert.equal(cleaned, '/');
  assert.equal(cleanCallbackUrl('http://localhost:5173/?error=denied&error_description=private&state=private&keep=yes#scholarships'), '/?keep=yes#scholarships');
});
test('invalid OAuth state fails closed and does not leak provider errors', async () => {
  const auth = createCognitoAuth({ ...base(), location: { ...location, href: location.href + '?code=offline&state=unknown' } });
  await assert.rejects(auth.initialize(), /Sign-in could not be completed/);
});
test('identity requires verified email and ignores local roles and group claims', () => {
  const source = { profile: { sub: 'cognito-sub', email: 'test@example.test', email_verified: true, role: 'admin', 'cognito:groups': ['admin'] } };
  assert.equal(verifiedIdentity(source).id, 'cognito-sub'); assert.equal(verifiedIdentity(source).role, 'student');
  assert.throws(() => verifiedIdentity({ ...source, profile: { ...source.profile, email_verified: false } }), /Verify your email/);
  assert.equal(verifiedIdentity({ ...source, expired: true }), null);
});
test('logout removes local auth even if revocation fails and uses Cognito logout_uri', async () => {
  let removed = false, target;
  const auth = createCognitoAuth({ ...base(), client: {}, manager: {
    revokeTokens: async () => { throw new Error('offline revocation failure'); }, removeUser: async () => { removed = true; },
  }, navigate: value => { target = new URL(value); } });
  await auth.signOut(); assert.equal(removed, true);
  assert.equal(target.pathname, '/logout'); assert.equal(target.searchParams.get('logout_uri'), location.href);
  assert.equal(target.searchParams.has('id_token_hint'), false);
});

test('expired access token refresh is deduplicated and failure clears authentication', async () => {
  let calls = 0, removed = 0;
  const manager = { getUser: async () => ({ expired: true, refresh_token: 'synthetic' }),
    signinSilent: async () => { calls++; await new Promise(resolve => setTimeout(resolve, 5)); return { expired: false, access_token: 'synthetic' }; },
    removeUser: async () => { removed++; } };
  const auth = createCognitoAuth({ ...base(), manager, client: {} });
  assert.deepEqual(await Promise.all([auth.getAccessToken(), auth.getAccessToken()]), ['synthetic', 'synthetic']);
  assert.equal(calls, 1);
  manager.signinSilent = async () => { throw new Error('offline'); };
  assert.equal(await auth.getAccessToken(), null);
  assert.equal(removed, 1);
});
