/**
 * L'Imperial Marketing Management — Google Sheets backend.
 * Deploy as a new Apps Script Web App running as the sheet owner.
 * Sheet rows remain PRIVATE. Every HTTP operation checks a current Supabase login
 * and the user's server-side app_users role via get_my_effective_access.
 *
 * One-time Script Properties:
 *   SUPABASE_URL
 *   SUPABASE_ANON_KEY (public/publishable key, NEVER service role)
 *   MARKETING_SHEET_ID
 */
var MKT_TASK_HEADERS=['id','title','description','assignee_id','assignee_name','business','brand','category','concept','platforms','campaign','priority','start_date','due_date','post_date','status','progress','approval_status','asset_url','published_url','created_by','created_at','updated_at','visibility'];
var MKT_LOG_HEADERS=['id','task_id','actor_id','actor_name','created_at','event_type','notes','before_json','after_json'];
var MKT_DAILY_HEADERS=['id','user_id','user_name','work_date','plan_json','result_json','am_submitted_at','pm_submitted_at','updated_at'];
var MKT_ROLES=['marketing','marketing_manager','admin','super_admin'];
var MKT_STATUSES=['Not Started','In Progress','Blocked','Ready for Review','Completed','Published','Cancelled'];
var MKT_APPROVAL=['Not Submitted','Pending','Changes Requested','Approved'];
var MKT_MAX_TASKS=2500;

