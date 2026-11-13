/* Marketing Department workspace — independent from Sales and Stock.
   Google Sheets stores every task, daily entry and revision via authenticated Edge relay. */
(function(){
'use strict';
const PAGE='marketing';
const TABS=['Overview','Daily Plan & Result','My To-Do','Content Calendar','Campaigns','Reviews','Reports'];
const DATA={tab:'Overview',tasks:[],daily:[],staff:[],date:'',month:'',filter:'',brand:'all',ready:false,config:false,loading:false};
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
function drawTodo(){
 const all=tasks(),filter=DATA.filter.toLowerCase();
 const filtered=all.filter(t=>!filter||[t.title,t.description,t.brand,t.campaign,t.assignee_name].some(x=>String(x||'').toLowerCase().includes(filter)));
 const sorted=filtered.sort((a,b)=>Number(due(b))-Number(due(a))||formatDate(a.due_date||'9999').localeCompare(formatDate(b.due_date||'9999')));
 frame('My To-Do','Each task stays one record, even when work continues across several days.',
 '<div class="bg-white border rounded-xl p-3 flex flex-wrap gap-2 items-center"><input id="mktFilter" placeholder="Search tasks, campaign or brand" value="'+h(DATA.filter)+'" oninput="marketingFilter(this.value)" class="flex-1 min-w-[190px] border rounded-lg px-3 py-2 text-sm">'+
 '<span class="text-xs text-stone-500">'+sorted.length+' task(s)</span></div>'+
 '<div class="grid md:grid-cols-2 gap-3">'+(sorted.length?sorted.map(taskCard).join(''):empty('No matching tasks.'))+'</div>');
}
function drawDaily(){
 const date=DATA.date||today();
 const day=DATA.daily.find(r=>String(r.user_id)===me()&&formatDate(r.work_date)===date);
 let planned=[];
 try{planned=JSON.parse(day&&day.plan_json||'[]');if(!Array.isArray(planned))planned=[];}catch(_){}
 const selected=planned.length?planned:[];
 const ownTasks=DATA.tasks.filter(t=>t.assignee_id===me()||(t.created_by===me()&&!t.assignee_id));
 const box=ownTasks.map(t=>'<label class="flex gap-3 items-start px-3 py-2 border-b last:border-0 text-sm"><input type="checkbox" class="mkt-daily-task mt-1" value="'+h(uid(t))+'" '+(selected.includes(t.id)?'checked':'')+'><span><b>'+h(t.title)+'</b><small class="block text-stone-500">'+h(t.business||'')+' · '+h(t.status)+' · '+h(t.progress||0)+'%</small></span></label>').join('');
 const hasAM=!!day?.am_submitted_at;
 let summary='';try{summary=JSON.parse(day?.result_json||'{}').note||'';}catch(_){}
 frame('Daily Plan & Evening Result','Choose existing tasks — updating the same task never duplicates it.',
 '<div class="bg-white border rounded-2xl p-4 space-y-3">'+
 '<div class="flex justify-between flex-wrap items-center gap-3"><label class="text-sm font-bold">Work date <input type="date" value="'+h(date)+'" onchange="marketingDate(this.value)" class="ml-2 border rounded-lg px-2 py-2 text-sm"></label>'+
 badge(hasAM?'Morning submitted':'Morning not submitted',hasAM?'bg-green-50 text-green-700':'bg-amber-50 text-amber-700')+
 badge(day?.pm_submitted_at?'Evening submitted':'Evening pending')+'</div>'+
 '<p class="text-xs text-stone-500">Select tasks planned for today. Leave the task in progress when work takes multiple days; use Progress to record status and work notes.</p>'+
 '<div class="border rounded-xl max-h-[300px] overflow-y-auto">'+(box||empty('Create or assign a task to start your Daily Plan.'))+'</div>'+
 (!hasAM?btn('Submit Morning Plan','submitMarketingDaily(\'am\')','gold'):'<p class="text-xs text-green-700">Morning Plan locked; edit progress through your existing To-Do tasks.</p>')+
 '<label class="block text-sm font-semibold">Evening result summary<textarea id="mktEveningNotes" rows="3" placeholder="What did you finish? What is still pending?" class="mt-1 block w-full border rounded-lg p-3 text-sm">'+h(summary)+'</textarea></label>'+
 btn(day?.pm_submitted_at?'Update Evening Result':'Submit Evening Result','submitMarketingDaily(\'pm\')','gold')+
 '</div>');
}
function drawCalendar(){
 const month=DATA.month||today().slice(0,7),all=tasks().filter(t=>formatDate(t.post_date).startsWith(month)).sort((a,b)=>formatDate(a.post_date).localeCompare(formatDate(b.post_date)));
 frame('Content Calendar','One publishing schedule for LPL and LPH, linked to production and approval.',
 '<div class="flex flex-wrap gap-3 items-center bg-white rounded-xl border p-3"><label class="text-xs font-semibold">Month <input type="month" class="ml-2 border rounded-lg p-2" value="'+h(month)+'" onchange="marketingMonth(this.value)"></label>'+
 btn('+ Schedule Content','openMarketingTask()','gold')+'</div>'+
 '<div class="grid gap-2">'+(all.length?all.map(t=>
 '<div class="bg-white rounded-xl border p-3 flex flex-wrap items-center justify-between gap-2"><div>'+
 '<div class="text-xs text-stone-500">'+h(t.post_date)+' · '+h(t.business||'Other')+' · '+h(t.platforms||'Not assigned')+'</div>'+
 '<b class="text-sm">'+h(t.title)+'</b><p class="text-xs text-stone-500">'+h(t.brand||'')+' · '+h(ownerLabel(t))+'</p></div>'+
 '<div class="flex flex-wrap items-center gap-2">'+badge(t.status)+badge(t.approval_status)+btn('Details','openMarketingHistory(\''+uid(t)+'\')')+'</div></div>').join(''):empty('No scheduled posts for this month.'))+'</div>');
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
 const date=DATA.date||today(),ids=selectedTasks(),notes=document.getElementById('mktEveningNotes')?.value||'';
 try{
  await api('daily_save',{date,phase,task_ids:ids,note:notes});
  note(phase==='am'?'Morning Plan submitted':'Evening Result saved');
  await fetchMarketing();
 }catch(e){note(e.message,true);}
}
function taskForm(t){
 const val=k=>h(t&&t[k]||'');
 const sel=(name,items,selected)=>'<label class="block text-xs font-semibold">'+h(name)+'<select name="'+h(name)+'" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm">'+opts(items,selected)+'</select></label>';
 const input=(name,label,type='text',placeholder='')=>'<label class="block text-xs font-semibold">'+h(label)+'<input name="'+h(name)+'" type="'+type+'" value="'+val(name)+'" placeholder="'+h(placeholder)+'" class="mt-1 block w-full border rounded-lg px-3 py-2 text-sm"></label>';
 const currentId=t?uid(t):'';
 const people=DATA.staff.filter(s=>s.role==='marketing'||s.role==='marketing_manager');
 return '<form id="marketingTaskForm" onsubmit="saveMarketingTask(event)" class="space-y-3">'+
 '<input type="hidden" name="id" value="'+h(currentId)+'">'+
 input('title','Task / deliverable title','text','e.g. Asfour Chandelier Poster')+
 '<label class="block text-xs font-semibold">Description / brief<textarea name="description" rows="3" class="mt-1 block w-full border rounded-lg p-2 text-sm">'+val('description')+'</textarea></label>'+
 '<div class="grid grid-cols-2 gap-3">'+
 sel('business',['','LPH','LPL','BOTH','OTHER'],t?.business||'')+
 sel('priority',['Low','Medium','High','Urgent'],t?.priority||'Medium')+
 input('brand','Brand')+sel('category',[''].concat(categories),t?.category||'')+
 input('campaign','Project / campaign')+input('concept','Concept')+
 input('start_date','Start date','date')+input('due_date','Task deadline','date')+
 input('post_date','Publishing date','date')+input('platforms','Platforms','text','Facebook, Instagram, Telegram')+
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
 openModal('Update task progress',
 '<form onsubmit="saveMarketingProgress(event,\''+uid(t)+'\')" class="space-y-3">'+
 '<b class="text-sm">'+h(t.title)+'</b>'+
 '<label class="block text-xs font-semibold">Status<select id="mktProgressStatus" class="mt-1 w-full border rounded-lg p-2">'+opts(statuses,t.status)+'</select></label>'+
 '<label class="block text-xs font-semibold">Progress %<input id="mktProgressPct" type="number" min="0" max="100" value="'+h(t.progress||0)+'" class="mt-1 w-full border rounded-lg p-2"></label>'+
 '<label class="block text-xs font-semibold">What changed today?<textarea id="mktProgressNote" rows="3" class="mt-1 w-full border rounded-lg p-2" placeholder="Describe work completed or any blocker"></textarea></label>'+
 '<button class="rounded-lg px-4 py-2 bg-[#211d18] text-white text-sm">Save Progress</button></form>');
}
async function saveProgress(e,id){
 e.preventDefault();
 const p={id,status:document.getElementById('mktProgressStatus').value,progress:Number(document.getElementById('mktProgressPct').value),note:document.getElementById('mktProgressNote').value};
 try{await api('update_task',p);closeModal();note('Progress recorded in task history');await fetchMarketing();}
 catch(err){note(err.message,true);}
}
async function openHistory(id){
 const t=DATA.tasks.find(x=>x.id===safeId(id));
 if(!own(t))return;
 openModal('Task history — '+t.title,'<div id="mktHistory">Loading history…</div>');
 try{
 const events=await api('history',{id});
 document.getElementById('mktHistory').innerHTML=events.length?events.map(x=>
 '<div class="border-b p-3 text-sm"><b>'+h(x.event_type)+'</b> <span class="text-xs text-stone-500">'+h(x.created_at)+'</span>'+
 '<p class="text-xs">'+h(x.actor_name)+'</p>'+ (x.notes?'<p class="mt-1">'+h(x.notes)+'</p>':'')+'</div>').join(''):empty('No history yet.');
 }catch(err){document.getElementById('mktHistory').textContent=err.message;}
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
window.marketingDate=function(v){DATA.date=v;drawDaily();};
window.marketingMonth=function(v){DATA.month=v;drawCalendar();};
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
