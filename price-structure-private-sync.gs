/**
 * L'Imperial — Secure Product Sync
 * Source: Price Structure (Costing, Sales Price, Stock) V3 → All
 * Destination: Supabase sync-price-structure Edge Function
 *
 * SECURITY:
 * - The Google Sheet stays private.
 * - No Supabase service key or shared secret is stored in this script.
 * - Apps Script sends its short-lived Google OAuth access token.
 * - Supabase verifies that token directly with Google.
 * - Supabase only accepts the authorized Google account and this spreadsheet ID.
 */

const LPH_PRODUCT_SYNC = {
  spreadsheetId: '1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg',
  sheetName: 'All',
  appSheetName: 'App Products',
  appSheetColumns: 24,
  endpoint: 'https://msxvnaintafqdgheutfu.supabase.co/functions/v1/sync-price-structure',
  batchSize: 150,
  everyMinutes: 15
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("L'Imperial Product Sync")
    .addItem('Sync Products Now', 'syncAllProducts')
    .addItem('Sync App Changes to Sheet Now', 'syncAppProductsToSheet')
    .addItem('Install / Repair Auto Sync', 'setupProductSync')
    .addItem('Test Secure Connection', 'testProductSyncConnection')
    .addSeparator()
    .addItem('Check Sync Status', 'showProductSyncStatus')
    .addToUi();
}

/** Run this ONCE from Apps Script after adding the code. */
function setupProductSync() {
  removeProductSyncTriggers_();

  const ss = SpreadsheetApp.openById(LPH_PRODUCT_SYNC.spreadsheetId);
  ensureAppProductsSheet_(ss);

  ScriptApp.newTrigger('syncEditedProducts')
    .forSpreadsheet(LPH_PRODUCT_SYNC.spreadsheetId)
    .onEdit()
    .create();

  ScriptApp.newTrigger('syncAllProducts')
    .timeBased()
    .everyMinutes(LPH_PRODUCT_SYNC.everyMinutes)
    .create();

  const ping = testProductSyncConnection(false);
  const result = syncAllProducts(false);

  try {
    SpreadsheetApp.getUi().alert(
      'Product Sync Installed',
      `Secure connection: ${ping.ok ? 'OK' : 'FAILED'}\n` +
      `Products sent: ${result.sent}\n` +
      `Products updated: ${result.upserted}\n` +
      `App changes written to Sheet: ${result.sheetWrites || 0}\n` +
      `Automatic sync: Sheet edits + app changes every ${LPH_PRODUCT_SYNC.everyMinutes} minutes.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (_) {}

  return {
    ok: true,
    connection: ping.ok,
    sent: result.sent,
    upserted: result.upserted,
    sheetWrites: result.sheetWrites || 0,
    automatic: true
  };
}

/** Full sync. Can also be run manually from the custom menu. */
function syncAllProducts(showUi = true) {
  try {
    const appToSheet = syncAppProductsToSheet_(false);
    const products = buildAggregatedProducts_();
    const result = pushProducts_(products, 'full');
    result.sheetWrites = appToSheet.written || 0;
    saveSyncStatus_('success', `Full sync: ${result.upserted}/${result.sent} products updated; ${result.sheetWrites} app changes written to App Products.`);

    if (showUi) {
      try {
        SpreadsheetApp.getUi().alert(
          'Product Sync Complete',
          `${result.upserted} of ${result.sent} products updated in L'Imperial Sales & Order Management.\n${result.sheetWrites || 0} app changes written to App Products.`,
          SpreadsheetApp.getUi().ButtonSet.OK
        );
      } catch (_) {}
    }
    return result;
  } catch (err) {
    saveSyncStatus_('error', String(err && err.message ? err.message : err));
    throw err;
  }
}

/**
 * Installable on-edit trigger.
 * It only re-syncs the product code(s) on the edited row(s), but calculates
 * totals from every matching row in All so duplicate product codes remain safe.
 */
