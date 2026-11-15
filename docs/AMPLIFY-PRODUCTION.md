# ScholarRise: prepare the existing Amplify app

Stage 1 prepares **AWS scholarship discovery with real Cognito login and browser-local workspace data**. See [the Stage 1 guide](STAGE-1-API-DISCOVERY.md) for the current scope and Stage 2 prerequisites.
Your successful local registration, verification, login, logout and Incognito tests
confirm the existing Cognito setup works locally. The updated Amplify build still
needs its own post-deployment check. No AWS resources, Git commits, pushes or
deployments were created during this preparation.

## 1. Set production environment variables

In the **existing** Amplify app, select Hosting > Environment variables (the console
may label this under App settings). Add these values for the `main` branch:

| Variable | Production value |
| --- | --- |
| `VITE_COGNITO_REGION` | `ap-southeast-2` |
| `VITE_COGNITO_USER_POOL_ID` | `ap-southeast-2_ONSDhlqBo` |
| `VITE_COGNITO_CLIENT_ID` | `4tdlqbsg2jrr3qvbj5atjh7qig` |
| `VITE_COGNITO_DOMAIN` | `https://ap-southeast-2onsdhlqbo.auth.ap-southeast-2.amazoncognito.com` |
| `VITE_COGNITO_REDIRECT_URI` | `https://main.d1s9suck9hx25r.amplifyapp.com/` |
| `VITE_COGNITO_LOGOUT_URI` | `https://main.d1s9suck9hx25r.amplifyapp.com/` |
| `VITE_DISCOVERY_SOURCE` | `api` |
| `VITE_API_BASE_URL` | `https://1wirfnp4a7.execute-api.ap-southeast-2.amazonaws.com` |

The same public values are in `deployment/amplify-environment.json` for reference.
Amplify does **not** automatically read this JSON file; enter the variables in its
console. Region, pool, client, domain and URLs are public identifiers. They are not
AWS credentials. Every `VITE_` value is visible in downloaded JavaScript. Never enter
an AWS secret key, password, access/refresh token or client secret in these fields.

Set `VITE_API_BASE_URL` exactly as above and leave `VITE_ACCOUNT_API_BASE_URL` **unset**.
The Stage 1 guard permits the deployed public discovery API and blocks private
account APIs until users are provisioned. Do not use localhost URLs for Amplify.

