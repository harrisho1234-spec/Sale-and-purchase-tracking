/**
 * L'Imperial Price Structure V3 — automatic product-code writeback.
 *
 * Add as a NEW .gs file in the SAME bound Apps Script project that already
 * contains syncProductCodeMaster(). No deployment or public web app required.
 * Run setupProductCodeAutoWriteback() once to install a 5-minute trigger.
 *
 * Source Item List/Stock Movement is intentionally NEVER rewritten.
 * Only the brand tab's Code cell and its relevant QTY / Costing lookup formula
 * are updated. The permanent Product Code Master alias resolves old codes.
 */
const LIMP_CODE_WRITEBACK_BOOK_ID = '1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg';
const LIMP_CODE_WRITEBACK_STOCK_SOURCE = 'https://docs.google.com/spreadsheets/d/1Rsd1lGDMyQCBO2fuTOJ0fNbDV_ojY8MrdhNXGPpiwD0/edit';
const LIMP_CODE_WRITEBACK_ENDPOINT = 'https://msxvnaintafqdgheutfu.supabase.co/functions/v1/sync-price-structure';
const LIMP_CODE_WRITEBACK_BRAND_TABS = [
  'Mobilpiu','Carpet','Artearredo','Bicer','Piermaria','Deluxe Arte',
  'Sude Collection','Katre','Nicollo','Arredoluce','Asfour Crystal',
  'Elite Bohemia','Tiara','Crystal Chandelier','Brass Chandelier',
  'Asfour Accessories','Accessories','ZX lighting','Tong Lou','Bulb'
];

