import { createCognitoAuth, readCognitoConfig, verifiedIdentity } from './cognito.js';
import { createApi } from './api.js';

export const authConfig = readCognitoConfig(import.meta.env, window.location);
export const authClient = createCognitoAuth({ config: authConfig });

// Staff roles require an actual Cognito-protected backend /me response.
export const accountApi = import.meta.env.VITE_ACCOUNT_API_BASE_URL
  ? createApi({ baseUrl: import.meta.env.VITE_ACCOUNT_API_BASE_URL, getAccessToken: () => authClient.getAccessToken() }) : null;

export async function resolveAccount(oidcUser) {
  const identity = verifiedIdentity(oidcUser);
  if (!identity) return null;
  if (!accountApi) return identity;
  const account = await accountApi.me();
  if (account.userId !== identity.id || account.active !== true || !['student', 'university', 'admin'].includes(account.role)) {
    throw new Error('Account access could not be verified. Contact your administrator.');
  }
  return { ...identity, name: account.name || identity.name, version: account.version,
    role: account.role, university: account.university || '', profile: account.profile || {} };
}
