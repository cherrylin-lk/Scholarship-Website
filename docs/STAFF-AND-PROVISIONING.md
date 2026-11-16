# Staff APIs and safe student provisioning preparation

Release status (user verified): the existing backend stack update is complete,
automatic confirmed-signup provisioning works, and the fictional university and
administrator accounts return `/me` 200 with their intended active roles. The
university is assigned `Fictional Test University`. This frontend release requires
no repeat backend deployment, trigger attachment, group change or staff provisioning.
The preparation/rollback instructions below are retained for reference, not actions
to run during publication. Live staff CRUD/moderation still needs a post-release test.

These are local, tested changes, not an AWS deployment. Existing Cognito pool
`ap-southeast-2_ONSDhlqBo`, SPA client `4tdlqbsg2jrr3qvbj5atjh7qig`, Amplify,
the five tables, IAM boundaries and original infrastructure settings are preserved.
The low-cost proposal is unused. No AWS command in this guide has been executed.

## What the frontend now uses

Production keeps the existing discovery and account API environment settings:
`https://1wirfnp4a7.execute-api.ap-southeast-2.amazonaws.com`. No new Vite settings.
Demo mode remains available for local development; cloud staff mode never imports
or uploads local demo records. Cognito groups are not trusted as application roles.
The authenticated `/me` DynamoDB role is checked before loading a staff workspace.

| Screen action | Existing backend endpoint |
| --- | --- |
| University list/create | GET/POST `/university/scholarships` |
| University edit | PUT `/university/scholarships/{id}` |
| University unpublish | POST `/university/scholarships/{id}/unpublish` |
| Admin catalog | GET `/admin/scholarships` |
| Approve/reject/unpublish | POST `/admin/scholarships/{id}/moderation` |
| Admin users | GET `/admin/users` |
| Enable/disable non-admin | PATCH `/admin/users/{id}` |
| Statistics | GET `/admin/statistics` |

Updates carry the current version. A 409 reloads server records and requires explicit
review/retry, never automatic replay. New/edited university awards are unpublished,
pending approval; backend assigns owner/institution. No admin content editing or
creation API exists, so those existing controls are disabled for cloud admins.
The form preserves backend field values, permits optional GPA/deadline, and disables
the award-category control because that field is not editable through this API.
Applicant overview, staff document upload UI, role assignment and administrator
activation are not implemented by these screens. Student notes are never loaded.
Empty/loading/error/retry states use the existing styles. Logout or identity changes
dispose memory and cancel queued requests; stale responses cannot populate a new
session. After staff mutations, public discovery reloads from its existing API.

## ProvisionFunction and CloudFormation

The existing SAM function is `scholarrise.provision.lambda_handler`, CodeUri
`../backend/`. Its role can only PutItem to UsersTable plus write its own logs.
The existing resource-based `ProvisionPermission` grants `lambda:InvokeFunction`
to `cognito-idp.amazonaws.com`, restricted to the existing pool SourceArn and the
deployment SourceAccount. Do not broaden it or add Cognito admin rights.

The only template/generator change is a `COGNITO_USER_POOL_ID` reference in this
function's environment. Deploy the function and environment together in a separately
reviewed stack change set. No pool, client, trigger attachment or custom resource
is created. A parameter reference cannot attach a trigger to an existing pool.
The SAM functions share the backend CodeUri: packaging updated code can update both
Lambda code artifacts even though the API handler itself is unchanged. Review the
actual change set; no resource replacement is expected from the environment addition.
Do not import/redeclare the working pool just to attach this trigger.

On `PostConfirmation_ConfirmSignUp`, the handler validates the pool and nonempty
subject, conditionally creates `userId=sub`, `role=student`, `active=true`,
`version=1`, name and profile `{reminders:true, reminderDays:14}`. It ignores all
requested roles/client metadata. Existing records (including inactive/staff records)
are never overwritten. Password reset and other trigger sources do nothing.
Unexpected database errors propagate instead of falsely reporting provisioning
success. A confirmed user might then lack a DB record: do not delete/recreate the
Cognito user; inspect the failure and use approved conditional student provisioning.
Existing confirmed users are not retroactively provisioned. Admin-created accounts
need separate approved provisioning. Keep Lambda/DynamoDB latency under Cognito's
synchronous trigger limit; test a fictional confirmed signup before release.

## First inspect existing triggers, without changing them

An authorized operator can run these READ-ONLY commands in CloudShell Sydney:

```sh
aws cognito-idp describe-user-pool --region ap-southeast-2 --user-pool-id ap-southeast-2_ONSDhlqBo --query 'UserPool.LambdaConfig'
aws cognito-idp list-groups --region ap-southeast-2 --user-pool-id ap-southeast-2_ONSDhlqBo --query 'Groups[].GroupName'
aws cloudformation describe-stacks --region ap-southeast-2 --stack-name scholarrise-group9-backend --query 'Stacks[0].Outputs'
aws lambda get-policy --region ap-southeast-2 --function-name scholarrise-group9-backend-provision
```

Do not share a full user-pool export, user attributes, browser storage, tokens or
headers. Trigger/function ARNs and group names are configuration, not credentials.
Actual live triggers, groups and operator permissions have NOT been verified here.

