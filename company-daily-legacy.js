/* Read-only Sales/Marketing bridge for Company Daily. Existing Google Sheets
   workflows remain the sole writers of legacy tasks and daily reports. */
(function(){
'use strict';
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const H='rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-stone-50';
const role=()=>String(state?.profile?.role||'');
const id=()=>String(state?.user?.id||'');
const canSales=()=>['sales','manager','admin','super_admin'].includes(role());
const canMarketing=()=>['marketing','marketing_manager','admin','super_admin'].includes(role());
const staffSales=()=>role()==='sales';
const staffMarketing=()=>role()==='marketing'||role()==='marketing_manager';
const date=v=>String(v||'').slice(0,10);
const toISO=d=>{const x=new Date(d+'T12:00:00Z');return Number.isNaN(x.getTime())?'':x.toISOString().slice(0,10)};
const shift=(d,days)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()+days);return x.toISOString().slice(0,10)};
const asList=v=>{try{const x=typeof v==='string'?JSON.parse(v||'[]'):v;return Array.isArray(x)?x:[]}catch(_){return []}};
function resultObject(v){try{const x=typeof v==='string'?JSON.parse(v||'{}'):v;return x&&typeof x==='object'&&!Array.isArray(x)?x:{}}catch(_){return {}}}
const S={salesTodos:[],salesReports:[],salesUsers:[],salesCoverage:[],marketingTasks:[],marketingReports:[],marketingStaff:[],errors:{},loaded:{},loading:false,generation:0};
const key=(a,b)=>a+'|'+b;
const authorized=()=>({sales:canSales(),marketing:canMarketing()});
async function query(endpoint,action,payload={}){
 const {data,error}=await db.functions.invoke(endpoint,{body:{action,payload}});
 if(error)throw Error(data?.error||error.message||'Source connection failed');
 if(!data?.ok)throw Error(data?.error||'Legacy report unavailable');
 return data.data||{};
}
function salesNormalizeReport(r){
 return {...r,source:'sales',department:'Sales',workDate:date(r.date),staffId:String(r.userId||''),staffName:r.salesperson||'Sales employee',morningDone:r.amStatus==='Submitted',eveningDone:r.pmStatus==='Submitted',
  results:(r.tasks||[]).map(t=>({id:t.id,title:t.plan||'Sales task',status:t.status||'Not Started',result:t.result||''})),sourceId:'sales:'+String(r.id)};
}
function marketingNormalizeReport(r){
 const plan=asList(r.plan_json),res=resultObject(r.result_json),results=Array.isArray(res.task_results)?res.task_results:[];
 return {source:'marketing',department:'Marketing',workDate:date(r.work_date),staffId:String(r.user_id||''),staffName:r.user_name||'',morningDone:!!r.am_submitted_at,eveningDone:!!r.pm_submitted_at,
  reviewStatus:r.review_status||'',results:(results.length?results:plan.map(taskId=>({id:taskId,status:r.pm_submitted_at?'Reported':'Planned'}))).map(t=>({id:t.id,title:'',status:t.status||'Planned',result:t.note||''})),sourceId:'marketing:'+String(r.id||r.user_id+'-'+r.work_date)};
}
function salesAccess(){
 return canSales()&&String(state?.user?.id||'')!=='';}
