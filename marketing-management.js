/* Marketing Department workspace — independent from Sales and Stock.
   Google Sheets stores every task, daily entry and revision via authenticated Edge relay. */
(function(){
'use strict';
const PAGE='marketing';
const TABS=['Overview','Daily Plan & Result','My To-Do','Content Calendar','Campaigns','Reviews','Reports'];
const DATA={tab:'Overview',tasks:[],daily:[],staff:[],date:'',month:'',filter:'',brand:'all',ready:false,config:false,loading:false,todoStatus:'Active',todoPriority:'All',todoSort:'due',dailyDraftIds:[],dailyUnplannedIds:[],dailyReportVersion:1,dailyView:'My Daily',calendarBrand:'LPL',calendarView:'list',calendarDraftDate:''};
const h=v=>typeof esc==='function'?esc(v==null?'':String(v)):String(v==null?'':v).replace(/[&<>"']/g,'');
const role=()=>String(state.profile&&state.profile.role||'');
const marketingRole=()=>role()==='marketing'||role()==='marketing_manager';
const canEnter=()=>['marketing','marketing_manager','admin','super_admin'].includes(role());
const manager=()=>['marketing_manager','admin','super_admin'].includes(role());
const superAdmin=()=>role()==='super_admin';
const me=()=>String(state.user&&state.user.id||'');
const root=()=>document.getElementById('content');
const today=()=>{const d=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());const p=Object.fromEntries(d.map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day;};
const formatDate=v=>v?String(v).slice(0,10):'';
const safeId=id=>/^[a-f0-9-]{36}$/i.test(String(id||''))?String(id):'';
const own=t=>manager()||t.assignee_id===me()||t.created_by===me();
const tasks=()=>DATA.tasks.filter(own);
const note=(message,bad)=>showToast(message,bad?'err':undefined);
const badge=(s,theme)=>'<span class="inline-flex px-2 py-1 text-[10px] font-bold rounded-full '+(theme||'bg-stone-100 text-stone-700')+'">'+h(s||'—')+'</span>';
const line=t=>h(t.title)+' · '+h(t.business||'Other')+(t.brand?' · '+h(t.brand):'');
const btn=(label,click,kind)=>'<button type="button" class="px-3 py-2 rounded-lg border text-xs font-semibold '+(kind==='gold'?'bg-[#211d18] text-white border-[#211d18]':'bg-white border-stone-200 hover:bg-stone-50')+'" onclick="'+click+'">'+h(label)+'</button>';
const uid=t=>safeId(t.id);
const empty=message=>'<div class="bg-white border border-stone-200 rounded-2xl p-8 text-center text-sm text-stone-500">'+h(message)+'</div>';
const due=t=>t.due_date&&t.status!=='Published'&&t.status!=='Completed'&&t.status!=='Cancelled'&&formatDate(t.due_date)<today();
const ownerLabel=t=>t.assignee_name||(t.assignee_id?'Assigned staff':'Unassigned');
const statuses=['Not Started','In Progress','Blocked','Ready for Review','Completed','Cancelled'];
const categories=['Artwork / Poster','Video','Photo','Content Writing','Social Media','Promotion','Event','Catalog','Other'];
function opts(items,selected){return items.map(v=>'<option value="'+h(v)+'" '+(v===selected?'selected':'')+'>'+h(v)+'</option>').join('');}
function changeTab(tab){if(!TABS.includes(tab))return;DATA.tab=tab;draw();}
async function api(action,payload={}){
 const r=await db.functions.invoke('marketing-google-proxy',{body:{action,payload}});
 if(r.error)throw Error(r.data&&r.data.error||r.error.message||'Marketing connection unavailable');
 if(!r.data||!r.data.ok)throw Error(r.data&&r.data.error||'Marketing operation failed');
 return r.data.data;
}
async function fetchMarketing(){
 if(DATA.loading)return;
 DATA.loading=true;
 try{
  const results=await Promise.allSettled([api('list'),db.rpc('get_marketing_staff'),db.rpc('get_marketing_google_connection')]);
  if(results[1].status==='fulfilled'&&!results[1].value.error)DATA.staff=results[1].value.data||[];
  if(results[2].status==='fulfilled'&&!results[2].value.error)DATA.config=!!results[2].value.data?.configured;
  if(results[0].status==='rejected')throw results[0].reason;
  DATA.tasks=results[0].value.tasks||[];
  DATA.daily=results[0].value.daily||[];
  DATA.dailyReportVersion=Number(results[0].value.daily_report_version||1);
  DATA.ready=true;
 }catch(error){
  DATA.ready=false;
  DATA.error=error.message||String(error);
 }finally{DATA.loading=false;draw();}
}
function frame(title,subtitle,content){
 root().innerHTML=
  '<section data-marketing-workspace class="max-w-7xl mx-auto space-y-4">'+
   '<div class="flex flex-wrap justify-between items-center gap-3"><div><p class="text-[10px] tracking-[.18em] uppercase text-amber-700 font-bold">L’Imperial · Marketing Department</p>'+
   '<h2 class="text-xl sm:text-2xl font-bold mt-1">'+h(title)+'</h2><p class="text-xs text-stone-500">'+h(subtitle)+'</p></div>'+
   '<div class="flex flex-wrap gap-2">'+(superAdmin()?btn('Google Sheet Setup','openMarketingSetup()'):'')+
   btn('Refresh','refreshMarketing()')+(DATA.ready?btn('+ New Task','openMarketingTask()','gold'):'')+'</div></div>'+
   '<div class="flex gap-1 overflow-x-auto bg-white border rounded-xl p-1">'+
    TABS.filter(t=>manager()||!['Reviews','Reports'].includes(t)).map(t=>
      '<button type="button" class="shrink-0 rounded-lg px-3 py-2 text-xs font-semibold '+(DATA.tab===t?'bg-[#211d18] text-white':'text-stone-600 hover:bg-stone-100')+
      '" onclick="marketingTab(\''+h(t)+'\')">'+h(t)+'</button>').join('')+
   '</div>'+content+'</section>';
}
function draw(){
 if(state.page!==PAGE||!canEnter())return;
 if(DATA.loading&&!DATA.ready)return frame('Marketing Management','Preparing your department…',empty('Loading your Marketing tasks and calendar…'));
 if(!DATA.ready){
  return frame('Marketing Management','Separate department — Sales and Stock remain unchanged.',
   '<div class="bg-white rounded-2xl border p-6 space-y-3"><h3 class="font-bold text-lg">Marketing Google Sheets connection</h3>'+
   '<p class="text-sm text-stone-600">'+h(DATA.error||'The backend is not yet connected.')+'</p>'+
   '<p class="text-sm text-stone-500">The Marketing master workbook and app module are prepared. Super Admin must deploy the Marketing Google Apps Script and save its /exec URL.</p>'+
   (superAdmin()?btn('Connect Google Sheet','openMarketingSetup()','gold'):'<p class="text-xs">Ask Super Admin to complete the one-time connection.</p>')+'</div>');
 }
 if(DATA.tab==='Overview')return drawOverview();
 if(DATA.tab==='Daily Plan & Result')return drawDaily();
 if(DATA.tab==='My To-Do')return drawTodo();
 if(DATA.tab==='Content Calendar')return drawCalendar();
 if(DATA.tab==='Campaigns')return drawCampaigns();
 if(DATA.tab==='Reviews')return drawReviews();
 if(DATA.tab==='Reports')return drawReports();
}
function taskCard(t){
 const id=uid(t),col=t.approval_status==='Changes Requested'?'bg-red-50 text-red-700':due(t)?'bg-amber-50 text-amber-800':'bg-stone-100 text-stone-600';
 return '<article class="bg-white border rounded-xl p-4 space-y-3">'+
 '<div class="flex items-start gap-3 justify-between"><div><div class="text-sm font-bold">'+line(t)+'</div>'+
 '<p class="text-xs text-stone-500 mt-1">'+h(t.campaign||t.category||'Task')+' · '+h(ownerLabel(t))+'</p></div>'+
 badge(due(t)?'Overdue':t.status,col)+'</div>'+
 '<div class="flex flex-wrap gap-2 items-center text-xs">'+badge(t.priority||'Medium')+badge(t.approval_status||'Not Submitted')+
 '<span class="text-stone-400">Due '+h(t.due_date||'not set')+'</span><span class="font-semibold">'+h(t.progress||0)+'%</span></div>'+
 '<div class="h-1.5 rounded-full bg-stone-100 overflow-hidden"><div class="bg-amber-600 h-full" style="width:'+Math.max(0,Math.min(100,Number(t.progress)||0))+'%"></div></div>'+
 '<div class="flex gap-2 flex-wrap">'+btn('Progress','openMarketingProgress(\''+id+'\')')+
 btn('History','openMarketingHistory(\''+id+'\')')+
 (manager()?btn('Edit','openMarketingTask(\''+id+'\')'):'')+
 (manager()&&t.approval_status==='Pending'?btn('Review','openMarketingReview(\''+id+'\')','gold'):'')+
 (t.approval_status==='Approved'&&t.status!=='Published'?btn('Publish','openMarketingPublish(\''+id+'\')'):'')+
 (t.asset_url?'<a class="text-xs text-blue-700 underline px-2 py-2" target="_blank" rel="noopener noreferrer" href="'+h(t.asset_url)+'">Open artwork / Drive</a>':'')+
 (t.published_url?'<a class="text-xs text-blue-700 underline px-2 py-2" target="_blank" rel="noopener noreferrer" href="'+h(t.published_url)+'">View published post</a>':'')+
 '</div></article>';
}
function drawOverview(){
 const all=tasks(),overdue=all.filter(due),pending=all.filter(t=>t.approval_status==='Pending');
 const scheduled=all.filter(t=>formatDate(t.post_date)>=today()&&t.status!=='Published').sort((a,b)=>formatDate(a.post_date).localeCompare(formatDate(b.post_date))).slice(0,5);
 const thisWeek=all.filter(t=>t.due_date&&t.due_date>=today()).sort((a,b)=>formatDate(a.due_date).localeCompare(formatDate(b.due_date))).slice(0,5);
 const kpi=(name,value,sub)=>'<div class="border rounded-2xl bg-white p-4"><div class="uppercase tracking-wide text-[10px] text-stone-500 font-bold">'+name+'</div><div class="text-3xl font-bold mt-2">'+value+'</div><div class="text-xs text-stone-400 mt-1">'+sub+'</div></div>';
 frame('Marketing Overview','Tasks and deliverables across LP Home and L’Imperial Luxury.',
  '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">'+kpi('My / Team Tasks',all.length,'Visible tasks')+
  kpi('In Progress',all.filter(t=>t.status==='In Progress').length,'Active work')+
  kpi('Overdue',overdue.length,'Action needed')+
  kpi('Pending Review',pending.length,'Awaiting approval')+'</div>'+
  (overdue.length?'<div class="border border-amber-200 bg-amber-50 rounded-xl p-3 text-xs text-amber-900"><b>Overdue alerts:</b> '+overdue.length+' task(s) past deadline. Open My To-Do for details.</div>':'')+
  '<div class="grid lg:grid-cols-2 gap-4"><section class="space-y-3"><h3 class="font-bold">Next to publish</h3>'+
   (scheduled.length?scheduled.map(t=>'<div class="bg-white rounded-xl border p-3"><div class="text-xs text-stone-500">'+h(t.post_date)+' · '+h(t.business||'Other')+'</div><b class="text-sm">'+h(t.title)+'</b><div class="text-xs">'+h(t.platforms||'Platforms pending')+'</div></div>').join(''):empty('No upcoming publishing assignments.'))+
  '</section><section class="space-y-3"><h3 class="font-bold">Upcoming task deadlines</h3>'+
  (thisWeek.length?thisWeek.map(taskCard).join(''):empty('No upcoming deadlines.'))+'</section></div>');
}

function marketingOwnDaily(t){
 return String(t.assignee_id||'')===me()||(!t.assignee_id&&String(t.created_by||'')===me());
}
function marketingClosed(t){return ['Completed','Published','Cancelled'].includes(t.status);}
function marketingTodoStatus(t){return due(t)?'Overdue':t.status||'Not Started';}
function marketingTodoSort(a,b){
 const mode=DATA.todoSort;
 const rank={Urgent:0,High:1,Medium:2,Low:3};
 if(mode==='priority')return (rank[a.priority]??9)-(rank[b.priority]??9)||formatDate(a.due_date||'9999').localeCompare(formatDate(b.due_date||'9999'));
 if(mode==='recent')return String(b.updated_at||'').localeCompare(String(a.updated_at||''));
 return Number(due(b))-Number(due(a))||formatDate(a.due_date||'9999').localeCompare(formatDate(b.due_date||'9999'));
}
function marketingTodoRow(t){
 const id=uid(t),late=due(t),progress=Math.max(0,Math.min(100,Number(t.progress)||0));
 const isDaily=marketingOwnDaily(t),status=marketingTodoStatus(t);
 const urgency=late?'text-red-700 bg-red-50':t.priority==='Urgent'?'text-amber-900 bg-amber-50':'text-slate-700 bg-slate-100';
 return '<article class="bg-white rounded-xl border border-slate-200 p-4 space-y-3" data-marketing-todo-row="'+id+'">'+
  '<div class="flex flex-wrap justify-between gap-3">'+
   '<div class="min-w-0 flex-1"><div class="text-sm sm:text-base font-bold text-slate-900">'+h(t.title)+'</div>'+
   '<div class="text-xs text-slate-500 mt-1">'+h(ownerLabel(t))+' · '+h(t.business||'Other')+(t.brand?' · '+h(t.brand):'')+
   ' · '+h(t.start_date||'Start not set')+' → '+h(t.due_date||'No deadline')+'</div></div>'+
   '<div class="flex flex-wrap gap-1.5 items-start">'+badge(status,late?'bg-red-50 text-red-700':'bg-slate-100 text-slate-700')+
   badge(t.priority||'Medium',urgency)+'</div></div>'+
  (t.description?'<p class="text-xs sm:text-sm text-slate-600 whitespace-pre-wrap break-words">'+h(t.description.length>350?t.description.slice(0,350)+'…':t.description)+'</p>':'')+
  '<div class="flex flex-wrap items-center gap-2 text-xs">'+
   (t.campaign?badge(t.campaign,'bg-indigo-50 text-indigo-700'):'')+
   (t.approval_status&&t.approval_status!=='Not Submitted'?badge(t.approval_status,t.approval_status==='Changes Requested'?'bg-amber-50 text-amber-800':'bg-sky-50 text-sky-700'):'')+
   (t.post_date?'<span class="text-slate-500">Scheduled post: '+h(t.post_date)+'</span>':'')+
  '</div>'+
  '<div class="flex items-center justify-between gap-3 text-xs"><span class="font-semibold text-slate-700">'+h(t.status)+' · '+progress+'%</span>'+
   (late?'<b class="text-red-700">Overdue — action required</b>':'')+'</div>'+
  '<div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div class="h-2 bg-amber-600 rounded-full" style="width:'+progress+'%"></div></div>'+
  '<div class="flex flex-wrap items-center gap-2">'+
   btn('History','openMarketingHistory(\''+id+'\')')+
   (isDaily?btn('Add to Daily Plan','addMarketingTodoToDaily(\''+id+'\')'):'')+
   btn('Quick Update','openMarketingProgress(\''+id+'\')','gold')+
   (manager()?btn('Edit Details','openMarketingTask(\''+id+'\')'):'')+
   (manager()&&t.approval_status==='Pending'?btn('Review','openMarketingReview(\''+id+'\')'):'')+
   (t.approval_status==='Approved'&&t.status!=='Published'?btn('Publish','openMarketingPublish(\''+id+'\')'):'')+
   (t.asset_url?'<a class="rounded-lg border px-3 py-2 text-xs text-blue-700" target="_blank" rel="noopener noreferrer" href="'+h(t.asset_url)+'">View artwork</a>':'')+
   (t.published_url?'<a class="rounded-lg border px-3 py-2 text-xs text-blue-700" target="_blank" rel="noopener noreferrer" href="'+h(t.published_url)+'">Published post</a>':'')+
  '</div></article>';
}
function drawTodo(){
 const all=tasks(),term=DATA.filter.trim().toLowerCase();
 const active=all.filter(t=>!marketingClosed(t));
 const matched=all.filter(t=>{
  if(term&&!['title','description','assignee_name','brand','campaign','business'].some(k=>String(t[k]||'').toLowerCase().includes(term)))return false;
  if(DATA.todoPriority!=='All'&&t.priority!==DATA.todoPriority)return false;
  if(DATA.todoStatus==='Active'&&marketingClosed(t))return false;
  if(DATA.todoStatus==='Overdue'&&!due(t))return false;
  if(!['Active','All','Overdue'].includes(DATA.todoStatus)&&String(t.status)!==DATA.todoStatus)return false;
  return true;
 }).sort(marketingTodoSort);
 const alerts=all.filter(t=>due(t)||t.approval_status==='Changes Requested');
 const metric=(label,n,sub)=>'<div class="rounded-xl border border-slate-200 bg-white px-4 py-3"><div class="text-xs text-slate-500">'+label+'</div><b class="block text-xl mt-1">'+n+'</b><div class="text-[10px] text-slate-400">'+sub+'</div></div>';
 const filterOption=(v,selected,label)=>'<option value="'+h(v)+'" '+(v===selected?'selected':'')+'>'+h(label||v)+'</option>';
 frame('Marketing To-Do List','Assignments, deadlines and progress · Google Sheets · Sales-style task management',
  (alerts.length?'<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-wrap items-center justify-between gap-2">'+
   '<div><b class="text-sm text-amber-900">⚠ '+alerts.length+' tasks need attention</b><p class="text-xs text-amber-800 mt-1">'+
   all.filter(due).length+' overdue · '+all.filter(t=>t.approval_status==='Changes Requested').length+' revisions requested</p></div>'+
   btn('View Overdue','marketingTodoSetStatus(\'Overdue\')')+'</div>':'')+
  '<div class="grid grid-cols-3 gap-2">'+metric('Total',all.length,'All accessible tasks')+
   metric('Completed',all.filter(t=>['Completed','Published'].includes(t.status)).length,'Finished / published')+
   metric('Overdue',all.filter(due).length,'Unfinished past deadline')+'</div>'+
  '<div class="bg-white border border-slate-200 rounded-xl p-3 grid grid-cols-2 lg:grid-cols-4 gap-2">'+
   '<input id="mktFilter" value="'+h(DATA.filter)+'" placeholder="Search tasks" oninput="marketingFilter(this.value)" class="col-span-2 lg:col-span-1 border rounded-lg px-3 py-2 text-sm min-w-0" aria-label="Search Marketing tasks">'+
   '<select id="mktStatusFilter" onchange="marketingTodoSetStatus(this.value)" aria-label="Status filter" class="border rounded-lg px-3 py-2 text-sm bg-white">'+
    ['Active','All','Not Started','In Progress','Blocked','Ready for Review','Completed','Published','Cancelled','Overdue'].map(x=>filterOption(x,DATA.todoStatus)).join('')+'</select>'+
   '<select id="mktPriorityFilter" onchange="marketingTodoSetPriority(this.value)" aria-label="Priority filter" class="border rounded-lg px-3 py-2 text-sm bg-white">'+
    ['All','Urgent','High','Medium','Low'].map(x=>filterOption(x,DATA.todoPriority)).join('')+'</select>'+
   '<select id="mktSortFilter" onchange="marketingTodoSetSort(this.value)" aria-label="Sort tasks" class="border rounded-lg px-3 py-2 text-sm bg-white">'+
    [['due','Deadline'],['priority','Priority'],['recent','Recently Updated']].map(x=>filterOption(x[0],DATA.todoSort,x[1])).join('')+'</select>'+
  '</div>'+
  '<div class="flex flex-wrap items-center justify-between gap-2"><p class="text-xs text-slate-500">'+matched.length+' results · '+active.length+' active tasks</p>'+btn('+ Add Task','openMarketingTask()','gold')+'</div>'+
  '<div class="grid gap-3">'+(matched.length?matched.map(marketingTodoRow).join(''):empty('No tasks match these filters. Try All status or create a new task.'))+'</div>');
}
const DAILY_RESULT_STATUSES=['Completed','Partially Completed','Pending','Not Done'];
function dailyParsed(value,fallback){
 try{const d=JSON.parse(value||'');return d&&typeof d==='object'?d:fallback;}
 catch(_){return fallback;}
}
function dailyTaskName(t){return (t&&t.title)||'Deleted task';}
function dailyBusinessName(t){
 const b=String(t?.business||'').toUpperCase();
 return b==='LPL'?"L'Imperial Luxury":b==='LPH'?'LP Home':b==='BOTH'?'Both brands':'Other Marketing Tasks';
}
function dailySection(tasks,render){
 const groups=new Map();
 tasks.forEach(t=>{
  const key=dailyBusinessName(t);
  if(!groups.has(key))groups.set(key,[]);
  groups.get(key).push(t);
 });
 return [...groups].map(([business,rows])=>
  '<section class="rounded-xl border border-emerald-100 overflow-hidden bg-white">'+
  '<div class="bg-emerald-50 border-b border-emerald-100 px-3 py-2 flex justify-between items-center gap-2"><b class="text-xs text-emerald-950">'+h(business)+
  '</b><span class="text-[10px] text-emerald-900">'+rows.length+' task(s)</span></div>'+
  '<div class="divide-y divide-stone-100">'+rows.map(render).join('')+'</div></section>'
 ).join('');
}
function dailyCalendarLink(t){
 if(!t?.post_date)return '';
 return '<button type="button" class="text-[11px] text-blue-700 font-semibold hover:underline" onclick="marketingDailyOpenCalendar(\''+uid(t)+'\')">'+
  'Calendar · '+h(formatDate(t.post_date))+'</button>';
}
function marketingDailyRow(t,checked,disabled){
 const id=uid(t);
 return '<div class="flex items-start gap-3 p-3 hover:bg-stone-50">'+
  '<label class="flex items-start gap-3 flex-1 min-w-0 cursor-pointer">'+
   '<input type="checkbox" class="mkt-daily-task mt-1 w-4 h-4 accent-amber-700" value="'+h(id)+'" '+(checked?'checked ':'')+
    (disabled?'disabled ':'')+'onchange="marketingDailyDraftToggle(this.value,this.checked)" aria-label="Select '+h(t.title)+'">'+
   '<span class="min-w-0 flex-1"><b class="text-sm text-slate-900">'+h(t.title)+'</b>'+
    '<span class="block text-xs text-slate-500 mt-1">'+h(t.category||'General')+' · '+h(t.priority||'Medium')+
    ' · Due '+h(t.due_date||'not set')+'</span>'+
    '<span class="block text-xs text-slate-500 mt-1">'+h(t.status||'Not Started')+' · '+h(t.progress||0)+'%</span>'+
   '</span></label>'+
   (t.post_date?'<span class="shrink-0">'+dailyCalendarLink(t)+'</span>':'')+
 '</div>';
}

function dailyResultRow(t,values,unplanned){
 const id=uid(t),v=values?.[id]||{},status=DAILY_RESULT_STATUSES.includes(v.status)?v.status:'Pending';
 return '<article class="mkt-daily-result-row p-3 space-y-2" data-task-id="'+h(id)+'">'+
 '<div class="flex flex-wrap gap-3 justify-between"><div class="min-w-0"><b class="text-sm">'+h(t.title)+'</b>'+
 '<p class="text-xs text-stone-500">'+h(t.category||'Marketing')+' · '+h(t.progress||0)+'% complete · '+h(t.business||'Other')+
 (unplanned?' · <b>Additional work</b>':'')+'</p>'+
 (t.post_date?dailyCalendarLink(t):'')+'</div>'+
 btn('Quick Update','openMarketingProgress(\''+id+'\')')+'</div>'+
 '<div class="grid sm:grid-cols-[190px_1fr] gap-2">'+
 '<label class="block text-xs font-semibold">Today\'s Result<select class="mkt-daily-result-status mt-1 w-full border rounded-lg px-2 py-2 text-xs" aria-label="Result status for '+h(t.title)+'">'+
 opts(DAILY_RESULT_STATUSES,status)+'</select></label>'+
 '<label class="block text-xs font-semibold">Remark / Outcome<textarea class="mkt-daily-result-note mt-1 w-full border rounded-lg px-2 py-2 text-xs" rows="2" maxlength="1000" placeholder="What was done, what remains, or what blocked this task?">'+h(v.note||'')+'</textarea></label>'+
 '</div></article>';
}
function dailyReviewResults(ids,result){
 const values=new Map((Array.isArray(result?.task_results)?result.task_results:[]).map(r=>[r.id,r]));
 return ids.map(id=>{
  const t=DATA.tasks.find(x=>x.id===id),v=values.get(id);
  return '<div class="p-3 border-b border-stone-100 last:border-b-0 grid sm:grid-cols-2 gap-2">'+
   '<div><b class="text-xs">'+h(t?.title||'Task not available')+'</b><p class="text-[11px] text-stone-500">'+
    h(dailyBusinessName(t))+(t?.post_date?' · '+h(formatDate(t.post_date)):'')+'</p>'+
    (t?dailyCalendarLink(t):'')+'</div>'+
   '<div class="text-xs"><b>'+h(v?.status||'Not recorded')+'</b>'+
    (v?.note?'<p class="mt-1 whitespace-pre-wrap">'+h(v.note)+'</p>':'')+'</div></div>';
 }).join('');
}
function openDailyCalendarSelector(){
 if(DATA.dailyView!=='My Daily')return;
 const date=DATA.date||today();
 const day=DATA.daily.find(r=>String(r.user_id)===me()&&formatDate(r.work_date)===date);
 if(day?.am_submitted_at)return note('Morning Plan has been submitted. Scheduled task selection is locked.',true);
 const list=DATA.tasks.filter(t=>marketingOwnDaily(t)&&t.post_date&&safeId(t.id)&&!marketingClosed(t))
   .sort((a,b)=>{
    const da=Math.abs(new Date(a.post_date+'T00:00:00Z')-new Date(date+'T00:00:00Z'));
    const db=Math.abs(new Date(b.post_date+'T00:00:00Z')-new Date(date+'T00:00:00Z'));
    return da-db||String(a.title).localeCompare(String(b.title));
   });
 openModal('Choose Tasks from Content Calendar','<div class="space-y-3">'+
  '<p class="text-xs text-stone-500">Select existing scheduled Marketing tasks to link to this Morning Plan. They remain the same tasks in Content Calendar and My To-Do.</p>'+
  '<p class="text-xs text-stone-500">Report date: '+h(date)+' · '+list.length+' assigned scheduled tasks</p>'+
  '<div class="max-h-[55vh] overflow-y-auto space-y-2">'+
  (list.length?list.map(t=>
   '<div class="flex items-center justify-between gap-2 border rounded-lg p-3"><div class="min-w-0"><b class="text-xs">'+h(t.title)+'</b>'+
    '<p class="text-[11px] text-stone-500">'+h(dailyBusinessName(t))+' · Scheduled '+h(formatDate(t.post_date))+'</p></div>'+
   btn(DATA.dailyDraftIds.includes(t.id)?'Selected':'Add to Morning Plan','marketingDailyAddCalendarTask(\''+uid(t)+'\')',DATA.dailyDraftIds.includes(t.id)?'':'gold')+
   '</div>').join(''):empty('No assigned scheduled content. Ask your manager to assign Content Calendar tasks first.'))+
  '</div></div>');
}
function dailyAddCalendarTask(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!t||!marketingOwnDaily(t)||!t.post_date)return note('Choose an assigned Content Calendar task',true);
 DATA.dailyDraftIds=[...new Set(DATA.dailyDraftIds.concat([t.id]))];
 closeModal();
 drawDaily();
 note('Calendar task added to Morning Plan — submit to save.');
}
function dailyOpenCalendar(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!t||!own(t)||!t.post_date)return note('Linked Content Calendar task unavailable',true);
 DATA.month=formatDate(t.post_date).slice(0,7);
 DATA.calendarBrand=['LPL','LPH'].includes(String(t.business||'').toUpperCase())?t.business.toUpperCase():'LPL';
 DATA.tab='Content Calendar';DATA.calendarView='calendar';
 draw();
 calendarDetails(id);
}
function dailyAddUnplanned(){
 const date=DATA.date||today(),r=DATA.daily.find(x=>String(x.user_id)===me()&&formatDate(x.work_date)===date);
 const planned=dailyParsed(r?.plan_json,[]),saved=dailyParsed(r?.result_json,{});
 const ids=[...new Set([...(Array.isArray(planned)?planned:[]),...(Array.isArray(saved.task_ids)?saved.task_ids:[]),...DATA.dailyUnplannedIds])];
 const extra=DATA.tasks.filter(t=>marketingOwnDaily(t)&&safeId(t.id)&&!ids.includes(t.id));
 openModal('Add Additional Marketing Work','<div class="space-y-3"><p class="text-xs text-stone-500">'+
  'Link another existing Marketing task to the Evening Result. It will appear separately as additional/unplanned work.</p>'+
  '<div class="max-h-[60vh] overflow-y-auto space-y-2">'+
  (extra.length?extra.map(t=>'<div class="flex justify-between items-center border rounded-lg px-3 py-2 gap-2"><div>'+
   '<b class="text-xs">'+h(t.title)+'</b><p class="text-[11px] text-stone-500">'+h(dailyBusinessName(t))+
   (t.post_date?' · '+h(formatDate(t.post_date)):'')+'</p></div>'+
    btn('Add to Evening Result','marketingDailyAttachUnplanned(\''+uid(t)+'\')','gold')+'</div>').join(''):
   empty('No more assigned Marketing tasks available.'))+'</div></div>');
}
function dailyAttachUnplanned(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!t||!marketingOwnDaily(t))return note('Task is not assigned to you',true);
 DATA.dailyUnplannedIds=[...new Set(DATA.dailyUnplannedIds.concat([id]))];
 closeModal();
 drawDaily();
 note('Additional task linked. Record its result and remark before submission.');
}

function marketingWeekSummary(date){
 const first=new Date(date+'T12:00:00Z');
 if(Number.isNaN(first.getTime()))return '';
 first.setUTCDate(first.getUTCDate()-6);
 const from=first.toISOString().slice(0,10);
 const mine=DATA.daily.filter(r=>String(r.user_id)===me()&&formatDate(r.work_date)>=from&&formatDate(r.work_date)<=date);
 const am=mine.filter(r=>!!r.am_submitted_at).length,pm=mine.filter(r=>!!r.pm_submitted_at).length;
 const count=mine.reduce((sum,r)=>{try{const p=JSON.parse(r.plan_json||'[]');return sum+(Array.isArray(p)?p.length:0);}catch(_){return sum;}},0);
 return '<section class="rounded-2xl border bg-white p-4 space-y-3">'+
  '<h3 class="text-sm font-bold">Last 7 Days · Daily Report Summary</h3>'+
  '<p class="text-xs text-slate-500">'+h(from)+' to '+h(date)+' · Your own reports</p>'+
  '<div class="grid grid-cols-3 gap-2">'+[['Morning Plans',am],['Evening Results',pm],['Planned Tasks',count]].map(x=>
   '<div class="rounded-xl border p-3"><p class="text-[10px] text-slate-500">'+x[0]+'</p><b class="text-xl">'+x[1]+'</b></div>').join('')+'</div></section>';
}
function drawMarketingTeamDaily(){
 const date=DATA.date||today();
 const reportRows=DATA.daily.filter(r=>formatDate(r.work_date)===date);
 const ownHeader='<div class="flex flex-wrap justify-between items-end gap-3 rounded-xl bg-white border p-3">'+
  '<label class="text-xs font-bold">Report Date<input type="date" value="'+h(date)+'" onchange="marketingDate(this.value)" class="block border rounded-lg px-3 py-2 mt-1 text-sm"></label>'+
  '<div class="flex gap-2">'+btn('My Daily Plan','marketingDailyView(\'My Daily\')')+'</div></div>';
 const rows=reportRows.map(r=>{
  const raw=dailyParsed(r.plan_json,[]),ids=Array.isArray(raw)?raw:[];
  const result=dailyParsed(r.result_json,{});
  const pmIds=Array.isArray(result.task_ids)?result.task_ids:ids;
  const extras=pmIds.filter(id=>!ids.includes(id));
  const who=DATA.staff.find(p=>p.id===r.user_id);
  const plannedTasks=ids.map(id=>DATA.tasks.find(x=>x.id===id)).filter(Boolean);
  const extraTasks=extras.map(id=>DATA.tasks.find(x=>x.id===id)).filter(Boolean);
  const labels=plannedTasks.length?dailySection(plannedTasks,t=>
   '<div class="px-3 py-2 text-xs flex gap-2 flex-wrap justify-between">'+
   '<span>'+h(t.title)+(t.post_date?' · '+dailyCalendarLink(t):'')+'</span>'+
   '<span class="text-stone-600">'+h(t.business||'Other')+'</span></div>'):
   empty('No accessible planned tasks found.');
  return '<article class="border rounded-xl bg-white p-4 space-y-3">'+
   '<div class="flex flex-wrap justify-between gap-2"><div><b class="text-sm">'+h(who?.name||r.user_name||'Marketing Staff')+'</b>'+
   '<p class="text-xs text-slate-500">'+h(date)+' · '+ids.length+' planned task(s)</p></div>'+
   '<div class="flex flex-wrap gap-2">'+badge(r.am_submitted_at?'AM Submitted':'AM Pending')+
   badge(r.pm_submitted_at?'PM Submitted':'PM Pending',r.pm_submitted_at?'bg-green-50 text-green-700':'bg-amber-50 text-amber-800')+'</div></div>'+
   '<div class="space-y-2"><h4 class="text-xs font-bold">Morning Plan</h4>'+labels+'</div>'+
   (r.pm_submitted_at?
    '<div class="space-y-2 border-t pt-3"><h4 class="text-xs font-bold">Evening Result · Planned Tasks</h4>'+
     (plannedTasks.length?dailySection(plannedTasks,t=>dailyReviewResults([t.id],result)):empty('No planned task results.'))+
     (extraTasks.length?'<h4 class="text-xs font-bold mt-3">Additional / Unplanned Work</h4>'+
       dailySection(extraTasks,t=>dailyReviewResults([t.id],result)):'')+
     '<div class="rounded-xl border p-3 text-xs whitespace-pre-wrap"><b>Evening summary: </b>'+h(result.note||'No summary recorded')+'</div></div>':
     '<p class="text-xs text-amber-800">Evening Result has not been submitted.</p>')+
   '</article>';
 }).join('');
 frame('Marketing Team Daily Review','Morning plans and per-task evening outcomes for Marketing staff only.',
  ownHeader+'<div class="grid lg:grid-cols-2 gap-3">'+(rows||empty('No Marketing Daily Reports submitted for this date.'))+'</div>');
}
function drawDaily(){
 if(manager()&&DATA.dailyView==='Team Review')return drawMarketingTeamDaily();
 const date=DATA.date||today(),day=DATA.daily.find(r=>String(r.user_id)===me()&&formatDate(r.work_date)===date);
 let planned=dailyParsed(day?.plan_json,[]),result=dailyParsed(day?.result_json,{});
 if(!Array.isArray(planned))planned=[];
 if(!result||typeof result!=='object'||Array.isArray(result))result={};
 const hasAM=!!day?.am_submitted_at,hasPM=!!day?.pm_submitted_at;
 const ownTasks=DATA.tasks.filter(marketingOwnDaily);
 const draft=DATA.dailyDraftIds.length?DATA.dailyDraftIds:planned;
 const selected=hasAM?planned:draft;
 const planRows=hasAM?planned.map(id=>DATA.tasks.find(t=>t.id===id)).filter(Boolean):
   ownTasks.filter(t=>!marketingClosed(t)||draft.includes(t.id));
 const recordedIds=Array.isArray(result.task_ids)?result.task_ids:[];
 const extraIds=[...new Set(recordedIds.filter(id=>!planned.includes(id)).concat(DATA.dailyUnplannedIds))];
 const plannedPM=planned.map(id=>DATA.tasks.find(t=>t.id===id)).filter(Boolean);
 const extraPM=extraIds.map(id=>DATA.tasks.find(t=>t.id===id)).filter(t=>t&&marketingOwnDaily(t));
 const values=Object.fromEntries((Array.isArray(result.task_results)?result.task_results:[])
   .filter(x=>x&&safeId(x.id)).map(x=>[x.id,x]));
 const summary=String(result.note||'');
 const statusBar='<div class="rounded-2xl border bg-white p-4 flex flex-wrap gap-3 items-end justify-between">'+
  '<label class="text-xs font-bold">Report Date<input type="date" value="'+h(date)+'" onchange="marketingDate(this.value)" class="block mt-1 border rounded-lg px-3 py-2 text-sm"></label>'+
  '<div class="flex flex-wrap items-center gap-2">'+badge('AM: '+(hasAM?'Submitted':'Not Started'),hasAM?'bg-green-50 text-green-700':'bg-amber-50 text-amber-800')+
   badge('PM: '+(hasPM?'Submitted':'Not Started'),hasPM?'bg-green-50 text-green-700':'bg-blue-50 text-blue-800')+
   badge('Planned: '+planned.length)+'</div></div>';
 const morning='<section class="space-y-3"><div class="flex flex-wrap items-center justify-between gap-2">'+
  '<div><h3 class="text-base font-bold">Morning Plan</h3>'+
   '<p class="text-xs text-slate-500 mt-1">Choose existing Marketing tasks, including items from Content Calendar. No duplicate tasks are created.</p></div>'+
  (!hasAM?'<div class="flex flex-wrap gap-2">'+btn('Select from Content Calendar','openMarketingDailyCalendarSelector()','gold')+
   btn('Carry Forward Unfinished','carryMarketingUnfinished()')+
   btn('+ Add Task','openMarketingTask()')+'</div>':'')+'</div>'+
  '<div class="space-y-2">'+(planRows.length?dailySection(planRows,t=>hasAM?
   '<div class="p-3 flex flex-wrap justify-between items-center gap-2"><div><b class="text-sm">'+h(t.title)+'</b>'+
   '<p class="text-xs text-slate-500">'+h(t.category||'General')+' · '+h(t.priority||'Medium')+'</p>'+
   (t.post_date?dailyCalendarLink(t):'')+'</div>'+badge(t.status)+'</div>':
   marketingDailyRow(t,selected.includes(t.id),false)):
   empty('No personal Marketing tasks yet. Choose tasks from Content Calendar or ask your manager to assign one.'))+'</div>'+
  (!hasAM?'<div class="flex flex-wrap gap-2">'+btn('Submit Morning Plan','submitMarketingDaily(\'am\')','gold')+
    '<span class="text-xs text-slate-500 self-center">Submitting locks task selection. Each task remains linked to My To-Do / Content Calendar.</span></div>':
   '<div class="text-xs text-green-700">Morning Plan submitted · '+planned.length+' linked task(s).</div>')+
  '</section>';
 const legacyEvening=hasAM&&DATA.dailyReportVersion<2?
  '<section class="space-y-3 border-t pt-5"><div><h3 class="text-base font-bold">Evening Result · Summary Only</h3>'+
  '<p class="text-xs text-slate-600 mt-1">The current Marketing Apps Script supports the original summary-only format. Per-task statuses and remarks will become available after management redeploys Code.gs.</p></div>'+
  '<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">Existing daily reporting remains available. This legacy submission saves the overall summary and task links only; it does not save individual task results.</div>'+
  '<div class="space-y-2">'+(plannedPM.length?dailySection(plannedPM,t=>
    '<div class="p-3 flex flex-wrap gap-2 justify-between items-center"><div><b class="text-xs">'+h(t.title)+'</b>'+
    (t.post_date?'<div>'+dailyCalendarLink(t)+'</div>':'')+'</div>'+
    btn('Quick Update','openMarketingProgress(\''+uid(t)+'\')')+'</div>'):
    empty('No planned Marketing tasks.'))+'</div>'+
  '<label class="block text-xs font-bold">Evening Result Summary<textarea id="mktEveningNotes" rows="3" class="mt-2 w-full border rounded-xl p-3 text-sm" placeholder="Overall work completed and pending">'+h(summary)+'</textarea></label>'+
  btn(hasPM?'Update Summary Only':'Submit Summary Only','submitMarketingDaily(\'pm\')','gold')+'</section>':'';
 const evening=hasAM&&DATA.dailyReportVersion<2?legacyEvening:hasAM?'<section class="space-y-3 border-t pt-5">'+
  '<div class="flex flex-wrap justify-between items-center gap-2">'+
   '<div><h3 class="text-base font-bold">Evening Result</h3>'+
    '<p class="text-xs text-slate-500 mt-1">Report today\'s outcome and remark for each task planned this morning. Quick Update separately tracks overall task progress.</p></div>'+
   btn('+ Additional / Unplanned Work','openMarketingDailyUnplanned()')+'</div>'+
  '<div class="space-y-2">'+(plannedPM.length?dailySection(plannedPM,t=>dailyResultRow(t,values,false)):
    empty('No accessible Morning Plan tasks found.'))+'</div>'+
  (extraPM.length?'<div class="space-y-2"><h4 class="text-xs font-bold text-amber-900">Additional / Unplanned Work · '+extraPM.length+'</h4>'+
   dailySection(extraPM,t=>dailyResultRow(t,values,true))+'</div>':'')+
  '<label class="block text-xs font-bold">Evening Result Summary<textarea id="mktEveningNotes" rows="3" class="mt-2 w-full border rounded-xl p-3 text-sm" placeholder="Overall accomplishments, delays, and support needed">'+h(summary)+'</textarea></label>'+
  (DATA.dailyReportVersion<2?'<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">Your Marketing Google Apps Script requires a new deployment to save each task\'s Evening Result. Existing daily reports remain safe; ask Super Admin to redeploy the updated Marketing Code.gs.</div>':'')+
  '<div class="flex flex-wrap items-center gap-2">'+btn(hasPM?'Update Evening Result':'Submit Evening Result','submitMarketingDaily(\'pm\')','gold')+
    '<span class="text-xs text-slate-500">Every task must have a result status and a remark. Daily results do not bypass task approval.</span></div></section>':
  '<section class="rounded-xl border border-slate-200 bg-slate-50 p-4"><h3 class="text-base font-bold">Evening Result</h3>'+
   '<p class="text-xs text-slate-600 mt-1">Submit the Morning Plan first. Your Evening Result will then include the same tasks, with separate result statuses and remarks.</p></section>';
 frame('Daily Plan & Evening Result','Marketing task reporting · Linked to Content Calendar, with individual morning plans and evening outcomes.',
  (manager()?'<div class="flex gap-2">'+btn('My Daily Plan','marketingDailyView(\'My Daily\')','gold')+
   btn('Team Daily Review','marketingDailyView(\'Team Review\')')+'</div>':'')+
   statusBar+morning+evening+marketingWeekSummary(date));
}

const CALENDAR_BUSINESSES=[
 {id:'LPL',name:"L'Imperial Luxury"},
 {id:'LPH',name:'LP Home'}
];
function calendarBusiness(task){
 const value=String(task?.business||'').trim().toUpperCase();
 return value==='LPL'||value==='LPH'||value==='BOTH'?value:'';
}
function calendarPosts(){
 const month=DATA.month||today().slice(0,7);
 return tasks().filter(t=>/^\d{4}-\d{2}-\d{2}$/.test(formatDate(t.post_date))&&
  formatDate(t.post_date).slice(0,7)===month);
}
function monthLabel(month){
 const match=/^(\d{4})-(\d{2})$/.exec(month);
 if(!match)return month;
 const date=new Date(Date.UTC(Number(match[1]),Number(match[2])-1,1));
 return new Intl.DateTimeFormat('en-US',{month:'long',year:'numeric',timeZone:'UTC'}).format(date);
}
function calendarTaskRow(t,compact){
 const id=uid(t),date=formatDate(t.post_date);
 const desc='<div class="min-w-0"><div class="text-[10px] text-stone-500">'+h(date)+
  ' · '+h(t.platforms||'Platform not set')+
  (calendarBusiness(t)==='BOTH'?' · Both brands':'')+'</div>'+
  '<div class="text-sm font-bold text-stone-900 mt-1 break-words">'+h(t.title)+'</div>'+
  (!compact?'<div class="text-xs text-stone-500 mt-1">'+h(t.campaign||t.category||'Content')+' · '+h(ownerLabel(t))+
    (t.brand?' · '+h(t.brand):'')+'</div>':'')+'</div>';
 return '<article class="bg-white border border-stone-200 rounded-xl p-3 flex flex-wrap items-center justify-between gap-3">'+
  desc+'<div class="flex flex-wrap gap-2 items-center">'+badge(t.status)+
  (!compact?badge(t.approval_status):'')+
  btn('Details','openMarketingCalendarItem(\''+id+'\')')+
  '</div></article>';
}
function drawCalendar(){
 const month=DATA.month||today().slice(0,7),brand=DATA.calendarBrand,view=DATA.calendarView;
 const all=calendarPosts(),visible=all.filter(t=>calendarBusiness(t)===brand||calendarBusiness(t)==='BOTH')
   .sort((a,b)=>formatDate(a.post_date).localeCompare(formatDate(b.post_date))||
      String(a.title||'').localeCompare(String(b.title||'')));
 const unassigned=all.filter(t=>!calendarBusiness(t));
 const brandTabs='<div class="flex flex-wrap gap-2" role="tablist" aria-label="Content business">'+
  CALENDAR_BUSINESSES.map(b=>'<button type="button" role="tab" aria-selected="'+(brand===b.id)+
   '" onclick="marketingCalendarBrand(\''+b.id+'\')" class="px-4 py-2.5 rounded-xl border text-xs font-bold '+
   (brand===b.id?'bg-[#211d18] text-white border-[#211d18]':'bg-white text-stone-700 border-stone-200 hover:bg-stone-50')+'">'+
   h(b.name)+' <span class="opacity-70">('+all.filter(t=>calendarBusiness(t)===b.id||calendarBusiness(t)==='BOTH').length+')</span></button>').join('')+
  '</div>';
 const viewTabs='<div class="inline-flex rounded-xl border border-stone-200 p-1 bg-stone-50" role="tablist" aria-label="Content calendar view">'+
  [['list','List View'],['calendar','Calendar View']].map(([id,label])=>
    '<button type="button" role="tab" aria-selected="'+(id===view)+'" onclick="marketingCalendarView(\''+id+'\')" class="px-4 py-2 rounded-lg text-xs font-bold '+
    (id===view?'bg-[#211d18] text-white shadow-sm':'bg-transparent text-stone-600 hover:bg-white')+'">'+label+'</button>').join('')+
  '</div>';
 const toolbar='<div class="bg-white rounded-xl border p-3 space-y-3">'+
  '<div class="flex flex-wrap items-center justify-between gap-3">'+
   '<div class="flex flex-wrap items-center gap-2"><label class="text-xs font-semibold text-stone-600">Month '+
     '<input type="month" aria-label="Content publishing month" class="ml-1 border rounded-lg px-2 py-2" value="'+h(month)+'" onchange="marketingMonth(this.value)"></label>'+
     '<button type="button" onclick="marketingCalendarShift(-1)" class="rounded-lg border px-3 py-2 text-xs font-semibold" aria-label="Previous month">‹</button>'+
     '<button type="button" onclick="marketingCalendarShift(1)" class="rounded-lg border px-3 py-2 text-xs font-semibold" aria-label="Next month">›</button></div>'+
   btn('+ Schedule Content','marketingCalendarSchedule()','gold')+'</div>'+brandTabs+'</div>';
 const notice=unassigned.length?'<div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">'+
   unassigned.length+' scheduled task(s) do not yet have a business assigned. They are excluded from both brand tabs to avoid mixing content. '+
   (manager()?btn('Assign a business','openMarketingTask(\''+uid(unassigned[0])+'\')'):'Ask your Marketing Manager to assign their business.')+
   '</div>':'';
 const list='<div class="grid gap-2">'+(visible.length?visible.map(t=>calendarTaskRow(t,false)).join(''):
  empty('No content scheduled for '+CALENDAR_BUSINESSES.find(b=>b.id===brand).name+' in '+monthLabel(month)+'.'))+'</div>';
 let calendar='';
 if(view==='calendar'){
  const match=/^(\d{4})-(\d{2})$/.exec(month),year=Number(match?.[1]||today().slice(0,4)),m=Number(match?.[2]||today().slice(5,7));
  const offset=new Date(Date.UTC(year,m-1,1)).getUTCDay();
  const days=new Date(Date.UTC(year,m,0)).getUTCDate();
  const cells=Math.ceil((offset+days)/7)*7;
  const byDate=new Map();
  visible.forEach(t=>{const date=formatDate(t.post_date);if(!byDate.has(date))byDate.set(date,[]);byDate.get(date).push(t);});
  const weekdays=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  calendar='<div class="bg-white border border-stone-200 rounded-xl p-3">'+
   '<div class="flex items-center justify-between gap-2 mb-3"><b class="text-sm">'+h(monthLabel(month))+'</b>'+
    '<span class="text-xs text-stone-500">'+visible.length+' scheduled content item(s)</span></div>'+
   '<div class="overflow-x-auto"><div class="min-w-[700px]">'+
   '<div class="grid grid-cols-7 gap-1 mb-1">'+weekdays.map(x=>'<div class="text-center py-2 text-xs font-bold text-stone-500">'+x+'</div>').join('')+'</div>'+
   '<div class="grid grid-cols-7 gap-1">'+Array.from({length:cells},(_,i)=>{
    const day=i-offset+1;
    if(day<1||day>days)return '<div class="min-h-[106px] rounded-lg bg-stone-50 border border-stone-100"></div>';
    const date=month+'-'+String(day).padStart(2,'0'),entries=byDate.get(date)||[];
    return '<div class="min-h-[106px] rounded-lg border p-1.5 '+(date===today()?'border-amber-400 bg-amber-50':'border-stone-200')+'">'+
      '<button type="button" onclick="marketingCalendarDay(\''+date+'\')" class="w-full text-left text-xs font-bold hover:underline" aria-label="View content on '+date+'">'+day+
        (entries.length?'<span class="float-right rounded-full bg-stone-200 px-1.5 text-[10px]">'+entries.length+'</span>':'')+'</button>'+
      '<div class="space-y-1 mt-1">'+entries.slice(0,2).map(t=>
        '<button type="button" onclick="openMarketingCalendarItem(\''+uid(t)+'\')" title="'+h(t.title)+
        '" class="w-full text-left truncate rounded-md bg-amber-100 text-amber-950 px-1.5 py-1 text-[10px] font-semibold">'+h(t.title)+'</button>').join('')+
       (entries.length>2?'<button type="button" class="text-[10px] text-blue-700 font-bold" onclick="marketingCalendarDay(\''+date+'\')">+'+(entries.length-2)+' more</button>':'')+
      '</div></div>';
   }).join('')+'</div></div></div></div>';
 }
 frame('Content Calendar','Separate publishing schedules for L’Imperial Luxury and LP Home · Same content in list and monthly calendar.',
  toolbar+notice+'<div class="flex flex-wrap items-center justify-between gap-2">'+viewTabs+
  '<span class="text-xs text-stone-500">'+visible.length+' scheduled item(s) · '+h(monthLabel(month))+'</span></div>'+
  (view==='calendar'?calendar:list));
}
function calendarDetails(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!t||!own(t))return note('Content item not found or unavailable',true);
 const info=[['Business',calendarBusiness(t)==='LPL'?"L'Imperial Luxury":calendarBusiness(t)==='LPH'?'LP Home':calendarBusiness(t)==='BOTH'?'Both brands':'Unassigned'],
  ['Publishing date',t.post_date],['Platform(s)',t.platforms],['Assigned to',ownerLabel(t)],['Status',t.status],
  ['Approval',t.approval_status],['Campaign',t.campaign],['Product brand',t.brand],['Category',t.category],['Concept',t.concept]];
 const fields=info.filter(x=>x[1]).map(([label,val])=>'<div class="text-xs"><span class="text-stone-500">'+h(label)+': </span><b>'+h(val)+'</b></div>').join('');
 const link=(url,label)=>/^https:\/\//i.test(String(url||''))?'<a href="'+h(url)+'" target="_blank" rel="noopener noreferrer" class="text-blue-700 underline text-xs">'+h(label)+'</a>':'';
 openModal('Scheduled Content · '+t.title,
  '<div class="space-y-4"><div class="grid grid-cols-2 gap-2">'+fields+'</div>'+
  (t.description?'<div class="border rounded-xl p-3 text-xs whitespace-pre-wrap">'+h(t.description)+'</div>':'')+
  '<div class="flex flex-wrap gap-4">'+link(t.asset_url,'View artwork / Drive')+link(t.published_url,'Open published post')+'</div>'+
  '<div class="flex flex-wrap gap-2">'+btn('History','openMarketingHistory(\''+uid(t)+'\')')+
  btn('Progress','openMarketingProgress(\''+uid(t)+'\')')+
  (manager()?btn('Edit Content','openMarketingTask(\''+uid(t)+'\')','gold'):'')+
  '</div></div>');
}
function calendarDay(date){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(String(date||'')))return;
 const matches=calendarPosts().filter(t=>formatDate(t.post_date)===date&&
  (calendarBusiness(t)===DATA.calendarBrand||calendarBusiness(t)==='BOTH'));
 openModal('Scheduled Content · '+date,'<div class="space-y-2">'+
  (matches.length?matches.map(t=>calendarTaskRow(t,true)).join(''):empty('No content scheduled on this date.'))+
  '<div class="pt-2">'+btn('+ Schedule Content','marketingCalendarSchedule(\''+date+'\')','gold')+'</div></div>');
}
function calendarShift(delta){
 const month=DATA.month||today().slice(0,7),match=/^(\d{4})-(\d{2})$/.exec(month);
 if(!match||!Number.isInteger(delta)||Math.abs(delta)!==1)return;
 const d=new Date(Date.UTC(Number(match[1]),Number(match[2])-1+delta,1));
 DATA.month=d.getUTCFullYear()+'-'+String(d.getUTCMonth()+1).padStart(2,'0');
 drawCalendar();
}
function calendarSchedule(date){
 DATA.calendarDraftDate=/^\d{4}-\d{2}-\d{2}$/.test(String(date||''))?date:'';
 openTask();
}

