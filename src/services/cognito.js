import { Log, OidcClient, UserManager, WebStorageStateStore } from 'oidc-client-ts';

// OAuth responses and tokens must never be logged.
Log.setLevel(Log.NONE);
const REQUIRED = ['VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_CLIENT_ID', 'VITE_COGNITO_DOMAIN'];
export function readCognitoConfig(env, location) {
  const missing = REQUIRED.filter(key => !env[key]?.trim() || /your-|replace|placeholder/i.test(env[key]));
  if (missing.length) return { configured: false, message: `Cognito setup is incomplete. Set ${missing.join(', ')}.` };
  const region = env.VITE_COGNITO_REGION || 'ap-southeast-2';
  if (!/^[a-z]{2}-[a-z]+-\d$/.test(region) || !env.VITE_COGNITO_USER_POOL_ID.startsWith(`${region}_`)) {
    return { configured: false, message: 'Cognito region and User Pool ID do not match.' };
  }
  try {
    const domain = new URL(env.VITE_COGNITO_DOMAIN);
    if (domain.protocol !== 'https:' || domain.username || domain.password || domain.pathname !== '/' || domain.search || domain.hash) throw new Error();
    const callback = new URL(env.VITE_COGNITO_REDIRECT_URI || `${location.origin}/`);
    const logout = new URL(env.VITE_COGNITO_LOGOUT_URI || `${location.origin}/`);
    for (const url of [callback, logout]) {
      if (url.origin !== location.origin || url.hash || url.search || url.pathname !== '/') throw new Error();
      if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) throw new Error();
    }
    return { configured: true, region, authority: `https://cognito-idp.${region}.amazonaws.com/${env.VITE_COGNITO_USER_POOL_ID}`,
      clientId: env.VITE_COGNITO_CLIENT_ID.trim(), domain: domain.origin, redirectUri: callback.href, logoutUri: logout.href };
  } catch {
    return { configured: false, message: 'Use an HTTPS Cognito domain and callback/sign-out URLs matching this website origin and root path.' };
  }
}

export function oidcSettings(config, storage) {
  return {
    authority: config.authority, client_id: config.clientId,
    redirect_uri: config.redirectUri, post_logout_redirect_uri: config.logoutUri,
    response_type: 'code', scope: 'openid email profile', disablePKCE: false,
    loadUserInfo: true, automaticSilentRenew: false, monitorSession: false,
    revokeTokenTypes: ['refresh_token'],
    userStore: new WebStorageStateStore({ store: storage, prefix: 'scholarrise.oidc.user.' }),
    stateStore: new WebStorageStateStore({ store: storage, prefix: 'scholarrise.oidc.state.' }),
    metadata: { issuer: config.authority, authorization_endpoint: `${config.domain}/oauth2/authorize`,
      token_endpoint: `${config.domain}/oauth2/token`, userinfo_endpoint: `${config.domain}/oauth2/userInfo`,
      revocation_endpoint: `${config.domain}/oauth2/revoke`, jwks_uri: `${config.authority}/.well-known/jwks.json` },
  };
}

export function verifiedIdentity(user) {
  if (!user || user.expired || typeof user.profile?.sub !== 'string' || !user.profile.sub) return null;
  if (user.profile.email_verified !== true && user.profile.email_verified !== 'true') {
    throw new Error('Verify your email address on Cognito, then sign in again.');
  }
  return { id: user.profile.sub, name: user.profile.name || user.profile.email || 'Student',
    email: user.profile.email || '', role: 'student', active: true };
}

const CALLBACK_FIELDS = ['code', 'state', 'error', 'error_description', 'error_uri', 'session_state', 'iss'];
export function cleanCallbackUrl(href) {
  const url = new URL(href);
  CALLBACK_FIELDS.forEach(key => url.searchParams.delete(key));
  return `${url.pathname}${url.search}${url.hash}`;
}

export function createCognitoAuth({ config, storage = window.sessionStorage, location = window.location,
  history = window.history, manager, client, navigate = url => location.assign(url) }) {
  if (!config.configured) {
    const fail = async () => { throw new Error(config.message); };
    return { configured: false, message: config.message, initialize: async () => null, subscribe: () => () => {},
      signIn: fail, register: fail, recoverPassword: fail, signOut: async () => {}, getAccessToken: async () => null,
      clearSession: async () => {} };
  }
  const settings = oidcSettings(config, storage);
  manager ||= new UserManager(settings);
  client ||= new OidcClient(settings);
  let initialization, refreshTask;
  const refresh = async () => {
    if (!refreshTask) refreshTask = (async () => {
      try {
        const current = await manager.getUser();
        if (!current?.refresh_token) { await manager.removeUser(); return null; }
        return await manager.signinSilent(); // Refresh token, never iframe prompt=none.
      } catch { await manager.removeUser(); return null; }
      finally { refreshTask = null; }
    })();
    return refreshTask;
  };
  return {
    configured: true,
    initialize() {
      // StrictMode initializes effects twice. Consume each OAuth code once.
      initialization ||= (async () => {
        const href = location.href;
        const params = new URL(href).searchParams;
        if (params.has('code') || params.has('error')) {
          history.replaceState({}, '', cleanCallbackUrl(href));
          try { return await manager.signinRedirectCallback(href); }
          catch { await manager.removeUser(); throw new Error('Sign-in could not be completed. Please try again from ScholarRise.'); }
        }
        await manager.clearStaleState();
        const saved = await manager.getUser();
        return saved?.expired ? refresh() : saved;
      })();
      return initialization;
    },
    subscribe(onUser, onError) {
      const loaded = user => onUser(user);
      const unloaded = () => onUser(null);
      const expiring = () => { void refresh().then(user => { if (!user) onError('Your session expired. Please sign in again.'); }); };
      manager.events.addUserLoaded(loaded); manager.events.addUserUnloaded(unloaded);
      manager.events.addAccessTokenExpiring(expiring); manager.events.addAccessTokenExpired(expiring);
      return () => { manager.events.removeUserLoaded(loaded); manager.events.removeUserUnloaded(unloaded);
        manager.events.removeAccessTokenExpiring(expiring); manager.events.removeAccessTokenExpired(expiring); };
    },
    async signIn() { await manager.signinRedirect({ nonce: crypto.randomUUID() }); },
    async register() {
      const request = await client.createSigninRequest({ request_type: 'si:r', nonce: crypto.randomUUID() });
      const url = new URL(request.url); url.pathname = '/signup'; navigate(url.href);
    },
    async recoverPassword() {
      const request = await client.createSigninRequest({ request_type: 'si:r', nonce: crypto.randomUUID() });
      const url = new URL(request.url); url.pathname = '/forgotPassword'; navigate(url.href);
    },
    async signOut() {
      try { await manager.revokeTokens(['refresh_token']); } catch { /* Local logout still succeeds. */ }
      await manager.removeUser();
      const url = new URL(`${config.domain}/logout`);
      url.searchParams.set('client_id', config.clientId); url.searchParams.set('logout_uri', config.logoutUri);
      navigate(url.href);
    },
    async getAccessToken() {
      let user = await manager.getUser();
      if (user?.expired || (user?.expires_in != null && user.expires_in < 30)) user = await refresh();
      return user && !user.expired ? user.access_token : null;
    },
    async clearSession() { await manager.removeUser(); },
  };
}
