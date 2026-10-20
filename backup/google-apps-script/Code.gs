/**
 * L'IMPERIAL • SUPABASE BUSINESS-DATA BACKUP TO GOOGLE DRIVE
 *
 * Standalone Google Apps Script. Runs under the Google account that owns
 * the destination Drive folder. Do NOT publish as a web app or share the script.
 *
 * Configure Script Properties (Project Settings) before running:
 *   SUPABASE_URL          https://YOUR_PROJECT.supabase.co
 *   SUPABASE_SECRET_KEY   sb_secret_... (preferred) or legacy service_role JWT
 *   BACKUP_FOLDER_ID     the private Google Drive folder ID
 *   ALERT_EMAIL          optional email for failed runs
 *   BACKUP_RETENTION_DAYS optional, defaults to 30
 *
 * This is a DATA archive of all public base tables, not a transactional
 * pg_dump or full recovery snapshot of auth/storage files and database schema.
 */
const BACKUP_CONFIG = Object.freeze({
  pageSize: 500,
  maxTables: 500,
  defaultRetentionDays: 30,
  filePrefix: 'Limperial_Supabase_BusinessData_',
  timezone: 'Asia/Phnom_Penh',
  apiRetries: 3
});

function backupSettings_() {
  const p = PropertiesService.getScriptProperties();
  const url = String(p.getProperty('SUPABASE_URL') || '').replace(/\/+$/, '');
  const key = String(p.getProperty('SUPABASE_SECRET_KEY') || '').trim();
  const folderId = String(p.getProperty('BACKUP_FOLDER_ID') || '').trim();
  const alertEmail = String(p.getProperty('ALERT_EMAIL') || '').trim();
  const retentionRaw = Number(p.getProperty('BACKUP_RETENTION_DAYS') || BACKUP_CONFIG.defaultRetentionDays);
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
    throw new Error('Set SUPABASE_URL in Apps Script Properties (https://PROJECT.supabase.co).');
  }
  if (!key || key.startsWith('sb_publishable_')) {
    throw new Error('Set a backend SUPABASE_SECRET_KEY in Apps Script Properties. Do not use a public/anon key.');
  }
  if (!/^[a-zA-Z0-9_-]{15,}$/.test(folderId)) {
    throw new Error('Set the private Google Drive BACKUP_FOLDER_ID in Apps Script Properties.');
  }
  if (!Number.isInteger(retentionRaw) || retentionRaw < 7 || retentionRaw > 365) {
    throw new Error('BACKUP_RETENTION_DAYS must be a whole number between 7 and 365.');
  }
  return { url, key, folderId, alertEmail, retentionDays: retentionRaw };
}

function backupApi_(settings, path, method, payload, extraHeaders) {
  const headers = {
    apikey: settings.key,
    Accept: 'application/json',
    'Accept-Profile': 'public',
    'Content-Profile': 'public'
  };
  Object.keys(extraHeaders || {}).forEach(k => headers[k] = extraHeaders[k]);
  const options = {
    method: method || 'get',
    headers,
    contentType: 'application/json',
    muteHttpExceptions: true,
    followRedirects: false,
    validateHttpsCertificates: true
  };
  if (payload !== undefined) options.payload = JSON.stringify(payload);
  const url = settings.url + '/rest/v1/' + path;
  let response;
  for (let attempt = 1; attempt <= BACKUP_CONFIG.apiRetries; attempt++) {
    response = UrlFetchApp.fetch(url, options);
    const status = response.getResponseCode();
    if (status >= 200 && status < 300) return response;
    if (![429, 500, 502, 503, 504].includes(status) ||
        attempt === BACKUP_CONFIG.apiRetries) {
      // Never print response bodies or authentication headers: can contain data.
      throw new Error('Supabase API request failed: HTTP ' + status +
        '. Check your secret key, RPC permissions and table access.');
    }
    Utilities.sleep(700 * attempt);
  }
  throw new Error('Supabase API unavailable.');
}

function parseRows_(response) {
  try {
    const data = JSON.parse(response.getContentText('UTF-8'));
    if (!Array.isArray(data)) throw new Error('Response is not an array');
    return data;
  } catch (err) {
    throw new Error('Supabase returned an invalid data page.');
  }
}

function rowCountFromHeader_(response) {
  const headers = response.getAllHeaders();
  const key = Object.keys(headers).find(k => k.toLowerCase() === 'content-range');
  if (!key) throw new Error('Content-Range header missing; cannot verify completeness.');
  const contentRange = String(headers[key]);
  const match = contentRange.match(/\/(\d+)$/);
  if (!match) throw new Error('Exact count unavailable for a table.');
  return Number(match[1]);
}