function drawCampaigns(){
 const groups=new Map();
 tasks().forEach(t=>{const name=t.campaign||'Unassigned / General Work';if(!groups.has(name))groups.set(name,[]);groups.get(name).push(t);});
 frame('Campaigns & Projects','Tasks for the same promotion are grouped automatically under one campaign.',
 '<div class="grid md:grid-cols-2 gap-3">'+(groups.size?Array.from(groups).map(([name,ts])=>{
 const done=ts.filter(t=>t.status==='Completed'||t.status==='Published').length;
 return '<div class="bg-white border rounded-xl p-4 space-y-3"><b>'+h(name)+'</b><div class="text-xs text-stone-500">'+ts.length+' tasks · '+done+' delivered · '+ts.filter(due).length+' overdue</div>'+
 '<div class="h-2 bg-stone-100 rounded-full overflow-hidden"><div class="h-full bg-amber-600" style="width:'+(100*done/Math.max(1,ts.length))+'%"></div></div>'+
 '<div class="text-xs space-y-1">'+ts.slice(0,7).map(t=>'<div>• '+h(t.title)+' — '+h(t.status)+'</div>').join('')+'</div></div>';
 }).join(''):empty('No campaigns yet. Add a Campaign name when creating a task.'))+'</div>');
}
function drawReviews(){
 if(!manager())return changeTab('Overview');
 const queue=tasks().filter(t=>t.approval_status==='Pending'||t.approval_status==='Changes Requested');
 frame('Review & Approval','Final artwork approvals and revision requests preserve task history.',
 '<div class="grid md:grid-cols-2 gap-3">'+(queue.length?queue.map(taskCard).join(''):empty('No pending design or content reviews.'))+'</div>');
}
function drawReports(){
 if(!manager())return changeTab('Overview');
 const all=tasks(),closed=all.filter(t=>['Completed','Published'].includes(t.status)),posted=all.filter(t=>t.status==='Published');
 const names=Array.from(new Set(all.map(t=>ownerLabel(t))));
 const rows=names.map(n=>{const ts=all.filter(t=>ownerLabel(t)===n);
 return '<tr class="border-b"><td class="px-3 py-2">'+h(n)+'</td><td class="px-3 py-2 text-center">'+ts.length+'</td>'+
 '<td class="px-3 py-2 text-center">'+ts.filter(t=>['Completed','Published'].includes(t.status)).length+'</td>'+
 '<td class="px-3 py-2 text-center">'+ts.filter(due).length+'</td><td class="px-3 py-2 text-center">'+ts.filter(t=>t.status==='Published').length+'</td></tr>';}).join('');
 frame('Marketing Performance','Production and publishing performance for the authorized Marketing team.',
 '<div class="grid grid-cols-2 md:grid-cols-4 gap-3">'+
 ['Assigned '+all.length,'Completed '+closed.length,'Published '+posted.length,'Overdue '+all.filter(due).length]
 .map(x=>'<div class="bg-white border rounded-xl p-4 font-bold">'+h(x)+'</div>').join('')+'</div>'+
 '<div class="overflow-auto bg-white rounded-xl border"><table class="w-full text-sm"><thead><tr class="bg-stone-50 text-stone-500 text-xs"><th class="text-left px-3 py-2">Staff</th><th>Tasks</th><th>Done</th><th>Overdue</th><th>Posted</th></tr></thead><tbody>'+rows+'</tbody></table></div>');
}
function selectedTasks(){
 return Array.from(document.querySelectorAll('.mkt-daily-task:checked')).map(e=>e.value).filter(safeId);
}
async function submitDaily(phase){
 if(!DATA.ready)return;
 const date=DATA.date||today(),day=DATA.daily.find(r=>String(r.user_id)===me()&&formatDate(r.work_date)===date);
 try{
  if(phase==='am'){
   const ids=selectedTasks();
   if(!ids.length)return note('Choose at least one task for the Morning Plan.',true);
   await api('daily_save',{date,phase,task_ids:ids});
   DATA.dailyDraftIds=[];
   note('Morning Plan submitted with '+ids.length+' linked Marketing tasks');
  }else if(phase==='pm'){
   if(!day?.am_submitted_at)return note('Submit your Morning Plan first.',true);
   if(DATA.dailyReportVersion<2){
    const planned=dailyParsed(day.plan_json,[]);
    const summary=document.getElementById('mktEveningNotes')?.value.trim()||'';
    if(!summary)return note('Enter the overall Evening Result Summary.',true);
    await api('daily_save',{date,phase,task_ids:Array.isArray(planned)?planned:[],note:summary});
    note('Summary-only Evening Result saved. Redeploy the Marketing Apps Script to enable individual task remarks.');
    await fetchMarketing();
    return;
   }
   if(!day?.am_submitted_at)return note('Submit your Morning Plan first.',true);
   const planned=dailyParsed(day.plan_json,[]);
   const rows=Array.from(document.querySelectorAll('.mkt-daily-result-row'));
   const results=rows.map(row=>({
    id:safeId(row.dataset.taskId),
    status:row.querySelector('.mkt-daily-result-status')?.value||'',
    note:row.querySelector('.mkt-daily-result-note')?.value.trim()||''
   }));
   const ids=results.map(x=>x.id);
   if(!results.length||results.some(x=>!x.id||!DAILY_RESULT_STATUSES.includes(x.status)||!x.note))
    return note('Select a result status and enter a remark for every Marketing task.',true);
   if(new Set(ids).size!==ids.length||!planned.every(id=>ids.includes(id)))
    return note('Every Morning Plan task must have one Evening Result.',true);
   const summary=document.getElementById('mktEveningNotes')?.value.trim()||'';
   if(!summary)return note('Enter the overall Evening Result Summary.',true);
   await api('daily_save',{date,phase,task_ids:ids,task_results:results,report_version:2,note:summary});
   DATA.dailyUnplannedIds=[];
   note('Evening Result saved for '+results.length+' linked tasks');
  }else return;
  await fetchMarketing();
 }catch(e){note(e.message,true);}
}

