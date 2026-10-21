// Management: authorized, read-only Sales Activity by recorded action timestamp.
(function(){
'use strict';
const keys=['sales_activity.view_own','sales_activity.view_team','sales_activity.view_all'];
const allowed=()=>state?.profile?.role==='super_admin'||keys.some(k=>typeof window.hasAppPermission==='function'&&window.hasAppPermission(k));
const h=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const names={'customer_activity':'Customer activity','showroom_visit':'Showroom visit','online_inquiry':'Online inquiry','customer_followup':'Customer follow-up','quotation':'Quotation imported','sales_order':'Sales Order / SR','tk_rk':'TK/RK conversion','order_event':'Order activity','delivery':'Delivery Order','payment':'Payment','credit_note':'Credit Note'};
const symbols={'customer_activity':'◉','showroom_visit':'▣','online_inquiry':'◎','customer_followup':'◷','quotation':'▤','sales_order':'▥','tk_rk':'⌑','order_event':'◈','delivery':'▰','payment':'＄','credit_note':'↶'};
const today=()=>{
  const parts=new Intl.DateTimeFormat('en-US',{timeZone:'Asia/Phnom_Penh',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
  const part=n=>parts.find(x=>x.type===n)?.value||'';
  return part('year')+'-'+part('month')+'-'+part('day');
};
const daysAgo=(d,n)=>{const x=new Date(d+'T12:00:00Z');x.setUTCDate(x.getUTCDate()-n);return x.toISOString().slice(0,10)};
const ui={from:today(),to:today(),person:'',type:'',entries:[],people:[],scope:'own',truncated:false,seq:0};
const friendlyDate=d=>new Intl.DateTimeFormat('en-GB',{weekday:'short',year:'numeric',month:'short',day:'numeric'}).format(new Date(d+'T12:00:00Z'));
const clock=t=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Phnom_Penh',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date(t));
function scopeNotice(){
  if(ui.scope==='own')return 'Own activity only';
  if(ui.scope==='team')return 'Team: all Sales-role staff and your own actions; individual reporting lines are not configured.';
  return 'All staff with recorded activity (permission-controlled).';
}
function render(){
 if(state.page!=='sales-activity')return;
 const container=document.getElementById('content');
 if(!container)return;
 const rows=ui.entries;
 const used=new Set(rows.map(x=>x.actor_id));
 const grouped=new Map();
 for(const row of rows){const date=String(row.date||'').slice(0,10);if(!grouped.has(date))grouped.set(date,[]);grouped.get(date).push(row)}
 const filters='<div class="rounded-2xl border bg-white p-4 mb-4">'+
 '<div class="flex flex-wrap items-center justify-between gap-3"><div><h3 class="font-bold text-lg">Sales Activity</h3><p class="text-xs text-gray-500">Recorded actions · Cambodia time (UTC+7)</p></div>'+
 '<div class="flex gap-2"><button type="button" onclick="setSalesActivityRange(1)" class="px-3 py-2 rounded-xl border text-xs">Today</button><button type="button" onclick="setSalesActivityRange(7)" class="px-3 py-2 rounded-xl border text-xs">7 Days</button><button type="button" onclick="setSalesActivityRange(30)" class="px-3 py-2 rounded-xl border text-xs">30 Days</button></div></div>'+
 '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-4">'+
 '<label class="text-xs font-semibold">From<input id="actStart" type="date" value="'+h(ui.from)+'" class="block mt-1 border rounded-lg w-full p-2.5"></label>'+
 '<label class="text-xs font-semibold">To<input id="actEnd" type="date" value="'+h(ui.to)+'" class="block mt-1 border rounded-lg w-full p-2.5"></label>'+
 '<label class="text-xs font-semibold">Salesperson<select id="actPerson" class="block mt-1 border rounded-lg w-full p-2.5 bg-white"><option value="">All permitted staff</option>'+
 ui.people.map(x=>'<option value="'+h(x.id)+'" '+(ui.person===x.id?'selected':'')+'>'+h(x.name)+' · '+h(x.role)+'</option>').join('')+'</select></label>'+
 '<label class="text-xs font-semibold">Activity<select id="actType" class="block mt-1 border rounded-lg w-full p-2.5 bg-white"><option value="">All activities</option>'+
 Object.entries(names).map(([k,v])=>'<option value="'+h(k)+'" '+(ui.type===k?'selected':'')+'>'+h(v)+'</option>').join('')+'</select></label></div>'+
 '<div class="flex justify-between items-center gap-2 mt-3"><p class="text-[11px] text-gray-500">'+h(scopeNotice())+'</p><button id="actApply" type="button" class="text-sm font-semibold text-white bg-[#211d18] px-4 py-2 rounded-xl">Apply Filters</button></div></div>';
 const facts=[
 ['Recorded Actions',rows.length],['Active Staff',used.size],
 ['Customer Actions',rows.filter(x=>['customer_activity','showroom_visit','online_inquiry','customer_followup'].includes(x.type)).length],
 ['Sales / TK-RK',rows.filter(x=>['sales_order','tk_rk'].includes(x.type)).length]
 ];
 const stats='<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">'+facts.map(([k,v])=>
 '<div class="rounded-xl border bg-white p-4"><div class="text-[10px] font-bold uppercase text-gray-500">'+h(k)+'</div><div class="mt-2 text-2xl font-black">'+v+'</div></div>').join('')+'</div>';
 const dates=[...grouped.entries()].map(([date,actions])=>'<section class="bg-white border rounded-2xl overflow-hidden mb-4">'+
 '<div class="bg-[#f8f6f1] border-b p-4 flex justify-between gap-2"><b class="text-sm">'+h(friendlyDate(date))+'</b><span class="text-xs text-gray-500">'+actions.length+' actions</span></div>'+
 '<div class="divide-y">'+actions.map(e=>'<div class="flex items-start p-3 sm:p-4 gap-3">'+
 '<div class="h-10 w-10 shrink-0 flex justify-center items-center bg-gray-50 border rounded-xl">'+h(symbols[e.type]||'◈')+'</div>'+
 '<div class="flex-1 min-w-0"><div class="flex flex-wrap items-center gap-2"><b class="text-sm">'+h(e.actor_name||'Staff')+'</b>'+
 '<span class="bg-gray-100 px-2 py-0.5 rounded-lg text-[10px]">'+h(names[e.type]||e.type)+'</span>'+
 (e.provenance==='imported'?'<span class="text-amber-700 text-[10px]">Imported</span>':'')+'</div>'+
 '<p class="text-xs mt-1">'+h(e.details||'Action recorded')+'</p><p class="text-xs mt-1 text-gray-500">'+h(e.subject||'')+
 (e.document_no?' · '+h(e.document_no):'')+'</p></div>'+
 '<span class="shrink-0 font-mono text-xs text-gray-500">'+h(clock(e.timestamp))+'</span></div>').join('')+'</div></section>').join('');
 const note='<p class="text-[11px] text-gray-500 py-4">Shows only actions with a recorded user and timestamp. Times reflect when a record was created, not when a backdated visit or payment occurred. Calls outside the system and quotations without a verified actor are not inferred.</p>';
 container.innerHTML='<div class="max-w-6xl mx-auto">'+filters+
 (ui.truncated?'<div class="bg-amber-50 border border-amber-200 p-3 rounded-xl text-xs mb-3">Showing 500 most recent actions. Narrow your filters to see more.</div>':'')+
 stats+(dates||'<div class="bg-white border rounded-xl p-10 text-sm text-center text-gray-500">No recorded activity for the selected period.</div>')+note+'</div>';
 const apply=document.getElementById('actApply');
 if(apply)apply.onclick=()=>{
   ui.from=document.getElementById('actStart').value;ui.to=document.getElementById('actEnd').value;
   ui.person=document.getElementById('actPerson').value;ui.type=document.getElementById('actType').value;
   window.reloadSalesActivity();
 };
}
window.setSalesActivityRange=function(n){
 ui.to=today();ui.from=daysAgo(ui.to,n-1);
 window.reloadSalesActivity();
};
window.reloadSalesActivity=async function(){
 if(!allowed())return showToast('Sales Activity permission required.','err');
 if(state.page!=='sales-activity')return;
 const elapsed=(new Date(ui.to+'T12:00:00Z')-new Date(ui.from+'T12:00:00Z'))/86400000;
 if(elapsed<0||elapsed>30)return showToast('Select up to 31 consecutive days.','err');
 const seq=++ui.seq;
 const content=document.getElementById('content');
 content.innerHTML='<div class="rounded-2xl border bg-white p-8 text-sm text-gray-500">Loading recorded Sales Activity…</div>';
 try{
   const r=await db.rpc('get_sales_activity_timeline',{
     p_start:ui.from,p_end:ui.to,p_actor:ui.person||null,p_action:ui.type||null,p_limit:500
   });
   if(r.error)throw r.error;
   if(seq!==ui.seq||state.page!=='sales-activity')return;
   const data=r.data||{};
   ui.entries=Array.isArray(data.activities)?data.activities:[];
   ui.people=Array.isArray(data.staff)?data.staff:[];
   ui.scope=data.scope||'own';ui.truncated=!!data.truncated;
   render();
 }catch(err){
   if(seq===ui.seq&&state.page==='sales-activity')
     content.innerHTML='<div class="border rounded-xl p-5 bg-red-50 text-red-700">'+h(err.message||'Activity unavailable')+'</div>';
 }
};
const oldNav=window.navItems;
if(typeof oldNav==='function'){
 window.navItems=function(){
   const items=oldNav.apply(this,arguments)||[];
   if(!allowed()||items.some(x=>x[0]==='sales-activity'))return items;
   const idx=items.findIndex(x=>x[0]==='sales-access'||x[0]==='users');
   if(idx<0)items.push(['sales-activity','Sales Activity','◷']);
   else items.splice(idx,0,['sales-activity','Sales Activity','◷']);
   return items;
 };
}
const oldAllowed=window.canAccessAppPage;
window.canAccessAppPage=function(page){
 if(page==='sales-activity')return allowed();
 return typeof oldAllowed==='function'?oldAllowed.apply(this,arguments):true;
};
const oldGo=window.go;
window.go=async function(page){
 if(page!=='sales-activity')return oldGo.apply(this,arguments);
 if(!allowed())return showToast('Sales Activity permission required.','err');
 state.page=page;renderNav();
 document.getElementById('pageTitle').textContent='Sales Activity';
 document.getElementById('pageSubtitle').textContent='Management · Daily salesperson activity';
 await window.reloadSalesActivity();
};
})();