function sha256_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, text,
    Utilities.Charset.UTF_8).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}

function manifest_ (settings) {
  const response = backupApi_(settings, 'rpc/backup_public_tables_manifest', 'post', {});
  const tables = parseRows_(response);
  if (!tables.length || tables.length > BACKUP_CONFIG.maxTables) {
    throw new Error('Unexpected public table count: ' + tables.length +
      '. Aborting rather than saving an incomplete archive.');
  }
  for (const table of tables) {
    if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table.table_name) ||
        !Array.isArray(table.order_columns) || !table.order_columns.length ||
        !table.order_columns.every(x => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(x))) {
      throw new Error('Database backup manifest has an invalid table or primary key definition.');
    }
  }
  return tables;
}

function exportTable_(settings, table) {
  const tableName = table.table_name;
  const order = table.order_columns.map(c => c + '.asc').join(',');
  const rows = [];
  let expectedTotal = null;
  for (let start = 0; ; start += BACKUP_CONFIG.pageSize) {
    const end = start + BACKUP_CONFIG.pageSize - 1;
    const response = backupApi_(settings,
      encodeURIComponent(tableName) + '?select=*&order=' + encodeURIComponent(order),
      'get', undefined, {
        'Range-Unit': 'items',
        Range: start + '-' + end,
        Prefer: 'count=exact'
      });
    const result = parseRows_(response);
    const total = rowCountFromHeader_(response);
    if (expectedTotal === null) expectedTotal = total;
    if (expectedTotal !== total) {
      throw new Error('Table row count changed while backing up "' + tableName +
        '". Aborting rather than saving an inconsistent table.');
    }
    rows.push.apply(rows, result);
    if (rows.length > expectedTotal) {
      throw new Error('Pagination overflow for table "' + tableName + '".');
    }
    if (rows.length === expectedTotal) break;
    if (!result.length) {
      throw new Error('Pagination returned no rows before the count was reached in "' +
        tableName + '".');
    }
  }
  const json = JSON.stringify(rows);
  if (!json) throw new Error('Could not serialize table "' + tableName + '".');
  return {
    blob: Utilities.newBlob(json, 'application/json', 'tables/' + tableName + '.json'),
    manifest: {
      table: tableName,
      rows: rows.length,
      primary_key: table.order_columns,
      bytes_utf8: Utilities.newBlob(json).getBytes().length,
      sha256: sha256_(json)
    }
  };
}

function dateStamp_(date) {
  return Utilities.formatDate(date, BACKUP_CONFIG.timezone, 'yyyyMMdd_HHmmss');
}

function emailBackupFailure_(settings, message) {
  if (!settings || !settings.alertEmail) return;
  try {
    MailApp.sendEmail({
      to: settings.alertEmail,
      subject: 'L’Imperial Supabase backup FAILED',
      body: 'Your daily business-data backup did not complete.\n\n' +
        String(message || 'Unknown error').slice(0, 500) +
        '\n\nPlease open the Google Apps Script Executions page to investigate.' +
        '\nNo incomplete backup was kept as a successful backup.'
    });
  } catch (e) {
    console.error('Backup failure email could not be delivered.');
  }
}

function trimOldBackups_(folder, keepDays) {
  const cutoff = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  const it = folder.getFiles();
  let removed = 0;
  while (it.hasNext()) {
    const file = it.next();
    if (!file.getName().startsWith(BACKUP_CONFIG.filePrefix) ||
        !file.getName().endsWith('.zip')) continue;
    if (file.getDateCreated().getTime() >= cutoff) continue;
    file.setTrashed(true);
    removed++;
  }
  return removed;
}

function verifyArchiveBlob_(zipBlob, expectedManifest) {
  const entries = Utilities.unzip(zipBlob);
  const byName = new Map(entries.map(b => [b.getName(), b]));
  const manifestEntry = byName.get('manifest.json');
  if (!manifestEntry) throw new Error('Archive validation failed: manifest.json missing.');
  const saved = JSON.parse(manifestEntry.getDataAsString('UTF-8'));
  if (saved.tables.length !== expectedManifest.tables.length ||
      saved.tables_total !== expectedManifest.tables_total) {
    throw new Error('Archive validation failed: table manifest mismatch.');
  }
  for (const table of saved.tables) {
    const blob = byName.get('tables/' + table.table + '.json');
    if (!blob) throw new Error('Archive validation failed: missing table ' + table.table);
    const data = blob.getDataAsString('UTF-8');
    if (sha256_(data) !== table.sha256 ||
        JSON.parse(data).length !== table.rows) {
      throw new Error('Archive validation failed: checksum or row-count mismatch for ' +
        table.table);
    }
  }
  return true;
}

