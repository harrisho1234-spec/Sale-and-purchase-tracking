// L'Imperial - Google Drive product photo upload bridge
// Deploy this as a Google Apps Script Web App:
//   Execute as: Me
//   Who has access: Anyone
// Security is still enforced: every upload must include a valid Supabase access token
// and the caller must currently have admin/super_admin role.

const LIMPERIAL_PRODUCT_PHOTO_FOLDER_ID = '1FzFku17bZEuoCvvfeXmd7MPqOGHQ2dRm';

function doGet() {
  return json_({ ok: true, service: 'LImperial Drive Photo Uploader' });
}

function doPost(e) {
  try {
    const p = (e && e.parameter) || {};
    const accessToken = String(p.access_token || '').trim();
    const supabaseUrl = String(p.supabase_url || '').replace(/\/$/, '');
    const supabaseKey = String(p.supabase_key || '').trim();
    const itemId = String(p.po_item_id || '').trim();
    const fileName = safeName_(String(p.file_name || 'product-photo.jpg'));
    const mimeType = String(p.mime_type || 'image/jpeg').trim();
    const base64 = String(p.base64 || '').trim();
    const updateProduct = String(p.update_product || 'true').toLowerCase() !== 'false';

    if (!accessToken || !supabaseUrl || !supabaseKey || !itemId || !base64) {
      return json_({ ok: false, error: 'Missing required upload fields.' });
    }

    // Verify the supplied Supabase session token is valid.
    const userRes = UrlFetchApp.fetch(supabaseUrl + '/auth/v1/user', {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        apikey: supabaseKey,
        Authorization: 'Bearer ' + accessToken
      }
    });
    if (userRes.getResponseCode() !== 200) {
      return json_({ ok: false, error: 'Invalid or expired app login.' });
    }

    // Verify admin/super_admin using the app's existing security-definer role helper.
    const roleRes = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/rpc/current_app_role', {
      method: 'post',
      contentType: 'application/json',
      payload: '{}',
      muteHttpExceptions: true,
      headers: {
        apikey: supabaseKey,
        Authorization: 'Bearer ' + accessToken
      }
    });
    if (roleRes.getResponseCode() < 200 || roleRes.getResponseCode() >= 300) {
      return json_({ ok: false, error: 'Could not verify app role.' });
    }
    let role = '';
    try { role = JSON.parse(roleRes.getContentText()); } catch (_) { role = roleRes.getContentText(); }
    role = String(role || '').replace(/^"|"$/g, '');
    if (role !== 'admin' && role !== 'super_admin') {
      return json_({ ok: false, error: 'Admin access required.' });
    }

    const bytes = Utilities.base64Decode(base64);
    if (!bytes || !bytes.length) return json_({ ok: false, error: 'Photo file is empty.' });
    if (bytes.length > 8 * 1024 * 1024) return json_({ ok: false, error: 'Photo is larger than 8 MB.' });

    const folder = DriveApp.getFolderById(LIMPERIAL_PRODUCT_PHOTO_FOLDER_ID);
    const stampedName = Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'Asia/Phnom_Penh', 'yyyyMMdd-HHmmss') + '-' + fileName;
    const blob = Utilities.newBlob(bytes, mimeType, stampedName);
    const file = folder.createFile(blob);

    try {
      file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    } catch (shareErr) {
      file.setTrashed(true);
      return json_({ ok: false, error: 'Google Drive could not make this photo viewable by the app.' });
    }

    const fileId = file.getId();
    const imageUrl = 'https://drive.google.com/thumbnail?id=' + encodeURIComponent(fileId) + '&sz=w1200';

    // Save the Drive URL back to Supabase using the user's own app token.
    const rpcRes = UrlFetchApp.fetch(supabaseUrl + '/rest/v1/rpc/set_supplier_po_item_drive_image', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({
        p_item_id: itemId,
        p_image_url: imageUrl,
        p_drive_file_id: fileId,
        p_update_product: updateProduct
      }),
      muteHttpExceptions: true,
      headers: {
        apikey: supabaseKey,
        Authorization: 'Bearer ' + accessToken
      }
    });

    if (rpcRes.getResponseCode() < 200 || rpcRes.getResponseCode() >= 300) {
      file.setTrashed(true);
      return json_({ ok: false, error: 'Photo uploaded but could not be linked to the PO item.' });
    }

    return json_({ ok: true, file_id: fileId, image_url: imageUrl });
  } catch (err) {
    return json_({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function safeName_(name) {
  return String(name || 'product-photo.jpg')
    .replace(/[^a-zA-Z0-9._()\- ]/g, '_')
    .slice(0, 140);
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
