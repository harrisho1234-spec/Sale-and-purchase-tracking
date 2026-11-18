// Additive cross-department target workspace. Does not modify invoices or financial totals.
(function(){
'use strict';
const X={S:null,year:null,uid:null,loaded:null,plan:null,busy:false,error:null,editorGoal:null};
const h=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const n=v=>Number.isFinite(Number(v))?Number(v):0;
const money=v=>'$'+n(v).toLocaleString('en-US',{maximumFractionDigits:2});
const role=()=>String(state?.profile?.role||'');
const manager=()=>['manager','admin','super_admin'].includes(role());
const approver=()=>['admin','super_admin'].includes(role());
const people=()=>X.loaded?.people||[];
const eligible=()=>people().filter(p=>p.eligible&&!p.internal);
const msg=(s,err)=>showToast(s,err?'err':undefined);
const pmap=()=>new Map(people().map(p=>[String(p.id),p]));
const kind=r=>String(r.sales_category||'').toLowerCase()==='project'?'PJ':
  ['RK','TK'].includes(String(r.business_code||'').toUpperCase())?String(r.business_code).toUpperCase():'OTHER';
function months(S){
 if(S.view==='year')return new Set(Array.from({length:12},(_,i)=>i+1));
 if(S.view==='quarter'){
  const qs=S.selectedQuarters===null?[1,2,3,4]:[...S.selectedQuarters];
  return new Set(qs.flatMap(q=>[q*3-2,q*3-1,q*3]));
 }
 return new Set(S.selectedMonths===null?Array.from({length:12},(_,i)=>i+1):[...S.selectedMonths]);
}
function yearWeight(S){
 const weights=Array.isArray(X.plan?.months)&&X.plan.months.length===12
   ?X.plan.months:Array(12).fill(100/12);
 const ms=months(S);
 return weights.reduce((sum,val,i)=>sum+(ms.has(i+1)?n(val):0),0)/100;
}
function reportRows(){
 const S=X.S;if(!S)return [];
 const activeMonths=months(S);
 // All visible source rows, not only original seller. Credit can cross departments.
 return (S.rows||[]).filter(r=>String(r.order_date||'').slice(0,4)===String(S.year)
   &&activeMonths.has(Number(String(r.order_date||'').slice(5,7)))&&kind(r)!=='OTHER');
}
function earnedCredit(){
 const staff=pmap(),overrides=new Map();
 (X.loaded?.credits||[]).forEach(a=>{
  const key=String(a.order_id);
  if(!overrides.has(key))overrides.set(key,[]);
  overrides.get(key).push({id:String(a.id),percentage:n(a.percentage)});
 });
 const credits=new Map(), rows=reportRows();
 let companyActual=0,attributed=0;
 for(const r of rows){
  const actual=n(r.actual_sales);companyActual+=actual;
  const allocated=overrides.get(String(r.order_id))||
    (r.sales_rep_id?[{id:String(r.sales_rep_id),percentage:100}]:[]);
  for(const share of allocated){
   const person=staff.get(share.id);
   if(!person?.eligible||person.internal)continue;
   const value=actual*share.percentage/100;
   credits.set(share.id,(credits.get(share.id)||0)+value);
   attributed+=value;
  }
 }
 return {credits,companyActual,attributed};
}
function panel(){
 const root=document.getElementById('salesTargetsPanel');
 if(!root)return null;
 let el=document.getElementById('salesTargetSharingPanel');
 if(!el){el=document.createElement('div');el.id='salesTargetSharingPanel';root.after(el)}
 return el;
}
function button(text,onclick,style){
 return '<button type="button" onclick="'+h(onclick)+'" class="rounded-lg border px-3 py-2 text-xs font-semibold '+(style||'bg-white')+'">'+h(text)+'</button>';
}
function draw(){
 const el=panel();if(!el||!manager())return;
 if(X.busy&&!X.loaded){el.innerHTML='<section class="card rounded-2xl p-4 mb-4 text-xs text-gray-500">Loading shared targets and sales credit…</section>';return}
 if(X.error){el.innerHTML='<section class="card rounded-2xl p-4 mb-4 text-xs text-amber-800">'+h(X.error)+' '+button('Retry','reloadSalesTargetSharing()')+'</section>';return}
 const data=X.loaded;if(!data)return;
 const summary=earnedCredit(),annualFactor=yearWeight(X.S),staff=pmap();
 const goals=(data.goals||[]).filter(g=>g.active);
 const goalCards=goals.map(g=>{
   const members=g.members||[];
   const earned=members.reduce((sum,m)=>sum+(summary.credits.get(String(m.id))||0),0);
   const target=n(g.annual_target)*annualFactor;
   const memberRows=g.mode==='split'?'<div class="mt-2 space-y-1">'+members.map(m=>{
    const person=staff.get(String(m.id));
    const t=target*n(m.percentage)/100,actual=summary.credits.get(String(m.id))||0;
    return '<div class="flex justify-between gap-2 text-[11px] border-t pt-1"><span>'+
      h(person?.name||'Staff')+' · '+n(m.percentage)+'%</span><span>'+money(actual)+' / '+money(t)+'</span></div>';
   }).join('')+'</div>':
   '<p class="text-[11px] text-gray-600 mt-2">'+members.map(m=>h(staff.get(String(m.id))?.name||'Staff')).join(' · ')+'</p>';
   return '<section class="border rounded-xl p-3 bg-white">'+
      '<div class="flex flex-wrap justify-between items-start gap-2"><div><b class="text-sm">'+h(g.label)+'</b>'+
      '<p class="text-[10px] text-gray-500">'+h(g.scope.replaceAll('_',' '))+' · '+(g.mode==='pooled'?'Combined goal':'Percentage split')+'</p></div>'+
      button('Edit','openSharedSalesGoal('+JSON.stringify(g.id)+')')+'</div>'+
      '<div class="flex justify-between mt-2 gap-2 text-sm"><span>'+money(earned)+' credited</span><b>'+money(target)+' target</b></div>'+
      '<div class="bg-gray-100 h-2 rounded-full overflow-hidden mt-2"><div class="bg-[#b58a36] h-full" style="width:'+Math.max(0,Math.min(100,target>0?earned/target*100:0))+'%"></div></div>'+
      '<p class="text-xs text-gray-600 mt-1">'+(target>0?(earned/target*100).toFixed(1)+'%':'—')+' achieved</p>'+memberRows+'</section>';
 }).join('');
 const planned=new Map((X.plan?.reps||[]).map(r=>[String(r.id),n(r.annual_target)]));
 const staffRows=eligible().filter(p=>planned.has(String(p.id))||summary.credits.has(String(p.id)))
  .sort((a,b)=>(summary.credits.get(String(b.id))||0)-(summary.credits.get(String(a.id))||0))
  .map(p=>'<tr class="border-t"><td class="p-2">'+h(p.name)+'<div class="text-[10px] text-gray-500">'+
    (p.showroom?'Showroom ':'')+(p.project?'Project':'')+(p.source==='target_only'?' · No login':'')+'</div></td>'+
    '<td class="p-2 text-right">'+(planned.has(String(p.id))?money(planned.get(String(p.id))*annualFactor):'—')+'</td>'+
    '<td class="p-2 text-right font-semibold">'+money(summary.credits.get(String(p.id))||0)+'</td></tr>').join('');
 const pending=data.requests||[];
 el.innerHTML='<section class="card rounded-2xl p-4 mb-4 space-y-4" id="sharedTargetWorkspace">'+
  '<div class="flex flex-wrap justify-between items-start gap-3"><div><h3 class="font-bold text-lg">Shared Targets & Sales Credit · '+h(X.year)+'</h3>'+
  '<p class="text-xs text-gray-600 mt-1">One staff identity can belong to Showroom and Project. Shared goals are reporting subgoals — not extra company revenue or extra company targets.</p>'+
  '</div><div class="flex flex-wrap gap-2">'+button('Staff & Departments','openSharedTargetPeople()')+
  button('+ Shared Target','openSharedSalesGoal(null)')+
  button('Share a Sale','openTargetCreditProposal()')+'</div></div>'+
  '<div class="grid sm:grid-cols-3 gap-2">'+
  [['Recognized company actual',summary.companyActual],['Allocated staff credit',summary.attributed],
   ['Unattributed / internal',summary.companyActual-summary.attributed]]
   .map(x=>'<div class="border rounded-xl bg-[#faf9f6] p-3"><p class="text-[10px] text-gray-500">'+h(x[0])+'</p><b>'+money(x[1])+'</b></div>').join('')+'</div>'+
  '<p class="text-[11px] text-gray-500">Using the selected months or quarters, across the authorized report data. Staff attribution is based on the existing Actual Sales events (including returns), not a new invoice calculation. Shared target results are not added together for the company total.</p>'+
  '<div><div class="flex items-center justify-between"><h4 class="font-semibold text-sm">Shared Goals</h4><span class="text-xs text-gray-500">'+goals.length+' active</span></div>'+
  '<div class="grid md:grid-cols-2 gap-2 mt-2">'+(goalCards||'<p class="text-xs text-gray-500">No shared goals set for this year.</p>')+'</div></div>'+
  '<div><h4 class="font-semibold text-sm mb-2">Individual credited achievement</h4>'+
  '<div class="overflow-auto max-h-64"><table class="w-full text-xs"><thead><tr class="bg-gray-50"><th class="text-left p-2">Staff</th><th class="text-right p-2">Existing personal target</th><th class="text-right p-2">Credited actual</th></tr></thead><tbody>'+
  (staffRows||'<tr><td colspan="3" class="p-3 text-gray-500">No individual target or credited sale.</td></tr>')+'</tbody></table></div></div>'+
  (pending.length?'<div><h4 class="font-semibold text-sm mb-2">Pending Sales Credit Approvals · '+pending.length+'</h4><div class="space-y-2">'+pending.map(r=>{
    const peopleLabel=(r.proposed||[]).map(a=>(staff.get(String(a.id))?.name||'Staff')+' '+n(a.percentage)+'%').join(' + ');
    return '<div class="flex flex-wrap justify-between gap-2 p-3 rounded-lg border text-xs"><div><b>'+h(r.order_id?.slice(0,8))+'</b> · '+h(peopleLabel)+
       '<div class="text-gray-500 mt-1">'+h(r.reason)+'</div></div>'+
       (approver()&&String(r.requested_by)!==String(state?.user?.id)
        ?'<div class="flex gap-1">'+button('Approve','decideTargetCredit('+JSON.stringify(r.id)+',true)')+
          button('Reject','decideTargetCredit('+JSON.stringify(r.id)+',false)')+'</div>'
        :'<span class="text-amber-700">Awaiting Admin review</span>')+'</div>';
  }).join('')+'</div></div>':'')+
  '</section>';
}
async function load(force){
 if(!manager())return;
 const year=Number(X.S?.year),uid=String(state?.user?.id||'');
 if(!year||!uid)return;
 if(X.uid!==uid||X.year!==year){X.uid=uid;X.year=year;X.loaded=null;X.plan=null;X.error=null;X.busy=false}
 if(!force&&(X.loaded||X.busy)){draw();return}
 X.busy=true;X.error=null;draw();
 try{
  const [workspace,plan]=await Promise.all([
    db.rpc('get_sales_target_sharing_workspace',{p_year:year}),
    db.rpc('get_sales_target_plan',{p_year:year})
  ]);
  if(workspace.error)throw workspace.error;
  if(plan.error)throw plan.error;
  if(X.year!==year||X.uid!==uid)return;
  X.loaded=workspace.data||{people:[],goals:[],credits:[],requests:[]};
  X.plan=plan.data||{};
 }catch(err){
  if(X.uid===uid&&X.year===year)X.error=err.message||'Cannot load shared targets';
 }finally{if(X.uid===uid&&X.year===year){X.busy=false;draw()}}
}
const oldRender=window.renderSalesTargetsPanel;
window.renderSalesTargetsPanel=function(S){
 if(typeof oldRender==='function')oldRender(S);
 X.S=S;
 if(!manager())return;
 load(false);
};
window.reloadSalesTargetSharing=function(){X.loaded=null;X.error=null;load(true)};
function editPeopleHtml(){
 const list=people().slice().sort((a,b)=>a.name.localeCompare(b.name));
 return '<div class="space-y-3"><p class="text-xs text-gray-600">One person may belong to both departments. LP1/internal accounts are excluded from default target achievement. No login is created for project-only staff.</p>'+
  '<div class="flex flex-wrap gap-2"><input id="targetAddNoLoginName" maxlength="150" placeholder="New Project staff name (no login)" class="border rounded-lg px-3 py-2 text-sm flex-1">'+button('Add staff','createTargetNoLoginStaff()')+'</div>'+
  '<div class="max-h-[55vh] overflow-auto space-y-1">'+list.map(p=>
   '<div class="flex justify-between items-center gap-2 border-b py-2 text-xs"><div><b>'+h(p.name)+'</b>'+
    '<p class="text-gray-500">'+(p.source==='target_only'?'No login':'System account')+
    (p.showroom?' · Showroom':'')+(p.project?' · Project':'')+(p.internal?' · Internal':'')+'</p></div>'+
    button('Settings','openTargetStaffSettings('+JSON.stringify(p.id)+')')+'</div>').join('')+'</div></div>';
}
window.openSharedTargetPeople=function(){window.openModal('Target Staff & Departments',editPeopleHtml())};
window.createTargetNoLoginStaff=async function(){
 const el=document.getElementById('targetAddNoLoginName'),name=String(el?.value||'').trim();
 if(name.length<2)return msg('Enter a staff name.',true);
 const r=await db.rpc('add_sales_target_person',{p_name:name});
 if(r.error)return msg(r.error.message,true);
 await load(true);window.openSharedTargetPeople();msg('Target-only staff added; no login created.');
};
window.openTargetStaffSettings=function(id){
 const p=people().find(x=>String(x.id)===String(id));if(!p)return;
 window.openModal('Staff Departments · '+p.name,
   '<div class="space-y-3 text-sm"><p>One staff profile can contribute in both departments.</p>'+
   '<label class="flex gap-2"><input type="checkbox" id="targetStaffShowroom" '+(p.showroom?'checked':'')+'> Showroom</label>'+
   '<label class="flex gap-2"><input type="checkbox" id="targetStaffProject" '+(p.project?'checked':'')+'> Project</label>'+
   '<label class="flex gap-2"><input type="checkbox" id="targetStaffInternal" '+(p.internal?'checked':'')+'> Internal/test account (exclude from target credit)</label>'+
   '<label class="flex gap-2"><input type="checkbox" id="targetStaffEligible" '+(p.eligible?'checked':'')+'> Include in staff target achievement</label>'+
   '<p class="text-xs text-gray-500">Disabling a person does not erase past invoices, goals, or audit history.</p>'+
   button('Save Profile','saveTargetStaffSettings('+JSON.stringify(id)+')','bg-[#211d18] text-white')+'</div>');
};
window.saveTargetStaffSettings=async function(id){
 const p=people().find(x=>String(x.id)===String(id));if(!p)return;
 const get=k=>!!document.getElementById(k)?.checked;
 const internal=get('targetStaffInternal'),eligible=internal?false:get('targetStaffEligible');
 const r=await db.rpc('save_sales_target_staff_settings',{
  p_person_id:id,p_source:p.source,p_showroom:get('targetStaffShowroom'),
  p_project:get('targetStaffProject'),p_internal:internal,p_eligible:eligible,p_notes:null
 });
 if(r.error)return msg(r.error.message,true);
 window.closeModal();await load(true);msg('Staff target profile saved.');
};
window.openSharedSalesGoal=function(id){
 const g=(X.loaded?.goals||[]).find(x=>String(x.id)===String(id))||null;
 X.editorGoal=g;
 const p=eligible().filter(p=>p.active||g?.members?.some(m=>String(m.id)===String(p.id)));
 const selected=new Map((g?.members||[]).map(m=>[String(m.id),n(m.percentage)]));
 const list=p.map(x=>'<div class="flex flex-wrap items-center gap-2 border-b py-1 text-xs">'+
    '<label class="flex-1 min-w-32"><input type="checkbox" class="targetGoalPerson" value="'+h(x.id)+'" '+(selected.has(String(x.id))?'checked':'')+'> '+h(x.name)+
    (x.showroom?' · Showroom':'')+(x.project?' · Project':'')+'</label>'+
    '<input type="number" min="0" max="100" step="0.0001" class="targetGoalPercent border rounded-lg px-2 py-1 w-20 text-right" data-id="'+h(x.id)+'" value="'+(selected.get(String(x.id))||0)+'" aria-label="Target percentage for '+h(x.name)+'"></div>').join('');
 window.openModal(g?'Edit Shared Target':'Add Shared Target',
  '<form id="targetGoalForm" class="space-y-3" onsubmit="event.preventDefault();saveSharedSalesGoal()">'+
  '<label class="block text-xs font-bold">Target name<input id="targetGoalName" required maxlength="120" class="border rounded-lg p-2 w-full mt-1" value="'+h(g?.label||'')+'" placeholder="Showroom + Project"></label>'+
  '<div class="grid grid-cols-2 gap-2"><label class="block text-xs">Scope<select id="targetGoalScope" class="border rounded-lg p-2 w-full">'+
   [['cross_department','Cross Department'],['showroom','Showroom'],['project','Project'],['shared_people','Shared Salespeople']]
    .map(([v,t])=>'<option value="'+v+'" '+((g?.scope||'cross_department')===v?'selected':'')+'>'+t+'</option>').join('')+
  '</select></label><label class="block text-xs">Method<select id="targetGoalMode" class="border rounded-lg p-2 w-full">'+
    '<option value="pooled" '+(!g||g.mode==='pooled'?'selected':'')+'>One combined goal</option>'+
    '<option value="split" '+(g?.mode==='split'?'selected':'')+'>Percentage split</option></select></label></div>'+
  '<label class="block text-xs">Annual shared target (USD)<input id="targetGoalAmount" min="0.01" step="0.01" type="number" required class="border rounded-lg p-2 w-full" value="'+h(g?.annual_target||'')+'"></label>'+
  '<label class="block text-xs"><input type="checkbox" id="targetGoalActive" '+(!g||g.active?'checked':'')+'> Active</label>'+
  '<p class="text-xs text-gray-600">Choose one or more people. For percentage split, selected member percentages must add up to 100%; for combined goals they are ignored. A person serving both teams is selected once.</p>'+
  '<div class="max-h-60 overflow-y-auto space-y-1">'+list+'</div>'+
  '<div class="flex justify-end">'+button('Save Shared Target','saveSharedSalesGoal()','bg-[#211d18] text-white')+'</div></form>');
};
window.saveSharedSalesGoal=async function(){
 const id=X.editorGoal?.id||null;
 const selected=[...document.querySelectorAll('.targetGoalPerson:checked')];
 const mode=document.getElementById('targetGoalMode')?.value;
 const members=selected.map(ch=>{
   const percent=document.querySelector('.targetGoalPercent[data-id="'+ch.value+'"]');
   return {id:ch.value,percentage:mode==='split'?n(percent?.value):null};
 });
 if(!members.length||members.length>30)return msg('Select 1–30 participants.',true);
 if(mode==='split'&&Math.abs(members.reduce((sum,m)=>sum+m.percentage,0)-100)>0.0001)
    return msg('Selected percentages must total 100%.',true);
 const args={p_goal_id:id,p_year:X.year,p_label:document.getElementById('targetGoalName')?.value||'',
 p_scope:document.getElementById('targetGoalScope')?.value,
 p_mode:mode,p_annual_target:n(document.getElementById('targetGoalAmount')?.value),
 p_members:members,p_active:!!document.getElementById('targetGoalActive')?.checked};
 const r=await db.rpc('save_sales_target_shared_goal',args);
 if(r.error)return msg(r.error.message,true);
 window.closeModal();await load(true);msg('Shared target saved. Company target remains unchanged.');
};
function orders(){
 const byId=new Map();
 for(const r of reportRows()){
  const key=String(r.order_id||'');if(!key)continue;
  if(!byId.has(key))byId.set(key,{id:key,number:r.document_no||key.slice(0,8),date:r.order_date,amount:0});
  byId.get(key).amount+=n(r.actual_sales);
 }
 return [...byId.values()].sort((a,b)=>String(b.date).localeCompare(String(a.date))).slice(0,300);
}
window.openTargetCreditProposal=function(){
 const list=orders();if(!list.length)return msg('No sales orders found in the selected target period.',true);
 const opts=eligible().filter(p=>p.active).map(p=>'<option value="'+h(p.id)+'">'+h(p.name)+(p.source==='target_only'?' (no login)':'')+'</option>').join('');
 X.creditPersonOptions=opts;
 window.openModal('Propose Shared Sales Credit',
 '<div class="space-y-3 text-xs">'+
 '<p class="text-gray-600">Credit allocations apply to the selected order and all its recognized invoice, payment and return events. The company Actual Sales figure does not change. Admin approval is required.</p>'+
 '<label class="block font-semibold">Sale / Order<select id="targetCreditOrder" class="border rounded-lg p-2 w-full mt-1">'+
 list.map(o=>'<option value="'+h(o.id)+'">'+h(o.number)+' · '+h(o.date)+' · '+money(o.amount)+'</option>').join('')+'</select></label>'+
 '<div id="targetCreditRows" class="space-y-2"></div>'+
 button('+ Add person','addTargetCreditPerson()')+
 '<label class="block mt-2">Reason for sharing<input id="targetCreditReason" minlength="5" maxlength="500" class="border rounded-lg p-2 w-full mt-1" placeholder="Who contributed to the sale and why"></label>'+
 '<div class="flex justify-end">'+button('Submit for approval','submitTargetCreditProposal()','bg-[#211d18] text-white')+'</div></div>');
 window.addTargetCreditPerson();
 window.addTargetCreditPerson();
};
window.addTargetCreditPerson=function(){
 const root=document.getElementById('targetCreditRows');if(!root)return;
 const count=root.querySelectorAll('.targetCreditPerson').length;
 if(count>=15)return msg('Maximum 15 people per sale.',true);
 const row=document.createElement('div');
 row.className='targetCreditPerson flex gap-2 items-center';
 row.innerHTML='<select class="targetCreditId min-w-0 flex-1 border rounded-lg p-2">'+(X.creditPersonOptions||'')+'</select>'+
  '<input type="number" min="0.0001" max="100" step="0.0001" value="'+(count===0?50:count===1?50:0)+'" class="targetCreditPercent w-20 border rounded-lg p-2" aria-label="Credit percentage">'+
  button('Remove','this.closest(\'.targetCreditPerson\').remove()');
 root.appendChild(row);
 // Default to two different people when possible.
 if(count===1){const el=row.querySelector('select');if(el?.options?.length>1)el.selectedIndex=1}
};
window.submitTargetCreditProposal=async function(){
 const order=document.getElementById('targetCreditOrder')?.value;
 const reason=String(document.getElementById('targetCreditReason')?.value||'').trim();
 const entries=[...document.querySelectorAll('.targetCreditPerson')].map(row=>({
   id:row.querySelector('.targetCreditId')?.value,
   percentage:n(row.querySelector('.targetCreditPercent')?.value)
 }));
 if(!order||reason.length<5||!entries.length||new Set(entries.map(x=>x.id)).size!==entries.length||
    entries.some(x=>x.percentage<=0)||Math.abs(entries.reduce((s,x)=>s+x.percentage,0)-100)>0.0001){
   return msg('Choose unique staff, total 100% credit, and enter a reason (5+ characters).',true);
 }
 const r=await db.rpc('propose_sales_target_credit',{p_order_id:order,p_shares:entries,p_reason:reason});
 if(r.error)return msg(r.error.message,true);
 window.closeModal();await load(true);msg('Sales credit proposal submitted for Admin approval.');
};
window.decideTargetCredit=async function(id,approve){
 if(!approver())return;
 const note=window.prompt(approve?'Optional approval note:':'Reason for rejection:','');
 if(note===null)return;
 const r=await db.rpc('decide_sales_target_credit',{p_request_id:id,p_approve:approve,p_note:note});
 if(r.error)return msg(r.error.message,true);
 await load(true);msg(approve?'Credit sharing approved.':'Credit sharing rejected.');
};
// Pure helpers exposed solely to facilitate deterministic regression testing.
window.__sharedTargetMath={months,kind,earnedCredit,yearWeight,
 setState:(S,workspace,plan)=>{X.S=S;X.loaded=workspace;X.plan=plan;X.year=S.year}};
})();