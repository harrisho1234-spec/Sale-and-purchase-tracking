/**
 * Price Structure V3 — Product Code Master & History.
 * ADD as a new .gs file inside the EXISTING bound Apps Script project.
 * It never writes to All, brand tabs, or the stock balance/movement mirrors.
 *
 * Setup: run setupProductCodeMasterSync() once as the authorized Google user.
 * Manual refresh: run syncProductCodeMaster().
 * Scheduled refresh: hourly installable trigger created at setup.
 */
const LIMP_CODE_MASTER_SPREADSHEET_ID = '1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg';
const LIMP_CODE_MASTER_TAB = 'Product Code Master';
const LIMP_CODE_MASTER_ENDPOINT =
  'https://msxvnaintafqdgheutfu.supabase.co/functions/v1/sync-price-structure';
const LIMP_CODE_MASTER_FIRST_DATA_ROW = 7;

function syncProductCodeMaster() {
  const book = SpreadsheetApp.openById(LIMP_CODE_MASTER_SPREADSHEET_ID);
  const sh = book.getSheetByName(LIMP_CODE_MASTER_TAB);
  if (!sh) throw new Error('Product Code Master tab is missing in Price Structure V3.');

  const response = UrlFetchApp.fetch(LIMP_CODE_MASTER_ENDPOINT, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      Authorization: 'Bearer ' + ScriptApp.getOAuthToken()
    },
    payload: JSON.stringify({
      spreadsheet_id: LIMP_CODE_MASTER_SPREADSHEET_ID,
      mode: 'pull_product_code_master'
    }),
    muteHttpExceptions: true
  });

  let payload;
  try {
    payload = JSON.parse(response.getContentText());
  } catch (e) {
    throw new Error('Product Code Master endpoint returned invalid JSON (HTTP ' +
      response.getResponseCode() + ').');
  }
  if (response.getResponseCode() !== 200 || !payload || payload.ok !== true ||
      !Array.isArray(payload.rows)) {
    throw new Error('Code Master sync failed (HTTP ' + response.getResponseCode() + '): ' +
      String(payload && payload.error || 'Unexpected response'));
  }

  const data = payload.rows.map(function (r) {
    return [
      String(r.product_id || ''),
      String(r.active_code || ''),
      String(r.historical_code || ''),
      String(r.source_original_code || ''),
      String(r.source_type || ''),
      String(r.last_changed_at || '')
    ];
  });
  // Leave the original Price Structure tabs and stock mirror untouched.
  const previousDataRows = Math.max(0, sh.getLastRow() - LIMP_CODE_MASTER_FIRST_DATA_ROW + 1);
  const requiredTotalRows = LIMP_CODE_MASTER_FIRST_DATA_ROW - 1 + data.length;
  if (requiredTotalRows > sh.getMaxRows()) {
    sh.insertRowsAfter(sh.getMaxRows(), requiredTotalRows - sh.getMaxRows());
  }
  if (previousDataRows > 0) {
    sh.getRange(LIMP_CODE_MASTER_FIRST_DATA_ROW, 1, previousDataRows, 6).clearContent();
  }
  if (data.length) {
    sh.getRange(LIMP_CODE_MASTER_FIRST_DATA_ROW, 1, data.length, 6).setValues(data);
  }
  sh.getRange('B3').setValue(new Date().toISOString() + ' · ' + data.length +
    ' historical code(s) mapped to current products');
  SpreadsheetApp.flush();
  return { historicalCodes: data.length, syncedAt: payload.synced_at };
}

function setupProductCodeMasterSync() {
  // Avoid duplicate scheduled jobs. No onOpen/menu override is installed.
  const exists = ScriptApp.getProjectTriggers().some(function (trigger) {
    return trigger.getHandlerFunction() === 'syncProductCodeMaster';
  });
  if (!exists) {
    ScriptApp.newTrigger('syncProductCodeMaster')
      .timeBased().everyHours(1).create();
  }
  return syncProductCodeMaster();
}
