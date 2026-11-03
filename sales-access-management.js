// Sales Access management improvements. Loaded AFTER roles-access.js.
// Preserves existing RLS, grant records and ownership assignments.
(function(root){
'use strict';
const norm=v=>String(v||'').trim();
const goodId=v=>/^[0-9a-f-]{36}$/i.test(norm(v));
function statusOf(g, now=Date.now()){
 if(g.active===false)return 'Revoked';
 if(g.expires_at && Date.parse(g.expires_at)<=now)return 'Expired';
 return 'Active';
}
function expiryError(raw, previous='', mode='create', now=Date.now()){
 const text=norm(raw);
 if(!text)return mode==='renew'?'Choose a new future expiration date for renewal.':'';
 const timestamp=Date.parse(text);
 if(!Number.isFinite(timestamp))return 'Enter a valid expiration date and time.';
 if(timestamp>now)return '';
 // Allow note/level edits on an already expired record without extending it.
 if(mode==='edit'&&previous&&Math.abs(timestamp-Date.parse(previous))<60000)return '';
 return 'The expiration date must be in the future.';
}
function alreadyAssigned(users,customerId,salesUserId){
 const c=(users||[]).find(x=>String(x.id)===String(customerId));
 return !!c&&String(c.assigned_sales_id||'')===String(salesUserId||'');
}
if(typeof module==='object'&&module.exports)module.exports={statusOf,expiryError,alreadyAssigned};
if(!root||!root.document)return;

const D=root.document;
let mode='create',selectedId=null;
const el=id=>D.getElementById(id);
const data=()=>root._salesAccessData||{grants:[],customers:[],users:[],orders:[]};
const can=()=>typeof root.canManageSalesAccess==='function'&&root.canManageSalesAccess();
const notify=(message,err=false)=>root.showToast(message,err?'err':undefined);
function localDate(iso){
 if(!iso)return '';
 const d=new Date(iso),pad=n=>String(n).padStart(2,'0');
 if(!Number.isFinite(d.getTime()))return '';
 return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'T'+pad(d.getHours())+':'+pad(d.getMinutes());
}
function grant(){return data().grants.find(x=>String(x.id)===String(selectedId))||null;}
function ownerNotice(){
 const warning=el('salesGrantOwnershipNotice');
 if(!warning)return;
 const scope=el('grantScope')?.value,person=el('grantSalesUser')?.value,target=el('grantTarget')?.value;
 if(scope==='order'){
  warning.textContent='Order access is temporary and does not change customer ownership.';
  warning.className='p-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-xs';
 }else if(!person||!target){
  warning.textContent='Access Grants and customer ownership are separate. Choose a Sales user and customer to check ownership.';
  warning.className='p-3 rounded-xl border border-slate-200 bg-slate-50 text-slate-600 text-xs';
 }else if(alreadyAssigned(data().customers,target,person)){
  warning.textContent='Already Assigned — Additional Access Not Required. This customer belongs to the selected Sales user. Use Customer Database to change ownership.';
  warning.className='p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-900 text-xs';
 }else{
  const c=data().customers.find(x=>String(x.id)===String(target));
  const u=data().users.find(x=>String(x.user_id)===String(c?.assigned_sales_id));
  warning.textContent='Temporary access only. Customer ownership stays with '+(u?.display_name||u?.email||'the current assigned salesperson')+'.';
  warning.className='p-3 rounded-xl border border-blue-200 bg-blue-50 text-blue-800 text-xs';
 }
}
function setMode(newMode,record=null){
 mode=newMode;
 selectedId=record?.id||null;
 const edit=!!record;
 for(const id of ['grantSalesUser','grantScope','grantTarget'])if(el(id))el(id).disabled=edit;
 if(el('salesGrantFormTitle'))el('salesGrantFormTitle').textContent=
   mode==='renew'?'Renew Access Grant':edit?'Edit Access Grant':'Grant Sales Access';
 if(el('salesGrantSubmit'))el('salesGrantSubmit').textContent=
   mode==='renew'?'Confirm Renewal':edit?'Save Changes':'Grant Access';
 if(el('salesGrantCancel'))el('salesGrantCancel').hidden=!edit;
 if(el('salesGrantModeHint')){
  el('salesGrantModeHint').hidden=!edit;
  el('salesGrantModeHint').textContent=mode==='renew'?
   'Choose a NEW future expiration date. Saving will reactivate this access grant only after confirmation.':
   'Edit the access level, expiration or note. Editing a revoked grant does NOT reactivate it; use Renew. Customer ownership is not changed.';
 }
 if(el('grantExpires')){
  el('grantExpires').required=mode==='renew';
  el('grantExpires').removeAttribute('min');
  if(mode!=='edit')el('grantExpires').min=localDate(new Date(Date.now()+60000));
 }
 ownerNotice();
}
function openExisting(id,kind){
 if(!can())return notify('Sales Access management permission required.',true);
 const g=data().grants.find(x=>String(x.id)===String(id));
 if(!g)return notify('Grant not found. Refresh Sales Access.',true);
 if(!data().users.some(u=>String(u.user_id)===String(g.sales_user_id)))
  return notify('This grant belongs to an inactive Sales account. Contact Super Admin.',true);
 const user=el('grantSalesUser'),scope=el('grantScope');
 if(!user||!scope)return notify('Open the Sales Access page first.',true);
 user.value=g.sales_user_id;
 scope.value=g.customer_id?'customer':'order';
 root.refreshGrantTargets();
 el('grantTarget').value=g.customer_id||g.sales_order_id;
 el('grantLevel').value=g.access_level;
 el('grantExpires').value=kind==='renew'?'':localDate(g.expires_at);
 el('grantReason').value=g.reason||'';
 setMode(kind,g);
 el('salesGrantFormTitle')?.scrollIntoView({block:'start',behavior:'smooth'});
 if(kind==='renew')el('grantExpires')?.focus();
}
root.editSalesAccessGrant=id=>openExisting(id,'edit');
root.renewSalesAccessGrant=id=>openExisting(id,'renew');
root.cancelSalesAccessGrant=()=>{
 const form=el('grantAccessForm');
 if(form)form.reset();
 for(const id of ['grantSalesUser','grantScope','grantTarget'])if(el(id))el(id).disabled=false;
 if(el('grantScope'))el('grantScope').value='customer';
 root.refreshGrantTargets();
 setMode('create');
};
function newButton(label,classes,handler){
 const b=D.createElement('button');
 b.type='button';b.textContent=label;
 b.className='px-3 py-2 rounded-lg text-xs font-semibold border '+classes;
 b.addEventListener('click',handler);
 return b;
}
function decorate(){
 const grants=data().grants;
 const card=el('grantAccessForm');
 if(!card)return;
 const heading=card.parentElement?.querySelector('h3');
 if(heading)heading.id='salesGrantFormTitle';
 if(heading){
  let hint=el('salesGrantModeHint');
  if(!hint){
   hint=D.createElement('div');hint.id='salesGrantModeHint';hint.hidden=true;
   hint.className='p-3 rounded-xl mt-3 bg-amber-50 border border-amber-200 text-amber-900 text-xs';
   heading.insertAdjacentElement('afterend',hint);
  }
 }
 const user=el('grantSalesUser'),target=el('grantTarget'),scope=el('grantScope');
 if(target&&!el('salesGrantOwnershipNotice')){
  const warning=D.createElement('div');
  warning.id='salesGrantOwnershipNotice';warning.setAttribute('role','status');warning.setAttribute('aria-live','polite');
  target.parentElement?.insertAdjacentElement('afterend',warning);
 }
 for(const input of [user,target,scope]){
  if(input)input.addEventListener('change',ownerNotice);
 }
 const oldSubmit=card.querySelector('button:not([type="button"])');
 if(oldSubmit){
  oldSubmit.id='salesGrantSubmit';oldSubmit.type='submit';
  const cancel=newButton('Cancel Edit / Renewal','border-slate-200 text-slate-700',root.cancelSalesAccessGrant);
  cancel.id='salesGrantCancel';cancel.hidden=true;cancel.className+=' w-full mt-2';
  oldSubmit.insertAdjacentElement('afterend',cancel);
 }
 card.onsubmit=root.saveSalesAccessGrant;
 // A grant can be expired and still active=true: authorized managers can revoke it.
 const list=Array.from(D.querySelectorAll('#content .card.rounded-2xl.overflow-hidden .divide-y > div'));
 grants.forEach((g,i)=>{
  const row=list[i];if(!row)return;
  const status=statusOf(g);
  const tag=row.children[2];
  if(tag){
   tag.textContent=status;
   tag.className='text-xs font-semibold '+(status==='Active'?'text-green-600':status==='Expired'?'text-amber-600':'text-gray-500');
  }
  const currentActions=row.children[3];
  if(!currentActions)return;
  const actions=D.createElement('div');
  actions.className='flex flex-wrap gap-1.5 items-center';
  actions.appendChild(newButton('Edit','border-slate-200 text-slate-700',()=>openExisting(g.id,'edit')));
  actions.appendChild(newButton('Renew','border-blue-200 text-blue-700',()=>openExisting(g.id,'renew')));
  if(g.active!==false)actions.appendChild(newButton('Revoke','border-red-200 text-red-600',()=>root.revokeSalesAccess(g.id)));
  else {
   const revoked=D.createElement('span');revoked.textContent='Revoked';revoked.className='text-[10px] text-gray-400 px-2';
   actions.appendChild(revoked);
  }
  currentActions.replaceWith(actions);
  if(g.customer_id&&alreadyAssigned(data().customers,g.customer_id,g.sales_user_id)){
   const ownerBadge=D.createElement('span');ownerBadge.textContent='Already Assigned';
   ownerBadge.className='px-2 py-1 text-[9px] rounded border border-amber-200 bg-amber-50 text-amber-800';
   row.children[1]?.querySelector('.flex')?.appendChild(ownerBadge);
  }
 });
 setMode('create');
}
const originalRender=root.renderSalesAccess;
if(typeof originalRender==='function')root.renderSalesAccess=async function(){
 const answer=await originalRender.apply(this,arguments);
 decorate();
 return answer;
};
root.saveSalesAccessGrant=async function(event){
 event.preventDefault();
 if(!can())return notify('Sales Access management permission required.',true);
 const person=el('grantSalesUser')?.value||'',scope=el('grantScope')?.value||'customer';
 const target=el('grantTarget')?.value||'',level=el('grantLevel')?.value||'edit';
 const reason=el('grantReason')?.value.trim()||null,raw=el('grantExpires')?.value||'';
 const old=grant();
 if(selectedId&&!old)return notify('Grant changed or is no longer available. Refresh the page.',true);
 if(!person||!target)return notify('Select a Sales user and target.',true);
 if(!['view','edit'].includes(level))return notify('Invalid access level.',true);
 const issue=expiryError(raw,old?.expires_at||'',mode);
 if(issue)return notify(issue,true);
 if((mode==='create'||mode==='renew')&&alreadyAssigned(data().customers,target,person))
  return notify('Already Assigned — Additional Access Not Required. Change ownership in Customer Database.',true);
 const expires=raw?new Date(raw).toISOString():null;
 if(old){
  if(String(old.sales_user_id)!==String(person)||String(old.customer_id||old.sales_order_id)!==String(target))
   return notify('Editing cannot change the Sales user or customer. Create a separate grant.',true);
  const patch={access_level:level,reason,expires_at:expires};
  if(mode==='renew'){
   if(!root.confirm('Renew this access grant until '+new Date(expires).toLocaleString()+'?'))return;
   patch.active=true;
  }else if(old.active!==false&&statusOf(old)==='Expired'&&expires&&new Date(expires)>new Date()){
   if(!root.confirm('This future expiry will reactivate an expired grant. Continue?'))return;
  }
  const {data:changed,error}=await db.from('sales_access_grants').update(patch).eq('id',old.id).select('id').maybeSingle();
  if(error)return notify(error.message,true);
  if(!changed)return notify('Grant not updated. Check access permissions.',true);
  notify(mode==='renew'?'Access renewed':'Access grant updated');
 }else{
  let q=db.from('sales_access_grants').select('id').eq('sales_user_id',person);
  if(scope==='customer')q=q.eq('customer_id',target).is('sales_order_id',null);
  else q=q.eq('sales_order_id',target).is('customer_id',null);
  const {data:found,error:findError}=await q.limit(1).maybeSingle();
  if(findError)return notify(findError.message,true);
  if(found)return notify('An existing grant covers this salesperson and target. Use Edit or Renew instead.',true);
  const record={sales_user_id:person,customer_id:scope==='customer'?target:null,
   sales_order_id:scope==='order'?target:null,access_level:level,reason,
   expires_at:expires,active:true,granted_by:state.user.id};
  const {error}=await db.from('sales_access_grants').insert(record);
  if(error)return notify(error.message,true);
  notify('Sales access granted');
 }
 await root.renderSalesAccess();
};
root.revokeSalesAccess=async function(id){
 if(!can())return notify('Sales Access management permission required.',true);
 if(!goodId(id))return notify('Invalid access grant.',true);
 const g=data().grants.find(x=>String(x.id)===String(id));
 if(!g)return notify('Grant not found. Refresh Sales Access.',true);
 if(g.active===false)return notify('This grant is already revoked.',true);
 const owned=!!g.customer_id&&alreadyAssigned(data().customers,g.customer_id,g.sales_user_id);
 if(!root.confirm('Revoke this access grant? The record will remain marked Revoked.'+
   (owned?' The salesperson will still have access as the assigned customer owner.':'')))return;
 const {data:changed,error}=await db.from('sales_access_grants').update({active:false}).eq('id',id).select('id').maybeSingle();
 if(error)return notify(error.message,true);
 if(!changed)return notify('Grant not revoked. Check access permissions.',true);
 notify('Access revoked');
 await root.renderSalesAccess();
};
})(typeof window==='undefined'?null:window);
