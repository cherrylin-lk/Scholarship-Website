# Stage 2: student data integration (local changes, not deployed)

The user verified protected `/me` from the Amplify origin with a provisioned student
and confirmed preflight 204. This change connects existing student views to the
already deployed backend. It does not change AWS services or settings, infrastructure,
Cognito resources, CSS, images, branding or navigation. No commit/push/deploy is run.

## Production configuration for a later approved release

Keep all existing Cognito variables and `VITE_DISCOVERY_SOURCE=api` unchanged.
Both API URLs must be exactly:

```text
VITE_API_BASE_URL=https://1wirfnp4a7.execute-api.ap-southeast-2.amazonaws.com
VITE_ACCOUNT_API_BASE_URL=https://1wirfnp4a7.execute-api.ap-southeast-2.amazonaws.com
```

The account URL is the only new Amplify setting. **It has not been changed remotely.**
The production guard now requires that exact account URL. Do not rebuild the hosted
site until ready to enable it. Every Cognito user accessing a workspace must already
have an active, correct-role UsersTable record keyed by Cognito `sub`. Public signup
alone does not guarantee provisioning. Missing/inactive accounts are denied; no local
student or staff-role fallback is used. University/admin views remain present, but
their management operations are still the existing local demonstration functionality.

The ignored `.env.local` remains unchanged. For local cloud-mode testing, configure
both APIs and `api` discovery deliberately; the backend must separately allow your
localhost origin. Do not weaken production CORS. Offline browser tests below use
synthetic providers and intercepted APIs, so need no real credentials or CORS change.
Demo development remains available when protected student mode is not enabled.

## Implemented behavior

- Account/profile identity and role come from authenticated `/me`, matched to the
  verified Cognito subject. Profile form values come from backend data, never the
  old local profile. `Undergraduate` maps to `Bachelor's`; ambiguous `Postgraduate`
  is rejected so a user must choose Master's or PhD explicitly. GPA/form booleans
  are normalized and only allowlisted profile fields plus version are submitted.
- Profiles use `PUT /me/profile`. The server's new version replaces the old one.
  HTTP 409 reloads current data and asks for review; it never resubmits automatically.
- Saved scholarships use GET `/me/saved` and PUT/DELETE `/me/saved/{id}`. API cards
  and the details modal now enable Save for signed-in students after data loads.
  Guests are directed to Cognito instead of creating local API bookmarks.
- Application tracking uses GET/PUT/DELETE `/me/applications/{id}` (GET collection
  is `/me/applications`). New records omit version, edits include the current version.
  Status saves on change. **Notes save when leaving the notes field**; wait for saving
  to finish before navigation/logout. Record removal uses the existing confirmation.
  Unavailable scholarship IDs keep a placeholder row so existing tracking is not lost.
- Network/validation/conflict failures keep an explicit Retry workspace state, not
  demo data. Failed or ambiguous mutations can be reconciled by reloading the server.
  Controls are disabled while loading/saving or waiting for retry.
- Cloud records are held only in session memory. They are not persisted in the
  browser's demo localStorage and are not silently uploaded from it. Logout/identity
  changes clear private state immediately. Epoch guards discard old responses;
  session-scoped transport checks stop a pending token-refresh request from sending
  old form data after a user switch. Every returned private owner/identity is checked.
  Backend authorization remains essential; frontend guards do not replace it.
- Existing recommendations are calculated locally using the remote catalog and
  server profile. In-app reminders use remote saved/tracked IDs and server preferences.
  Preferences save via profile PUT after a valid study level is present. Dismissals
  are **session-local**, lost on reload, and never overwrite server notification data.

## Not completed or changed

No email/push/background reminders or real university application submission.
Backend recommendation/notification routes are not wired into these views yet;
current in-browser algorithms may differ from server ranking. No automatic import
of legacy browser profiles/bookmarks/tracking. No staff-management API migration.
No new-user auto-provisioning change. Profile updates currently require a supported
study level even when changing reminder preferences. Keep fictional test data only.

## Local verification results

On 15 November 2026: 35 unit tests, 15 demo/auth/responsive browser tests,
5 public/local-API browser tests and 6 student browser tests passed (61 total,
0 remaining failures). Production configuration validation and `npm run build`
passed. The CSS output hash remained unchanged. Early browser runs exposed test
selector/navigation timing issues; selectors and fresh-context setup were corrected,
and simulated auth tests now block external font requests. No real AWS student data
was changed. The existing uncommitted preflight/backend corrections and low-cost
proposal files were preserved, not edited by Stage 2.

## Repeat local checks

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
npm.cmd test
npm.cmd run test:e2e
$env:PYTHON = "$PWD\.venv\Scripts\python.exe"
npm.cmd run test:e2e:api
npm.cmd run test:e2e:student
```

The student browser suite on port 5176 uses an in-memory mock API per test and
simulated Cognito, covering profiles, save/track persistence across reload and a new
browser context, no local upload, conflicts, expiry/refresh, missing accounts,
logout, identity separation and retry. No real AWS data is written by these tests.

For a production-configured build, use a separate PowerShell terminal and close it
afterwards so production callbacks do not affect local login:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
$config = Get-Content deployment/amplify-environment.json -Raw | ConvertFrom-Json
foreach ($property in $config.PSObject.Properties) {
  Set-Item -LiteralPath "Env:$($property.Name)" -Value $property.Value
}
npm.cmd run check:production
npm.cmd run build
```

After a later approved release, test with the provisioned fictional student: edit
profile, save a scholarship, track it, change status, edit notes and blur the field,
then reload, log out/in and repeat in Incognito. Verify data persists and another
student sees only their own records. Save/track persistence on live AWS has not been
claimed based on mocked tests. Do not share tokens, headers, HAR or browser storage.
