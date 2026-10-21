// CN / Return → warehouse receipt → approval → linked Stock RETURN.
// The server enforces role access, stock qty limits and exact-once posting.
(function(){
'use strict';
const el=id=>document.getElementById(id);
const e=v=>String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
const role=()=>String(state?.profile?.role||'');
const permission=(code,fallback)=>typeof window.hasAppPermission==='function'?!!window.hasAppPermission(code):fallback.includes(role());
const view=()=>permission('inventory.view',['stock_controller','accountant','manager','admin','super_admin']);
const operate=()=>permission('inventory.operate',['stock_controller','admin','super_admin']);
const approve=()=>permission('inventory.approve',['admin','super_admin']);
let loadedLocations=null;
let receiptBusy=false;
const dateText=x=>x?String(x).slice(0,10):'';
const fmt=x=>Number(x||0).toLocaleString('en-US',{maximumFractionDigits:2});
const style='<span class="font-semibold text-amber-800">Stock increases only after approval.</span>';
async function locations(){
 if(loadedLocations)return loadedLocations;
 const r=await db.from('stock_locations').select('id,code,name,active').eq('active',true).order('sort_order').order('code');
 if(r.error)throw r.error;
 loadedLocations=r.data||[];
 return loadedLocations;
}
async function queue(){
 const result=await db.rpc('get_cn_stock_receipt_queue');
 if(result.error)throw result.error;
 return Array.isArray(result.data)?result.data:[];
}
async function requests(returnId=null){
 const result=await db.rpc('get_cn_stock_receipt_requests',{p_return_id:returnId});
 if(result.error)throw result.error;
 return Array.isArray(result.data)?result.data:[];
}
window.openCNStockReceiptForItem=async function(itemId){
 if(!operate())return showToast('Stock operation permission is required to request a return receipt.','err');
 if(receiptBusy)return;
 try{
   const [items,availableLocations]=await Promise.all([queue(),locations()]);
   const row=items.find(x=>String(x.return_item_id)===String(itemId));
   if(!row||!['return_to_stock','exchange'].includes(row.disposition))throw Error('Only Return to Stock and Exchange lines can request saleable Stock IN.');
    if(row.approval_status==='pending'||row.approval_status==='rejected')throw Error('Manager/Admin must approve this CN before warehouse intake.');
   if(row.request_id||row.exchange_hold_request_id)throw Error('This item already has a pending warehouse receipt or damaged hold. Review it first.');
   const remaining=Number(row.available_to_request||0);
   if(remaining<=0)throw Error('No remaining CN quantity available for stock receipt.');
   if(!row.product_id)throw Error('Link this CN item to an inventory product first.');
   if(!availableLocations.length)throw Error('No active stock location is configured.');
   const options=availableLocations.map(loc=>
     '<option value="'+e(loc.id)+'">'+e(loc.code||'')+' · '+e(loc.name||'')+'</option>').join('');
   openModal((row.disposition==='exchange'?'Receive Good Exchange Item · ':'Receive Returned Items · ')+e(row.cn_no),'<form id="cnStockReceiptForm" class="space-y-4">'+
     '<div class="rounded-xl border bg-gray-50 p-3"><b class="text-sm">'+e(row.product_code||'')+' · '+e(row.item_name||'')+'</b>'+
       '<div class="text-xs text-gray-600 mt-1">CN '+e(row.cn_no)+' · Returned '+fmt(row.cn_qty)+' · Already received '+fmt(row.received_qty)+
       ' · Pending approval '+fmt(row.pending_approval_qty)+' · Available to receive <b>'+fmt(remaining)+'</b></div></div>'+
     '<div class="bg-blue-50 border border-blue-200 text-blue-800 rounded-xl p-3 text-xs">'+style+
       ' CN status: <b>'+e(row.return_status==='confirmed'?'Awaiting Physical Return':row.return_status)+'</b>. '+(row.disposition==='exchange'?'Original exchange item: <b>only inspected GOOD goods may return to saleable stock</b>. The replacement delivery follows its own Sales Order/DO. ':'')+'Confirm that goods are physically present and inspected. Damaged or defective goods must NOT enter saleable stock.</div>'+ 
     '<div class="grid sm:grid-cols-2 gap-3">'+
       '<label class="text-xs font-semibold">Received Qty *<input id="cnReceiptQty" required type="number" min="1" max="'+remaining+'" step="1" value="'+remaining+
          '" class="mt-1 block w-full border rounded-lg px-3 py-2.5 text-sm"></label>'+
       '<label class="text-xs font-semibold">Stock Location *<select id="cnReceiptLocation" required class="mt-1 block w-full border rounded-lg px-3 py-2.5 bg-white text-sm"><option value="">Choose location</option>'+options+'</select></label>'+
       '<label class="text-xs font-semibold">Inspection Condition *<select id="cnReceiptCondition" class="mt-1 block w-full border rounded-lg px-3 py-2.5 bg-white text-sm"><option value="good">Good · Resaleable</option><option value="damaged">Damaged · Hold (not receivable)</option><option value="defective">Defective · Hold (not receivable)</option><option value="other">Other · Inspection needed</option></select></label>'+
     '</div>'+
     '<label class="text-xs font-semibold block">Warehouse Notes<textarea id="cnReceiptNote" rows="2" maxlength="2000" class="mt-1 block w-full border rounded-lg px-3 py-2.5 text-sm" placeholder="Inspection, packaging, location details"></textarea></label>'+
     '<div class="flex justify-end gap-2 pt-2"><button type="button" onclick="closeModal()" class="px-4 py-2.5 border rounded-xl text-xs font-semibold">Cancel</button>'+
       '<button id="cnReceiptSubmit" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Confirm Physical Return & Request Receipt</button></div>'+
     '</form>');
   const form=el('cnStockReceiptForm');if(!form)return;
   form.onsubmit=async event=>{
    event.preventDefault();
    const qty=Number(el('cnReceiptQty')?.value||0),location=el('cnReceiptLocation')?.value,condition=el('cnReceiptCondition')?.value;
    if(!Number.isSafeInteger(qty)||qty<1||qty>remaining)return showToast('Quantity must be a whole number from 1 to '+remaining+'.','err');
    if(!location)return showToast('Select an actual receiving location.','err');
    if(condition!=='good')return showToast('Only Good items enter saleable stock. Change this CN item to Damaged Hold instead.','err');
    if(receiptBusy)return;
    receiptBusy=true;
    const btn=el('cnReceiptSubmit');
    if(btn){btn.disabled=true;btn.textContent='Submitting…'}
    try{
      const response=await db.rpc('submit_cn_stock_receipt',{
        p_return_item_id:String(itemId),p_qty:qty,p_location_id:location,
        p_condition:condition,p_note:String(el('cnReceiptNote')?.value||'').trim()||null
      });
      if(response.error)throw response.error;
      closeModal();showToast('CN stock receipt submitted. Stock stays unchanged until approval.');
      if(typeof window.renderReturnsPage==='function' && state.page==='returns')await window.renderReturnsPage();
      if(el('inventoryBody')&&typeof window.renderStockInventory==='function'){
        await window.renderStockInventory(); // Refresh Approvals count and stock receipt list.
      }else if(typeof window.renderCNStockReceiptApprovalPanel==='function'){
        await window.renderCNStockReceiptApprovalPanel();
      }
    }catch(err){showToast(err.message||'Could not submit receipt.','err')}
    finally{receiptBusy=false;if(btn?.isConnected){btn.disabled=false;btn.textContent='Confirm Physical Return & Request Receipt'}}
   };
 }catch(err){showToast(err.message||'Could not open CN stock receipt.','err')}
};
function card(req){
 const pending=req.status==='pending',canApprove=approve()&&pending;
 return '<div class="rounded-xl border bg-white px-3 py-3 space-y-2">'+
   '<div class="flex flex-wrap items-center justify-between gap-2"><div><b class="text-sm">'+e(req.cn_no||'CN')+' · '+e(req.product_code||'')+'</b>'+
      '<div class="text-xs text-gray-700">'+e(req.item_name||'')+'</div>'+
      '<div class="text-[11px] text-gray-600 mt-1">Qty <b>'+fmt(req.qty)+'</b> · Receiving location <b>'+e(req.location||'')+
      '</b> · Condition <b>'+e(req.condition||'')+'</b></div>'+
      '<div class="text-[10px] text-gray-500 mt-1">Requested by '+e(req.requested_by_name||'Stock Staff')+' · '+e(dateText(req.requested_at))+'</div></div>'+
   '<span class="rounded-full border px-2 py-1 text-[10px] font-bold '+(pending?'bg-amber-50 text-amber-800':'bg-gray-50 text-gray-600')+'">'+
      e(req.status).toUpperCase()+'</span></div>'+
   (req.note?'<div class="text-xs text-gray-600">Notes: '+e(req.note)+'</div>':'')+
   (req.reviewer_note?'<div class="text-xs text-gray-600">Review: '+e(req.reviewer_note)+'</div>':'')+
   (req.applied_movement_id?'<div class="text-[11px] text-emerald-800">Posted to inventory · Linked stock movement '+e(req.applied_movement_id)+'</div>':'')+
   (canApprove?'<div class="border-t pt-2 flex items-center justify-end gap-2">'+
      '<button type="button" onclick="reviewCNStockReceipt(\''+e(req.id)+'\',false)" class="px-3 py-2 border border-red-200 text-red-700 rounded-lg text-xs font-semibold">Reject</button>'+
      '<button type="button" onclick="reviewCNStockReceipt(\''+e(req.id)+'\',true)" class="px-3 py-2 bg-emerald-700 text-white rounded-lg text-xs font-semibold">Approve Stock IN</button></div>':'')+'</div>';
}
window.reviewCNStockReceipt=async function(id,allow){
 if(!approve())return showToast('Stock approval permission required.','err');
 if(receiptBusy)return;
 if(allow&&!confirm('Approve this physical CN return and increase saleable inventory exactly once?'))return;
 const note=prompt(allow?'Optional warehouse approval note:':'Reason for rejecting receipt (optional):')||'';
 receiptBusy=true;
 try{
  const result=await db.rpc('review_cn_stock_receipt',{p_request_id:id,p_approve:!!allow,p_reviewer_note:note||null});
  if(result.error)throw result.error;
  showToast(allow?'Return stock receipt approved and posted.':'CN stock receipt rejected. No inventory changed.');
  if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
  else await window.renderCNStockReceiptApprovalPanel();
  if(typeof window.refreshApprovalNotifications==='function')window.refreshApprovalNotifications();
 }catch(err){showToast(err.message||'Review failed.','err')}
 finally{receiptBusy=false}
};
window.renderCNStockReceiptApprovalPanel=async function(){
 if(!view())return;
 const active=[...document.querySelectorAll('.inv-tab')].some(b=>
   String(b.getAttribute('onclick')||'').includes("setInventoryTab('requests')")&&b.classList.contains('active'));
 const root=el('inventoryBody');
 if(!active||!root)return;
 let holder=el('cnStockReceiptApprovalPanel');
 if(!holder){
  holder=document.createElement('section');
  holder.id='cnStockReceiptApprovalPanel';holder.className='mb-4';
  root.insertBefore(holder,root.firstChild);
 }
 holder.innerHTML='<div class="inv-card p-3 text-xs text-gray-500">Loading CN stock receipts…</div>';
 try{
   const [items,reqs]=await Promise.all([queue(),requests()]);
   const pending=reqs.filter(x=>x.status==='pending'),history=reqs.filter(x=>x.status!=='pending');
   const ready=items.filter(x=>(x.return_status==='confirmed'&&x.warehouse_stage!=='stock_received')||Number(x.available_to_request)>0||Number(x.exchange_available_to_process)>0||!!x.request_id||!!x.exchange_hold_request_id);
   holder.innerHTML='<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-2">'+
     '<div class="flex flex-wrap justify-between items-center gap-3"><div><b class="text-sm text-amber-900">CN / Return Stock Receipts</b>'+
     '<div class="text-xs text-amber-900/80 mt-1">Submitted CNs appear immediately. Awaiting Physical Return means the warehouse has NOT received the item. Only approved good-item receipts increase stock.</div></div>'+
     '<span class="rounded-full bg-white border px-3 py-1 text-xs font-semibold">'+pending.length+' Pending Approval</span></div></div>'+
     (pending.length?'<div class="grid gap-3 mb-3">'+pending.map(card).join('')+'</div>':'')+
     (operate()?'<div class="inv-card mb-3"><b class="text-sm">Receive Returned Items</b>'+
       '<p class="text-xs text-gray-500 mt-1 mb-3">Submitted CNs appear here before approval. After Manager/Admin approval, Stock inspects the return. Good exchange items may request Stock IN; damaged exchanges go to a separate hold and do not increase saleable stock.</p>'+
       '<div class="grid gap-2">'+(ready.length?ready.map(row=>{
          const available=Number(row.available_to_request||0);
          const canReceive=['return_to_stock','exchange'].includes(row.disposition)&&available>0&&(!row.approval_status||['approved','legacy'].includes(row.approval_status))&&!row.request_id&&!row.exchange_hold_request_id;
          const status=row.approval_status==='pending'?'Awaiting CN Approval':row.approval_status==='rejected'?'CN Rejected':row.exchange_hold_request_id?'Damaged Hold Approval Pending':row.request_id?'Receipt Approval Pending':row.disposition==='exchange'&&row.warehouse_stage==='exchange_resolved'?'Exchange Resolved':row.disposition==='exchange'?'Awaiting Exchange Inspection':row.return_status==='confirmed'&&row.disposition!=='return_to_stock'?'Awaiting Physical Return · No Stock Action':row.return_status==='confirmed'?'Awaiting Physical Return':row.disposition!=='return_to_stock'?'No Stock Action':'Ready for Receipt';
          return '<div class="flex flex-wrap justify-between items-center gap-3 border rounded-xl bg-white p-3">'+
           '<div><b class="text-xs">'+e(row.cn_no)+' · '+e(row.product_code||'')+'</b>'+
           '<div class="text-xs text-gray-700">'+e(row.item_name||'')+'</div>'+
           '<div class="mt-1 inline-block px-2 py-1 rounded-lg border bg-amber-50 text-amber-800 text-[10px] font-semibold">'+e(status)+'</div>'+
           '<div class="text-[10px] text-gray-500 mt-1">Handling: '+e(String(row.disposition||'').replaceAll('_',' '))+'</div>'+ 
           '<div class="text-[11px] text-gray-600">Returned '+fmt(row.cn_qty)+' · Received '+fmt(row.received_qty)+
             ' · Awaiting approval '+fmt(row.pending_approval_qty)+(row.disposition==='exchange'?' · Damaged Held '+fmt(row.exchange_held_qty)+' · Hold Pending '+fmt(row.exchange_hold_pending_qty):'')+' · Available '+fmt(available)+'</div></div>'+ 
           (canReceive?'<button type="button" onclick="openCNStockReceiptForItem(\''+e(row.return_item_id)+'\')" '+
             'class="px-3 py-2 rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-800 text-xs font-bold">'+(row.disposition==='exchange'?'Good → Request Stock IN':'Confirm Physical Return')+'</button>':
             '<span class="text-xs font-semibold text-amber-700">'+(row.approval_status==='pending'?'Waiting for Manager/Admin':row.approval_status==='rejected'?'Rejected by Management':!['return_to_stock','exchange'].includes(row.disposition)?'Information Only':row.request_id?'Approval Pending':row.exchange_hold_request_id?'Hold Pending Approval':'Already Received')+'</span>')+'</div>'
       }).join(''):'<div class="text-xs text-gray-500 py-2">No CN items awaiting stock receipt.</div>')+
       '</div></div>':'')+
     (history.length?'<details class="inv-card"><summary class="cursor-pointer text-xs font-semibold">CN Receipt History · '+history.length+' reviewed</summary>'+
        '<div class="grid gap-2 mt-3">'+history.map(card).join('')+'</div></details>':'');
 }catch(err){holder.innerHTML='<div class="inv-card p-3 text-red-700 text-xs">Could not load CN receipts: '+e(err.message||'Unknown error')+
   ' <button type="button" onclick="renderCNStockReceiptApprovalPanel()" class="underline">Retry</button></div>'}
};
// Loaded after stock-action-approval so its requests tab wrapper runs last.
const previousRender=window.renderStockInventoryBody;
if(typeof previousRender==='function'){
 window.renderStockInventoryBody=async function(){
   const result=await previousRender.apply(this,arguments);
   await window.renderCNStockReceiptApprovalPanel();
   return result;
 };
}
})();