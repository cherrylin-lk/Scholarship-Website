# ScholarRise Python backend: first implementation

This folder contains working Python source, not just an architecture plan. **No endpoints are deployed and no AWS services are connected.** The existing React website, theme, logo and default mock/browser-storage behavior are unchanged by this implementation step.

## 1. Set up Python

Open a VS Code terminal at the project root (`Scholarship Website`), not inside `backend`.

Use Python 3.13. If Windows sends `python` to the Microsoft Store, select the installed interpreter in VS Code or use `py -3.13` for the first command.

```powershell
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r backend/requirements-dev.txt
```

If `.venv` already exists, skip recreating it. Runtime dependencies are in `requirements.txt`. Development requirements add the infrastructure validator; the test runner itself is Python's built-in `unittest`. No database server, AWS account, AWS keys or Docker is needed for these offline tests.

## 2. Run the automated backend tests

From the project root:

```powershell
$env:PYTHONPATH="$PWD\backend"
.\.venv\Scripts\python.exe -m unittest discover -s backend/tests -v
```

The tests use both an in-memory repository and the real boto3 SDK with **Botocore Stubber** intercepting AWS calls. SDK tests supply fixed dummy credentials internally so boto3 does not search for a real profile or instance credentials. Unexpected AWS requests fail the tests; no DynamoDB table or S3 bucket is created.

Coverage includes:

- All 15 non-empty combinations of country, study level, university and funding filters; keyword search; multi-level eligibility; empty results and stable pagination.
- Public details and facets expose approved/published listings only. Stale DynamoDB index entries are checked against the current base record before exposure.
- Consistent DynamoDB reads, multi-page Query results, conditional writes, conflict responses and nested Decimal values on read/edit/write.
- Protected endpoints reject absent/invalid authorizer context, wrong token use/client/issuer, expiry and invalid subjects. Backend roles and ownership cannot be chosen through request bodies.
- Student data isolation, university ownership, administrator moderation, student-only self-registration and document reapproval.
- Real Lambda entry-point wiring, infrastructure authorization rules, and locally generated S3 policies/version-specific downloads.

These are offline contract/security tests. They do **not** prove that Cognito signatures, IAM policies, DynamoDB persistence or S3 access work in a deployed AWS account; those need a future configured development stack.

## 3. Start the offline API

```powershell
.\.venv\Scripts\python.exe backend/local_server.py
```

Leave this terminal open. It serves only on `http://127.0.0.1:8000`, with synthetic records kept in memory. Data resets when stopped. Press Ctrl+C to stop. The Lambda deployment handler is **not** this local server.

