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
  endpoint: 'https://msxvnaintafqdgheutfu.supabase.co/functions/v1/sync-price-structure',
  batchSize: 150,
  everyMinutes: 15
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("L'Imperial Product Sync")
    .addItem('Sync Products Now', 'syncAllProducts')
    .addItem('Install / Repair Auto Sync', 'setupProductSync')
    .addItem('Test Secure Connection', 'testProductSyncConnection')
    .addSeparator()
    .addItem('Check Sync Status', 'showProductSyncStatus')
    .addToUi();
}

/** Run this ONCE from Apps Script after adding the code. */
function setupProductSync() {
  removeProductSyncTriggers_();

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
      `Automatic sync: on edit + every ${LPH_PRODUCT_SYNC.everyMinutes} minutes.`,
      SpreadsheetApp.getUi().ButtonSet.OK
    );
  } catch (_) {}

  return {
    ok: true,
    connection: ping.ok,
    sent: result.sent,
    upserted: result.upserted,
    automatic: true
  };
}

/** Full sync. Can also be run manually from the custom menu. */
function syncAllProducts(showUi = true) {
  try {
    const products = buildAggregatedProducts_();
    const result = pushProducts_(products, 'full');
    saveSyncStatus_('success', `Full sync: ${result.upserted}/${result.sent} products updated.`);

    if (showUi) {
      try {
        SpreadsheetApp.getUi().alert(
          'Product Sync Complete',
          `${result.upserted} of ${result.sent} products updated in L'Imperial Sales & Order Management.`,
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
    if (sheet.getName() !== LPH_PRODUCT_SYNC.sheetName) return;
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