function taskForm(t){
 const val=k=>h((t&&t[k])||(k==='post_date'&&!t?DATA.calendarDraftDate:'')||'');
 const sel=(name,items,selected)=>'<label class="block text-xs font-semibold">'+h(name)+'<select name="'+h(name)+'" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm">'+opts(items,selected)+'</select></label>';
 const input=(name,label,type='text',placeholder='')=>'<label class="block text-xs font-semibold">'+h(label)+'<input name="'+h(name)+'" type="'+type+'" value="'+val(name)+'" placeholder="'+h(placeholder)+'" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"></label>';
 const currentId=t?uid(t):'';
 const calendarContext=DATA.tab==='Content Calendar'&&!t;
 const defaultBusiness=calendarContext?DATA.calendarBrand:'';
 const people=DATA.staff.filter(s=>s.role==='marketing'||s.role==='marketing_manager');
 return '<form id="marketingTaskForm" onsubmit="saveMarketingTask(event)" class="space-y-3">'+
 '<input type="hidden" name="id" value="'+h(currentId)+'">'+
 input('title','Task / deliverable title','text','e.g. Asfour Chandelier Poster')+
 '<label class="block text-xs font-semibold">Description / brief<textarea name="description" rows="3" class="mt-1 block w-full border rounded-lg p-2 text-sm">'+val('description')+'</textarea></label>'+
 '<div class="grid grid-cols-2 gap-3">'+
 sel('business',['','LPH','LPL','BOTH','OTHER'],t?.business||defaultBusiness)+
 sel('priority',['Low','Medium','High','Urgent'],t?.priority||'Medium')+
 input('brand','Brand')+sel('category',[''].concat(categories),t?.category||'')+
 input('campaign','Project / campaign')+input('concept','Concept')+
 input('start_date','Start date','date')+input('due_date','Task deadline','date')+
 (calendarContext?'<label class="block text-xs font-semibold">Publishing date<input name="post_date" type="date" required value="'+val('post_date')+'" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"></label>':input('post_date','Publishing date','date'))+input('platforms','Platforms','text','Facebook, Instagram, Telegram')+
 '</div>'+
 (manager()?'<label class="block text-xs font-semibold">Assign Marketing staff<select name="assignee_id" class="mt-1 block w-full border rounded-lg p-2 text-sm">'+
 '<option value="">Unassigned</option>'+people.map(s=>'<option value="'+h(s.id)+'" '+(s.id===t?.assignee_id?'selected':'')+'>'+h(s.name)+'</option>').join('')+'</select></label>':'')+
 input('asset_url','Artwork / Google Drive file URL','url')+
 '<div class="flex gap-2 justify-end">'+btn('Cancel','closeModal()')+'<button class="rounded-lg px-4 py-2 text-xs font-bold bg-[#211d18] text-white">Save Task</button></div></form>';
}
function openTask(id){
 const t=id?DATA.tasks.find(x=>x.id===safeId(id)):null;
 if(id&&!t)return note('Task not found',true);
 if(t&&!own(t))return note('Permission denied',true);
 if(t&&!manager())return note('Use Progress to update your assigned task',true);
 openModal(t?'Edit Marketing Task':'Create Marketing Task',taskForm(t));
 DATA.calendarDraftDate='';
}
async function saveTask(e){
 e.preventDefault();
 const f=e.target,t=Object.fromEntries(new FormData(f).entries());
 const staff=DATA.staff.find(s=>s.id===t.assignee_id);
 t.assignee_name=staff?.name||'';
 try{await api('save_task',{task:t});closeModal();note('Marketing task saved');await fetchMarketing();}
 catch(err){note(err.message,true);}
}