/** Perform an immediate complete backup and verify archive contents. */
function runBackupNow() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) throw new Error('Another backup is already running.');
  let settings;
  try {
    settings = backupSettings_();
    const folder = DriveApp.getFolderById(settings.folderId);
    const tables = manifest_(settings);
    const blobs = [];
    const manifest = {
      format: 'limperial-supabase-public-tables-json-v1',
      created_at: new Date().toISOString(),
      project_url: settings.url,
      schema: 'public',
      tables_total: tables.length,
      tables: [],
      scope: 'Data from public base tables only. Not a full physical PostgreSQL, schema, Auth user, or Storage object backup.',
      consistency: 'Each table is fetched in primary-key order, but multiple tables are not captured in one database transaction.'
    };
    for (const table of tables) {
      const output = exportTable_(settings, table);
      manifest.tables.push(output.manifest);
      blobs.push(output.blob);
    }
    const expected = manifest.tables_total;
    if (manifest.tables.length !== expected) {
      throw new Error('The number of exported tables does not match the manifest.');
    }
    blobs.push(Utilities.newBlob(JSON.stringify(manifest, null, 2),
      'application/json', 'manifest.json'));
    const filename = BACKUP_CONFIG.filePrefix + dateStamp_(new Date()) + '.zip';
    const zip = Utilities.zip(blobs, filename);
    verifyArchiveBlob_(zip, manifest);
    const file = folder.createFile(zip);
    try {
      // Re-read Drive's uploaded copy before considering the backup complete.
      verifyArchiveBlob_(file.getBlob(), manifest);
    } catch (err) {
      file.setTrashed(true);
      throw err;
    }
    file.setDescription('Validated daily public-table backup. ' +
      manifest.tables_total + ' tables; created ' + manifest.created_at +
      '. Restricted Google Drive folder. Data-only restore requires a migration plan.');
    const removed = trimOldBackups_(folder, settings.retentionDays);
    console.log('Backup succeeded: ' + file.getName() + ' (' + file.getSize() +
      ' bytes), ' + manifest.tables_total + ' tables. Old copies removed: ' + removed);
    return file.getUrl();
  } catch (error) {
    emailBackupFailure_(settings, error.message);
    console.error('Daily backup failed: ' + String(error.message).slice(0, 500));
    throw error;
  } finally {
    lock.releaseLock();
  }
}

/** Called by the installed recurring Apps Script time trigger. */
function dailyBackup() {
  return runBackupNow();
}

/** Safe preflight: validates authentication, folder access, and visible manifest. */
function testBackupConnection() {
  const settings = backupSettings_();
  const tables = manifest_(settings);
  const folder = DriveApp.getFolderById(settings.folderId);
  console.log('Connected to Supabase and private Drive folder "' + folder.getName() +
    '". Found ' + tables.length + ' public tables to back up. No data uploaded yet.');
  return { connected: true, tables: tables.length, folder: folder.getName() };
}

/**
 * One-time installation. First run testBackupConnection, then runBackupNow
 * and confirm the ZIP exists in Drive, THEN run installDailyBackupTrigger.
 * Apps Script clock triggers run at an approximate hour, not exact minute.
 */
function installDailyBackupTrigger() {
  backupSettings_();
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'dailyBackup')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('dailyBackup')
    .timeBased()
    .atHour(2)
    .everyDays(1)
    .inTimezone(BACKUP_CONFIG.timezone)
    .create();
  console.log('Daily backup trigger installed for approximately 02:00–03:00 Phnom Penh time.');
}

/** Lists matching backups in your private Drive folder. Does not download data. */
function listSavedBackups() {
  const settings = backupSettings_();
  const folder = DriveApp.getFolderById(settings.folderId);
  const files = folder.getFiles();
  const list = [];
  while (files.hasNext()) {
    const file = files.next();
    if (file.getName().startsWith(BACKUP_CONFIG.filePrefix) &&
        file.getName().endsWith('.zip')) {
      list.push({ name: file.getName(), created_at: file.getDateCreated().toISOString(),
        size_bytes: file.getSize(), url: file.getUrl() });
    }
  }
  list.sort((a, b) => b.created_at.localeCompare(a.created_at));
  console.log(list.length + ' backups found. Latest: ' +
    (list.length ? list[0].created_at : 'None'));
  return list;
}
