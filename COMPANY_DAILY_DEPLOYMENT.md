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
