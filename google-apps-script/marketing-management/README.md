# L’Imperial Marketing Department — inside Sales & Order Management

This is a **separate Marketing Department** inside the existing application, not a second application and not an extension of the Sales or Stock roles.

## Delivered

- Marketing-only department navigation for `Marketing Staff` and `Marketing Manager`; Sales/Stock roles do not see the module. Existing Admin/Super Admin can open Marketing without losing their other access.
- Overview with task counters, overdue alerts and next-to-publish work.
- Daily Plan + Evening Result, both linked to existing Marketing task IDs (no duplicated To-Do tasks).
- My To-Do with progress, priority, deadline, history and blockers.
- LPL and LPH Content Calendar, Campaign grouping, review/approval decisions, published links and basic management reports.
- Backend writes to Google Sheets using a signed-in, server-checked Google Apps Script web app via the deployed `marketing-google-proxy` Supabase Edge Function. Supabase stores authorization and the Apps Script connection URL, **not Marketing task/report rows**.
- Existing Sales daily reports, procurement, inventory and legacy Sheets remain unchanged.

## Marketing master workbook

[Marketing Management — Master Data](https://docs.google.com/spreadsheets/d/1Id6HglSoa_iAIIz0HLm_s6zSsnKwmLI_SoqeQSEG9RA/edit)

Spreadsheet ID: `1Id6HglSoa_iAIIz0HLm_s6zSsnKwmLI_SoqeQSEG9RA`. Existing tabs: `Tasks`, `Activity`, and `Daily`. **48** calendar entries from the 2026 LPL November, LPH November, and LPL December calendars have been imported as unassigned tasks. The original calendar and individual staff Excel files were NOT modified. Historical individual daily report entries were NOT imported.

The imported tasks have no authenticated `assignee_id` until the Marketing users are registered. They are visible to Marketing Manager, Admin and Super Admin, who must match the original text names to registered accounts and assign those tasks manually. Do not overwrite IDs or bulk-import them a second time without deduplication.

## REQUIRED: one-time Google Apps Script activation (Super Admin)

Until this step is completed, Marketing pages show a setup-required notice and **cannot submit or load live task data**.

1. Open the [Marketing master workbook](https://docs.google.com/spreadsheets/d/1Id6HglSoa_iAIIz0HLm_s6zSsnKwmLI_SoqeQSEG9RA/edit).
2. Select **Extensions → Apps Script**, open the default `Code.gs`, and replace its contents with the repository source at [marketing-management/Code.gs](./Code.gs). This must be a **separate Apps Script project** from the existing Sales Daily Plan script.
3. In **Project Settings → Script properties**, add:
   - `MARKETING_SHEET_ID`: `1Id6HglSoa_iAIIz0HLm_s6zSsnKwmLI_SoqeQSEG9RA`
   - `SUPABASE_URL`: `https://msxvnaintafqdgheutfu.supabase.co`
   - `SUPABASE_ANON_KEY`: the same **publishable public API key** used by the app in `config.js`. Never use a service-role key here.
4. Save the script and manually run `setupMarketingManagement` once. Authorize Sheets and UrlFetch access. It checks the three tabs and column order without deleting their content.
5. Choose **Deploy → New deployment → Web app**. Set **Execute as: Me (Sheet owner)** and **Who has access: Anyone**, then deploy and copy the exact `https://script.google.com/macros/s/.../exec` URL. The Web App rejects requests without a valid, Marketing-authorized Supabase login.
6. Sign into [L’Imperial Sales & Order Management](https://harrisho1234-spec.github.io/Sale-and-purchase-tracking/) as **Super Admin**. Open **Marketing → Google Sheet Setup**, paste the URL, and press **Save Connection**.
7. Reload **Marketing**, confirm task/calendar data is visible, and run a live smoke test: create a task, submit a Morning Plan, update progress, submit an Evening Result, request manager approval, approve it, and record a published HTTPS URL.
8. To update the backend script later, open the bound Apps Script project, replace `Code.gs` with the latest source, save, then **Deploy → Manage deployments → Edit existing deployment → New version → Deploy**. Reuse the existing `/exec` URL; do not create a duplicate web app.

**Do not** paste the public publishable API key into emails/chats unless needed; retrieve it from the app’s own `config.js` during setup. **Never** expose the service-role key. Keep the Marketing master Sheet restricted to authorized management, and never make it publicly editable.

## Register Marketing accounts later

Open **Users & Access → Create User** as Super Admin and select the existing role template:

- **Marketing Staff** — own tasks and daily updates; cannot access Sales/Stock modules.
- **Marketing Manager** — department-wide task assignment, approvals, review queue and reports; cannot access Sales/Stock modules.
- **Admin / Super Admin** — existing global roles also get Marketing access, but are not Marketing staff.

No staff credentials or fake accounts were created. After accounts are added, open **Marketing → My To-Do** to assign imported calendar tasks to those users by ID; the name typed in the source Excel/Calendar is an annotation only, not a user account.

## Security and testing

- Authenticated relay: `supabase/functions/marketing-google-proxy/index.ts`, deployed as an active edge function with `verify_jwt=true`.
- Every Apps Script operation additionally validates the live login, department role and task ownership. A staff member cannot approve someone else's content or publish before approval.
- The Marketing role templates are separate from Sales/Stock. Restrictive RLS policies deny authenticated Marketing roles access to RLS-enabled non-access operational business tables.
- CI source checks: `tests/marketing-module.test.cjs` and `.github/workflows/marketing-module-tests.yml`.
- Verified source syntax and mock navigation tests for Marketing Staff, Manager, Sales, Stock Controller, Admin and Super Admin. A full live sign-in + Google Apps Script integration test is **not yet possible until the owner completes activation**.

## Current limitations

The initial module supports linked tasks, progress, manager approval, content calendar and reporting. It does **not** automatically post to Facebook/TikTok/Instagram, fetch social engagement analytics, ingest all historical individual staff Daily Reports, upload artwork bytes directly into Drive, or push notifications to background devices. Artwork and final deliverables are stored as links to existing Drive assets. Current overdue attention is in-app on the Marketing Overview page, not a background push notification.

## Marketing Daily Plan linked to Content Calendar — 13 Nov 2026

The Marketing Daily Plan now has a **Select from Content Calendar** action for choosing an existing assigned scheduled task. It links the same task ID to Morning Plan (no duplicate content item). Tasks are grouped by business (LPL/L'Imperial Luxury, LPH/LP Home, Both, Other). Calendar links open the original content entry on its publishing month.

Evening Result now collects an individual **Completed / Partially Completed / Pending / Not Done** status plus required remark against **every** Morning Plan task. Additional/unplanned work can be linked from an existing assigned task. The manager's Team Daily Review displays those per-task outcomes and a general summary separately. Daily results are for reporting; they do **not** automatically change the content task's published status, bypass approval, or alter existing To-Do history. Quick Update remains the progress/audit mechanism.

### Deployment required for per-task Evening Results

The client change is delivered with GitHub Pages, but **Apps Script requires its own redeployment**. Copy the current [Code.gs](./Code.gs) into the existing private Marketing Apps Script project, save it, then choose **Deploy → Manage deployments → Edit (pencil) → Version: New version → Deploy**. Keep the existing script properties, spreadsheet, and Web App URL. Do not create a new blank spreadsheet or web app. Once deployed, the existing `list` response advertises `daily_report_version: 2`; the frontend then enables the itemized PM result submission. Until redeployed, the interface warns and prevents itemized PM outcomes from being silently discarded by the old script. Existing Daily records remain readable, and the **Daily** tab's `result_json` column now contains `task_results` for new submissions; no additional sheet columns or tables are required.

Verify using a Marketing staff account: choose an assigned calendar task, submit Morning Plan, enter a status and remark per planned task, submit Evening Result, then view the result in **Team Daily Review** with a Marketing Manager account. Existing old records without itemized results retain their original summary and do not fabricate outcomes.
