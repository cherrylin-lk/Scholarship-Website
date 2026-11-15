# ScholarRise: future AWS deployment, not yet executed

These instructions are for a later, explicitly authorized development deployment. Running `sam deploy`, creating an Amplify app, enabling backups or storing data can incur charges. No command in this document has been executed against AWS during foundation work. Use synthetic data and a dedicated development account/profile.

## Resources required

The prepared `infrastructure/template.json` defines five DynamoDB tables (with two scholarship GSIs), two Python Lambda functions, an API Gateway HTTP API with a Cognito JWT authorizer, Cognito user pool/public app client and three groups, a private encrypted versioned S3 bucket with TLS-only policy, scoped Lambda IAM roles, CloudWatch log groups (14-day retention), and Lambda execution-error and HTTP API 5xx alarms with no SNS actions. Amplify Hosting is configured separately through GitHub; `amplify.yml` builds the existing React/Vite project. VS Code and Jira remain development/project tools, not backend services.

**Retained resources:** tables, the bucket and Cognito pool are retained on stack deletion/replacement to protect data. This means deleting a stack will not stop all storage/backup charges. Review and clean up retained development resources deliberately after exporting needed data. No automatic deletion tool is supplied.

## Before any cloud creation

1. Review the completed Word-report comparison in `REPORT-ALIGNMENT.md` and resolve the remaining implementation/design decisions. Repeat the comparison if the report changes.
2. Choose your AWS region, development account, stack name and exact allowed frontend origin. Confirm regional support, quotas, budget and expected costs. Do not embed AWS keys in React or `VITE_*` values.
3. Install AWS CLI and AWS SAM CLI locally, use an operator identity through a named profile/SSO, and restrict deployment/provisioning access. These are operator tools, not browser credentials.
4. Run all offline tests and template validation. Review the template and IAM statements. The API role cannot grant Cognito groups or create IAM resources; the provisioning Lambda can only write the Users table.
5. Confirm the explicit deployment instruction. Do not treat building/validating the template as permission to create infrastructure.

## Later: deploy the backend manually

Run from the repository root only after the above review:

```powershell
sam validate --lint --template-file infrastructure/template.json
sam build --template-file infrastructure/template.json
sam deploy --guided --profile YOUR_DEVELOPMENT_PROFILE
```

Use an exact `FrontendOrigin`, such as the HTTPS Amplify branch origin without a trailing slash, or `http://localhost:5173` for a development-only stack. Do not allow wildcard production origins. Confirm the proposed change set before executing it. SAM's artifact bucket and deployment artifacts can also incur storage charges. The template caps API throttling and Lambda concurrency but does not guarantee a cost ceiling.

Record the stack outputs: API URL, region, user pool ID, public app client ID, table names and document bucket name. The API is empty initially; the SAM template does not import demo records or local accounts. Public `/health` is a liveness response, not an integration test. The private catch-all route is JWT-protected; public GET routes are explicit exceptions. No Lambda function URL should be created.

## Cognito and staff provisioning

The app client has **no secret**. It supports the prepared public-client password adapter, verifies email, and requires a strong password. Confirmed self-registration invokes `scholarrise.provision.lambda_handler`, which creates only a student record. It ignores client-supplied role metadata. Admin-created Cognito accounts do not automatically run the post-confirmation sign-up trigger; provision their Users records explicitly.

For a later synthetic staff test, create/confirm the identity in Cognito under a restricted operator account, then review a dry run:

```powershell
python backend/provision_staff.py --pool-id YOUR_POOL --username sample@example.test --users-table YOUR_USERS_TABLE --role university --university "Sample University"
```

The tool writes nothing without `--apply`. Adding `--apply` is a separate explicit operator action and uses the operator's AWS identity, never frontend keys. Use `--role admin` only for a designated project administrator. Cognito groups mirror the authoritative Users role. Restrict this script's operator permissions to the chosen pool/table; the deployed API cannot call it. Its changes are not atomic across Cognito and DynamoDB: the database role is authoritative, and rerun/reconcile groups if Cognito synchronization fails. For production, add an audited staff invitation/provisioning process and require MFA for privileged accounts; MFA challenge UI is outside this foundation.

