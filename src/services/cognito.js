/** Cognito public app-client adapter; no AWS access key or client secret.
 * Not yet connected to the demo login dialog. Tokens are held in memory.
 */
export function createCognitoAuth({ region, clientId, fetchImpl = fetch }) {
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region || '') || !clientId) throw new Error('Cognito region and public app client ID are required.');
  let session = null;
  async function call(operation, body) {
    const response = await fetchImpl(`https://cognito-idp.${region}.amazonaws.com/`, {
      method: 'POST', headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': `AWSCognitoIdentityProviderService.${operation}` }, body: JSON.stringify({ ClientId: clientId, ...body }),
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.message || 'Cognito request failed.');
    return result;
  }
  function accept(result) {
    if (!result.AuthenticationResult) throw new Error('Additional Cognito sign-in challenge requires completion; this adapter does not yet handle it.');
    session = { ...result.AuthenticationResult, expiresAt: Date.now() + result.AuthenticationResult.ExpiresIn * 1000 };
    return { signedIn: true };
  }
  return {
    register: (email, password, name) => call('SignUp', { Username: email, Password: password, UserAttributes: [{ Name: 'email', Value: email }, { Name: 'name', Value: name }] }),
    confirmRegistration: (email, code) => call('ConfirmSignUp', { Username: email, ConfirmationCode: code }),
    signIn: async (email, password) => accept(await call('InitiateAuth', { AuthFlow: 'USER_PASSWORD_AUTH', AuthParameters: { USERNAME: email, PASSWORD: password } })),
    getAccessToken: async () => {
      if (!session || Date.now() >= session.expiresAt - 30000) return null; // Explicit re-login for this foundation.
      return session.AccessToken;
    },
    signOut: async () => {
      const token = session?.AccessToken;
      session = null;
      if (token) {
        // GlobalSignOut expects an access token, not ClientId.
        const response = await fetchImpl(`https://cognito-idp.${region}.amazonaws.com/`, { method: 'POST', headers: { 'Content-Type': 'application/x-amz-json-1.1', 'X-Amz-Target': 'AWSCognitoIdentityProviderService.GlobalSignOut' }, body: JSON.stringify({ AccessToken: token }) });
        if (!response.ok) throw new Error('Local sign-out complete; server sign-out failed.');
      }
    },
  };
}
