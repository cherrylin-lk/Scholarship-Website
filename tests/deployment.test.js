import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productionEnvironment as env, productionConfigErrors } from '../scripts/check-production-config.mjs';
import { readCognitoConfig } from '../src/services/cognito.js';

test('production callback/logout match Amplify while localhost remains independent', () => {
  assert.deepEqual(productionConfigErrors(env), []);
  const origin = 'https://main.d1s9suck9hx25r.amplifyapp.com';
  const production = readCognitoConfig(env, { origin });
  assert.equal(production.redirectUri, origin + '/');
  assert.equal(production.logoutUri, origin + '/');
  const local = readCognitoConfig({ ...env, VITE_COGNITO_REDIRECT_URI: '', VITE_COGNITO_LOGOUT_URI: '' }, { origin: 'http://localhost:5173' });
  assert.equal(local.redirectUri, 'http://localhost:5173/');
  assert.equal(local.logoutUri, 'http://localhost:5173/');
  assert.equal(readCognitoConfig(env, { origin: 'http://localhost:5173' }).configured, false);
});

test('release guard rejects missing settings, localhost callbacks, private variables and unconfigured APIs', () => {
  for (const overrides of [{ VITE_COGNITO_CLIENT_ID: '' }, { VITE_COGNITO_LOGOUT_URI: 'http://localhost:5173/' },
    { VITE_COGNITO_REDIRECT_URI: 'http://localhost:5173/' }, { VITE_API_BASE_URL: 'http://localhost:8000' },
    { VITE_ACCOUNT_API_BASE_URL: 'https://unconfigured.invalid' }, { VITE_CLIENT_SECRET: 'synthetic' }]) {
    assert.ok(productionConfigErrors({ ...env, ...overrides }).length > 0);
  }
});

test('Amplify rewrite serves SPA paths and preserves static assets', () => {
  const [rule] = JSON.parse(readFileSync(new URL('../deployment/amplify-rewrites.json', import.meta.url), 'utf8'));
  assert.equal(rule.status, '200'); assert.equal(rule.target, '/index.html');
  const pattern = new RegExp(rule.source.slice(2, -2));
  for (const path of ['/', '/scholarships', '/account/profile']) assert.equal(pattern.test(path), true);
  for (const path of ['/assets/main.js', '/assets/main.css', '/scholarrise-logo.png', '/wordmark.svg', '/document.pdf']) assert.equal(pattern.test(path), false);
});
