# ScholarRise local backend test results

Verified on **14 November 2026**, Asia/Bangkok.

**27 automated tests passed; 0 failed; 0 errors; 0 skipped.**
An additional **13 local HTTP checks passed; 0 failed**. These are reported separately from the automated test count.

No AWS resources were deployed or created. No website source was changed, no data was deleted, and no additional packages were needed. No test failures required a code fix.

## Environment

- Project Python interpreter: `.venv/Scripts/python.exe`, Python **3.13.3**.
- boto3 **1.44.3**, botocore **1.44.3**, cfn-lint **1.60.1** installed.
- `pip check`: **No broken requirements found**.
- Framework: built-in Python **unittest**. Pytest is not installed and is not required by the existing suite. Existing tests cover all requested scholarship operations, so no replacement pytest suite was added.
- The plain `python` command resolves to a Windows Store alias on this computer. Use the project interpreter in the commands below.

## Automated results

| Test module | Passed | Failed | Coverage |
| --- | ---: | ---: | --- |
| `tests/test_adapters.py` | 3 | 0 | Repository pagination, constrained S3 policy/downloads, student-only signup provisioning |
| `tests/test_api.py` | 8 | 0 | Discovery, authentication checks, private data, roles, ownership, moderation, recommendations, notifications, uploads and input validation |
| `tests/test_aws_repository.py` | 8 | 0 | Real boto3 operations with stubbed DynamoDB/S3 responses, Decimal updates, conditional conflicts, public details and stale-index handling |
| `tests/test_lambda_infrastructure.py` | 3 | 0 | Lambda entry point with mocked dependencies, invalid identity claims, template authorization/IAM checks |
| `tests/test_scholarship_models.py` | 5 | 0 | All four filters, all 15 non-empty filter combinations, levels, search, pagination, details and public field restrictions |
| **Total** | **27** | **0** | Subtests/filter combinations are included within these 27 tests, not counted as extra standalone tests |

For this verification run, `botocore.httpsession.URLLib3Session.send` was patched to raise an error if an AWS SDK HTTP request escaped the mocks. The entire suite still passed. Database tests use either `MemoryRepository` or boto3 with Botocore `Stubber`; SDK tests supply explicit dummy credentials and intercept service responses. S3 presigned policy generation is local signing, not an upload. No actual DynamoDB table or S3 bucket was accessed.

Authentication tests check missing/expired/invalid claim context, wrong issuer/client/token type, inactive accounts, staff role restrictions, university ownership and student privacy. They simulate API Gateway's verified claims. They do **not** perform real Cognito login or verify a JWT signature against live Cognito signing keys. That is a separate future cloud integration test.

## HTTP checks

A temporary instance of `backend/local_server.py` was started on `127.0.0.1:8000`, exercised, then stopped. It used only synthetic in-memory fixtures. All requests went to loopback.

| Check | Expected / actual | Result |
| --- | --- | --- |
| Health | 200 | Pass |
| Scholarship listing | 200, 2 records | Pass |
| Thailand country filter | 200, 1 record | Pass |
| PhD study-level filter | 200, 1 record | Pass |
| Local Example University filter | 200, 2 records | Pass |
| Fully Funded filter | 200, 1 record | Pass |
| Japan + Master's + university + Fully Funded | 200, 1 record | Pass |
| Scholarship details | 200, correct record ID | Pass |
| Missing scholarship | 404 | Pass: correct rejection |
| `/me` without identity | 401 | Pass: correct rejection |
| `/me` as offline student | 200 | Pass |
| `/admin/users` as offline student | 403 | Pass: correct permission enforcement |
| `/admin/statistics` as offline admin | 200 | Pass |

## Repeat the tests yourself

Open a PowerShell terminal in VS Code and run:

```powershell
Set-Location 'D:\SIIT\Cloud Project\Scholarship Website'
$env:PYTHONPATH="$PWD\backend"
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

Each successful test prints `ok`. The final output should say `Ran 27 tests` and `OK`. A failure would appear as `FAIL` or `ERROR` with an explanation; none occurred in this run.

If dependencies need reinstalling on another machine:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
```

## Open the API in your browser

Start the offline server from the project root:

```powershell
.\.venv\Scripts\python.exe backend/local_server.py
```

Leave this terminal running and open:

- http://127.0.0.1:8000/health
- http://127.0.0.1:8000/scholarships
- http://127.0.0.1:8000/scholarships?country=Thailand
- http://127.0.0.1:8000/scholarships/local-japan-award

JSON in the browser is the expected API response; this is not a second React website. Use the existing frontend separately as before. Stop the offline server with Ctrl+C. Changes made to its fixtures are lost when it stops.

For a protected request, use another PowerShell terminal or an API client such as Postman:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/me' -Headers @{Authorization='Bearer local-student'}
```

The `local-student`, `local-university` and `local-admin` fixture identities are supported only by this loopback runner. They are not Cognito tokens and do not work in the production Lambda handler. A browser address bar cannot add this Authorization header, so opening `/me` directly should show a 401 response.

The Lambda entry point is `scholarrise.handler.lambda_handler`; existing tests invoke it directly with mocked dependencies. You do not need a local Lambda deployment because the HTTP runner is already available.

## What still needs work

- Real AWS resources, credentials/roles, API configuration and live integration tests have not been created/run. DynamoDB persistence, Cognito signing keys, S3 access, CloudWatch delivery and Amplify hosting are not established by these local tests.
- The normal frontend still uses browser-local demo authentication/private dashboards. Full Cognito-backed UI authentication and private API integration remain future steps; optional API discovery is already prepared.
- The Cognito client adapter does not yet provide complete MFA/challenge, password recovery or automatic session renewal UI.
- Reminders are in-app and generated on request; no background/email/push delivery exists.
- Advisor/researcher workflows, production file malware scanning, load tests and large-catalog query optimizations are not implemented.

**Conclusion:** the existing backend works locally for the tested workflows with mocked AWS. This is successful local testing, not proof of a real AWS deployment.
