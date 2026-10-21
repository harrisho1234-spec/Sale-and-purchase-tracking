// CN Returns Pending card for Stock & Inventory dashboard.
// Only reads the same server-verified CN queue as My Requests; it never posts stock.
(function(){
 'use strict';
 const eligible=()=>['stock_controller','admin','super_admin'].includes(String(state?.profile?.role||'')) &&
   (typeof window.hasAppPermission!=='function'||window.hasAppPermission('inventory.view'));
 const x=s=>String(s==null?'':s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const n=v=>Number(v||0);
 const asDate=v=>String(v||'').slice(0,10);
 let call=0;
 window.openCNReturnDashboard=function(){
   if(!eligible())return showToast('Stock & Inventory access required.','err');
   if(typeof window.setInventoryTab==='function')window.setInventoryTab('requests');
 };
 async function renderReturnCard(){
   if(!eligible()||state.page!=='stock-inventory')return;
   const root=document.getElementById('inventoryBody');
   if(!root||!root.querySelector('.inv-task-card'))return; // Dashboard only
   const seq=++call;
   let panel=document.getElementById('cnReturnsDashboardPanel');
   if(!panel){
     panel=document.createElement('section');
     panel.id='cnReturnsDashboardPanel';
     panel.className='inv-card mb-4 p-4 border border-amber-200 bg-amber-50/30';
     const work=root.querySelector('.inv-task-card')?.parentElement;
     if(work)work.parentElement.insertBefore(panel,work);
     else root.prepend(panel);
   }
   panel.innerHTML='<div class="text-xs text-gray-500">Checking customer Credit Note returns…</div>';
   try{
     const r=await db.rpc('get_cn_stock_receipt_queue');
     if(r.error)throw r.error;
     if(seq!==call||!panel.isConnected)return;
     const rows=(Array.isArray(r.data)?r.data:[]).filter(t=>(t.return_status==='confirmed'&&t.warehouse_stage!=='stock_received')||n(t.available_to_request)>0||n(t.pending_approval_qty)>0);
     const ready=rows.filter(t=>t.disposition==='return_to_stock'&&n(t.available_to_request)>0&&t.approval_status!=='pending'&&t.approval_status!=='rejected');
      const awaiting=rows.filter(t=>t.return_status==='confirmed');
     const pending=rows.filter(t=>n(t.available_to_request)<=0&&n(t.pending_approval_qty)>0);
     const ids=[...new Set(rows.map(t=>t.product_id).filter(Boolean))].slice(0,40);
     let images=new Map();
     if(ids.length){
       const p=await db.from('product_catalog').select('id,image_url').in('id',ids);
       if(!p.error)images=new Map((p.data||[]).map(t=>[t.id,t.image_url]));
     }
     if(seq!==call||!panel.isConnected)return;
     const img=t=>{
       const url=images.get(t.product_id);
       return url?'<img loading="lazy" decoding="async" src="'+x(url)+'" class="h-12 w-12 rounded-lg object-cover border bg-white">':
         '<span class="h-12 w-12 rounded-lg border bg-white flex items-center justify-center text-[9px] text-gray-400">No Photo</span>';
     };
     panel.innerHTML='<div class="flex flex-wrap items-center justify-between gap-3 mb-3">'+
       '<div><div class="text-[10px] font-bold uppercase text-amber-700">Warehouse · Customer CN</div>'+
       '<h3 class="font-bold text-lg">CN Returns Pending <span class="text-amber-700">'+rows.length+'</span></h3>'+
       '<p class="text-xs text-gray-500 mt-1">Submitted CNs are visible immediately as Awaiting CN Approval. After Manager/Admin approves the CN, warehouse can inspect and receive the goods. Stock changes only after receipt approval.</p></div>'+
       '<button type="button" onclick="openCNReturnDashboard()" class="px-3 py-2 bg-[#211d18] text-white rounded-lg font-bold text-xs">View & Receive CN Returns →</button></div>'+
       (rows.length?'<div class="grid md:grid-cols-2 xl:grid-cols-3 gap-2">'+rows.slice(0,6).map(t=>
         '<button type="button" onclick="openCNReturnDashboard()" class="rounded-xl bg-white border p-3 text-left flex gap-3 hover:border-amber-300">'+
         img(t)+'<div class="min-w-0 flex-1"><div class="font-bold text-xs text-amber-700">'+x(t.cn_no)+' · '+x(t.product_code)+'</div>'+
         '<div class="text-xs font-medium truncate">'+x(t.item_name)+'</div>'+ '<div class="text-[10px] text-gray-600 truncate">Customer: '+x(t.customer_name||'—')+'</div>'+
         '<div class="text-[10px] font-bold mt-1 '+(t.return_status==='confirmed'?'text-amber-700':'text-emerald-700')+'">'+(t.approval_status==='pending'?'Awaiting CN Approval':t.approval_status==='rejected'?'CN Rejected':n(t.pending_approval_qty)>0?'Receipt Approval Pending':t.return_status==='confirmed'&&t.disposition!=='return_to_stock'?'Awaiting Physical Return · No Stock Action':t.return_status==='confirmed'?'Awaiting Physical Return':t.disposition!=='return_to_stock'?'Information Only':'Ready for Stock Receipt')+'</div>'+ 
          '<div class="text-[10px] text-gray-500">'+x(asDate(t.return_date))+
         ' · CN Qty '+n(t.cn_qty)+(t.disposition==='return_to_stock'?' · To Receive '+n(t.available_to_request):' · '+x(String(t.disposition||'No Stock Action').replaceAll('_',' ')))+'</div>'+ 
         (n(t.pending_approval_qty)>0?'<div class="text-[10px] text-amber-700">Approval pending: '+n(t.pending_approval_qty)+'</div>':'')+
         '</div></button>'
       ).join('')+'</div>':
       '<p class="text-xs text-gray-500">No CN returns currently need a physical stock receipt.</p>')+
       (rows.length>6?'<div class="text-xs text-amber-800 mt-2">+'+(rows.length-6)+' more CN lines · View & Receive to see all.</div>':'')+
       (pending.length?'<div class="text-[10px] text-amber-700 mt-2">'+pending.length+' line(s) awaiting approval; already-submitted quantities will not be double-received.</div>':'')+
        (awaiting.length?'<div class="text-[10px] text-amber-700 mt-2">'+awaiting.length+' submitted CN line(s) awaiting physical return confirmation.</div>':'');
   }catch(err){
     if(seq===call&&panel.isConnected)panel.innerHTML='<button onclick="openCNReturnDashboard()" class="text-xs text-red-700">CN queue unavailable: '+x(err.message)+' · Open My Requests →</button>';
   }
 }
 const old=window.renderStockInventoryBody;
 if(typeof old==='function'){
   window.renderStockInventoryBody=async function(){
     const result=await old.apply(this,arguments);
     await renderReturnCard();
     return result;
   };
 }
})();
