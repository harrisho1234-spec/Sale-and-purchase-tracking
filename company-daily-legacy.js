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

const VIEW={department:'All',person:'All',status:'Active',priority:'All',search:'',page:1,perPage:10,reportExpanded:false};
function normalizedStatus(t){
 const x=String(t.status||'').toLowerCase();
 if(x==='completed'||x==='published')return 'Completed';
 if(x==='cancelled')return 'Cancelled';
 if(x==='blocked')return 'Blocked';
 if(x==='in progress'||x==='in_progress')return 'In Progress';
 return 'Not Started';
}
function overdue(t){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(t.dueDate||'')))return false;
 const todayValue=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 return t.dueDate<todayValue&&!['Completed','Cancelled'].includes(normalizedStatus(t));
}
function taskPool(){
 return accountTasks().filter(t=>role()==='admin'||role()==='super_admin'||role()==='manager'||
 String(t.assigneeId)===id()||(!t.assigneeId&&t.source==='marketing'&&staffMarketing()));
}
function filteredTasks(){
 return taskPool().filter(t=>{
  const st=normalizedStatus(t);
  if(VIEW.department!=='All'&&t.department!==VIEW.department)return false;
  if(VIEW.person!=='All'&&String(t.assigneeId||'')!==VIEW.person)return false;
  if(VIEW.status==='Overdue'&&!overdue(t))return false;
  if(VIEW.status==='Blocked'&&st!=='Blocked')return false;
  if(VIEW.status==='In Progress'&&st!=='In Progress')return false;
  if(VIEW.status==='Not Started'&&st!=='Not Started')return false;
  if(VIEW.status==='Active'&&['Completed','Cancelled'].includes(st))return false;
  if(VIEW.priority!=='All'&&t.priority!==VIEW.priority)return false;
  if(VIEW.search&&!([t.title,t.description,t.assignee,t.department,t.status,t.category].join(' ').toLocaleLowerCase().includes(VIEW.search.toLocaleLowerCase())))return false;
  return true;
 }).sort((a,b)=>Number(overdue(b))-Number(overdue(a))||
  String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999'))||
  String(a.assignee||'').localeCompare(String(b.assignee||'')));
}
const selectItem=(value,label,selected)=>'<option value="'+esc(value)+'" '+(String(value)===String(selected)?'selected':'')+'>'+esc(label||value)+'</option>';
function controls(){
 const pool=taskPool();
 const departments=['All',...new Set(pool.map(t=>t.department).filter(Boolean))];
 const people=[...new Map(pool.filter(t=>t.assigneeId).map(t=>[String(t.assigneeId),t.assignee||'Staff'])).entries()].sort((a,b)=>a[1].localeCompare(b[1]));
 const field=(caption,body)=>'<label class="text-[11px] font-semibold text-stone-600 min-w-0">'+caption+body+'</label>';
 const select=(key,items)=>'<select class="mt-1 block w-full rounded-lg border border-stone-200 bg-white px-2.5 py-2 text-xs" onchange="companyLegacyFilter(\''+key+'\',this.value)">'+items.map(x=>selectItem(x[0],x[1],VIEW[key])).join('')+'</select>';
 return '<div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-2">'+
 field('Department',select('department',departments.map(d=>[d,d==='All'?'All departments':d])))+
 field('Staff',select('person',[['All','All staff'],...people]))+
 field('Status',select('status',[['Active','Active'],['Overdue','Overdue'],['Blocked','Blocked'],['In Progress','In progress'],['Not Started','Not started'],['All','All statuses']]))+
 field('Priority',select('priority',[['All','All priorities'],['Urgent','Urgent'],['High','High'],['Medium','Medium'],['Low','Low']]))+
 field('Search tasks','<input class="mt-1 block w-full rounded-lg border border-stone-200 px-2.5 py-2 text-xs" value="'+esc(VIEW.search)+'" oninput="companyLegacySearch(this.value)" placeholder="Task, project, person…" aria-label="Search connected tasks">')+
 field('Rows',select('perPage',[[10,'10 rows'],[20,'20 rows'],[40,'40 rows']]))+
 '</div>';
}
function overview(){
 const all=taskPool(),sales=all.filter(t=>t.source==='sales'),mkt=all.filter(t=>t.source==='marketing'),late=all.filter(overdue),blocked=all.filter(t=>normalizedStatus(t)==='Blocked');
 const metric=(name,num,selector)=>'<button class="text-left rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 hover:bg-stone-100" onclick="companyLegacyQuick(\''+selector+'\')"><div class="text-[10px] text-stone-500">'+name+'</div><div class="text-xl font-bold text-stone-900">'+num+'</div></button>';
 return '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">'+
 metric('Active tasks',all.length,'Active')+
 metric('Overdue',late.length,'Overdue')+
 metric('In progress',all.filter(t=>normalizedStatus(t)==='In Progress').length,'In Progress')+
 metric('Blocked',blocked.length,'Blocked')+'</div>'+
 '<p class="text-xs text-stone-500">Sales: '+sales.length+' · Marketing: '+mkt.length+' · Read-only view of original records. Select a count to filter.</p>';
}
function compactTable(){
 const all=filteredTasks(),pages=Math.max(1,Math.ceil(all.length/VIEW.perPage));VIEW.page=Math.min(Math.max(1,VIEW.page),pages);
 const subset=all.slice((VIEW.page-1)*VIEW.perPage,VIEW.page*VIEW.perPage);
 const statusTag=t=>'<span class="inline-flex whitespace-nowrap rounded-md bg-stone-100 px-2 py-1 text-[11px] '+(overdue(t)?'text-red-700 bg-red-50':'text-stone-700')+'">'+esc(overdue(t)?'Overdue':normalizedStatus(t))+'</span>';
 const rows=subset.map(t=>{
  const target=t.source==='sales'?'sales-todo':'marketing',mine=String(t.assigneeId)===id();
  const action=mine&&staffSales()&&t.source==='sales'||mine&&staffMarketing()&&t.source==='marketing'?
    '<button class="text-xs font-semibold text-amber-800 underline underline-offset-2" onclick="companyDailyLegacyUse(\''+esc(t.source)+'\',\''+esc(t.id)+'\')">Add to Plan</button>':
    '<button class="text-xs font-semibold text-amber-800 underline underline-offset-2" onclick="companyDailyLegacyOpen(\''+target+'\')">Open</button>';
  return '<tr class="border-b last:border-0 hover:bg-stone-50 align-top">'+
   '<td class="px-3 py-3"><div class="li-company-task-title font-semibold text-xs break-words max-w-[350px]" lang="auto">'+esc(t.title||'Untitled task')+'</div><div class="text-[10px] text-stone-400">'+esc(t.priority||'No priority')+'</div></td>'+
   '<td class="px-3 py-3 text-xs">'+esc(t.department)+'</td>'+
   '<td class="px-3 py-3 text-xs">'+esc(t.assignee||'Unassigned')+'</td>'+
   '<td class="px-3 py-3">'+statusTag(t)+'</td>'+
   '<td class="px-3 py-3 text-xs whitespace-nowrap">'+esc(t.dueDate||'—')+'</td>'+
   '<td class="px-3 py-3 whitespace-nowrap">'+action+'</td></tr>';
 }).join('');
 return '<div class="flex justify-between items-center gap-2 flex-wrap"><p class="text-xs font-semibold text-stone-600">'+all.length+' matching tasks · Showing '+(all.length?(VIEW.page-1)*VIEW.perPage+1:0)+'–'+Math.min(all.length,VIEW.page*VIEW.perPage)+'</p>'+
 (VIEW.department!=='All'||VIEW.person!=='All'||VIEW.status!=='Active'||VIEW.priority!=='All'||VIEW.search?
 '<button onclick="companyLegacyReset()" class="text-xs underline text-amber-800">Clear filters</button>':'')+'</div>'+
 '<div class="overflow-x-auto rounded-xl border border-stone-200"><table class="w-full min-w-[760px] text-left table-fixed"><thead class="bg-stone-50 text-[11px] text-stone-500"><tr>'+
 '<th class="w-[34%] px-3 py-2">Task</th><th class="w-[12%] px-3 py-2">Department</th><th class="w-[17%] px-3 py-2">Staff</th><th class="w-[13%] px-3 py-2">Status</th><th class="w-[13%] px-3 py-2">Deadline</th><th class="w-[11%] px-3 py-2">Action</th></tr></thead><tbody>'+
 (rows||'<tr><td colspan="6" class="p-5 text-sm text-stone-500">No matching tasks. Adjust the filters to see other work.</td></tr>')+
 '</tbody></table></div>'+
 '<div class="flex justify-between items-center gap-2"><button class="'+H+'" onclick="companyLegacyPage(-1)" '+(VIEW.page===1?'disabled':'')+'>Previous</button><span class="text-xs text-stone-500">Page '+VIEW.page+' of '+pages+'</span><button class="'+H+'" onclick="companyLegacyPage(1)" '+(VIEW.page===pages?'disabled':'')+'>Next</button></div>';
}
function dailySubmissions(selectedDate){
 const rows=reports().filter(r=>r.workDate===selectedDate&&(role()==='admin'||role()==='super_admin'||role()==='manager'||r.staffId===id()));
 const am=rows.filter(r=>r.morningDone).length,pm=rows.filter(r=>r.eveningDone).length;
 return '<div class="rounded-lg bg-stone-50 px-3 py-2 flex flex-wrap justify-between gap-2 items-center">'+
 '<span class="text-xs text-stone-600"><b>'+esc(selectedDate)+'</b> · '+rows.length+' report(s) · AM '+am+' submitted · PM '+pm+' submitted</span>'+
 '<button class="text-xs font-semibold text-amber-800" onclick="companyLegacyToggleReports()">'+(VIEW.reportExpanded?'Hide report details':'Show report details')+'</button></div>'+
 (VIEW.reportExpanded?(rows.length?rows.map(r=>'<div class="rounded-lg border p-3 text-xs"><b>'+esc(r.department)+' · '+esc(r.staffName)+'</b><div class="text-stone-500 mt-1">AM: '+(r.morningDone?'Submitted':'Not started')+' · PM: '+(r.eveningDone?'Submitted':'Not started')+'</div>'+
 (r.results||[]).slice(0,10).map(t=>'<div class="mt-1">'+esc(t.title)+' · '+esc(t.status)+'</div>').join('')+'</div>').join(''):'<p class="text-xs text-stone-500">No submissions on this date.</p>'):'');
}
function daily(selectedDate){
 if(!canSales()&&!canMarketing())return '';
 return '<section class="rounded-xl border bg-white p-4 space-y-3">'+
 '<div class="flex flex-wrap justify-between items-center gap-3"><div><h3 class="font-bold">Connected '+[canSales()?'Sales':'',canMarketing()?'Marketing':''].filter(Boolean).join(' + ')+' overview</h3>'+
 '<p class="text-xs text-slate-500">Original tasks and reports · no duplicate submissions</p></div>'+
 '<div class="flex flex-wrap gap-2">'+(canSales()?sourceButton('sales-todo','Sales To-Do')+sourceButton('sales-daily','Sales Daily'):'')+(canMarketing()?sourceButton('marketing','Marketing Daily'):'')+'</div></div>'+
 warning('salesTodos')+warning('salesReports')+warning('marketing')+
 overview()+controls()+compactTable()+dailySubmissions(selectedDate)+'</section>';
}
function tasksPanel(){
 if(!canSales()&&!canMarketing())return '';
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><h3 class="font-bold">Connected department tasks</h3>'+
 '<p class="text-xs text-stone-500">Filtered management view. Updates take place in original Sales / Marketing modules.</p>'+
 overview()+controls()+compactTable()+'</section>';
}
window.companyLegacyFilter=(field,value)=>{
 if(!Object.prototype.hasOwnProperty.call(VIEW,field))return;
 VIEW[field]=field==='perPage'?Math.min(40,Math.max(10,Number(value)||10)):value;
 VIEW.page=1;if(state.page==='company-daily')window.companyDailyLegacyRender?.();
};
window.companyLegacySearch=value=>{
 VIEW.search=String(value||'');VIEW.page=1;
 if(state.page!=='company-daily')return;
 window.companyDailyLegacyRender?.();
 const input=document.querySelector('input[aria-label="Search connected tasks"]');
 if(input){input.focus();input.setSelectionRange(value.length,value.length)}
};
window.companyLegacyPage=delta=>{VIEW.page+=delta;window.companyDailyLegacyRender?.()};
window.companyLegacyQuick=status=>{VIEW.status=status;VIEW.page=1;window.companyDailyLegacyRender?.()};
window.companyLegacyReset=()=>{VIEW.department='All';VIEW.person='All';VIEW.status='Active';VIEW.priority='All';VIEW.search='';VIEW.page=1;window.companyDailyLegacyRender?.()};
window.companyLegacyToggleReports=()=>{VIEW.reportExpanded=!VIEW.reportExpanded;window.companyDailyLegacyRender?.()};
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