function openProgress(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!own(t))return note('Task is not available',true);
 const n=Math.max(0,Math.min(100,Number(t.progress)||0));
 openModal('Quick Update · '+h(t.title),
  '<form onsubmit="saveMarketingProgress(event,\''+uid(t)+'\')" class="space-y-4">'+
   '<p class="text-xs text-slate-500">Update status and progress without reopening task details. Every change goes into the task history.</p>'+
   '<label class="block text-xs font-bold">Status<select id="mktProgressStatus" onchange="marketingQuickStatus(this.value)" class="block mt-2 w-full border rounded-xl p-3 text-sm bg-white">'+
    opts(statuses,t.status)+'</select></label>'+
   '<div><label class="block text-sm font-semibold">Progress: <span id="mktProgressLabel">'+n+'</span>%</label>'+
    '<input id="mktProgressPct" type="range" min="0" max="100" step="5" value="'+n+'" oninput="document.getElementById(\'mktProgressLabel\').textContent=this.value" class="block w-full mt-3 accent-amber-700" aria-label="Task progress percentage">'+
    '<div class="flex flex-wrap gap-2 mt-3">'+[0,25,50,75,100].map(x=>
     btn(x+'%','marketingQuickPercent('+x+')')).join('')+'</div></div>'+
   '<label class="block text-xs font-semibold">Progress Note / Blocked Reason<textarea id="mktProgressNote" rows="3" class="mt-2 block w-full border rounded-xl p-3 text-sm" placeholder="What changed since your previous update?"></textarea></label>'+
   '<p class="text-xs text-slate-500">Completing or submitting work for review sends it to Marketing approval; published posts still require approval.</p>'+
   '<div class="flex flex-wrap gap-2"><button class="bg-[#211d18] text-white rounded-xl px-5 py-2.5 text-sm font-semibold">Save Progress</button>'+
    btn('Cancel','closeModal()')+'</div>'+
  '</form>');
}
async function saveProgress(e,id){
 e.preventDefault();
 const progress=Number(document.getElementById('mktProgressPct')?.value||0);
 const status=document.getElementById('mktProgressStatus')?.value||'In Progress';
 const remark=document.getElementById('mktProgressNote')?.value.trim()||'';
 if(status==='Blocked'&&!remark)return note('Enter a reason when marking a task Blocked',true);
 if(status==='Cancelled'&&!remark)return note('Enter a reason when cancelling a task',true);
 try{
  await api('update_task',{id,status,progress,note:remark});
  closeModal();
  note('Marketing task progress and history saved');
  await fetchMarketing();
 }catch(err){note(err.message,true);}
}
function marketingDateTime(v){
 try{return new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Phnom_Penh',day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}).format(new Date(v));}
 catch(_){return String(v||'');}
}
function marketingSnapshot(value){
 if(!value)return null;
 try{const result=JSON.parse(value);return result&&typeof result==='object'?result:null;}catch(_){return null;}
}
function marketingHistoryChange(e){
 const before=marketingSnapshot(e.before_json),after=marketingSnapshot(e.after_json);
 if(!before||!after)return [];
 const fields=[['title','Task title'],['description','Description'],['status','Status'],['progress','Progress'],
  ['start_date','Start date'],['due_date','Deadline'],['post_date','Posting date'],['priority','Priority'],
  ['assignee_name','Assignee'],['campaign','Campaign'],['brand','Brand'],['approval_status','Review status']];
 return fields.filter(x=>String(before[x[0]]??'')!==String(after[x[0]]??'')).map(x=>({
   label:x[1],before:String(before[x[0]]??'Not set'),after:String(after[x[0]]??'Not set'),field:x[0]
 }));
}
async function openHistory(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!own(t))return;
 openModal('Task Revision & Progress History',
   '<div id="mktHistory" class="space-y-3 text-sm text-slate-500">Retrieving verified changes from the Marketing Activity Log…</div>');
 try{
  const events=await api('history',{id});
  const target=document.getElementById('mktHistory');
  if(!target)return;
  const updates=events.filter(x=>x.event_type!=='task_created');
  const revisionCount=updates.filter(x=>marketingHistoryChange(x).some(c=>['start_date','due_date','description'].includes(c.field))).length;
  const progressCount=updates.filter(x=>marketingHistoryChange(x).some(c=>c.field==='progress')).length;
  const meter=(text,value)=>'<div class="border rounded-xl p-3"><span class="text-[10px] text-slate-500">'+text+'</span><b class="block text-xl">'+value+'</b></div>';
  target.innerHTML='<div class="space-y-4 max-h-[70vh] overflow-y-auto">'+
   '<div><b class="block text-sm text-slate-900">'+h(t.title)+'</b><p class="text-xs text-slate-500 mt-1">Original updates, changes and review decisions · Phnom Penh time</p></div>'+
   '<div class="grid grid-cols-3 gap-2">'+meter('Saved updates',updates.length)+meter('Progress changes',progressCount)+meter('Task revisions',revisionCount)+'</div>'+
   '<div class="space-y-2 border-t pt-3">'+(events.length?events.map(e=>{
    const changes=marketingHistoryChange(e);
    return '<article class="border-l-[3px] border-slate-200 pl-3 py-2">'+
     '<div class="flex flex-wrap items-center justify-between gap-2"><b class="text-sm text-slate-900">'+h(marketingDateTime(e.created_at))+'</b>'+
     badge(String(e.event_type||'update').replaceAll('_',' '),'bg-slate-100 text-slate-700')+'</div>'+
     '<p class="text-xs text-slate-500 mt-1">By '+h(e.actor_name||'Unknown')+'</p>'+
     (changes.length?'<div class="mt-2 divide-y">'+changes.map(c=>
      '<div class="grid sm:grid-cols-[110px_1fr] gap-1 py-2 text-xs"><b>'+h(c.label)+'</b><div class="break-words">'+
      '<span class="text-slate-500 line-through">'+h(c.before.slice(0,200))+'</span> <span class="text-slate-400">→</span> '+
      '<span class="font-semibold text-slate-900">'+h(c.after.slice(0,200))+'</span></div></div>').join('')+'</div>':'')+
     (e.notes?'<div class="text-xs rounded-lg bg-slate-50 p-2 mt-2"><b>Note: </b>'+h(e.notes)+'</div>':'')+'</article>';
   }).join(''):empty('No task changes recorded yet.'))+'</div></div>';
 }catch(err){const target=document.getElementById('mktHistory');if(target)target.textContent=err.message;}
}