In another terminal, test public search:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/scholarships'
Invoke-RestMethod 'http://127.0.0.1:8000/scholarships?country=Japan&level=Master%27s&university=Local%20Example%20University&funding=Fully%20Funded'
Invoke-RestMethod 'http://127.0.0.1:8000/scholarships/local-japan-award'
```

The combined search should return only `Sample Japan Graduate Award`. All selected filters use AND matching. Exact country/university/funding selections are case-sensitive; keyword matching is case-insensitive. Query names are `country`, `level`, `university`, `funding`, `query`, `limit` and `offset`. Responses contain `items`, `total`, `nextOffset` and `facets`.

Study levels: `Bachelor's`, `Master's`, `PhD`. Funding types: `Fully Funded`, `Partially Funded`, `Tuition Waiver`, `Fixed Amount`.

Test a protected endpoint with an **offline fixture identity**:

```powershell
Invoke-RestMethod 'http://127.0.0.1:8000/me' -Headers @{Authorization='Bearer local-student'}
```

The local runner also recognizes `local-university` and `local-admin`. These are **not Cognito tokens** and are recognized only by the loopback development runner. The deployed Lambda never accepts them. Without authentication, `/me` returns 401; a student calling `/admin/users` returns 403.

Do not expose the fixture runner on a public address, tunnel, LAN interface or AWS Lambda. Keep your React frontend in its normal demo mode for this first task. Optional API preview instructions already exist in the main backend guide, but no switch is necessary to test the Python API.

## 4. Understand the code

| File | Job |
| --- | --- |
| `scholarrise/handler.py` | Real Lambda entry point: `scholarrise.handler.lambda_handler`; clients initialized at runtime |
| `scholarrise/app.py` | API Gateway HTTP API v2 requests, responses, protected workflow handlers and safe logging |
| `scholarrise/models.py` | Validated scholarship draft, public response allowlist, and typed search filters |
| `scholarrise/scholarships.py` | Public scholarship discovery/detail repository operations |
| `scholarrise/repository.py` | boto3 DynamoDB operations, conditional writes, numeric conversion and in-memory adapter |
| `scholarrise/validation.py` | Bounded inputs, canonical study/funding values, dates, GPA and HTTPS links |
| `scholarrise/auth.py` | Cognito authorizer context, current server role/activation and ownership |
| `scholarrise/provision.py` | Cognito post-confirmation preparation: self-registration can only create a student |
| `scholarrise/storage.py` | S3 upload policy, uploaded-file checks and version-pinned attachment download |
| `fixtures/scholarships.json` | Synthetic offline catalog; never automatically imported to AWS |
| `tests/` | Domain, mocked-SDK, Lambda and infrastructure tests |

The public handlers are `GET /scholarships` and `GET /scholarships/{id}`. Health is `GET /health`. All protected routes authenticate before role checks. API Gateway is configured to verify Cognito JWT signatures; Lambda validates the trusted forwarded claims and reads the current account from DynamoDB. Decoding a browser token or hiding a button is not backend authorization. No AWS credentials are placed in React.

Scholarship edits use the `ScholarshipDraft` data model; ownership/institution, IDs, publication and approval fields are server-controlled. Only approved and published records reach public responses. Updates carry a `version`; stale edits return 409 rather than overwrite concurrent changes.

**Small-catalog limitation:** public filtering currently queries approved candidates and evaluates filters before slicing pages; it is not a full-text search engine. The foundation is suitable for local/project testing. Further access-pattern/index work and load testing are needed before claiming large-scale performance.

## 5. Validate infrastructure without deploying

The existing `infrastructure/template.json` is an AWS SAM/CloudFormation template for API Gateway, Python Lambda, DynamoDB, Cognito, S3, restricted IAM roles and CloudWatch. It includes JWT-protected private routes and explicit public GET exceptions. Logs exclude request bodies and tokens; alarms cover Lambda execution errors and HTTP API 5xx responses. No SNS service is introduced. `amplify.yml` remains the frontend build configuration.

With Node available on PATH:

```powershell
node infrastructure/generate-template.cjs
.\.venv\Scripts\cfn-lint.exe infrastructure/template.json
```

These commands only generate/validate local files. Do **not** run `sam deploy` for this step. `backend/.env.example` lists configuration names supplied by the future SAM deployment; the offline runner does not load or need them. The templates do not mean any resource already exists.

## Next step — stop here before cloud setup

First run the tests and the three public API commands above. Check that search/details work and protected endpoints deny unauthorized requests. Keep the React demo running as before.

After that, the next development milestone is configuring a dedicated development Cognito pool and API endpoint **only when explicitly authorized**, then testing real access tokens and connecting authentication incrementally. DynamoDB table names, Cognito IDs/issuer, S3 bucket, API URL/origin and CloudWatch logs still require actual AWS provisioning/configuration and live verification. Amplify needs a later GitHub/hosting setup. No configuration of these services was performed by this task.

See [the complete endpoint/table guide](../docs/BACKEND-FOUNDATION.md) and [future AWS deployment instructions](../docs/AWS-DEPLOYMENT.md). The latest DES424 Word report remains the authoritative project specification.

SDK references: [Botocore Stubber](https://docs.aws.amazon.com/botocore/latest/reference/stubber.html), [boto3 DynamoDB numeric serialization](https://docs.aws.amazon.com/boto3/latest/_modules/boto3/dynamodb/types.html), [HTTP API CloudWatch metrics](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-metrics.html).