async function load(suggestedDate){
 const generation=++S.generation,account=id();S.loading=true;
 S.errors={};S.loaded={};
 const jobs=[];
 if(salesAccess()){
  const end=toISO(suggestedDate)||new Date().toISOString().slice(0,10),start=shift(end,-29);
  jobs.push((async()=>{
   const results=await Promise.allSettled([
    query('sales-daily-google-proxy','todo_list'),
    query('sales-daily-google-proxy','read',{start,end})
   ]);
   if(generation!==S.generation||id()!==account)return;
   const a=results[0],b=results[1];
   if(a.status==='fulfilled'){S.salesTodos=a.value.items||[];S.loaded.salesTodos=true}
   else{S.errors.salesTodos=a.reason.message;S.salesTodos=[]}
   if(b.status==='fulfilled'){
    S.salesReports=(b.value.reports||[]).map(salesNormalizeReport);
    S.salesUsers=b.value.salesPeople||[];S.salesCoverage=[[start,end]];S.loaded.salesReports=true;
   }else{S.errors.salesReports=b.reason.message;S.salesReports=[];S.salesCoverage=[]}
  })());
 }
 if(canMarketing()){
  jobs.push((async()=>{
   const result=await Promise.allSettled([query('marketing-google-proxy','list'),db.rpc('get_marketing_staff')]);
   if(generation!==S.generation||id()!==account)return;
   if(result[0].status==='fulfilled'){
    S.marketingTasks=result[0].value.tasks||[];
    S.marketingReports=(result[0].value.daily||[]).map(marketingNormalizeReport);
    S.loaded.marketing=true;
   }else{S.errors.marketing=result[0].reason.message;S.marketingTasks=[];S.marketingReports=[]}
   if(result[1].status==='fulfilled'&&!result[1].value.error)S.marketingStaff=result[1].value.data||[];
  })());
 }
 try{await Promise.allSettled(jobs)}finally{if(generation===S.generation)S.loading=false}
}
function accountTasks(){
 const own=id(),out=[];
 if(salesAccess())for(const t of S.salesTodos){
  if((role()==='sales'&&String(t.assigneeId)!==own)||['Completed','Cancelled'].includes(t.status))continue;
  out.push({source:'sales',sourceId:key('sales',t.id),id:String(t.id),title:t.title||'',description:t.description||'',status:t.status||'',priority:t.priority||'',dueDate:t.dueDate||'',assignee:t.assignee||'',assigneeId:t.assigneeId||'',department:'Sales'});
 }
 if(canMarketing())for(const t of S.marketingTasks){
  if(staffMarketing()&&String(t.assignee_id||t.created_by)!==own)continue;
  if(['Completed','Published','Cancelled'].includes(t.status))continue;
  out.push({source:'marketing',sourceId:key('marketing',t.id),id:String(t.id),title:t.title||'',description:t.description||'',status:t.status||'',priority:t.priority||'',dueDate:date(t.due_date),assignee:t.assignee_name||'',assigneeId:t.assignee_id||'',department:'Marketing'});
 }
 return out;
}
function reports(){return [...S.salesReports,...S.marketingReports].map(r=>({
 ...r,
 staffName:r.staffName||(S.marketingStaff.find(x=>String(x.id)===String(r.staffId))?.name||'Marketing employee'),
 results:r.source==='marketing'?r.results.map(t=>({...t,title:S.marketingTasks.find(x=>x.id===t.id)?.title||'Marketing task'})):r.results
 }));}
