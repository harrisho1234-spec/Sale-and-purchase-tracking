// Admin/Super Admin can update each Supplier PO item's procurement progress independently.
// Loaded last so item-level Production / Shipping / Arrived status flows into Sales tracking.
(function(){
  const pw=window.procurementWorkspace;
  const previousRenderProcurementWorkspace=window.renderProcurementWorkspace;
  const previousOpenEditSupplierPO=window.openEditSupplierPO;
  if(!pw||typeof previousRenderProcurementWorkspace!=='function')return;

  const STATUSES=['placed','production','ready','shipping','arrived','closed','cancelled'];
  const LABELS={
    placed:'Ordered / Placed',
    production:'In Production',
    ready:'Ready to Ship',
    shipping:'Shipping',
    arrived:'Arrived',
    closed:'Closed',
    cancelled:'Cancelled'
  };

  function norm(v=''){return String(v||'').trim().toLowerCase()}
  function isAdminRole(){return ['admin','super_admin'].includes(state.profile?.role||'')}
  function statusLabel(s){return LABELS[norm(s)]||titleCase(s||'placed')}
  function statusClass(s){
    s=norm(s);
    if(s==='arrived'||s==='closed')return 'bg-green-50 text-green-700 border-green-200';
    if(s==='shipping')return 'bg-blue-50 text-blue-700 border-blue-200';
    if(s==='production'||s==='ready')return 'bg-amber-50 text-amber-700 border-amber-200';
    if(s==='cancelled')return 'bg-red-50 text-red-700 border-red-200';
    return 'bg-gray-50 text-gray-700 border-gray-200';
  }
  function imgUrl(raw=''){return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw||''):(raw||'')}
  function photoHtml(raw,size=56){
    const u=imgUrl(raw);
    if(!u)return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 flex items-center justify-center text-[9px] text-gray-400 shrink-0">No Photo</div>`;
    return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 overflow-hidden shrink-0"><img src="${esc(u)}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full items-center justify-center text-[9px] text-gray-400">No Photo</div></div>`;
  }
  function options(current){
    return STATUSES.map(s=>`<option value="${s}" ${norm(current)===s?'selected':''}>${esc(statusLabel(s))}</option>`).join('');
  }
  function poLabel(p){return p?.po_number||p?.po_pending_reference||'PO Pending'}

  async function loadPOItems(){
    let r=await db.from('supplier_po_items').select('id,supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,unit_cost,shipping_cost,procurement_status,created_at,product_catalog(image_url),supplier_pos(id,po_number,po_pending_reference,vendor_name,currency,status,estimated_arrival)').order('created_at',{ascending:false});
    if(r.error){
      r=await db.from('supplier_po_items').select('id,supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,unit_cost,shipping_cost,procurement_status,created_at,supplier_pos(id,po_number,po_pending_reference,vendor_name,currency,status,estimated_arrival)').order('created_at',{ascending:false});
    }
    if(r.error)throw r.error;
    return r.data||[];
  }

  async function renderPOItemsWithStatus(){
    if(!isAdminRole())throw new Error('Admin access required.');
    const all=await loadPOItems();
    const q=norm(pw.search);
    const rows=all.filter(i=>!q||[
      i.product_code_snapshot,i.item_name_snapshot,poLabel(i.supplier_pos),i.supplier_pos?.vendor_name,i.procurement_status
    ].some(v=>norm(v).includes(q)));
    const production=rows.filter(x=>norm(x.procurement_status)==='production').length;
    const shipping=rows.filter(x=>norm(x.procurement_status)==='shipping').length;
    const arrived=rows.filter(x=>['arrived','closed'].includes(norm(x.procurement_status))).length;

    document.getElementById('content').innerHTML=`<div class="max-w-[1500px] mx-auto">
      <div class="pw-tabs">
        <button class="pw-tab" onclick="setProcurementTab('pos')">Supplier POs</button>
        <button class="pw-tab" onclick="setProcurementTab('needs')">Needs Ordering</button>
        <button class="pw-tab active" onclick="setProcurementTab('items')">PO Items</button>
        <button class="pw-tab" onclick="setProcurementTab('payments')">Supplier Payments</button>
        <button class="pw-tab" onclick="setProcurementTab('shipping')">Shipping / ETA</button>
        <button class="pw-tab" onclick="setProcurementTab('allocations')">SR Allocations</button>
      </div>
      <div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 mb-4"><b>Item progress:</b> Admin and Super Admin can update each PO item separately. For linked SR items, this status automatically flows into Sales Order Tracking.</div>
      <div class="grid sm:grid-cols-3 gap-3 mb-4">
        <div class="pw-stat"><div class="pw-stat-label">In Production</div><div class="pw-stat-value text-amber-700">${production}</div></div>
        <div class="pw-stat"><div class="pw-stat-label">Shipping</div><div class="pw-stat-value text-blue-700">${shipping}</div></div>
        <div class="pw-stat"><div class="pw-stat-label">Arrived / Closed</div><div class="pw-stat-value text-green-700">${arrived}</div></div>
      </div>
      <div class="pw-toolbar"><input class="pw-search" value="${esc(pw.search)}" oninput="setProcurementSearch(this.value)" placeholder="Search PO, supplier, SKU, item, status..."></div>
      <div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(i=>{
        const p=i.supplier_pos||{};
        const photo=i.image_url_snapshot||i.product_catalog?.image_url||'';
        return `<div class="p-4 grid xl:grid-cols-[64px_1.05fr_1.5fr_90px_230px_120px] gap-3 items-center">
          ${photoHtml(photo,56)}
          <div><b>${esc(poLabel(p))}</b><div class="text-[10px] text-gray-400">${esc(p.vendor_name||'')}</div><div class="text-[10px] text-gray-400 mt-1">ETA ${esc(p.estimated_arrival||'TBD')}</div></div>
          <div class="min-w-0"><div class="text-xs font-extrabold text-[#a77d1a] truncate">${esc(i.product_code_snapshot||'No Code')}</div><div class="text-sm font-semibold truncate">${esc(i.item_name_snapshot||'')}</div><div class="text-[10px] text-gray-400 mt-1">Cost ${money(i.unit_cost||0,p.currency||'USD')} + Shipping ${money(i.shipping_cost||0,p.currency||'USD')}</div></div>
          <div class="text-sm">Qty <b>${Number(i.qty||0)}</b></div>
          <div><label class="text-[9px] uppercase font-bold text-gray-400">Item Status</label><select onchange="saveSupplierPOItemStatus('${i.id}',this.value,this)" class="mt-1 w-full border rounded-xl px-3 py-2 text-xs bg-white ${statusClass(i.procurement_status)}">${options(i.procurement_status)}</select></div>
          <div class="text-right"><button onclick="openEditSupplierPO('${i.supplier_po_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Open PO</button></div>
        </div>`;
      }).join(''):empty('No PO items found.')}</div></div>
    </div>`;
  }

  window.saveSupplierPOItemStatus=async function(itemId,status,selectEl=null){
    if(!isAdminRole())return showToast('Admin access required.','err');
    if(!STATUSES.includes(norm(status)))return showToast('Invalid item status.','err');
    if(selectEl)selectEl.disabled=true;
    const r=await db.from('supplier_po_items').update({procurement_status:norm(status),updated_at:new Date().toISOString()}).eq('id',itemId);
    if(selectEl)selectEl.disabled=false;
    if(r.error)return showToast(r.error.message,'err');
    if(selectEl){
      selectEl.className=`mt-1 w-full border rounded-xl px-3 py-2 text-xs bg-white ${statusClass(status)}`;
    }
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    showToast(`Item status updated: ${statusLabel(status)}`);
  };

  window.renderProcurementWorkspace=async function(){
    if(pw.tab==='items')return renderPOItemsWithStatus();
    return previousRenderProcurementWorkspace.apply(this,arguments);
  };

  async function injectPOItemStatusManager(poId){
    const section=document.querySelector('#modalBody .border-t.pt-5');
    if(!section)return;
    document.getElementById('poItemProgressManager')?.remove();
    let r=await db.from('supplier_po_items').select('id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,procurement_status,product_catalog(image_url)').eq('supplier_po_id',poId).order('created_at');
    if(r.error){
      r=await db.from('supplier_po_items').select('id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,procurement_status').eq('supplier_po_id',poId).order('created_at');
    }
    if(r.error||!(r.data||[]).length)return;
    const items=r.data||[];
    const box=document.createElement('div');box.id='poItemProgressManager';box.className='mb-4 rounded-2xl border border-[#e9e3d8] overflow-hidden bg-white';
    box.innerHTML=`<div class="px-4 py-3 bg-[#fffaf0] border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><div class="font-bold text-sm">Item Progress Status</div><div class="text-[10px] text-gray-500 mt-1">Update products separately when some are in Production, Shipping or Arrived.</div></div><div class="flex gap-2"><select id="poAllItemStatus" class="border rounded-lg px-2 py-2 text-xs bg-white">${options('placed')}</select><button type="button" onclick="setAllPOItemStatuses('${poId}')" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">Apply to All</button></div></div><div class="divide-y">${items.map(i=>{
      const photo=i.image_url_snapshot||i.product_catalog?.image_url||'';
      return `<div class="p-3 grid md:grid-cols-[58px_1fr_90px_230px] gap-3 items-center">${photoHtml(photo,52)}<div class="min-w-0"><div class="text-xs font-bold text-[#a77d1a] truncate">${esc(i.product_code_snapshot||'No Code')}</div><div class="text-sm truncate">${esc(i.item_name_snapshot||'')}</div></div><div class="text-xs">Qty <b>${Number(i.qty||0)}</b></div><select onchange="saveSupplierPOItemStatus('${i.id}',this.value,this)" class="w-full border rounded-xl px-3 py-2 text-xs bg-white ${statusClass(i.procurement_status)}">${options(i.procurement_status)}</select></div>`;
    }).join('')}</div>`;
    const firstList=section.querySelector('.divide-y.border.rounded-xl.mb-4');
    if(firstList)section.insertBefore(box,firstList);else section.prepend(box);
  }

  window.setAllPOItemStatuses=async function(poId){
    if(!isAdminRole())return showToast('Admin access required.','err');
    const status=document.getElementById('poAllItemStatus')?.value||'placed';
    const r=await db.from('supplier_po_items').update({procurement_status:status,updated_at:new Date().toISOString()}).eq('supplier_po_id',poId);
    if(r.error)return showToast(r.error.message,'err');
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    showToast(`All PO items updated: ${statusLabel(status)}`);
    await injectPOItemStatusManager(poId);
  };

  if(typeof previousOpenEditSupplierPO==='function'){
    window.openEditSupplierPO=async function(poId){
      const result=await previousOpenEditSupplierPO.apply(this,arguments);
      await injectPOItemStatusManager(poId);
      return result;
    };
  }
})();
