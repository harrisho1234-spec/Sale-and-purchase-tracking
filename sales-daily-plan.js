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
const pmDeadline=(date)=>{const d=new Date(date+'T00:00:00Z');do{d.setUTCDate(d.getUTCDate()+1)}while(d.getUTCDay()===0);return d.toISOString().slice(0,10)+'T09:00:00+07:00';};
const isOverdue=r=>r?.amStatus==='Submitted'&&r?.pmStatus!=='Submitted'&&Date.now()>Date.parse(r.pmDeadline||pmDeadline(r.date));
const isLate=r=>r?.pmStatus==='Submitted'&&!!r.pmSubmittedAt&&Date.parse(r.pmSubmittedAt)>Date.parse(r.pmDeadline||pmDeadline(r.date));
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
const additionalCats=['Customer Visit','Customer Follow-up','Online Inquiry','Quotation','Sales Order','Showroom Work','Other'];
function captureAdditional(){
 const rows=root()?.querySelectorAll('.additional-daily-row')||[];
 if(rows.length)additionalDraft=[...rows].map((row,i)=>({id:additionalDraft[i]?.id||'',category:row.querySelector('[data-extra="category"]')?.value||'Other',customerName:row.querySelector('[data-extra="customerName"]')?.value||'',result:row.querySelector('[data-extra="result"]')?.value||'',nextFollowup:row.querySelector('[data-extra="nextFollowup"]')?.value||''}));
 return additionalDraft;
}
function additionalEditor(locked){
 if(additionalDraftDate!==ui.date){additionalDraftDate=ui.date;additionalDraft=[];}
 const data=additionalDraft.length?additionalDraft:(ui.report?.additionalActivities||[]);
 return '<div class="space-y-3 border-t pt-4"><h4 class="font-bold">Additional Activities (Unplanned)</h4><p class="text-xs text-gray-500">Record unexpected showroom visits, inquiries, quotations, or other work. These do not count toward Morning Plan completion.</p>'+
 data.map((x,i)=>'<div class="additional-daily-row border rounded-xl p-3 bg-white"><div class="flex justify-between gap-2 items-center mb-2"><b class="text-xs">Additional activity '+(i+1)+'</b>'+(!locked?'<button class="text-xs text-red-600" onclick="removeAdditionalDaily('+i+')">Remove</button>':'')+'</div><div class="grid sm:grid-cols-2 gap-2"><label class="text-xs">Activity type<select data-extra="category" class="'+common+'" '+(locked?'disabled':'')+'>'+additionalCats.map(v=>'<option '+(x.category===v?'selected':'')+'>'+h(v)+'</option>').join('')+'</select></label><label class="text-xs">Customer name (optional)<input data-extra="customerName" class="'+common+'" value="'+h(x.customerName||'')+'" '+(locked?'disabled':'')+'></label></div><label class="text-xs block mt-2">Actual outcome<textarea data-extra="result" class="'+common+'" rows="2" '+(locked?'disabled':'')+'>'+h(x.result||'')+'</textarea></label><label class="text-xs block mt-2">Next follow-up date<input data-extra="nextFollowup" type="date" class="'+common+'" value="'+h(x.nextFollowup||'')+'" '+(locked?'disabled':'')+'></label></div>').join('')+
 (!locked?'<button class="'+lightButton+'" onclick="addAdditionalDaily()">+ Add Additional Activity</button>':'')+'</div>';
}
function preserveEveningInputs(){const values=capturePm();if(ui.report?.tasks)values.forEach(v=>{const t=ui.report.tasks.find(x=>x.id===v.id);if(t)Object.assign(t,v)})}
window.addAdditionalDaily=()=>{preserveEveningInputs();captureAdditional();if(additionalDraft.length>=30)return toast('Maximum 30 additional activities',true);additionalDraft.push({category:'Customer Visit',customerName:'',result:'',nextFollowup:''});renderSalesHome()};
window.removeAdditionalDaily=i=>{preserveEveningInputs();captureAdditional();additionalDraft.splice(i,1);renderSalesHome()};
window.saveSalesDailyEvening=async submit=>{
 if(ui.loading)return;
 const results=capturePm();const additionalActivities=captureAdditional();if(submit&&results.some(x=>!x.status))return toast('Update the status of every planned task before submitting',true);
 if(submit&&results.some(x=>!x.result.trim()))return toast('Write an actual outcome for every morning task before submitting',true);
 ui.loading=true;
 try{await api(submit?'submit_pm':'save_pm',{date:ui.date,results,additionalActivities});toast(submit?'Evening results submitted':'Evening draft saved');await reload()}
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
window.openSalesDailyShare=section=>{
 const r=ui.report;if(!r||!(section==='AM'?r.amStatus==='Submitted':r.pmStatus==='Submitted'))return toast('Submit before sharing',true);
 window.closeSalesDailyShare();const pm=section==='PM';
 const customerCats=['Customer Follow-up','Online Inquiries','Quotation / SR'];
 const isCustomer=t=>!t.todoTaskId&&(!!t.customerId||!!t.customerName||customerCats.includes(t.category));
 const customer=(r.tasks||[]).filter(isCustomer),other=(r.tasks||[]).filter(t=>!isCustomer(t));
 const planCell=t=>'<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #eee;break-inside:avoid"><b>• '+h(t.plan)+'</b>'+
 (t.customerName?'<div style="font-size:11px;color:#666;padding-left:10px">Customer: '+h(t.customerName)+'</div>':'')+
 (t.todoTaskId?'<div style="font-size:10px;color:#926315;padding-left:10px">To-Do task</div>':'')+'</div>';
 const resultCell=t=>'<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #eee;break-inside:avoid"><b>'+h(t.status||'Not updated')+'</b> — '+h(t.result||'No outcome recorded')+
 (t.nextFollowup?'<div style="font-size:11px;color:#666">Next: '+h(t.nextFollowup)+'</div>':'')+'</div>';
 const tableSection=(label,list)=>'<tr style="vertical-align:top"><th style="width:'+(pm?'21':'28')+'%;padding:10px 8px;border:1px solid #bbb;text-align:left;font-size:12px;background:#f8f8f6">'+label+'</th>'+
 '<td style="width:'+(pm?'39.5':'72')+'%;padding:4px 9px;border:1px solid #bbb">'+(list.length?list.map(planCell).join(''):'<span style="font-size:11px;color:#888">No tasks</span>')+'</td>'+
 (pm?'<td style="width:39.5%;padding:4px 9px;border:1px solid #bbb">'+(list.length?list.map(resultCell).join(''):'—')+'</td>':'')+'</tr>';
 const extras=pm?(r.additionalActivities||[]):[];
 const extraBlock=extras.length?'<div style="margin-top:12px;border:1px solid #bbb;padding:10px"><b style="font-size:13px">Additional Activities (Unplanned)</b>'+extras.map(x=>'<div style="font-size:12px;padding:5px 0;border-bottom:1px solid #eee">• '+h(x.category)+(x.customerName?' — '+h(x.customerName):'')+'<div style="padding-left:12px">'+h(x.result||'')+'</div></div>').join('')+'</div>':'';
 const rows='<table style="border-collapse:collapse;width:100%;table-layout:fixed;margin-top:12px">'+
 (pm?'<tr style="background:#e3eedf"><th style="border:1px solid #bbb;padding:9px;font-size:12px;text-align:left">Category</th><th style="border:1px solid #bbb;padding:9px;font-size:12px;text-align:left">Morning Plan</th><th style="border:1px solid #bbb;padding:9px;font-size:12px;text-align:left">Evening Result</th></tr>':'')+
 tableSection('Customer Tasks',customer)+tableSection('Other Tasks / To-Do',other)+'</table>';
 const panel=document.createElement('div');panel.id='salesDailyShareOverlay';panel.style.cssText='position:fixed;inset:0;z-index:99999;background:#0009;overflow:auto;padding:16px';
 panel.innerHTML='<div style="max-width:760px;margin:auto"><div data-share-tools style="display:flex;justify-content:flex-end;gap:8px;margin-bottom:10px"><button onclick="window.print()" style="background:white;padding:9px 14px;border-radius:8px">Print / PDF</button><button onclick="closeSalesDailyShare()" style="background:white;padding:9px 14px;border-radius:8px">Close</button></div>'+
 '<div id="salesDailyShareCard" style="background:white;color:#242424;padding:22px;border-radius:12px;box-shadow:0 8px 32px #0002;font-family:Arial,sans-serif">'+
 '<div style="border:1px solid #b4cbb1;background:#e3eedf;padding:12px"><div style="font-weight:700;font-size:15px">'+(pm?'Evening Result':'Morning Plan')+'</div><div style="font-size:13px;margin-top:4px"><b>Date:</b> '+h(r.date)+' &nbsp; <b>Name:</b> '+h(r.salesperson||state.profile?.full_name||state.profile?.name||'Sales')+'</div></div>'+
 rows+extraBlock+'<div style="margin-top:12px;font-size:11px;color:#777">Submitted: '+h(pm?r.pmSubmittedAt:r.amSubmittedAt)+' · '+h(r.reviewStatus||'Pending review')+'</div></div></div>';
 document.body.appendChild(panel);panel.addEventListener('click',e=>{if(e.target===panel)window.closeSalesDailyShare()});
 if(!document.getElementById('salesDailySharePrintStyle')){const st=document.createElement('style');st.id='salesDailySharePrintStyle';st.textContent='@media print{body>*:not(#salesDailyShareOverlay){display:none!important}#salesDailyShareOverlay{position:static!important;background:white!important;overflow:visible!important;padding:0!important}#salesDailyShareOverlay [data-share-tools]{display:none!important}#salesDailyShareCard{box-shadow:none!important}}';document.head.appendChild(st)}
};
function renderSalesHome(){
 if(state.page!==P)return;
 const report=ui.report,amLocked=report?.amStatus==='Submitted'&&!report?.editRequests?.some(x=>x.section==='AM'&&x.status==='Approved'),pmLocked=report?.pmStatus==='Submitted'||report?.reviewStatus==='Reviewed';
 const tasks=amLocked?report.tasks:ui.tasks.length?ui.tasks:[empty()];
 ui.tasks=tasks;
 root().innerHTML='<div class="max-w-6xl mx-auto space-y-4">'+header('Daily Plan & Result','One report per day · Morning plan and evening results stay together')+
 '<div class="flex flex-wrap gap-2">'+(report?.amStatus==='Submitted'?'<button onclick="openSalesDailyShare(\'AM\')" class="'+lightButton+'">Compact Morning Share View</button>':'')+(report?.pmStatus==='Submitted'?'<button onclick="openSalesDailyShare(\'PM\')" class="'+lightButton+'">Compact Evening Share View</button>':'')+'</div>'+
 '<div class="rounded-2xl border bg-white p-4 flex flex-wrap gap-3 items-end justify-between">'+
 '<label class="text-xs font-bold">Report Date<input id="salesDailyDate" type="date" class="'+common+'" value="'+h(ui.date)+'" onchange="selectSalesDailyDate()"></label>'+
 '<div class="flex flex-wrap gap-2"><span class="rounded-lg bg-amber-50 px-3 py-2 text-xs">AM: <b>'+h(report?.amStatus||'Not Started')+'</b></span>'+
 '<span class="rounded-lg bg-blue-50 px-3 py-2 text-xs">PM: <b>'+h(report?.pmStatus||'Not Started')+'</b></span>'+
 '<span class="rounded-lg bg-gray-100 px-3 py-2 text-xs">Manager: <b>'+h(report?.reviewStatus||'Pending')+'</b></span></div></div>'+
 (report?.managerComment?'<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs"><b>Manager note:</b> '+h(report.managerComment)+'</div>':'')+
 (isOverdue(report)?'<div class="rounded-xl border border-red-200 bg-red-50 text-red-800 p-3 text-sm"><b>Overdue Evening Result:</b> This report was due by 9:00 AM the next working morning. Please submit an actual outcome for every task. Late submissions are recorded.</div>':'')+
 '<div id="salesDailyPriorReminder"></div>'+
 '<section class="space-y-3"><div class="flex flex-wrap justify-between items-center gap-2">'+
 '<h3 class="font-bold">Morning Plan</h3>'+(amLocked?'':'<button type="button" onclick="addSalesDailyTask()" class="'+lightButton+'">+ Add Task</button>')+'</div>'+
 '<div id="dailyPlanRows" class="grid gap-3">'+tasks.map((t,i)=>formTask(t,i,amLocked)).join('')+'</div>'+
 (!amLocked?'<div class="rounded-xl bg-[#fdfbf6] border p-3 flex flex-wrap gap-2 items-end">'+
 '<label class="text-xs font-semibold">Carry forward unfinished plans from<input id="dailyCarryFrom" type="date" value="'+h(backDays(ui.date,1))+'" class="'+common+' mt-1"></label>'+
 '<button type="button" onclick="carrySalesDailyTasks()" class="'+lightButton+'">Preview Unfinished Plans</button></div>'+
 '<div class="flex flex-wrap gap-2"><button onclick="saveSalesDailyMorning(false)" class="'+lightButton+'">Save AM Draft</button>'+
 '<button onclick="saveSalesDailyMorning(true)" class="'+actionButton+'">Submit Morning Plan</button></div>':
 '<div class="flex items-center flex-wrap gap-2"><p class="text-xs text-green-700">Morning plan submitted at '+h(report?.amSubmittedAt||'')+'. Changes are recorded in the audit log.</p><button onclick="requestSalesDailyEdit(\'AM\')" class="'+lightButton+'">Request Morning Edit</button></div>')+'</section>'+
 (amLocked?'<section class="space-y-3 border-t pt-5"><h3 class="font-bold">Evening Result</h3>'+
 '<p class="text-xs text-gray-500">Update what actually happened, and choose the next follow-up date when necessary.</p>'+
 '<div class="grid gap-3">'+(report.tasks||[]).map((t,i)=>pmTask(t,i,pmLocked)).join('')+'</div>'+ additionalEditor(pmLocked)+
 (!pmLocked?'<div class="flex flex-wrap gap-2"><button onclick="saveSalesDailyEvening(false)" class="'+lightButton+'">Save PM Draft</button>'+
 '<button onclick="saveSalesDailyEvening(true)" class="'+actionButton+'">Submit Evening Result</button></div>':
 '<div class="flex items-center flex-wrap gap-2"><p class="text-xs text-green-700">Evening results submitted. Manager can review and request corrections.</p><button onclick="requestSalesDailyEdit(\'PM\')" class="'+lightButton+'">Request Evening Edit</button></div>')+'</section>':'')+
 (report?.editRequests?.length?'<div class="rounded-xl border bg-white p-3"><b class="text-sm">Edit Requests</b>'+report.editRequests.map(x=>'<p class="text-xs mt-2">'+h(x.section)+' · '+h(x.status)+' · '+h(x.reason)+(x.decisionNote?' · '+h(x.decisionNote):'')+'</p>').join('')+'</div>':'')+
 '<div data-daily-weekly>'+weeklyPanel()+'</div>'+'<section class="rounded-2xl border bg-white p-4"><div class="flex justify-between gap-2 items-center"><div><b class="text-sm">Recorded activity in the app</b><p class="text-xs text-gray-500 mt-1">CRM follow-ups, Showroom/Online events and order activity. These do not automatically count as completed tasks.</p></div>'+
 '<button onclick="showDailyActivitySuggestions()" class="'+lightButton+'">View Today’s Activity</button></div><div id="dailyActivitySuggestions" class="mt-3"></div></section></div>';
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
 '<div class="rounded-2xl border bg-white p-4 flex flex-wrap items-end gap-3">'+
 '<label class="text-xs font-semibold">From<input id="dailyReviewFrom" class="'+common+'" type="date" value="'+h(from)+'"></label>'+
 '<label class="text-xs font-semibold">To<input id="dailyReviewTo" class="'+common+'" type="date" value="'+h(to)+'"></label>'+
 '<label class="text-xs font-semibold">Salesperson<select id="dailyReviewPerson" class="'+common+'"><option value="">All Sales Staff</option>'+
 people.map(x=>'<option value="'+h(x.user_id)+'" '+(ui.person===x.user_id?'selected':'')+'>'+h(x.name)+'</option>').join('')+'</select></label>'+
 '<button onclick="reloadSalesDailyReview()" class="'+actionButton+'">Apply</button></div>'+
 '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">'+[
  ['Reports',reports.length],['Morning Plans Submitted',count('amStatus','Submitted')],
  ['Evening Results Submitted',count('pmStatus','Submitted')],
  ['PM Overdue',reports.filter(isOverdue).length],['PM Submitted Late',reports.filter(isLate).length],['Awaiting Review',reports.filter(r=>r.pmStatus==='Submitted'&&r.reviewStatus!=='Reviewed').length],['Manager Reviewed',count('reviewStatus','Reviewed')]
 ].map(([n,v])=>'<div class="bg-white border rounded-2xl p-4"><div class="text-[10px] font-bold uppercase text-gray-500">'+n+'</div><div class="font-black text-2xl mt-2">'+v+'</div></div>').join('')+'</div>'+
 '<div data-daily-weekly>'+weeklyPanel()+'</div>'+compliancePanel+'<section class="bg-white border rounded-2xl overflow-hidden">'+
 '<div class="p-4 border-b font-bold text-sm">Daily Reports · '+reports.length+'</div>'+
 (reports.length?'<div class="divide-y">'+reports.map(r=>'<div class="p-4 flex flex-wrap items-center gap-3">'+
 '<div class="flex-1 min-w-[210px]"><b class="text-sm">'+h(r.salesperson)+'</b><p class="text-xs text-gray-500 mt-1">'+h(r.date)+' · '+r.tasks.length+' tasks</p>'+
 '<p class="text-[11px] mt-1">AM: '+h(r.amStatus||'Draft')+' · PM: '+h(r.pmStatus||'Not Started')+
 ' · Review: '+h(r.reviewStatus||'Pending')+(r.amTodoAmended?' · AM REVISED (TO-DO)':'')+(isOverdue(r)?' · PM OVERDUE':isLate(r)?' · PM LATE':'')+'</p></div>'+
 '<button onclick="openDailyManagerReport(\''+h(r.id)+'\')" class="'+lightButton+'">View Plan & Result</button>'+(state.profile?.role==='super_admin'?'<button onclick="deleteSalesDailyReport(\''+h(r.id)+'\')" class="px-3 py-2 rounded-xl border border-red-200 text-red-700 text-xs font-bold">Delete</button>':'')+'</div>').join('')+'</div>':
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
 const editRequests=(r.editRequests||[]).filter(x=>x.status==='Pending');
 const requestActions=editRequests.map(x=>'<div class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs"><b>'+h(x.section==='AM'?'Morning Plan':'Evening Result')+' edit request</b><p class="my-2">'+h(x.reason)+'</p><div class="flex gap-2"><button class="'+lightButton+'" onclick="decideSalesDailyEdit(\''+h(x.id)+'\',\'Rejected\')">Reject</button><button class="'+actionButton+'" onclick="decideSalesDailyEdit(\''+h(x.id)+'\',\'Approved\')">Approve</button></div></div>').join('');
 const rows=r.tasks.map((t,i)=>'<div class="rounded-xl border p-3 bg-white"><b class="text-xs">'+(i+1)+'. '+h(t.plan)+'</b>'+
 '<div class="text-[11px] text-gray-500 mt-1">'+h(t.category)+(t.customerName?' · '+h(t.customerName):'')+'</div>'+
 '<div class="grid sm:grid-cols-2 gap-2 mt-2 text-xs"><div><b>Planned:</b> '+h(t.plannedFollowup||'No date')+'</div>'+
 '<div><b>Evening status:</b> '+h(t.status||'Not updated')+'</div></div>'+
 '<div class="text-xs mt-2"><b>Actual result:</b> '+h(t.result||'Not submitted')+'</div>'+
 (t.nextFollowup?'<div class="text-xs text-blue-700 mt-2">Next follow-up: '+h(t.nextFollowup)+'</div>':'')+'</div>').join('');
 openModal('Daily Plan & Result — '+h(r.salesperson)+' · '+h(r.date),
 '<div class="space-y-4">'+requestActions+'<div class="rounded-xl bg-gray-50 p-3 text-xs">AM: '+h(r.amStatus)+' · PM: '+h(r.pmStatus)+
 ' · Review: '+h(r.reviewStatus||'Pending')+'</div>'+rows+
 ((r.additionalActivities||[]).length?'<div class="rounded-xl border p-3"><b class="text-sm">Additional Activities (Unplanned)</b>'+(r.additionalActivities||[]).map(x=>'<div class="text-xs border-b py-2"><b>'+h(x.category)+'</b>'+(x.customerName?' · '+h(x.customerName):'')+'<div>'+h(x.result)+'</div>'+(x.nextFollowup?'<div>Next follow-up: '+h(x.nextFollowup)+'</div>':'')+'</div>').join('')+'</div>':'')+
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
   // Background reminder: check previously submitted mornings without blocking today's editor.
   api('read',{start:backDays(ui.date,7),end:backDays(ui.date,1)}).then(history=>{
     if(seq!==ui.seq||state.page!==P||state.user?.id!==userId)return;
     const missed=(history.reports||[]).filter(r=>r.userId===userId&&isOverdue(r)).sort((a,b)=>b.date.localeCompare(a.date));
     const holder=elem('salesDailyPriorReminder');
     if(holder&&missed.length)holder.innerHTML='<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800"><b>'+missed.length+' overdue Evening Result'+(missed.length===1?'':'s')+'</b><p class="mt-1">Your previous morning plans are waiting for evening outcomes. Open the oldest outstanding report and submit the actual results.</p><button type="button" onclick="openOverdueSalesDaily(\''+h(missed[missed.length-1].date)+'\')" class="'+lightButton+' mt-2">Open '+h(missed[missed.length-1].date)+'</button></div>';
   }).catch(err=>console.warn('Previous daily report reminders unavailable:',err.message));
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
 try{await api('decide_edit',{requestId,decision,note});closeModal();toast('Edit request '+decision.toLowerCase());await reload()}
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