Admin activation/deactivation through the API affects application access, including issued tokens. It does not invoke Cognito global sign-out, delete accounts or change password state. Cognito token revocation/global sign-out does not make every already issued JWT disappear from a validating gateway immediately; expiry and server account state still matter.

## Amplify Hosting via GitHub

1. Review/commit the source to the project's GitHub repository yourself. No GitHub repository or connection has been created by this task.
2. In Amplify Hosting, connect the intended repository/branch, use `amplify.yml`, and select a supported Node version compatible with Vite (the project currently uses Node 24 locally). The build is `npm ci`, then `npm run build`; artifacts are `dist`.
3. Keep `VITE_DISCOVERY_SOURCE=demo` for the initial unchanged demo, or set `api` with `VITE_API_BASE_URL` to test API-backed discovery. `VITE_COGNITO_REGION` and `VITE_COGNITO_CLIENT_ID` are public identifiers for the next auth-screen integration; setting them alone does not replace the demo login.
4. Any `VITE_*` value is public in the browser bundle. Never put AWS access keys, secret keys, operator tokens or app client secrets there.
5. Update the backend `FrontendOrigin` and S3 CORS to the exact Amplify origin. Rebuild the frontend after changing Vite environment variables.
6. Current navigation uses React state and hash anchors, not nested browser paths. Add an Amplify SPA rewrite to `/index.html` only when adding real client-side routes, preserving static asset paths.

## Live verification before saying “AWS connected”

- Confirm email sign-up creates a student-only Users record; attempting to supply a staff role fails/has no effect.
- Obtain an actual Cognito **access token** through the public app client. An ID token, expired token, wrong issuer, wrong app client and unsigned token must fail private routes. API Gateway validates the signature; Lambda never trusts a decoded Authorization header alone.
- Verify a student cannot read another student's activity or use university/admin routes. Verify a university cannot edit another university's scholarship or choose an arbitrary owner/institution.
- Create a pending scholarship, confirm it is absent from public results, approve it as admin, then edit it as its university and confirm it disappears pending reapproval.
- Test DynamoDB conditional version conflicts and persistence after logout/browser restart; explicitly migrate each frontend screen to APIs before describing it as cloud-backed.
- Upload only synthetic PDFs through S3 POST policies; reject oversize/non-PDF uploads, complete an owner-authorized file, approve its listing, and test a version-specific short-lived attachment download. Confirm direct anonymous S3 access is denied.
- Check CloudWatch request IDs/status without logging tokens, bodies, private notes or presigned URLs. Verify both the HTTP API 5xx alarm and Lambda execution-error alarm; add a project dashboard as needed. The API catches application exceptions, so they may not increment Lambda's execution error metric; the HTTP alarm covers handled 500 responses.
- Run Playwright against the configured environment using dedicated synthetic accounts; do not point the offline fixed-token runner at AWS or use it for live authorization testing.

## Official references used

- [API Gateway JWT authorizers](https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-jwt-authorizer.html)
- [AWS SAM OAuth/JWT authorizer example](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-controlling-access-to-apis-oauth2-authorizer.html)
- [Cognito post-confirmation triggers](https://docs.aws.amazon.com/cognito/latest/developerguide/user-pool-lambda-post-confirmation.html)
- [Cognito access tokens](https://docs.aws.amazon.com/cognito/latest/developerguide/amazon-cognito-user-pools-using-the-access-token.html)
- [S3 POST policy constraints](https://docs.aws.amazon.com/AmazonS3/latest/API/sigv4-HTTPPOSTConstructPolicy.html)
- [S3 versioned object uploads](https://docs.aws.amazon.com/AmazonS3/latest/userguide/AddingObjectstoVersioningEnabledBuckets.html)
- [Vite deployment on Amplify](https://docs.amplify.aws/gen1/javascript/deploy-and-host/frameworks/deploy-vite-site/)
