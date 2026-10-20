# L'Imperial — automatic business-data backups to Google Drive

## Current deployment state

- ✅ Private Google Drive destination folder created in the account's My Drive.
- ✅ Service-role-only Supabase table manifest migration applied.
- ✅ Apps Script backup exporter prepared in [Code.gs](./google-apps-script/Code.gs).
- ⏳ **NOT scheduled yet**. The owner must authorize Google Apps Script and save a private Supabase backend API key under Script Properties. Never paste keys in ChatGPT, GitHub, or public web app files.
- ⏳ No actual production backup ZIP exists until `runBackupNow` successfully runs.

## What gets backed up

All `public` **base tables**, currently 89 (automatically discovers newly created public tables with primary keys). Includes business records such as customers, sales orders, quotations, POs, inventory, payments, activity and access roles. Each table is exported to JSON in a single timestamped ZIP. `manifest.json` includes per-table row counts, primary key columns and SHA-256 checksums. The ZIP is verified before and after upload. Aborts on API/page failure instead of saving a partial ZIP. Keeps 30 days of verified backups by default, deleting older copies only after a successful newer backup.

**Scope warning**: These are complete *business-table data exports*, not transactional PostgreSQL `pg_dump`, and do **not** include `auth.users`, Supabase Storage binary files, auth identities/passwords, bucket configurations, roles, RPC function definitions, RLS policies, database schema or system settings. A coordinated restore would need the database schema/migrations and separate Supabase Auth/Storage recovery plan. Because rows are exported table-by-table, changes made during the backup can make related tables differ by a few seconds. This protects data but is not a true point-in-time snapshot.

## One-time setup (the owner does this in their own Google account)

1. Open the dedicated private Drive folder: [Limperial - Supabase Daily Backups](https://drive.google.com/drive/folders/1s22bMdH6G0ptb4ngPGEPI1X6BcKAXI3U). Keep the folder **Restricted**; do not share it with staff. Sensitive customer, stock and finance data will be in these backups.
2. Open [Google Apps Script — New Project](https://script.google.com/home/projects/create), name it `Limperial Supabase Daily Backup`.
3. Open the repository's [backup/google-apps-script/Code.gs](./google-apps-script/Code.gs), copy the entire code into the new Apps Script project's `Code.gs` (replace the default function), and click **Save**. Use only one owner/editor.
4. In **Supabase → Limperial staff login → Project Settings → API Keys → Secret API keys**, create a **separate** backend secret key named e.g. `drive-daily-backup`. It begins with `sb_secret_`. This is a privileged secret (bypasses RLS). **Do not use the public/publishable key; do not put this secret in source code, shared sheets or chats.** Direct link: https://supabase.com/dashboard/project/msxvnaintafqdgheutfu/settings/api-keys
5. In Apps Script **Project Settings** (gear icon) → **Script Properties** → **Add script property**, set exactly:

| Property | Value |
|---|---|
| `SUPABASE_URL` | `https://msxvnaintafqdgheutfu.supabase.co` |
| `SUPABASE_SECRET_KEY` | the newly created `sb_secret_...` key |
| `BACKUP_FOLDER_ID` | `1s22bMdH6G0ptb4ngPGEPI1X6BcKAXI3U` |
| `BACKUP_RETENTION_DAYS` | `30` (optional; 7–365) |
| `ALERT_EMAIL` | your private email address (optional; email on failure) |

6. In Apps Script **Project Settings**, set **Time zone = (GMT+07:00) Asia/Phnom_Penh**. Google Apps Script's default V8 runtime is sufficient. Do **not** deploy the script as a publicly accessible web app.
7. From the **Run** function dropdown select `testBackupConnection` and click **Run**. Accept Google account authorizations for Drive, Supabase network requests and optional failure alerts. The execution log should say `Found 89 public tables` (the count can increase as features are added). This preflight uploads no data.
8. Select `runBackupNow` and click **Run**. Wait for successful completion. Verify a `Limperial_Supabase_BusinessData_YYYYMMDD_HHMMSS.zip` file appears in the private Drive folder. The ZIP contains `manifest.json` and `tables/*.json`. If it fails, **do not schedule the task**—check the Apps Script execution error and correct settings.
9. Finally select `installDailyBackupTrigger` and click **Run** once. The backup is now scheduled to run **daily around 02:00–03:00 Phnom Penh time**. Apps Script time triggers are approximate, not minute-accurate.
10. Review the **Apps Script → Executions** page and the Drive folder occasionally. If `ALERT_EMAIL` is set, failures send an email. You can run `listSavedBackups` any time to inspect saved copy dates.

### Troubleshooting

- **HTTP 401/403**: confirm the backend **secret** key is used, and that it is the correct Supabase project. New `sb_secret_` keys go in the `apikey` header only; not a Bearer JWT. Check whether the key has been revoked.
- **Table not found / schema access error**: the REST API must expose `public`, and the backend key must allow SELECT. The process intentionally fails rather than silently omitting tables.
- **Too much data / Apps Script runtime limit**: Apps Script has a per-execution runtime and memory allowance. When dataset grows large, migrate to an external scheduled `pg_dump` job with proper database credentials, encrypted backups, and full restore tests.
- **Google Drive permission**: run the Apps Script under the same Google account that owns the private backup folder.
- **API timed out or counts changed**: run manually later; the job does not save partial archives.
- **No backup created after trigger installation**: open **Apps Script → Triggers** and **Executions**; the script owner must maintain access and permissions.

### Security and restoration practices

- These backups contain actual customer and finance records. Keep the Drive folder and the Apps Script project unshared, use Google 2FA, and consider periodic encrypted/offline copies.
- Use a dedicated named Supabase backend key for this workflow so it can be revoked independently. Rotate it if the script/project is ever shared or compromised.
- Deleting the script removes its automatic trigger. Removing the key stops future exports but does not delete existing backups.
- Backups are a recovery source. Restoring requires a verified schema, safe foreign-key load order, and matching Auth IDs. **Never reimport a ZIP directly into live production without a separate restore rehearsal.**
- Google Drive may impose storage and request quotas; 30 days of compressed archives should remain relatively small at current data sizes.
- Existing product images hosted on Google Drive stay where they are. Supabase Storage image files are **not** included in this particular business-data archive.

### Files

- [backup/google-apps-script/Code.gs](./google-apps-script/Code.gs)
- [backup/sql/backup_manifest.sql](./sql/backup_manifest.sql)
