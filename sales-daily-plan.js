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
const backDays=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()-n);return x.toISOString().slice(0,10)};
const can=(key,roles)=>typeof window.hasAppPermission==='function'?!!window.hasAppPermission(key):roles.includes(state?.profile?.role||'');
const sales=()=>state?.profile?.role==='sales'&&can('sales_daily.plan_own',['sales']);
const review=()=>['manager','admin','super_admin'].includes(state?.profile?.role||'')&&
  (can('sales_daily.review_team',['manager','admin','super_admin'])||can('sales_daily.review_all',['admin','super_admin']));
const elem=id=>document.getElementById(id);
const allowed=(page)=>page===P?sales():page===R?review():false;
const ui={access:null,config:null,date:today(),start:today(),end:today(),person:'',report:null,reports:[],people:[],customers:[],tasks:[],suggestions:[],stats:null,loading:false,seq:0};
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
 ui.people=[];ui.customers=[];ui.tasks=[];ui.stats=null;ui.person='';
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
  '<a href="'+WORKBOOK+'" target="_blank" rel="noopener noreferrer" class="'+lightButton+' text-center">Google Sheets master ↗</a></div>';
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
function formTask(t,i,readonly=false){
 const cs='<option value="">No linked customer</option>'+ui.customers.map(c=>
 '<option value="'+h(c.id)+'" '+(String(t.customerId||'')===String(c.id)?'selected':'')+'>'+h(c.name)+'</option>').join('');
 return '<div class="daily-task-row border rounded-2xl bg-white p-4" data-index="'+i+'">'+
 '<div class="flex justify-between items-center gap-2 mb-3"><b class="text-sm">Task '+(i+1)+'</b>'+
 (!readonly?'<button type="button" onclick="removeSalesDailyTask('+i+')" class="border border-red-100 text-red-600 px-2.5 py-1.5 rounded-lg text-[11px]">Remove</button>':'')+'</div>'+
 '<div class="grid sm:grid-cols-3 gap-3">'+
 '<label class="text-xs font-semibold">Category<select data-field="category" class="'+common+'" '+(readonly?'disabled':'')+'>'+
 CATS.map(c=>'<option value="'+h(c)+'" '+(t.category===c?'selected':'')+'>'+h(c)+'</option>').join('')+'</select></label>'+
 '<label class="text-xs font-semibold">Priority<select data-field="priority" class="'+common+'" '+(readonly?'disabled':'')+'>'+
 ['High','Medium','Low'].map(v=>'<option '+(v===t.priority?'selected':'')+'>'+v+'</option>').join('')+'</select></label>'+
 '<label class="text-xs font-semibold">Planned Follow-up<input type="date" data-field="plannedFollowup" class="'+common+'" value="'+h(t.plannedFollowup||'')+'" '+(readonly?'disabled':'')+'></label>'+
 '</div>'+
 '<label class="text-xs font-semibold block mt-3">Morning Plan <span class="text-red-500">*</span>'+
 '<textarea data-field="plan" maxlength="1000" rows="2" required class="'+common+'" '+(readonly?'disabled':'')+' placeholder="What will you do?">'+h(t.plan||'')+'</textarea></label>'+
 '<div class="grid sm:grid-cols-2 gap-3 mt-3"><label class="text-xs font-semibold">Link Customer Master<select data-field="customerId" class="'+common+'" '+(readonly?'disabled':'')+'>'+cs+'</select></label>'+
 '<label class="text-xs font-semibold">Customer name (optional)<input data-field="customerName" maxlength="140" class="'+common+'" '+(readonly?'disabled':'')+' value="'+h(t.customerName||'')+'" placeholder="Customer if not registered"></label></div></div>';
}
function captureAm(){
 if(!root())return;
 ui.tasks=[...root().querySelectorAll('.daily-task-row')].map((row,i)=>{
   const get=k=>row.querySelector('[data-field="'+k+'"]')?.value||'';
   const prev=ui.tasks[i]||{};
   const matched=ui.customers.find(c=>String(c.id)===get('customerId'));
   return{id:prev.id||'',sourceTaskId:prev.sourceTaskId||'',category:get('category'),plan:get('plan'),
    customerId:get('customerId'),customerName:get('customerName')||(matched?.name||''),
    priority:get('priority'),plannedFollowup:get('plannedFollowup')};
 });
}
window.addSalesDailyTask=()=>{captureAm();if(ui.tasks.length>=20)return toast('Maximum 20 tasks per day',true);ui.tasks.push(empty());renderSalesHome()};
window.removeSalesDailyTask=i=>{captureAm();if(ui.tasks.length<=1)return toast('Keep at least one planned task',true);ui.tasks.splice(i,1);renderSalesHome()};
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
  ui.report=r;ui.tasks=r.tasks||[];toast(submit?'Morning plan submitted':'Morning draft saved');
  await reload();
 }catch(e){toast(e.message,true)}finally{ui.loading=false}
}
window.saveSalesDailyMorning=saveAm;
window.carrySalesDailyTasks=async()=>{
 if(ui.loading)return;
 ui.loading=true;
 const from=elem('dailyCarryFrom')?.value||backDays(ui.date,1);
 try{captureAm();const r=await api('carry_forward',{from,to:ui.date});
  const imported=new Set(ui.tasks.map(t=>t.sourceTaskId).filter(Boolean));
  const x=(r.suggestions||[]).filter(t=>!imported.has(t.sourceTaskId));if(!x.length)return toast('No new unfinished tasks found for that day');
  if(ui.tasks.filter(t=>t.plan.trim()).length+x.length>20)return toast('Too many tasks; remove some first',true);
  ui.tasks=ui.tasks.filter(t=>t.plan.trim());
  ui.tasks.push(...x.map(t=>({...empty(),...t,id:''})));renderSalesHome();
  toast(x.length+' unfinished tasks brought forward as editable plans');
 }catch(e){toast(e.message,true)}finally{ui.loading=false}
};
function pmTask(t,i,locked){
 return '<div class="daily-result-row rounded-2xl bg-white border p-4" data-id="'+h(t.id)+'">'+
  '<div class="text-[10px] uppercase font-bold text-[#a18239]">'+h(t.category)+'</div>'+
  '<div class="font-semibold text-sm mt-1">'+h(t.plan)+'</div>'+
  (t.customerName?'<div class="text-xs text-gray-500 mt-1">Customer: '+h(t.customerName)+'</div>':'')+
  '<div class="grid sm:grid-cols-2 gap-3 mt-3"><label class="text-xs font-semibold">Evening status<select data-field="status" class="'+common+'" '+(locked?'disabled':'')+'>'+
  '<option value="">Choose result</option>'+
  STATUSES.map(s=>'<option '+(t.status===s?'selected':'')+'>'+h(s)+'</option>').join('')+
  '</select></label><label class="text-xs font-semibold">Next Follow-up Date<input data-field="nextFollowup" type="date" class="'+common+'" value="'+h(t.nextFollowup||'')+'" '+(locked?'disabled':'')+'></label></div>'+
  '<label class="text-xs font-semibold block mt-3">Evening Result / Actual Outcome<textarea data-field="result" rows="2" maxlength="1500" class="'+common+'" '+(locked?'disabled':'')+' placeholder="Customer interested, awaiting reply, no chats today, video completed…">'+h(t.result||'')+'</textarea></label></div>';
}
function capturePm(){
 return [...(root()?.querySelectorAll('.daily-result-row')||[])].map(row=>{
  const get=k=>row.querySelector('[data-field="'+k+'"]')?.value||'';
  return{id:row.dataset.id,status:get('status'),result:get('result'),nextFollowup:get('nextFollowup')};
 });
}
window.saveSalesDailyEvening=async submit=>{
 if(ui.loading)return;
 const results=capturePm();if(submit&&results.some(x=>!x.status))return toast('Update the status of every planned task before submitting',true);
 ui.loading=true;
 try{await api(submit?'submit_pm':'save_pm',{date:ui.date,results});toast(submit?'Evening results submitted':'Evening draft saved');await reload()}
 catch(e){toast(e.message,true)}finally{ui.loading=false}
};
function renderSalesHome(){
 if(state.page!==P)return;
 const report=ui.report,amLocked=report?.amStatus==='Submitted',pmLocked=report?.pmStatus==='Submitted'||report?.reviewStatus==='Reviewed';
 const tasks=amLocked?report.tasks:ui.tasks.length?ui.tasks:[empty()];
 ui.tasks=tasks;
 root().innerHTML='<div class="max-w-6xl mx-auto space-y-4">'+header('Daily Plan & Result','One report per day · Morning plan and evening results stay together')+
 '<div class="rounded-2xl border bg-white p-4 flex flex-wrap gap-3 items-end justify-between">'+
 '<label class="text-xs font-bold">Report Date<input id="salesDailyDate" type="date" class="'+common+'" value="'+h(ui.date)+'" onchange="selectSalesDailyDate()"></label>'+
 '<div class="flex flex-wrap gap-2"><span class="rounded-lg bg-amber-50 px-3 py-2 text-xs">AM: <b>'+h(report?.amStatus||'Not Started')+'</b></span>'+
 '<span class="rounded-lg bg-blue-50 px-3 py-2 text-xs">PM: <b>'+h(report?.pmStatus||'Not Started')+'</b></span>'+
 '<span class="rounded-lg bg-gray-100 px-3 py-2 text-xs">Manager: <b>'+h(report?.reviewStatus||'Pending')+'</b></span></div></div>'+
 (report?.managerComment?'<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs"><b>Manager note:</b> '+h(report.managerComment)+'</div>':'')+
 '<section class="space-y-3"><div class="flex flex-wrap justify-between items-center gap-2">'+
 '<h3 class="font-bold">Morning Plan</h3>'+(amLocked?'':'<button type="button" onclick="addSalesDailyTask()" class="'+lightButton+'">+ Add Task</button>')+'</div>'+
 '<div id="dailyPlanRows" class="grid gap-3">'+tasks.map((t,i)=>formTask(t,i,amLocked)).join('')+'</div>'+
 (!amLocked?'<div class="rounded-xl bg-[#fdfbf6] border p-3 flex flex-wrap gap-2 items-end">'+
 '<label class="text-xs font-semibold">Carry forward unfinished tasks from<input id="dailyCarryFrom" type="date" value="'+h(backDays(ui.date,1))+'" class="'+common+' mt-1"></label>'+
 '<button type="button" onclick="carrySalesDailyTasks()" class="'+lightButton+'">Import Pending Tasks</button></div>'+
 '<div class="flex flex-wrap gap-2"><button onclick="saveSalesDailyMorning(false)" class="'+lightButton+'">Save AM Draft</button>'+
 '<button onclick="saveSalesDailyMorning(true)" class="'+actionButton+'">Submit Morning Plan</button></div>':
 '<p class="text-xs text-green-700">Morning plan submitted at '+h(report?.amSubmittedAt||'')+'. Changes are recorded in the audit log.</p>')+'</section>'+
 (amLocked?'<section class="space-y-3 border-t pt-5"><h3 class="font-bold">Evening Result</h3>'+
 '<p class="text-xs text-gray-500">Update what actually happened, and choose the next follow-up date when necessary.</p>'+
 '<div class="grid gap-3">'+(report.tasks||[]).map((t,i)=>pmTask(t,i,pmLocked)).join('')+'</div>'+
 (!pmLocked?'<div class="flex flex-wrap gap-2"><button onclick="saveSalesDailyEvening(false)" class="'+lightButton+'">Save PM Draft</button>'+
 '<button onclick="saveSalesDailyEvening(true)" class="'+actionButton+'">Submit Evening Result</button></div>':
 '<p class="text-xs text-green-700">Evening results submitted. Manager can review and request corrections.</p>')+'</section>':'')+
 '<div data-daily-weekly>'+weeklyPanel()+'</div>'+'<section class="rounded-2xl border bg-white p-4"><div class="flex justify-between gap-2 items-center"><div><b class="text-sm">Recorded activity in the app</b><p class="text-xs text-gray-500 mt-1">CRM follow-ups, Showroom/Online events and order activity. These do not automatically count as completed tasks.</p></div>'+
 '<button onclick="showDailyActivitySuggestions()" class="'+lightButton+'">View Today’s Activity</button></div><div id="dailyActivitySuggestions" class="mt-3"></div></section></div>';
}
async function renderManager(){
 const reports=ui.reports,people=ui.people;
 const count=(k,v)=>reports.filter(x=>x[k]===v).length;
 const to=ui.end,from=ui.start;
 root().innerHTML='<div class="max-w-7xl mx-auto space-y-4">'+header('Team Daily Review','Compare morning plans and evening results for Sales-role staff only')+
 '<div class="rounded-2xl border bg-white p-4 flex flex-wrap items-end gap-3">'+
 '<label class="text-xs font-semibold">From<input id="dailyReviewFrom" class="'+common+'" type="date" value="'+h(from)+'"></label>'+
 '<label class="text-xs font-semibold">To<input id="dailyReviewTo" class="'+common+'" type="date" value="'+h(to)+'"></label>'+
 '<label class="text-xs font-semibold">Salesperson<select id="dailyReviewPerson" class="'+common+'"><option value="">All Sales Staff</option>'+
 people.map(x=>'<option value="'+h(x.user_id)+'" '+(ui.person===x.user_id?'selected':'')+'>'+h(x.name)+'</option>').join('')+'</select></label>'+
 '<button onclick="reloadSalesDailyReview()" class="'+actionButton+'">Apply</button></div>'+
 '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">'+[
  ['Reports',reports.length],['Morning Plans Submitted',count('amStatus','Submitted')],
  ['Evening Results Submitted',count('pmStatus','Submitted')],
  ['Manager Reviewed',count('reviewStatus','Reviewed')]
 ].map(([n,v])=>'<div class="bg-white border rounded-2xl p-4"><div class="text-[10px] font-bold uppercase text-gray-500">'+n+'</div><div class="font-black text-2xl mt-2">'+v+'</div></div>').join('')+'</div>'+
 '<div data-daily-weekly>'+weeklyPanel()+'</div>'+'<section class="bg-white border rounded-2xl overflow-hidden">'+
 '<div class="p-4 border-b font-bold text-sm">Daily Reports · '+reports.length+'</div>'+
 (reports.length?'<div class="divide-y">'+reports.map(r=>'<div class="p-4 flex flex-wrap items-center gap-3">'+
 '<div class="flex-1 min-w-[210px]"><b class="text-sm">'+h(r.salesperson)+'</b><p class="text-xs text-gray-500 mt-1">'+h(r.date)+' · '+r.tasks.length+' tasks</p>'+
 '<p class="text-[11px] mt-1">AM: '+h(r.amStatus||'Draft')+' · PM: '+h(r.pmStatus||'Not Started')+
 ' · Review: '+h(r.reviewStatus||'Pending')+'</p></div>'+
 '<button onclick="openDailyManagerReport(\''+h(r.id)+'\')" class="'+lightButton+'">View Plan & Result</button></div>').join('')+'</div>':
 '<div class="p-10 text-sm text-gray-500 text-center">No Sales reports found for the selected date range.</div>')+'</section></div>';
}
window.reloadSalesDailyReview=async()=>{
 ui.start=elem('dailyReviewFrom')?.value||ui.start;
 ui.end=elem('dailyReviewTo')?.value||ui.end;
 ui.person=elem('dailyReviewPerson')?.value||'';
 await reload();
};
window.openDailyManagerReport=id=>{
 const r=ui.reports.find(x=>x.id===id);if(!r)return;
 const rows=r.tasks.map((t,i)=>'<div class="rounded-xl border p-3 bg-white"><b class="text-xs">'+(i+1)+'. '+h(t.plan)+'</b>'+
 '<div class="text-[11px] text-gray-500 mt-1">'+h(t.category)+(t.customerName?' · '+h(t.customerName):'')+'</div>'+
 '<div class="grid sm:grid-cols-2 gap-2 mt-2 text-xs"><div><b>Planned:</b> '+h(t.plannedFollowup||'No date')+'</div>'+
 '<div><b>Evening status:</b> '+h(t.status||'Not updated')+'</div></div>'+
 '<div class="text-xs mt-2"><b>Actual result:</b> '+h(t.result||'Not submitted')+'</div>'+
 (t.nextFollowup?'<div class="text-xs text-blue-700 mt-2">Next follow-up: '+h(t.nextFollowup)+'</div>':'')+'</div>').join('');
 openModal('Daily Plan & Result — '+h(r.salesperson)+' · '+h(r.date),
 '<div class="space-y-4"><div class="rounded-xl bg-gray-50 p-3 text-xs">AM: '+h(r.amStatus)+' · PM: '+h(r.pmStatus)+
 ' · Review: '+h(r.reviewStatus||'Pending')+'</div>'+rows+
 (r.managerComment?'<p class="text-xs text-gray-600">Previous Manager comment: '+h(r.managerComment)+'</p>':'')+
 (r.pmStatus==='Submitted'&&r.reviewStatus!=='Reviewed'?
 '<label class="block text-xs font-bold">Manager comments<textarea id="dailyManagerComment" rows="3" maxlength="1500" class="'+common+' mt-1">'+h(r.managerComment||'')+'</textarea></label>'+
 '<div class="flex flex-wrap gap-2">'+
 '<button onclick="submitDailyManagerReview(\''+h(r.id)+'\',\'Changes Requested\')" class="'+lightButton+'">Request Corrections</button>'+
 '<button onclick="submitDailyManagerReview(\''+h(r.id)+'\',\'Reviewed\')" class="'+actionButton+'">Mark Reviewed</button></div>':'')+
 '<button onclick="closeModal()" class="'+lightButton+'">Close</button></div>');
};
window.submitDailyManagerReview=async(id,decision)=>{
 const comment=elem('dailyManagerComment')?.value||'';
 try{await api('review',{reportId:id,decision,comment});closeModal();toast('Review recorded in Google Sheets');await reload()}
 catch(e){toast(e.message,true)}
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
   ui.report=(res.reports||[]).find(x=>x.userId===state.user?.id)||null;
   ui.tasks=ui.report?.tasks?.length?ui.report.tasks:[empty()];
   reportLoaded=true;renderSalesHome();
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
   ui.reports=res.reports||[];ui.people=res.salesPeople||[];reportLoaded=true;renderManager();
  }
 }catch(err){
  if(seq!==ui.seq||state.page!==page||state.user?.id!==userId)return;
  root().innerHTML=header(page===P?'Daily Plan & Result':'Team Daily Review','Google Sheets')+
   '<div class="mt-3 rounded-xl border border-red-200 bg-red-50 p-5 text-sm text-red-800">'+h(err.message||'Google Sheets unavailable')+
   '<div class="mt-3"><button onclick="reloadDailyReport()" class="'+lightButton+'">Retry</button></div></div>';
 }
}
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
