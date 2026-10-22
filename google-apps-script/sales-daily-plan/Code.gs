/**
 * L'Imperial Sales Daily Plan & Results — Google Apps Script backend.
 * Data storage: Google Sheets ONLY. No Supabase database records or Storage buckets.
 *
 * Setup via Script Properties (Project Settings):
 *   SHEET_ID        = 1dDxwdTB59YZa1j3PilEjCTdfhG-zWWDgCMpQhdLmz9s
 *   SUPABASE_URL    = https://msxvnaintafqdgheutfu.supabase.co
 *   SUPABASE_ANON_KEY = public anon/publishable key from your existing app config
 *
 * Deploy > New deployment > Web App: Execute as ME; Who has access: Anyone.
 * This endpoint exposes NO unauthenticated access. Every request independently
 * verifies Supabase session and calls a permission-checked RPC.
 */
const TZ='Asia/Phnom_Penh';
const TAB={reports:'Daily Reports',tasks:'Plan Tasks',reviews:'Manager Reviews',audit:'Audit Log',edits:'Daily Edit Requests'};
const RESULT_SET=['Completed','Partially Completed','Pending','Rescheduled','Cancelled'];
const CATEGORY_SET=['Customer Follow-up','Showroom / Page','Online Inquiries','Product Content','Quotation / SR','Other'];
function respond(data){return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON)}
function doGet(){return respond({ok:false,error:'Use the authenticated Sales & Order Management app to access Daily Reports.'})}
function doPost(e){
 try{
  const raw=String(e&&e.postData&&e.postData.contents||'{}');
  if(raw.length>45000)throw Error('Daily report request is too large');
  const req=JSON.parse(raw);
  if(!req||typeof req!=='object'||Array.isArray(req))throw Error('Invalid request');
  const actor=authenticate(req.token);
  const action=String(req.action||'');
  const payload=req.payload||{};
  if(typeof payload!=='object'||Array.isArray(payload))throw Error('Invalid payload');
  if(!['ping','read','save_am','submit_am','save_pm','submit_pm','review','carry_forward','weekly','request_edit','decide_edit','delete_report','todo_list','todo_save','todo_delete'].includes(action))throw Error('Unknown action');
  const ss=SpreadsheetApp.openById(PropertiesService.getScriptProperties().getProperty('SHEET_ID'));
  const res=dispatch(ss,actor,action,payload);
  return respond({ok:true,data:res});
 }catch(err){
  return respond({ok:false,error:String(err&&err.message||err).slice(0,450)});
 }
}
function authenticate(token){
 token=String(token||'');
 if(!token||token.length>6000)throw Error('Your session has expired. Please sign in again.');
 const p=PropertiesService.getScriptProperties();
 const base=p.getProperty('SUPABASE_URL'),key=p.getProperty('SUPABASE_ANON_KEY');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base||'')||!key)throw Error('Apps Script configuration is incomplete');
 const headers={Authorization:'Bearer '+token,apikey:key};
 const user=UrlFetchApp.fetch(base+'/auth/v1/user',{headers,muteHttpExceptions:true});
 if(user.getResponseCode()!==200)throw Error('Session expired or not authorized');
 const verified=JSON.parse(user.getContentText());
 const grant=UrlFetchApp.fetch(base+'/rest/v1/rpc/get_sales_daily_access',{
  method:'post',contentType:'application/json',headers,
  payload:'{}',muteHttpExceptions:true
 });
 if(grant.getResponseCode()!==200)throw Error('Daily Reports permission is not enabled for your account');
 const access=JSON.parse(grant.getContentText());
 if(String(access.user_id)!==String(verified.id))throw Error('Authentication mismatch');
 return access;
}
function dispatch(ss,actor,action,p){
 if(action==='ping')return{connected:true,sheet:ss.getName(),role:actor.role};
 if(action==='todo_list')return todoList(ss,actor);
 if(action==='todo_save')return todoSave(ss,actor,p);
 if(action==='todo_delete')return todoDelete(ss,actor,p);
 if(action==='read')return readReports(ss,actor,p);
 if(action==='weekly')return weekly(ss,actor,p);
 if(action==='carry_forward')return carryForward(ss,actor,p);
 if(action==='request_edit'||action==='decide_edit')return editAction(ss,actor,action,p);
 if(action==='delete_report')return deleteReport(ss,actor,p);
 const lock=LockService.getScriptLock();
 lock.waitLock(15000);
 try{
  if(action==='save_am'||action==='submit_am')return saveAm(ss,actor,p,action==='submit_am');
  if(action==='save_pm'||action==='submit_pm')return savePm(ss,actor,p,action==='submit_pm');
  if(action==='review')return reviewReport(ss,actor,p);
  throw Error('Unsupported operation');
 }finally{try{SpreadsheetApp.flush()}finally{lock.releaseLock()}}
}
function editSheet(ss){return ss.getSheetByName(TAB.edits)||ss.insertSheet(TAB.edits).appendRow(['ID','Report ID','User ID','Section','Reason','Status','Requested At','Decided By','Decided At','Decision Note'])&&ss.getSheetByName(TAB.edits)}
function editRows(ss){return data(editSheet(ss)).map((row,i)=>({row,n:i+2})).filter(x=>x.row[0])}
function editState(ss,reportId){return editRows(ss).filter(x=>x.row[1]===reportId).map(x=>({id:x.row[0],section:x.row[3],reason:x.row[4],status:x.row[5],requestedAt:x.row[6],decisionNote:x.row[9]}))}
function tab(ss,key){const sheet=ss.getSheetByName(TAB[key]);if(!sheet)throw Error('Missing '+TAB[key]+' sheet. Verify the master workbook.');return sheet}
// Preserve physical row positions even when a workbook owner leaves blank rows.
function data(sheet){return sheet.getDataRange().getDisplayValues().slice(1)}
function now(){return new Date().toISOString()}
function today(){return Utilities.formatDate(new Date(),TZ,'yyyy-MM-dd')}
// Default working calendar: Monday-Saturday; deadline 09:00 on next working morning, Phnom Penh time.
function pmDeadline(date){const d=new Date(iso(date)+'T00:00:00Z');do{d.setUTCDate(d.getUTCDate()+1)}while(d.getUTCDay()===0);return Utilities.formatDate(d,TZ,'yyyy-MM-dd')+'T09:00:00+07:00'}
function pmLate(report){return report[5]==='Submitted'&&report[7]!=='Submitted'&&new Date().getTime()>Date.parse(pmDeadline(report[1]))}
function pmSubmittedLate(report){return report[7]==='Submitted'&&!!report[8]&&Date.parse(report[8])>Date.parse(pmDeadline(report[1]))}
function iso(d){d=String(d||'');const parsed=new Date(d+'T00:00:00Z');if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==d)throw Error('Select a valid date');return d}
function dayWindow(d){const td=today();if(Math.abs(Date.parse(d)-Date.parse(td))>1000*60*60*24*45)throw Error('Daily Report date must be within 45 days of today')}
function val(v,n=2000){v=String(v===null||v===undefined?'':v).trim();if(v.length>n)throw Error('Field exceeds '+n+' characters');return v}
function saveText(v,n){const out=val(v,n);return /^[=+\-@]/.test(out)?"'"+out:out}
function integer(v,min,max){const n=Number(v);if(!Number.isSafeInteger(n)||n<min||n>max)throw Error('Invalid number');return n}
function uid(){return Utilities.getUuid()}
function ensureWrite(a){if(!a.can_write||a.role!=='sales')throw Error('This account cannot submit Sales Daily Plans')}
function ensureReview(a){if(!a.can_review||!['manager','admin','super_admin'].includes(a.role))throw Error('Only authorized management can review Sales reports')}
function reportFor(sheet,date,id){const rows=data(sheet);const i=rows.findIndex(r=>r[1]===date&&r[2]===id);return{i:i<0?-1:i+2,row:i<0?null:rows[i]}}
function taskRows(sheet,reportId){return data(sheet).map((r,i)=>({rowNo:i+2,row:r})).filter(x=>x.row[1]===reportId)}
function taskOutput(r){return{id:r[0],reportId:r[1],date:r[2],userId:r[3],sort:Number(r[4]||0),category:r[5],plan:r[6],customerId:r[7],customerName:r[8],priority:r[9],plannedFollowup:r[10],status:r[11],result:r[12],nextFollowup:r[13],completedAt:r[14]}}
function reportOutput(r,tasks){return{id:r[0],date:r[1],userId:r[2],salesperson:r[3],amStatus:r[5],amSubmittedAt:r[6],pmStatus:r[7],pmSubmittedAt:r[8],reviewStatus:r[9],managerComment:r[10],reviewedBy:r[11],reviewedAt:r[12],pmDeadline:pmDeadline(r[1]),pmOverdue:pmLate(r),pmSubmittedLate:pmSubmittedLate(r),tasks}}
function visibleActor(a,id){return a.can_review?true:String(id)===String(a.user_id)}
function fetchTeam(a){return new Set((a.sales_people||[]).map(x=>String(x.user_id)))}
function visibleReport(a,r){if(!a.can_review)return r[2]===a.user_id;return fetchTeam(a).has(String(r[2]))}
function readReports(ss,a,p){
 const begin=iso(p.start||p.date||today()),end=iso(p.end||p.date||today());
 if(begin>end||Date.parse(end)-Date.parse(begin)>31*86400000)throw Error('Choose a date range of 31 days or less');
 const all=data(tab(ss,'reports')).filter(r=>r[1]>=begin&&r[1]<=end&&visibleReport(a,r)
  &&(!p.userId||String(p.userId)===String(r[2])));
 const taskIndex={};data(tab(ss,'tasks')).forEach(r=>(taskIndex[r[1]]||(taskIndex[r[1]]=[])).push(taskOutput(r)));
 const editIndex={};editRows(ss).forEach(x=>(editIndex[x.row[1]]||(editIndex[x.row[1]]=[])).push({id:x.row[0],section:x.row[3],reason:x.row[4],status:x.row[5],requestedAt:x.row[6],decisionNote:x.row[9]}));
 return{reports:all.map(r=>({...reportOutput(r,(taskIndex[r[0]]||[]).sort((x,y)=>x.sort-y.sort)),editRequests:editIndex[r[0]]||[]})),
 salesPeople:a.can_review?a.sales_people||[]:[],today:today()};
}
function buildTask(t,date,user,reportId,sort,old){
 if(!t||typeof t!=='object')throw Error('Invalid planned task');
 const plan=saveText(t.plan,1000);if(!plan)throw Error('Every morning task needs a description');
 const category=CATEGORY_SET.includes(t.category)?t.category:'Other';
 const priority=['High','Medium','Low'].includes(t.priority)?t.priority:'Medium';
 const due=t.plannedFollowup?iso(t.plannedFollowup):'';
 return[
  old?.[0]||uid(),reportId,date,user,sort,category,plan,
  saveText(t.customerId,64),saveText(t.customerName,140),priority,due,
  old?.[11]||'',old?.[12]||'',old?.[13]||'',old?.[14]||'',old?.[15]||now(),now()
 ];
}
function audit(ss,actor,report,action,before,after,task=''){
 tab(ss,'audit').appendRow([uid(),now(),actor.user_id,report,task,action,
  JSON.stringify(before||{}).slice(0,7000),JSON.stringify(after||{}).slice(0,7000)]);
}
function saveAm(ss,a,p,submit){
 ensureWrite(a);
 const date=iso(p.date||today());dayWindow(date);
 if(!Array.isArray(p.tasks)||p.tasks.length<1||p.tasks.length>20)throw Error('Add between 1 and 20 planned tasks');
 const sh=tab(ss,'reports'),tasks=tab(ss,'tasks');
 const found=reportFor(sh,date,a.user_id),old=found.row;
 const amApproved=old&&editState(ss,old[0]).some(x=>x.section==='AM'&&x.status==='Approved');
 if(old&&old[5]==='Submitted'&&!amApproved)throw Error('Request approval to edit the submitted Morning Plan.');
 if(old&&old[7]==='Submitted')throw Error('Evening Result already submitted. Request the manager to reopen PM before changing the morning tasks.');
 const reportId=old?old[0]:uid();
 const oldTasks=taskRows(tasks,reportId);
 const used=new Set();
 const rows=p.tasks.map((t,i)=>{
  const original=oldTasks.find(x=>String(x.row[0])===String(t.id||''))?.row;
  if(original){if(used.has(original[0]))throw Error('Duplicate task ID');used.add(original[0])}
  return buildTask(t,date,a.user_id,reportId,i+1,original);
 });
 if(old&&old[5]==='Submitted'&&oldTasks.some(x=>x.row[11]||x.row[12])&&
    (rows.length!==oldTasks.length||rows.some((r,i)=>r[0]!==oldTasks[i]?.row[0])))
   throw Error('Cannot add or remove tasks after evening outcomes exist. Contact Super Admin for reconciliation.');
 if(oldTasks.length)oldTasks.slice().sort((x,y)=>y.rowNo-x.rowNo).forEach(x=>tasks.deleteRow(x.rowNo));
 rows.forEach(row=>tasks.appendRow(row));
 const dateNow=now(),fresh=old?old.slice():new Array(15).fill('');
 fresh[0]=reportId;fresh[1]=date;fresh[2]=a.user_id;fresh[3]=saveText(a.display_name,200);fresh[4]=a.role;
 fresh[5]=submit?'Submitted':'Draft';fresh[6]=submit?dateNow:'';
 fresh[7]='Not Started';fresh[9]='Pending';fresh[13]=old?old[13]:dateNow;fresh[14]=dateNow;
 if(found.i<0)sh.appendRow(fresh);else sh.getRange(found.i,1,1,15).setValues([fresh]);
 if(amApproved&&submit)closeEditApproval(ss,reportId,'AM');
 audit(ss,a,reportId,amApproved?(submit?'AM_REVISED_SUBMITTED':'AM_REVISION_DRAFT'):submit?'AM_SUBMITTED':'AM_DRAFT_SAVED',{tasks:oldTasks.map(x=>taskOutput(x.row))},{tasks:rows.map(taskOutput),date});
 return reportOutput(fresh,rows.map(taskOutput));
}
function savePm(ss,a,p,submit){
 ensureWrite(a);
 const date=iso(p.date||today());dayWindow(date);
 const reports=tab(ss,'reports'),tasks=tab(ss,'tasks'),found=reportFor(reports,date,a.user_id);
 if(!found.row||found.row[5]!=='Submitted')throw Error('Submit the Morning Plan before entering Evening Results');
 if(found.row[9]==='Reviewed')throw Error('This report has been reviewed and closed by Manager');
 if(found.row[7]==='Submitted')throw Error('Evening results have already been submitted. Ask Manager to request changes.');
 const original=taskRows(tasks,found.row[0]),received=Array.isArray(p.results)?p.results:[];
 if(received.length!==original.length)throw Error('Update every planned task');
 const byId=new Map(received.map(t=>[String(t.id),t]));
 // Validate the entire request before changing any task, so invalid later rows
 // cannot leave earlier rows saved while the UI reports failure.
 const updates=original.map(entry=>{
  const obj=byId.get(entry.row[0]);if(!obj)throw Error('Result missing for task '+entry.row[6]);
  const status=val(obj.status,35);if(status&&!RESULT_SET.includes(status))throw Error('Choose an allowed result status');
  if(submit&&!status)throw Error('All tasks need an evening status before submitting');
  const result=saveText(obj.result,1500),next=obj.nextFollowup?iso(obj.nextFollowup):'';
  if(submit&&!result.trim())throw Error('Write an actual evening outcome for every planned task');
  if(submit&&status==='Rescheduled'&&!next)throw Error('Rescheduled tasks require a next follow-up date');
  const row=entry.row.slice();
  row[11]=status;row[12]=result;row[13]=next;
  row[14]=status==='Completed'?now():'';row[16]=now();
  return{rowNo:entry.rowNo,row};
 });
 updates.forEach(entry=>tasks.getRange(entry.rowNo,1,1,17).setValues([entry.row]));
 const report=found.row.slice();
 const late=submit&&new Date().getTime()>Date.parse(pmDeadline(date));
 report[7]=submit?'Submitted':'Draft';report[8]=submit?now():'';report[9]='Pending';
 report[14]=now();
 reports.getRange(found.i,1,1,15).setValues([report]);
 audit(ss,a,report[0],submit?(late?'PM_SUBMITTED_LATE':'PM_SUBMITTED'):'PM_DRAFT_SAVED',{tasks:original.map(x=>taskOutput(x.row))},{tasks:updates.map(x=>taskOutput(x.row)),deadline:pmDeadline(date),submittedAt:report[8],late});
 if(submit)closeEditApproval(ss,report[0],'PM');
 return reportOutput(report,taskRows(tasks,report[0]).map(x=>taskOutput(x.row)));
}
function reviewReport(ss,a,p){
 ensureReview(a);
 const id=val(p.reportId,80),decision=val(p.decision,35),comment=saveText(p.comment,1500);
 if(!['Reviewed','Changes Requested'].includes(decision))throw Error('Select Reviewed or Changes Requested');
 if(decision==='Changes Requested'&&!comment)throw Error('Add a reason for the requested changes');
 const sheet=tab(ss,'reports'),rows=data(sheet);
 const idx=rows.findIndex(r=>r[0]===id);
 if(idx<0)throw Error('Report not found');
 const report=rows[idx].slice();
 if(!fetchTeam(a).has(String(report[2])))throw Error('Manager can review Sales-role staff only');
 if(report[7]!=='Submitted')throw Error('The Salesperson has not submitted Evening Results');
 if(report[9]==='Reviewed')throw Error('This report was already reviewed');
 const old={reviewStatus:report[9],reviewedBy:report[11]};
 report[9]=decision;report[10]=comment;report[11]=saveText(a.display_name,200);
 report[12]=now();report[14]=now();
 if(decision==='Changes Requested'){report[7]='Draft';report[8]=''}
 sheet.getRange(idx+2,1,1,15).setValues([report]);
 tab(ss,'reviews').appendRow([uid(),id,report[1],a.user_id,saveText(a.display_name,200),decision,comment,now()]);
 audit(ss,a,id,'MANAGER_'+decision.toUpperCase().replace(' ','_'),old,{comment});
 return{reportId:id,decision,reviewedBy:a.display_name};
}
function closeEditApproval(ss,id,section){editRows(ss).filter(x=>x.row[1]===id&&x.row[3]===section&&x.row[5]==='Approved').forEach(x=>editSheet(ss).getRange(x.n,6).setValue('Used'))}
function editAction(ss,a,action,p){
 const lock=LockService.getScriptLock();lock.waitLock(15000);
 try{
  const sh=tab(ss,'reports'),records=data(sh);
  if(action==='request_edit'){
   ensureWrite(a);const section=val(p.section,2),reason=saveText(p.reason,750),id=val(p.reportId,80);
   if(!['AM','PM'].includes(section)||!reason)throw Error('Select a section and provide a reason');
   const found=records.find(x=>x[0]===id&&x[2]===a.user_id);
   if(!found)throw Error('Report not found for your account');
   if(section==='AM'&&found[5]!=='Submitted')throw Error('Morning Plan is still editable');
   if(section==='PM'&&found[7]!=='Submitted')throw Error('Evening Result is still editable');
   if(editState(ss,id).some(x=>x.section===section&&x.status==='Pending'))throw Error('An edit request is already pending');
   const requestId=uid();editSheet(ss).appendRow([requestId,id,a.user_id,section,reason,'Pending',now(),'','','']);
   audit(ss,a,id,'EDIT_REQUESTED',{section},{requestId,reason});
   return{requestId,status:'Pending'};
  }
  ensureReview(a);const requestId=val(p.requestId,80),decision=val(p.decision,10),note=saveText(p.note,750);
  if(!['Approved','Rejected'].includes(decision))throw Error('Invalid edit request decision');
  const entry=editRows(ss).find(x=>x.row[0]===requestId);
  if(!entry||entry.row[5]!=='Pending')throw Error('Pending request not found');
  const idx=records.findIndex(x=>x[0]===entry.row[1]);if(idx<0)throw Error('Report not found');
  const report=records[idx].slice();
  if(!fetchTeam(a).has(String(report[2])))throw Error('Not authorized to review this salesperson');
  if(report[9]==='Reviewed'&&a.role!=='super_admin')throw Error('Only Super Admin can reopen a reviewed report');
  if(decision==='Approved'&&entry.row[3]==='AM'&&report[7]==='Submitted')throw Error('Reopen the submitted Evening Result before approving Morning Plan changes');
  const row=entry.row.slice();row[5]=decision;row[7]=a.user_id;row[8]=now();row[9]=note;
  editSheet(ss).getRange(entry.n,1,1,10).setValues([row]);
  if(decision==='Approved'){
   if(entry.row[3]==='PM'){report[7]='Draft';report[8]=''}
   if(report[9]==='Reviewed')report[9]='Changes Requested';
   report[14]=now();sh.getRange(idx+2,1,1,15).setValues([report]);
  }
  audit(ss,a,report[0],'EDIT_'+decision.toUpperCase(),{requestId,section:entry.row[3],reason:entry.row[4]},{note});
  return{requestId,status:decision};
 }finally{SpreadsheetApp.flush();lock.releaseLock()}
}
function deleteReport(ss,a,p){
 if(a.role!=='super_admin'||!a.can_review)throw Error('Only Super Admin can delete a daily report');
 const id=val(p.reportId,80),confirm=val(p.confirm,20);
 if(confirm!=='DELETE')throw Error('Type DELETE to confirm');
 const lock=LockService.getScriptLock();lock.waitLock(15000);
 try{
  const sh=tab(ss,'reports'),all=data(sh),index=all.findIndex(r=>r[0]===id);
  if(index<0)throw Error('Report not found');
  const report=all[index];
  if(!fetchTeam(a).has(String(report[2])))throw Error('Report is not associated with an authorized Sales account');
  const relatedTasks=taskRows(tab(ss,'tasks'),id),relatedReviews=data(tab(ss,'reviews')).map((r,i)=>({row:r,n:i+2})).filter(x=>x.row[1]===id),relatedEdits=editRows(ss).filter(x=>x.row[1]===id);
  // Log before deleting; keep audit entries as permanent trace without storing reports in Supabase.
  audit(ss,a,id,'REPORT_DELETED',{report:report,tasks:relatedTasks.map(x=>x.row),reviews:relatedReviews.map(x=>x.row),editRequests:relatedEdits.map(x=>x.row)},{deletedBy:a.user_id,deletedAt:now()});
  relatedTasks.sort((a,b)=>b.rowNo-a.rowNo).forEach(x=>tab(ss,'tasks').deleteRow(x.rowNo));
  relatedReviews.sort((a,b)=>b.n-a.n).forEach(x=>tab(ss,'reviews').deleteRow(x.n));
  relatedEdits.sort((a,b)=>b.n-a.n).forEach(x=>editSheet(ss).deleteRow(x.n));
  sh.deleteRow(index+2);
  return{deleted:true,reportId:id,date:report[1],salesperson:report[3]};
 }finally{SpreadsheetApp.flush();lock.releaseLock()}
}
function carryForward(ss,a,p){
 ensureWrite(a);
 const from=iso(p.from),to=iso(p.to||today());if(from>=to)throw Error('Select a previous day to carry forward');
 const found=reportFor(tab(ss,'reports'),from,a.user_id);
 if(!found.row)return{suggestions:[]};
 const tasks=taskRows(tab(ss,'tasks'),found.row[0]);
 return{suggestions:tasks.filter(t=>!['Completed','Cancelled'].includes(t.row[11])).map(t=>({
  category:t.row[5],plan:t.row[6],customerId:t.row[7],customerName:t.row[8],
  priority:t.row[9],plannedFollowup:t.row[13]||t.row[10],
  sourceTaskId:t.row[0]
 }))};
}
function weekly(ss,a,p){
 const end=iso(p.end||today());const start=iso(p.start||today());
 if(start>end||Date.parse(end)-Date.parse(start)>42*86400000)throw Error('Choose a 42-day window or shorter');
 const reports=data(tab(ss,'reports')).filter(r=>r[1]>=start&&r[1]<=end&&visibleReport(a,r)&&(!p.userId||String(p.userId)===String(r[2])));
 const stats={reports:reports.length,amSubmitted:0,pmSubmitted:0,reviewed:0,
  plannedTasks:0,completed:0,partiallyCompleted:0,pending:0};
 const ids=new Set(reports.map(r=>r[0]));
 reports.forEach(r=>{if(r[5]==='Submitted')stats.amSubmitted++;if(r[7]==='Submitted')stats.pmSubmitted++;if(r[9]==='Reviewed')stats.reviewed++});
 data(tab(ss,'tasks')).filter(r=>ids.has(r[1])).forEach(r=>{
  stats.plannedTasks++;if(r[11]==='Completed')stats.completed++;
  else if(r[11]==='Partially Completed')stats.partiallyCompleted++;
  else if(['Pending','Rescheduled'].includes(r[11]))stats.pending++;
 });
 return stats;
}

