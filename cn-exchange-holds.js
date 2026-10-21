// Inspected CN exchange originals: good -> approved Stock IN, damaged -> approved hold.
// Holds record physical custody without any inventory movement.
(function(){
'use strict';
const x=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const role=()=>String(state?.profile?.role||'');
const perm=(key,fallback)=>typeof window.hasAppPermission==='function'?!!window.hasAppPermission(key):fallback.includes(role());
const canView=()=>perm('inventory.view',['stock_controller','admin','super_admin','manager']);
const canOperate=()=>perm('inventory.operate',['stock_controller','admin','super_admin']);
const canApprove=()=>perm('inventory.approve',['admin','super_admin']);
const qty=v=>Number(v||0).toLocaleString('en-US',{maximumFractionDigits:2});
let busy=false,refreshId=0;
const el=id=>document.getElementById(id);
async function queue(){
 const r=await db.rpc('get_cn_stock_receipt_queue');
 if(r.error)throw r.error;
 return Array.isArray(r.data)?r.data:[];
}
async function holds(){
 const r=await db.rpc('get_cn_exchange_hold_requests',{p_return_id:null});
 if(r.error)throw r.error;
 return Array.isArray(r.data)?r.data:[];
}
async function locations(){
 const r=await db.from('stock_locations').select('id,code,name').eq('active',true).order('code');
 if(r.error)throw r.error;
 return r.data||[];
}
async function refresh(){
 if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
 else if(typeof window.renderCNStockReceiptApprovalPanel==='function')await window.renderCNStockReceiptApprovalPanel();
 if(typeof window.refreshApprovalNotifications==='function')window.refreshApprovalNotifications();
}
window.openCNExchangeHoldForItem=async function(itemId){
 if(!canOperate())return showToast('Stock operation permission required.','err');
 if(busy)return;
 try{
  const [items,locs]=await Promise.all([queue(),locations()]);
  const row=items.find(t=>String(t.return_item_id)===String(itemId));
  if(!row||row.disposition!=='exchange')throw Error('Choose an Exchange CN item.');
  if(!['approved','legacy'].includes(String(row.approval_status)))throw Error('Manager/Admin must approve this CN before Stock receives it.');
  if(row.request_id||row.exchange_hold_request_id)throw Error('The exchange already has a warehouse request awaiting approval.');
  const max=Number(row.exchange_available_to_process||0);
  if(!Number.isSafeInteger(max)||max<1)throw Error('No unprocessed exchange quantity remains.');
  const opts=locs.map(l=>'<option value="'+x(l.id)+'">'+x(l.code)+' · '+x(l.name||'')+'</option>').join('');
  openModal('Damaged / Defective Exchange Hold · '+x(row.cn_no),
    '<form id="exchangeHoldForm" class="space-y-4">'+
    '<div class="rounded-xl border p-3"><b>'+x(row.product_code||'')+'</b>'+
    '<div class="text-sm">'+x(row.item_name||'')+'</div>'+
    '<div class="text-xs text-gray-600 mt-2">Unprocessed exchange quantity: <b>'+qty(max)+'</b></div></div>'+
    '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">'+
    '<b>Damaged/Defective Hold:</b> Confirm the original item is physically present but not suitable for resale. This logs a separate holding location. No saleable stock quantity is added, even after Admin approves. The replacement item uses its own DO.</div>'+
    '<div class="grid sm:grid-cols-2 gap-3">'+
    '<label class="text-xs font-bold">Quantity to Hold *<input id="exchangeHoldQty" required type="number" min="1" max="'+max+'" step="1" value="'+max+'" class="block mt-1 w-full border rounded-lg p-2.5"></label>'+
    '<label class="text-xs font-bold">Inspection *<select id="exchangeHoldCondition" class="block mt-1 w-full border rounded-lg p-2.5"><option value="damaged">Damaged</option><option value="defective">Defective</option></select></label>'+
    '<label class="text-xs font-bold sm:col-span-2">Physical Holding Location *<select id="exchangeHoldLocation" required class="block mt-1 w-full border rounded-lg p-2.5"><option value="">Choose the physical location</option>'+opts+'</select></label>'+
    '</div>'+
    '<label class="block text-xs font-bold">Describe damage and holding area *<textarea id="exchangeHoldNote" required minlength="3" maxlength="2000" rows="3" class="block mt-1 w-full border rounded-lg p-2.5" placeholder="Condition, rack/shelf, quarantine details"></textarea></label>'+
    '<div class="flex justify-end gap-2"><button type="button" onclick="closeModal()" class="rounded-lg border px-4 py-2 text-xs">Cancel</button>'+
    '<button type="submit" id="exchangeHoldSave" class="rounded-lg bg-amber-800 px-4 py-2 text-xs font-bold text-white">Request Damaged Hold</button></div></form>');
  const form=el('exchangeHoldForm');if(!form)return;
  form.onsubmit=async ev=>{
   ev.preventDefault();
   if(busy)return;
   const n=Number(el('exchangeHoldQty')?.value||0),location=el('exchangeHoldLocation')?.value;
   const condition=el('exchangeHoldCondition')?.value,note=String(el('exchangeHoldNote')?.value||'').trim();
   if(!Number.isSafeInteger(n)||n<1||n>max||!location||note.length<3)return showToast('Enter a valid quantity, location and inspection note.','err');
   busy=true;const b=el('exchangeHoldSave');if(b){b.disabled=true;b.textContent='Submitting…'}
   try{
    const r=await db.rpc('submit_cn_exchange_hold',{
     p_return_item_id:String(itemId),p_qty:n,p_location_id:location,p_condition:condition,p_note:note
    });
    if(r.error)throw r.error;
    closeModal();showToast('Damaged exchange hold requested; no stock has been added.');
    await refresh();
   }catch(err){showToast(err.message||'Could not submit damaged exchange hold.','err')}
   finally{busy=false;if(b?.isConnected){b.disabled=false;b.textContent='Request Damaged Hold'}}
  };
 }catch(err){showToast(err.message||'Could not open exchange hold.','err')}
};
window.reviewCNExchangeHold=async function(id,allow){
 if(!canApprove())return showToast('Admin stock approval permission required.','err');
 if(busy)return;
 if(!confirm((allow?'Approve':'Reject')+' damaged exchange hold? This does not increase available stock.'))return;
 const note=prompt(allow?'Optional approval note:':'Reason for rejection:')||'';
 busy=true;
 try{
  const r=await db.rpc('review_cn_exchange_hold',{p_request_id:id,p_approve:!!allow,p_note:note||null});
  if(r.error)throw r.error;
  showToast(allow?'Exchange hold approved. Goods remain outside saleable inventory.':'Exchange hold rejected.');
  await refresh();
 }catch(err){showToast(err.message||'Hold review failed.','err')}
 finally{busy=false}
};
function holdCard(h){
 const pending=h.status==='pending';
 return '<div class="rounded-xl border bg-white px-3 py-3">'+
 '<div class="flex flex-wrap justify-between gap-3"><div><b class="text-xs">'+x(h.cn_no)+' · '+x(h.product_code)+'</b>'+
 '<div class="text-xs mt-1">'+x(h.item_name)+'</div>'+
 '<div class="text-[11px] mt-1 text-gray-600">'+qty(h.qty)+' pcs · '+x(h.condition)+' · '+x(h.location)+'</div></div>'+
 '<span class="text-[10px] font-bold border rounded-full bg-amber-50 px-2 py-1">'+x(h.status).toUpperCase()+'</span></div>'+
 '<p class="text-xs text-gray-700 mt-2">Inspection: '+x(h.note)+'</p>'+
 (h.reviewer_note?'<p class="text-xs text-gray-600 mt-1">Admin note: '+x(h.reviewer_note)+'</p>':'')+
 '<p class="text-[10px] mt-1 text-amber-800">Physical hold only · Not added to saleable inventory</p>'+
 (pending&&canApprove()?'<div class="flex justify-end gap-2 pt-3 mt-3 border-t">'+
 '<button onclick="reviewCNExchangeHold(\''+x(h.id)+'\',false)" class="rounded-lg border px-3 py-2 text-xs text-red-700">Reject Hold</button>'+
 '<button onclick="reviewCNExchangeHold(\''+x(h.id)+'\',true)" class="rounded-lg bg-amber-800 text-white px-3 py-2 text-xs font-bold">Approve Damaged Hold</button></div>':'')+
 '</div>';
}
async function renderExchangeIntake(){
 if(!canView()||state.page!=='stock-inventory')return;
 const panel=el('cnStockReceiptApprovalPanel');if(!panel?.isConnected)return;
 const token=++refreshId;
 const [items,allHolds]=await Promise.all([queue(),holds()]);
 if(token!==refreshId||!panel.isConnected||state.page!=='stock-inventory')return;
 panel.querySelectorAll('[data-cn-exchange]').forEach(t=>t.remove());
 const exchanges=items.filter(t=>t.disposition==='exchange'&&(
   Number(t.exchange_available_to_process)>0||Number(t.exchange_hold_pending_qty)>0||
   Number(t.pending_approval_qty)>0||
   t.approval_status==='pending'||t.approval_status==='rejected'));
 const incoming=allHolds.filter(t=>t.status==='pending');
 const history=allHolds.filter(t=>t.status!=='pending');
 const section=document.createElement('section');
 section.dataset.cnExchange='1';section.className='inv-card mb-3';
 const rows=exchanges.map(t=>{
  const remaining=Number(t.exchange_available_to_process||0);
  const canAct=canOperate()&&['legacy','approved'].includes(t.approval_status)&&remaining>0&&!t.request_id&&!t.exchange_hold_request_id;
  const status=t.approval_status==='pending'?'Awaiting CN Approval':t.approval_status==='rejected'?'CN Rejected':
    t.exchange_hold_request_id?'Damaged Hold Approval Pending':t.request_id?'Stock IN Approval Pending':'Awaiting Exchange Inspection';
  return '<div class="rounded-xl border p-3 bg-white flex flex-wrap justify-between gap-3">'+
   '<div class="flex-1 min-w-[180px]"><b class="text-xs">'+x(t.cn_no)+' · '+x(t.product_code)+'</b>'+
   '<p class="text-xs text-gray-700 mt-1">'+x(t.item_name||'')+'</p>'+
   '<p class="text-[10px] mt-1 text-amber-800 font-bold">'+x(status)+'</p>'+
   '<p class="text-[11px] text-gray-500 mt-1">CN '+qty(t.cn_qty)+' · Good received '+qty(t.received_qty)+
   ' · Damaged held '+qty(t.exchange_held_qty)+' · To inspect '+qty(remaining)+'</p></div>'+
   (canAct?'<div class="flex flex-wrap items-center gap-2">'+
     '<button type="button" onclick="openCNStockReceiptForItem(\''+x(t.return_item_id)+'\')" class="rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold px-3 py-2">Good → Request Stock IN</button>'+
     '<button type="button" onclick="openCNExchangeHoldForItem(\''+x(t.return_item_id)+'\')" class="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs font-semibold px-3 py-2">Damaged → Request Hold</button></div>':
     '<span class="text-xs text-amber-700 font-semibold">'+(t.approval_status==='pending'?'Manager/Admin approval needed':t.approval_status==='rejected'?'Rejected CN':t.exchange_hold_request_id?'Hold awaiting Admin':'Pending warehouse approval')+'</span>')+'</div>';
 }).join('');
 section.innerHTML='<div class="mb-3"><b class="text-sm">Exchanges · Inspect Original Returned Items</b>'+
 '<p class="text-xs text-gray-500 mt-1">Good items use an approved Stock IN. Damaged/defective goods are held separately and never added to available stock. Replacement products require their own Delivery Order.</p></div>'+
 (rows?'<div class="grid gap-2 mb-3">'+rows+'</div>':
   '<p class="text-xs text-gray-500 mb-3">No exchange items are waiting for inspection.</p>')+
 (incoming.length?'<h4 class="font-bold text-sm mb-2">Pending Damaged Hold Approval · '+incoming.length+'</h4>'+
  '<div class="grid gap-2 mb-4">'+incoming.map(holdCard).join('')+'</div>':'')+
 (history.length?'<details class="border rounded-xl p-3 bg-gray-50"><summary class="text-xs font-semibold cursor-pointer">Exchange Hold History · '+history.length+'</summary>'+
  '<div class="grid gap-2 mt-3">'+history.map(holdCard).join('')+'</div></details>':'');
 panel.prepend(section);
}
const oldPanel=window.renderCNStockReceiptApprovalPanel;
if(typeof oldPanel==='function')window.renderCNStockReceiptApprovalPanel=async function(){
 await oldPanel.apply(this,arguments);
 try{await renderExchangeIntake()}catch(err){
  console.warn('CN Exchange inspection queue:',err.message);
  const panel=el('cnStockReceiptApprovalPanel');
  if(panel?.isConnected){
   let error=panel.querySelector('[data-cn-exchange]');
   if(!error){error=document.createElement('div');error.dataset.cnExchange='1';panel.prepend(error)}
   error.className='inv-card text-xs text-red-700 p-3 mb-3';
   error.textContent='Exchange inspection is unavailable: '+err.message;
  }
 }
};
})();
