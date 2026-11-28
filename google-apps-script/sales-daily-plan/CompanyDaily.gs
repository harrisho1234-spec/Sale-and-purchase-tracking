/* L'Imperial Company Daily Work — add as a second file to the existing
 * Sales Daily Apps Script project. Uses isolated Google Sheets tabs.
 * Every entrypoint requires a verified active staff Supabase login. */
const CD_CATS={
 Sales:['Customer Follow-up','Showroom / Page','Online Inquiries','Product Content','Quotation / SR','Other'],
 Marketing:['Artwork / Poster','Video','Photo','Content Writing','Social Media','Promotion','Event','Catalog','Other'],
 Stock:['Stock Receiving','Stock Count','Stock Transfer','Delivery Preparation','DO Release','Stock Adjustment','Other'],
 Project:['Project Site Visit','Customer / Contractor Coordination','Installation Scheduling','Delivery Coordination','Project Progress Follow-up','Measurement / Site Inspection','Supplier / Technician Coordination','Documentation & Reporting','Mock-up','Proposal','3D Rendering','Drawing Revision','Other'],
 'Product Assistant':['Product Code Verification','Catalog Update','Product Photo','Price Verification','Product Selection','Quotation Support','Other'],
 Management:['Review','Coordination','Other']
};
const CD_HEADERS={
 tasks:['ID','Title','Department','Category','Description','Assignee ID','Assignee','Requester ID','Requester','Requester Department','Status','Request Status','Priority','Due Date','Progress','Result','Related Ref','Updated At','Created At','Created By'],
 daily:['ID','Date','User ID','Department','AM Status','AM At','Task IDs JSON','PM Status','PM At','Results JSON','Review Status','Manager Comment','Reviewed By','Reviewed At','Late PM Allowed','Late Approved By','Late Approved At'],
 audit:['When','Actor ID','Action','Entity','Entity ID','Before JSON','After JSON']
};
function companyAuthenticate(token){
 token=String(token||'');if(!token||token.length>6000)throw Error('Sign in first');
 const props=PropertiesService.getScriptProperties(),url=props.getProperty('SUPABASE_URL'),key=props.getProperty('SUPABASE_ANON_KEY');
 if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url||'')||!key)throw Error('Authentication not configured');
 const headers={Authorization:'Bearer '+token,apikey:key};
 const user=UrlFetchApp.fetch(url+'/auth/v1/user',{headers,muteHttpExceptions:true});
 if(user.getResponseCode()!==200)throw Error('Session expired');
 const access=UrlFetchApp.fetch(url+'/rest/v1/rpc/get_company_daily_access',{method:'post',contentType:'application/json',headers,payload:'{}',muteHttpExceptions:true});
 if(access.getResponseCode()!==200)throw Error('Daily Work access denied');
 const a=JSON.parse(access.getContentText()),u=JSON.parse(user.getContentText());
 if(String(a.user_id)!==String(u.id))throw Error('Authentication mismatch');
 return a;
}
function cdTab(ss,k){const name='Company Daily '+(k==='tasks'?'Tasks':k==='daily'?'Reports':'Audit');
 let sh=ss.getSheetByName(name);
 if(!sh){sh=ss.insertSheet(name);sh.appendRow(CD_HEADERS[k])}
 // Only the Company Daily Reports tab gains the three non-destructive late-approval columns.
 if(k==='daily' && sh.getLastColumn()<CD_HEADERS.daily.length){
  const first=sh.getLastColumn()+1,missing=CD_HEADERS.daily.slice(first-1);
  if(sh.getMaxColumns()<CD_HEADERS.daily.length)sh.insertColumnsAfter(sh.getMaxColumns(),CD_HEADERS.daily.length-sh.getMaxColumns());
  sh.getRange(1,first,1,missing.length).setValues([missing]);
 }
 return sh}