function mktOutput(value){return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);}
function mktError(message){return {ok:false,error:String(message||'Request failed').slice(0,300)};}
function mktNow(){return new Date().toISOString();}
function mktStr(value,max){return String(value===undefined||value===null?'':value).trim().slice(0,max||1000);}
function mktFail(message){throw new Error(message);}
function mktSheet(name,headers){
  var config=PropertiesService.getScriptProperties();
  var sheetId=config.getProperty('MARKETING_SHEET_ID')||'1Id6HglSoa_iAIIz0HLm_s6zSsnKwmLI_SoqeQSEG9RA';
  var ss=SpreadsheetApp.openById(sheetId),sh=ss.getSheetByName(name);
  if(!sh){sh=ss.insertSheet(name);sh.appendRow(headers);sh.setFrozenRows(1);}
  if(sh.getLastRow()<1){sh.appendRow(headers);sh.setFrozenRows(1);}
  var top=sh.getRange(1,1,1,headers.length).getValues()[0];
  if(headers.some(function(h,i){return top[i]!==h;}))mktFail(name+' headers differ from installed schema; stop and reconcile before writing');
  return sh;
}
function setupMarketingManagement(){
  mktSheet('Tasks',MKT_TASK_HEADERS);
  mktSheet('Activity',MKT_LOG_HEADERS);
  mktSheet('Daily',MKT_DAILY_HEADERS);
  return 'Marketing Sheets ready. Deploy new Web App version for API changes.';
}
function mktRows(sh,headers){
  var total=sh.getLastRow()-1;
  if(total<1)return [];
  if(total>MKT_MAX_TASKS && sh.getName()==='Tasks')mktFail('Task limit reached; archive old records before adding more');
  var data=sh.getRange(2,1,total,headers.length).getValues();
  return data.map(function(row,i){
    var obj={_row:i+2};
    headers.forEach(function(h,j){var v=row[j];obj[h]=v instanceof Date?(/(^|_)date$/.test(h)||h==='work_date'?Utilities.formatDate(v,'Asia/Phnom_Penh','yyyy-MM-dd'):v.toISOString()):v;});
    return obj;
  }).filter(function(r){return !!r.id;});
}
function mktWrite(sh,row,headers,obj){
  sh.getRange(row,1,1,headers.length).setValues([headers.map(function(k){return obj[k]===undefined||obj[k]===null?'':obj[k];})]);
}
function mktGetAuth(token){
  token=mktStr(token,6000);
  if(token.length<20)mktFail('Sign in to use Marketing');
  var p=PropertiesService.getScriptProperties(),url=mktStr(p.getProperty('SUPABASE_URL'),300).replace(/\/$/,'');
  var key=mktStr(p.getProperty('SUPABASE_ANON_KEY'),400);
  if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(url)||!key)mktFail('Marketing authentication Script Properties are not configured');
  var h={Authorization:'Bearer '+token,apikey:key};
  var idRes=UrlFetchApp.fetch(url+'/auth/v1/user',{method:'get',headers:h,muteHttpExceptions:true});
  if(idRes.getResponseCode()!==200)mktFail('Your session has expired; sign in again');
  var user=JSON.parse(idRes.getContentText());
  var r=UrlFetchApp.fetch(url+'/rest/v1/rpc/get_my_effective_access',{method:'post',headers:{Authorization:h.Authorization,apikey:key,'Content-Type':'application/json'},payload:'{}',muteHttpExceptions:true});
  if(r.getResponseCode()!==200)mktFail('This account has no Marketing access');
  var access=JSON.parse(r.getContentText()),role=mktStr(access.system_role,60);
  if(MKT_ROLES.indexOf(role)<0)mktFail('Marketing is a separate department; this role has no access');
  var canManage=['marketing_manager','admin','super_admin'].indexOf(role)>=0;
  var canApprove=canManage;
  if(!access.permissions || (!access.permissions['marketing.view'] && role!=='super_admin'))mktFail('Marketing permission is disabled');
  var rosterResponse=UrlFetchApp.fetch(url+'/rest/v1/rpc/get_marketing_staff',{
    method:'post',headers:{Authorization:h.Authorization,apikey:key,'Content-Type':'application/json'},
    payload:'{}',muteHttpExceptions:true
  });
  var roster=rosterResponse.getResponseCode()===200?JSON.parse(rosterResponse.getContentText()):[];
  if(!Array.isArray(roster))roster=[];
  var person=roster.find(function(x){return String(x.id)===String(user.id);});
  return {id:String(user.id),name:mktStr(person&&person.name||user.email,150),role:role,manage:canManage,approve:canApprove,roster:roster};
}
function mktOwned(task,user){return !!task&&(user.manage||String(task.assignee_id)===user.id||String(task.created_by)===user.id);}
function mktTaskById(tasks,id){return tasks.find(function(t){return String(t.id)===String(id);});}
function mktLog(taskId,user,event,notes,before,after){
  var sh=mktSheet('Activity',MKT_LOG_HEADERS);
  var record={id:Utilities.getUuid(),task_id:taskId,actor_id:user.id,actor_name:user.name,created_at:mktNow(),event_type:event,notes:mktStr(notes,1200),before_json:before?JSON.stringify(before):'',after_json:after?JSON.stringify(after):''};
  sh.appendRow(MKT_LOG_HEADERS.map(function(k){return record[k]||'';}));
}
function mktTaskFields(input,current,user){
  if(!input||typeof input!=='object'||Array.isArray(input))mktFail('Task data is invalid');
  var base=current?Object.assign({},current):{};
  var now=mktNow();
  var v={
    id:current?String(current.id):Utilities.getUuid(),
    title:mktStr(input.title!==undefined?input.title:base.title,180),
    description:mktStr(input.description!==undefined?input.description:base.description,4000),
    assignee_id:mktStr(input.assignee_id!==undefined?input.assignee_id:base.assignee_id,40),
    assignee_name:mktStr(input.assignee_name!==undefined?input.assignee_name:base.assignee_name,120),
    business:mktStr(input.business!==undefined?input.business:base.business,20),
    brand:mktStr(input.brand!==undefined?input.brand:base.brand,120),
    category:mktStr(input.category!==undefined?input.category:base.category,80),
    concept:mktStr(input.concept!==undefined?input.concept:base.concept,80),
    platforms:mktStr(input.platforms!==undefined?input.platforms:base.platforms,200),
    campaign:mktStr(input.campaign!==undefined?input.campaign:base.campaign,140),
    priority:mktStr(input.priority!==undefined?input.priority:base.priority||'Medium',20),
    start_date:mktStr(input.start_date!==undefined?input.start_date:base.start_date,10),
    due_date:mktStr(input.due_date!==undefined?input.due_date:base.due_date,10),
    post_date:mktStr(input.post_date!==undefined?input.post_date:base.post_date,10),
    status:mktStr(input.status!==undefined?input.status:base.status||'Not Started',40),
    progress:Math.max(0,Math.min(100,Math.round(Number(input.progress!==undefined?input.progress:base.progress)||0))),
    approval_status:current?mktStr(base.approval_status,40):'Not Submitted',
    asset_url:mktStr(input.asset_url!==undefined?input.asset_url:base.asset_url,600),
    published_url:current?mktStr(base.published_url,600):'',
    created_by:current?String(base.created_by):user.id,
    created_at:current?String(base.created_at):now,
    updated_at:now,
    visibility:'department'
  };
  if(!v.title)mktFail('Task title is required');
  if(['LPH','LPL','BOTH','OTHER',''].indexOf(v.business)<0)mktFail('Choose LPH, LPL, Both or Other');
  if(MKT_STATUSES.indexOf(v.status)<0)mktFail('Invalid task status');
  if(['Low','Medium','High','Urgent'].indexOf(v.priority)<0)mktFail('Invalid priority');
  ['start_date','due_date','post_date'].forEach(function(key){if(v[key]&&!/^\d{4}-\d\d-\d\d$/.test(v[key]))mktFail('Invalid '+key);});
  if(!user.manage){
    v.assignee_id=user.id;
    v.assignee_name=user.name;
    v.approval_status=base.approval_status||'Not Submitted';
    if(current){
      ['title','description','business','brand','category','concept','platforms','campaign','priority','start_date','due_date','post_date','asset_url'].forEach(function(k){v[k]=base[k];});
    }
  }
  if(user.manage && v.assignee_id && !user.roster.some(function(x){return String(x.id)===v.assignee_id && ['marketing','marketing_manager'].indexOf(String(x.role))>=0;}))mktFail('Assignee must be a registered active Marketing account');
  if(!current && !v.assignee_id && !user.manage)v.assignee_id=user.id;
  if(v.status==='Ready for Review')v.approval_status='Pending';
  if(current && v.asset_url!==mktStr(base.asset_url,600) && base.approval_status==='Approved')v.approval_status='Pending';
  if(v.status==='Published')mktFail('Use Publish to record the final post link');
  if(v.status==='Completed' && v.approval_status==='Not Submitted')v.approval_status='Pending';
  return v;
}
function mktSaveTask(input,user){
  var sh=mktSheet('Tasks',MKT_TASK_HEADERS),tasks=mktRows(sh,MKT_TASK_HEADERS);
  var current=input.id?mktTaskById(tasks,mktStr(input.id,40)):null;
  if(input.id&&!current)mktFail('Task not found');
  if(current&&!mktOwned(current,user))mktFail('You cannot edit this task');
  if(!current&&!user.manage&&mktStr(input.assignee_id,40)&&input.assignee_id!==user.id)mktFail('Only management may assign others');
  var t=mktTaskFields(input,current,user);
  mktWrite(sh,current?current._row:sh.getLastRow()+1,MKT_TASK_HEADERS,t);
  mktLog(t.id,user,current?'task_updated':'task_created','',current||null,t);
  return t;
}
function mktUpdateTask(payload,user){
  var sh=mktSheet('Tasks',MKT_TASK_HEADERS),tasks=mktRows(sh,MKT_TASK_HEADERS);
  var current=mktTaskById(tasks,payload.id);
  if(!mktOwned(current,user))mktFail('Task not found or not assigned to you');
  var next=Object.assign({},current);
  var status=mktStr(payload.status,40);
  if(status && MKT_STATUSES.indexOf(status)<0)mktFail('Invalid status');
  if(status==='Published')mktFail('Use Publish after approval');
  if(status)next.status=status;
  if(payload.progress!==undefined)next.progress=Math.max(0,Math.min(100,Math.round(Number(payload.progress)||0)));
  if(next.status==='Ready for Review'||next.status==='Completed')next.approval_status='Pending';
  if(next.status==='Blocked'&&!mktStr(payload.note,1200))mktFail('Explain why this task is blocked');
  next.updated_at=mktNow();
  mktWrite(sh,current._row,MKT_TASK_HEADERS,next);
  mktLog(next.id,user,'progress',payload.note,current,next);
  return next;
}
function mktReviewTask(payload,user){
  if(!user.approve)mktFail('Management approval required');
  var sh=mktSheet('Tasks',MKT_TASK_HEADERS),tasks=mktRows(sh,MKT_TASK_HEADERS),current=mktTaskById(tasks,payload.id);
  if(!current)mktFail('Task not found');
  if(['Approved','Changes Requested'].indexOf(payload.decision)<0)mktFail('Invalid review decision');
  if(payload.decision==='Changes Requested'&&!mktStr(payload.note,1200))mktFail('Explain requested changes');
  var next=Object.assign({},current);
  next.approval_status=payload.decision;
  next.status=payload.decision==='Changes Requested'?'In Progress':'Completed';
  if(payload.decision==='Approved')next.progress=100;
  next.updated_at=mktNow();
  mktWrite(sh,current._row,MKT_TASK_HEADERS,next);
  mktLog(next.id,user,'review',payload.note,current,next);
  return next;
}
function mktPublishTask(payload,user){
  var sh=mktSheet('Tasks',MKT_TASK_HEADERS),tasks=mktRows(sh,MKT_TASK_HEADERS),current=mktTaskById(tasks,payload.id);
  if(!mktOwned(current,user))mktFail('Task not found or not assigned to you');
  if(current.approval_status!=='Approved')mktFail('A manager must approve before publishing');
  var link=mktStr(payload.url,600);
  if(!/^https:\/\//.test(link))mktFail('Paste the published HTTPS post URL');
  var next=Object.assign({},current,{status:'Published',progress:100,published_url:link,updated_at:mktNow()});
  mktWrite(sh,current._row,MKT_TASK_HEADERS,next);
  mktLog(next.id,user,'published',link,current,next);
  return next;
}
function mktDailySave(payload,user){
  var date=mktStr(payload.date,10),phase=mktStr(payload.phase,5);
  if(!/^\d{4}-\d\d-\d\d$/.test(date)||['am','pm'].indexOf(phase)<0)mktFail('Invalid daily update');
  var taskRows=mktRows(mktSheet('Tasks',MKT_TASK_HEADERS),MKT_TASK_HEADERS);
  var ids=Array.isArray(payload.task_ids)?payload.task_ids.map(function(x){return mktStr(x,40);}):[];
  if(ids.length>30||new Set(ids).size!==ids.length)mktFail('Invalid task selection');
  ids.forEach(function(id){var task=mktTaskById(taskRows,id);if(!task||(String(task.assignee_id)!==user.id && !(String(task.created_by)===user.id && !task.assignee_id)))mktFail('Daily Plan only includes your own assigned work');});
  var sh=mktSheet('Daily',MKT_DAILY_HEADERS),rows=mktRows(sh,MKT_DAILY_HEADERS);
  var current=rows.find(function(r){return String(r.user_id)===user.id&&String(r.work_date).slice(0,10)===date;});
  var now=mktNow(),next=current?Object.assign({},current):{id:Utilities.getUuid(),user_id:user.id,user_name:user.name,work_date:date,plan_json:'[]',result_json:'[]',am_submitted_at:'',pm_submitted_at:''};
  if(phase==='am'){
    if(current&&current.am_submitted_at)mktFail('Morning plan was already submitted. Update linked tasks instead');
    if(!ids.length)mktFail('Select at least one task for the Morning Plan');
    next.plan_json=JSON.stringify(ids);
    next.am_submitted_at=now;
  }else{
    if(!current||!current.am_submitted_at)mktFail('Submit the Morning Plan before the Evening Result');
    if(!ids.length)mktFail('Select the tasks you worked on today');
    var note=mktStr(payload.note,2000);
    if(!note)mktFail('Enter an evening progress summary');
    next.result_json=JSON.stringify({task_ids:ids,note:note});
    next.pm_submitted_at=now;
  }
  next.updated_at=now;
  mktWrite(sh,current?current._row:sh.getLastRow()+1,MKT_DAILY_HEADERS,next);
  mktLog('DAILY:'+next.id,user,'daily_'+phase,mktStr(payload.note,1200),current||null,next);
  return next;
}
function mktHandle(request,user){
  var action=mktStr(request.action,50),p=request.payload||{};
  if(!p||typeof p!=='object'||Array.isArray(p))mktFail('Invalid payload');
  if(action==='ping')return {role:user.role,ready:true};
  if(action==='list'){
    var tasks=mktRows(mktSheet('Tasks',MKT_TASK_HEADERS),MKT_TASK_HEADERS).filter(function(t){return mktOwned(t,user);});
    var daily=mktRows(mktSheet('Daily',MKT_DAILY_HEADERS),MKT_DAILY_HEADERS).filter(function(d){return user.manage||String(d.user_id)===user.id;});
    return {tasks:tasks,daily:daily,role:user.role,server_time:mktNow()};
  }
  if(action==='history'){
    var task=mktTaskById(mktRows(mktSheet('Tasks',MKT_TASK_HEADERS),MKT_TASK_HEADERS),mktStr(p.id,40));
    if(!mktOwned(task,user))mktFail('Task not found');
    return mktRows(mktSheet('Activity',MKT_LOG_HEADERS),MKT_LOG_HEADERS).filter(function(l){return l.task_id===task.id;}).slice(-100).reverse();
  }
  if(['save_task','update_task','review_task','publish_task','daily_save'].indexOf(action)<0)mktFail('Unknown Marketing action');
  var lock=LockService.getScriptLock();
  if(!lock.tryLock(15000))mktFail('Marketing record is busy. Please retry');
  try{
    if(action==='save_task')return mktSaveTask(p.task||{},user);
    if(action==='update_task')return mktUpdateTask(p,user);
    if(action==='review_task')return mktReviewTask(p,user);
    if(action==='publish_task')return mktPublishTask(p,user);
    if(action==='daily_save')return mktDailySave(p,user);
  }finally{lock.releaseLock();}
}
function doPost(e){
  try{
    var raw=e&&e.postData&&e.postData.contents||'';
    if(raw.length>55000)mktFail('Request too large');
    var req=JSON.parse(raw);
    if(!req||typeof req!=='object'||Array.isArray(req))mktFail('Invalid JSON');
    var user=mktGetAuth(req.token),out=mktHandle(req,user);
    return mktOutput({ok:true,data:out});
  }catch(err){
    return mktOutput(mktError(err&&err.message||err));
  }
}
function doGet(){return mktOutput(mktError('Use the authenticated L\'Imperial app.'));}
