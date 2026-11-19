/* L'Imperial Company Daily Work: shared work tracker alongside legacy Sales
 * Daily and Marketing calendars. Every read/write is server-authorized. */
(function(){
'use strict';
const PAGE='company-daily';
const authorizedRoles=new Set(['sales','manager','marketing','marketing_manager','stock_controller','stock_manager','project','project_manager','product_assistant','product_manager','admin','super_admin']);
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const root=()=>document.getElementById('content');
const today=()=>{const dt=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());return /^\d{4}-\d{2}-\d{2}$/.test(dt)?dt:new Date().toISOString().slice(0,10)};
const S={tasks:[],daily:[],staff:[],categories:{},actor:null,ready:false,loading:false,tab:'My Daily',date:today(),selected:[],reportDepartment:'All',reportYear:String(new Date().getFullYear()),reportQuarter:'All',reportMonth:'All',search:'',error:''};
const btn='rounded-lg border px-3 py-2 text-xs font-semibold hover:bg-stone-50';
const solid='rounded-lg px-3 py-2 text-xs font-semibold bg-[#211d18] text-white';
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
  const data=await api('company_list');
  S.tasks=data.tasks||[];S.daily=data.daily||[];S.staff=data.staff||[];S.categories=data.categories||{};S.actor=data.actor;
  S.ready=true;
 }catch(e){S.ready=false;S.error=e.message||String(e)}
 finally{S.loading=false;if(state.page===PAGE)render()}
}
function mine(){return S.tasks.filter(t=>String(t.assigneeId)===String(S.actor?.id)&&t.requestStatus==='Approved')}
function current(){return S.daily.find(r=>r.date===S.date&&String(r.userId)===String(S.actor?.id))}
function taskById(id){return S.tasks.find(x=>String(x.id)===String(id))}
function header(){
 const tabs=['My Daily','Tasks','Support Requests','Department Reports'];
 return '<section class="max-w-7xl mx-auto space-y-4"><div class="flex justify-between flex-wrap gap-3 items-center"><div><div class="text-[10px] font-bold tracking-[.15em] text-amber-700">L’IMPERIAL · COMPANY WORK</div><h2 class="text-xl font-bold mt-1">Daily Work Management</h2><p class="text-xs text-slate-500">Morning Plan · Evening Result · Department support · Manager review</p></div><div class="flex gap-2"><button class="'+btn+'" onclick="companyDailyRefresh()">Refresh</button><button class="'+solid+'" onclick="companyDailyOpenTask()">+ New Task / Support Request</button></div></div>'+
 '<div class="flex gap-1 overflow-x-auto bg-white p-1 rounded-xl border">'+tabs.filter(t=>t!=='Department Reports'||S.actor?.canReview).map(t=>'<button class="shrink-0 px-3 py-2 rounded-lg text-xs font-bold '+(S.tab===t?'bg-[#211d18] text-white':'text-stone-600')+'" onclick="companyDailyTab(\''+h(t)+'\')">'+h(t)+'</button>').join('')+'</div>';
}
function render(){
 if(state.page!==PAGE)return;
 if(!S.ready){root().innerHTML='<div class="rounded-xl border bg-white p-6 text-sm text-red-700"><b>Daily Work is not ready.</b><p class="mt-2">'+h(S.error||'Connection unavailable')+'</p><p class="mt-2 text-slate-500">Your existing Sales and Marketing reports are unchanged. The Company Daily Apps Script extension must be published before this workspace can read or save tasks.</p><button onclick="companyDailyRefresh()" class="'+btn+' mt-3">Retry</button></div>';return}
 root().innerHTML=header()+(S.tab==='My Daily'?daily():S.tab==='Tasks'?tasks():S.tab==='Support Requests'?requests():reports())+'</section>';
}
function daily(){
 const report=current(),my=mine(),submitted=report?.amStatus==='Submitted';
 if(!submitted&&!S.selected.length)S.selected=my.filter(t=>!['Completed','Cancelled'].includes(t.status)).map(x=>x.id);
 const chosen=submitted?report.taskIds:S.selected;
 return '<div class="rounded-xl border bg-white p-4 flex flex-wrap gap-3 items-end justify-between"><label class="text-xs font-bold">Work date<input type="date" class="block rounded-lg border px-3 py-2 mt-1" value="'+h(S.date)+'" onchange="companyDailyDate(this.value)"></label><div class="flex flex-wrap gap-2 text-xs"><span class="bg-amber-50 rounded-lg px-3 py-2">AM: <b>'+h(report?.amStatus||'Not Started')+'</b></span><span class="bg-blue-50 rounded-lg px-3 py-2">PM: <b>'+h(report?.pmStatus||'Not Started')+'</b></span><span class="bg-gray-100 rounded-lg px-3 py-2">Review: <b>'+h(report?.reviewStatus||'Not Reviewed')+'</b></span></div></div>'+
 '<section class="rounded-xl border bg-white p-4 space-y-3"><div><h3 class="font-bold">Morning Plan</h3><p class="text-xs text-gray-500">Choose your approved tasks for the day. Requests awaiting approval cannot be submitted.</p></div>'+
 (my.length?my.map(t=>'<label class="flex gap-3 items-start rounded-lg border p-3 text-sm"><input type="checkbox" class="mt-1" data-company-am value="'+h(t.id)+'" '+(chosen.includes(t.id)?'checked':'')+' '+(submitted?'disabled':'')+'><span><b>'+h(t.title)+'</b><small class="block text-gray-500">'+h(t.category)+' · '+h(t.department)+' · '+h(t.priority)+'</small></span></label>').join(''):'<p class="text-sm text-gray-500">No approved tasks assigned. Create a task or request work support first.</p>')+
 (!submitted?'<button class="'+solid+'" onclick="companyDailySubmitAM()">Submit Morning Plan</button>':'<p class="text-xs text-green-700">Morning Plan submitted · '+chosen.length+' tasks linked</p>')+'</section>'+
 (submitted?'<section class="rounded-xl border bg-white p-4 space-y-3"><h3 class="font-bold">Evening Result</h3>'+
 (report.pmStatus==='Submitted'?'<p class="text-xs text-green-700">Evening Result submitted. Awaiting manager review.</p>'+
 (report.results||[]).map(x=>'<div class="rounded-lg border p-3 text-sm"><b>'+h(taskById(x.id)?.title||'Task')+'</b><p>'+h(x.status)+' — '+h(x.result)+'</p><small>'+h(x.nextStep)+'</small></div>').join(''):
 '<div class="grid gap-3">'+chosen.map((id,i)=>'<div data-company-pm="'+h(id)+'" class="rounded-lg border p-3 space-y-2"><b class="text-sm">'+(i+1)+'. '+h(taskById(id)?.title||'Task')+'</b>'+
 '<select data-pm="status" class="w-full border rounded-lg px-3 py-2 text-sm">'+['Completed','Partially Completed','Pending','Rescheduled','Cancelled'].map(v=>'<option>'+v+'</option>').join('')+'</select>'+
 '<textarea data-pm="result" class="w-full border rounded-lg px-3 py-2 text-sm" rows="2" placeholder="What was actually completed?"></textarea>'+
 '<input data-pm="nextStep" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Next action / blocker (optional)"></div>').join('')+'</div><button class="'+solid+'" onclick="companyDailySubmitPM()">Submit Evening Result</button>')+
 (report.comment?'<p class="text-sm bg-amber-50 p-3 rounded-lg"><b>Manager note: </b>'+h(report.comment)+'</p>':'')+'</section>':'')+
 '<section class="rounded-xl border bg-white p-4"><h3 class="font-bold mb-2">Your Open Tasks</h3>'+my.filter(t=>!['Completed','Cancelled'].includes(t.status)).map(t=>'<div class="border-b py-2 text-sm flex flex-wrap justify-between gap-2"><span>'+h(t.title)+' <small class="text-gray-500">'+h(t.status)+'</small></span><button class="'+btn+'" onclick="companyDailyOpenTask(\''+h(t.id)+'\')">Update</button></div>').join('')+'</section>';
}
function tasks(){
 const list=S.tasks.filter(t=>(S.actor.allDepartments||t.requestedBy===S.actor.id||t.assigneeId===S.actor.id||t.department===S.actor.department)&&[t.title,t.department,t.category,t.relatedRef].join(' ').toLowerCase().includes(S.search.toLowerCase()));
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><div class="flex justify-between items-center"><h3 class="font-bold">Assigned / Requested Tasks</h3><span class="text-xs text-slate-500">'+list.length+' visible</span></div><input id="companySearch" class="w-full border rounded-lg px-3 py-2 text-sm" placeholder="Search tasks" value="'+h(S.search)+'" oninput="companyDailySearch(this.value)">'+
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
  if(S.reportYear!=='All'&&!r.date.startsWith(S.reportYear))return false;
  if(S.reportMonth!=='All'&&r.date.slice(5,7)!==S.reportMonth)return false;
  if(S.reportQuarter!=='All'&&Math.ceil(Number(r.date.slice(5,7))/3)!==Number(S.reportQuarter))return false;
  return true;
 });
 return '<section class="rounded-xl border bg-white p-4 space-y-3"><h3 class="font-bold">Department Daily Reports</h3><div class="flex gap-2 flex-wrap">'+
 '<select class="'+btn+'" onchange="companyDailyFilter(\'department\',this.value)">'+filters.filter(d=>S.actor.allDepartments||d==='All'||d===S.actor.department).map(d=>'<option '+(d===S.reportDepartment?'selected':'')+'>'+d+'</option>').join('')+'</select>'+
 '<input class="'+btn+'" style="width:110px" type="number" min="2020" max="2100" value="'+h(S.reportYear)+'" onchange="companyDailyFilter(\'year\',this.value)" aria-label="Year">'+
 '<select class="'+btn+'" onchange="companyDailyFilter(\'quarter\',this.value)">'+['All','1','2','3','4'].map(x=>'<option '+(x===S.reportQuarter?'selected':'')+' value="'+x+'">'+(x==='All'?'All quarters':'Q'+x)+'</option>').join('')+'</select>'+
 '<select class="'+btn+'" onchange="companyDailyFilter(\'month\',this.value)">'+['All',...Array.from({length:12},(_,i)=>String(i+1).padStart(2,'0'))].map(x=>'<option '+(x===S.reportMonth?'selected':'')+'>'+x+'</option>').join('')+'</select></div>'+
 '<div class="text-xs text-slate-500">'+visible.length+' reports · '+visible.filter(x=>x.pmStatus==='Submitted').length+' evening results submitted</div>'+
 visible.sort((a,b)=>b.date.localeCompare(a.date)).slice(0,250).map(r=>'<div class="border rounded-lg p-3 flex flex-wrap justify-between gap-3"><div><b>'+h(r.date)+' · '+h(S.staff.find(s=>s.id===r.userId)?.name||'Employee')+'</b><p class="text-xs text-gray-500">'+h(r.department)+' · AM '+h(r.amStatus)+' · PM '+h(r.pmStatus)+' · '+h(r.reviewStatus)+'</p><div class="text-xs">'+(r.results||[]).map(x=>h(taskById(x.id)?.title||'Task')+': '+h(x.status)).join(' · ')+'</div></div>'+
 (r.pmStatus==='Submitted'&&r.reviewStatus!=='Reviewed'?'<button class="'+btn+'" onclick="companyDailyReview(\''+h(r.id)+'\')">Review</button>':'')+'</div>').join('')+'</section>';
}
function selectOptions(values,chosen){return values.map(x=>'<option value="'+h(x)+'" '+(chosen===x?'selected':'')+'>'+h(x)+'</option>').join('')}
function taskForm(id){
 const t=taskById(id)||{},isEdit=!!t.id;
 const editable=!isEdit||S.actor.allDepartments||S.actor.canReview&&t.department===S.actor.department;
 const assigneeId=t.assigneeId||S.actor.id,department=S.staff.find(x=>x.id===assigneeId)?.department||S.actor.department;
 const cats=S.categories[department]||['Other'];
 return '<form id="companyDailyTaskForm" onsubmit="companyDailySave(event)" class="space-y-3">'+
 '<input type="hidden" name="id" value="'+h(t.id||'')+'"><label class="block text-xs font-bold">Task / Deliverable<input name="title" required maxlength="180" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.title||'')+'" '+(!editable?'readonly':'')+'></label>'+
 '<label class="block text-xs font-bold">Description / Brief<textarea name="description" maxlength="1200" rows="3" class="block w-full border rounded-lg p-2 mt-1" '+(!editable?'readonly':'')+'>'+h(t.description||'')+'</textarea></label>'+
 '<div class="grid grid-cols-2 gap-3"><label class="text-xs font-bold">Assignee<select id="companyAssignee" name="assigneeId" class="block w-full border rounded-lg p-2 mt-1" onchange="companyDailyAssigneeChange(this.value)" '+(isEdit?'disabled':'')+'>'+S.staff.filter(s=>S.categories[s.department]).map(s=>'<option value="'+h(s.id)+'" '+(String(s.id)===String(assigneeId)?'selected':'')+'>'+h(s.name)+' · '+h(s.department)+'</option>').join('')+'</select></label>'+
 '<label class="text-xs font-bold">Category<select id="companyCategory" name="category" class="block w-full border rounded-lg p-2 mt-1" '+(!editable?'disabled':'')+'>'+selectOptions(cats,t.category||cats[0])+'</select></label>'+
 '<label class="text-xs font-bold">Priority<select name="priority" class="block w-full border rounded-lg p-2 mt-1" '+(!editable?'disabled':'')+'>'+selectOptions(['Low','Medium','High','Urgent'],t.priority||'Medium')+'</select></label>'+
 '<label class="text-xs font-bold">Deadline<input name="dueDate" type="date" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.dueDate||'')+'" '+(!editable?'readonly':'')+'></label>'+
 '<label class="text-xs font-bold">Status<select name="status" class="block w-full border rounded-lg p-2 mt-1">'+selectOptions(['Not Started','In Progress','Completed','Blocked','Cancelled'],t.status||'Not Started')+'</select></label>'+
 '<label class="text-xs font-bold">Progress (%)<input name="progress" type="number" min="0" max="100" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.progress||0)+'"></label></div>'+
 '<label class="block text-xs font-bold">Related customer / project / order<input name="relatedRef" maxlength="200" class="block w-full border rounded-lg p-2 mt-1" value="'+h(t.relatedRef||'')+'" '+(!editable?'readonly':'')+'></label>'+
 '<label class="block text-xs font-bold">Work result / update<textarea name="result" maxlength="1200" class="block w-full border rounded-lg p-2 mt-1">'+h(t.result||'')+'</textarea></label>'+
 (isEdit?'<p class="text-xs text-gray-500">Department: '+h(t.department)+' · Request: '+h(t.requestStatus)+'</p>':'<p class="text-xs text-amber-800">Cross-department tasks require the receiving manager’s approval before assignment.</p>')+
 '<div class="flex gap-2 justify-end"><button type="button" class="'+btn+'" onclick="closeModal()">Cancel</button><button class="'+solid+'" type="submit">Save Task</button></div></form>';
}
window.companyDailyOpenTask=id=>openModal(id?'Update Daily Work Task':'New Daily Work Task / Support Request',taskForm(id));
window.companyDailyAssigneeChange=id=>{const dep=S.staff.find(x=>String(x.id)===String(id))?.department||'Sales',box=document.getElementById('companyCategory');if(box)box.innerHTML=selectOptions(S.categories[dep]||['Other'],'')};
window.companyDailySave=async ev=>{ev.preventDefault();const t=Object.fromEntries(new FormData(ev.target).entries());if(t.id&&!t.assigneeId)t.assigneeId=taskById(t.id)?.assigneeId;try{await api('company_save_task',t);closeModal();say('Daily Work task saved');await load()}catch(e){say(e.message,true)}};
window.companyDailyTab=tab=>{S.tab=tab;render()};
window.companyDailyDate=value=>{S.date=value;S.selected=[];render()};
window.companyDailySearch=value=>{S.search=value;render();const input=document.getElementById('companySearch');if(input){input.focus();input.setSelectionRange(value.length,value.length)}};
window.companyDailySubmitAM=async()=>{
 const ids=[...root().querySelectorAll('[data-company-am]:checked')].map(x=>x.value);
 if(!ids.length)return say('Choose at least one approved task',true);
 if(!confirm('Submit Morning Plan with '+ids.length+' task(s)?'))return;
 try{await api('company_submit_am',{date:S.date,taskIds:ids});say('Morning Plan submitted');S.selected=[];await load()}catch(e){say(e.message,true)}
};
window.companyDailySubmitPM=async()=>{
 const results=[...root().querySelectorAll('[data-company-pm]')].map(row=>({id:row.dataset.companyPm,status:row.querySelector('[data-pm="status"]')?.value,result:row.querySelector('[data-pm="result"]')?.value,nextStep:row.querySelector('[data-pm="nextStep"]')?.value}));
 if(!results.length)return say('No planned tasks to report',true);
 if(!confirm('Submit Evening Result for '+S.date+'?'))return;
 try{await api('company_submit_pm',{date:S.date,results});say('Evening Result submitted');await load()}catch(e){say(e.message,true)}
};
window.companyDailyDecide=async(id,decision)=>{if(!confirm(decision+' this support request?'))return;try{await api('company_decide_request',{id,decision});say('Support request '+decision.toLowerCase()+'d');await load()}catch(e){say(e.message,true)}};
window.companyDailyReview=async id=>{const decision=confirm('Mark this Evening Result as reviewed? Select Cancel to request changes.')?'Reviewed':'Changes Requested';const comment=prompt('Management comment (optional)');if(comment===null)return;try{await api('company_review',{id,status:decision,comment});say('Manager review saved');await load()}catch(e){say(e.message,true)}};
window.companyDailyFilter=(field,value)=>{if(field==='department')S.reportDepartment=value;if(field==='year')S.reportYear=value;if(field==='quarter')S.reportQuarter=value;if(field==='month')S.reportMonth=value;render()};
window.companyDailyRefresh=load;
const oldNav=window.navItems;
if(typeof oldNav==='function')window.navItems=function(){const items=oldNav.apply(this,arguments);if(allowed()&&!items.some(x=>x[0]===PAGE)){const index=items.findIndex(x=>x[0]==='sales-daily');items.splice(index<0?items.length:index+1,0,[PAGE,'Daily Work · All Departments','☷'])}return items};
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
