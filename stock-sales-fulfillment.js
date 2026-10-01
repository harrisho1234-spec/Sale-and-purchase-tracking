// Stock ↔ Sales fulfillment bridge.
// Adds stock-side control for Sales Tracking item status without replacing the existing inventory module.
(function(){
  const F={rows:[],limit:60,loadedAt:0,showUnlinked:false};

  function n(v){return Number(v||0)}
  function fmtQty(v){
    const x=Number(v||0);
    if(!Number.isFinite(x))return '0';
    return Number.isInteger(x)?x.toLocaleString():x.toLocaleString(undefined,{maximumFractionDigits:2});
  }
  function escHtml(v){
    return String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function titleText(v){
    return String(v??'').replace(/[_-]+/g,' ').replace(/\b\w/g,m=>m.toUpperCase());
  }
  function localDateText(v){
    if(!v)return '';
    const s=String(v).slice(0,10);
    const parts=s.split('-');
    if(parts.length===3)return parts[2]+'/'+parts[1]+'/'+parts[0];
    try{return new Date(v).toLocaleDateString()}catch(_){return String(v)}
  }
  function role(){return String((typeof state!=='undefined'&&state?.profile?.role)||'')}
  function canOperate(){return ['stock_controller','admin','super_admin'].includes(role())}
  function canHistoricalReconcile(){return ['admin','super_admin'].includes(role())}
  function activeDeliveryTab(){
    const btn=[...document.querySelectorAll('.inv-tab')].find(b=>String(b.getAttribute('onclick')||'').includes("setInventoryTab('delivery')"));
    return !!btn?.classList.contains('active');
  }
  function statusRows(x){
    const rows=Array.isArray(x?.status_breakdown)?x.status_breakdown:[];
    return rows.map(r=>({
      status:String(r?.status||'').toLowerCase()==='ready'?'arrived':String(r?.status||'').toLowerCase(),
      qty:n(r?.qty)
    })).filter(r=>r.status&&r.qty>0);
  }
  function statusQty(x,status){return statusRows(x).filter(r=>r.status===status).reduce((s,r)=>s+n(r.qty),0)}
  function statusChips(x){
    const rows=statusRows(x);
    if(!rows.length)return '<span class="text-[10px] text-gray-400">No status</span>';
    return rows.map(r=>{
      const cls=r.status==='delivered'
        ?'bg-green-50 border-green-200 text-green-700'
        :r.status==='arrived'
          ?'bg-blue-50 border-blue-200 text-blue-700'
          :r.status==='cancelled'
            ?'bg-gray-50 border-gray-200 text-gray-500'
            :'bg-amber-50 border-amber-200 text-amber-800';
      return `<span class="inline-flex px-2 py-1 rounded-lg border text-[9px] font-bold ${cls}">${escHtml(titleText(r.status))} ${fmtQty(r.qty)}</span>`;
    }).join('');
  }

  async function loadRows(search=''){
    const r=await db.rpc('get_inventory_fulfillment_queue',{p_search:String(search||'').trim()||null});
    if(r.error)throw r.error;
    F.rows=r.data||[];
    F.loadedAt=Date.now();
    return F.rows;
  }

  function patchDeliveryTabLabel(trackedTotal){
    const btn=[...document.querySelectorAll('.inv-tab')].find(b=>String(b.getAttribute('onclick')||'').includes("setInventoryTab('delivery')"));
    if(btn){
      const active=btn.classList.contains('active');
      btn.innerHTML=`Customer Fulfillment${trackedTotal?`<span class="inv-tab-badge">${Number(trackedTotal).toLocaleString()}</span>`:''}`;
      if(active)btn.classList.add('active');
    }
  }

  async function patchDashboardFulfillmentCard(){
    if(activeDeliveryTab())return;
    const body=document.getElementById('inventoryBody');
    if(!body)return;
    const card=[...body.querySelectorAll('button')].find(b=>String(b.getAttribute('onclick')||'').includes("setInventoryTab('delivery')"));
    if(!card)return;
    try{
      const rows=await loadRows('');
      const tracked=rows.filter(x=>x.inventory_tracking_enabled).length;
      const unlinked=rows.length-tracked;
      card.innerHTML=`<div class="text-[9px] uppercase font-bold text-gray-400">Customer Fulfillment</div><div class="text-2xl font-black mt-1">${tracked.toLocaleString()}</div><div class="text-[10px] text-gray-500 mt-2">${tracked} linked waiting · ${unlinked} older unlinked items to review</div>`;
      patchDeliveryTabLabel(tracked);
    }catch(_){}
  }

  async function renderFulfillment(){
    if(!activeDeliveryTab())return;
    const body=document.getElementById('inventoryBody');
    if(!body)return;
    const search=document.querySelector('.inv-search')?.value||'';
    body.innerHTML='<div class="inv-card py-10 text-center text-sm text-gray-400">Loading Sales fulfillment...</div>';
    try{
      const rows=await loadRows(search);
      const linkedRows=rows.filter(x=>!!x.inventory_tracking_enabled);
      const unlinkedRows=rows.filter(x=>!x.inventory_tracking_enabled);
      patchDeliveryTabLabel(linkedRows.length);
      const sourceRows=F.showUnlinked?unlinkedRows:linkedRows;
      const shown=sourceRows.slice(0,F.limit);
      body.innerHTML=`<div class="space-y-3">
        <div class="rounded-xl border border-blue-100 bg-blue-50/40 p-3 flex flex-wrap items-center justify-between gap-3">
          <div><b class="text-sm">Sales Tracking ↔ Stock Fulfillment</b><div class="text-[10px] text-gray-500 mt-1">Live deliveries use approved Stock OUT. Older deliveries that happened before this workflow can be <b>Historically Reconciled</b> without deducting stock again.</div></div>
          <div class="flex flex-wrap gap-2">
            ${canHistoricalReconcile()?'<button type="button" onclick="openHistoricalFulfillmentHistory()" class="px-3 py-2 rounded-lg border border-purple-200 bg-purple-50 text-purple-700 text-[10px] font-semibold">Historical Delivery History</button>':''}
            <button type="button" onclick="showLinkedStockFulfillment()" class="px-3 py-2 rounded-lg border text-[10px] font-semibold ${!F.showUnlinked?'bg-[#211d18] text-white':'bg-white'}">Linked Fulfillment ${linkedRows.length}</button>
            <button type="button" onclick="showUnlinkedStockFulfillment()" class="px-3 py-2 rounded-lg border border-amber-200 text-[10px] font-semibold ${F.showUnlinked?'bg-amber-100 text-amber-900':'bg-amber-50 text-amber-800'}">Review Unlinked Sales Items ${unlinkedRows.length}</button>
          </div>
        </div>
        ${F.showUnlinked?`<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>Older Sales items:</b> choose <b>Link to Stock</b> if they still need real fulfillment, or use <b>Historical Delivery</b> when they were already delivered before this workflow and current stock already reflects it.</div>`:''}
        <div class="grid gap-3">${shown.length?shown.map(x=>{
          const arrived=statusQty(x,'arrived');
          const tracked=!!x.inventory_tracking_enabled;
          const historical=n(x.historical_qty);
          return `<div class="inv-card grid lg:grid-cols-[1.05fr_1.45fr_1.15fr_95px_105px_185px] gap-3 items-center ${tracked?'':'border-amber-200 bg-amber-50/20'}">
            <div><div class="flex flex-wrap gap-1.5 items-center"><b>${escHtml(x.document_no||'Sales Order')}</b><span class="px-2 py-0.5 rounded-full border text-[8px] font-bold ${tracked?'bg-green-50 border-green-200 text-green-700':'bg-amber-50 border-amber-200 text-amber-700'}">${tracked?'Linked to Stock':'Not Linked'}</span></div><div class="text-xs text-gray-500 mt-1">${escHtml(x.customer_name||'')}</div><div class="text-[9px] text-gray-400">${escHtml(localDateText(x.order_date))}${x.sales_rep_name?' · '+escHtml(x.sales_rep_name):''}</div></div>
            <div class="flex gap-3 items-center min-w-0"><div class="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">${x.image_url?`<img src="${escHtml(x.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${escHtml(x.product_code||'')}</div><div class="text-sm font-semibold truncate">${escHtml(x.item_name||'')}</div></div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400 mb-1">Item Status</div><div class="flex flex-wrap gap-1">${statusChips(x)}</div></div>
            <div class="text-xs"><div class="text-gray-400">Ordered</div><b>${fmtQty(x.ordered_qty)}</b><div class="text-[9px] text-gray-400 mt-1">Stock OUT ${fmtQty(x.released_qty)}</div>${historical>0?`<div class="text-[9px] text-purple-700 mt-0.5">Historical ${fmtQty(historical)}</div>`:''}</div>
            <div class="text-xs"><div class="text-gray-400">To Deliver</div><b class="text-amber-600">${fmtQty(x.remaining_qty)}</b><div class="text-[9px] ${arrived>0?'text-blue-600':'text-gray-400'} mt-1">Arrived ${fmtQty(arrived)}</div></div>
            <div class="flex flex-wrap gap-1.5 justify-end">${canOperate()?(tracked
              ?`<button onclick="openStockFulfillmentStatus('${x.sales_order_item_id}')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-semibold">Update Status</button>${arrived>0?`<button onclick="openStockFulfillmentRelease('${x.sales_order_item_id}')" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-[10px] font-semibold">Release / OUT</button>`:`<span class="px-2 py-2 text-[9px] text-gray-400">Mark Arrived before OUT</span>`}`
              :`<button onclick="linkStockFulfillmentItem('${x.sales_order_item_id}')" class="px-3 py-2 border border-amber-300 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-semibold">Link to Stock</button>`)
              :'<span class="text-[10px] text-gray-400">View only</span>'}${canHistoricalReconcile()&&n(x.remaining_qty)>0?`<button onclick="openHistoricalFulfillmentReconcile('${x.sales_order_item_id}')" class="px-3 py-2 border border-purple-200 bg-purple-50 text-purple-700 rounded-lg text-[10px] font-semibold">Historical Delivery</button>`:''}</div>
          </div>`;
        }).join(''):`<div class="inv-card py-12 text-center text-sm text-gray-400">${F.showUnlinked?'No unlinked Sales items match this search.':'No linked Stock items are currently waiting for fulfillment.'}</div>`}</div>
        ${sourceRows.length>F.limit?`<div class="flex justify-center gap-2"><span class="text-xs text-gray-400 self-center">Showing ${Math.min(F.limit,sourceRows.length)} of ${sourceRows.length}</span><button onclick="showMoreStockFulfillment()" class="px-3 py-2 border rounded-xl text-xs font-semibold bg-white">Show More</button></div>`:''}
      </div>`;
    }catch(err){
      body.innerHTML=`<div class="inv-card text-red-600">Error loading Sales fulfillment: ${escHtml(err.message||'Unknown error')}</div>`;
    }
  }

  window.showLinkedStockFulfillment=function(){
    F.showUnlinked=false;F.limit=60;renderFulfillment();
  };
  window.showUnlinkedStockFulfillment=function(){
    F.showUnlinked=true;F.limit=60;renderFulfillment();
  };

  window.showMoreStockFulfillment=function(){
    F.limit+=60;
    renderFulfillment();
  };

  window.openHistoricalFulfillmentReconcile=async function(itemId){
    if(!canHistoricalReconcile())return showToast('Admin or Super Admin access required.','err');
    try{
      let x=F.rows.find(r=>String(r.sales_order_item_id)===String(itemId));
      if(!x){await loadRows('');x=F.rows.find(r=>String(r.sales_order_item_id)===String(itemId))}
      if(!x)return showToast('This Sales item is no longer waiting for fulfillment.','err');
      const remaining=n(x.remaining_qty);
      if(remaining<=0)return showToast('This item is already fully delivered / reconciled.','err');

      const lr=await db.from('stock_locations').select('id,code,name,active').eq('active',true).order('sort_order').order('code');
      if(lr.error)throw lr.error;
      const locations=lr.data||[];
      const defaultDate=String(x.order_date||new Date().toISOString()).slice(0,10);

      openModal('Historical Delivery Reconciliation — '+(x.document_no||'Sales Order'),`<form id="historicalFulfillmentForm" class="space-y-4">
        <div class="rounded-xl border bg-[#fcfbf8] p-4">
          <div class="text-xs text-gray-500">${escHtml(x.customer_name||'')}</div>
          <div class="text-[10px] font-bold text-[#a77d1a] mt-1">${escHtml(x.product_code||'')}</div>
          <div class="font-semibold">${escHtml(x.item_name||'')}</div>
          <div class="mt-3 flex flex-wrap gap-2 text-[10px]">
            <span class="px-2 py-1 rounded-lg border bg-white">Ordered <b>${fmtQty(x.ordered_qty)}</b></span>
            <span class="px-2 py-1 rounded-lg border bg-white">Stock OUT <b>${fmtQty(x.released_qty)}</b></span>
            ${n(x.historical_qty)>0?`<span class="px-2 py-1 rounded-lg border border-purple-200 bg-purple-50 text-purple-700">Already Historical <b>${fmtQty(x.historical_qty)}</b></span>`:''}
            <span class="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800">Remaining <b>${fmtQty(remaining)}</b></span>
          </div>
        </div>
        <div class="rounded-xl border border-purple-200 bg-purple-50 p-3 text-xs text-purple-900"><b>No stock will be deducted.</b> Use this only when the product was physically delivered before Customer Fulfillment / live Stock OUT tracking was introduced and today's inventory already reflects that delivery.</div>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="text-xs font-semibold">Historical Delivered Qty *</label><input id="hfQty" type="number" min="1" max="${remaining}" step="1" value="${remaining}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Historical Delivery Date *</label><input id="hfDate" type="date" max="${new Date().toISOString().slice(0,10)}" value="${defaultDate}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Former Stock Location <span class="font-normal text-gray-400">(optional)</span></label><select id="hfLocation" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Unknown / not recorded</option>${locations.map(l=>`<option value="${l.id}">${escHtml(l.code||l.name||'Location')}${l.name&&l.name!==l.code?' · '+escHtml(l.name):''}</option>`).join('')}</select><div class="text-[9px] text-gray-400 mt-1">For audit reference only. Selecting a location does not reduce its current stock.</div></div>
          <div><label class="text-xs font-semibold">Reference / Note</label><textarea id="hfNote" maxlength="2000" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: Delivered before inventory migration; current opening stock already excludes this item."></textarea></div>
        </div>
        <button id="hfSave" class="w-full bg-purple-700 text-white rounded-xl py-3 font-semibold">Reconcile Historical Delivery — No Stock Deduction</button>
      </form>`);

      document.getElementById('historicalFulfillmentForm').onsubmit=async e=>{
        e.preventDefault();
        const qty=Number(document.getElementById('hfQty')?.value||0);
        if(!Number.isInteger(qty)||qty<=0||qty>remaining)return showToast('Historical quantity must be a whole number from 1 to '+fmtQty(remaining)+'.','err');
        const date=document.getElementById('hfDate')?.value;
        if(!date)return showToast('Historical delivery date is required.','err');
        const btn=document.getElementById('hfSave');btn.disabled=true;btn.textContent='Reconciling...';
        const rr=await db.rpc('reconcile_historical_customer_delivery',{
          p_sales_order_item_id:itemId,
          p_qty:qty,
          p_delivery_date:date,
          p_stock_location_id:document.getElementById('hfLocation')?.value||null,
          p_note:document.getElementById('hfNote')?.value.trim()||null
        });
        if(rr.error){btn.disabled=false;btn.textContent='Reconcile Historical Delivery — No Stock Deduction';return showToast(rr.error.message,'err')}
        closeModal();
        showToast('Historical delivery reconciled. Current stock was not changed.');
        await loadRows(document.querySelector('.inv-search')?.value||'');
        await renderFulfillment();
        if(typeof window.refreshAppNotifications==='function')setTimeout(()=>window.refreshAppNotifications(),50);
      };
    }catch(err){showToast(err.message||'Could not open Historical Delivery reconciliation.','err')}
  };

  window.openHistoricalFulfillmentHistory=async function(){
    if(!canHistoricalReconcile())return;
    openModal('Historical Delivery Reconciliation History','<div id="historicalFulfillmentHistoryBody" class="py-10 text-center text-sm text-gray-400">Loading historical delivery records...</div>');
    try{
      const r=await db.rpc('get_historical_customer_delivery_history',{p_search:null});
      if(r.error)throw r.error;
      const rows=Array.isArray(r.data)?r.data:[];
      const body=document.getElementById('historicalFulfillmentHistoryBody');
      if(!body)return;
      body.className='space-y-3 max-h-[70vh] overflow-auto pr-1';
      body.innerHTML=rows.length?rows.map(h=>`<div class="rounded-xl border p-3 grid md:grid-cols-[1.3fr_1.5fr_90px_1fr] gap-3 items-center">
        <div><div class="font-semibold text-sm">${escHtml(h.document_no||'Sales Order')}</div><div class="text-xs text-gray-500">${escHtml(h.customer_name||'')}</div><div class="text-[9px] text-gray-400 mt-1">Delivered ${escHtml(localDateText(h.delivery_date))}</div></div>
        <div class="flex items-center gap-3 min-w-0"><div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 shrink-0">${h.image_url?`<img src="${escHtml(h.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[7px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[9px] font-bold text-[#a77d1a]">${escHtml(h.product_code||'')}</div><div class="text-xs font-semibold truncate">${escHtml(h.item_name||'')}</div><div class="text-[9px] text-gray-400">${h.location_code?'Former location '+escHtml(h.location_code):'Location not recorded'}</div></div></div>
        <div class="text-xs"><div class="text-gray-400">Historical Qty</div><b class="text-lg text-purple-700">${fmtQty(h.qty)}</b></div>
        <div class="text-[10px] text-gray-500"><div>Reconciled by <b>${escHtml(h.reconciled_by_name||'Admin')}</b></div><div class="mt-1">${escHtml(new Date(h.reconciled_at).toLocaleString())}</div>${h.note?`<div class="mt-2 whitespace-pre-wrap text-gray-600">${escHtml(h.note)}</div>`:''}</div>
      </div>`).join(''):'<div class="py-12 text-center text-sm text-gray-400">No historical delivery reconciliations yet.</div>';
    }catch(err){
      const body=document.getElementById('historicalFulfillmentHistoryBody');
      if(body)body.innerHTML='<div class="rounded-xl border border-red-100 bg-red-50 p-4 text-sm text-red-600">'+escHtml(err.message||'Unable to load historical delivery history.')+'</div>';
    }
  };

  window.linkStockFulfillmentItem=async function(itemId){
    if(!canOperate())return;
    try{
      const r=await db.rpc('enable_inventory_tracking_for_sales_item',{p_sales_order_item_id:itemId});
      if(r.error)throw r.error;
      F.justLinkedId='';
      showToast('Linked to Stock. Existing Sales Tracking status kept and quantity is now included in Reserved.');
      await loadRows(document.querySelector('.inv-search')?.value||'');
      await renderFulfillment();
    }catch(err){showToast(err.message||'Could not link Sales item to Stock.','err')}
  };

  window.openStockFulfillmentStatus=async function(itemId){
    if(!canOperate())return;
    try{
      let x=F.rows.find(r=>String(r.sales_order_item_id)===String(itemId));
      if(!x){
        await loadRows('');
        x=F.rows.find(r=>String(r.sales_order_item_id)===String(itemId));
      }
      if(!x)return showToast('Sales item is no longer waiting for fulfillment.','err');
      if(!x.inventory_tracking_enabled)return linkStockFulfillmentItem(itemId);

      const r=await db.rpc('get_inventory_item_status_for_stock',{p_sales_order_item_id:itemId});
      if(r.error)throw r.error;
      const rows=r.data||[];
      const get=s=>rows.filter(a=>String(a.status||'').toLowerCase()===s).reduce((sum,a)=>sum+n(a.qty),0);
      const delivered=get('delivered'),cancelled=get('cancelled');
      const active=Math.max(n(x.ordered_qty)-delivered-cancelled,0);
      const vals={ordered:get('ordered'),production:get('production'),shipping:get('shipping'),arrived:get('arrived')};

      openModal('Update Item Status — '+(x.document_no||'Sales Order'),`<form id="stockFulfillmentStatusForm" class="space-y-4">
        <div class="rounded-xl border bg-[#fcfbf8] p-4">
          <div class="text-xs text-gray-500">${escHtml(x.customer_name||'')}</div>
          <div class="text-[10px] font-bold text-[#a77d1a] mt-1">${escHtml(x.product_code||'')}</div>
          <div class="font-semibold">${escHtml(x.item_name||'')}</div>
          <div class="mt-3 flex flex-wrap gap-2 text-[10px]">
            <span class="px-2 py-1 rounded-lg border bg-white">Sold <b>${fmtQty(x.ordered_qty)}</b></span>
            <span class="px-2 py-1 rounded-lg border bg-green-50 border-green-200 text-green-700">Delivered / Fulfilled <b>${fmtQty(delivered)}</b></span>${n(x.historical_qty)>0?`<span class="px-2 py-1 rounded-lg border border-purple-200 bg-purple-50 text-purple-700">Historical <b>${fmtQty(x.historical_qty)}</b></span>`:''}
            ${cancelled>0?`<span class="px-2 py-1 rounded-lg border bg-gray-50">Cancelled <b>${fmtQty(cancelled)}</b></span>`:''}
            <span class="px-2 py-1 rounded-lg border bg-amber-50 border-amber-200 text-amber-800">Qty to assign <b>${fmtQty(active)}</b></span>
          </div>
        </div>
        <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Stock controls physical fulfillment.</b> Update the undelivered quantity below. Delivered is locked; it changes only through approved Stock OUT or Admin Historical Delivery Reconciliation.</div>
        <div class="grid sm:grid-cols-2 gap-3">
          ${[['ordered','Ordered'],['production','Production'],['shipping','Shipping'],['arrived','Arrived']].map(([s,l])=>`<div><label class="text-xs font-semibold">${l}</label><input id="sfStatus_${s}" type="number" min="0" step="any" value="${vals[s]||0}" oninput="updateStockFulfillmentStatusTotal()" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>`).join('')}
        </div>
        <div id="stockFulfillmentStatusTotal" class="rounded-xl border p-3 text-xs"></div>
        <button id="stockFulfillmentStatusSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Item Status</button>
      </form>`);
      window._stockFulfillmentTarget=active;
      updateStockFulfillmentStatusTotal();

      document.getElementById('stockFulfillmentStatusForm').onsubmit=async e=>{
        e.preventDefault();
        const allocations=['ordered','production','shipping','arrived'].map(status=>({status,qty:Number(document.getElementById('sfStatus_'+status)?.value||0)})).filter(a=>a.qty>0);
        const total=allocations.reduce((s,a)=>s+a.qty,0);
        if(Math.abs(total-active)>0.0001)return showToast('Status quantities must equal '+fmtQty(active)+'.','err');
        const btn=document.getElementById('stockFulfillmentStatusSave');btn.disabled=true;btn.textContent='Saving...';
        const sr=await db.rpc('save_inventory_item_status_quantities',{p_sales_order_item_id:itemId,p_allocations:allocations});
        if(sr.error){btn.disabled=false;btn.textContent='Save Item Status';return showToast(sr.error.message,'err')}
        closeModal();showToast('Item status updated in Sales Tracking and Stock.');
        if(window.renderStockInventory)await window.renderStockInventory();else await renderFulfillment();
      };
    }catch(err){showToast(err.message||'Could not open item status.','err')}
  };

  window.updateStockFulfillmentStatusTotal=function(){
    const target=n(window._stockFulfillmentTarget);
    const total=['ordered','production','shipping','arrived'].reduce((s,status)=>s+Number(document.getElementById('sfStatus_'+status)?.value||0),0);
    const el=document.getElementById('stockFulfillmentStatusTotal');if(!el)return;
    const ok=Math.abs(total-target)<=0.0001;
    el.className=`rounded-xl border p-3 text-xs ${ok?'bg-green-50 border-green-200 text-green-700':'bg-red-50 border-red-200 text-red-700'}`;
    el.innerHTML=`Assigned <b>${fmtQty(total)}</b> / ${fmtQty(target)}${ok?' · Ready to save':' · Adjust the quantities above'}`;
  };

  window.openStockFulfillmentRelease=async function(itemId){
    if(!canOperate())return;
    try{
      let x=F.rows.find(r=>String(r.sales_order_item_id)===String(itemId));
      if(!x){await loadRows('');x=F.rows.find(r=>String(r.sales_order_item_id)===String(itemId))}
      if(!x)return showToast('Sales item is no longer waiting for fulfillment.','err');
      if(!x.inventory_tracking_enabled)return linkStockFulfillmentItem(itemId,true);
      const arrived=statusQty(x,'arrived');
      if(arrived<=0)return showToast('Mark at least one unit Arrived before releasing stock.','err');

      const br=await db.from('inventory_product_balance').select('*').eq('product_id',x.product_id).maybeSingle();
      if(br.error)throw br.error;
      const bal=br.data||{};
      const locs=(Array.isArray(bal.locations)?bal.locations:[]).filter(l=>n(l.qty)>0);
      if(!locs.length)return showToast('No physical stock location has quantity available for this product.','err');
      const maxQty=Math.min(n(x.remaining_qty),arrived);
      openModal('Release Customer Stock — '+(x.document_no||'Sales Order'),`<form id="stockFulfillmentReleaseForm" class="space-y-4">
        <div class="rounded-xl border bg-gray-50 p-4"><div class="text-xs text-gray-500">${escHtml(x.customer_name||'')}</div><div class="text-[10px] font-bold text-[#a77d1a] mt-1">${escHtml(x.product_code||'')}</div><div class="font-semibold">${escHtml(x.item_name||'')}</div><div class="text-xs mt-2">Ordered ${fmtQty(x.ordered_qty)} · OUT ${fmtQty(x.released_qty)} · Arrived ${fmtQty(arrived)} · <b>Remaining ${fmtQty(x.remaining_qty)}</b></div></div>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="text-xs font-semibold">Release Qty *</label><input id="sfReleaseQty" type="number" min="1" max="${maxQty}" step="1" value="${maxQty}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">From Location *</label><select id="sfReleaseLocation" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Select stock location</option>${locs.map(l=>`<option value="${l.location_id}">${escHtml(l.code||l.name||'Location')} · On Hand ${fmtQty(l.qty)}</option>`).join('')}</select></div>
          <div><label class="text-xs font-semibold">Delivery Date</label><input id="sfReleaseDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Remark</label><input id="sfReleaseNote" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        </div>
        <button id="sfReleaseSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Confirm Stock OUT</button>
      </form>`);
      document.getElementById('stockFulfillmentReleaseForm').onsubmit=async e=>{
        e.preventDefault();
        const qty=Number(document.getElementById('sfReleaseQty')?.value||0);
        if(!Number.isInteger(qty)||qty<=0||qty>maxQty)return showToast('Release quantity must be a whole number from 1 to '+fmtQty(maxQty)+'.','err');
        const loc=document.getElementById('sfReleaseLocation')?.value;
        if(!loc)return showToast('Select a stock location.','err');
        const btn=document.getElementById('sfReleaseSave');btn.disabled=true;btn.textContent='Releasing...';
        const rr=await db.rpc('release_sales_stock',{
          p_sales_order_item_id:itemId,
          p_qty:qty,
          p_location_id:loc,
          p_delivery_date:document.getElementById('sfReleaseDate')?.value||null,
          p_note:document.getElementById('sfReleaseNote')?.value.trim()||null
        });
        if(rr.error){btn.disabled=false;btn.textContent='Confirm Stock OUT';return showToast(rr.error.message,'err')}
        closeModal();showToast('Customer stock released. Sales item status updated automatically.');
        if(window.renderStockInventory)await window.renderStockInventory();else await renderFulfillment();
      };
    }catch(err){showToast(err.message||'Could not release customer stock.','err')}
  };

  const baseBody=window.renderStockInventoryBody;
  if(typeof baseBody==='function'){
    window.renderStockInventoryBody=async function(){
      const r=await baseBody.apply(this,arguments);
      if(activeDeliveryTab())await renderFulfillment();
      else patchDashboardFulfillmentCard();
      return r;
    };
  }

  // Patch the visible tab label immediately when the module loads.
  setTimeout(()=>patchDashboardFulfillmentCard(),80);
})();