function cdRows(sh){return sh.getDataRange().getDisplayValues().slice(1).map((r,i)=>({r,n:i+2})).filter(x=>x.r[0])}
function cdText(v,n){const s=String(v==null?'':v).trim();if(s.length>n)throw Error('Field exceeds '+n+' characters');return /^[=+@\-]/.test(s)?"'"+s:s}
function cdRaw(v,n){const s=String(v==null?'':v).trim();if(s.length>n)throw Error('Field exceeds '+n+' characters');return s}
function cdDate(v){const d=String(v||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(d)||new Date(d+'T00:00:00Z').toISOString().slice(0,10)!==d)throw Error('Invalid date');return d}
function cdManager(a,d){return a.all_departments===true||(a.can_review===true&&a.department===d)}
function cdTask(r){return{id:r[0],title:r[1],department:r[2],category:r[3],description:r[4],assigneeId:r[5],assignee:r[6],requestedBy:r[7],requester:r[8],requesterDepartment:r[9],status:r[10],requestStatus:r[11],priority:r[12],dueDate:r[13],progress:Number(r[14]||0),result:r[15],relatedRef:r[16],updatedAt:r[17],createdAt:r[18]}}
function cdDaily(r){let ids=[],results=[];try{ids=JSON.parse(r[6]||'[]')}catch(_){}try{results=JSON.parse(r[9]||'[]')}catch(_){}
 return{id:r[0],date:r[1],userId:r[2],department:r[3],amStatus:r[4],amAt:r[5],taskIds:ids,pmStatus:r[7],pmAt:r[8],results,reviewStatus:r[10],comment:r[11],reviewedBy:r[12],reviewedAt:r[13],latePmAllowed:String(r[14]||'').toUpperCase()==='TRUE',latePmApprovedBy:r[15]||'',latePmApprovedAt:r[16]||''}}
