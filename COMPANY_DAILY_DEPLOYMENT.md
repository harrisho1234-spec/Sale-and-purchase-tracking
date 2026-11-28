# Company Daily Work — production activation

The new Daily Work application source, Supabase role-access RPCs, role templates,
and the `company-daily-google-proxy` Edge Function are committed/deployed.
**The Google Apps Script project must be updated and redeployed** before staff
can save cross-department Daily Work records.

## Google Apps Script deployment

1. Open the Google Sheet used by the existing Sales Daily Plan:
   https://docs.google.com/spreadsheets/d/1dDxwdTB59YZa1j3PilEjCTdfhG-zWWDgCMpQhdLmz9s/edit
2. Open **Extensions → Apps Script** in the project currently powering Sales Daily.
   Compare the live `Code.gs` with
   [repo Code.gs](./google-apps-script/sales-daily-plan/Code.gs), and add the
   `company_` action route shown there. **Do not overwrite other production
   changes that may exist only in the deployed script.**
3. Create a script file named **CompanyDaily.gs** and paste the complete
   contents of [CompanyDaily.gs](./google-apps-script/sales-daily-plan/CompanyDaily.gs).
   Keep the current Script Properties `SHEET_ID`, `SUPABASE_URL`, and
   `SUPABASE_ANON_KEY`; do not put secrets in GitHub.
4. Deploy → **Manage deployments** → Edit the existing Web App → select
   **New version** → Deploy. Preserve **Execute as Me** and existing access
   settings. Do not change the existing `/exec` URL or Sales Daily integration.
5. In Sales & Order Management, sign in with a role enabled for Company
   Daily, open **Daily Work · All Departments**, and test one task, morning
   submission, evening result and manager review.

## Access and behavior

- Sales and Marketing keep their existing historic reports in their current
  modules; this new module stores new company daily tasks in separate tabs:
  `Company Daily Tasks`, `Company Daily Reports`, `Company Daily Audit`.
- The receiving department manager or Admin must approve cross-department
  assignments. Pending requests are not visible to the proposed assignee.
- Admin/Super Admin can review all departments; department managers can review
  their own department.
- Project, Project Manager, Product Assistant, Product Manager, and Stock Manager
  role templates were created in Supabase. Existing user roles were not changed.
- The new module is intentionally not a migration of historical Sales/Marketing
  report data. Leave old records in place.
- Automated push notifications and direct attachment uploads are **not** part
  of the initial version; use linked Drive files in task references for now.

## Test coverage

`node --test tests/company-daily.test.cjs`

After Apps Script deployment, confirm success with an authorized staff login
and Google Sheets audit rows; JavaScript syntax checks and mocked workflow tests
alone do not establish production readiness.

## Project Coordinator daily template (2026-11-28)

The Project Coordinator uses **Daily Work · All Departments**, with a Project-focused
Morning Plan, Evening Result, and task/To-Do view. Project task categories are
expanded to include site visits, customer/contractor coordination, delivery and
installation scheduling, project follow-up, inspection, technical coordination,
and documentation. Earlier categories remain valid.

**Deployment requirements (not satisfied by a GitHub Pages commit alone):**

1. In the Sales Daily workbook above, open **Extensions → Apps Script**.
2. Update the `CompanyDaily.gs` file to the current committed source in
   `google-apps-script/sales-daily-plan/CompanyDaily.gs`. Preserve the
   existing `Code.gs` and Script Properties; do **not** replace the full
   Apps Script project.
3. Save, then **Manage deployments → Edit existing web app → New version → Deploy**.
   Preserve the existing web app URL, owner, and access settings. Do not create
   a new endpoint or change credentials.
4. On the first Company Daily request, the existing **Company Daily Reports**
   sheet automatically gains three columns: `Late PM Allowed`,
   `Late Approved By`, and `Late Approved At`. Existing rows remain.
5. Assign an authorized employee the `project` role and a reviewer the
   `project_manager` role through **User & Access** (or use Admin /
   Super Admin for authorized review). At the time of the code review,
   the database had no active accounts with either Project role.
6. Test with a Project account: create a task, submit a multi-task Morning
   Plan, record an outcome for each task, submit Evening Result, and review
   as Project Manager/Admin. Test overdue To-Dos and a deliberately late
   Evening Result with manager approval in a safe test context.
7. Verify non-Project Sales and Marketing workflows remain unchanged.
   Confirm audit entries in **Company Daily Audit**.

**Late PM rules:** The Project Coordinator's first Evening Result is due by
10:00 AM Phnom Penh time on the day after the Morning Plan date. After this
deadline, a Project Manager/Admin may authorize a late submission through the
Project report review interface. Permission is checked server-side and
authorization is audit-logged. A requested correction after manager review
is not treated as an initial missing Evening Result.

**Limitations:** On-screen overdue task indicators are implemented; scheduled
push notifications for Project overdue tasks are **not yet implemented**.
Project Daily still uses the shared-work task backend and does not yet provide
every Sales-only draft, carry-forward, or revision-detail screen.
