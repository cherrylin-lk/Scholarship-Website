# Stage 1: AWS scholarship discovery

The user confirmed the deployed stack `scholarrise-group9-backend` in
`ap-southeast-2`, HTTP 200 from `/health` and `/scholarships`, and two approved
fictional DynamoDB records. Stage 1 configures the existing frontend discovery
adapter for that API. It does not deploy or modify AWS, provision users or migrate
private workspaces. No React source, CSS, images, navigation or layout was changed.

## Settings to enter later in the existing Amplify app

| Variable | Value |
| --- | --- |
| `VITE_DISCOVERY_SOURCE` | `api` |
| `VITE_API_BASE_URL` | `https://1wirfnp4a7.execute-api.ap-southeast-2.amazonaws.com` |
| `VITE_ACCOUNT_API_BASE_URL` | **Unset** (remove any value) |

Keep **all existing `VITE_COGNITO_*` values unchanged**, including production
callback/logout URLs. `deployment/amplify-environment.json` contains the public
production reference; Amplify does not automatically import it. The updated build
guard permits only this production discovery URL and still rejects a private
account API. No credentials or tokens are added to frontend environment variables.

No Amplify settings were changed. A later approved rebuild is required for the hosted
site to use these variables. A push to its connected branch may automatically build,
so do not push until release is approved. No infrastructure deployment is needed.

## Existing frontend behavior

`src/main.jsx` already selects the discovery source. `src/services/discovery.js`
loads public API pages (`limit=100`, increasing offsets) and keeps the catalog in
React state. Existing country/level/university/funding/keyword controls filter that
catalog in the browser. This is suitable for the two fictional records. It does not
send each filter change to AWS, poll automatically, or seed more DynamoDB records.
Counts and dropdowns reflect available API data; destinations absent from the two
records will not appear. Details use the selected catalog record in the same modal.

The existing loading message, error alert and Retry button are reused unchanged.
API failure does not silently replace results with demo awards. Save/Track controls
on API listings remain disabled. The existing API-preview notice and other page copy
are unchanged to preserve the requested appearance; its reference to browser-demo
accounts means local workspace data, not a demo authentication bypass. Authentication
continues to use Cognito.

Other workspaces/features remain present and browser-local: profiles, demo saves,
recommendations, application tracking, reminders and staff dashboard management.
They do not become cloud-backed just because discovery is connected. Existing local
records are neither deleted nor automatically migrated. Do not treat local staff
management as authoritative backend administration.

## Local development and fallback

The existing ignored `.env.local` was deliberately left unchanged; it currently uses
demo discovery and retains the working local Cognito configuration. To exercise
AWS discovery later, set only the discovery source/API URL above in your local
environment and restart Vite. Keep local Cognito callback/logout overrides blank.
The AWS API must allow `http://localhost:5173` before a browser can call it from
that origin. Stage 1 does not alter CORS or any other AWS setting.

For development without AWS, use `VITE_DISCOVERY_SOURCE=demo`; the API URL is then
unused. Alternatively use `api` with `http://127.0.0.1:8000` and the existing Python
local server. Production guard restrictions do not change the development adapter.

## Repeat local verification

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
npm.cmd test
npm.cmd run test:e2e
$env:PYTHON = "$PWD\.venv\Scripts\python.exe"
npm.cmd run test:e2e:api
```

Browser tests use synthetic Cognito responses and local/intercepted scholarship
responses. They do not write to the deployed DynamoDB database. They check demo
features, two-record discovery, filters/details, loading, failure/retry, disabled
private actions, and Cognito login/restoration/logout without `/me` requests.

For a production-configured build, use a separate PowerShell terminal, then close it
before returning to local Cognito development:

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

The production callback is intentionally for Amplify, not localhost. Do not use that
build to test local login. No live browser-to-AWS CORS or protected API success is
claimed by these local tests. Before a later approved release, verify CORS headers
for the exact Amplify origin and confirm the two records appear in the hosted UI.

## Stage 2: exact remaining work (not implemented)

1. With professor authorization, read a dedicated existing confirmed Cognito test
   student's `sub`, then conditionally create their Users-table record with matching
   `userId`, `role: student`, `active: true`, `version: 1` and profile defaults.
   Preserve existing records/roles. This needs no Cognito pool/client/group change.
   Do not run `provision_staff.py --apply`: it also mutates Cognito groups.
2. Verify `/me` with that student's access token, backend ownership/role restrictions,
   invalid-token denial, and protected-request browser preflight. Do not log/share
   tokens. Enabling the account API before provisioning would deny workspace access.
3. Create a shared authenticated workspace API instance using the existing
   `authClient.getAccessToken()`. Enable `VITE_ACCOUNT_API_BASE_URL` only in that
   separately tested release and update its production guard/tests deliberately.
4. Replace local profile reads/writes with `/me` and `PUT /me/profile`. Keep server
   `version`, normalize form numbers/booleans, handle 409 conflicts, and stop cached
   local profile fields overriding server data. Update UI state from API responses.
5. Connect `/me/saved` and PUT/DELETE saved endpoints. Reconcile string scholarship
   IDs with the remote catalog, then enable Save controls for eligible students.
6. Connect GET/PUT/DELETE `/me/applications`. Preserve returned versions, omit version
   on new records, handle conflicts/expired awards, and resolve cards against the
   remote catalog rather than demo scholarships. Enable Track after this works.
7. Test persistence across reload, logout/login and Incognito; verify student isolation
   and failures without local-data fallback. Keep existing mock data until an explicit
   migration decision. Cloud recommendations, notifications and staff dashboard
   operations require their own UI wiring; they are not completed by steps 4-6.

New-student provisioning without changing Cognito also needs an approved ongoing
backend/operator workflow; the existing post-confirmation Lambda is not evidence
that a trigger has been attached. No Stage 2 account writes or code changes were
performed as part of Stage 1.
