// L'Imperial Daily Plan & Evening Result.
// Daily-report content lives in Google Sheets, never in Supabase Storage/database.
// Uses a verified Supabase Edge relay to the owner's Google Apps Script web app.
(function(){
'use strict';
const P='sales-daily',R='sales-daily-review',WORKBOOK='https://docs.google.com/spreadsheets/d/1dDxwdTB59YZa1j3PilEjCTdfhG-zWWDgCMpQhdLmz9s/edit';
const CATS=['Customer Follow-up','Showroom / Page','Online Inquiries','Product Content','Quotation / SR','Other'];
const STATUSES=['Completed','Partially Completed','Pending','Rescheduled','Cancelled'];
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const today=()=>{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const m=Object.fromEntries(parts.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));return `${m.year}-${m.month}-${m.day}`;};
const pmDeadline=(date)=>{const d=new Date(date+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+1);return d.toISOString().slice(0,10)+'T10:00:00+07:00';};
const isOverdue=r=>initialPmMissing(r)&&Date.now()>Date.parse(r.pmDeadline||pmDeadline(r.date));
const isLate=r=>r?.pmStatus==='Submitted'&&!!r.pmSubmittedAt&&Date.parse(r.pmSubmittedAt)>Date.parse(r.pmDeadline||pmDeadline(r.date));
const initialPmMissing=r=>r?.amStatus==='Submitted'&&r?.pmStatus!=='Submitted'&&r?.reviewStatus!=='Changes Requested'&&!(r?.editRequests||[]).some(x=>x.section==='PM'&&x.status==='Approved');
const unfinishedTask=t=>['Pending','Partially Completed','Rescheduled'].includes(t?.status);
const firstPmLocked=r=>ui.policyVersion==='next-day-10am-20261104'&&r&&initialPmMissing(r)&&isOverdue(r)&&!r.lateSubmissionAllowed;
function latePmHint(r){return firstPmLocked(r)?'The 10:00 AM next-day deadline has passed. Save your draft and ask your Manager/Admin to allow a late submission.':''}
const backDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()-n);return x.toISOString().slice(0,10)};
const can=(key,roles)=>typeof window.hasAppPermission==='function'?!!window.hasAppPermission(key):roles.includes(state?.profile?.role||'');
const sales=()=>state?.profile?.role==='sales'&&can('sales_daily.plan_own',['sales']);
const review=()=>['manager','admin','super_admin'].includes(state?.profile?.role||'')&&
  (can('sales_daily.review_team',['manager','admin','super_admin'])||can('sales_daily.review_all',['admin','super_admin']));