function sourceButton(source,label){return '<button class="'+H+'" onclick="companyDailyLegacyOpen(\''+source+'\')">'+label+'</button>'}
function warning(source){return S.errors[source]?'<p class="text-xs text-amber-800">Connection: '+esc(S.errors[source])+'</p>':''}
function taskCard(t,my){
 const mine=String(t.assigneeId)===id();
 return '<div class="flex flex-wrap items-center justify-between gap-2 border rounded-lg p-3"><div><b class="text-sm">'+esc(t.title)+'</b>'+
 '<div class="text-xs text-slate-500">'+esc(t.department)+' · '+esc(t.assignee||'Unassigned')+' · '+esc(t.status)+' · '+esc(t.dueDate||'No deadline')+'</div></div>'+
 (mine?'<button class="'+H+'" onclick="companyDailyLegacyUse(\''+t.source+'\',\''+esc(t.id)+'\')">Use in Morning Plan</button>':sourceButton(t.source,'Open original'))+'</div>';
}
function daily(selectedDate){
 if(!canSales()&&!canMarketing())return '';
 const all=accountTasks().filter(t=>role()==='admin'||role()==='super_admin'||String(t.assigneeId)===id()),recent=reports().filter(r=>r.workDate===selectedDate&&(role()==='admin'||role()==='super_admin'||r.staffId===id()));
 const sourceNames=[canSales()?'Sales':'',canMarketing()?'Marketing':''].filter(Boolean).join(' + ');
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="font-bold">Connected '+sourceNames+' work</h3>'+
 '<p class="text-xs text-slate-500">Live view of existing tasks and daily reports. These are not copied into Company Daily or counted twice.</p></div>'+
 '<div class="flex flex-wrap gap-2">'+(canSales()?sourceButton('sales-todo','Sales To-Do')+sourceButton('sales-daily','Sales Daily'):'')+(canMarketing()?sourceButton('marketing','Marketing Daily'):'')+'</div></div>'+
 warning('salesTodos')+warning('salesReports')+warning('marketing')+
 '<div class="text-xs font-bold text-slate-600">Existing tasks · '+all.length+'</div>'+
 (all.length?all.slice(0,35).map(t=>taskCard(t,true)).join(''):'<p class="text-sm text-slate-500">No active tasks from your accessible legacy workspaces in this view.</p>')+
 '<div class="text-xs font-bold text-slate-600">Existing daily submissions · '+selectedDate+'</div>'+
 (recent.length?recent.map(r=>'<div class="border rounded-lg p-3 text-sm"><b>'+esc(r.department)+' · '+esc(r.staffName)+'</b>'+
 '<p class="text-xs text-slate-500">Morning: '+(r.morningDone?'Submitted':'Not started')+' · Evening: '+(r.eveningDone?'Submitted':'Not started')+'</p>'+
 (r.results||[]).slice(0,8).map(t=>'<div class="text-xs mt-1">'+esc(t.title)+' · '+esc(t.status)+'</div>').join('')+'</div>').join(''):'<p class="text-sm text-slate-500">No existing daily submissions found for this date in the loaded range.</p>')+
 '</section>';
}
function tasksPanel(){
 if(!canSales()&&!canMarketing())return '';
 const list=accountTasks();
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><h3 class="font-bold">Existing Sales & Marketing tasks · '+list.length+'</h3>'+
 '<p class="text-xs text-slate-500">Original task records remain editable only in their respective department apps.</p>'+
 (list.length?list.slice(0,100).map(x=>taskCard(x,false)).join(''):'<p class="text-sm text-slate-500">No accessible active tasks or the source is unavailable.</p>')+'</section>';
}
function filters(r,f){
 if(f.department!=='All'&&r.department!==f.department)return false;
 if(f.year!=='All'&&!r.workDate.startsWith(f.year))return false;
 if(f.month!=='All'&&r.workDate.slice(5,7)!==f.month)return false;
 if(f.quarter!=='All'&&Math.ceil(+r.workDate.slice(5,7)/3)!==+f.quarter)return false;
 if(f.employee!=='All'&&r.staffId!==f.employee)return false;
 return true;
}
function reportPanel(f){
 if(!canSales()&&!canMarketing())return '';
 const all=reports(),visible=all.filter(r=>filters(r,f));
 const coverage=S.salesCoverage.map(x=>x.join(' to ')).join('; ');
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><div class="flex flex-wrap items-center justify-between gap-2"><div><h3 class="font-bold">Connected Sales & Marketing reports</h3>'+
 '<p class="text-xs text-slate-500">Read-only, linked to original Google Sheets. '+visible.length+' submissions shown for the selected filters.</p></div>'+
 (canSales()?'<button class="'+H+'" onclick="companyDailyLegacyLoadPeriod()">Load Sales for selected period</button>':'')+'</div>'+
 (canSales()?'<p class="text-xs text-slate-500">Sales coverage loaded: '+esc(coverage||'Not available')+'. For a full month, quarter, or year click Load Sales for selected period.</p>':'')+
 warning('salesReports')+warning('marketing')+
 (visible.length?visible.slice(0,250).sort((a,b)=>b.workDate.localeCompare(a.workDate)).map(r=>
 '<div class="flex flex-wrap items-center justify-between border rounded-lg p-3 gap-2"><div class="text-sm"><b>'+esc(r.workDate)+' · '+esc(r.staffName)+'</b>'+
 '<p class="text-xs text-slate-500">'+esc(r.department)+' · AM '+(r.morningDone?'Submitted':'Pending')+' · PM '+(r.eveningDone?'Submitted':'Pending')+'</p>'+
 '<div class="text-xs">'+(r.results||[]).slice(0,5).map(t=>esc(t.title)+' — '+esc(t.status)).join(' · ')+'</div></div>'+
 sourceButton(r.source==='sales'?'sales-daily-review':'marketing','Open original')+'</div>').join(''):'<p class="text-sm text-slate-500">No connected reports match these filters in the loaded data.</p>')+'</section>';
}
async function loadPeriod(f){
 if(!canSales())return;
 const year=Number(f.year);if(!Number.isInteger(year)||year<2020||year>2100)throw Error('Choose a valid year');
 const months=f.month!=='All'?[Number(f.month)]:f.quarter!=='All'?Array.from({length:3},(_,i)=>(Number(f.quarter)-1)*3+i+1):Array.from({length:12},(_,i)=>i+1);
 const ranges=months.map(m=>{const start=year+'-'+String(m).padStart(2,'0')+'-01';const end=m===12?year+'-12-31':shift(year+'-'+String(m+1).padStart(2,'0')+'-01',-1);return{start,end}});
 const previous=new Map(S.salesReports.map(r=>[r.sourceId,r]));const errors=[],loaded=[];
 for(let i=0;i<ranges.length;i+=3){
  const slice=ranges.slice(i,i+3);
  const batch=await Promise.allSettled(slice.map(x=>query('sales-daily-google-proxy','read',x)));
  batch.forEach((result,j)=>{
   const range=slice[j];
   if(result.status==='fulfilled'){for(const r of result.value.reports||[]){const normalized=salesNormalizeReport(r);previous.set(normalized.sourceId,normalized)}loaded.push([range.start,range.end])}
   else errors.push(range.start+': '+result.reason.message);
  });
 }
 S.salesReports=[...previous.values()];S.salesCoverage.push(...loaded);
 S.errors.salesReports=errors.length?errors.join(' | '):'';
 return {loaded:loaded.length,errors};
}
async function open(source){
 if(source==='sales-todo'||source==='sales-daily'||source==='sales-daily-review'){if(!canSales())return;return window.go(source)}
 if(source==='marketing'){if(!canMarketing())return;return window.go('marketing')}
}
async function use(source,itemId){
 const task=accountTasks().find(x=>x.source===source&&x.id===String(itemId)&&String(x.assigneeId)===id());
 if(!task)return alert('This assigned task is unavailable');
 if(source==='sales'){
  if(!staffSales())return open('sales-todo');
  // Identical draft bridge used by Sales To-Do. The original Sales Daily
  // form validates ownership and persists the link in its own workflow.
  sessionStorage.setItem('salesDailyTodoDraft',JSON.stringify({sourceTaskId:task.id,plan:task.title,category:'Other',priority:task.priority,plannedFollowup:task.dueDate||''}));
  return open('sales-daily');
 }
 if(source==='marketing'){
  if(!staffMarketing())return open('marketing');
  await open('marketing');
  if(typeof window.addMarketingTodoToDaily==='function')window.addMarketingTodoToDaily(task.id);
 }
}
window.LICompanyDailyLegacy={S,load,daily,tasksPanel,reportPanel,loadPeriod};
window.companyDailyLegacyOpen=open;
window.companyDailyLegacyUse=use;
})();