function openReview(id){
 if(!manager())return;
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!t)return;
 openModal('Review — '+t.title,
 '<div class="space-y-3"><p class="text-sm">Approve the final deliverable or request revisions. Every decision is saved in task history.</p>'+
 '<textarea id="mktReviewNote" class="border rounded-lg p-3 w-full text-sm" rows="3" placeholder="Manager feedback / revision instructions"></textarea>'+
 '<div class="flex flex-wrap gap-2">'+btn('Request Changes','decideMarketingReview(\''+id+'\',\'Changes Requested\')')+
 btn('Approve','decideMarketingReview(\''+id+'\',\'Approved\')','gold')+'</div></div>');
}
async function decideReview(id,decision){
 try{await api('review_task',{id,decision,note:document.getElementById('mktReviewNote')?.value||''});closeModal();note('Review decision saved');await fetchMarketing();}
 catch(err){note(err.message,true);}
}
function openPublish(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));if(!own(t))return;
 openModal('Publish — '+t.title,'<form onsubmit="saveMarketingPublish(event,\''+id+'\')" class="space-y-3">'+
 '<p class="text-sm text-stone-600">Paste the final live post URL. Approval is required before publishing.</p>'+
 '<input id="mktPublishUrl" required type="url" placeholder="https://..." class="w-full border rounded-lg p-2 text-sm">'+
 '<button class="bg-[#211d18] text-white rounded-lg px-4 py-2 text-sm">Record Published Post</button></form>');
}
async function publish(e,id){
 e.preventDefault();
 try{await api('publish_task',{id,url:document.getElementById('mktPublishUrl').value});closeModal();note('Post published and recorded');await fetchMarketing();}
 catch(err){note(err.message,true);}
}
function openSetup(){
 if(!superAdmin())return;
 openModal('Marketing Google Sheet Connection',
 '<div class="space-y-3 text-sm"><p>The master Marketing workbook is prepared. Deploy <b>google-apps-script/marketing-management/Code.gs</b> as a new bound Google Apps Script Web App, running as the owner. Keep the Sheet private.</p>'+
 '<a target="_blank" rel="noopener noreferrer" class="text-blue-700 underline" href="https://docs.google.com/spreadsheets/d/1Id6HglSoa_iAIIz0HLm_s6zSsnKwmLI_SoqeQSEG9RA/edit">Open Marketing Master Sheet</a>'+
 '<p>Required Script Properties: <b>MARKETING_SHEET_ID, SUPABASE_URL, SUPABASE_ANON_KEY</b>. After the Apps Script Web App has been deployed, paste its /exec URL here.</p>'+
 '<form onsubmit="saveMarketingSetup(event)" class="space-y-2"><label class="block text-xs font-semibold">Google Apps Script Web App URL<input id="mktScriptUrl" type="url" required placeholder="https://script.google.com/macros/s/.../exec" class="mt-1 w-full border rounded-lg p-2"></label>'+
 '<button class="rounded-lg bg-[#211d18] text-white px-4 py-2 text-sm">Save Connection</button></form></div>');
}
async function saveSetup(e){
 e.preventDefault();
 try{const r=await db.rpc('set_marketing_google_connection',{p_url:document.getElementById('mktScriptUrl').value.trim()});if(r.error)throw r.error;closeModal();note('Connection saved');await fetchMarketing();}
 catch(err){note(err.message,true);}
}
const oldNav=window.navItems;
window.navItems=function(){
 const current=oldNav.apply(this,arguments)||[];
 if(marketingRole())return [[PAGE,'Marketing','✦']];
 if(['admin','super_admin'].includes(role()))return current.concat([[PAGE,'Marketing','✦']]);
 return current;
};
const oldGo=window.go;
window.go=async function(page){
 if(marketingRole()&&page!==PAGE)page=PAGE;
 if(page===PAGE){
  if(!canEnter())return note('Marketing Department only',true);
  state.page=PAGE;
  renderNav();
  document.getElementById('pageTitle').textContent='Marketing Management';
  document.getElementById('pageSubtitle').textContent='Daily Plan · To-Do · Content Calendar · Reviews';
  root().innerHTML='<div class="p-8 text-center text-stone-500">Opening Marketing Department…</div>';
  await fetchMarketing();
  return;
 }
 return oldGo.apply(this,arguments);
};
window.marketingTab=changeTab;
window.refreshMarketing=fetchMarketing;
window.marketingFilter=function(s){const pos=document.getElementById('mktFilter')?.selectionStart||s.length;DATA.filter=s;drawTodo();const el=document.getElementById('mktFilter');if(el){el.focus();el.setSelectionRange(pos,pos);}};
window.marketingDate=function(v){DATA.date=v;DATA.dailyDraftIds=[];DATA.dailyUnplannedIds=[];drawDaily();};
window.marketingTodoSetStatus=function(v){DATA.todoStatus=v;drawTodo();};
window.marketingTodoSetPriority=function(v){DATA.todoPriority=v;drawTodo();};
window.marketingTodoSetSort=function(v){DATA.todoSort=v;drawTodo();};
window.marketingDailyView=function(v){if(v==='Team Review'&&!manager())return;DATA.dailyView=v;drawDaily();};
window.marketingDailyDraftToggle=function(id,checked){
 id=safeId(id);
 if(!id)return;
 DATA.dailyDraftIds=checked?Array.from(new Set(DATA.dailyDraftIds.concat([id]))):DATA.dailyDraftIds.filter(x=>x!==id);
};
window.openMarketingDailyCalendarSelector=openDailyCalendarSelector;
window.marketingDailyAddCalendarTask=dailyAddCalendarTask;
window.marketingDailyOpenCalendar=dailyOpenCalendar;
window.openMarketingDailyUnplanned=dailyAddUnplanned;
window.marketingDailyAttachUnplanned=dailyAttachUnplanned;
window.marketingQuickPercent=function(v){
 const el=document.getElementById('mktProgressPct'),label=document.getElementById('mktProgressLabel');
 if(el)el.value=v;
 if(label)label.textContent=v;
};
window.marketingQuickStatus=function(v){if(v==='Completed')window.marketingQuickPercent(100);};
window.addMarketingTodoToDaily=function(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!t||!marketingOwnDaily(t))return note('Select one of your own Marketing tasks',true);
 const date=DATA.date||today();
 const current=DATA.daily.find(r=>r.user_id===me()&&formatDate(r.work_date)===date);
 if(current?.am_submitted_at){
  DATA.tab='Daily Plan & Result';DATA.dailyView='My Daily';draw();
  return note('Morning Plan already submitted. Use Quick Update in Evening Result.',true);
 }
 DATA.dailyDraftIds=Array.from(new Set(DATA.dailyDraftIds.concat([t.id])));
 DATA.tab='Daily Plan & Result';DATA.dailyView='My Daily';draw();
 note('Task selected for today’s Morning Plan. Submit to save.');
};
window.carryMarketingUnfinished=function(){
 const date=DATA.date||today();
 const previous=DATA.daily.filter(r=>r.user_id===me()&&formatDate(r.work_date)<date&&r.am_submitted_at)
   .sort((a,b)=>formatDate(b.work_date).localeCompare(formatDate(a.work_date)))[0];
 if(!previous)return note('No earlier submitted Morning Plan to carry forward',true);
 let ids=[];
 try{ids=JSON.parse(previous.plan_json||'[]');if(!Array.isArray(ids))ids=[];}catch(_){}
 const carrying=ids.filter(id=>{
  const t=DATA.tasks.find(x=>x.id===id);
  return t&&marketingOwnDaily(t)&&!marketingClosed(t);
 });
 if(!carrying.length)return note('No unfinished tasks found in your last Morning Plan',true);
 DATA.dailyDraftIds=Array.from(new Set(DATA.dailyDraftIds.concat(carrying)));
 drawDaily();
 note(carrying.length+' unfinished task(s) selected. Submit the Morning Plan to save.');
};
window.marketingMonth=function(v){if(!/^d{4}-d{2}$/.test(String(v||'')))return;DATA.month=v;drawCalendar();};
window.marketingCalendarBrand=function(v){if(!CALENDAR_BUSINESSES.some(b=>b.id===v))return;DATA.calendarBrand=v;drawCalendar();};
window.marketingCalendarView=function(v){if(v!=='list'&&v!=='calendar')return;DATA.calendarView=v;drawCalendar();};
window.marketingCalendarShift=calendarShift;
window.marketingCalendarDay=calendarDay;
window.marketingCalendarSchedule=calendarSchedule;
window.openMarketingCalendarItem=calendarDetails;
window.openMarketingTask=openTask;
window.saveMarketingTask=saveTask;
window.openMarketingProgress=openProgress;
window.saveMarketingProgress=saveProgress;
window.openMarketingHistory=openHistory;
window.openMarketingReview=openReview;
window.decideMarketingReview=decideReview;
window.openMarketingPublish=openPublish;
window.saveMarketingPublish=publish;
window.submitMarketingDaily=submitDaily;
window.openMarketingSetup=openSetup;
window.saveMarketingSetup=saveSetup;
})();