Vite injects variables at build time: changing Amplify variables requires a new
build before browsers see the changes. Existing process variables override local
env files. See [Vite environment documentation](https://vite.dev/guide/env-and-mode).

## 2. Keep localhost separate

Keep your working `.env.local` on your computer and out of Git. Locally, leave
`VITE_COGNITO_REDIRECT_URI` and `VITE_COGNITO_LOGOUT_URI` blank/unset so they default
to `http://localhost:5173/` when that is the URL you open. Do not copy the production
callback overrides into your local file. Restart Vite after local variable changes.

In the existing Cognito SPA app client, keep **both** exact URLs in the allowed
callback list **and** allowed sign-out list:

- `https://main.d1s9suck9hx25r.amplifyapp.com/`
- `http://localhost:5173/`

Keep code grant with PKCE, scopes `openid email profile`, and a public SPA client
without a secret. Your local test proves the localhost flow; this repository review
cannot read or verify your saved AWS Console settings. Check the production entries
there before deployment. Do not add a wildcard callback. Other Amplify branches,
preview URLs or a future custom domain require their own approved exact URLs and
branch-specific environment settings. This release guard targets `main` only.

## 3. Build settings

Use the repository's root `amplify.yml`, with the repository root as the app root:

1. Use the Amplify Amazon Linux 2023 build image and Node.js **24** (Build settings >
   Build image settings / Live package updates). `nvm use 24` in the build spec
   selects it; if unavailable, configure/install that version through build settings.
2. `npm ci` installs exactly the lockfile versions.
3. `npm run check:production` rejects missing/wrong release settings, localhost
   callbacks, incorrect discovery URLs, premature account APIs and obvious sensitive `VITE_` variable names. It
   does not contact AWS or verify Console allowlists.
4. `npm test` checks models, services, Cognito and production configuration.
5. `npm run build` creates `dist/`; Amplify publishes only that folder.

There is no backend build phase and no infrastructure deployment command. The backend SAM template now references the existing pool/client and correct scopes.
It still requires the separate review in `AWS-DEPLOYMENT.md`; do not deploy a backend
as part of a frontend-only release.

## 4. Apply the SPA rewrite manually

In the existing Amplify app, open Hosting > Rewrites and redirects > Manage redirects
and use the rule in **`deployment/amplify-rewrites.json`**. Inspect existing rules
before merging it: preserve any intentional domain redirects, but remove conflicting
SPA catch-all redirects which discard query strings. The provided rule uses status
**200 (Rewrite)**, target `/index.html`, and excludes static asset extensions.

The JSON is a console input reference; `amplify.yml` does **not** automatically apply
it. A public `_redirects` file is not used for Amplify. The current OAuth callback
is `/`, which normally serves index.html already; the rewrite also supports future
client routes. Keep OAuth `code` and `state` parameters intact until React consumes
them. Avoid 301/302 redirects from the callback URL to a clean URL. The auth code
cleans those parameters after receiving them.

See [AWS SPA rewrite instructions](https://docs.aws.amazon.com/amplify/latest/userguide/redirect-rewrite-examples.html)
and [Amplify build settings](https://docs.aws.amazon.com/amplify/latest/userguide/build-settings-configuration.html).

## 5. Review Git, then deploy only when you choose

`.gitignore` excludes `.env.local`, environment files (except reviewed `.env.example`),
AWS credential folders, private keys, generated builds, dependencies, browser traces,
saved browser authentication and common student export folders. Public configuration
JSON is intentionally included. Ignore rules do not detect a password pasted into
an ordinary source file: review changes before committing and never commit browser
storage exports, tokens, passwords or student records.

From the project root in PowerShell, repeat the checks:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
npm.cmd test
npm.cmd run test:e2e
$env:PYTHON = "$PWD\.venv\Scripts\python.exe"
npm.cmd run test:e2e:api
npm.cmd run build
$env:PYTHONPATH = "$PWD\backend"
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -q
git status --short
git diff --check
git check-ignore .env.local
```

`check:production` is intended for Amplify's supplied environment and does not load
`.env.local`. To check the reference configuration/build locally without editing it,
use a **separate PowerShell terminal**, then close that terminal afterwards:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
$config = Get-Content deployment/amplify-environment.json -Raw | ConvertFrom-Json
foreach ($property in $config.PSObject.Properties) {
  Set-Item -LiteralPath "Env:$($property.Name)" -Value $property.Value
}
$env:VITE_ACCOUNT_API_BASE_URL = ''
npm.cmd run check:production
npm.cmd run build
```

That production build intentionally refuses local sign-in when previewed on
localhost because the callback origin differs. Use your ordinary local build/dev
server for local login. The production URL mapping is separately unit-tested.

When you approve release, review and commit the intended source/configuration files
and push to the connected private GitHub branch yourself. **A push to a connected
branch can start Amplify deployment automatically.** If you need a review interval,
disable auto-build first. Do not push until ready. Set the variables and rewrite
before starting the approved build. No new Amplify app or backend resources are needed.

## 6. Test the hosted release

After the approved deployment, open the production URL in a normal window and
Incognito. Check Register, email confirmation, Login, reload/session restoration,
Logout and Forgot password. Check scholarship filters/details and mobile layout.
The callback must stay on the HTTPS production root and remove OAuth parameters
after processing. Check that logo/CSS/JS assets load normally and refreshing a
client route serves the SPA rather than a 404. Do not share callback URLs or tokens.

If sign-in reports a redirect mismatch, compare the exact console URL and branch
variables, including the final slash. If the build guard fails, correct the named
variable; do not disable the guard to hide a configuration error. If needed, use
Amplify's previous successful deployment to roll back through the console.

## Security limits and unfinished production features

- Old local registration/password checking and demo-role login are disconnected.
  The old password utility remains for compatibility/tests and is not an auth path.
- Public Cognito users default to student. Browser-stored roles and Cognito group
  claims do not grant staff access. A configured trusted `/me` API must verify `sub`,
  enabled status and server-assigned role. Each backend action must still enforce
  roles and ownership; a hidden dashboard is not a security boundary.
- Stage 1 connects public discovery only. Profiles, saves, tracking,
  moderation and reminders still use browser mock data. They can be modified locally,
  are not confidential between people sharing browser storage, and do not sync across
  browsers. Do not accept real student records/documents or treat mock administration
  as authoritative production management.
- OIDC tokens are stored in sessionStorage and are JavaScript-accessible. Protect
  against XSS, keep dependencies patched and avoid third-party scripts. No production
  Content Security Policy has been enforced/tested in this preparation. Consider a
  tested CSP and monitoring before opening the full system to real student data.
- Frontend static hosting does not configure API Gateway JWT authorization, backend
  DynamoDB, private S3 documents or CloudWatch application logging. Those remain a
  separate implementation/configuration phase. No secrets are needed in this SPA.

This is prepared for a controlled Stage 1 discovery release after the console settings are
confirmed, not a claim that the complete multi-user backend is production-ready.