function todoSheet(ss){
 let sh=ss.getSheetByName('Sales To-Do');
 if(!sh){sh=ss.insertSheet('Sales To-Do');sh.appendRow(['ID','Title','Description','Assignee ID','Assignee Name','Start Date','Due Date','Priority','Status','Progress','Remarks','Completed At','Created By','Created At','Updated At'])}
 return sh;
}
function todoList(ss,a){
 if(!a.can_write&&!a.can_review)throw Error('Sales task access denied');
 const people=(a.sales_people||[]).map(x=>({id:String(x.user_id),name:String(x.name||x.display_name||x.user_id)}));
 const items=data(todoSheet(ss)).filter(r=>r[0]&&(a.can_review?fetchTeam(a).has(String(r[3])):String(r[3])===String(a.user_id))).map(r=>({
 id:r[0],title:r[1],description:r[2],assigneeId:r[3],assignee:r[4],startDate:r[5],dueDate:r[6],priority:r[7],status:r[8],progress:Number(r[9]||0),remarks:r[10],completedAt:r[11],createdBy:r[12],createdAt:r[13],updatedAt:r[14]
 }));
 return{items,people:a.can_review?people:[],today:today()};
}
function todoSave(ss,a,p){
 if(!a.can_write&&!a.can_review)throw Error('Sales task access denied');
 const lock=LockService.getScriptLock();lock.waitLock(15000);
 try{
 const sh=todoSheet(ss),rows=data(sh),id=val(p.id,80),ix=rows.findIndex(r=>r[0]===id),existing=ix<0?null:rows[ix];
 if(!existing&&id&&!/^[0-9a-f-]{36}$/i.test(id)&&!/^todo-[0-9]+-[a-z0-9]+$/.test(id))throw Error('Invalid task identifier');
 const manager=!!a.can_review&&['manager','admin','super_admin'].includes(a.role);
 if(existing&&String(existing[3])!==String(a.user_id)&&!manager)throw Error('You may update only your own tasks');
 if(!existing&&!manager&&a.role!=='sales')throw Error('Only Sales or management can create tasks');
 const title=saveText(p.title||existing?.[1],200);if(!title)throw Error('Task title is required');
 const assigneeId=manager?val(p.assigneeId||existing?.[3],80):a.user_id;
 if(manager&&!fetchTeam(a).has(String(assigneeId)))throw Error('Choose an authorized Sales employee');
 const status=val(p.status||existing?.[8]||'Pending',30);
 if(!['Pending','In Progress','Completed','Cancelled'].includes(status))throw Error('Invalid status');
 const progress=integer(p.progress===undefined?(existing?.[9]||0):p.progress,0,100);
 const priority=val(p.priority||existing?.[7]||'Medium',20);
 if(!['High','Medium','Low'].includes(priority))throw Error('Invalid priority');
 const start=p.startDate?iso(p.startDate):existing?.[5]||today();
 const due=p.dueDate?iso(p.dueDate):existing?.[6]||'';
 if(due&&start>due)throw Error('Deadline must be on or after start date');
 const completed=status==='Completed'?(existing?.[11]||now()):'';
 const name=(a.sales_people||[]).find(x=>String(x.user_id)===String(assigneeId));
 const row=[existing?.[0]||id||uid(),title,saveText(p.description===undefined?existing?.[2]:p.description,1500),assigneeId,
 name?.name||name?.display_name||existing?.[4]||a.display_name,start,due,priority,status,status==='Completed'?100:progress,
 saveText(p.remarks===undefined?existing?.[10]:p.remarks,1500),completed,existing?.[12]||a.user_id,existing?.[13]||now(),now()];
 if(existing)sh.getRange(ix+2,1,1,15).setValues([row]);else sh.appendRow(row);
 audit(ss,a,row[0],existing?'TODO_UPDATED':'TODO_CREATED',{task:existing||null},{task:row});
 return{id:row[0],saved:true};
 }finally{SpreadsheetApp.flush();lock.releaseLock()}
}

function todoDelete(ss,a,p){
 if(!a.can_review||!['manager','admin','super_admin'].includes(a.role))throw Error('Management permission required to delete tasks');
 const id=val(p.id,80);if(!id)throw Error('Task ID required');
 const lock=LockService.getScriptLock();lock.waitLock(15000);
 try{
  const sh=todoSheet(ss),rows=data(sh),ix=rows.findIndex(r=>String(r[0])===id);
  if(ix<0)throw Error('Task not found');
  const original=rows[ix];
  if(!fetchTeam(a).has(String(original[3])))throw Error('Not authorized to delete this salesperson task');
  audit(ss,a,id,'TODO_DELETED',{task:original},{deletedBy:a.user_id,deletedAt:now()});
  sh.deleteRow(ix+2);
  return{deleted:true,id};
 }finally{SpreadsheetApp.flush();lock.releaseLock()}
}