function postProductCodeWriteback_(body) {
  const response = UrlFetchApp.fetch(LIMP_CODE_WRITEBACK_ENDPOINT,{
    method:'post',
    contentType:'application/json',
    headers:{Authorization:'Bearer '+ScriptApp.getOAuthToken()},
    payload:JSON.stringify(Object.assign({
      spreadsheet_id:LIMP_CODE_WRITEBACK_BOOK_ID
    },body)),
    muteHttpExceptions:true
  });
  let result;
  try { result=JSON.parse(response.getContentText()); }
  catch(e) { throw new Error('Code writeback endpoint returned invalid JSON. HTTP '+response.getResponseCode()); }
  if(response.getResponseCode()!==200||result.ok!==true) {
    throw new Error('Code writeback endpoint HTTP '+response.getResponseCode()+': '+String(result.error||'Unexpected response'));
  }
  return result;
}
function normProductCode_(value){return String(value==null?'':value).trim().toLowerCase();}
function writebackFormulaCell_(cell) {
  // Do not overwrite user-created formulas in product code cells.
  if(cell.getFormula())throw new Error('Code cell is formula-driven, not editable. Review manually.');
}
function findWritebackMatches_(book,oldCode,newCode){
  const oldMatches=[],newMatches=[];
  LIMP_CODE_WRITEBACK_BRAND_TABS.forEach(function(tabName){
    const sh=book.getSheetByName(tabName);
    if(!sh)return;
    const count=sh.getLastRow();
    if(count<1)return;
    const values=sh.getRange(1,2,count,1).getDisplayValues();
    values.forEach(function(arr,i){
      const code=normProductCode_(arr[0]);
      if(!code)return;
      if(code===normProductCode_(oldCode))oldMatches.push({sheet:sh,row:i+1});
      if(code===normProductCode_(newCode))newMatches.push({sheet:sh,row:i+1});
    });
  });
  return {oldMatches:oldMatches,newMatches:newMatches};
}
function protectQtyLookup_(sheet,row,originalCode) {
  const cell=sheet.getRange(row,7);
  const formula=cell.getFormula();
  // A previously protected row already prefers the current code and falls
  // back to the ORIGINAL stock ledger code, surviving multiple renames.
  if(formula.indexOf('LIMP_CODE_ALIAS_QTY')>=0)return;
  if(!formula||!/XLOOKUP\s*\(/i.test(formula)||
      formula.indexOf('Item List!A:A')<0||formula.indexOf('Item List!F:F')<0){
    throw new Error('QTY G'+row+' is not the recognized Item List XLOOKUP formula. No code changed.');
  }
  if(!new RegExp('\\bB'+row+'\\b','i').test(formula)){
    throw new Error('QTY G'+row+' does not reference its own Code cell.');
  }
  // XLOOKUP uses NA (no match) rather than a zero fallback, so a legitimate
  // 0 QTY under the current code NEVER pulls old stock quantities.
  const escapedOriginal=String(originalCode).replace(/"/g,'""');
  const source='"'+LIMP_CODE_WRITEBACK_STOCK_SOURCE.replace(/"/g,'""')+'"';
  const newFormula='=LET(LIMP_CODE_ALIAS_QTY, B'+row+
    ', codes, IMPORTRANGE('+source+',"Item List!A:A"),'+
    ' q, IMPORTRANGE('+source+',"Item List!F:F"),'+
    ' IFNA(XLOOKUP(LIMP_CODE_ALIAS_QTY,codes,q),'+
    ' XLOOKUP("'+escapedOriginal+'",codes,q,0)))';
  // Named variable marker makes future edits idempotent.
  return newFormula;
}

function protectItemListLocation_(sheet,row,originalCode) {
  const formula=sheet.getRange(row,13).getFormula();
  if(!formula)return null; // Literal locations remain intact.
  if(formula.indexOf('LIMP_CODE_ALIAS_LOC')>=0)return null;
  if(!/XLOOKUP\s*\(/i.test(formula) ||
     formula.indexOf('Item List!A4:A')<0||formula.indexOf('Item List!G4:G')<0 ||
     !new RegExp('\\bB'+row+'\\b','i').test(formula)){
    throw new Error('Location M'+row+' is not a recognized Item List lookup. No code changed.');
  }
  const original=String(originalCode).replace(/"/g,'""');
  const source='"'+LIMP_CODE_WRITEBACK_STOCK_SOURCE.replace(/"/g,'""')+'"';
  return '=LET(LIMP_CODE_ALIAS_LOC,B'+row+
    ',codes,IMPORTRANGE('+source+',"Item List!A4:A"),'+
    'loc,IMPORTRANGE('+source+',"Item List!G4:G"),'+
    'IFNA(XLOOKUP(LIMP_CODE_ALIAS_LOC,codes,loc),'+
    'IFNA(XLOOKUP("'+original+'",codes,loc),"Sold Out")))';
}
function protectCostOrBrandLookup_(sheet,column,lookupRange,position,label) {
  const end=Math.min(30,Math.max(sheet.getLastRow(),1));
  const formulas=sheet.getRange(1,column,end,1).getFormulas().map(function(r){return r[0]||'';});
  const anchors=[];
  formulas.forEach(function(f,i){
    if(/ARRAYFORMULA\s*\(/i.test(f) && f.indexOf('Costing!')>=0)
      anchors.push({row:i+1,formula:f});
  });
  if(anchors.length>1)throw new Error('Multiple '+label+' array anchors found; review manually.');
  if(anchors.length===0)return null; // Static value or other valid setup.
  const anchor=anchors[0];
  if(anchor.formula.indexOf('Product Code Master')>=0)return null;
  const expected=new RegExp(
    'VLOOKUP\\s*\\(\\s*B'+anchor.row+':B\\s*,\\s*Costing!\\s*'+
      lookupRange+'\\s*,\\s*'+position+'\\s*,\\s*FALSE\\s*\\)','i');
  if(!expected.test(anchor.formula)){
    throw new Error(label+' array formula differs from supported pattern. Review manually.');
  }
  const r=anchor.row;
  const fallback="IFNA(VLOOKUP(B"+r+":B,'Product Code Master'!B:D,3,FALSE),B"+r+":B)";
  const formula='=ARRAYFORMULA(IF(B'+r+':B="",,'+
    'IFERROR(VLOOKUP(B'+r+':B,Costing!'+lookupRange+','+position+',FALSE),'+
    'IFERROR(VLOOKUP('+fallback+',Costing!'+lookupRange+','+position+',FALSE),0))))';
  return {cell:sheet.getRange(r,column),formula:formula};
}
function applyOneProductCodeWriteback_(book,job) {
  const oldCode=String(job.old_code||'').trim();
  const newCode=String(job.new_code||'').trim();
  const original=String(job.source_original_code||'').trim();
  if(!oldCode||!newCode||!original)throw new Error('Missing product-code mapping');
  if(normProductCode_(oldCode)===normProductCode_(newCode))
    throw new Error('Old and new product codes are identical');

  const matches=findWritebackMatches_(book,oldCode,newCode);
  if(matches.oldMatches.length>1)throw new Error('Old code appears on multiple brand rows. Resolve duplicates manually.');
  if(matches.newMatches.length>1)throw new Error('New code appears on multiple brand rows. Resolve duplicates manually.');
  if(matches.oldMatches.length&&matches.newMatches.length)
    throw new Error('Both old and new codes exist on brand rows. Do not duplicate; review manually.');
  if(!matches.oldMatches.length&&!matches.newMatches.length)
    throw new Error('Neither old nor new code appears in an approved brand tab.');

  const target=matches.oldMatches[0]||matches.newMatches[0];
  const oldFound=matches.oldMatches.length===1;
  const codeCell=target.sheet.getRange(target.row,2);
  writebackFormulaCell_(codeCell);

  // Preflight all edits BEFORE changing any cell.
  const qtyFormula=protectQtyLookup_(target.sheet,target.row,original);
  const locationFormula=protectItemListLocation_(target.sheet,target.row,original);
  const cost=protectCostOrBrandLookup_(target.sheet,8,'B:D',3,'Costing');
  const brand=protectCostOrBrandLookup_(target.sheet,16,'B:E',4,'Brand');
  const beforeCode=normProductCode_(codeCell.getDisplayValue());
  if(beforeCode!==normProductCode_(oldFound?oldCode:newCode))
    throw new Error('Brand code changed during the writeback; retry next run.');

  // First protect dependent formulas, then rename Code. Source stock
  // Item List, Stock Movement, Costing, and All are never directly edited.
  if(cost)cost.cell.setFormula(cost.formula);
  if(brand)brand.cell.setFormula(brand.formula);
  if(qtyFormula)target.sheet.getRange(target.row,7).setFormula(qtyFormula);
  if(locationFormula)target.sheet.getRange(target.row,13).setFormula(locationFormula);
  if(oldFound)codeCell.setValue(newCode);
  SpreadsheetApp.flush();
  if(normProductCode_(codeCell.getDisplayValue())!==normProductCode_(newCode))
    throw new Error('Post-save verification of new product code failed.');
  return target.sheet.getName()+'!B'+target.row;
}
function syncProductCodeWritebacks() {
  const lock=LockService.getScriptLock();
  if(!lock.tryLock(25000))return {skipped:'Another code sync is already running'};
  try{
    const pulled=postProductCodeWriteback_({mode:'pull_product_code_writebacks'});
    const jobs=Array.isArray(pulled.jobs)?pulled.jobs:[];
    if(!jobs.length)return {processed:0,queued:0};
    if(typeof syncProductCodeMaster!=='function'){
      throw new Error('Existing syncProductCodeMaster() is missing. Install the earlier Product Code Master script.');
    }
    // Update the alias history FIRST so cost fallback formulas can use it.
    syncProductCodeMaster();
    const book=SpreadsheetApp.openById(LIMP_CODE_WRITEBACK_BOOK_ID);
    let applied=0,review=0,failed=0;
    for(const job of jobs){
      try{
        const location=applyOneProductCodeWriteback_(book,job);
        postProductCodeWriteback_({
          mode:'ack_product_code_writeback',job_id:job.job_id,
          change_token:job.change_token,status:'applied',note:'Updated '+location
        });
        applied++;
      }catch(error){
        const message=String(error&&error.message||error);
        // Fail closed: don't continue changing other rows if this one is uncertain.
        // Preflight conflicts are marked for admin review; network failures
        // are retried (left pending) on the next trigger.
        const reviewable=/multiple brand rows|Both old and new codes|Neither old nor new code|formula-driven|not the recognized|does not reference|Location M|Multiple Costing|Multiple Brand|Costing array formula|Brand array formula|Missing product-code|identical/i.test(message);
        if(reviewable){
          try{
            postProductCodeWriteback_({
              mode:'ack_product_code_writeback',job_id:job.job_id,
              change_token:job.change_token,status:'needs_review',note:message
            });
            review++;
          }catch(ackError){failed++;console.error('Writeback review ack failed',ackError);}
        }else{
          failed++;console.error('Code writeback job '+job.job_id+' failed; retry later: '+message);
        }
      }
    }
    if(review||failed)console.warn('Code writeback: '+applied+' applied, '+review+' need review, '+failed+' pending retry.');
    return {processed:jobs.length,applied:applied,needs_review:review,pending_retry:failed};
  }finally{lock.releaseLock();}
}
function setupProductCodeAutoWriteback() {
  const name='syncProductCodeWritebacks';
  const exists=ScriptApp.getProjectTriggers().some(function(t){return t.getHandlerFunction()===name;});
  if(!exists)ScriptApp.newTrigger(name).timeBased().everyMinutes(5).create();
  return syncProductCodeWritebacks();
}
