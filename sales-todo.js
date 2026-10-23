// Sales task manager; persisted in Google Sheets through the authenticated daily proxy.
(function(){
'use strict';
const PAGE='sales-todo';
const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const manager=()=>['manager','admin','super_admin'].includes(state?.profile?.role||'');
const permitted=()=>manager()||state?.profile?.role==='sales';
let items=[],people=[],loaded=false,saving=false,newTaskId='',query='',statusFilter='Active',priorityFilter='All',sortMode='due';
const api=async(action,payload={})=>{const r=await db.functions.invoke('sales-daily-google-proxy',{body:{action,payload}});if(r.error)throw Error(r.error.message||'Connection error');if(!r.data?.ok)throw Error(r.data?.error||'Unable to load tasks');return r.data.data};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const box=()=>document.getElementById('content');
const dayDiff=d=>d?Math.round((Date.parse(d+'T00:00:00Z')-Date.parse(today()+'T00:00:00Z'))/86400000):null;
const alertFor=t=>{
 if(t.status==='Cancelled')return{label:'Cancelled',kind:'cancelled'};
 if(t.status==='Completed'||!t.dueDate)return null;
 const days=dayDiff(t.dueDate);
 if(days< -3)return{label:'Overdue '+Math.abs(days)+' days · Management follow-up',kind:'critical'};
 if(days<0)return{label:'Overdue '+Math.abs(days)+' days',kind:'overdue'};
 if(days===0)return{label:'Due today',kind:'today'};
 if(days===1)return{label:'Due tomorrow',kind:'tomorrow'};
 return null;
};
const field=(name,label,type='text',value='')=>'<label class="text-xs font-semibold">'+label+'<input id="todo_'+name+'" type="'+type+'" class="block border rounded-lg px-3 py-2 w-full mt-1 text-sm" value="'+h(value)+'"></label>';
window.filterSalesTodo=()=>{
 const active=document.activeElement?.id,caret=active==='todoSearch'?document.activeElement.selectionStart:null;
 query=document.getElementById('todoSearch')?.value||'';
 statusFilter=document.getElementById('todoStatusFilter')?.value||'Active';
 priorityFilter=document.getElementById('todoPriorityFilter')?.value||'All';
 sortMode=document.getElementById('todoSort')?.value||'due';render();
 if(active==='todoSearch'){const input=document.getElementById('todoSearch');input?.focus();if(caret!==null)input?.setSelectionRange(caret,caret)}
};
window.openSalesTodoHistory=async id=>{
 try{const data=await api('todo_history',{id});const rows=data.events||[];
 openModal('Task Progress History','<div class="space-y-3 max-h-[65vh] overflow-auto">'+(rows.length?rows.map(e=>'<div class="border-b pb-3 text-xs"><b>'+h(e.timestamp)+' · '+h(e.actor)+'</b><p class="mt-1">Status: '+h(e.status)+' · Progress: '+h(e.progress)+'%</p><p class="mt-1">'+h(e.remarks||'')+'</p></div>').join(''):'<p>No progress updates recorded yet.</p>')+'</div>');
 }catch(e){showToast(e.message,'err')}
};
window.addTodoToDailyPlan=id=>{
 const task=items.find(x=>x.id===id);if(!task)return;
 if(state?.profile?.role!=='sales')return showToast('Only Sales can add tasks to their Daily Plan','err');
 sessionStorage.setItem('salesDailyTodoDraft',JSON.stringify({sourceTaskId:task.id,plan:task.title,category:'Other',priority:task.priority,plannedFollowup:task.dueDate||''}));
 if(typeof window.go==='function')window.go('sales-daily');
};
function render(){
 const closed=x=>['Completed','Cancelled'].includes(x.status),overdue=x=>!closed(x)&&x.dueDate&&x.dueDate<today();
 const filtered=items.filter(t=>{
  const q=query.trim().toLowerCase();
  if(q&&![t.title,t.description,t.assignee,t.remarks].some(v=>String(v||'').toLowerCase().includes(q)))return false;
  if(priorityFilter!=='All'&&t.priority!==priorityFilter)return false;
  if(statusFilter==='Active'&&closed(t))return false;
  if(statusFilter==='Overdue'&&!overdue(t))return false;
  if(!['Active','Overdue','All'].includes(statusFilter)&&t.status!==statusFilter)return false;
  return true;
 }).sort((a,b)=>sortMode==='priority'?({High:0,Medium:1,Low:2}[a.priority]??9)-({High:0,Medium:1,Low:2}[b.priority]??9):
 sortMode==='recent'?String(b.updatedAt).localeCompare(String(a.updatedAt)):String(a.dueDate||'9999').localeCompare(String(b.dueDate||'9999')));
 const alerts=items.map(t=>({t,a:alertFor(t)})).filter(x=>x.a);
 const alertPanel=alerts.length?'<div class="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3"><b class="text-sm">Task alerts · '+alerts.length+'</b><div class="mt-2 grid gap-1">'+alerts.map(({t,a})=>'<div class="text-xs flex flex-wrap gap-2"><span class="'+(a.kind==='overdue'||a.kind==='critical'?'text-red-700':'text-amber-800')+' font-bold">'+h(a.label)+'</span><span>'+h(t.assignee)+' · '+h(t.title)+'</span>'+(a.kind==='cancelled'&&t.remarks?'<span>Reason: '+h(t.remarks)+'</span>':'')+'</div>').join('')+'</div></div>':'';
 box().innerHTML='<div data-sales-todo-root class="max-w-6xl mx-auto space-y-4"><div class="bg-white rounded-2xl border p-4 flex flex-wrap justify-between gap-3"><div><h2 class="text-xl font-bold">Sales To-Do List</h2><p class="text-xs text-gray-500">Assignments, deadlines and progress · Google Sheets</p></div>'+'<button class="bg-black text-white rounded-xl px-4 py-2 text-sm" onclick="openSalesTodo()">+ Add Task</button>'+'</div>'+
 alertPanel+'<div class="bg-white border rounded-xl p-3 grid sm:grid-cols-4 gap-2"><input id="todoSearch" class="border rounded-lg p-2 text-sm" placeholder="Search tasks" value="'+h(query)+'" oninput="filterSalesTodo()"><select id="todoStatusFilter" class="border rounded-lg p-2 text-sm" onchange="filterSalesTodo()">'+['Active','All','Pending','In Progress','Completed','Cancelled','Overdue'].map(v=>'<option '+(v===statusFilter?'selected':'')+'>'+v+'</option>').join('')+'</select><select id="todoPriorityFilter" class="border rounded-lg p-2 text-sm" onchange="filterSalesTodo()">'+['All','High','Medium','Low'].map(v=>'<option '+(v===priorityFilter?'selected':'')+'>'+v+'</option>').join('')+'</select><select id="todoSort" class="border rounded-lg p-2 text-sm" onchange="filterSalesTodo()">'+[['due','Deadline'],['priority','Priority'],['recent','Recently Updated']].map(v=>'<option value="'+v[0]+'" '+(v[0]===sortMode?'selected':'')+'>'+v[1]+'</option>').join('')+'</select></div>'+'<div class="grid grid-cols-3 gap-2">'+[['Total',items.length],['Completed',items.filter(x=>x.status==='Completed').length],['Overdue',items.filter(overdue).length]].map(([k,v])=>'<div class="bg-white border rounded-xl p-3"><div class="text-xs text-gray-500">'+k+'</div><b class="text-xl">'+v+'</b></div>').join('')+'</div>'+
 '<div class="grid gap-3">'+(filtered.length?filtered.map(t=>'<div class="bg-white rounded-xl border p-4"><div class="flex justify-between gap-2"><div><b>'+h(t.title)+'</b><div class="text-xs text-gray-500 mt-1">'+h(t.assignee)+' · '+h(t.startDate)+' → '+h(t.dueDate||'No deadline')+'</div></div><span class="text-xs font-bold '+(overdue(t)?'text-red-600':'text-gray-600')+'">'+(overdue(t)?'OVERDUE':h(t.priority))+'</span></div>'+
 (t.description?'<p class="text-sm mt-2">'+h(t.description)+'</p>':'')+'<div class="flex items-center justify-between gap-2 text-xs mt-3"><span>'+h(t.status)+' · '+t.progress+'%</span><div class="flex gap-2"><button class="border rounded-lg px-3 py-1.5" onclick="openSalesTodoHistory(\''+h(t.id)+'\')">History</button>'+(state?.profile?.role==='sales'?'<button class="border rounded-lg px-3 py-1.5" onclick="addTodoToDailyPlan(\''+h(t.id)+'\')">Add to Daily Plan</button>':'')+'<button class="bg-[#211d18] text-white rounded-lg px-3 py-1.5" onclick="quickSalesTodo(\''+h(t.id)+'\')">Quick Update</button><button class="border rounded-lg px-3 py-1.5" onclick="openSalesTodo(\''+h(t.id)+'\')">Edit Details</button>'+(manager()?'<button class="border border-red-200 text-red-700 rounded-lg px-3 py-1.5" onclick="deleteSalesTodo(\''+h(t.id)+'\')">Delete</button>':'')+'</div></div><div class="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden"><div class="h-full bg-amber-600 rounded-full" style="width:'+t.progress+'%"></div></div>'+(t.remarks?'<p class="text-xs text-gray-500 mt-2">'+h(t.remarks)+'</p>':'')+'</div>').join(''):'<div class="bg-white border rounded-xl p-8 text-gray-500 text-center">No assigned tasks yet.</div>')+'</div></div>';
}
window.quickSalesTodo=id=>{
 const t=items.find(x=>x.id===id);if(!t)return;
 const choice=['Pending','In Progress','Completed','Cancelled'];
 openModal('Quick Update · '+h(t.title),
 '<div class="space-y-4"><div class="text-xs text-gray-500">Change status and progress without reopening task details.</div>'+
 '<label class="text-sm font-semibold block">Status<select id="todoQuickStatus" onchange="setQuickTodoStatus(this.value)" class="block w-full border rounded-xl p-3 mt-2 text-sm bg-white">'+choice.map(v=>'<option value="'+h(v)+'" '+(t.status===v?'selected':'')+'>'+h(v)+'</option>').join('')+'</select></label>'+
 '<label class="text-sm font-semibold block">Progress: <span id="todoQuickPercent">'+Number(t.progress||0)+'</span>%<input id="todoQuickProgress" type="range" min="0" max="100" step="5" value="'+Number(t.progress||0)+'" oninput="document.getElementById(\'todoQuickPercent\').textContent=this.value" class="w-full mt-3"></label>'+
 '<div class="flex flex-wrap gap-2">'+[0,25,50,75,100].map(n=>'<button type="button" class="rounded-lg border px-3 py-2 text-xs" onclick="setQuickTodoProgress('+n+')">'+n+'%</button>').join('')+'</div>'+
 '<label class="text-xs font-semibold block">Progress note / Cancellation reason<textarea id="todoQuickRemarks" rows="3" class="mt-1 block w-full border rounded-xl p-3" placeholder="What changed?">'+h(t.remarks||'')+'</textarea></label>'+
 '<div class="flex gap-2"><button id="todoQuickSave" class="bg-black text-white rounded-xl px-5 py-2.5" onclick="saveQuickSalesTodo(\''+h(t.id)+'\')">Save Progress</button><button class="border rounded-xl px-4 py-2" onclick="closeModal()">Cancel</button></div></div>');
 window.todoQuickStatus=t.status;
};
window.setQuickTodoStatus=value=>{
 window.todoQuickStatus=value;
 if(value==='Completed')window.setQuickTodoProgress(100);
};
window.setQuickTodoProgress=n=>{const slider=document.getElementById('todoQuickProgress');if(slider)slider.value=n;const label=document.getElementById('todoQuickPercent');if(label)label.textContent=n};
window.saveQuickSalesTodo=async id=>{
 if(saving)return;
 const t=items.find(x=>x.id===id);if(!t)return;
 const status=window.todoQuickStatus||t.status,progress=Number(document.getElementById('todoQuickProgress')?.value||0);
 const remarks=document.getElementById('todoQuickRemarks')?.value.trim()||'';
 if(status==='Cancelled'&&!remarks)return showToast('Cancellation reason required','err');
 saving=true;const button=document.getElementById('todoQuickSave');if(button){button.disabled=true;button.textContent='Saving…'}
 try{await api('todo_save',{id,status,progress,remarks});closeModal();showToast('Progress updated');await window.loadSalesTodo(true)}
 catch(e){showToast(e.message,'err')}finally{saving=false;if(button){button.disabled=false;button.textContent='Save Progress'}}
};
window.openSalesTodo=id=>{
 const t=items.find(x=>x.id===id)||{},newTask=!t.id;
 newTaskId=newTask?(crypto?.randomUUID?.()||('todo-'+Date.now()+'-'+Math.random().toString(36).slice(2))):'';
 if(newTask&&!permitted())return;
 const sel=(id,label,values,current)=>'<label class="text-xs font-semibold">'+label+'<select id="todo_'+id+'" class="block border rounded-lg px-3 py-2 w-full mt-1 text-sm">'+values.map(v=>'<option value="'+h(v.value??v)+'" '+((v.value??v)===current?'selected':'')+'>'+h(v.label??v)+'</option>').join('')+'</select></label>';
 const opts=people.map(p=>({value:p.id,label:p.name}));
 openModal(newTask?'Assign Sales Task':'Update Task','<div class="grid sm:grid-cols-2 gap-3">'+field('title','Task Title','text',t.title||'')+field('startDate','Start Date','date',t.startDate||today())+field('dueDate','Due Date','date',t.dueDate||'')+
 (manager()?sel('assigneeId','Salesperson',opts,t.assigneeId||opts[0]?.value):'<input type="hidden" id="todo_assigneeId" value="'+h(t.assigneeId||'')+'">')+
 sel('priority','Priority',['High','Medium','Low'],t.priority||'Medium')+sel('status','Status',['Pending','In Progress','Completed','Cancelled'],t.status||'Pending')+field('progress','Progress %','number',t.progress??0)+'</div>'+
 '<label class="text-xs font-semibold block mt-3">Description<textarea id="todo_description" class="block border rounded-lg p-2 w-full mt-1">'+h(t.description||'')+'</textarea></label>'+
 '<label class="text-xs font-semibold block mt-3">Remarks (required for cancellation)<textarea id="todo_remarks" class="block border rounded-lg p-2 w-full mt-1">'+h(t.remarks||'')+'</textarea></label>'+
 '<div class="mt-4 flex gap-2"><button id="todoSaveButton" class="bg-black text-white rounded-xl px-4 py-2 disabled:opacity-50" onclick="saveSalesTodo(\''+h(t.id||'')+'\')">Save Task</button><button class="border rounded-xl px-4 py-2" onclick="closeModal()">Cancel</button></div>');
};
window.deleteSalesTodo=async id=>{
 if(!manager())return showToast('Management permission required','err');
 const item=items.find(t=>t.id===id);if(!item)return;
 if(!confirm('Delete task: '+item.title+'? This cannot be undone.'))return;
 try{await api('todo_delete',{id});showToast('Task deleted; audit retained');await window.loadSalesTodo()}catch(e){showToast(e.message,'err')}
};
window.saveSalesTodo=async id=>{
 if(saving)return;
 const get=k=>document.getElementById('todo_'+k)?.value||'';
 const payload={id:id||newTaskId,title:get('title'),startDate:get('startDate'),dueDate:get('dueDate'),assigneeId:get('assigneeId'),priority:get('priority'),status:get('status'),progress:Number(get('progress')),description:get('description'),remarks:get('remarks')};
 if(!payload.title.trim())return showToast('Task title required','err');
 if(payload.status==='Cancelled'&&!payload.remarks.trim())return showToast('Enter a cancellation reason in Remarks','err');
 saving=true;const btn=document.getElementById('todoSaveButton');if(btn){btn.disabled=true;btn.textContent='Saving…'}
 try{await api('todo_save',payload);closeModal();newTaskId='';showToast('Task saved');await window.loadSalesTodo()}catch(e){showToast(e.message,'err')}finally{saving=false;if(btn){btn.disabled=false;btn.textContent='Save Task'}}
};
let todoRequestSequence=0;
window.loadSalesTodo=async(force=false)=>{
 if(state.page!==PAGE)return;
 const user=state.user?.id||null;
 if(cacheUser!==user){cacheUser=user;items=[];people=[];loaded=false;lastLoaded=0;todoRequestSequence++;}
 if(loaded){render();if(!force&&Date.now()-lastLoaded<FRESH_MS)return;}
 const seq=++todoRequestSequence;
 if(!loaded)box().innerHTML='<div data-sales-todo-root class="max-w-6xl mx-auto space-y-3 p-4"><div class="text-sm text-gray-500">Opening your tasks…</div><button class="border rounded-lg px-3 py-2 text-sm" onclick="loadSalesTodo(true)">Retry loading</button></div>';
 let timer;
 try{
  const result=await Promise.race([
   api('todo_list'),
   new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Google Sheets is taking too long to respond. Please retry.')),18000)})
  ]);
  if(seq!==todoRequestSequence||state.page!==PAGE||state.user?.id!==user)return;
  items=result.items||[];people=result.people||[];loaded=true;lastLoaded=Date.now();render();
 }catch(err){
  if(seq!==todoRequestSequence||state.page!==PAGE||state.user?.id!==user)return;
  if(loaded){render();showToast('Task refresh failed: '+err.message,'err')}
  else box().innerHTML='<div data-sales-todo-root class="max-w-6xl mx-auto bg-white rounded-xl border p-6"><b>Unable to load Sales To-Do</b><p class="text-sm text-gray-600 mt-2">'+h(err.message)+'</p><button onclick="loadSalesTodo(true)" class="mt-3 border rounded-lg px-4 py-2">Retry</button></div>';
 }finally{clearTimeout(timer)}
};
// Other legacy screens render asynchronously and may finish after navigation.
// Keep Sales To-Do visible if an older page replaces its content.
let todoGuard=null,restoringTodo=false;
function installTodoGuard(){
 const container=box();
 if(todoGuard||!container)return;
 todoGuard=new MutationObserver(()=>{
  if(state.page!==PAGE||restoringTodo)return;
  // An earlier page might append content without clearing the To-Do root.
  const roots=container.querySelectorAll(':scope > [data-sales-todo-root]');
  if(roots.length===1&&container.children.length===1)return;
  restoringTodo=true;
  try{
   if(loaded)render();
   else container.innerHTML='<div data-sales-todo-root class="max-w-6xl mx-auto bg-white rounded-xl border p-5 text-sm">Opening Sales To-Do… <button onclick="loadSalesTodo(true)" class="underline ml-2">Retry</button></div>';
  }finally{restoringTodo=false}
 });
 todoGuard.observe(container,{childList:true,subtree:true});
}
const oldNav=window.navItems;if(typeof oldNav==='function')window.navItems=function(){const list=oldNav.apply(this,arguments)||[];if(permitted()&&!list.some(x=>x[0]===PAGE))list.push([PAGE,'Sales To-Do','☑']);return list};
const oldGo=window.go;window.go=async function(page){
 if(page!==PAGE)return oldGo.apply(this,arguments);
 if(!permitted())return;
 state.page=PAGE;
 installTodoGuard();
 renderNav();
 document.getElementById('pageTitle').textContent='Sales To-Do';
 document.getElementById('pageSubtitle').textContent='Assigned tasks and progress';
 await window.loadSalesTodo();
};
})();