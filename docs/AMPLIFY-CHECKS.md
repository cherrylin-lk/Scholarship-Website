# Local release checks: 15 November 2026

No AWS configuration changes, resource creation, deployment, commit or push were
performed. Existing React/CSS/logo assets were not changed in this preparation.

| Check | Result |
| --- | --- |
| JavaScript unit/configuration tests | 23 passed |
| Playwright auth, workspace, search and responsive tests | 15 passed |
| Playwright local Python API integration tests | 2 passed |
| Python backend tests with in-memory/AWS SDK stubs | 27 passed |
| `npm run build` with existing local configuration | Passed |
| Production configuration guard + build with documented Amplify variables | Passed |
| `npm audit --omit=dev` | 0 known production dependency vulnerabilities reported |
| Git whitespace/error check | Passed (Windows line-ending notices only) |

**Total: 67 tests passed, 0 failed.** Browser tests simulate Cognito; your separately
reported real local Cognito tests succeeded. Neither proves the future hosted build
works until it is deployed and checked on its production URL.

The local Python test server logged a Windows connection-aborted message when a
browser cancelled a request; both API tests passed. On this Windows environment,
Playwright server teardown needed stopping the test-owned local servers after test
completion. Both runners then returned exit code 0. No existing user preview server
was stopped.

The working-tree/index candidate scan checked 65 text files at the time of the scan
for AWS key patterns, private keys, JWT literals, common provider tokens and literal
credential assignments. No real secrets were found. Six candidate assignments in
test files were confirmed to be synthetic test/stub values. No credential/env/private
key/dependency/build paths were tracked or among unignored candidates. `.env.local`
and representative credential, browser-artifact and student-export paths match ignore
rules. This is a scoped pattern review, not a guarantee against every possible secret
or a full Git history audit. Later changes must be reviewed again.

Authentication checks covered invalid callbacks, unverified email, denied `/me`
responses, legacy session rejection, stored role tampering, PKCE, signup/recovery,
session refresh/restoration and logout. The public default is student; staff access
requires a trusted account API. Browser mock data remains editable and is unsuitable
for confidential student records.

Follow [the deployment guide](AMPLIFY-PRODUCTION.md) to configure the **existing**
Amplify app manually when you choose to release. Console allowlists, rewrites and
build-image settings were not remotely inspected or changed.