const elem=id=>document.getElementById(id);
const allowed=(page)=>page===P?sales():page===R?review():false;
const ui={access:null,config:null,policyVersion:'',date:today(),start:today(),end:today(),person:'',report:null,reports:[],people:[],customers:[],tasks:[],suggestions:[],stats:null,loading:false,seq:0};
// Keep recently authorized report details in memory to open the exact record
// from Approvals or a missing-result alert without reloading the full page.
const dailyDetailCache={account:null,rows:new Map()};
function rememberDailyReports(reports){
 const account=String(state.user?.id||'');
 if(dailyDetailCache.account!==account){dailyDetailCache.account=account;dailyDetailCache.rows.clear()}
 (reports||[]).forEach(r=>{
  if(r?.id&&r.date&&r.userId)dailyDetailCache.rows.set(String(r.id),{report:r,at:Date.now()});
 });
 if(dailyDetailCache.rows.size>300){
  const keys=[...dailyDetailCache.rows.keys()];
  keys.slice(0,dailyDetailCache.rows.size-300).forEach(key=>dailyDetailCache.rows.delete(key));
 }
}
function cachedDailyReport(id,date,personId,maxAge=90000){
 if(dailyDetailCache.account!==String(state.user?.id||''))return null;
 const hit=dailyDetailCache.rows.get(String(id));
 if(!hit||Date.now()-hit.at>maxAge)return null;
 const r=hit.report;
 return (!date||r.date===date)&&(!personId||String(r.userId)===String(personId))?r:null;
}
function replaceDailyReport(r){
 if(!r?.id)return;
 rememberDailyReports([r]);
 const index=ui.reports.findIndex(x=>String(x.id)===String(r.id));
 if(index>=0)ui.reports[index]=r;
}
const empty=()=>({id:'',category:'Customer Follow-up',plan:'',customerId:'',customerName:'',priority:'Medium',plannedFollowup:''});
const toast=(msg,error=false)=>showToast(msg,error?'err':undefined);
const common='border rounded-xl px-3 py-2.5 w-full bg-white text-sm';
const actionButton='px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-bold disabled:opacity-50';
const lightButton='px-4 py-2.5 rounded-xl border bg-white text-xs font-semibold disabled:opacity-50';
let accountId=null;
function resetAccount(){
 const id=state.user?.id||null;
 if(accountId===id)return;
 accountId=id;ui.seq++;ui.access=null;ui.config=null;ui.report=null;ui.reports=[];
 dailyDetailCache.account=String(id||'');dailyDetailCache.rows.clear();
 ui.people=[];ui.customers=[];ui.tasks=[];ui.stats=null;ui.person='';ui.policyVersion='';
 ui.date=today();ui.start=today();ui.end=today();
}
function weeklyPanel(){
 const s=ui.stats;if(!s)return '';
 return '<section class="rounded-2xl border bg-white p-4"><h3 class="font-bold text-sm">Last 7 days · '+h(backDays(state.page===P?ui.date:ui.end,6))+' – '+h(state.page===P?ui.date:ui.end)+'</h3>'+
 '<p class="text-xs text-gray-500 mt-1">'+(state.page===P?'Your reports':ui.person?'Selected salesperson':'All authorized Sales staff')+'</p><div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-3">'+
 [['AM submitted',s.amSubmitted],['PM submitted',s.pmSubmitted],['Reviewed',s.reviewed],['Planned tasks',s.plannedTasks],['Completed',s.completed],['Partially completed',s.partiallyCompleted],['Pending / rescheduled',s.pending],['Completion rate',s.plannedTasks?Math.round(100*s.completed/s.plannedTasks)+'%':'—']]
 .map(([label,value])=>'<div><div class="text-[10px] text-gray-500">'+h(label)+'</div><b class="text-lg">'+h(value)+'</b></div>').join('')+'</div></section>';
}
function root(){return elem('content')}
async function access(){
 if(ui.access&&ui.config)return;
 const userId=state.user?.id;
 const [ar,cr]=await Promise.all([db.rpc('get_sales_daily_access'),db.rpc('get_sales_daily_connection')]);
 if(ar.error)throw ar.error;if(cr.error)throw cr.error;
 if(state.user?.id===userId){ui.access=ar.data;ui.config=cr.data;}
}
async function api(action,payload){
 const r=await db.functions.invoke('sales-daily-google-proxy',{body:{action,payload}});
 if(r.error){
   let detail=r.error.message||'Daily Reports connection failed';
   try{if(r.error.context?.json){const x=await r.error.context.json();detail=x.error||detail}}catch(_){}
   throw Error(detail);
 }
 if(!r.data?.ok){
   const message=String(r.data?.error||'Could not save to Google Sheets');
   if(message.includes('Use the authenticated Sales & Order Management app'))
     throw Error('Google Apps Script received a browser GET instead of an authenticated report request. Please retry inside this page; if it continues, the Apps Script deployment or redirect needs checking.');
   throw Error(message);
 }
 return r.data.data;
}
async function loadCustomers(){
 if(!sales()||ui.customers.length)return;
 const userId=state.user?.id;
 let q=db.from('customers').select('id,name,assigned_sales_id').eq('active',true).order('name').limit(600);
 if(state?.profile?.role==='sales')q=q.eq('assigned_sales_id',state.user.id);
 const res=await q;
 if(!res.error&&state.user?.id===userId)ui.customers=res.data||[];
}
function header(title,sub){
 return '<div class="rounded-2xl border bg-white p-5 flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3">'+
  '<div><div class="text-[10px] text-[#ad842b] font-bold tracking-wider uppercase">L’Imperial Sales & Order Management</div>'+
  '<h2 class="text-xl md:text-2xl font-serif font-bold mt-1">'+h(title)+'</h2><p class="text-xs mt-2 text-gray-500">'+h(sub)+'</p></div>'+
  (['manager','admin','super_admin'].includes(state?.profile?.role)
   ?'<a href="'+WORKBOOK+'" target="_blank" rel="noopener noreferrer" class="'+lightButton+' text-center">Google Sheets master ↗</a>'
   :'')+'</div>';
}
async function showSetup(){
 root().innerHTML=header('Sales Daily Plan & Result','Google Sheets storage · secure server-side access')+
 '<div class="mt-4 rounded-2xl border border-amber-200 bg-amber-50 p-5 max-w-3xl">'+
 '<h3 class="font-bold">One-time Google Apps Script connection required</h3>'+
 '<p class="text-sm mt-2 text-amber-900">Your master Google Sheet and application screens are ready. Super Admin needs to deploy the prepared Google Apps Script once, then paste its published <b>/exec</b> URL here. No daily-report data will be stored in Supabase.</p>'+
 '<p class="mt-3 text-xs">GitHub setup: <a class="underline text-blue-700" target="_blank" rel="noopener noreferrer" href="https://github.com/harrisho1234-spec/Sale-and-purchase-tracking/tree/main/google-apps-script/sales-daily-plan">Open Google Apps Script installation files ↗</a></p>'+
 (state.profile?.role==='super_admin'?
 '<div class="mt-4"><label class="text-xs font-bold">Published Apps Script Web App URL</label>'+
 '<input id="salesDailyEndpoint" class="'+common+' mt-1" placeholder="https://script.google.com/macros/s/.../exec" value="'+h(ui.config?.script_url||'')+'">'+
 '<button onclick="saveSalesDailyEndpoint()" class="'+actionButton+' mt-2">Save Google Sheets Connection</button></div>':
 '<div class="mt-4 text-sm text-gray-600">Contact your Super Admin to finish connecting the Daily Plan module.</div>')+
 '</div>';
}
window.saveSalesDailyEndpoint=async()=>{
 if(state.profile?.role!=='super_admin')return toast('Super Admin only',true);
 const url=String(elem('salesDailyEndpoint')?.value||'').trim();
 const r=await db.rpc('configure_sales_daily_connection',{p_script_url:url});
 if(r.error)return toast(r.error.message,true);
 ui.config=r.data;toast('Connection saved. Testing Google Sheet access…');
 try{await api('ping',{});await reload()}catch(e){toast('Connection saved, but Google Apps Script test failed: '+e.message,true)}
};
function compactSubmittedTask(t,i){
 return '<div class="border rounded-xl bg-white px-3 py-2 flex gap-3"><span class="text-xs text-gray-500">'+(i+1)+'.</span><div class="flex-1"><div class="text-sm font-semibold">'+h(t.plan)+'</div><div class="text-[11px] text-gray-500">'+h(t.category)+(t.customerName?' · '+h(t.customerName):'')+(t.todoTaskId?' · Linked To-Do':'')+(t.plannedFollowup?' · Due '+h(t.plannedFollowup):'')+'</div></div></div>';
}
function formTask(t,i,readonly=false){
 const cs='<option value="">No linked customer</option>'+ui.customers.map(c=>
 '<option value="'+h(c.id)+'" '+(String(t.customerId||'')===String(c.id)?'selected':'')+'>'+h(c.name)+'</option>').join('');
 return '<div class="daily-task-row border rounded-xl bg-white px-3 py-2.5" data-index="'+i+'" data-todo-task-id="'+h(t.todoTaskId||'')+'" data-source-task-id="'+h(t.sourceTaskId||'')+'">'+
 '<div class="flex justify-between items-center gap-2 mb-2"><b class="text-sm">Task '+(i+1)+(t.todoTaskId?' · Linked To-Do':t.sourceTaskId?' · Carried forward':'')+'</b>'+
 (!readonly?(t.todoTaskId||t.sourceTaskId?'<button type="button" onclick="unlinkSalesDailyTask('+i+')" class="border px-2.5 py-1.5 rounded-lg text-[11px]">Unlink task</button>':'')+'<button type="button" onclick="removeSalesDailyTask('+i+')" class="border border-red-100 text-red-600 px-2.5 py-1.5 rounded-lg text-[11px]">Remove</button>':'')+'</div>'+
 '<div class="grid sm:grid-cols-3 gap-2">'+
 '<label class="text-xs font-semibold">Category<select data-field="category" class="'+common+'" '+(readonly?'disabled':'')+'>'+
 CATS.map(c=>'<option value="'+h(c)+'" '+(t.category===c?'selected':'')+'>'+h(c)+'</option>').join('')+'</select></label>'+
 '<label class="text-xs font-semibold">Priority<select data-field="priority" class="'+common+'" '+(readonly?'disabled':'')+'>'+
 ['High','Medium','Low'].map(v=>'<option '+(v===t.priority?'selected':'')+'>'+v+'</option>').join('')+'</select></label>'+
 '<label class="text-xs font-semibold">Planned Follow-up<input type="date" data-field="plannedFollowup" class="'+common+'" value="'+h(t.plannedFollowup||'')+'" '+(readonly?'disabled':'')+'></label>'+
 '</div>'+
 '<label class="text-xs font-semibold block mt-2">Morning Plan <span class="text-red-500">*</span>'+
 '<textarea data-field="plan" maxlength="1000" rows="1" required class="'+common+'" '+(readonly?'disabled':'')+' placeholder="What will you do?">'+h(t.plan||'')+'</textarea></label>'+
 '<details class="mt-2 text-xs" '+(t.customerId||t.customerName?'open':'')+'><summary class="cursor-pointer text-amber-800 font-semibold py-1">Customer details (optional)</summary><div class="grid sm:grid-cols-2 gap-2 mt-2"><label class="text-xs font-semibold">Link Customer Master<select data-field="customerId" class="'+common+'" '+(readonly?'disabled':'')+'>'+cs+'</select></label>'+
 '<label class="text-xs font-semibold">Customer name (optional)<input data-field="customerName" maxlength="140" class="'+common+'" '+(readonly?'disabled':'')+' value="'+h(t.customerName||'')+'" placeholder="Customer if not registered"></label></div></details></div>';
}
function captureAm(){
 if(!root())return;
 ui.tasks=[...root().querySelectorAll('.daily-task-row')].map((row,i)=>{
   const get=k=>row.querySelector('[data-field="'+k+'"]')?.value||'';
   const prev=ui.tasks[i]||{};
   const matched=ui.customers.find(c=>String(c.id)===get('customerId'));
   return{id:prev.id||'',sourceTaskId:row.dataset.sourceTaskId||prev.sourceTaskId||'',todoTaskId:row.dataset.todoTaskId||prev.todoTaskId||'',category:get('category'),plan:get('plan'),
    customerId:get('customerId'),customerName:get('customerName')||(matched?.name||''),
    priority:get('priority'),plannedFollowup:get('plannedFollowup')};
 });
}
window.unlinkSalesDailyTask=i=>{
 captureAm();
 if(!ui.tasks[i])return;
 ui.tasks[i].todoTaskId='';
 ui.tasks[i].sourceTaskId='';
 renderSalesHome();
 toast('Task link cleared. The plan text remains; you can submit it as a manual task.');
};
window.addSalesDailyTask=()=>{captureAm();if(ui.tasks.length>=20)return toast('Maximum 20 tasks per day',true);ui.tasks.push(empty());renderSalesHome()};
window.removeSalesDailyTask=i=>{captureAm();if(ui.tasks.length<=1)return toast('Keep at least one planned task',true);ui.tasks.splice(i,1);renderSalesHome()};
window.openOverdueSalesDaily=async date=>{if(ui.loading)return;ui.date=date;ui.report=null;ui.tasks=[];await reload()};
window.selectSalesDailyDate=async()=>{if(ui.loading){elem('salesDailyDate').value=ui.date;return toast('Please wait for the current save to finish');}ui.date=elem('salesDailyDate')?.value||today();ui.report=null;ui.tasks=[];await reload()};
async function activitySuggestions(){
 const r=await db.rpc('get_sales_activity_timeline',{
  p_start:ui.date,p_end:ui.date,p_actor:null,p_action:null,p_limit:100
 });
 if(r.error)return [];
 return (r.data?.activities||[]).filter(x=>['customer_followup','showroom_visit','online_inquiry','sales_order','tk_rk'].includes(x.type)).slice(0,15);
}
window.showDailyActivitySuggestions=async()=>{
 const box=elem('dailyActivitySuggestions');if(!box)return;
 box.innerHTML='<div class="text-xs text-gray-500">Loading recorded activities…</div>';
 const rows=await activitySuggestions();
 box.innerHTML=rows.length?'<p class="text-xs text-gray-500 mb-2">These activities were recorded in the app. Check the actual customer outcome before marking a plan complete.</p>'+
 rows.map(x=>'<div class="border-b py-2 text-xs"><b>'+h(x.type.replaceAll('_',' '))+'</b> · '+h(x.subject||x.document_no||'')+
 '<div class="text-gray-500">'+h(x.details||'')+'</div></div>').join(''):
 '<div class="text-xs text-gray-500">No matching CRM/Sales events recorded for this date.</div>';
};
async function saveAm(submit){
 if(ui.loading)return;
 captureAm();
 if(ui.tasks.some(t=>!t.plan.trim()))return toast('Every task needs a Morning Plan description',true);
 ui.loading=true;
 try{
  const r=await api(submit?'submit_am':'save_am',{date:ui.date,tasks:ui.tasks});
  const linked=ui.tasks.filter(t=>t.todoTaskId).map(t=>t.todoTaskId);
  const retained=new Set((r.tasks||[]).map(t=>t.todoTaskId).filter(Boolean));
  ui.report=r;ui.tasks=r.tasks||[];
  if(linked.some(id=>!retained.has(id)))toast('Plan saved, but the To-Do link was not retained. Update your Google Apps Script deployment to enable the compact-view label.',true);
  else toast(submit?'Morning plan submitted':'Morning draft saved');
  await reload();
  window.invalidateSalesDailyApprovals?.();
 }catch(e){toast(e.message,true)}finally{ui.loading=false}
}
window.saveSalesDailyMorning=saveAm;
window.carrySalesDailyTasks=async()=>{
 if(ui.loading)return;
 ui.loading=true;
 const from=elem('dailyCarryFrom')?.value||backDays(ui.date,1);
 try{
  captureAm();
  const r=await api('carry_forward',{from,to:ui.date});
  const imported=new Set(ui.tasks.map(t=>t.sourceTaskId).filter(Boolean));
  const suggestions=(r.suggestions||[]).filter(t=>t.sourceTaskId&&!imported.has(t.sourceTaskId));
  if(!suggestions.length)return toast('No new unfinished tasks found for that day');
  const available=20-ui.tasks.filter(t=>t.plan.trim()).length;
  const body='<p class="text-xs text-gray-500 mb-3">Select unfinished tasks from '+h(from)+' to add to your '+h(ui.date)+' Morning Plan draft. Nothing is submitted automatically.</p>'+
    '<div class="space-y-2 max-h-[55vh] overflow-auto">'+suggestions.map((t,i)=>'<label class="flex items-start gap-3 border rounded-xl p-3 text-sm"><input type="checkbox" class="daily-carry-check mt-1" value="'+i+'" checked><span><b>'+h(t.plan)+'</b><span class="block text-xs text-gray-500 mt-1">'+h(t.category||'Other')+' · '+h(t.priority||'Medium')+(t.customerName?' · '+h(t.customerName):'')+'</span></span></label>').join('')+'</div>'+
    '<div class="flex gap-2 mt-4"><button class="'+actionButton+'" onclick="confirmDailyCarryForward()">Add Selected to Plan</button><button class="'+lightButton+'" onclick="closeModal()">Cancel</button></div>';
  window.dailyCarrySuggestions=suggestions;
  window.dailyCarryTargetDate=ui.date;
  window.dailyCarryAvailable=available;
  openModal('Carry Forward Unfinished Plans',body);
 }catch(e){toast(e.message,true)}finally{ui.loading=false}
};
window.confirmDailyCarryForward=()=>{
 if(ui.date!==window.dailyCarryTargetDate)return toast('Report date changed. Please preview again.',true);
 const choices=[...document.querySelectorAll('.daily-carry-check:checked')].map(e=>window.dailyCarrySuggestions[Number(e.value)]).filter(Boolean);
 if(!choices.length)return toast('Select at least one task to import',true);
 captureAm();
 const current=ui.tasks.filter(t=>t.plan.trim());
 const existing=new Set(current.map(t=>t.sourceTaskId).filter(Boolean));
 const unique=choices.filter(t=>!existing.has(t.sourceTaskId));
 if(current.length+unique.length>20)return toast('Maximum 20 tasks per day. Select fewer tasks.',true);
 ui.tasks=[...current,...unique.map(t=>({...empty(),...t,id:''}))];
 closeModal();renderSalesHome();
 toast(unique.length+' unfinished task(s) added to your Morning Plan draft');
};
function pmTask(t,i,locked){
 return '<div class="daily-result-row rounded-xl bg-white border px-3 py-2.5" data-id="'+h(t.id)+'">'+
  '<div class="text-[10px] uppercase font-bold text-[#a18239]">'+h(t.category)+'</div>'+
  '<div class="font-semibold text-sm mt-1">'+h(t.plan)+'</div>'+
  (t.customerName?'<div class="text-xs text-gray-500 mt-1">Customer: '+h(t.customerName)+'</div>':'')+
  '<div class="grid sm:grid-cols-2 gap-3 mt-2"><label class="text-xs font-semibold">Evening status<select data-field="status" class="'+common+'" '+(locked?'disabled':'')+'>'+
  '<option value="">Choose result</option>'+
  STATUSES.map(s=>'<option '+(t.status===s?'selected':'')+'>'+h(s)+'</option>').join('')+
  '</select></label><label class="text-xs font-semibold">Next Follow-up Date<input data-field="nextFollowup" type="date" class="'+common+'" value="'+h(t.nextFollowup||'')+'" '+(locked?'disabled':'')+'></label></div>'+
  '<label class="text-xs font-semibold block mt-2">Evening Result / Actual Outcome *<textarea data-field="result" rows="1" maxlength="1500" class="'+common+'" '+(locked?'disabled':'')+' placeholder="Customer interested, awaiting reply, no chats today, video completed…">'+h(t.result||'')+'</textarea></label></div>';
}
function capturePm(){
 return [...(root()?.querySelectorAll('.daily-result-row')||[])].map(row=>{
  const get=k=>row.querySelector('[data-field="'+k+'"]')?.value||'';
  return{id:row.dataset.id,status:get('status'),result:get('result'),nextFollowup:get('nextFollowup')};
 });
}
let additionalDraft=[],additionalDraftDate='';
// Report sections are presentation categories, distinct from the stored
// Morning Plan task types and imported Google Sheet activity categories.
// A source reference is authoritative: staff editing the activity title
// must never move an imported visit into Other Tasks by accident.
const dailySections=[
 {id:'customer',label:'Customer Task'},
 {id:'visit',label:'Customer Visit'},
 {id:'online',label:'Online'},
 {id:'other',label:'Other Task / To Do'}
];
function dailyExtraSection(x){
 const source=String(x?.sourceType||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
 if(['showroom_visit','showroom','customer_visit'].includes(source))return 'visit';
 if(['online','online_inquiry','online_visit'].includes(source))return 'online';
 const category=String(x?.category||'').trim().toLowerCase();
 if(['customer visit','showroom visit','showroom work'].includes(category))return 'visit';
 if(['online inquiry','online inquiries','online visit'].includes(category))return 'online';
 if(['customer follow-up','quotation','sales order','quotation / sr'].includes(category))return 'customer';
 return 'other';
}
function dailyPlannedSection(t){
 if(t?.todoTaskId)return 'other';
 const category=String(t?.category||'').trim().toLowerCase();
 if(['online inquiries','online inquiry','online visit'].includes(category))return 'online';
 if(['customer visit','showroom visit'].includes(category)||
    (category==='showroom / page'&&(t.customerName||t.customerId)))return 'visit';
 if(t?.customerName||t?.customerId||['customer follow-up','quotation / sr'].includes(category))return 'customer';
 return 'other';
}
function groupDailyExtras(extras){
 return dailySections.map(section=>({...section,rows:(extras||[])
   .map((entry,index)=>({entry,index}))
   .filter(({entry})=>dailyExtraSection(entry)===section.id)}));
}
const additionalCats=['Customer Visit','Customer Follow-up','Online Inquiry','Quotation','Sales Order','Showroom Work','Other'];
function captureAdditional(){
 const rows=root()?.querySelectorAll('.additional-daily-row')||[];
 if(rows.length){
  const previous=additionalDraft.length?additionalDraft:(ui.report?.additionalActivities||[]);
  additionalDraft=[...rows].map(row=>{
   const index=Number(row.dataset.draftIndex);
   const prev=previous[Number.isInteger(index)&&index>=0?index:0]||{};
   return {index,entry:{
    id:prev.id||'',category:row.querySelector('[data-extra="category"]')?.value||'Other',
    customerName:row.querySelector('[data-extra="customerName"]')?.value||'',
    result:row.querySelector('[data-extra="result"]')?.value||'',
    nextFollowup:row.querySelector('[data-extra="nextFollowup"]')?.value||'',
    sourceType:row.dataset.sourceType||prev.sourceType||'',
    sourceId:row.dataset.sourceId||prev.sourceId||''
   }};
  }).sort((a,b)=>a.index-b.index).map(x=>x.entry);
 }
 return additionalDraft;
}
function additionalEditor(locked){
 if(additionalDraftDate!==ui.date){additionalDraftDate=ui.date;additionalDraft=[];}
 const data=additionalDraft.length?additionalDraft:(ui.report?.additionalActivities||[]);
 const sectionHtml=groupDailyExtras(data).filter(group=>group.rows.length).map(group=>
  '<div class="rounded-xl border border-slate-200 overflow-hidden">'+
   '<div class="bg-slate-50 border-b px-3 py-2 text-xs font-bold">'+h(group.label)+' · '+group.rows.length+'</div>'+
   '<div class="p-3 space-y-3">'+group.rows.map(({entry:x,index:i})=>
    '<div class="additional-daily-row border rounded-xl p-3 bg-white" data-draft-index="'+i+'" data-source-type="'+h(x.sourceType||'')+'" data-source-id="'+h(x.sourceId||'')+'">'+
    '<div class="flex justify-between gap-2 items-center mb-2"><b class="text-xs">Activity '+(i+1)+
    (x.sourceId?' · Imported '+h(dailyExtraSection(x)==='online'?'Online':'Customer Visit'):'')+'</b>'+
    (!locked?'<button class="text-xs text-red-600" onclick="removeAdditionalDaily('+i+')">Remove</button>':'')+'</div>'+
    '<div class="grid sm:grid-cols-2 gap-2"><label class="text-xs">Activity type<select data-extra="category" class="'+common+'" '+(locked?'disabled':'')+'>'+
     additionalCats.map(v=>'<option '+(x.category===v?'selected':'')+'>'+h(v)+'</option>').join('')+
    '</select></label><label class="text-xs">Customer name (optional)<input data-extra="customerName" class="'+common+'" value="'+h(x.customerName||'')+'" '+(locked?'disabled':'')+'></label></div>'+
    '<label class="text-xs block mt-2">Actual outcome<textarea data-extra="result" class="'+common+'" rows="2" '+(locked?'disabled':'')+'>'+h(x.result||'')+'</textarea></label>'+
    '<label class="text-xs block mt-2">Next follow-up date<input data-extra="nextFollowup" type="date" class="'+common+'" value="'+h(x.nextFollowup||'')+'" '+(locked?'disabled':'')+'></label></div>'
   ).join('')+'</div></div>'
 ).join('');
 return '<div class="space-y-3 border-t pt-4"><h4 class="font-bold">Additional Activities (Unplanned)</h4>'+
  '<p class="text-xs text-gray-500">Imported Showroom visits appear under Customer Visit, and online inquiries under Online. These do not count toward Morning Plan completion.</p>'+
  sectionHtml+
  (!locked?'<div class="flex flex-wrap gap-2"><button class="'+lightButton+'" onclick="addAdditionalDaily()">+ Add Additional Activity</button><button class="'+lightButton+'" onclick="importRecordedDailyActivities()">Import Showroom / Online</button></div>':'')+'</div>';
}
function preserveEveningInputs(){const values=capturePm();if(ui.report?.tasks)values.forEach(v=>{const t=ui.report.tasks.find(x=>x.id===v.id);if(t)Object.assign(t,v)})}
window.openDailyActivitySource=(type,id)=>{
 if(!['online','showroom_visit'].includes(type)||!id)return;
 sessionStorage.setItem('dailyActivitySourceOpen',JSON.stringify({type,id}));
 if(typeof window.go==='function')window.go(type==='online'?'online':'showroom-visit');
};
window.importRecordedDailyActivities=async()=>{
 if(ui.report?.pmStatus==='Submitted')return toast('Evening Result is locked',true);
 preserveEveningInputs();captureAdditional();
 try{
  const [a,b]=await Promise.all(['showroom_visit','online'].map(type=>db.rpc('get_customer_activity_rows',{p_activity_type:type})));
  if(a.error||b.error)throw Error(a.error?.message||b.error?.message);
  // Daily import is a record picker, not a customer assignment/CRM ownership action.
  // Include every visible activity on the selected report date, regardless of
  // who is assigned (including records without an assigned salesperson).
  const own=String(state.user?.id||''),date=ui.date;
  const rows=[...(a.data||[]).map(x=>({...x,activity_type:'showroom_visit'})),...(b.data||[]).map(x=>({...x,activity_type:'online'}))]
    .filter(x=>String(x.activity_date||'').slice(0,10)===date);
  const already=new Set(additionalDraft.filter(t=>t.sourceType&&t.sourceId).map(t=>t.sourceType+':'+t.sourceId));
  window.dailyImportCandidates=rows.filter(x=>!already.has(x.activity_type+':'+x.id));
  window.dailyImportSelectedDate=date;
  window.dailyImportActorId=own;
  if(!window.dailyImportCandidates.length)return toast('No new Showroom or Online activities for '+date);
  const body='<p class="text-xs mb-3">All Showroom and Online records for <b>'+h(date)+'</b> are available, including unassigned and other Sales visits. Selecting one adds a reference to <b>your Evening Result only</b>; it does not change the customer assignment or create a new visit.</p>'+
  '<div class="max-h-[50vh] overflow-auto space-y-2">'+
  window.dailyImportCandidates.map((x,i)=>{
    const owner=!x.assigned_sales_id?'Unassigned':String(x.assigned_sales_id)===own?'Assigned to you':'Assigned: '+(x.sales_rep_name||'Another salesperson');
    return '<label class="flex items-start gap-2 border rounded-lg p-3 text-xs cursor-pointer hover:bg-gray-50"><input type="checkbox" class="daily-activity-import mt-0.5" value="'+i+'"><span class="min-w-0"><b>'+h(x.activity_type==='online'?'Online Inquiry':'Showroom Visit')+'</b> · '+h(x.customer_name||'Unnamed customer')+
      '<span class="ml-2 text-[10px] text-gray-500">'+h(x.business_code||'')+'</span>'+
      '<span class="block text-[10px] text-gray-500 mt-1">'+h(owner)+'</span>'+
      '<span class="block text-gray-600 mt-1">'+h(x.remark||x.interest||'')+'</span></span></label>';
  }).join('')+'</div>'+
  '<button class="'+actionButton+' mt-3" onclick="confirmRecordedDailyActivities()">Import Selected</button>';
  openModal('Import Showroom / Online Activities',body);
 }catch(e){toast(e.message,true)}
};
window.confirmRecordedDailyActivities=()=>{
 if(window.dailyImportSelectedDate!==ui.date||window.dailyImportActorId!==String(state.user?.id||''))return toast('Daily report date or Sales account changed. Open the import list again.',true);
 preserveEveningInputs();captureAdditional();
 const chosen=[...document.querySelectorAll('.daily-activity-import:checked')].map(el=>window.dailyImportCandidates?.[Number(el.value)]).filter(Boolean);
 const known=new Set(additionalDraft.filter(x=>x.sourceId&&x.sourceType).map(x=>x.sourceType+':'+x.sourceId));
 const fresh=chosen.filter(x=>{
   const key=x.activity_type+':'+x.id;
   if(known.has(key))return false;
   known.add(key);return true;
 });
 if(!fresh.length)return toast('Select at least one activity not already in your draft.',true);
 if(additionalDraft.length+fresh.length>30)return toast('Maximum 30 additional activities per day. Select fewer records.',true);
 for(const x of fresh){
  additionalDraft.push({category:x.activity_type==='online'?'Online Inquiry':'Customer Visit',customerName:x.customer_name||'',result:x.remark||x.interest||'',nextFollowup:x.follow_up_date||'',sourceType:x.activity_type,sourceId:String(x.id)});
 }
 closeModal();renderSalesHome();toast(fresh.length+' activities added to your Evening Result draft. Original customer assignments were not changed.');
};
window.addAdditionalDaily=()=>{preserveEveningInputs();captureAdditional();if(additionalDraft.length>=30)return toast('Maximum 30 additional activities',true);additionalDraft.push({category:'Customer Visit',customerName:'',result:'',nextFollowup:''});renderSalesHome()};
window.removeAdditionalDaily=i=>{preserveEveningInputs();captureAdditional();additionalDraft.splice(i,1);renderSalesHome()};
window.saveSalesDailyEvening=async submit=>{
 if(ui.loading)return;
 if(submit&&firstPmLocked(ui.report))return toast(latePmHint(ui.report),true);
 const results=capturePm();const additionalActivities=captureAdditional();if(submit&&results.some(x=>!x.status))return toast('Update the status of every planned task before submitting',true);
 if(submit&&results.some(x=>!x.result.trim()))return toast('Write an actual outcome for every morning task before submitting',true);
 ui.loading=true;
 try{await api(submit?'submit_pm':'save_pm',{date:ui.date,results,additionalActivities});toast(submit?'Evening results submitted for manager review':'Evening draft saved');await reload();window.invalidateSalesDailyApprovals?.()}
 catch(e){toast(e.message,true)}finally{ui.loading=false}
};
window.closeSalesDailyShare=()=>document.getElementById('salesDailyShareOverlay')?.remove();
window.openLinkedDailyTodo=id=>{
 if(!id)return;
 if(typeof window.go==='function'){
   window.closeSalesDailyShare?.();
   sessionStorage.setItem('salesDailyOpenTodo',id);
   window.go('sales-todo');
   // The original To-Do remains independent from the Daily Plan outcome.
 }
};
const formatDailySubmittedAt=value=>{
 if(!value)return 'Not submitted';
 const date=new Date(value);
 if(Number.isNaN(date.getTime()))return String(value);
 return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Phnom_Penh',day:'2-digit',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true}).format(date)+' (Phnom Penh)';
};
// Distinguish the salesperson's task outcome from the manager's report review.
// A morning plan without a submitted PM result is NOT awaiting manager approval.
function managerReviewStatus(r){
 if(r.reviewStatus==='Reviewed')return 'Reviewed';
 if(r.reviewStatus==='Changes Requested')return 'Corrections Requested';
 return r.pmStatus==='Submitted'?'Awaiting Manager Review':'Not Ready (PM not submitted)';
}
function managerReviewAudit(r){
 if(!['Reviewed','Changes Requested'].includes(r.reviewStatus))return '';
 const action=r.reviewStatus==='Reviewed'?'Reviewed by ':'Corrections requested by ';
 return ' · '+action+h(r.reviewedBy||'Management')+
  (r.reviewedAt?' on '+h(formatDailySubmittedAt(r.reviewedAt)):'');
}
function managerTaskStatus(t){return t.status==='Pending'?'Pending / Outstanding':(t.status||'Not updated')}
// Use a Khmer-capable face in both the on-screen share card and printed/PDF output.
function ensureDailyKhmerFont(){
 if(document.getElementById('salesDailyKhmerFont'))return;
 const link=document.createElement('link');
 link.id='salesDailyKhmerFont';link.rel='stylesheet';
 link.href='https://fonts.googleapis.com/css2?family=Noto+Sans+Khmer:wght@400;500;600;700&display=swap';
 document.head.appendChild(link);
}
// A one-image, conversation-friendly version: do not repeat blank morning
// plan cells on imported visits, and use two balanced columns for unrelated
// Showroom/Online outcomes. Full detail remains available by switching mode.
function dailyCompactShareBody(r,pm){
 const list=pm?dailySections:[
   {id:'customer',label:'Customer Task'},
   {id:'other',label:'Other Task / To Do'}
 ];
 const allTasks=r.tasks||[],extras=pm?(r.additionalActivities||[]):[];
 const noteStyle='font-size:12px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere';
 const oneTask=(t,i)=>{
   const result=t.status||'Not updated';
   return '<div data-compact-planned style="display:grid;grid-template-columns:'+(pm?'minmax(0,1fr) minmax(0,1fr)':'minmax(0,1fr)')+';gap:10px;padding:7px 10px;border-bottom:1px solid #e1e5e1;break-inside:avoid;page-break-inside:avoid">'+
     '<div style="'+noteStyle+'"><span style="color:#64748b;font-weight:700">#'+(i+1)+'</span> '+
       '<b>'+h(t.plan||'No morning plan')+'</b>'+
       (t.customerName?'<div style="font-size:11px;color:#5a626a">Customer: '+h(t.customerName)+'</div>':'')+
       (t.todoTaskId?'<div style="font-size:10px;color:#996715">To-Do</div>':'')+'</div>'+
     (pm?'<div style="'+noteStyle+'"><b>'+h(result)+'</b> — '+h(t.result||'No outcome recorded')+
       (t.nextFollowup?'<div style="font-size:11px;color:#475569">Next: '+h(t.nextFollowup)+'</div>':'')+'</div>':'')+
   '</div>';
 };
 const oneExtra=x=>'<div data-compact-extra style="padding:8px 10px;background:#fbfcfa;border:1px solid #e1e5df;border-radius:7px;min-width:0;break-inside:avoid;page-break-inside:avoid">'+
   '<div style="font-size:12.5px;line-height:1.35;font-weight:750;overflow-wrap:anywhere">'+h(x.customerName||x.category||'Activity')+'</div>'+
   '<div style="'+noteStyle+';margin-top:3px">'+h(x.result||'No outcome recorded')+'</div>'+
   (x.nextFollowup?'<div style="font-size:10.5px;line-height:1.3;color:#586779;margin-top:3px">Next: '+h(x.nextFollowup)+'</div>':'')+
   '</div>';
 const html=list.map(section=>{
   const tasks=allTasks.filter(t=>dailyPlannedSection(t)===section.id);
   const imported=extras.filter(x=>dailyExtraSection(x)===section.id);
   if(!tasks.length&&!imported.length)return '';
   const label=section.label+(tasks.length||imported.length?' <span style="font-weight:500;color:#566579">· '+(tasks.length+imported.length)+'</span>':'');
   return '<section data-compact-section="'+h(section.id)+'" style="border:1px solid #d1d8cd;border-radius:7px;overflow:hidden;margin-top:9px;break-inside:avoid-page">'+
      '<div style="padding:6px 10px;background:#e7eee2;color:#253625;font-weight:800;font-size:12.5px">'+label+'</div>'+
      (tasks.length?'<div>'+tasks.map(oneTask).join('')+'</div>':'')+
      (imported.length?'<div style="display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px;padding:8px">'+imported.map(oneExtra).join('')+'</div>':'')+
     '</section>';
 }).join('');
 const counts=pm?
   '<span>'+allTasks.length+' planned</span><span>'+extras.filter(x=>dailyExtraSection(x)==='visit').length+' visits</span>'+
   '<span>'+extras.filter(x=>dailyExtraSection(x)==='online').length+' online</span>':
   '<span>'+allTasks.length+' planned tasks</span>';
 return '<div data-share-compact style="background:white;color:#263026;font-family:Noto Sans Khmer,Arial,sans-serif">'+
   '<header style="border:1px solid #a8c4a2;border-radius:7px;background:#e4eee0;padding:9px 12px;display:flex;align-items:start;justify-content:space-between;gap:10px">'+
    '<div><b style="font-size:16px;line-height:1.25">'+(pm?'Evening Result':'Morning Plan')+'</b>'+
     '<div style="font-size:12.5px;line-height:1.5;margin-top:3px">'+h(r.date)+' · '+h(r.salesperson||state.profile?.full_name||state.profile?.name||'Sales')+'</div></div>'+
    '<div style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:5px;font-size:10.5px;color:#42553e">'+counts+'</div>'+
   '</header>'+
   (html||'<div style="padding:15px;color:#6b7280;font-size:12px">No activities recorded.</div>')+
   '<footer style="font-size:10.5px;line-height:1.4;color:#5e6b61;margin-top:10px;border-top:1px solid #dfe4dc;padding-top:6px">'+
     'Submitted: '+h(formatDailySubmittedAt(pm?r.pmSubmittedAt:r.amSubmittedAt))+
     ' · '+h(managerReviewStatus(r))+'</footer>'+
 '</div>';
}
// The image is rendered locally in the user's browser. This avoids manually
// scrolling and taking two screenshots. Native device sharing is optional;
// otherwise the exact same single PNG is saved to the device.
window.exportSalesDailyReportImage=async function(share){
 const card=document.getElementById('salesDailyShareCard');
 if(!card)return toast('Open Morning/Evening Share View first.',true);
 if(typeof window.html2canvas!=='function')
   return toast('Image capture is unavailable. Please reconnect, then try again or use Print / PDF.',true);
 const buttons=[...document.querySelectorAll('#salesDailyShareOverlay [data-share-export]')];
 buttons.forEach(b=>{b.disabled=true;b.dataset.oldText=b.textContent;b.textContent='Creating image...'});
 try{
   if(document.fonts?.ready)await document.fonts.ready;
   // Keep the export readable regardless of phone / tablet screen width.
   const canvas=await window.html2canvas(card,{
     scale:2,backgroundColor:'#ffffff',useCORS:true,logging:false,
     scrollX:0,scrollY:-window.scrollY,windowWidth:1050,
     onclone:cloned=>{
       const el=cloned.getElementById('salesDailyShareCard');
       if(el){
         el.style.width='760px';el.style.minWidth='760px';el.style.maxWidth='none';
         el.style.height='auto';el.style.boxSizing='border-box';
         el.style.borderRadius='0';el.style.boxShadow='none';
         el.style.overflow='visible';
       }
     }
   });
   const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
   if(!blob)throw new Error('The image could not be created.');
   const type=card.dataset.shareReportType==='AM'?'Morning-Plan':'Evening-Result';
   const date=String(ui.report?.date||ui.date||'').replace(/[^0-9-]/g,'');
   const name=String(ui.report?.salesperson||state.profile?.name||'Sales')
     .replace(/[^\p{L}\p{N}-]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,45);
   const filename=[type,date,name].filter(Boolean).join('-')+'.png';
   const file=new File([blob],filename,{type:'image/png'});
   if(share&&navigator.share&&(!navigator.canShare||navigator.canShare({files:[file]}))){
     try{
       await navigator.share({files:[file],title:(type==='Morning-Plan'?'Morning Plan':'Evening Result')+' · '+date});
       return;
     }catch(err){
       if(err?.name==='AbortError')return; // User cancelled the share sheet.
       // Unsupported native file sharing falls back to an ordinary PNG.
       console.warn('Native share fallback:',err);
     }
   }
   const objectUrl=URL.createObjectURL(blob);
   const link=document.createElement('a');
   link.href=objectUrl;link.download=filename;
   document.body.appendChild(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(objectUrl),10000);
   if(share)toast('One report image saved. Attach the PNG in Telegram or WhatsApp.');
   else toast('One report PNG downloaded.');
 }catch(err){
   console.warn('Daily report image export failed:',err);
   toast(err?.message||'Could not create the report image. Use Print / PDF instead.',true);
 }finally{
   buttons.forEach(b=>{b.disabled=false;b.textContent=b.dataset.oldText||b.textContent;delete b.dataset.oldText});
 }
};
window.openSalesDailyShare=(section,mode='compact')=>{
 const r=ui.report;if(!r||!(section==='AM'?r.amStatus==='Submitted':r.pmStatus==='Submitted'))return toast('Submit before sharing',true);
 window.closeSalesDailyShare();ensureDailyKhmerFont();const pm=section==='PM';
 const customerCats=['Customer Follow-up','Online Inquiries','Quotation / SR'];
 const isCustomer=t=>!t.todoTaskId&&(!!t.customerId||!!t.customerName||customerCats.includes(t.category));
 const customer=(r.tasks||[]).filter(isCustomer),other=(r.tasks||[]).filter(t=>!isCustomer(t));
 // Each Morning Plan and Evening Result belongs to the SAME HTML table row.
 // Independent stacked divs drift apart when Khmer/English descriptions differ in height.
 const planCell=(t,i)=>'<div style="font-size:12px;line-height:1.85;overflow-wrap:anywhere;white-space:pre-wrap"><span style="font-size:10px;color:#64748b;font-weight:700;margin-right:5px">#'+(i+1)+'</span><b>'+h(t.plan||'No morning plan')+'</b>'+
 (t.customerName?'<div style="font-size:11px;color:#666;padding-left:17px">Customer: '+h(t.customerName)+'</div>':'')+
 (t.todoTaskId?'<div style="font-size:10px;color:#926315;padding-left:17px">To-Do task</div>':'')+'</div>';
 const resultCell=(t,i)=>'<div style="font-size:12px;line-height:1.85;overflow-wrap:anywhere;white-space:pre-wrap"><span style="font-size:10px;color:#64748b;font-weight:700;margin-right:5px">#'+(i+1)+'</span><b>'+h(t.status||'Not updated')+'</b> — '+h(t.result||'No outcome recorded')+
 (t.nextFollowup?'<div style="font-size:11px;color:#666;padding-left:17px">Next: '+h(t.nextFollowup)+'</div>':'')+'</div>';
 const extras=pm?(r.additionalActivities||[]):[];
 // Imported Showroom activities use sourceType="showroom_visit" in the
 // Google Sheet. Classify by source first, then legacy/manual category.
 const plannedBySection=id=>(r.tasks||[]).filter(t=>dailyPlannedSection(t)===id);
 const importedBySection=id=>extras.filter(x=>dailyExtraSection(x)===id);
 const rowStyle='vertical-align:top;break-inside:avoid;page-break-inside:avoid';
 const cellStyle='border:1px solid #bbb;padding:10px;vertical-align:top;overflow-wrap:anywhere';
 const unplannedCell=x=>'<div style="font-size:12px;line-height:1.85;overflow-wrap:anywhere;white-space:pre-wrap"><b>Unplanned · '+h(x.category)+(x.customerName?' — '+h(x.customerName):'')+'</b><div>'+h(x.result||'No outcome recorded')+'</div>'+
 (x.nextFollowup?'<div style="color:#666;font-size:11px">Next: '+h(x.nextFollowup)+'</div>':'')+
 (x.sourceId?'<div style="font-size:10px;color:#666">Linked '+h(x.sourceType==='online'?'Online Inquiry':'Showroom Visit')+' · '+h(x.sourceId.slice(0,8))+'</div>':'')+'</div>';
 const tableSection=(label,list,unplanned)=>{
   const records=list.map((task,i)=>({task,index:i+1,unplanned:false}))
     .concat(pm?unplanned.map(x=>({task:x,unplanned:true})):[]);
   if(!records.length){
     return '<tbody><tr style="'+rowStyle+'"><th scope="row" style="'+cellStyle+';width:'+(pm?'21':'28')+'%;text-align:left;background:#f8f8f6;font-size:12px">'+h(label)+'</th>'+
       '<td style="'+cellStyle+';font-size:12px;color:#888">'+(pm?'— No morning plan or recorded activity':'No planned tasks')+'</td>'+
       (pm?'<td style="'+cellStyle+';font-size:12px;color:#888">—</td>':'')+'</tr></tbody>';
   }
   return '<tbody>'+records.map((entry,i)=>{
     const t=entry.task;
     const category=i===0?'<th scope="rowgroup" rowspan="'+records.length+'" style="'+cellStyle+';width:'+(pm?'21':'28')+'%;text-align:left;background:#f8f8f6;font-size:12px;font-weight:700">'+h(label)+'</th>':'';
     const plan=entry.unplanned
       ?'<div style="font-size:11px;color:#777">— No morning plan (unplanned activity)</div>'
       :planCell(t,entry.index-1);
     return '<tr style="'+rowStyle+';background:'+(i%2?'#fafaf8':'#fff')+'">'+category+
       '<td style="'+cellStyle+';width:'+(pm?'39.5':'72')+'%">'+plan+'</td>'+
       (pm?'<td style="'+cellStyle+';width:39.5%">'+(entry.unplanned?unplannedCell(t):resultCell(t,entry.index-1))+'</td>':'')+
       '</tr>';
   }).join('')+'</tbody>';
 };
 const rows='<table style="border-collapse:collapse;width:100%;table-layout:fixed;margin-top:12px">'+
 '<thead><tr style="background:#e3eedf"><th style="border:1px solid #bbb;padding:9px;font-size:12px;text-align:left">Category</th>'+
 '<th style="border:1px solid #bbb;padding:9px;font-size:12px;text-align:left">Morning Plan</th>'+
 (pm?'<th style="border:1px solid #bbb;padding:9px;font-size:12px;text-align:left">Evening Result</th>':'')+'</tr></thead>'+
 (pm?dailySections.map(section=>
   tableSection(section.label,plannedBySection(section.id),importedBySection(section.id))
  ).join(''):
  tableSection('Customer Tasks',customer,[])+tableSection('Other Tasks / To-Do',other,[])
 )+'</table>';
 const extraBlock='';
 const panel=document.createElement('div');panel.id='salesDailyShareOverlay';panel.style.cssText='position:fixed;inset:0;z-index:99999;background:#0009;overflow:auto;padding:16px';
 const compact=mode!=='detailed';
 const reportBody=compact?dailyCompactShareBody(r,pm):
   '<div style="border:1px solid #b4cbb1;background:#e3eedf;padding:12px"><div style="font-weight:700;font-size:15px">'+(pm?'Evening Result':'Morning Plan')+'</div>'+
   '<div style="font-size:13px;margin-top:4px"><b>Date:</b> '+h(r.date)+' &nbsp; <b>Name:</b> '+h(r.salesperson||state.profile?.full_name||state.profile?.name||'Sales')+'</div></div>'+
   rows+extraBlock+'<div style="margin-top:12px;font-size:11px;color:#777">Submitted: '+h(formatDailySubmittedAt(pm?r.pmSubmittedAt:r.amSubmittedAt))+' · Manager review: '+h(managerReviewStatus(r))+'</div>';
 const actionStyle='border-radius:7px;padding:8px 11px;font-weight:700;font-size:12px;cursor:pointer;border:1px solid #b9c3b7';
 const activeStyle='background:#234033;color:white';
 const inactiveStyle='background:white;color:#253528';
 panel.innerHTML='<div style="max-width:760px;width:100%;margin:auto">'+
  '<div data-share-tools style="display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px;margin-bottom:8px;position:sticky;top:0;z-index:2;padding:6px;background:rgba(24,34,26,.93);border-radius:9px">'+
    '<button type="button" style="'+actionStyle+';'+(compact?activeStyle:inactiveStyle)+'" aria-pressed="'+compact+'" onclick="openSalesDailyShare(\''+section+'\',\'compact\')">One Image</button>'+
    '<button type="button" style="'+actionStyle+';'+(!compact?activeStyle:inactiveStyle)+'" aria-pressed="'+(!compact)+'" onclick="openSalesDailyShare(\''+section+'\',\'detailed\')">Detailed</button>'+
    '<button type="button" data-share-export style="'+actionStyle+';background:#dcefd3;color:#21432a" onclick="exportSalesDailyReportImage(true)">Share Image</button>'+
    '<button type="button" data-share-export style="'+actionStyle+';'+inactiveStyle+'" onclick="exportSalesDailyReportImage(false)">Save PNG</button>'+
    '<button type="button" style="'+actionStyle+';'+inactiveStyle+'" onclick="window.print()">Print / PDF</button>'+
    '<button type="button" style="'+actionStyle+';'+inactiveStyle+'" onclick="closeSalesDailyShare()">Close</button>'+
  '</div>'+
  '<div id="salesDailyShareCard" data-share-mode="'+(compact?'compact':'detailed')+'" data-share-report-type="'+section+
    '" style="width:100%;box-sizing:border-box;background:white;color:#242424;padding:'+(compact?'12':'22')+'px;border-radius:11px;box-shadow:0 8px 32px #0002;font-family:Noto Sans Khmer,Arial,sans-serif;line-height:'+(compact?'1.4':'1.75')+'">'+
    reportBody+'</div>'+
 '</div>';
 document.body.appendChild(panel);panel.addEventListener('click',e=>{if(e.target===panel)window.closeSalesDailyShare()});
 if(!document.getElementById('salesDailySharePrintStyle')){const st=document.createElement('style');st.id='salesDailySharePrintStyle';st.textContent='@media print{body>*:not(#salesDailyShareOverlay){display:none!important}#salesDailyShareOverlay{position:static!important;background:white!important;overflow:visible!important;padding:0!important}#salesDailyShareOverlay [data-share-tools]{display:none!important}#salesDailyShareCard{box-shadow:none!important}}';document.head.appendChild(st)}
};
function renderSalesHome(){
 if(state.page!==P)return;
 const report=ui.report,amLocked=report?.amStatus==='Submitted'&&!report?.editRequests?.some(x=>x.section==='AM'&&x.status==='Approved'),pmLocked=report?.pmStatus==='Submitted'||report?.reviewStatus==='Reviewed';
 const tasks=amLocked?report.tasks:ui.tasks.length?ui.tasks:[empty()];
 ui.tasks=tasks;
 root().innerHTML='<div class="max-w-6xl mx-auto space-y-4">'+header('Daily Plan & Result','One report per day · Morning plan and evening results stay together')+
 '<div class="flex flex-wrap gap-2">'+(report?.amStatus==='Submitted'?'<button onclick="openSalesDailyShare(\'AM\')" class="'+lightButton+'">One-Image Morning Share</button>':'')+(report?.pmStatus==='Submitted'?'<button onclick="openSalesDailyShare(\'PM\')" class="'+lightButton+'">One-Image Evening Share</button>':'')+'</div>'+
 '<div class="rounded-2xl border bg-white p-4 flex flex-wrap gap-3 items-end justify-between">'+
 '<label class="text-xs font-bold">Report Date<input id="salesDailyDate" type="date" class="'+common+'" value="'+h(ui.date)+'" onchange="selectSalesDailyDate()"></label>'+
 '<div class="flex flex-wrap gap-2"><span class="rounded-lg bg-amber-50 px-3 py-2 text-xs">AM: <b>'+h(report?.amStatus||'Not Started')+'</b></span>'+
 '<span class="rounded-lg bg-blue-50 px-3 py-2 text-xs">PM: <b>'+h(report?.pmStatus||'Not Started')+'</b></span>'+
 '<span class="rounded-lg bg-gray-100 px-3 py-2 text-xs">Manager review: <b>'+h(report?managerReviewStatus(report):'Not Ready (PM not submitted)')+'</b></span></div></div>'+
 (report?.managerComment?'<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs"><b>Manager note:</b> '+h(report.managerComment)+'</div>':'')+
 (isOverdue(report)?'<div class="rounded-xl border border-red-200 bg-red-50 text-red-800 p-3 text-sm"><b>Overdue Evening Result:</b> The first Evening Result was due by 10:00 AM the following day (Phnom Penh time). '+h(ui.policyVersion!=='next-day-10am-20261104'?'The updated deadline rule is not yet active on Google Apps Script.':latePmHint(report)||'Management has authorized a late submission.')+'</div>':'')+
 '<div id="salesDailyAttention" aria-live="polite"></div>'+
 '<section class="space-y-3"><div class="flex flex-wrap justify-between items-center gap-2">'+
 '<h3 class="font-bold">Morning Plan</h3>'+(amLocked?'':'<button type="button" onclick="addSalesDailyTask()" class="'+lightButton+'">+ Add Task</button>')+'</div>'+
 '<div id="dailyPlanRows" class="grid gap-2">'+tasks.map((t,i)=>amLocked?compactSubmittedTask(t,i):formTask(t,i,false)).join('')+'</div>'+
 (!amLocked?'<div class="rounded-xl bg-[#fdfbf6] border p-3 flex flex-wrap gap-2 items-end">'+
 '<label class="text-xs font-semibold">Carry forward unfinished plans from<input id="dailyCarryFrom" type="date" value="'+h(backDays(ui.date,1))+'" class="'+common+' mt-1"></label>'+
 '<button type="button" onclick="carrySalesDailyTasks()" class="'+lightButton+'">Preview Unfinished Plans</button></div>'+
 '<div class="flex flex-wrap gap-2"><button onclick="saveSalesDailyMorning(false)" class="'+lightButton+'">Save AM Draft</button>'+
 '<button onclick="saveSalesDailyMorning(true)" class="'+actionButton+'">Submit Morning Plan</button></div>':
 '<div class="flex items-center flex-wrap gap-2"><p class="text-xs text-green-700">Morning plan submitted at '+h(formatDailySubmittedAt(report?.amSubmittedAt))+'. Changes are recorded in the audit log.</p><button onclick="requestSalesDailyEdit(\'AM\')" class="'+lightButton+'">Request Morning Edit</button></div>')+'</section>'+
 (amLocked?'<section class="space-y-3 border-t pt-5"><h3 class="font-bold">Evening Result</h3>'+
 '<p class="text-xs text-gray-500">Update what actually happened, and choose the next follow-up date when necessary.</p>'+
 '<div class="grid gap-3">'+(report.tasks||[]).map((t,i)=>pmTask(t,i,pmLocked)).join('')+'</div>'+ additionalEditor(pmLocked)+
 (!pmLocked?'<div class="flex flex-wrap gap-2"><button onclick="saveSalesDailyEvening(false)" class="'+lightButton+'">Save PM Draft</button>'+
 '<button onclick="saveSalesDailyEvening(true)" '+(firstPmLocked(report)?'disabled title="Ask management to allow a late submission" ':'')+'class="'+actionButton+'">Submit Evening Result</button></div>':
 '<div class="flex items-center flex-wrap gap-2"><p class="text-xs text-green-700">Evening results submitted. Manager can review and request corrections.</p><button onclick="requestSalesDailyEdit(\'PM\')" class="'+lightButton+'">Request Evening Edit</button></div>')+'</section>':'')+
 (report?.editRequests?.length?'<div class="rounded-xl border bg-white p-3"><b class="text-sm">Edit Requests</b>'+report.editRequests.map(x=>'<p class="text-xs mt-2">'+h(x.section)+' · '+h(x.status)+' · '+h(x.reason)+(x.decisionNote?' · '+h(x.decisionNote):'')+'</p>').join('')+'</div>':'')+
 '<div data-daily-weekly>'+weeklyPanel()+'</div>'+'<section class="rounded-2xl border bg-white p-4"><div class="flex justify-between gap-2 items-center"><div><b class="text-sm">Recorded activity in the app</b><p class="text-xs text-gray-500 mt-1">CRM follow-ups, Showroom/Online events and order activity. These do not automatically count as completed tasks.</p></div>'+
 '<button onclick="showDailyActivitySuggestions()" class="'+lightButton+'">View Today’s Activity</button></div><div id="dailyActivitySuggestions" class="mt-3"></div></section></div>';
 window.refreshSalesDailyAttention?.();
}
async function renderManager(){
 const reports=ui.reports,people=ui.people;
 const count=(k,v)=>reports.filter(x=>x[k]===v).length;
 const to=ui.end,from=ui.start;
 const compliance=people.map(person=>{const rows=reports.filter(r=>r.userId===person.user_id&&r.amStatus==='Submitted');return{name:person.name,plans:rows.length,pm:rows.filter(r=>r.pmStatus==='Submitted').length,overdue:rows.filter(isOverdue).length,late:rows.filter(isLate).length};}).filter(x=>x.plans);
 const compliancePanel='<section class="rounded-2xl border bg-white p-4"><h3 class="font-bold text-sm mb-2">Salesperson Submission Compliance</h3><p class="text-xs text-gray-500 mb-3">Based on morning plans in the selected date range. Missing mornings are not counted as compliant days.</p>'+
 '<div class="overflow-x-auto"><table class="text-xs w-full text-left"><thead><tr class="border-b"><th class="p-2">Salesperson</th><th class="p-2">AM Plans</th><th class="p-2">PM Submitted</th><th class="p-2">PM Overdue</th><th class="p-2">Late PM</th><th class="p-2">PM Submission Rate</th></tr></thead><tbody>'+
 (compliance.length?compliance.map(x=>'<tr class="border-b"><td class="p-2">'+h(x.name)+'</td><td class="p-2">'+x.plans+'</td><td class="p-2">'+x.pm+'</td><td class="p-2">'+x.overdue+'</td><td class="p-2">'+x.late+'</td><td class="p-2">'+Math.round(x.pm/x.plans*100)+'%</td></tr>').join(''):'<tr><td colspan="6" class="p-3 text-gray-500">No submitted morning plans for this range.</td></tr>')+'</tbody></table></div></section>';
 root().innerHTML='<div class="max-w-7xl mx-auto space-y-4">'+header('Team Daily Review','Compare morning plans and evening results for Sales-role staff only')+
 '<div id="dailyManagerAttention" aria-live="polite"></div>'+
 '<div class="rounded-2xl border bg-white p-4 flex flex-wrap items-end gap-3">'+
 '<label class="text-xs font-semibold">From<input id="dailyReviewFrom" class="'+common+'" type="date" value="'+h(from)+'"></label>'+
 '<label class="text-xs font-semibold">To<input id="dailyReviewTo" class="'+common+'" type="date" value="'+h(to)+'"></label>'+
 '<label class="text-xs font-semibold">Salesperson<select id="dailyReviewPerson" class="'+common+'"><option value="">All Sales Staff</option>'+
 people.map(x=>'<option value="'+h(x.user_id)+'" '+(ui.person===x.user_id?'selected':'')+'>'+h(x.name)+'</option>').join('')+'</select></label>'+
 '<button onclick="reloadSalesDailyReview()" class="'+actionButton+'">Apply</button></div>'+
 '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">'+[
  ['Reports',reports.length],['Morning Plans Submitted',count('amStatus','Submitted')],
  ['Evening Results Submitted',count('pmStatus','Submitted')],
  ['PM Overdue',reports.filter(isOverdue).length],['PM Submitted Late',reports.filter(isLate).length],['Awaiting Manager Review',reports.filter(r=>managerReviewStatus(r)==='Awaiting Manager Review').length],['Manager Reviewed',count('reviewStatus','Reviewed')]
 ].map(([n,v])=>'<div class="bg-white border rounded-2xl p-4"><div class="text-[10px] font-bold uppercase text-gray-500">'+n+'</div><div class="font-black text-2xl mt-2">'+v+'</div></div>').join('')+'</div>'+
 '<div data-daily-weekly>'+weeklyPanel()+'</div>'+compliancePanel+'<section class="bg-white border rounded-2xl overflow-hidden">'+
 '<div class="p-4 border-b font-bold text-sm">Daily Reports · '+reports.length+'</div>'+
 (reports.length?'<div class="divide-y">'+reports.map(r=>'<div class="p-4 flex flex-wrap items-center gap-3">'+
 '<div class="flex-1 min-w-[210px]"><b class="text-sm">'+h(r.salesperson)+'</b><p class="text-xs text-gray-500 mt-1">'+h(r.date)+' · '+r.tasks.length+' tasks</p>'+
 '<p class="text-[11px] mt-1">AM: '+h(r.amStatus||'Draft')+' · PM: '+h(r.pmStatus||'Not Started')+
 ' · Manager review: '+h(managerReviewStatus(r))+managerReviewAudit(r)+(r.amTodoAmended?' · AM REVISED (TO-DO)':'')+(isOverdue(r)?' · PM OVERDUE':isLate(r)?' · PM LATE':'')+'</p></div>'+
 '<button onclick="openDailyManagerReport(\''+h(r.id)+'\')" class="'+lightButton+'">View Plan & Result</button>'+(state.profile?.role==='super_admin'?'<button onclick="deleteSalesDailyReport(\''+h(r.id)+'\')" class="px-3 py-2 rounded-xl border border-red-200 text-red-700 text-xs font-bold">Delete</button>':'')+'</div>').join('')+'</div>':
 '<div class="p-10 text-sm text-gray-500 text-center">No Sales reports found for the selected date range.</div>')+'</section></div>';
 window.refreshSalesDailyAttention?.();
}
window.reloadSalesDailyReview=async()=>{
 ui.start=elem('dailyReviewFrom')?.value||ui.start;
 ui.end=elem('dailyReviewTo')?.value||ui.end;
 ui.person=elem('dailyReviewPerson')?.value||'';
 await reload();
};
function groupedDailyManagerExtras(extras){
 const groups=groupDailyExtras(extras).filter(g=>g.rows.length);
 if(!groups.length)return '';
 return '<div class="rounded-xl border p-3 space-y-3"><b class="text-sm">Additional Activities (Unplanned)</b>'+
 groups.map(group=>
  '<div class="rounded-lg border overflow-hidden"><div class="bg-slate-50 px-3 py-2 font-bold text-xs">'+
  h(group.label)+' · '+group.rows.length+'</div><div class="divide-y">'+
  group.rows.map(({entry:x})=>{
   const sourceAction='openDailyActivitySource('+JSON.stringify(String(x.sourceType||''))+','+
    JSON.stringify(String(x.sourceId||''))+')';
   return '<div class="text-xs px-3 py-2"><b>'+h(x.category)+'</b>'+
    (x.customerName?' · '+h(x.customerName):'')+
    '<div class="mt-1">'+h(x.result||'No outcome recorded')+'</div>'+
    (x.nextFollowup?'<div class="text-gray-500">Next follow-up: '+h(x.nextFollowup)+'</div>':'')+
    (x.sourceId?'<button type="button" class="underline text-blue-700 mt-1" onclick="'+h(sourceAction)+'">Open original activity ↗</button>':'')+
    '</div>';
  }).join('')+'</div></div>').join('')+'</div>';
}
window.openDailyManagerReport=(id,selectedReport)=>{
 const r=selectedReport||ui.reports.find(x=>String(x.id)===String(id))||cachedDailyReport(id,'','',300000);
 if(!r)return toast('This Daily Report is unavailable. Refresh the review list.',true);
 rememberDailyReports([r]);
 const editRequests=(r.editRequests||[]).filter(x=>x.status==='Pending');
 const requestActions=editRequests.map(x=>'<div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs"><b>'+h(x.section==='AM'?'Morning Plan':'Evening Result')+' edit request</b><p class="my-2">'+h(x.reason)+'</p><div class="flex gap-2"><button class="'+lightButton+'" onclick="decideSalesDailyEdit(\''+h(x.id)+'\',\'Rejected\')">Reject</button><button class="'+actionButton+'" onclick="decideSalesDailyEdit(\''+h(x.id)+'\',\'Approved\')">Approve</button></div></div>').join('');
 const rows=r.tasks.map((t,i)=>'<div class="rounded-xl border p-3 bg-white"><b class="text-xs">'+(i+1)+'. '+h(t.plan)+'</b>'+
 '<div class="text-[11px] text-gray-500 mt-1">'+h(t.category)+(t.customerName?' · '+h(t.customerName):'')+'</div>'+
 '<div class="grid sm:grid-cols-2 gap-2 mt-2 text-xs"><div><b>Planned:</b> '+h(t.plannedFollowup||'No date')+'</div>'+
 '<div><b>Task outcome:</b> '+h(managerTaskStatus(t))+'</div></div>'+
 '<div class="text-xs mt-2"><b>Actual result:</b> '+h(t.result||'Not submitted')+'</div>'+
 (t.nextFollowup?'<div class="text-xs text-blue-700 mt-2">Next follow-up: '+h(t.nextFollowup)+'</div>':'')+'</div>').join('');
 openModal('Daily Plan & Result — '+h(r.salesperson)+' · '+h(r.date),
 '<div class="space-y-4">'+requestActions+'<div class="rounded-xl bg-gray-50 p-3 text-xs">AM: '+h(r.amStatus)+' · PM: '+h(r.pmStatus)+
 '</div><div class="mt-1"><b>Manager review:</b> '+h(managerReviewStatus(r))+managerReviewAudit(r)+'</div></div>'+rows+
 '<p class="text-[11px] text-gray-500">Manager review and task completion are separate. A reviewed report can still contain unfinished tasks.</p>'+
 (initialPmMissing(r)?
  '<div class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs"><b>Evening Result not submitted</b>'+
  '<p class="mt-1">Due by 10:00 AM on '+h(backDays(r.date,-1))+' (Phnom Penh time). '+(isOverdue(r)?'This submission is overdue.':'The deadline has not passed yet.')+'</p>'+
  (r.lateSubmissionAllowed?'<p class="font-semibold text-green-800 mt-2">Late submission authorized. Awaiting the salesperson.</p>':
   isOverdue(r)&&ui.policyVersion==='next-day-10am-20261104'?
    '<button type="button" class="'+actionButton+' mt-2" onclick="allowSalesDailyLatePm(\''+h(r.id)+'\',\''+h(r.date)+'\')">Allow Late Evening Result</button>':'')+
  '</div>':'')+
 groupedDailyManagerExtras(r.additionalActivities||[])+
 (r.managerComment?'<p class="text-xs text-gray-600">Previous Manager comment: '+h(r.managerComment)+'</p>':'')+
 (r.pmStatus==='Submitted'&&r.reviewStatus!=='Reviewed'?
 '<label class="block text-xs font-bold">Manager comments<textarea id="dailyManagerComment" rows="3" maxlength="1500" class="'+common+' mt-1">'+h(r.managerComment||'')+'</textarea></label>'+
 '<div class="flex flex-wrap gap-2">'+
 '<button onclick="submitDailyManagerReview(\''+h(r.id)+'\',\'Changes Requested\')" class="'+lightButton+'">Request Corrections</button>'+
 '<button onclick="submitDailyManagerReview(\''+h(r.id)+'\',\'Reviewed\')" class="'+actionButton+'">Mark Reviewed</button></div>':'')+
 '<button onclick="closeModal()" class="'+lightButton+'">Close</button></div>');
};
let managerReviewSaving=false;
window.submitDailyManagerReview=async(id,decision)=>{
 if(managerReviewSaving)return;
 const report=ui.reports.find(r=>String(r.id)===String(id))||cachedDailyReport(id,'','',300000);
 if(!review()||!report||report.pmStatus!=='Submitted'||report.reviewStatus==='Reviewed')
  return toast('This report is not awaiting manager review. Refresh before taking action.',true);
 const comment=elem('dailyManagerComment')?.value||'';
 if(decision==='Changes Requested'&&!comment.trim())return toast('Add a reason for the requested changes.',true);
 managerReviewSaving=true;
 let sent=false;
 try{
  await api('review',{reportId:id,decision,comment});
  sent=true;
  // Do not claim success until the authoritative Google Sheet returns the saved decision.
  const result=await api('read',{start:report.date,end:report.date,userId:report.userId});
  const updated=(result.reports||[]).find(r=>String(r.id)===String(id));
  if(!updated||updated.reviewStatus!==decision){
   toast('Review was submitted, but its saved status could not be confirmed. Refresh before trying again.',true);
   return;
  }
  replaceDailyReport(updated);
  closeModal();
  // Keep the manager's selected filters and report list on screen.
  // No extra full-page loading transition after confirming this decision.
  if(state.page===R){
   renderManager();
   api('weekly',{start:backDays(ui.end,6),end:ui.end,userId:ui.person||null}).then(stats=>{
    if(state.page===R){ui.stats=stats;const node=root()?.querySelector('[data-daily-weekly]');
     if(node)node.outerHTML='<div data-daily-weekly>'+weeklyPanel()+'</div>'}
   }).catch(err=>console.warn('Daily weekly summary refresh:',err.message));
  }
  toast(decision==='Reviewed'
   ?'Manager review completed. Unfinished task outcomes have not been changed.'
   :'Corrections requested. The salesperson can update the Evening Result.');
  // The shared approval count is refreshed only after the saved review is confirmed.
  window.invalidateSalesDailyApprovals?.();
 }catch(e){
  toast(sent
   ?'Review was submitted, but the updated report could not be loaded. Refresh before trying again.'
   :'Review could not be saved: '+(e.message||e),true);
 }finally{managerReviewSaving=false;}
};
async function reload(){
 resetAccount();
 const seq=++ui.seq;const page=state.page;const userId=state.user?.id;if(!allowed(page))return toast('Daily Report permission required',true);
 root().innerHTML='<div class="rounded-xl bg-white border p-8 text-sm text-gray-500">Loading Daily Reports from Google Sheets…</div>';
 try{
  await access();
  if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
  if(!ui.config?.configured)return showSetup();
  if(page===P){
   await loadCustomers();
   if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
   // Do not hold up the report editor while the slower seven-day summary loads.
   let reportLoaded=false;
   api('weekly',{start:backDays(ui.date,6),end:ui.date}).then(stats=>{
     if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
     ui.stats=stats;if(reportLoaded){const target=root()?.querySelector('[data-daily-weekly]');if(target)target.outerHTML='<div data-daily-weekly>'+weeklyPanel()+'</div>';}
   }).catch(err=>{
     if(seq===ui.seq&&state.page===page&&state.user?.id===userId)
       console.warn('Daily summary unavailable:',err.message);
   });
   const res=await api('read',{date:ui.date,start:ui.date,end:ui.date});
   if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
   ui.policyVersion=res.policyVersion||'';
   ui.report=(res.reports||[]).find(x=>x.userId===state.user?.id)||null;
   ui.tasks=ui.report?.tasks?.length?ui.report.tasks:[empty()];
   // To-Do linkage only creates a local unsaved Morning Plan draft, never submits.
   const todoDraft=sessionStorage.getItem('salesDailyTodoDraft');
   if(todoDraft){
     try{
       const task=JSON.parse(todoDraft);
       const approved=ui.report?.editRequests?.some(x=>x.section==='AM'&&x.status==='Approved');
       const locked=ui.report?.amStatus==='Submitted'&&!approved;
       if(locked){
         window.pendingSalesDailyTodo=task;
         openModal('Add To-Do to submitted Morning Plan',
           '<p class="text-sm mb-3">Add <b>'+h(task.plan)+'</b> as a new Morning Plan task for '+h(ui.date)+'?</p>'+
           '<p class="text-xs text-gray-500 mb-4">No approval is needed. Management will see the revised report and the amendment will be recorded in the audit log. Existing morning tasks and evening results stay unchanged.</p>'+
           '<div class="flex flex-wrap gap-2"><button class="'+actionButton+'" onclick="appendPendingDailyTodo()">Add and Record Revision</button><button class="'+lightButton+'" onclick="choosePendingTodoDate()">Choose Another Date</button><button class="'+lightButton+'" onclick="closeModal()">Close</button></div>');
       }else if(task.sourceTaskId&&!ui.tasks.some(t=>t.todoTaskId===task.sourceTaskId)){
         if(ui.tasks.length===1&&!ui.tasks[0].plan)ui.tasks=[];
         if(ui.tasks.length<20){ui.tasks.push({...empty(),...task,todoTaskId:task.sourceTaskId,sourceTaskId:'',id:''});sessionStorage.removeItem('salesDailyTodoDraft')}
         else toast('Morning Plan has reached the 20-task limit. The To-Do task was not imported.',true);
       }else if(task.sourceTaskId)sessionStorage.removeItem('salesDailyTodoDraft');
     }catch(_){sessionStorage.removeItem('salesDailyTodoDraft')}
   }
   reportLoaded=true;renderSalesHome();
   // Role-scoped alerts are refreshed from the authenticated Google Sheet.

  }else{
   // Render report rows as soon as available; summary runs independently.
   let reportLoaded=false;
   api('weekly',{start:backDays(ui.end,6),end:ui.end,userId:ui.person||null}).then(stats=>{
     if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
     ui.stats=stats;if(reportLoaded){const target=root()?.querySelector('[data-daily-weekly]');if(target)target.outerHTML='<div data-daily-weekly>'+weeklyPanel()+'</div>';}
   }).catch(err=>{
     if(seq===ui.seq&&state.page===page&&state.user?.id===userId)
       console.warn('Daily summary unavailable:',err.message);
   });
   const res=await api('read',{start:ui.start,end:ui.end,userId:ui.person||null});
   if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
   ui.policyVersion=res.policyVersion||'';
   ui.reports=res.reports||[];ui.people=res.salesPeople||[];rememberDailyReports(ui.reports);reportLoaded=true;renderManager();
  }
 }catch(err){
  if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
  root().innerHTML=header(page===P?'Daily Plan & Result':'Team Daily Review','Google Sheets')+
   '<div class="mt-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">'+h(err.message||'Google Sheets unavailable')+
   '<div class="mt-3"><button onclick="reloadDailyReport()" class="'+lightButton+'">Retry</button></div></div>';
 }
}
// Personal in-app Daily Plan alerts remain in the authenticated Google Sheet.
const dailyAttentionCache={userId:null,at:0,data:null,promise:null,revision:0};
window.getSalesDailyAttention=async()=>{
 if(!sales()&&!review())return{count:0,missingCount:0,unfinishedCount:0,missing:[],unfinished:[],target:'dashboard'};
 const id=String(state.user?.id||''),role=String(state.profile?.role||'');
 if(dailyAttentionCache.userId===id&&dailyAttentionCache.role===role&&dailyAttentionCache.data&&Date.now()-dailyAttentionCache.at<60000)
  return dailyAttentionCache.data;
 if(dailyAttentionCache.userId===id&&dailyAttentionCache.role===role&&dailyAttentionCache.promise)return dailyAttentionCache.promise;
 dailyAttentionCache.userId=id;dailyAttentionCache.role=role;
 const revision=++dailyAttentionCache.revision;
 const pending=(async()=>{
  await access();
  if(!ui.config?.configured)return{count:0,missingCount:0,unfinishedCount:0,missing:[],unfinished:[],target:'dashboard'};
  const current=today(),res=await api('read',{start:backDays(current,7),end:current,userId:review()?null:id});
  rememberDailyReports(res.reports);
  const missing=[],unfinished=[];
  (res.reports||[]).forEach(r=>{
   if(sales()&&String(r.userId)!==id)return; // Never show other salespeople's alerts.
   if(initialPmMissing(r)&&r.date<current){
    missing.push({id:String(r.id),date:r.date,userId:String(r.userId||''),
     salesperson:r.salesperson||'Sales',lateSubmissionAllowed:!!r.lateSubmissionAllowed,
     overdue:isOverdue(r),deadline:r.pmDeadline||pmDeadline(r.date)});
   }
   if(sales()&&String(r.userId)===id&&r.pmStatus==='Submitted'){
    (r.tasks||[]).filter(unfinishedTask).forEach(t=>unfinished.push({
     id:String(t.id||''),reportId:String(r.id),date:r.date,
     status:t.status,plan:t.plan||'Unnamed task',nextFollowup:t.nextFollowup||''
    }));
   }
  });
  // Review and task completion are separate; a management missing report is not
  // a manager-approval request until PM is actually submitted.
  const result={missing,unfinished,missingCount:missing.length,unfinishedCount:unfinished.length,
   count:missing.length+unfinished.length,target:review()?R:P,policyVersion:res.policyVersion||''};
  if(dailyAttentionCache.revision!==revision||dailyAttentionCache.userId!==id||dailyAttentionCache.role!==role||String(state.user?.id||'')!==id)return{count:0,missingCount:0,unfinishedCount:0,missing:[],unfinished:[],target:'dashboard'};
  dailyAttentionCache.data=result;dailyAttentionCache.at=Date.now();
  return result;
 })();
 dailyAttentionCache.promise=pending;
 try{return await pending}finally{if(dailyAttentionCache.promise===pending)dailyAttentionCache.promise=null}
};
function dailyAttentionPanel(info){
 if(!info?.count)return '';
 if(review()){
  return '<div class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><b>'+info.missingCount+' missing Evening Result'+(info.missingCount===1?'':'s')+'</b>'+
   '<p class="text-xs text-amber-900 mt-1">Only staff who submitted a Morning Plan are included. Each Evening Result was due by 10:00 AM the following day.</p>'+
   '<div class="grid gap-2 mt-3">'+info.missing.slice(0,20).map(r=>
    '<div class="rounded-lg bg-white border px-3 py-2 flex flex-wrap gap-2 items-center justify-between"><div><b>'+h(r.salesperson)+'</b> · '+h(r.date)+
    ' <span class="text-xs font-semibold '+(r.overdue?'text-red-700':'text-amber-800')+'">'+(r.overdue?'Overdue':'Due today by 10:00 AM')+'</span>'+
    (r.lateSubmissionAllowed?' · Late submission authorized':'')+'</div>'+
    '<div class="flex gap-2"><button type="button" class="'+lightButton+'" onclick="openSalesDailyMissingReport(\''+h(r.id)+'\',\''+h(r.date)+'\',\''+h(r.userId)+'\')">View report</button>'+
    (r.overdue&&!r.lateSubmissionAllowed&&info.policyVersion==='next-day-10am-20261104'?'<button type="button" class="'+lightButton+'" onclick="allowSalesDailyLatePm(\''+h(r.id)+'\',\''+h(r.date)+'\')">Allow late PM</button>':'')+
    '</div></div>').join('')+'</div></div>';
 }
 return '<div class="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm"><b>Daily Plan reminders</b>'+
  (info.missingCount?'<p class="mt-2 font-semibold text-red-800">'+info.missingCount+' missing Evening Result'+(info.missingCount===1?'':'s')+'</p>'+
    '<div class="grid gap-2 mt-2">'+info.missing.slice(0,10).map(r=>
      '<button type="button" class="text-left rounded-lg bg-white border px-3 py-2 text-xs" onclick="openOverdueSalesDaily(\''+h(r.date)+'\')">'+h(r.date)+' · '+(r.overdue?'Overdue':'Due by 10:00 AM today')+(r.lateSubmissionAllowed?' · Late submission authorized':' · Ask manager if overdue')+'</button>').join('')+'</div>':'')+
  (info.unfinishedCount?'<p class="mt-3 font-semibold text-amber-900">'+info.unfinishedCount+' unfinished task'+(info.unfinishedCount===1?'':'s')+' from submitted Evening Results</p>'+
    '<div class="grid gap-2 mt-2">'+info.unfinished.slice(0,15).map(t=>
      '<button type="button" class="text-left rounded-lg bg-white border px-3 py-2 text-xs" onclick="openOverdueSalesDaily(\''+h(t.date)+'\')">'+
      h(t.date)+' · '+h(t.plan)+' · <b>'+h(t.status)+'</b>'+(t.nextFollowup?' · Next '+h(t.nextFollowup):'')+'</button>').join('')+'</div>'+
    '<p class="text-xs text-amber-900 mt-2">Carry these forward or complete the follow-up in your next report. Reviewing a report does not mark unfinished tasks as completed.</p>':'')+
  '</div>';
}
window.refreshSalesDailyAttention=async()=>{
 const page=state.page,userId=String(state.user?.id||'');
 const id=page===P?'salesDailyAttention':page===R?'dailyManagerAttention':'';
 const holder=id?elem(id):null;if(!holder)return;
 try{
  const info=await window.getSalesDailyAttention();
  if(state.page===page&&String(state.user?.id||'')===userId&&elem(id))elem(id).innerHTML=dailyAttentionPanel(info);
 }catch(err){console.warn('Daily Plan alerts could not refresh:',err.message||err)}
};
window.openSalesDailyMissingReport=async(id,date,personId)=>{
 if(!review())return toast('Management permission required',true);
 await window.openSalesDailyApprovalItem(id,date,personId);
};
window.allowSalesDailyLatePm=async(id,date)=>{
 if(!review())return toast('Management permission required',true);
 if(ui.policyVersion!=='next-day-10am-20261104')return toast('Update the existing Google Apps Script deployment first to enable late PM authorization.',true);
 const reason=prompt('Reason to allow a late Evening Result for '+date+':');
 if(reason===null)return;
 if(!reason.trim())return toast('Enter a reason for allowing a late submission',true);
 try{
  await api('allow_late_pm',{reportId:id,reason:reason.trim()});
  const original=ui.reports.find(r=>String(r.id)===String(id))||cachedDailyReport(id,date,'',300000);
  const result=await api('read',{start:date,end:date,userId:original?.userId||null});
  const updated=(result.reports||[]).find(r=>String(r.id)===String(id));
  if(!updated?.lateSubmissionAllowed){
   return toast('Permission was submitted but has not been confirmed in Google Sheets. Refresh before retrying.',true);
  }
  replaceDailyReport(updated);
  toast('Late submission authorized. The salesperson may now submit the Evening Result.');
  if(state.page===R)renderManager();
  window.openDailyManagerReport(String(id),updated);
  window.invalidateSalesDailyApprovals?.();
 }catch(err){toast(err.message||'Could not authorize late submission',true)}
};

// Unified Approvals can inspect recent TEAM reviews through the existing
// authenticated Google Sheet relay. No Daily Plan data is copied to Supabase.
const dailyApprovalCache={userId:null,at:0,data:null,promise:null,revision:0};
window.invalidateSalesDailyApprovals=()=>{
 dailyApprovalCache.revision++;dailyApprovalCache.userId=null;dailyApprovalCache.at=0;dailyApprovalCache.data=null;dailyApprovalCache.promise=null;
 dailyAttentionCache.revision++;dailyAttentionCache.userId=null;dailyAttentionCache.at=0;dailyAttentionCache.data=null;dailyAttentionCache.promise=null;
 window.refreshSalesDailyAttention?.();
 if(typeof window.refreshApprovalNotifications==='function')window.refreshApprovalNotifications();
 if(typeof window.refreshAppNotifications==='function')Promise.resolve(window.refreshAppNotifications()).catch(err=>console.warn('Daily bell refresh:',err.message||err));
};
window.getSalesDailyApprovalQueue=async()=>{
 if(!review())return [];
 const id=String(state.user?.id||'');
 if(dailyApprovalCache.userId===id&&dailyApprovalCache.data&&Date.now()-dailyApprovalCache.at<90000)
   return dailyApprovalCache.data;
 if(dailyApprovalCache.userId===id&&dailyApprovalCache.promise)return dailyApprovalCache.promise;
 dailyApprovalCache.userId=id;
 const revision=++dailyApprovalCache.revision;
 const pending=(async()=>{
   await access();
   if(!ui.config?.configured)return [];
   const res=await api('read',{start:backDays(today(),30),end:today(),userId:null});
   rememberDailyReports(res.reports);
   const rows=[];
   (res.reports||[]).forEach(r=>{
     (r.editRequests||[]).filter(x=>x.status==='Pending').forEach(x=>rows.push({
       id:'daily-edit:'+String(x.id),kind:'edit',report_id:String(r.id),date:r.date,userId:String(r.userId||''),
       salesperson:r.salesperson||'Sales',request_id:String(x.id),section:x.section||'',
       reason:x.reason||'',requested_at:x.requestedAt||x.createdAt||r.pmSubmittedAt||r.amSubmittedAt||r.date
     }));
     if(r.pmStatus==='Submitted'&&!['Reviewed','Changes Requested'].includes(r.reviewStatus))
       rows.push({id:'daily-review:'+String(r.id),kind:'review',
         report_id:String(r.id),date:r.date,userId:String(r.userId||''),salesperson:r.salesperson||'Sales',
         requested_at:r.pmSubmittedAt||r.date});
   });
   // A user may sign out while Google Sheets is responding. Never cache or
   // surface the old account's review queue under the next account.
   if(dailyApprovalCache.revision!==revision||dailyApprovalCache.userId!==id||String(state.user?.id||'')!==id)return [];
   dailyApprovalCache.at=Date.now();
   dailyApprovalCache.data=rows;
   return rows;
 })();
 dailyApprovalCache.promise=pending;
 try{return await pending}finally{if(dailyApprovalCache.promise===pending)dailyApprovalCache.promise=null}
};
let dailyDirectOpening=false;
window.openSalesDailyApprovalItem=async(reportId,reportDate,personId)=>{
 if(!review())return toast('Team Daily Review permission required',true);
 if(dailyDirectOpening)return;
 const account=String(state.user?.id||'');
 const current=ui.reports.find(r=>String(r.id)===String(reportId)&&
  (!reportDate||r.date===reportDate)&&(!personId||String(r.userId)===String(personId)));
 const cached=current||cachedDailyReport(reportId,reportDate,personId);
 // The Approvals list and yesterday's missing-result alert have already
 // obtained this report from the authenticated Google Sheet. Show it now.
 if(cached)return window.openDailyManagerReport(String(reportId),cached);
 if(!reportDate)return toast('Report date is missing. Refresh your approvals.',true);
 dailyDirectOpening=true;
 openModal('Opening Daily Report','<p class="text-sm text-gray-600">Loading only this report from Google Sheets…</p>');
 try{
  await access();
  const res=await api('read',{start:reportDate,end:reportDate,userId:personId||null});
  if(account!==String(state.user?.id||''))return closeModal();
  const found=(res.reports||[]).find(r=>String(r.id)===String(reportId));
  if(!found){
   closeModal();
   window.invalidateSalesDailyApprovals?.();
   return toast('This report is unavailable in your team or may have been deleted. The review list will refresh.',true);
  }
  rememberDailyReports([found]);
  window.openDailyManagerReport(String(reportId),found);
 }catch(err){
  if(account===String(state.user?.id||'')){
   closeModal();
   toast('Could not open this report: '+(err.message||err),true);
  }
 }finally{dailyDirectOpening=false}
};

window.reloadDailyReport=reload;
const oldNav=window.navItems;
if(typeof oldNav==='function')window.navItems=function(){
 const items=(oldNav.apply(this,arguments)||[]).slice();
 if(sales()&&!items.some(x=>x[0]===P)){
  const i=items.findIndex(x=>x[0]==='customers');
  items.splice(i<0?0:i+1,0,[P,'Daily Plan & Result','☀']);
 }
 if(review()&&!items.some(x=>x[0]===R)){
  const i=items.findIndex(x=>x[0]==='sales-activity');
  items.splice(i<0?items.length:i+1,0,[R,'Team Daily Review','☷']);
 }
 return items;
};
window.deleteSalesDailyReport=async id=>{
 if(state.profile?.role!=='super_admin')return toast('Super Admin only',true);
 const r=ui.reports.find(x=>x.id===id);if(!r)return toast('Report not found',true);
 const phrase=prompt('Permanently delete the Daily Plan and Evening Result for '+r.salesperson+' on '+r.date+'? This cannot be undone. Type DELETE to confirm:');
 if(phrase!=='DELETE')return;
 try{await api('delete_report',{reportId:id,confirm:'DELETE'});toast('Report deleted; audit retained');await reload()}
 catch(e){toast(e.message,true)}
};
window.appendPendingDailyTodo=async()=>{
 const task=window.pendingSalesDailyTodo;if(!task?.sourceTaskId)return toast('No To-Do task selected',true);
 if(ui.loading)return;ui.loading=true;
 try{
  const r=await api('append_todo_am',{date:ui.date,todoTaskId:task.sourceTaskId});
  sessionStorage.removeItem('salesDailyTodoDraft');window.pendingSalesDailyTodo=null;closeModal();
  toast(r.alreadyAdded?'This To-Do is already included in the Morning Plan':'To-Do added. Management can see the amended report.');
  await reload();
 }catch(e){toast(e.message,true)}finally{ui.loading=false}
};
window.requestPendingTodoMorningEdit=()=>{
 closeModal();
 if(typeof window.requestSalesDailyEdit==='function')window.requestSalesDailyEdit('AM');
};
window.choosePendingTodoDate=()=>{
 closeModal();
 const next=prompt('Choose another report date (YYYY-MM-DD):',today());
 if(!next)return;
 if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(next))return toast('Enter a date as YYYY-MM-DD',true);
 ui.date=next;ui.report=null;ui.tasks=[];reload();
};
window.requestSalesDailyEdit=async section=>{
 const report=ui.report;if(!report)return;
 const reason=prompt('Reason to edit submitted '+(section==='AM'?'Morning Plan':'Evening Result')+':');
 if(reason===null)return;if(!reason.trim())return toast('Enter a reason for the edit request',true);
 try{await api('request_edit',{reportId:report.id,section,reason:reason.trim()});toast('Edit request sent for management approval');await reload()}
 catch(e){toast(e.message,true)}
};
window.decideSalesDailyEdit=async(requestId,decision)=>{
 const note=prompt('Optional management note:');if(note===null)return;
 try{await api('decide_edit',{requestId,decision,note});closeModal();toast('Edit request '+decision.toLowerCase());window.invalidateSalesDailyApprovals?.();await reload()}
 catch(e){toast(e.message,true)}
};
const previousGo=window.go;
window.go=async function(page){
 if(page!==P&&page!==R)return previousGo.apply(this,arguments);
 if(!allowed(page))return toast('Daily Report access required',true);
 state.page=page;renderNav();
 elem('pageTitle').textContent=page===P?'Daily Plan & Result':'Team Daily Review';
 elem('pageSubtitle').textContent=page===P?'Morning plan, evening results & carry-forward':'Review Sales staff plans and results';
 ui.access=null;ui.config=null;ui.tasks=[];
 await reload();
};
})();