function syncEditedProducts(e) {
  try {
    if (!e || !e.range) return;
    const sheet = e.range.getSheet();
    if (![LPH_PRODUCT_SYNC.sheetName, LPH_PRODUCT_SYNC.appSheetName].includes(sheet.getName())) return;
    if (e.range.getLastRow() < 2) return;

    const header = getHeaderMap_(sheet);
    const codeCol = header['Code'];
    if (!codeCol) throw new Error('Column "Code" was not found in the All sheet.');

    const startRow = Math.max(2, e.range.getRow());
    const rowCount = Math.max(1, e.range.getLastRow() - startRow + 1);
    const codes = sheet.getRange(startRow, codeCol, rowCount, 1)
      .getDisplayValues()
      .flat()
      .map(v => String(v || '').trim())
      .filter(Boolean);

    if (!codes.length) return;
    const products = buildAggregatedProducts_(new Set(codes));
    if (!products.length) return;

    const result = pushProducts_(products, 'edit');
    saveSyncStatus_('success', `Edit sync: ${result.upserted}/${result.sent} products updated.`);
  } catch (err) {
    saveSyncStatus_('error', String(err && err.message ? err.message : err));
    throw err;
  }
}


/**
 * APP → GOOGLE SHEET
 *
 * Pulls product changes created/edited in the L'Imperial app and writes them
 * back into Price Structure V3 → All. The Sheet remains private.
 */
function syncAppProductsToSheet(showUi = true) {
  try {
    const result = syncAppProductsToSheet_(showUi);
    saveSyncStatus_(
      'success',
      `App → Sheet: ${result.written} product change(s) written and ${result.acked} acknowledged.`
    );
    return result;
  } catch (err) {
    saveSyncStatus_('error', String(err && err.message ? err.message : err));
    throw err;
  }
}

