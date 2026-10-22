# Sales Daily Plan & Results — Google Sheets Setup

**Google Sheet:** https://docs.google.com/spreadsheets/d/1dDxwdTB59YZa1j3PilEjCTdfhG-zWWDgCMpQhdLmz9s/edit

The app uses an authenticated API relay and Google Sheets for reports and tasks. Neither reports nor tasks use Supabase Storage or Supabase database tables.

The production connection was activated on 22 October 2026 with this [deployed endpoint](https://script.google.com/macros/s/AKfycbwWYiZUXqIyErU9C6xbQbbDODtvxTenXJTUpDlbCG2ytMqP344Qx2Y7BqTyXH9PHYp5/exec). The steps below are for a new installation or replacement deployment. The endpoint URL is public configuration; a live authorized login is still required for every report operation.

## One-time setup (Google Sheet owner / Super Admin)

1. Open the Google Sheet above, then select **Extensions → Apps Script**.
2. Replace the default Code.gs with the source from [Code.gs](./Code.gs). Save.
3. In Apps Script **Project Settings → Script properties**, set:
   - SHEET_ID: 1dDxwdTB59YZa1j3PilEjCTdfhG-zWWDgCMpQhdLmz9s
   - SUPABASE_URL: https://msxvnaintafqdgheutfu.supabase.co
   - SUPABASE_ANON_KEY: sb_publishable_RpLdBcXql9MpBZCU-GLqPQ_G3VKM8zd
4. Choose **Deploy → New deployment → Web app**. Select **Execute as: Me**, **Who has access: Anyone**. Grant Google Sheets and external HTTP requests permission. Copy the web app URL ending /exec.
5. Log into the [L'Imperial app](https://harrisho1234-spec.github.io/Sale-and-purchase-tracking/) as **Super Admin**. Select **Team Daily Review** and paste the URL into the **Google Sheets connection** field, then click Save.
6. Verify a Sales account can submit a draft and a Manager account can read it. Test again before relying on this feature for daily staff tracking.

Security: The Web App technically receives external HTTP requests but **rejects calls without an authorized live Supabase session**. It checks every caller's role via Supabase before reading or writing. The publishable key above is not a service-role/secret key; never use the service-role key. Keep the Google Sheet private; Sales staff only need access through the app.

## Daily workflow

Sales: Open **Daily Plan & Result**, select date, add planned tasks, optional customer links and follow-up date. **Save AM Draft**, then **Submit Morning Plan**. After submitting the AM plan, update each task with a result, status and next follow-up date; **Save PM Draft** or **Submit Evening Result**. Use **Import Pending Tasks** to carry forward unfinished tasks, and **View Today's Activity** for read-only CRM/Sales events.

Manager: Open **Team Daily Review** to compare AM and PM by Salesperson/date and choose **Mark Reviewed** or **Request Corrections** with a comment. Request Corrections reopens the PM result only. Manager sees Sales-role staff, not unrelated departments.

Both screens include a last-seven-days summary ending on the selected report date (Sales) or the To date (management). Management summaries respect the selected salesperson. Completion rate is completed tasks divided by all planned tasks, including drafts and cancelled tasks. The current access RPC defines the manager's team as all active Sales-role accounts; there is no separate manager-to-salesperson assignment model.

Customer Database's **First Contact Date** is selectable when adding a customer. The server rejects future dates and dates before 1900, preserves the system creation timestamp, and requires an active Sales/Manager/Admin/Super Admin account. Sales and Manager creation retain the existing self-assignment rules.

## Verification

Run `node --test tests/sales-daily.test.cjs` for the AM/PM/review state transitions, ownership, weekly filters, carry-forward, date validation, blank sheet row handling, request validation, and UI date/account isolation. The Sheets API is simulated in these tests; they do not replace a signed-in live smoke test.

Run `tests/sales-daily-access-rollback.sql` as a database administrator to check actual account access and selectable customer dates. Test customer changes are rolled back. Existing anonymous function grants remain revoked; the connection table has no direct client grants or policies and is exposed only through permission-checked RPCs.

Writes are serialized by an Apps Script lock. All evening input is validated before writing any result. Google Sheets does not provide database transactions: an infrastructure failure during a multi-row write may still require retry/reconciliation. Audit records and manager reviews remain in the workbook.

Roles and access: In **Users & Access**, permissions are Sales Daily Plan (Own), Daily Review Team (Manager), and Daily Review All (Admin/Super Admin). Supabase holds these permission settings and the Google connection URL, but **not daily report rows**.

Google Sheets tabs: Daily Reports, Plan Tasks, Manager Reviews, Audit Log, Overview.

When updating Code.gs, go to **Deploy → Manage deployments → Edit → New version → Deploy** so the active deployment uses the updated code.

Telegram submission reminders and automated task completion based on other system actions are not enabled in this initial version. The recorded activity panel is advisory: staff still confirm actual results.
