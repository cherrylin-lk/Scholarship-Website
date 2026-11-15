# ScholarRise Cognito integration

The existing React design and scholarship catalog are preserved. Login now uses
`oidc-client-ts` and Cognito authorization code flow with S256 PKCE. Register opens
Cognito signup; Cognito handles email confirmation and password recovery. No AWS
resources have been deployed or changed by this integration.

## 1. Check your existing AWS Console settings

Open Amazon Cognito in **ap-southeast-2**, select your existing pool
`ap-southeast-2_ONSDhlqBo`, then your SPA client
`4tdlqbsg2jrr3qvbj5atjh7qig`. Use this existing managed login domain:
`https://ap-southeast-2onsdhlqbo.auth.ap-southeast-2.amazoncognito.com`.

- The SPA client must be public, without a client secret.
- Enable authorization code grant and scopes `openid`, `email`, `profile`.
- Keep `https://main.d1s9suck9hx25r.amplifyapp.com/` in both allowed callback
  URLs and allowed sign-out URLs.
- Add **`http://localhost:5173/`** to both lists for local testing. The port,
  hostname, path and trailing slash must match exactly.
- Enable email self-registration, email verification and email account recovery
  if these are not already enabled. Check email delivery settings. Do not enable
  public selection of administrator or university roles.

These are settings to check yourself; this code does not modify AWS.

## 2. Run locally

Your supplied public identifiers are configured in the ignored `.env.local` file.
They are configuration, not AWS credentials. `.env.example` documents the keys.
Never add AWS keys, passwords, tokens or a client secret to any `VITE_` variable.

From the project folder in PowerShell:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
npm.cmd run dev -- --host localhost --port 5173 --strictPort
```

Open **http://localhost:5173/**. Stop an older server using that port first if
necessary. Restart Vite after changing environment variables.

1. Click Register. Cognito should show its signup page. Use your own test account,
   complete email verification, and return to ScholarRise.
2. Click Login and sign in. My workspace should appear.
3. Reload: the session should restore in that browser tab.
4. Click Log out: Cognito should return to ScholarRise with Login visible.
5. In Incognito, sign in with the same Cognito account. Authentication should work;
   browser-local profiles, saved awards and tracking will still be separate.
6. Try Forgot password in the footer or on Cognito's login page. Complete the
   email recovery flow on Cognito.

Real email delivery and your live Cognito client configuration still require this
manual check. Automated tests simulate the provider and do not prove AWS connectivity.

## 3. Repeat automated checks

```powershell
npm.cmd test
npm.cmd run test:e2e
$env:PYTHON = "$PWD\.venv\Scripts\python.exe"
npm.cmd run test:e2e:api
npm.cmd run build
```

Playwright uses synthetic identifiers and intercepted provider responses, including
the code exchange and PKCE check. It never registers real users. Browser tests run
on port 5175; the separate local API tests use port 5174. Install Chrome if missing.
The API tests also require the existing Python virtual environment and backend
development dependencies (see `backend/README.md`).

## Identity, roles and remaining backend work

The authenticated account ID is Cognito `sub`. Old local passwords, demo login
buttons and browser session IDs are no longer accepted for authentication. Existing
demo records are retained; they are not automatically migrated or associated by
email. Do not upload legacy password hashes to Cognito.

Without `VITE_ACCOUNT_API_BASE_URL`, every verified Cognito user opens the student
workspace. Neither stored roles nor group claims grant staff access. To enable staff
dashboards, configure a real API Gateway JWT-protected backend `/me` response with
`userId` matching `sub`, `active: true`, and the server-assigned `role` (`student`,
`university`, or `admin`). Failed account checks deny access. Backend authorization
and ownership checks remain mandatory for every protected operation.

Stage 1 production discovery uses the deployed scholarship API; workspace records still use the existing browser data layer. See `STAGE-1-API-DISCOVERY.md`.
Cognito makes identity available across browsers; it does not synchronize these
records. Sessions and OIDC transaction state use sessionStorage. Tokens remain
JavaScript-accessible, so preventing XSS remains important. Refresh tokens restore
unexpired sessions and refresh access tokens; failed refresh signs the user out.
Logging out revokes the refresh token when possible and clears the local session.

Before connecting the backend, configure its JWT issuer for this existing pool,
its audience for this client, CORS for the exact frontend origins, and provision
student records safely. The SAM template now references the existing pool/client and requires `openid` for
protected API routes. See `AWS-DEPLOYMENT.md` for provisioning, permissions and the
pre-deployment review. The user has since confirmed backend deployment; private account integration and student provisioning remain Stage 2 work.

For Amplify later, add the public environment variables in Hosting configuration
and rebuild only after testing and approval. `.env.local` is ignored and will not
be uploaded through Git. No push, deployment, duplicate pool or paid resource has
been created as part of this change.