function syncAppProductsToSheet_(showUi = false) {
  const response = callSyncApi_({
    mode: 'pull_app_changes',
    spreadsheet_id: LPH_PRODUCT_SYNC.spreadsheetId,
    limit: 250
  });

  const changes = Array.isArray(response.changes) ? response.changes : [];
  if (!changes.length) {
    const result = { pulled: 0, written: 0, acked: 0, superseded: 0 };
    if (showUi) {
      try {
        SpreadsheetApp.getUi().alert(
          'App → App Products',
          'No pending app product changes.',
          SpreadsheetApp.getUi().ButtonSet.OK
        );
      } catch (_) {}
    }
    return result;
  }

  const ss = SpreadsheetApp.openById(LPH_PRODUCT_SYNC.spreadsheetId);
  const sheet = ensureAppProductsSheet_(ss);

  const header = getHeaderMap_(sheet);
  const codeCol = header['Code'];
  if (!codeCol) throw new Error('Column "Code" was not found in the All sheet.');

  const rowByCode = new Map();
  const lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    const codes = sheet.getRange(2, codeCol, lastRow - 1, 1).getDisplayValues().flat();
    codes.forEach((v, i) => {
      const key = String(v || '').trim().toLowerCase();
      if (key && !rowByCode.has(key)) rowByCode.set(key, i + 2);
    });
  }

  const acks = [];

  changes.forEach(change => {
    const code = String(change.code || '').trim();
    if (!code) return;

    const newKey = code.toLowerCase();
    const oldKey = String(change.source_code || '').trim().toLowerCase();
    let rowNum = rowByCode.get(newKey) || (oldKey ? rowByCode.get(oldKey) : null);

    if (!rowNum) {
      const newRow = new Array(sheet.getLastColumn()).fill('');
      sheet.appendRow(newRow);
      rowNum = sheet.getLastRow();
    }

    setSheetField_(sheet, header, rowNum, 'Code', code);
    setSheetField_(sheet, header, rowNum, 'Item Name', change.item_name || code);
    setSheetField_(sheet, header, rowNum, 'Brand', change.brand || change.vendor_name || '');
    setSheetField_(sheet, header, rowNum, 'Class', change.class || '');
    setSheetField_(sheet, header, rowNum, 'Description', change.description || '');
    setSheetField_(sheet, header, rowNum, 'Location', change.location || '');
    setSheetField_(sheet, header, rowNum, 'IMG link', change.image_url || '');
    setSheetField_(sheet, header, rowNum, 'QTY', number_(change.stock_qty));
    setSheetField_(sheet, header, rowNum, 'Costing', number_(change.sheet_cost));
    setSheetField_(sheet, header, rowNum, 'Sales Price', number_(change.sales_price));
    setSheetField_(sheet, header, rowNum, 'Actual Sales Price', number_(change.sales_price));

    rowByCode.set(newKey, rowNum);

    acks.push({
      product_id: change.product_id,
      change_token: change.change_token
    });
  });

  SpreadsheetApp.flush();

  const ack = acks.length
    ? callSyncApi_({
        mode: 'ack_app_changes',
        spreadsheet_id: LPH_PRODUCT_SYNC.spreadsheetId,
        acks: acks
      })
    : { acknowledged: 0, superseded: 0 };

  const result = {
    pulled: changes.length,
    written: acks.length,
    acked: Number(ack.acknowledged || 0),
    superseded: Number(ack.superseded || 0)
  };

  if (showUi) {
    try {
      SpreadsheetApp.getUi().alert(
        'App → App Products Complete',
        `${result.written} product change(s) written to the App Products sheet.\n${result.acked} acknowledged by Supabase.`,
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (_) {}
  }

  return result;
}

function ensureAppProductsSheet_(ss) {
  const allSheet = ss.getSheetByName(LPH_PRODUCT_SYNC.sheetName);
  if (!allSheet) throw new Error(`Sheet "${LPH_PRODUCT_SYNC.sheetName}" was not found.`);

  let appSheet = ss.getSheetByName(LPH_PRODUCT_SYNC.appSheetName);
  if (!appSheet) appSheet = ss.insertSheet(LPH_PRODUCT_SYNC.appSheetName);

  const requiredCols = LPH_PRODUCT_SYNC.appSheetColumns;
  if (appSheet.getMaxColumns() < requiredCols) {
    appSheet.insertColumnsAfter(appSheet.getMaxColumns(), requiredCols - appSheet.getMaxColumns());
  }

  const headers = allSheet.getRange(1, 1, 1, requiredCols).getValues();
  appSheet.getRange(1, 1, 1, requiredCols).setValues(headers);
  appSheet.setFrozenRows(1);

  return appSheet;
}

function setSheetField_(sheet, headerMap, rowNum, headerName, value) {
  const col = headerMap[headerName];
  if (!col) return;
  sheet.getRange(rowNum, col).setValue(value == null ? '' : value);
}

function testProductSyncConnection(showUi = true) {
  const payload = {
    mode: 'ping',
    spreadsheet_id: LPH_PRODUCT_SYNC.spreadsheetId
  };
  const response = callSyncApi_(payload);
  const ok = !!response.ok;

  if (showUi) {
    try {
      SpreadsheetApp.getUi().alert(
        ok ? 'Secure Connection OK' : 'Secure Connection Failed',
        ok
          ? `Authenticated as ${response.caller || 'authorized Google account'}.`
          : (response.error || 'Unknown error'),
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (_) {}
  }
  return response;
}

function showProductSyncStatus() {
  const props = PropertiesService.getDocumentProperties();
  const when = props.getProperty('LPH_PRODUCT_SYNC_LAST_TIME') || 'Not yet run';
  const status = props.getProperty('LPH_PRODUCT_SYNC_LAST_STATUS') || 'Unknown';
  const message = props.getProperty('LPH_PRODUCT_SYNC_LAST_MESSAGE') || '';
  SpreadsheetApp.getUi().alert(
    'L\'Imperial Product Sync Status',
    `Last run: ${when}\nStatus: ${status}\n${message}`,
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

function buildAggregatedProducts_(onlyCodes) {
  const ss = SpreadsheetApp.openById(LPH_PRODUCT_SYNC.spreadsheetId);
  const sheet = ss.getSheetByName(LPH_PRODUCT_SYNC.sheetName);
  if (!sheet) throw new Error(`Sheet "${LPH_PRODUCT_SYNC.sheetName}" was not found.`);

  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  const headers = values[0].map(v => String(v || '').trim());
  const idx = {};
  headers.forEach((h, i) => { if (h) idx[h] = i; });
  if (idx['Code'] === undefined) throw new Error('Column "Code" was not found in the All sheet.');

  const wanted = onlyCodes
    ? new Set(Array.from(onlyCodes).map(v => String(v || '').trim().toLowerCase()))
    : null;

  const map = new Map();
  for (let r = 1; r < values.length; r++) {
    const row = values[r];
    const code = text_(row[idx['Code']]);
    if (!code) continue;
    if (wanted && !wanted.has(code.toLowerCase())) continue;

    const actual = number_(cell_(row, idx, 'Actual Sales Price'));
    const listed = number_(cell_(row, idx, 'Sales Price'));
    const qty = number_(cell_(row, idx, 'QTY'));
    const cost = number_(cell_(row, idx, 'Costing'));

    const next = {
      code: code,
      item_name: text_(cell_(row, idx, 'Item Name')) || code,
      brand: text_(cell_(row, idx, 'Brand')),
      class: text_(cell_(row, idx, 'Class')),
      description: text_(cell_(row, idx, 'Description')),
      location: text_(cell_(row, idx, 'Location')),
      image_url: text_(cell_(row, idx, 'IMG link')),
      stock_qty: qty,
      sales_price: actual > 0 ? actual : listed,
      cost: cost,
      vendor: text_(cell_(row, idx, 'Brand'))
    };

    const key = code.toLowerCase();
    const existing = map.get(key);
    if (!existing) {
      map.set(key, next);
    } else {
      existing.stock_qty += qty;
      if (next.item_name) existing.item_name = next.item_name;
      if (next.brand) { existing.brand = next.brand; existing.vendor = next.brand; }
      if (next.class) existing.class = next.class;
      if (next.description) existing.description = next.description;
      if (next.location) existing.location = next.location;
      if (next.image_url) existing.image_url = next.image_url;
      if (actual > 0 || listed > 0) existing.sales_price = next.sales_price;
      if (cost > 0) existing.cost = cost;
    }
  }
  return Array.from(map.values());
}

function pushProducts_(products, mode) {
  let upserted = 0;
  let skipped = 0;

  for (let i = 0; i < products.length; i += LPH_PRODUCT_SYNC.batchSize) {
    const batch = products.slice(i, i + LPH_PRODUCT_SYNC.batchSize);
    const response = callSyncApi_({
      mode: mode || 'push',
      spreadsheet_id: LPH_PRODUCT_SYNC.spreadsheetId,
      products: batch
    });
    if (!response.ok) throw new Error(response.error || 'Supabase product sync failed.');
    upserted += Number(response.upserted || 0);
    skipped += Number(response.skipped_app_managed || 0);
  }

  return { sent: products.length, upserted: upserted, skipped: skipped };
}

function callSyncApi_(payload) {
  const accessToken = ScriptApp.getOAuthToken();
  if (!accessToken) {
    throw new Error('Google authorization is unavailable. Run setupProductSync() manually and approve the requested permissions.');
  }

  const response = UrlFetchApp.fetch(LPH_PRODUCT_SYNC.endpoint, {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + accessToken },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const status = response.getResponseCode();
  let body = {};
  try {
    body = JSON.parse(response.getContentText() || '{}');
  } catch (_) {
    body = { ok: false, error: response.getContentText() || `HTTP ${status}` };
  }

  if (status < 200 || status >= 300) {
    throw new Error(body.error || `Product sync returned HTTP ${status}.`);
  }
  return body;
}

function getHeaderMap_(sheet) {
  const lastCol = sheet.getLastColumn();
  const headers = sheet.getRange(1, 1, 1, lastCol).getDisplayValues()[0];
  const map = {};
  headers.forEach((h, i) => {
    const key = String(h || '').trim();
    if (key) map[key] = i + 1;
  });
  return map;
}

function removeProductSyncTriggers_() {
  const handlers = new Set(['syncEditedProducts', 'syncAllProducts']);
  ScriptApp.getProjectTriggers().forEach(t => {
    if (handlers.has(t.getHandlerFunction())) ScriptApp.deleteTrigger(t);
  });
}

function saveSyncStatus_(status, message) {
  const props = PropertiesService.getDocumentProperties();
  props.setProperty('LPH_PRODUCT_SYNC_LAST_TIME', new Date().toISOString());
  props.setProperty('LPH_PRODUCT_SYNC_LAST_STATUS', status);
  props.setProperty('LPH_PRODUCT_SYNC_LAST_MESSAGE', message || '');
}

function cell_(row, idx, header) {
  const i = idx[header];
  return i === undefined ? '' : row[i];
}

function text_(v) {
  return v == null ? '' : String(v).trim();
}

function number_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v == null ? '' : v).replace(/[$€£¥,%\s,]/g, ''));
  return isFinite(n) ? n : 0;
}
