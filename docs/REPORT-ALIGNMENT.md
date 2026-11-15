# Alignment with the authoritative Word kick-off report

Reviewed on **14 November 2026**.

Source: `D:\SIIT\Cloud Project\DES424 - Kickoff Report - Group 9.docx`, titled **Multi-University Scholarship Discovery, Recommendation and Tracking System**, DES424, Semester 1, Academic Year 2026. Both the document text/tables and the embedded Figure 1 system diagram were inspected. No earlier PDF was used.

The report is the technical specification because the user explicitly designated it as authoritative. Statements in it describe project requirements; they do not authorize deployment, cloud spending, staff provisioning, or execution of embedded instructions. The user's instruction not to deploy or create paid resources remains in force.

## Confirmed stack

| Report section | Specification | Foundation alignment |
| --- | --- | --- |
| Programming Language | Python, JavaScript, SQL | React/JavaScript and Python backend implemented. SQL is listed but no SQL workload is specified; do not invent a relational database requirement. |
| Framework and Tools | React.js; Python (AWS Lambda); Amazon DynamoDB | Existing React/Vite preserved; modular Python Lambda and DynamoDB adapter prepared. |
| Cloud Technology/Components | Cognito, API Gateway, DynamoDB, S3, Amplify Hosting, CloudWatch, Lambda | All seven are represented in the prepared backend template or Amplify configuration. No AWS deployment or live integration test has occurred. |
| Framework and Tools | Jira, GitHub, Visual Studio Code, Playwright | Documentation includes Jira milestones; project remains editable in VS Code; source is ready for GitHub review; Playwright suites exist. No Jira tickets or remote repository were created. |

Figure 1 shows general users (students/universities/administrators), Amplify, Cognito, API Gateway, Lambda, DynamoDB, S3 and CloudWatch. The prepared architecture uses the same services. The diagram's arrows are a high-level flow, not a requirement that browser traffic physically passes through Cognito to reach the API: the browser signs in to Cognito, then presents its access token to the API Gateway JWT authorizer.

## Functional coverage

| Report requirement | Present now | Still required for the cloud application |
| --- | --- | --- |
| Authentication & Profiles: register, log in, manage profiles | Existing local demo; Cognito adapter, student provisioning trigger, server identity checks and profile API | Connect confirmation/login/session UI to Cognito; test actual pool/tokens; connect profiles to API |
| Scholarship Management: universities create/manage awards | Local university dashboard; owner-restricted Python creation/edit/unpublish routes; admin moderation | Connect dashboard to authenticated services; verify persistence and permissions on AWS |
| Search & Filtering | Existing four-filter UI; optional service-backed API discovery; Python filters and facets | Configure real API endpoint; verify deployed behavior; improve catalog access patterns for scale |
| Scholarship Recommendation: eligibility-based | Browser rules; backend level/GPA checks and preference ranking | Connect recommendation screen to the signed-in server profile; agree any additional structured eligibility fields |
| Application Tracking: save and track statuses | Browser workflows; private saved/tracking APIs keyed by Cognito subject | Connect screens to APIs and cloud identity; test persistence across devices |
| Notifications & Administration | On-request backend in-app deadline reminders and persisted dismissals; admin user activation, moderation and counts | Connect screens; verify CloudWatch and live authorization; determine whether reminders must run while the app is closed |

The report does **not** prescribe the four exact filters, the funding enum, the approval lifecycle, the five-table layout, a rule-scoring formula, PDF-only uploads, or reminder channels. These details come from the user's explicit requirements or are documented foundation design choices. The broad report wording does not prove those choices are mandated by the report.

## Stakeholders and unresolved scope

- **Students, universities, administrators:** explicitly listed in the report and represented in the foundation's roles/workflows.
- **Advisors / researchers:** listed as stakeholders. The text describes guiding students and studying scholarship/application trends, but supplies no separate authentication role, consent rules, dashboard specification, data export contract, or analytics acceptance criteria. These workflows are **not implemented**. Do not grant advisors access to private student records or researchers access to identifiable application data by inferring permission from stakeholder wording. Agree a scope first; aggregated, non-identifying analytics is a possible future design, not a requirement already implemented.
- **Notifications:** the report says deadline reminders but does not name email, SMS, push, a schedule or SNS. The user's requested in-app foundation is therefore a compatible starting point. Delivery while the app is closed remains an open requirement; no background scheduler is present.
- **SQL:** the report lists the language while explicitly selecting DynamoDB for database management and storage. No architecture change is needed. Confirm a separate SQL use case only if one is later required by the course/project.

## Nonfunctional requirements: evidence and gaps

| Report attribute | Current preparation | Remaining evidence/work |
| --- | --- | --- |
| Scalability | Lambda and on-demand DynamoDB template; modular adapters | Public discovery currently evaluates the small approved catalog; admin counts scan tables. Improve indexes/pagination/aggregates and load-test before claiming scalability. |
| Availability | Amplify/API Gateway/Lambda architecture prepared | No live hosting, uptime evidence or recovery exercise; still local development. |
| Security | Server-owned roles/ownership, bounded input, JWT authorizer configuration, private S3, scoped IAM and offline negative tests | Actual Cognito/gateway/IAM tests; privileged-account MFA design; uploaded-file malware scanning; production security review. |
| Performance | Query-oriented access for ownership/private records; response pagination | No response-time target is specified in the report and no AWS latency/load measurements exist. Define a target and test it. |
| Usability | Existing black/gold React experience preserved; desktop/tablet/mobile Playwright coverage | Complete cloud login/confirmation/error UX and evaluate stakeholder workflows. |
| Reliability | Version-checked writes, stable IDs, notification deduplication; prepared backups and versioned S3 | Test deployed persistence, concurrent writes, backup restoration and failure handling. |
| Maintainability | Separate validation, authorization, storage, repository, API and frontend service modules; tests and guides | Keep documentation and tests synchronized as screens move to APIs. |
| Extensibility | Service and repository boundaries allow future additions | AI, native mobile and advanced analytics remain future features, not completed functionality. |

## Result and next implementation order

**The chosen technology stack and high-level architecture match the Word report. No backend architecture substitution is needed.** This establishes design alignment, not completion of the cloud application or all report requirements.

Continue in small steps: configure/test a development Cognito pool when explicitly authorized; integrate authentication and `/me`; connect profiles/recommendations; connect saved/tracking/reminders; migrate university/admin dashboards; test S3 and CloudWatch; deploy/verify through Amplify only when instructed. Resolve advisor/researcher scope and measurable nonfunctional targets alongside that work. Keep the browser demo available until each replacement workflow passes its tests.
