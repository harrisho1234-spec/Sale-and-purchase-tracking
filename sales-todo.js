// Sales task manager; persisted in Google Sheets through the authenticated daily proxy.
(function(){
'use strict';
const PAGE='sales-todo';
const h=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const manager=()=>['manager','admin','super_admin'].includes(state?.profile?.role||'');
const permitted=()=>manager()||state?.profile?.role==='sales';
let items=[],people=[],loaded=false,saving=false,newTaskId='';
const api=async(action,payload={})=>{const r=await db.functions.invoke('sales-daily-google-proxy',{body:{action,payload}});if(r.error)throw Error(r.error.message||'Connection error');if(!r.data?.ok)throw Error(r.data?.error||'Unable to load tasks');return r.data.data};
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const box=()=>document.getElementById('content');
const field=(name,label,type='text',value='')=>'<label class="text-xs font-semibold">'+label+'<input id="todo_'+name+'" type="'+type+'" class="block border rounded-lg px-3 py-2 w-full mt-1 text-sm" value="'+h(value)+'"></label>';
function render(){
 const closed=x=>['Completed','Cancelled'].includes(x.status),overdue=x=>!closed(x)&&x.dueDate&&x.dueDate<today();
 box().innerHTML='<div class="max-w-6xl mx-auto space-y-4"><div class="bg-white rounded-2xl border p-4 flex flex-wrap justify-between gap-3"><div><h2 class="text-xl font-bold">Sales To-Do List</h2><p class="text-xs text-gray-500">Assignments, deadlines and progress · Google Sheets</p></div>'+'<button class="bg-black text-white rounded-xl px-4 py-2 text-sm" onclick="openSalesTodo()">+ Add Task</button>'+'</div>'+
 '<div class="grid grid-cols-3 gap-2">'+[['Total',items.length],['Completed',items.filter(x=>x.status==='Completed').length],['Overdue',items.filter(overdue).length]].map(([k,v])=>'<div class="bg-white border rounded-xl p-3"><div class="text-xs text-gray-500">'+k+'</div><b class="text-xl">'+v+'</b></div>').join('')+'</div>'+
 '<div class="grid gap-3">'+(items.length?items.map(t=>'<div class="bg-white rounded-xl border p-4"><div class="flex justify-between gap-2"><div><b>'+h(t.title)+'</b><div class="text-xs text-gray-500 mt-1">'+h(t.assignee)+' · '+h(t.startDate)+' → '+h(t.dueDate||'No deadline')+'</div></div><span class="text-xs font-bold '+(overdue(t)?'text-red-600':'text-gray-600')+'">'+(overdue(t)?'OVERDUE':h(t.priority))+'</span></div>'+
 (t.description?'<p class="text-sm mt-2">'+h(t.description)+'</p>':'')+'<div class="flex items-center justify-between gap-2 text-xs mt-3"><span>'+h(t.status)+' · '+t.progress+'%</span><button class="border rounded-lg px-3 py-1.5" onclick="openSalesTodo(\''+h(t.id)+'\')">Update</button></div><div class="h-2 bg-gray-100 rounded-full mt-2 overflow-hidden"><div class="h-full bg-amber-600 rounded-full" style="width:'+t.progress+'%"></div></div>'+(t.remarks?'<p class="text-xs text-gray-500 mt-2">'+h(t.remarks)+'</p>':'')+'</div>').join(''):'<div class="bg-white border rounded-xl p-8 text-gray-500 text-center">No assigned tasks yet.</div>')+'</div></div>';
}
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
 '<label class="text-xs font-semibold block mt-3">Remarks<textarea id="todo_remarks" class="block border rounded-lg p-2 w-full mt-1">'+h(t.remarks||'')+'</textarea></label>'+
 '<div class="mt-4 flex gap-2"><button id="todoSaveButton" class="bg-black text-white rounded-xl px-4 py-2 disabled:opacity-50" onclick="saveSalesTodo(\''+h(t.id||'')+'\')">Save Task</button><button class="border rounded-xl px-4 py-2" onclick="closeModal()">Cancel</button></div>');
};
window.saveSalesTodo=async id=>{
 if(saving)return;
 const get=k=>document.getElementById('todo_'+k)?.value||'';
 const payload={id:id||newTaskId,title:get('title'),startDate:get('startDate'),dueDate:get('dueDate'),assigneeId:get('assigneeId'),priority:get('priority'),status:get('status'),progress:Number(get('progress')),description:get('description'),remarks:get('remarks')};
 if(!payload.title.trim())return showToast('Task title required','err');
 saving=true;const btn=document.getElementById('todoSaveButton');if(btn){btn.disabled=true;btn.textContent='Saving…'}
 try{await api('todo_save',payload);closeModal();newTaskId='';showToast('Task saved');await window.loadSalesTodo()}catch(e){showToast(e.message,'err')}finally{saving=false;if(btn){btn.disabled=false;btn.textContent='Save Task'}}
};
window.loadSalesTodo=async()=>{if(state.page!==PAGE)return;box().innerHTML='<div class="p-8">Loading Sales To-Do from Google Sheets…</div>';try{const x=await api('todo_list');items=x.items||[];people=x.people||[];loaded=true;render()}catch(e){box().innerHTML='<div class="p-5 bg-red-50 border text-red-700">'+h(e.message)+' <button onclick="loadSalesTodo()" class="underline">Retry</button></div>'}};
const oldNav=window.navItems;if(typeof oldNav==='function')window.navItems=function(){const list=oldNav.apply(this,arguments)||[];if(permitted()&&!list.some(x=>x[0]===PAGE))list.push([PAGE,'Sales To-Do','☑']);return list};
const oldGo=window.go;window.go=async function(page){if(page!==PAGE)return oldGo.apply(this,arguments);if(!permitted())return;state.page=PAGE;renderNav();document.getElementById('pageTitle').textContent='Sales To-Do';document.getElementById('pageSubtitle').textContent='Assigned tasks and progress';await window.loadSalesTodo()};
})();