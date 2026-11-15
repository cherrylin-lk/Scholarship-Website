// Offline OIDC provider simulator. These identifiers and accounts are synthetic.
// No real Cognito traffic, AWS accounts, or actual student credentials are used.
import { createHash, generateKeyPairSync, sign } from 'node:crypto';

export const fixtureEnv = {
  VITE_COGNITO_REGION: 'ap-southeast-2', VITE_COGNITO_USER_POOL_ID: 'ap-southeast-2_TestPool',
  VITE_COGNITO_CLIENT_ID: 'testspaclient', VITE_COGNITO_DOMAIN: 'https://auth.scholarrise.invalid',
  VITE_COGNITO_REDIRECT_URI: '', VITE_COGNITO_LOGOUT_URI: '',
  VITE_ACCOUNT_API_BASE_URL: 'http://127.0.0.1:5190',
};
const issuer = 'https://cognito-idp.ap-southeast-2.amazonaws.com/ap-southeast-2_TestPool';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
function jwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'offline-key', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const input = `${header}.${body}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

export async function mockCognito(page, { role = 'student', sub = 'oidc-student-sub', name = 'Jamie Student', email = 'jamie@example.test', verified = true } = {}) {
  // Keep offline auth tests independent of Google Fonts/network navigation delays.
  await page.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com\//, route => route.abort());
  let authorization, issued, tokenRequests = 0;
  const claims = () => ({ sub, email, email_verified: verified, name,
    // Deliberately adversarial group claim: frontend must not infer staff rights.
    'cognito:groups': ['admin'], iss: issuer, aud: fixtureEnv.VITE_COGNITO_CLIENT_ID,
    iat: Math.floor(Date.now() / 1000), exp: Math.floor(Date.now() / 1000) + 3600, nonce: authorization?.get('nonce') });
  await page.route('https://cognito-idp.ap-southeast-2.amazonaws.com/**', async route => {
    if (route.request().url().endsWith('/.well-known/jwks.json')) return route.fulfill({ json: { keys: [{ ...publicKey.export({ format: 'jwk' }), kid: 'offline-key', alg: 'RS256', use: 'sig' }] } });
    return route.abort();
  });
  await page.route('http://127.0.0.1:5190/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization,content-type' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
    if (!route.request().headers().authorization?.startsWith('Bearer ')) return route.fulfill({ status: 401, json: { message: 'Missing test identity' } });
    return route.fulfill({ headers, json: { userId: sub, name, role, active: true, version: 1, university: role === 'university' ? 'Westbridge University' : '', profile: {} } });
  });
  await page.route('https://auth.scholarrise.invalid/**', async route => {
    const url = new URL(route.request().url());
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'content-type,authorization' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    if (['/oauth2/authorize', '/signup', '/forgotPassword'].includes(url.pathname)) {
      authorization = url.searchParams;
      const callback = new URL(authorization.get('redirect_uri'));
      callback.searchParams.set('code', 'offline-authorization-code'); callback.searchParams.set('state', authorization.get('state'));
      const label = url.pathname === '/signup' ? 'Mock Cognito email verification' : url.pathname === '/forgotPassword' ? 'Mock Cognito password recovery' : 'Mock Cognito sign in';
      return route.fulfill({ contentType: 'text/html', body: `<h1>${label}</h1><a href="${callback.href.replaceAll('&', '&amp;')}">Complete secure sign-in</a>` });
    }
    if (url.pathname === '/oauth2/token') {
      tokenRequests++;
      const params = new URLSearchParams(route.request().postData());
      if (params.get('grant_type') === 'authorization_code') {
        const challenge = createHash('sha256').update(params.get('code_verifier') || '').digest('base64url');
        if (challenge !== authorization.get('code_challenge') || authorization.get('code_challenge_method') !== 'S256') {
          return route.fulfill({ status: 400, headers: cors, json: { error: 'invalid_grant' } });
        }
      }
      issued = claims();
      return route.fulfill({ headers: cors, json: { access_token: jwt({ ...issued, token_use: 'access', client_id: fixtureEnv.VITE_COGNITO_CLIENT_ID }),
        id_token: jwt(issued), refresh_token: 'offline-refresh-token', token_type: 'Bearer', expires_in: 3600, scope: 'openid email profile' } });
    }
    if (url.pathname === '/oauth2/userInfo') return route.fulfill({ headers: cors, json: issued || claims() });
    if (url.pathname === '/oauth2/revoke') return route.fulfill({ headers: cors, json: {} });
    if (url.pathname === '/logout') return route.fulfill({ status: 302, headers: { Location: url.searchParams.get('logout_uri') } });
    return route.abort();
  });
  return { tokenRequests: () => tokenRequests, authorization: () => authorization };
}

export async function signInThroughManagedLogin(page, options = {}) {
  const controls = await mockCognito(page, options);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Log in', exact: true }).click();
  await page.getByRole('link', { name: 'Complete secure sign-in' }).click({ noWaitAfter: true });
  await page.getByRole('button', { name: 'My workspace', exact: true }).waitFor();
  return controls;
}
