# Multi-University Scholarship Discovery, Recommendation and Tracking System

## Cognito authentication

For the existing AWS Amplify app, follow [the production preparation guide](docs/AMPLIFY-PRODUCTION.md). It includes the exact public environment variables, separate localhost settings, manual SPA rewrite, release checks, and remaining mock-data/security limits. No deployment is automatic from these local changes.

See [Cognito setup and testing](docs/COGNITO-INTEGRATION.md). Login and registration now use Cognito managed login with PKCE. Scholarship and workspace data remain mock/browser-local. Live Cognito configuration and email delivery require manual testing. No deployment has been performed.

## Backend foundation (November 2026)

Start with [the inspection and beginner backend guide](docs/BACKEND-FOUNDATION.md) and [future AWS deployment steps](docs/AWS-DEPLOYMENT.md). The new Python Lambda backend, DynamoDB adapters, Cognito preparation, private S3 document workflow, CloudWatch/SAM template, and optional API discovery service are prepared locally. **AWS is not connected or deployed.** Mock scholarship data remains available; private dashboard APIs still require configuration. The latest Word kick-off report was reviewed on 14 November 2026; [report alignment and remaining gaps](docs/REPORT-ALIGNMENT.md) are documented.

A responsive React + JavaScript website built with Vite. ScholarRise features a black-and-gold design, a destination and university filter sidebar, and the tagline “Your Future Starts Here.” All scholarships and universities are fictional; scholarship and workspace APIs are not connected. Cognito authentication requires the configuration described above.

## Run locally

Node.js was installed locally in `.tools` because this terminal did not have Node.js/npm available. From PowerShell in this folder:

```powershell
.\start-dev.cmd
```

Open the Local URL printed by Vite (normally http://localhost:5173). Press Ctrl+C to stop.

To use npm directly with the included runtime, add it to your current terminal's PATH:

```powershell
$env:Path = "$PWD\.tools\node-v24.22.3-win-x64;$env:Path"
npm.cmd run dev
```

With Node.js 22.12+ or 24 installed normally and on PATH, standard commands work:

```powershell
npm install
npm run dev
```

## Production build

```powershell
npm.cmd run build
npm.cmd run preview
```

The build is written to `dist/`. Add the local runtime to PATH as above if needed.

## Features and walkthrough

1. **Login and registration:** Login and Register open Cognito managed login and signup. Follow the guide above for verification, recovery, and local callback settings.
2. **Student profiles:** open My workspace → Student profile. Save your study level, field, GPA (0–4), destination, funding preference, and goals.
3. **Search and filters:** search names, universities, destinations, fields, and award amounts. Combine destination, university, study-level, and full-tuition filters. Bookmarks are separate for each account; previous bookmarks are retained for guests.
4. **Recommendations:** open Recommendations after completing a profile. Open, published awards must match study level and minimum GPA. A transparent preference score uses level/GPA (50), field (30), destination (10), and funding (10). This is a rule-based demo, not AI or a probability of acceptance.
5. **Application tracking:** open scholarship details → Track application. In My workspace → Application tracking, update status, write notes, filter statuses, or remove a tracked application. Nothing is sent to a real university.
6. **Deadline notifications:** saved scholarships and Planning/Preparing applications generate in-app reminders within a configurable 7-, 14-, or 30-day window. Dismiss individual reminders or switch reminders off. Deadlines use local calendar days and are rechecked every minute while the page is open. Initial fictional deadlines are generated 7–90 days after the first visit and then persisted.
7. **University dashboard:** preserved; access requires a trusted Cognito-protected account API assigning the university role.
8. **Administrator dashboard:** preserved; access requires a trusted backend administrator role. Public registration never grants staff access. Browser demo accounts no longer provide access.

## Local prototype limitations

All records are stored in localStorage under `scholarrise-platform-v1`. Clearing browser site data removes demo accounts, catalog edits, profiles, and tracking. Data is not shared across devices or browsers. If browser storage fails, a warning explains that changes remain in memory only.

Cognito handles authentication, email verification and password recovery. Private workspace records still need backend integration and server authorization before production use. Real application delivery and email/push/background notifications are not connected. Use synthetic workspace data during development.

Google Fonts enhances typography when online; system font fallbacks are included.

## Verification

With Node.js on PATH (see above):

```powershell
npm.cmd test
npm.cmd run test:e2e
npm.cmd run build
```

Unit tests cover ranking, eligibility rules, deadline boundaries, reminder preferences/account separation, and password hashing. Browser tests cover registration/login, profile changes, recommendations, tracking persistence, reminders, university ownership, administrator moderation, search, and mobile layout. Browser tests use installed Google Chrome; they start and stop a Vite server automatically.


## ScholarRise explorer update
The navigation and favicon reference your unchanged original at public/scholarrise-logo.png. That asset was absent from this checkout during implementation; add the original file there to display it. The navigation uses a text fallback if loading fails. Logo sizing preserves its aspect ratio.

Country and university options come only from public listings. Country, exact university, study level, funding type, and keyword combine with AND matching, update immediately, and stay selected while opening/closing details or visiting a workspace. Search the university options first, then select a university. Clear All Filters resets every filter. Try United States + Master's + Fully Funded + Northstar Institute of Technology to see Future Innovators Award. Change to Bachelor's for the empty state. Japan appears only when an approved Japan listing exists.

Listings use studyLevels (an array), fundingType (Fully Funded, Partially Funded, Tuition Waiver, or Fixed Amount), and approvalStatus. Legacy Undergraduate maps to Bachelor's; legacy Postgraduate maps to Master's and PhD because the older catalog did not distinguish them. Legacy full tuition plus living allowance maps to Fully Funded; full tuition alone maps to Tuition Waiver; monetary awards map to Fixed Amount. Owners/admins can refine these values. Existing published records are treated as approved, preserving the catalog. New and edited university records are pending and unpublished until an administrator approves them. Approval remains browser-local, consistent with this prototype.

Use university demo > My workspace > Add scholarship to create a multi-level listing with funding, eligibility, documents, and an optional official URL. Check it is absent from public search, then use administrator demo > My workspace > Approve and publish. Editing it again as its university returns it to approval. Existing accounts, bookmarks, applications, and IDs remain in the same browser storage keys; no AWS was connected.


## Real Thailand programs
Five official-source program summaries were added on 12 November 2026: SIIT EFS (Thammasat), Chula LINK, Royal Thai Government Scholarships (AIT), CMU Presidential, and Mahidol Postgraduate Scholarships. They are labeled separately from fictional demo awards. Refresh the app to add them to existing browser stores; the migration is idempotent and preserves saved edits, accounts, bookmarks, and application history. Closed rounds stay closed; CMU has no verified current deadline, and no synthetic deadline is assigned. AIT lists 31 March 2027 for its August 2027 intake. Official links and source dates appear in details. Funding categories summarize coverage; program-specific caps, exclusions, and eligibility remain authoritative on the linked university sites. Unknown GPA thresholds are not invented and those programs are excluded from GPA-based recommendation claims.