function cdAudit(ss,a,action,type,id,before,after){cdTab(ss,'audit').appendRow([new Date().toISOString(),a.user_id,action,type,id,JSON.stringify(before||{}).slice(0,6000),JSON.stringify(after||{}).slice(0,6000)])}
function cdList(ss,a){
 const tasks=cdRows(cdTab(ss,'tasks')).map(x=>cdTask(x.r)).filter(t=>cdManager(a,t.department)||String(t.requestedBy)===String(a.user_id)||(String(t.assigneeId)===String(a.user_id)&&t.requestStatus==='Approved'));
 const daily=cdRows(cdTab(ss,'daily')).filter(x=>String(x.r[2])===String(a.user_id)||cdManager(a,x.r[3])).map(x=>cdDaily(x.r));
 return{tasks,daily,staff:a.staff||[],categories:CD_CATS,actor:{id:a.user_id,name:a.name,department:a.department,role:a.role,canReview:a.can_review,allDepartments:a.all_departments}};
}
function cdWithLock(callback){const lock=LockService.getScriptLock();lock.waitLock(15000);try{return callback()}finally{SpreadsheetApp.flush();lock.releaseLock()}}
function cdSaveTask(ss,a,p){return cdWithLock(function(){
 const id=cdRaw(p.id,80),sh=cdTab(ss,'tasks'),found=cdRows(sh).find(x=>x.r[0]===id);
 const title=cdText(p.title,180);if(!title)throw Error('Task title required');
 const priority=['Low','Medium','High','Urgent'].includes(p.priority)?p.priority:'Medium';
 const description=cdText(p.description,1200),ref=cdText(p.relatedRef,200);
 const due=p.dueDate?cdDate(p.dueDate):'';
 if(found){
  const old=cdTask(found.r);
  if(!cdManager(a,old.department)&&(String(old.assigneeId)!==String(a.user_id)||old.requestStatus!=='Approved'))throw Error('Only an approved assignee or department manager can update task');
  const row=found.r.slice();
  if(cdManager(a,old.department)){row[1]=title;row[3]=CD_CATS[old.department].includes(p.category)?p.category:'Other';row[4]=description;row[12]=priority;row[13]=due;row[16]=ref}
  const status=String(p.status||old.status);
  if(!['Not Started','In Progress','Completed','Blocked','Cancelled'].includes(status))throw Error('Invalid status');
  row[10]=status;row[14]=Math.min(100,Math.max(0,Number(p.progress)||0));row[15]=cdText(p.result,1200);row[17]=new Date().toISOString();
  sh.getRange(found.n,1,1,20).setValues([row]);cdAudit(ss,a,'UPDATE_TASK','task',id,old,cdTask(row));return cdTask(row);
 }
 const staff=(a.staff||[]).find(x=>String(x.id)===String(p.assigneeId||a.user_id));
 if(!staff||!CD_CATS[staff.department])throw Error('Assign to an active authorized employee');
 const approval=String(staff.id)===String(a.user_id)||cdManager(a,staff.department)?'Approved':'Pending Approval';
 const stamp=new Date().toISOString(),key=Utilities.getUuid();
 const row=[key,title,staff.department,CD_CATS[staff.department].includes(p.category)?p.category:'Other',description,staff.id,cdText(staff.name,120),a.user_id,cdText(a.name,120),a.department,'Not Started',approval,priority,due,0,'',ref,stamp,stamp,a.user_id];
 sh.appendRow(row);cdAudit(ss,a,'CREATE_TASK','task',key,{},cdTask(row));return cdTask(row);
})}
function cdDecide(ss,a,p){return cdWithLock(function(){
 const sh=cdTab(ss,'tasks'),f=cdRows(sh).find(x=>x.r[0]===String(p.id||''));
 if(!f)throw Error('Task not found');
 if(!cdManager(a,f.r[2]))throw Error('Receiving department manager approval required');
 if(f.r[11]!=='Pending Approval')throw Error('Request already processed');
 if(!['Approve','Reject'].includes(p.decision))throw Error('Invalid decision');
 const before=cdTask(f.r),row=f.r.slice();row[11]=p.decision==='Approve'?'Approved':'Rejected';row[17]=new Date().toISOString();
 sh.getRange(f.n,1,1,20).setValues([row]);cdAudit(ss,a,'SUPPORT_'+p.decision.toUpperCase(),'task',row[0],before,cdTask(row));return cdTask(row);
})}
function cdSubmitAM(ss,a,p){return cdWithLock(function(){
 const date=cdDate(p.date),ids=Array.isArray(p.taskIds)?[...new Set(p.taskIds.map(String))]:[];
 if(!ids.length||ids.length>25)throw Error('Choose 1–25 tasks');
 const tasks=cdRows(cdTab(ss,'tasks')).map(x=>cdTask(x.r));
 if(ids.some(id=>!tasks.some(t=>t.id===id&&String(t.assigneeId)===String(a.user_id)&&t.requestStatus==='Approved'&&t.status!=='Cancelled')))throw Error('Selected tasks must be approved and assigned to you');
 const sh=cdTab(ss,'daily'),found=cdRows(sh).find(x=>x.r[1]===date&&String(x.r[2])===String(a.user_id));
 if(found&&found.r[4]==='Submitted')throw Error('Morning Plan already submitted');
 const row=found?found.r.slice():[Utilities.getUuid(),date,a.user_id,a.department,'','','','Not Started','','[]','Not Reviewed','','','','FALSE','',''];
 row[4]='Submitted';row[5]=new Date().toISOString();row[6]=JSON.stringify(ids);
 if(found)sh.getRange(found.n,1,1,17).setValues([row.slice(0,17)]);else sh.appendRow(row.slice(0,17));
 cdAudit(ss,a,'MORNING_SUBMITTED','daily',row[0],{},cdDaily(row));return cdDaily(row);
})}
function cdSubmitPM(ss,a,p){return cdWithLock(function(){
 const date=cdDate(p.date),sh=cdTab(ss,'daily'),found=cdRows(sh).find(x=>x.r[1]===date&&String(x.r[2])===String(a.user_id));
 if(!found||found.r[4]!=='Submitted')throw Error('Submit Morning Plan first');
 if(found.r[7]==='Submitted'&&found.r[10]!=='Changes Requested')throw Error('Evening Result already submitted');
 // Same next-day 10:00 AM Phnom Penh rule as Sales, with manager-authorized override.
 // A reviewer-requested correction is not treated as the initial missing evening report.
 if(a.department==='Project' && found.r[10]!=='Changes Requested'){
  const deadline=Date.parse(date+'T10:00:00+07:00')+24*60*60*1000;
  const allowedLate=String(found.r[14]||'').toUpperCase()==='TRUE';
  if(Date.now()>deadline && !allowedLate)throw Error('Evening Result deadline passed (next day 10:00 AM Cambodia time). Ask your Project Manager/Admin to allow a late submission.');
 }
 const ids=JSON.parse(found.r[6]||'[]'),res=Array.isArray(p.results)?p.results:[];
 if(ids.length!==res.length||new Set(res.map(x=>String(x.id))).size!==ids.length||ids.some(id=>!res.some(x=>String(x.id)===id)))throw Error('Result required for each planned task');
 const results=res.map(x=>{if(!['Completed','Partially Completed','Pending','Rescheduled','Cancelled'].includes(x.status))throw Error('Invalid result status');
 if(a.department==='Project'&&!String(x.result||'').trim())throw Error('Enter the Evening Result for every planned Project task');
 return{id:cdRaw(x.id,80),status:x.status,result:cdText(x.result,1000),nextStep:cdText(x.nextStep,500)}});
 const row=found.r.slice(),previous=cdDaily(found.r);
 row[7]='Submitted';row[8]=new Date().toISOString();row[9]=JSON.stringify(results);
 row[10]='Not Reviewed';row[11]='';row[12]='';row[13]='';
 sh.getRange(found.n,1,1,17).setValues([row.slice(0,17)]);
 // Keep the To-Do status synchronized with the evening result so a finished
 // task no longer appears as outstanding. Every change stays in the audit.
 const taskSheet=cdTab(ss,'tasks');
 for(const outcome of results){
  const match=cdRows(taskSheet).find(x=>x.r[0]===outcome.id&&String(x.r[5])===String(a.user_id));
  if(!match)continue;
  const before=cdTask(match.r),tr=match.r.slice();
  tr[10]=outcome.status==='Completed'?'Completed':outcome.status==='Cancelled'?'Cancelled':outcome.status==='Pending'||outcome.status==='Rescheduled'?'Not Started':'In Progress';
  tr[14]=outcome.status==='Completed'?100:outcome.status==='Partially Completed'?Math.max(1,Number(tr[14]||0)):Number(tr[14]||0);
  tr[15]=outcome.result;tr[17]=new Date().toISOString();
  taskSheet.getRange(match.n,1,1,20).setValues([tr]);
  cdAudit(ss,a,'TASK_EVENING_RESULT','task',tr[0],before,cdTask(tr));
 }
 cdAudit(ss,a,'EVENING_SUBMITTED','daily',row[0],previous,cdDaily(row));return cdDaily(row);
})}
function cdAllowLatePM(ss,a,p){return cdWithLock(function(){
 const sh=cdTab(ss,'daily'),found=cdRows(sh).find(x=>x.r[0]===String(p.id||''));
 if(!found)throw Error('Report not found');
 if(found.r[3]!=='Project'||!cdManager(a,'Project'))throw Error('Project Manager/Admin permission required');
 if(found.r[4]!=='Submitted'||found.r[7]==='Submitted')throw Error('Only a missing Project Evening Result can be authorized');
 const before=cdDaily(found.r),row=found.r.slice();
 row[14]='TRUE';row[15]=a.user_id;row[16]=new Date().toISOString();
 sh.getRange(found.n,1,1,17).setValues([row.slice(0,17)]);
 cdAudit(ss,a,'ALLOW_LATE_PM','daily',row[0],before,cdDaily(row));
 return cdDaily(row);
})}
function cdReview(ss,a,p){return cdWithLock(function(){
 const sh=cdTab(ss,'daily'),found=cdRows(sh).find(x=>x.r[0]===String(p.id||''));
 if(!found)throw Error('Report not found');
 if(!cdManager(a,found.r[3]))throw Error('Department review denied');
 if(found.r[7]!=='Submitted')throw Error('Evening Result required');
 if(found.r[10]==='Reviewed')throw Error('Already reviewed');
 if(!['Reviewed','Changes Requested'].includes(p.status))throw Error('Invalid review status');
 const before=cdDaily(found.r),row=found.r.slice();row[10]=p.status;row[11]=cdText(p.comment,1200);row[12]=a.user_id;row[13]=new Date().toISOString();
 sh.getRange(found.n,1,1,17).setValues([row.slice(0,17)]);cdAudit(ss,a,'DAILY_REVIEW','daily',row[0],before,cdDaily(row));return cdDaily(row);
})}
function companyDispatch(ss,a,action,p){
 if(action==='company_list')return cdList(ss,a);
 if(action==='company_save_task')return cdSaveTask(ss,a,p);
 if(action==='company_decide_request')return cdDecide(ss,a,p);
 if(action==='company_submit_am')return cdSubmitAM(ss,a,p);
 if(action==='company_submit_pm')return cdSubmitPM(ss,a,p);
 if(action==='company_review')return cdReview(ss,a,p);
 if(action==='company_allow_late_pm')return cdAllowLatePM(ss,a,p);
 throw Error('Unknown company action');
}
