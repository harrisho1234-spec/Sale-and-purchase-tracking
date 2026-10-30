// Cancellation tasks release reservations only. Physical CN returns use their existing queue.
(function(){
 'use strict';
 const escape=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const role=()=>String(state?.profile?.role||'');
 const allowed=code=>typeof window.hasAppPermission==='function'?window.hasAppPermission(code):['stock_controller','admin','super_admin'].includes(role());
 const operate=()=>['stock_controller','admin','super_admin'].includes(role())&&allowed('inventory.operate');
 const busy=new Set();
 let generation=0;
 async function render(){
   if(state.page!=='stock-inventory'||!allowed('inventory.view'))return;
   const root=document.getElementById('inventoryBody');
   if(!root)return;
   const requests=[...document.querySelectorAll('button.active')].some(b=>String(b.getAttribute('onclick')).includes("setInventoryTab('requests')"));
   if(!root.querySelector('.inv-task-card')&&!requests)return;
   const seq=++generation;
   let panel=document.getElementById('cnReservationReleasePanel');
   if(!panel){panel=document.createElement('section');panel.id='cnReservationReleasePanel';panel.className='inv-card mb-4 p-4 border border-blue-200';root.prepend(panel)}
   panel.innerHTML='<p class="text-xs text-gray-500">Loading reservation release tasks…</p>';
   try{
     const result=await db.rpc('get_cn_reservation_release_queue');
     if(result.error)throw result.error;
     if(seq!==generation||!panel.isConnected)return;
     const rows=Array.isArray(result.data)?result.data:[];
     const pending=rows.filter(r=>!r.completed_at),completed=rows.filter(r=>r.completed_at);
     const row=r=>'<div class="rounded-xl border bg-white p-3"><b>'+escape(r.cn_no)+'</b> · '+escape(r.customer_name)+
       '<ul class="text-xs mt-2">'+(r.items||[]).map(i=>'<li>'+escape(i.product_code)+' '+escape(i.item_name)+' · Cancelled quantity '+escape(i.qty)+'</li>').join('')+'</ul>'+
       '<p class="text-xs mt-2">Physical Stock IN: 0</p>'+
       (r.completed_at?'<p class="text-xs text-green-800 mt-2">Reservation released · '+escape(r.completed_at)+' · Operator '+escape(r.completed_by)+'</p>':
         '<p class="text-xs text-blue-800 mt-2">Approved · Awaiting Reservation Release</p>'+(operate()?'<button type="button" data-release-id="'+escape(r.return_id)+'" class="mt-2 px-3 py-2 rounded-lg bg-blue-800 text-white text-xs">Release Reservation</button>':''))+'</div>';
     panel.innerHTML='<h3 class="font-bold text-lg">CN Reservation Releases · '+pending.length+' pending</h3>'+
       '<p class="text-xs text-gray-600 my-2">Cancel Undelivered Items: release reserved quantities only. Invoice credit is already approved; deposits and payment history stay unchanged.</p>'+
       (pending.length?'<div class="grid md:grid-cols-2 gap-2">'+pending.map(row).join('')+'</div>':'<p class="text-xs">No reservations awaiting release.</p>')+
       (completed.length?'<details class="mt-3"><summary class="text-xs cursor-pointer">Completed releases ('+completed.length+')</summary><div class="grid md:grid-cols-2 gap-2 mt-2">'+completed.map(row).join('')+'</div></details>':'');
     panel.querySelectorAll('[data-release-id]').forEach(button=>{button.disabled=busy.has(button.dataset.releaseId);button.onclick=()=>complete(button.dataset.releaseId,button)});
   }catch(error){if(seq===generation&&panel.isConnected){panel.innerHTML='<p class="text-xs text-red-700">Reservation release queue unavailable: '+escape(error.message)+'</p><button type="button" class="text-xs underline">Retry</button>';panel.querySelector('button').onclick=render}}
 }
 async function complete(id,button){
   if(!operate()||busy.has(id))return;
   if(!confirm('Release the approved cancelled quantities from reservation? Physical stock and invoice credit will not change.'))return;
   busy.add(id);button.disabled=true;
   try{
     const result=await db.rpc('complete_cn_reservation_release',{p_return_id:id});
     if(result.error)throw result.error;
     showToast(result.data?.already_completed?'Reservation was already released.':'Reservation released. Physical stock is unchanged.');
     if(typeof window.renderStockInventory==='function')await window.renderStockInventory();else await render();
   }catch(error){showToast(error.message,'err')}
   finally{busy.delete(id);button.disabled=false}
 }
 const previous=window.renderStockInventoryBody;
 if(typeof previous==='function')window.renderStockInventoryBody=async function(){const result=await previous.apply(this,arguments);await render();return result};
})();
