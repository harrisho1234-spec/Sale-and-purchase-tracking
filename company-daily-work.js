/* L'Imperial Company Daily Work: shared work tracker alongside legacy Sales
 * Daily and Marketing calendars. Every read/write is server-authorized. */
(function(){
'use strict';
const PAGE='company-daily';
const authorizedRoles=new Set(['sales','manager','marketing','marketing_manager','stock_controller','stock_manager','project','project_manager','product_assistant','product_manager','admin','super_admin']);
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=()=>document.getElementById('content');
const today=()=>{const dt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return /^\d{4}-\d{2}-\d{2}$/.test(dt)?dt:new Date().toISOString().slice(0,10)};
const S={tasks:[],daily:[],staff:[],categories:{},actor:null,ready:false,loading:false,tab:'My Daily',date:today(),selected:[],reportDepartment:'All',reportYear:String(new Date().getFullYear()),reportQuarter:'All',reportMonth:'All',reportEmployee:'All',search:'',todoSearch:'',todoStatus:'Open',todoPriority:'All',todoSort:'Due date',error:''};
const btn='rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-stone-50';
const solid='rounded-lg px-3 py-2 text-xs font-semibold bg-[#211d18] text-white';
const projectMode=()=>String(state?.profile?.role||'')==='project';
function projectDue(date){
 const start=Date.parse(String(date)+'T10:00:00+07:00');
 return Number.isFinite(start)?start+86400000:NaN;
}
function projectSummary(){
 if(!projectMode())return '';
 const todayDate=today(),me=mine(),report=current();
 const outstanding=me.filter(t=>!['Completed','Cancelled'].includes(t.status));
 const overdue=outstanding.filter(t=>t.dueDate&&t.dueDate<todayDate);
 const deadline=report?.amStatus==='Submitted'&&report?.pmStatus!=='Submitted'&&report?.reviewStatus!=='Changes Requested';
 const late=deadline&&!report?.latePmAllowed&&Date.now()>projectDue(S.date);
 return '<div class="grid sm:grid-cols-3 gap-2 mb-3">'+
 '<div class="border rounded-xl bg-white p-3 text-xs">My open To-Do<b class="block text-xl mt-1">'+outstanding.length+'</b></div>'+
 '<div class="border rounded-xl bg-white p-3 text-xs">Overdue To-Do<b class="block text-xl mt-1 '+(overdue.length?'text-red-600':'')+'">'+overdue.length+'</b></div>'+
 '<div class="border rounded-xl p-3 text-xs '+(late?'bg-red-50 border-red-200':'bg-white')+'">Evening Result<b class="block text-sm mt-1">'+(late?'Past 10:00 AM deadline':report?.latePmAllowed?'Late submission approved':report?.pmStatus==='Submitted'?'Submitted':deadline?'Due next day by 10:00 AM':'Awaiting morning plan')+'</b></div></div>'+
 (overdue.length?'<div class="border border-red-200 bg-red-50 rounded-xl px-3 py-2 text-sm mb-3"><b>Overdue tasks:</b> '+overdue.slice(0,3).map(t=>h(t.title)).join(' · ')+(overdue.length>3?' and '+(overdue.length-3)+' more':'')+'</div>':'');
}
function allowed(){return authorizedRoles.has(String(state.profile?.role||''))}
async function api(action,payload={}){
 const {data,error}=await db.functions.invoke('company-daily-google-proxy',{body:{action,payload}});
 if(error)throw Error(data?.error||error.message||'Company Daily Work connection failed');
 if(!data||!data.ok)throw Error(data?.error||'Daily Work request unsuccessful');
 return data.data;
}
function say(message,error=false){if(typeof toast==='function')toast(message,error);else alert(message)}
async function load(){
 if(S.loading)return;
 S.loading=true;S.error='';
 if(state.page===PAGE)root().innerHTML='<div class="p-8 text-sm text-stone-500">Loading Daily Work securely from Google Sheets…</div>';
 try{
  // Read the new Company Daily store and the original Sales/Marketing
  // stores independently. Legacy reads are never used to write/copy records.
  const bridge=window.LICompanyDailyLegacy?.load(S.date);
  const data=await api('company_list');
  S.tasks=data.tasks||[];S.daily=data.daily||[];S.staff=data.staff||[];S.categories=data.categories||{};S.actor=data.actor;
  S.ready=true;
  if(bridge)await bridge;
 }catch(e){S.ready=false;S.error=e.message||String(e)}
 finally{S.loading=false;if(state.page===PAGE)render()}
}
function mine(){return S.tasks.filter(t=>String(t.assigneeId)===String(S.actor?.id)&&t.requestStatus==='Approved')}
function current(){return S.daily.find(r=>r.date===S.date&&String(r.userId)===String(S.actor?.id))}
function taskById(id){return S.tasks.find(x=>String(x.id)===String(id))}
function header(){
 const tabs=projectMode()?['My Daily','To-Do','Support Requests','Department Reports']:['My Daily','Tasks','Support Requests','Department Reports'];
 return '<section class="max-w-7xl mx-auto space-y-4"><div class="flex justify-between flex-wrap gap-3 items-center"><div><div class="text-[10px] font-bold tracking-[.15em] text-amber-700">'+(projectMode()?'L’IMPERIAL · PROJECT':'L’IMPERIAL · COMPANY WORK')+'</div><h2 class="text-xl font-bold mt-1">'+(projectMode()?'Project Coordinator · Daily Plan & Result':'Daily Work Management')+'</h2><p class="text-xs text-slate-500">Morning Plan · Evening Result · Tasks · Manager review</p></div><div class="flex gap-2"><button class="'+btn+'" onclick="companyDailyRefresh()">Refresh</button><button class="'+solid+'" onclick="companyDailyOpenTask()">'+(projectMode()?'+ New Project Task':'+ New Task / Support Request')+'</button></div></div>'+
 '<div class="flex gap-1 overflow-x-auto bg-white p-1 rounded-xl border">'+tabs.filter(t=>t!=='Department Reports'||S.actor?.canReview).map(t=>'<button class="shrink-0 px-3 py-2 rounded-lg text-xs font-bold '+(S.tab===t?'bg-[#211d18] text-white':'text-stone-600')+'" onclick="companyDailyTab(\''+h(t)+'\')">'+h(t)+'</button>').join('')+'</div>';
}
function render(){
 if(state.page!==PAGE)return;
 if(!S.ready){root().innerHTML='<div class="rounded-xl border bg-white p-6 text-sm text-red-700"><b>Daily Work is not ready.</b><p class="mt-2">'+h(S.error||'Connection unavailable')+'</p><p class="mt-2 text-slate-500">Your existing Sales and Marketing reports are unchanged. The Company Daily Apps Script extension must be published before this workspace can read or save tasks.</p><button onclick="companyDailyRefresh()" class="'+btn+' mt-3">Retry</button></div>';return}
 const legacy=window.LICompanyDailyLegacy;
 root().innerHTML=header()+(S.tab==='My Daily'?(legacy?.daily(S.date)||'')+projectSummary()+daily():
 S.tab==='Tasks'?(legacy?.tasksPanel()||'')+tasks():
 S.tab==='To-Do'&&projectMode()?projectTodo():
 S.tab==='Support Requests'?requests():reports()+(legacy?.reportPanel({department:S.reportDepartment,year:S.reportYear,month:S.reportMonth,quarter:S.reportQuarter,employee:S.reportEmployee})||''))+'</section>';
}
function daily(){
 const report=current(),my=mine(),submitted=report?.amStatus==='Submitted';
 if(!submitted&&!S.selected.length)S.selected=my.filter(t=>!['Completed','Cancelled'].includes(t.status)).map(x=>x.id);
 const chosen=submitted?report.taskIds:S.selected;
 const originalIds=new Set(report?.originalTaskIds||chosen);
 const addedProjectTasks=projectMode()&&submitted?my.filter(t=>!chosen.includes(t.id)&&!['Completed','Cancelled'].includes(t.status)):[];
 return '<div class="rounded-xl border bg-white p-4 flex flex-wrap gap-3 items-end justify-between"><label class="text-xs font-bold">Work date<input type="date" class="block rounded-lg border px-3 py-2 mt-1" value="'+h(S.date)+'" onchange="companyDailyDate(this.value)"></label><div class="flex flex-wrap gap-2 text-xs"><span class="bg-amber-50 rounded-lg px-3 py-2">Shared AM: <b>'+h(report?.amStatus||'Not Started')+'</b></span><span class="bg-blue-50 rounded-lg px-3 py-2">Shared PM: <b>'+h(report?.pmStatus||'Not Started')+'</b></span><span class="bg-gray-100 rounded-lg px-3 py-2">Shared Review: <b>'+h(report?.reviewStatus||'Not Reviewed')+'</b></span></div></div>'+
 (projectMode()?'<form id="projectQuickTask" onsubmit="companyProjectQuickTask(event)" class="border rounded-xl bg-white p-4 space-y-3"><div class="font-bold text-sm">'+(submitted?'Add Urgent / Unplanned Project Task':'Quick Add · Project Task')+'</div><div class="grid sm:grid-cols-3 gap-2"><input name="title" required maxlength="180" class="border rounded-lg px-3 py-2 text-sm sm:col-span-2" placeholder="Task / planned activity"><select name="category" class="border rounded-lg px-3 py-2 text-sm">'+(S.categories.Project||['Other']).map(cat=>'<option>'+h(cat)+'</option>').join('')+'</select></div><div class="flex items-center gap-2"><button class="'+solid+'" type="submit">+ Add to my tasks</button><small class="text-gray-500">Create a task, then select it in the Morning Plan or add it as an audited revision.</small></div></form>':'')+
 '<section class="rounded-xl border bg-white p-4 space-y-3"><div><h3 class="font-bold">'+(projectMode()?'Morning Daily Plan':'Company Shared-Work Morning Plan')+'</h3><p class="text-xs text-gray-500">'+(projectMode()?'Select your project tasks for today. Create new tasks with + New Task, then submit the plan.':'For new company support assignments only. Existing Sales or Marketing Morning Plans remain in their original department module. Do not submit the same work twice.')+' Requests awaiting approval cannot be submitted.</p></div>'+
 (my.length?my.map(t=>'<label class="flex gap-3 items-start rounded-lg border p-3 text-sm"><input type="checkbox" class="mt-1" data-company-am value="'+h(t.id)+'" '+(chosen.includes(t.id)?'checked':'')+' '+(submitted?'disabled':'')+'><span><b>'+h(t.title)+'</b><small class="block text-gray-500">'+h(t.category)+' · '+h(t.department)+' · '+h(t.priority)+(projectMode()&&submitted&&chosen.includes(t.id)?' · '+(originalIds.has(t.id)?'Original':'Additional'):'')+'</small></span></label>').join(''):'<p class="text-sm text-gray-500">No approved tasks assigned. Create a task or request work support first.</p>')+
 (!submitted?'<button class="'+solid+'" onclick="companyDailySubmitAM()">Submit Morning Plan</button>':'<p class="text-xs text-green-700">Morning Plan submitted · '+chosen.length+' tasks linked</p>')+
 (projectMode()&&submitted?
   '<p class="text-xs">Original plan: '+originalIds.size+' · Additional work: '+Math.max(0,chosen.length-originalIds.size)+'</p>'+
   ((report?.planRevisions||[]).length?'<details class="border rounded-lg p-3 text-xs"><summary class="font-semibold cursor-pointer">Plan change history ('+report.planRevisions.length+')</summary>'+report.planRevisions.map(rev=>'<p class="border-t py-2">'+h(rev.at)+' · '+h(rev.reason)+' · '+(rev.taskIds||[]).map(id=>h(taskById(id)?.title||'Task')).join(', ')+'</p>').join('')+'</details>':'')+
   (S.date===today()&&report.pmStatus!=='Submitted'&&addedProjectTasks.length?
    '<form onsubmit="companyProjectAmendPlan(event)" class="border rounded-lg bg-amber-50 p-3 space-y-2"><b class="text-sm">Add new work to submitted Morning Plan</b>'+
    addedProjectTasks.map(t=>'<label class="block text-sm"><input class="mr-2" type="checkbox" name="taskIds" value="'+h(t.id)+'">'+h(t.title)+'</label>').join('')+
    '<input name="reason" required maxlength="350" class="border rounded-lg p-2 w-full text-sm" placeholder="Why was this work added?"><button class="'+solid+'" type="submit">Add and record revision</button></form>':'')
 :'')+'</section>'+
 (submitted?'<section class="rounded-xl border bg-white p-4 space-y-3"><h3 class="font-bold">'+(projectMode()?'Evening Result · Planned vs Actual':'Company Shared-Work Evening Result')+'</h3>'+
 (report.pmStatus==='Submitted'&&report.reviewStatus!=='Changes Requested'?'<p class="text-xs text-green-700">Evening Result submitted. Awaiting manager review.</p>'+
 (report.results||[]).map(x=>'<div class="rounded-lg border p-3 text-sm"><b>'+h(taskById(x.id)?.title||'Task')+'</b><p>'+h(x.status)+' — '+h(x.result)+'</p><small>'+h(x.nextStep)+'</small></div>').join(''):
 '<div class="grid gap-3">'+chosen.map((id,i)=>'<div data-company-pm="'+h(id)+'" class="rounded-lg border p-3 space-y-2"><b class="text-sm">'+(i+1)+'. '+h(taskById(id)?.title||'Task')+'</b>'+
 '<select data-pm="status" class="w-full border rounded-lg px-3 py-2 text-sm">'+['Completed','Partially Completed','Pending',...(projectMode()?['Waiting on Others']:[]),'Rescheduled','Cancelled'].map(v=>'<option>'+v+'</option>').join('')+'</select>'+
 '<textarea data-pm="result" class="w-full border rounded-lg px-3 py-2 text-sm" rows="2" placeholder="What was actually completed?"></textarea>'+
 '<input data-pm="nextStep" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Next action / blocker (optional)">'+
 (projectMode()?'<div class="grid sm:grid-cols-3 gap-2"><select data-pm="dependencyParty" class="border rounded-lg p-2 text-sm">'+['','Customer','Sales','Stock','Technician','Supplier','Contractor','Designer','Other'].map(v=>'<option value="'+h(v)+'">'+h(v||'No dependency')+'</option>').join('')+'</select><input data-pm="reason" maxlength="350" class="border rounded-lg p-2 text-sm" placeholder="Reason for waiting / delay"><label class="text-xs">Next follow-up date<input data-pm="nextDate" type="date" class="border rounded-lg p-2 text-sm w-full"></label></div>':'')+'</div>').join('')+'</div><button class="'+solid+'" onclick="companyDailySubmitPM()">Submit Evening Result</button>')+
 (report.comment?'<p class="text-sm bg-amber-50 p-3 rounded-lg"><b>Manager note: </b>'+h(report.comment)+'</p>':'')+'</section>':'')+
 '<section class="rounded-xl border bg-white p-4"><h3 class="font-bold mb-2">'+(projectMode()?'My Project To-Do':'New Company Support Tasks')+'</h3>'+my.filter(t=>!['Completed','Cancelled'].includes(t.status)).map(t=>'<div class="border-b py-2 text-sm flex flex-wrap justify-between gap-2"><span>'+h(t.title)+' <small class="text-gray-500">'+h(t.status)+'</small></span><button class="'+btn+'" onclick="companyDailyOpenTask(\''+h(t.id)+'\')">Update</button></div>').join('')+'</section>';
}
function projectTodo(){
 const all=mine().filter(t=>t.department==='Project');
 const active=t=>!['Completed','Cancelled'].includes(t.status);
 const date=t=>String(t.dueDate||t.rescheduledTo||'');
 const late=t=>active(t)&&date(t)&&date(t)<today();
 const priorityRank={Urgent:0,High:1,Medium:2,Low:3};
 const statuses=['Open','All','Not Started','In Progress','Waiting on Others','Rescheduled','Blocked','Completed','Cancelled'];
 const priorities=['All','Urgent','High','Medium','Low'];
 const sortLabels=['Due date','Priority','Recently updated','Title'];
 const linked=new Set(S.daily.filter(r=>String(r.userId)===String(S.actor?.id)).flatMap(r=>r.taskIds||[]).map(String));
 const search=S.todoSearch.trim().toLowerCase();
 const list=all.filter(t=>
  (!search||[t.title,t.description,t.category,t.relatedRef,t.dependencyParty,t.dependencyDetails].join(' ').toLowerCase().includes(search))&&
  (S.todoPriority==='All'||t.priority===S.todoPriority)&&
  (S.todoStatus==='All'||(S.todoStatus==='Open'?active(t):t.status===S.todoStatus))
 ).sort((a,b)=>{
  if(S.todoSort==='Priority')return (priorityRank[a.priority]??5)-(priorityRank[b.priority]??5)||date(a).localeCompare(date(b));
  if(S.todoSort==='Recently updated')return String(b.updatedAt||'').localeCompare(String(a.updatedAt||''));
  if(S.todoSort==='Title')return String(a.title||'').localeCompare(String(b.title||''));
  return (!date(a)?'9999':date(a)).localeCompare(!date(b)?'9999':date(b))||
    (priorityRank[a.priority]??5)-(priorityRank[b.priority]??5);
 });
 const picker=(field,vals)=>'<select aria-label="'+h(field)+'" class="border rounded-lg px-2 py-2 text-xs bg-white" onchange="companyProjectTodoFilter(\''+h(field)+'\',this.value)">'+
   vals.map(v=>'<option value="'+h(v)+'" '+(S[field]===v?'selected':'')+'>'+h(v)+'</option>').join('')+'</select>';
 const metric=(label,value)=>'<div class="border rounded-xl bg-white p-3"><div class="text-xs text-gray-500">'+label+'</div><b class="text-xl">'+value+'</b></div>';
 return '<section class="space-y-4">'+
  '<div class="flex flex-wrap justify-between items-center gap-2"><div><h3 class="font-bold text-lg">My Project To-Do</h3><p class="text-xs text-gray-500">Personal tasks · Linked to Morning Plan & Evening Result · Changes recorded in Company Daily Audit</p></div>'+
  '<button type="button" onclick="companyDailyOpenTask()" class="'+solid+'">+ New To-Do</button></div>'+
  '<div class="grid grid-cols-2 sm:grid-cols-4 gap-2">'+
    metric('Open',all.filter(active).length)+metric('Overdue',all.filter(late).length)+
    metric('Waiting on Others',all.filter(t=>t.status==='Waiting on Others').length)+
    metric('Completed',all.filter(t=>t.status==='Completed').length)+'</div>'+
  '<div class="border bg-white rounded-xl p-3 flex flex-wrap items-center gap-2">'+
    '<input id="projectTodoSearch" aria-label="Search project tasks" value="'+h(S.todoSearch)+'" placeholder="Search tasks, projects, people..." class="border rounded-lg px-3 py-2 text-sm flex-1 min-w-[180px]" oninput="companyProjectTodoSearch(this.value)">'+
    picker('todoStatus',statuses)+picker('todoPriority',priorities)+picker('todoSort',sortLabels)+'</div>'+
  '<div class="space-y-2">'+(list.length?list.map(t=>{
    const due=date(t), overdue=late(t),progress=Math.max(0,Math.min(100,Number(t.progress)||0));
    const isLinked=linked.has(String(t.id));
    return '<div class="border rounded-xl bg-white p-3 sm:p-4 flex flex-wrap items-start justify-between gap-3">'+
      '<div class="min-w-0 flex-1 space-y-2"><div class="flex items-center gap-2 flex-wrap">'+
      '<b class="text-sm">'+h(t.title)+'</b>'+
      (overdue?'<span class="text-[10px] font-bold text-red-700 bg-red-50 px-2 py-1 rounded">OVERDUE</span>':'')+
      (isLinked?'<span class="text-[10px] text-blue-700 bg-blue-50 px-2 py-1 rounded">Daily Plan linked</span>':'')+'</div>'+
      '<div class="text-xs text-gray-500">'+h(t.category||'Other')+' · '+h(t.priority||'Medium')+' priority · '+h(t.status||'Not Started')+
      (due?' · Due '+h(due):' · No deadline')+'</div>'+
      (t.relatedRef?'<p class="text-xs text-gray-600">Project / order: '+h(t.relatedRef)+'</p>':'')+
      (t.dependencyParty||t.dependencyDetails?'<p class="text-xs text-amber-800">Depends on: '+h(t.dependencyParty||'Other')+(t.dependencyDetails?' — '+h(t.dependencyDetails):'')+'</p>':'')+
      (t.rescheduleReason?'<p class="text-xs text-gray-600">Reason: '+h(t.rescheduleReason)+'</p>':'')+
      '<div class="h-1.5 bg-gray-100 rounded-full overflow-hidden max-w-sm"><div class="h-full bg-amber-600 rounded-full" style="width:'+progress+'%"></div></div>'+
      '<p class="text-[10px] text-gray-400">'+progress+'% complete'+(t.updatedAt?' · Updated '+h(t.updatedAt.slice(0,16).replace('T',' ')):'')+'</p></div>'+
      '<button class="'+btn+'" type="button" onclick="companyDailyOpenTask(\''+h(t.id)+'\')">View / Update</button>'+
      '</div>';
  }).join(''):'<div class="rounded-xl border bg-white p-6 text-sm text-gray-500">No Project To-Do tasks match these filters. Use + New To-Do to add a task.</div>')+'</div></section>';
}
function tasks(){
 const list=S.tasks.filter(t=>(S.actor.allDepartments||t.requestedBy===S.actor.id||t.assigneeId===S.actor.id||t.department===S.actor.department)&&[t.title,t.department,t.category,t.relatedRef].join(' ').toLowerCase().includes(S.search.toLowerCase()));
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><div class="flex justify-between items-center"><h3 class="font-bold">New Company Shared-Work Tasks</h3><span class="text-xs text-slate-500">'+list.length+' visible</span></div><input id="companySearch" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Search tasks" value="'+h(S.search)+'" oninput="companyDailySearch(this.value)">'+
 (list.length?list.map(t=>'<div class="border rounded-lg p-3 flex flex-wrap justify-between items-center gap-3"><div><b class="text-sm">'+h(t.title)+'</b><p class="text-xs text-gray-500">'+h(t.department)+' · '+h(t.category)+' · '+h(t.assignee)+' · Due '+h(t.dueDate||'Not set')+'</p><p class="text-xs">'+h(t.requestStatus)+' · '+h(t.status)+' · '+h(t.progress)+'%</p>'+(t.relatedRef?'<p class="text-xs">Related: '+h(t.relatedRef)+'</p>':'')+'</div><button class="'+btn+'" onclick="companyDailyOpenTask(\''+h(t.id)+'\')">Details / Update</button></div>').join(''):'<p class="text-sm text-gray-500">No tasks match this search.</p>')+'</section>';
}
function requests(){
 const list=S.tasks.filter(t=>t.requestStatus==='Pending Approval'&&(S.actor?.allDepartments||S.actor?.canReview&&t.department===S.actor.department||t.requestedBy===S.actor.id));
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><h3 class="font-bold">Cross-department Support Requests</h3><p class="text-xs text-slate-500">A support request must be approved by the receiving department manager (or Admin) before appearing in the assignee’s daily plan.</p>'+
 (list.length?list.map(t=>'<div class="border rounded-xl p-3 space-y-2"><b>'+h(t.title)+'</b><div class="text-xs text-gray-500">From '+h(t.requester)+' → '+h(t.department)+' / '+h(t.assignee)+' · '+h(t.priority)+'</div><p class="text-sm">'+h(t.description)+'</p>'+
 (S.actor?.allDepartments||S.actor?.canReview&&t.department===S.actor.department?'<div class="flex gap-2"><button class="'+solid+'" onclick="companyDailyDecide(\''+h(t.id)+'\',\'Approve\')">Approve Assignment</button><button class="'+btn+'" onclick="companyDailyDecide(\''+h(t.id)+'\',\'Reject\')">Reject</button></div>':'<small class="text-amber-700">Awaiting receiving department approval</small>')+'</div>').join(''):'<p class="text-sm text-gray-500">No pending support requests.</p>')+'</section>';
}
function reports(){
 if(!S.actor?.canReview)return '<p>Department reports require manager access.</p>';
 const filters=['All','Sales','Marketing','Stock','Project','Product Assistant'];
 const visible=S.daily.filter(r=>{
  if(S.reportDepartment!=='All'&&r.department!==S.reportDepartment)return false;
  if(S.reportEmployee!=='All'&&r.userId!==S.reportEmployee)return false;
  if(S.reportYear!=='All'&&!r.date.startsWith(S.reportYear))return false;
  if(S.reportMonth!=='All'&&r.date.slice(5,7)!==S.reportMonth)return false;
  if(S.reportQuarter!=='All'&&Math.ceil(Number(r.date.slice(5,7))/3)!==Number(S.reportQuarter))return false;
  return true;
 });
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><h3 class="font-bold">Company Shared-Work Reports</h3><div class="flex gap-2 flex-wrap">'+
 '<select class="'+btn+'" onchange="companyDailyFilter(\'department\',this.value)">'+filters.filter(d=>S.actor.allDepartments||d==='All'||d===S.actor.department).map(d=>'<option '+(d===S.reportDepartment?'selected':'')+'>'+d+'</option>').join('')+'</select>'+
 '<select class="'+btn+'" onchange="companyDailyFilter(\'employee\',this.value)"><option value="All">All employees</option>'+S.staff.filter(x=>S.actor.allDepartments||x.department===S.actor.department).map(x=>'<option value="'+h(x.id)+'" '+(x.id===S.reportEmployee?'selected':'')+'>'+h(x.name)+'</option>').join('')+'</select>'+
 '<input class="'+btn+'" style="width:110px" type="number" min="2020" max="2100" value="'+h(S.reportYear)+'" onchange="companyDailyFilter(\'year\',this.value)" aria-label="Year">'+
 '<select class="'+btn+'" onchange="companyDailyFilter(\'quarter\',this.value)">'+['All','1','2','3','4'].map(x=>'<option '+(x===S.reportQuarter?'selected':'')+' value="'+x+'">'+(x==='All'?'All quarters':'Q'+x)+'</option>').join('')+'</select>'+
 '<select class="'+btn+'" onchange="companyDailyFilter(\'month\',this.value)">'+['All',...Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'))].map(x=>'<option '+(x===S.reportMonth?'selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
 '<div class="text-xs text-slate-500">'+visible.length+' reports · '+visible.filter(x=>x.pmStatus==='Submitted').length+' evening results submitted</div>'+
 visible.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,250).map(r=>'<div class="border rounded-lg p-3 flex flex-wrap justify-between gap-3"><div><b>'+h(r.date)+' · '+h(S.staff.find(s=>s.id===r.userId)?.name||'Employee')+'</b><p class="text-xs text-gray-500">'+h(r.department)+' · AM '+h(r.amStatus)+' · PM '+h(r.pmStatus)+' · '+h(r.reviewStatus)+'</p><div class="text-xs">'+(r.results||[]).map(x=>h(taskById(x.id)?.title||'Task')+': '+h(x.status)).join(' · ')+'</div></div>'+
 (r.pmStatus==='Submitted'&&r.reviewStatus!=='Reviewed'?'<button class="'+btn+'" onclick="companyDailyReview(\''+h(r.id)+'\')">Review</button>':r.department==='Project'&&r.amStatus==='Submitted'&&!r.latePmAllowed&&Date.now()>projectDue(r.date)?'<button class="'+btn+'" onclick="companyDailyAllowLate(\''+h(r.id)+'\')">Allow Late Result</button>':'')+'</div>').join('')+'</section>';
}
function selectOptions(values,chosen){return values.map(x=>'<option value="'+h(x)+'" '+(chosen===x?'selected':'')+'>'+h(x)+'</option>').join('')}
function taskForm(id){
 const t=taskById(id)||{},isEdit=!!t.id;
 const editable=!isEdit||S.actor.allDepartments||S.actor.canReview&&t.department===S.actor.department||t.department==='Project'&&String(t.assigneeId)===String(S.actor.id)&&t.requestStatus==='Approved';
 const assigneeId=t.assigneeId||S.actor.id,department=S.staff.find(x=>x.id===assigneeId)?.department||S.actor.department;
 const cats=S.categories[department]||['Other'];
 return '<form id="companyDailyTaskForm" onsubmit="companyDailySave(event)" class="space-y-3">'+
 '<input type="hidden" name="id" value="'+h(t.id||'')+'"><label class="block text-xs font-bold">Task / Deliverable<input name="title" required maxlength="180" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.title||'')+'" '+(!editable?'readonly':'')+'></label>'+
 '<label class="block text-xs font-bold">Description / Brief<textarea name="description" maxlength="1200" rows="3" class="block w-full border rounded-lg p-2 mt-1" '+(!editable?'readonly':'')+'>'+h(t.description||'')+'</textarea></label>'+
 '<div class="grid grid-cols-2 gap-3"><label class="text-xs font-bold">Assignee<select id="companyAssignee" name="assigneeId" class="block w-full border rounded-lg p-2 mt-1" onchange="companyDailyAssigneeChange(this.value)" '+(isEdit?'disabled':'')+'>'+S.staff.filter(s=>S.categories[s.department]).map(s=>'<option value="'+h(s.id)+'" '+(String(s.id)===String(assigneeId)?'selected':'')+'>'+h(s.name)+' · '+h(s.department)+'</option>').join('')+'</select></label>'+
 '<label class="text-xs font-bold">Category<select id="companyCategory" name="category" class="block w-full border rounded-lg p-2 mt-1" '+(!editable?'disabled':'')+'>'+selectOptions(cats,t.category||cats[0])+'</select></label>'+
 '<label class="text-xs font-bold">Priority<select name="priority" class="block w-full border rounded-lg p-2 mt-1" '+(!editable?'disabled':'')+'>'+selectOptions(['Low','Medium','High','Urgent'],t.priority||'Medium')+'</select></label>'+
 '<label class="text-xs font-bold">Deadline<input name="dueDate" type="date" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.dueDate||'')+'" '+(!editable?'readonly':'')+'></label>'+
 '<label class="text-xs font-bold">Status<select name="status" class="block w-full border rounded-lg p-2 mt-1">'+selectOptions(['Not Started','In Progress','Completed','Blocked','Cancelled',...(department==='Project'?['Waiting on Others','Rescheduled']:[])],t.status||'Not Started')+'</select></label>'+
 '<label class="text-xs font-bold">Progress (%)<input name="progress" type="number" min="0" max="100" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.progress||0)+'"></label></div>'+
 '<label class="block text-xs font-bold">Related customer / project / order<input name="relatedRef" maxlength="200" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.relatedRef||'')+'" '+(!editable?'readonly':'')+'></label>'+
 (department==='Project'?'<div class="grid sm:grid-cols-2 gap-3 border border-amber-200 bg-amber-50 rounded-lg p-3"><label class="text-xs font-bold">Depends on<select name="dependencyParty" class="block w-full border rounded-lg p-2 mt-1">'+selectOptions(['','Customer','Sales','Stock','Technician','Supplier','Contractor','Designer','Other'],t.dependencyParty||'')+'</select></label><label class="text-xs font-bold">Next follow-up / rescheduled date<input type="date" name="rescheduledTo" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.rescheduledTo||'')+'"></label><label class="text-xs font-bold">Dependency details<input name="dependencyDetails" maxlength="350" class="block border rounded-lg p-2 mt-1 w-full" value="'+h(t.dependencyDetails||'')+'"></label><label class="text-xs font-bold">Reason for delay / reschedule<input name="rescheduleReason" maxlength="350" class="block border rounded-lg p-2 mt-1 w-full" value="'+h(t.rescheduleReason||'')+'"></label></div>':'')+
 '<label class="block text-xs font-bold">Work result / update<textarea name="result" maxlength="1200" class="block w-full border rounded-lg p-2 mt-1">'+h(t.result||'')+'</textarea></label>'+
 (isEdit?'<p class="text-xs text-gray-500">Department: '+h(t.department)+' · Request: '+h(t.requestStatus)+'</p>':'<p class="text-xs text-amber-800">Cross-department tasks require the receiving manager’s approval before assignment.</p>')+
 '<div class="flex gap-2 justify-end"><button type="button" class="'+btn+'" onclick="closeModal()">Cancel</button><button class="'+solid+'" type="submit">Save Task</button></div></form>';
}
window.companyDailyOpenTask=id=>openModal(id?'Update Daily Work Task':'New Daily Work Task / Support Request',taskForm(id));
window.companyDailyAssigneeChange=id=>{const dep=S.staff.find(x=>String(x.id)===String(id))?.department||'Sales',box=document.getElementById('companyCategory');if(box)box.innerHTML=selectOptions(S.categories[dep]||['Other'],'')};
window.companyDailySave=async ev=>{ev.preventDefault();const t=Object.fromEntries(new FormData(ev.target).entries());if(t.id&&!t.assigneeId)t.assigneeId=taskById(t.id)?.assigneeId;try{await api('company_save_task',t);closeModal();say('Daily Work task saved');await load()}catch(e){say(e.message,true)}};
window.companyDailyTab=tab=>{S.tab=tab;render()};
window.companyProjectTodoFilter=(field,value)=>{
 if(!projectMode()||!['todoStatus','todoPriority','todoSort'].includes(field))return;
 S[field]=String(value);render();
};
window.companyProjectTodoSearch=value=>{
 if(!projectMode())return;
 S.todoSearch=String(value);render();
 const input=document.getElementById('projectTodoSearch');
 if(input){input.focus();try{input.setSelectionRange(value.length,value.length)}catch(_){}}
};
window.companyDailyDate=async value=>{S.date=value;S.selected=[];if(S.ready)await load();else render()};
window.companyDailySearch=value=>{S.search=value;render();const input=document.getElementById('companySearch');if(input){input.focus();input.setSelectionRange(value.length,value.length)}};
window.companyProjectQuickTask=async ev=>{
 ev.preventDefault();
 if(!projectMode()||S.actor?.department!=='Project')return say('Project staff only',true);
 const form=ev.target, data=Object.fromEntries(new FormData(form).entries());
 if(!String(data.title||'').trim())return say('Enter a task title',true);
 const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
 try{
  await api('company_save_task',{title:data.title,category:data.category,assigneeId:S.actor.id,priority:'Medium',status:'Not Started',progress:0});
  S.selected=[];await load();say('Project task added. Select it in the Morning Plan below.');
 }catch(e){say(e.message,true);if(button?.isConnected)button.disabled=false}
};
window.companyProjectAmendPlan=async ev=>{
 ev.preventDefault();
 if(!projectMode())return;
 const form=ev.target,fd=new FormData(form),taskIds=fd.getAll('taskIds').map(String),reason=String(fd.get('reason')||'').trim();
 if(!taskIds.length)return say('Choose a task to add',true);
 if(!reason)return say('Enter the reason for the change',true);
 if(!confirm('Add '+taskIds.length+' task(s) to your Morning Plan and record the revision?'))return;
 const button=form.querySelector('button[type="submit"]');if(button)button.disabled=true;
 try{await api('company_amend_project_plan',{date:S.date,taskIds,reason});say('Morning Plan amended; original preserved');await load()}
 catch(e){say(e.message,true);if(button?.isConnected)button.disabled=false}
};
window.companyDailyAllowLate=async id=>{
 if(!S.actor?.canReview)return say('Project Manager/Admin permission required',true);
 if(!confirm('Allow late Evening Result for this Project report? This decision will be recorded in the audit.'))return;
 try{await api('company_allow_late_pm',{id});say('Late submission authorized');await load()}catch(e){say(e.message,true)}
};
window.companyDailySubmitAM=async()=>{
 const ids=[...root().querySelectorAll('[data-company-am]:checked')].map(x=>x.value);
 if(!ids.length)return say('Choose at least one approved task',true);
 if(!confirm('Submit Morning Plan with '+ids.length+' task(s)?'))return;
 try{await api('company_submit_am',{date:S.date,taskIds:ids});say('Morning Plan submitted');S.selected=[];await load()}catch(e){say(e.message,true)}
};
window.companyDailySubmitPM=async()=>{
 const results=[...root().querySelectorAll('[data-company-pm]')].map(row=>({id:row.dataset.companyPm,status:row.querySelector('[data-pm="status"]')?.value,result:row.querySelector('[data-pm="result"]')?.value,nextStep:row.querySelector('[data-pm="nextStep"]')?.value,...(projectMode()?{dependencyParty:row.querySelector('[data-pm="dependencyParty"]')?.value,reason:row.querySelector('[data-pm="reason"]')?.value,nextDate:row.querySelector('[data-pm="nextDate"]')?.value}:{})}));
 if(!results.length)return say('No planned tasks to report',true);
 if(projectMode()&&results.some(x=>!String(x.result||'').trim()))return say('Enter an actual outcome for every planned task',true);
 if(projectMode()&&!current()?.latePmAllowed&&current()?.reviewStatus!=='Changes Requested'&&Date.now()>projectDue(S.date))return say('The next-day 10:00 AM Evening Result deadline has passed. Ask your Project Manager/Admin for assistance.',true);
 if(projectMode()&&results.some(x=>['Waiting on Others','Rescheduled'].includes(x.status)&&(!String(x.reason||'').trim()||!x.nextDate)))return say('Explain the delay and enter a next follow-up date for waiting/rescheduled tasks',true);
 if(!confirm('Submit Evening Result for '+S.date+'?'))return;
 try{await api('company_submit_pm',{date:S.date,results});say('Evening Result submitted');await load()}catch(e){say(e.message,true)}
};
window.companyDailyDecide=async(id,decision)=>{if(!confirm(decision+' this support request?'))return;try{await api('company_decide_request',{id,decision});say('Support request '+decision.toLowerCase()+'d');await load()}catch(e){say(e.message,true)}};
window.companyDailyReview=async id=>{const decision=confirm('Mark this Evening Result as reviewed? Select Cancel to request changes.')?'Reviewed':'Changes Requested';const comment=prompt('Management comment (optional)');if(comment===null)return;try{await api('company_review',{id,status:decision,comment});say('Manager review saved');await load()}catch(e){say(e.message,true)}};
window.companyDailyFilter=(field,value)=>{if(field==='department')S.reportDepartment=value;if(field==='year')S.reportYear=value;if(field==='quarter')S.reportQuarter=value;if(field==='month')S.reportMonth=value;if(field==='employee')S.reportEmployee=value;render()};
window.companyDailyLegacyRender=()=>{if(state.page===PAGE&&S.ready)render()};
window.companyDailyRefresh=load;
window.companyDailyLegacyLoadPeriod=async()=>{
 const bridge=window.LICompanyDailyLegacy;
 if(!bridge)return;
 const button=document.activeElement;
 if(button){button.disabled=true;button.textContent='Loading source reports…'}
 try{
  const result=await bridge.loadPeriod({year:S.reportYear,month:S.reportMonth,quarter:S.reportQuarter});
  render();
  if(result.errors.length)say('Some Sales months could not load: '+result.errors.join(' · '),true);
 }catch(e){say(e.message,true);render()}
};
const oldNav=window.navItems;
if(typeof oldNav==='function')window.navItems=function(){const items=oldNav.apply(this,arguments);const role=String(state.profile?.role||'');if(['project','project_manager','product_assistant','product_manager'].includes(role)){
 // Project / Product role determines the daily-work workflow, not an absolute
 // ban on every other navigation tab. Permission overrides remain authoritative.
 const rolePages=[
   ['customers','Customers','◉','customers.view'],
   ['sales-orders','Sales Orders','▤','sales_orders.view'],
   ['tracking','Order Tracking','◎','tracking.view'],
   ['quotation-imports','Quotation History','⇢','quotations.view'],
   ['products','Products','◇','products.view'],
   ['payments','Payments','＄','payments.view'],
   ['returns','Returns','↩','returns.view'],
   ['stock-inventory','Stock & Inventory','↔','inventory.view'],
   ['procurement','Procurement','▣','procurement.view'],
   ['supplier-pos','Supplier POs','⌑','procurement.view'],
   ['reports','Reports','▥','reports.view'],
   ['marketing','Marketing','✦','marketing.view']
 ];
 const access=key=>typeof window.hasAppPermission==='function'&&window.hasAppPermission(key);
 const seen=new Set(),visible=[];
 const add=item=>{if(!seen.has(item[0])){seen.add(item[0]);visible.push(item)}};
 // Include existing navigation entries only when page access is explicitly
 // enabled, never because a legacy navigation function happens to list them.
 for(const item of rolePages)if(access(item[3])&&
   (typeof window.canAccessAppPage!=='function'||window.canAccessAppPage(item[0])))
   add(item.slice(0,3));
 add([PAGE,'Daily Work · All Departments','☷']);
 return visible;
}if(allowed()&&!items.some(x=>x[0]===PAGE)){const index=items.findIndex(x=>x[0]==='sales-daily');items.splice(index<0?items.length:index+1,0,[PAGE,'Daily Work · All Departments','☷'])}return items};
const oldGo=window.go;
window.go=async function(page){
 if(page!==PAGE)return oldGo.apply(this,arguments);
 if(!allowed())return say('Daily Work access requires an authorized department account',true);
 state.page=PAGE;renderNav();
 document.getElementById('pageTitle').textContent='Daily Work · All Departments';
 document.getElementById('pageSubtitle').textContent='Morning plans, results, support requests and management reviews';
 await load();
};
})();