If PostConfirmation already names another function, STOP attachment: there is one
slot, not a list. Keep it intact and separately review its owner's chaining design
and invocation permissions. Other existing triggers must remain unchanged too.
Do not use a partial `update-user-pool --lambda-config` command: omitted settings
can be reset. After professor approval, prefer editing only Post confirmation in
the existing pool's console, comparing every trigger before and after. Keep a
private operator record of the original slot and settings for rollback.

After a reviewed backend stack update and permission check, an authorized operator
may separately attach the stack's ProvisionFunctionArn only if the slot is empty
and approved. Test fictional new signup/verification, then protected `/me` without
printing tokens. Confirm student/active/version and that a duplicate invocation
does not change existing records. Roll back by restoring ONLY the original
PostConfirmation slot (empty or original ARN), leaving all other triggers intact.
Keep valid student rows; never bulk-delete users/data. Detach before deleting the
function. Revert the Lambda code/environment together if necessary.

Required operator permissions depend on the shared account: read-only Cognito
DescribeUserPool/ListGroups, CloudFormation DescribeStacks, Lambda GetPolicy; for
later approved changes, Cognito UpdateUserPool, appropriate Lambda policy/config
permissions, and approved CloudFormation deployment/PassRole/artifact access.
Ask the professor to approve them; do not request access keys. Backend IAM roles
do not get those operator permissions. Signup adds small Lambda/DynamoDB/log usage;
the existing PITR, retention, S3 versioning and all other cost settings stay intact.

## One university and one administrator test account

An operator must first identify two intended, confirmed, enabled fictional Cognito
accounts. No accounts are invented or created by this work. Inspect their current
UsersTable items privately and confirm exact subjects, roles, active state, versions
and table name from stack outputs. Never promote an arbitrary email supplied by a
browser. Obtain explicit professor approval for each staff assignment.

`backend/provision_staff.py` now defaults to an offline dry run and performs no
Cognito group synchronization. Existing groups/memberships are untouched; DB roles
remain authoritative. This avoids the old script's DB-write-then-group-failure risk.
It reads the existing Cognito account with AdminGetUser and conditionally writes
only the selected DB record when explicitly run with `--apply`. Preserve credentials
in CloudShell's existing identity, not command arguments or repository files.

Prepare (do not apply yet), replacing bracketed values with reviewed values:

```sh
python backend/provision_staff.py --pool-id ap-southeast-2_ONSDhlqBo --username '<existing university login>' --users-table '<stack UsersTableName>' --role university --university 'Fictional Test University'
python backend/provision_staff.py --pool-id ap-southeast-2_ONSDhlqBo --username '<existing admin login>' --users-table '<stack UsersTableName>' --role admin
```

For an existing student row add `--expected-role student --expected-version <actual>`.
Without matching expectations the tool refuses to overwrite it. Conditional writes
also prevent races after reading. Name/profile/active are preserved, so a previously
disabled account stays disabled. New DB rows use attribute_not_exists(userId).
Adding `--apply` is a separately authorized AWS write, never part of this local task.
Operator needs scoped Cognito AdminGetUser and DynamoDB GetItem/PutItem, NOT group
creation, AdminCreateUser or broad wildcard access. No role controls are exposed
in public registration. Review any later role rollback with a fresh version; never
replace a whole item from an old backup or remove legitimate student updates.

## Repeat local checks

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
npm.cmd test
npm.cmd run test:e2e
npm.cmd run test:e2e:student
$env:PYTHON = "$PWD\.venv\Scripts\python.exe"
npm.cmd run test:e2e:api
$env:PYTHONPATH = "$PWD\backend"
.venv/Scripts/python.exe -B -m unittest discover -s backend/tests -q
.venv/Scripts/cfn-lint.exe infrastructure/template.json -r ap-southeast-2
$config = Get-Content deployment/amplify-environment.json -Raw | ConvertFrom-Json
foreach ($p in $config.PSObject.Properties) { Set-Item -LiteralPath "Env:$($p.Name)" -Value $p.Value }
npm.cmd run check:production
npm.cmd run build
```

Local verification on 16 November 2026: 42 JavaScript unit tests, 39 backend tests,
15 demo/auth/responsive browser tests, 5 API browser tests and 11 student/staff browser
tests passed (112 distinct tests). Initial new browser helpers needed to wait for
the simulated Cognito callback before workspace navigation; the corrected tests
passed. Production configuration, template/generator consistency, cfn-lint and the
production build also passed. CSS output remains unchanged.

Unit tests use injected mocks/memory, browser tests intercept synthetic Cognito/API
responses; no live AWS data is touched. Browser staff scenarios run within the
existing student suite on 5176. Local success is not proof of live staff permissions
or trigger attachment. Before release, separately review a backend change set,
then fictional staff accounts, trigger attachment and frontend publication.

AWS references: [Post confirmation](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html),
[trigger permissions and limits](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pools-working-with-lambda-triggers.html),
[safe pool updates](https://docs.aws.amazon.com/cognito/latest/developerguide/cognito-user-pool-updating.html).
