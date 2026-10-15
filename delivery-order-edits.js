// Delivery Order correction UI. Manager/Admin submit requests; Admin/Super review;
// Super Admin applies permitted corrections directly with an audit trail.
// All validation/permissions are enforced by Supabase functions, not by this UI.
(function(){
 'use strict';
 let editing=null;
 let reviewRows=[];
 const escape=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
 const role=()=>String(typeof state!=='undefined'&&state?.profile?.role||'');
 const canPropose=()=>['manager','admin'].includes(role());
 const canDirect=()=>role()==='super_admin';
 const canReview=()=>['admin','super_admin'].includes(role());
 const strDate=v=>String(v||'').slice(0,10);
 const asNum=v=>Number(v||0);
 const compare=(oldVal,newVal)=>String(oldVal??'')===String(newVal??'')?'':'<div class="text-xs py-1 flex flex-wrap gap-2"><span class="line-through text-red-700">'+escape(oldVal||'—')+'</span><span aria-hidden="true">→</span><b class="text-green-800">'+escape(newVal||'—')+'</b></div>';
 const byId=(arr)=>new Map((arr||[]).map(x=>[String(x.sales_order_item_id),x]));
 function fieldLabel(label,value){
  return '<label class="text-xs font-semibold block">'+label+value+'</label>';
 }
 function buildItemRow(item,current){
  const included=!!current,locked=asNum(current?.delivered_qty)>0||editing?.status==='delivered';
  const id=String(item.sales_order_item_id);
  return '<div class="grid grid-cols-[auto_minmax(0,1fr)_90px] sm:grid-cols-[auto_minmax(0,1fr)_110px] gap-3 items-center py-3 border-b">'+
   '<input type="checkbox" id="doEditSelected-'+escape(id)+'" data-do-item-id="'+escape(id)+'" '+(included?'checked':'')+
    (locked?' disabled':'')+' class="w-4 h-4" aria-label="Include '+escape(item.product_code||item.item_name||'item')+'">'+
   '<div class="flex items-center gap-2 min-w-0">'+
    (item.image_url?'<img src="'+escape(item.image_url)+'" class="w-9 h-9 object-contain shrink-0 rounded-md border" alt="">':'')+
    '<div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a] break-all">'+escape(item.product_code||'')+'</div>'+
    '<div class="text-xs font-semibold truncate">'+escape(item.item_name||'')+'</div>'+
    '<div class="text-[10px] text-gray-500">SO Qty: '+escape(item.sales_qty)+(current?.delivered_qty?' · Already OUT: '+escape(current.delivered_qty):'')+
    (locked?' · Locked by delivery history':'')+'</div></div></div>'+
   '<input id="doEditQty-'+escape(id)+'" type="number" min="1" step="1" inputmode="numeric" value="'+escape(current?.qty??1)+'"'+
     (locked?' readonly':'')+' class="w-full px-2 py-2 rounded-lg border text-sm" aria-label="DO quantity for '+escape(item.product_code||'item')+'">'+
  '</div>';
 }
 function renderForm(context){
  const current=byId(context.items);
  const controls=(context.choices||[]).map(i=>buildItemRow(i,current.get(String(i.sales_order_item_id)))).join('');
  const itemCount=context.items?.length||0;
  const locked=context.status==='delivered';
  return '<form id="editDoForm" class="space-y-4">'+
   '<div class="rounded-xl bg-gray-50 border p-3">'+
    '<b class="text-sm">'+escape(context.do_no||'Unnumbered DO')+' · '+escape(context.document_no||'')+'</b>'+
    '<div class="text-xs text-gray-500 mt-1">'+escape(context.customer_name||'')+'</div>'+
    '<div class="text-[10px] text-gray-500 mt-2">Edit the DO request, not the original Sales Order. Customer, invoice and Sales Order items are maintained in Sales Tracking. Use the existing Correct DO No. action for numbering.</div></div>'+
   '<div class="p-3 rounded-xl border border-blue-200 bg-blue-50 text-xs text-blue-800">'+
      (canDirect()?'<b>Super Admin direct edit.</b> Your saved corrections apply immediately and are audited.':'<b>Manager/Admin edit request.</b> No change takes effect until Admin or Super Admin approves.')+
      ' An item with Stock OUT or a stock approval cannot be changed or removed. Completed DOs allow delivery-detail corrections only.'+
   '</div>'+
   '<div class="grid sm:grid-cols-2 gap-3">'+
    fieldLabel('Requested Delivery Date *','<input id="doEditDeliveryDate" required type="date" value="'+escape(strDate(context.requested_delivery_date))+'" class="block mt-1 w-full border rounded-lg px-3 py-2.5">')+
    fieldLabel('Delivery Address','<textarea id="doEditAddress" rows="2" maxlength="800" class="block mt-1 w-full border rounded-lg px-3 py-2">'+escape(context.delivery_address||'')+'</textarea>')+
   '</div>'+
   fieldLabel('Delivery Remarks','<textarea id="doEditNote" rows="2" maxlength="2000" class="block mt-1 w-full border rounded-lg px-3 py-2">'+escape(context.request_note||'')+'</textarea>')+
   '<div><div class="flex justify-between items-center gap-3"><b class="text-sm">Delivery Order Items</b><span class="text-xs text-gray-500">'+itemCount+' currently requested</span></div>'+
    '<p class="text-[11px] text-gray-500 mt-1">Tick products already on the Sales Order, then set their DO quantities. Untick a wrong item. Changes never edit item pricing or Sales Order quantities.</p>'+
    '<div class="max-h-[250px] overflow-y-auto border rounded-xl px-3 mt-2">'+(controls||'<div class="p-4 text-xs text-gray-500">No available Sales Order products</div>')+'</div></div>'+
   (canPropose()?fieldLabel('Reason for Correction *','<textarea id="doEditReason" required rows="2" maxlength="1200" class="block mt-1 w-full border rounded-lg px-3 py-2" placeholder="Explain what the Sales team entered incorrectly"></textarea>'):'')+
   '<div class="flex justify-end gap-2 pt-3"><button type="button" onclick="closeModal()" class="px-4 py-2.5 border rounded-xl text-xs font-semibold">Cancel</button>'+
    '<button type="submit" id="doEditSave" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">'+(canDirect()?'Save DO Changes':'Submit Edit Request')+'</button></div>'+
   '</form>';
 }
 window.openDeliveryOrderEdit=async function(id){
  if(!canPropose()&&!canDirect())return showToast('Manager or Super Admin access required.','err');
  try{
   const r=await db.rpc('get_delivery_order_edit_context',{p_delivery_request_id:String(id)});
   if(r.error)throw r.error;
   editing=r.data||null;
   if(!editing)throw Error('Delivery Order is unavailable');
   openModal(canDirect()?'Edit Delivery Order':'Request DO Correction',renderForm(editing));
   const form=document.getElementById('editDoForm');if(form)form.onsubmit=save;
  }catch(err){showToast(err.message||'Could not open DO editor.','err')}
 };
 async function save(event){
  event.preventDefault();
  if(!editing)return;
  const old=editing;
  const date=strDate(document.getElementById('doEditDeliveryDate')?.value);
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return showToast('Select a valid requested delivery date.','err');
  const reason=String(document.getElementById('doEditReason')?.value||'').trim();
  if(canPropose()&&!reason)return showToast('Enter a reason for the correction.','err');
  const items=[];
  for(const item of old.choices||[]){
   const id=String(item.sales_order_item_id);
   const include=document.getElementById('doEditSelected-'+id)?.checked;
   if(!include)continue;
   const raw=String(document.getElementById('doEditQty-'+id)?.value||'').trim();
   const qty=Number(raw);
   if(!raw||!Number.isSafeInteger(qty)||qty<=0)return showToast('DO quantities must be positive whole numbers.','err');
   items.push({sales_order_item_id:id,qty});
  }
  if(!items.length)return showToast('Select at least one DO product.','err');
  const proposed={
   requested_delivery_date:date,
   delivery_address:String(document.getElementById('doEditAddress')?.value||'').trim(),
   request_note:String(document.getElementById('doEditNote')?.value||'').trim(),
   items
  };
  if(canDirect()&&!confirm('Apply these changes to '+(old.do_no||'this DO')+' immediately? An audit record will be saved. Stock OUT history will not be changed.'))return;
  const btn=document.getElementById('doEditSave');
  if(btn){btn.disabled=true;btn.textContent=canDirect()?'Applying…':'Submitting…';}
  try{
   const result=canDirect()
    ?await db.rpc('superadmin_edit_delivery_order',{p_delivery_request_id:old.delivery_request_id,p_proposed:proposed})
    :await db.rpc('request_delivery_order_edit',{p_delivery_request_id:old.delivery_request_id,p_proposed:proposed,p_reason:reason});
   if(result.error)throw result.error;
   editing=null;
   closeModal();
   showToast(canDirect()?'DO updated and audit history saved.':'DO edit request sent for Admin / Super Admin approval.');
   if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
   if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
  }catch(err){showToast(err.message||'Could not save DO correction.','err')}
  finally{if(btn&&btn.isConnected){btn.disabled=false;btn.textContent=canDirect()?'Save DO Changes':'Submit Edit Request'}}
 }
 function formatDiff(req){
  const a=req.original||{},b=req.proposed||{};
  let html='';
  for(const [label,key] of [['Delivery Date','requested_delivery_date'],['Address','delivery_address'],['Remarks','request_note']]){
    const d=compare(a[key],b[key]);if(d)html+='<div><b class="text-[11px]">'+label+'</b>'+d+'</div>';
  }
  const left=byId(a.items),right=byId(b.items);
  const ids=new Set([...left.keys(),...right.keys()]);
  for(const id of ids){
    const old=left.get(id),updated=right.get(id);
    if(old&&updated&&Number(old.qty)===Number(updated.qty))continue;
    const info=old||updated,code=escape(info?.product_code||info?.item_name||id);
    html+='<div class="border-t pt-2 mt-2 text-xs"><b>'+code+'</b><div class="flex flex-wrap gap-2"><span class="text-red-700 line-through">'+(old?'Qty '+escape(old.qty):'Not included')+'</span> → <b class="text-green-800">'+(updated?'Qty '+escape(updated.qty):'Removed')+'</b></div></div>';
  }
  return html||'<span class="text-xs text-gray-500">No visible changes</span>';
 }
 function queueCard(r){
  const pending=r.status==='pending',canAct=pending&&canReview();
  return '<div class="rounded-xl border p-3 space-y-2">'+
   '<div class="flex flex-wrap gap-2 items-center justify-between"><div><b class="text-sm">'+escape(r.do_no||'DO')+' · '+escape(r.document_no||'')+'</b>'+
    '<div class="text-xs text-gray-500">'+escape(r.customer_name||'')+'</div>'+
    '<div class="text-[10px] text-gray-500">'+escape(r.requested_by_name||'')+' · '+escape(new Date(r.requested_at).toLocaleString())+'</div></div>'+
   '<span class="rounded-lg border px-2 py-1 text-xs font-bold '+(pending?'bg-amber-50 text-amber-800':'bg-gray-50 text-gray-600')+'">'+escape(r.status.toUpperCase())+'</span></div>'+
   '<div class="text-xs"><b>Reason:</b> '+escape(r.reason)+'</div>'+
   '<div class="p-3 rounded-lg bg-gray-50 space-y-1">'+formatDiff(r)+'</div>'+
   (r.reviewer_note?'<div class="text-xs text-gray-500"><b>Review note:</b> '+escape(r.reviewer_note)+'</div>':'')+
   (canAct?'<div class="border-t pt-3 space-y-2"><input id="doEditReviewNote-'+escape(r.id)+'" class="w-full border rounded-lg px-3 py-2 text-xs" placeholder="Reviewer note (optional)">'+
     '<div class="flex justify-end gap-2"><button type="button" onclick="reviewDeliveryOrderEdit(\''+escape(r.id)+'\',false)" class="px-3 py-2 rounded-lg border border-red-200 text-red-700 text-xs font-semibold">Reject</button>'+
     '<button type="button" onclick="reviewDeliveryOrderEdit(\''+escape(r.id)+'\',true)" class="px-3 py-2 rounded-lg bg-green-700 text-white text-xs font-semibold">Approve Changes</button></div></div>':'')+
   '</div>';
 }
 window.openDeliveryOrderEditQueue=async function(){
  if(!canPropose()&&!canDirect())return showToast('Manager or Admin access required.','err');
  try{
   const r=await db.rpc('get_delivery_order_edit_requests',{p_delivery_request_id:null,p_pending_only:false});
   if(r.error)throw r.error;
   reviewRows=Array.isArray(r.data)?r.data:[];
   const pending=reviewRows.filter(x=>x.status==='pending');
   const done=reviewRows.filter(x=>x.status!=='pending');
   openModal(canReview()?'Review DO Edit Requests':'My DO Edit Requests',
    '<div class="space-y-3"><div class="text-xs p-3 border border-amber-200 bg-amber-50 rounded-lg"><b>'+pending.length+' pending DO edit requests.</b> Corrections remain inactive until approved.</div>'+
    (pending.length?'<h3 class="text-sm font-bold">Pending</h3>'+pending.map(queueCard).join(''):'<div class="text-sm text-gray-500 p-4">No pending DO edit requests.</div>')+
    (done.length?'<h3 class="text-sm font-bold pt-3 border-t">Reviewed History</h3>'+done.map(queueCard).join(''):'')+
    '</div>'
   );
  }catch(err){showToast(err.message||'Could not load DO edit requests.','err')}
 };
 window.reviewDeliveryOrderEdit=async function(id,approve){
  if(!canReview())return showToast('Admin or Super Admin access required.','err');
  const item=reviewRows.find(x=>String(x.id)===String(id));
  if(!item||item.status!=='pending')return showToast('This request has already been reviewed.','err');
  if(approve&&!confirm('Approve corrections to '+(item.do_no||item.document_no)+'? The original DO will be updated, but existing Stock OUT history remains protected.'))return;
  const note=String(document.getElementById('doEditReviewNote-'+id)?.value||'').trim();
  try{
   const r=await db.rpc('review_delivery_order_edit',{p_request_id:id,p_approve:!!approve,p_reviewer_note:note||null});
   if(r.error)throw r.error;
   showToast(approve?'DO correction approved and applied.':'DO edit request rejected.');
   if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
   if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
   await window.openDeliveryOrderEditQueue();
  }catch(err){showToast(err.message||'Review failed.','err')}
 };
})();