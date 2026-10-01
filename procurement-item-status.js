// Admin/Super Admin can update each Supplier PO item's procurement progress independently.
// Loaded last so item-level Production / Shipping / Arrived status flows into Sales tracking.
(function(){
  const pw=window.procurementWorkspace;
  const previousRenderProcurementWorkspace=window.renderProcurementWorkspace;
  const previousOpenEditSupplierPO=window.openEditSupplierPO;
  const poBulk=window.poItemBulkSelection||{selected:new Set(),rows:[]};
  if(!(poBulk.selected instanceof Set))poBulk.selected=new Set();
  window.poItemBulkSelection=poBulk;
  if(!pw||typeof previousRenderProcurementWorkspace!=='function')return;

  const STATUSES=['placed','production','ready','shipping','arrived','closed','cancelled'];
  const LABELS={
    placed:'Ordered / Placed',
    production:'In Production',
    ready:'Ready to Ship',
    shipping:'Shipping',
    arrived:'Arrived',
    closed:'Closed / Complete',
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
    let r=await db.from('supplier_po_items').select('id,supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,unit_cost,shipping_cost,procurement_status,historical_stock_reconciled,historical_stock_reconciled_at,historical_stock_reconciliation_note,created_at,product_catalog(image_url),supplier_pos(id,po_number,po_pending_reference,vendor_name,currency,status,estimated_arrival)').order('created_at',{ascending:false});
    if(r.error){
      r=await db.from('supplier_po_items').select('id,supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,unit_cost,shipping_cost,procurement_status,historical_stock_reconciled,historical_stock_reconciled_at,historical_stock_reconciliation_note,created_at,supplier_pos(id,po_number,po_pending_reference,vendor_name,currency,status,estimated_arrival)').order('created_at',{ascending:false});
    }
    if(r.error)throw r.error;
    return r.data||[];
  }

  async function renderPOItemsWithStatus(){
    if(!isAdminRole())throw new Error('Admin access required.');
    const all=await loadPOItems();
    const q=norm(pw.search);
    const rows=all.filter(taxProcurementMatches).filter(i=>!q||[
      i.product_code_snapshot,i.item_name_snapshot,poLabel(i.supplier_pos),i.supplier_pos?.vendor_name,i.procurement_status
    ].some(v=>norm(v).includes(q)));
    const liveRows=rows.filter(x=>!x.historical_stock_reconciled);
    const production=liveRows.filter(x=>norm(x.procurement_status)==='production').length;
    const shipping=liveRows.filter(x=>norm(x.procurement_status)==='shipping').length;
    const arrived=liveRows.filter(x=>['arrived','closed'].includes(norm(x.procurement_status))).length;
    const reconciled=rows.filter(x=>x.historical_stock_reconciled).length;
    poBulk.rows=rows;
    const visibleIds=new Set(rows.map(x=>String(x.id)));
    poBulk.selected=new Set([...poBulk.selected].filter(id=>visibleIds.has(String(id))));
    window.poItemBulkSelection=poBulk;
    const selectedRows=rows.filter(x=>poBulk.selected.has(String(x.id)));
    const selectedLive=selectedRows.filter(x=>!x.historical_stock_reconciled);
    const selectedHistorical=selectedRows.filter(x=>x.historical_stock_reconciled);
    const allSelected=rows.length>0&&rows.every(x=>poBulk.selected.has(String(x.id)));

    document.getElementById('content').innerHTML=`<div class="max-w-[1500px] mx-auto">
      <div class="pw-tabs">
        <button class="pw-tab" onclick="setProcurementTab('pos')">Supplier POs</button>
        <button class="pw-tab" data-needs-ordering-tab="1" onclick="setProcurementTab('needs')">Needs Ordering</button>
        <button class="pw-tab" onclick="setProcurementTab('ordered')">PO Ordered Items</button>
        <button class="pw-tab active" onclick="setProcurementTab('items')">PO Items</button>
        <button class="pw-tab" onclick="setProcurementTab('payments')">Supplier Payments</button>
        <button class="pw-tab" onclick="setProcurementTab('shipping')">Shipping / ETA</button>
        <button class="pw-tab" onclick="setProcurementTab('allocations')">SR Allocations</button>
        <button class="pw-tab" onclick="setProcurementTab('flow')">PO → SR → TK/RK</button>
      </div>
      <div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800 mb-4"><b>Item progress:</b> Admin and Super Admin can update each live PO item separately. Stock Balance treats Ordered / Production / Ready as <b>On Order</b>, Shipping as <b>Incoming</b>, and Arrived as <b>Arrived Pending Receive</b>. <b>Closed / Complete</b> is a finished terminal status and is excluded from the live procurement/stock pipeline. Historical / Reconciled items are locked until reconciliation is undone.</div>
      <div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        <div class="pw-stat"><div class="pw-stat-label">In Production</div><div class="pw-stat-value text-amber-700">${production}</div></div>
        <div class="pw-stat"><div class="pw-stat-label">Shipping</div><div class="pw-stat-value text-blue-700">${shipping}</div></div>
        <div class="pw-stat"><div class="pw-stat-label">Arrived / Closed</div><div class="pw-stat-value text-green-700">${arrived}</div></div>
        <div class="pw-stat"><div class="pw-stat-label">Historical Reconciled</div><div class="pw-stat-value text-purple-700">${reconciled}</div></div>
      </div>
      <div class="pw-toolbar"><input class="pw-search" value="${esc(pw.search)}" oninput="setProcurementSearch(this.value)" placeholder="Search PO, supplier, SKU, item, status..."><button onclick="openHistoricalPOReconciliation()" class="px-4 py-2 border border-purple-200 bg-purple-50 text-purple-700 rounded-xl text-xs font-semibold">Historical Stock Reconciliation</button></div>
      <div class="rounded-xl border bg-white p-3 mb-3 flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div class="flex flex-wrap items-center gap-3">
          <label class="inline-flex items-center gap-2 text-xs font-semibold cursor-pointer"><input type="checkbox" onchange="toggleSelectAllPOItems(this.checked)" ${allSelected?'checked':''}> Select All ${rows.length}</label>
          <span class="text-[10px] text-gray-400">${selectedRows.length} selected</span>
          ${selectedRows.length?'<button type="button" onclick="clearPOItemSelection()" class="px-2.5 py-1.5 border rounded-lg text-[10px] font-semibold">Clear</button>':''}
        </div>
        <div class="flex flex-wrap items-center gap-2 justify-end">
          <select id="poBulkItemStatus" class="border rounded-lg px-2.5 py-2 text-[10px] bg-white" ${selectedLive.length?'':'disabled'}>${options('placed')}</select>
          <button type="button" onclick="applyBulkPOItemStatus()" ${selectedLive.length?'':'disabled'} class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-semibold disabled:opacity-40">Set Status — Selected Live (${selectedLive.length})</button>
          <button type="button" onclick="reconcileSelectedPOItems(true)" ${selectedLive.length?'':'disabled'} class="px-3 py-2 border border-purple-200 bg-purple-50 text-purple-700 rounded-lg text-[10px] font-semibold disabled:opacity-40">Reconcile Selected (${selectedLive.length})</button>
          <button type="button" onclick="reconcileSelectedPOItems(false)" ${selectedHistorical.length?'':'disabled'} class="px-3 py-2 border border-purple-200 bg-white text-purple-700 rounded-lg text-[10px] font-semibold disabled:opacity-40">Undo Selected (${selectedHistorical.length})</button>
        </div>
      </div>
      <div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.length?rows.map(i=>{
        const p=i.supplier_pos||{};
        const photo=i.image_url_snapshot||i.product_catalog?.image_url||'';
        const checked=poBulk.selected.has(String(i.id));
        return `<div class="p-4 grid xl:grid-cols-[34px_64px_1.05fr_1.5fr_90px_230px_120px] gap-3 items-center ${i.historical_stock_reconciled?'bg-purple-50/20':''} ${checked?'ring-2 ring-purple-100':''}">
          <div class="flex justify-center"><input type="checkbox" aria-label="Select PO item" ${checked?'checked':''} onchange="togglePOItemSelection('${i.id}',this.checked)"></div>
          ${photoHtml(photo,56)}
          <div><b>${esc(poLabel(p))}</b><div class="text-[10px] text-gray-400">${esc(p.vendor_name||'')}</div><div class="text-[10px] text-gray-400 mt-1">ETA ${esc(p.estimated_arrival||'TBD')}</div></div>
          <div class="min-w-0"><div class="flex flex-wrap items-center gap-1.5"><div class="text-xs font-extrabold text-[#a77d1a] truncate">${esc(i.product_code_snapshot||'No Code')}${taxBadge(i)}</div>${i.historical_stock_reconciled?'<span class="px-2 py-0.5 rounded-md border border-purple-200 bg-purple-50 text-purple-700 text-[8px] font-bold">OPENING STOCK RECONCILED</span>':''}</div><div class="text-sm font-semibold truncate">${esc(i.item_name_snapshot||'')}</div><div class="text-[10px] text-gray-400 mt-1">Cost ${money(i.unit_cost||0,p.currency||'USD')} + Shipping ${money(i.shipping_cost||0,'USD')}${i.historical_stock_reconciliation_note?' · '+esc(i.historical_stock_reconciliation_note):''}</div></div>
          <div class="text-sm">Qty <b>${Number(i.qty||0)}</b></div>
          <div><label class="text-[9px] uppercase font-bold text-gray-400">Item Status</label>${i.historical_stock_reconciled
            ?'<div class="mt-1 w-full border border-purple-200 rounded-xl px-3 py-2 text-xs font-semibold bg-purple-50 text-purple-700">Historical / Reconciled</div><div class="text-[8px] text-gray-400 mt-1">Locked · undo reconciliation to reopen</div>'
            :`<select onchange="saveSupplierPOItemStatus('${i.id}',this.value,this)" class="mt-1 w-full border rounded-xl px-3 py-2 text-xs bg-white ${statusClass(i.procurement_status)}">${options(i.procurement_status)}</select>`}</div>
          <div class="text-right"><button onclick="openEditSupplierPO('${i.supplier_po_id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Open PO</button></div>
        </div>`;
      }).join(''):empty('No PO items found.')}</div></div>
    </div>`;
  }


  window.togglePOItemSelection=function(itemId,checked){
    const id=String(itemId);
    if(checked)poBulk.selected.add(id);else poBulk.selected.delete(id);
    renderPOItemsWithStatus().catch(err=>showToast(err.message||'Could not refresh PO Items.','err'));
  };

  window.toggleSelectAllPOItems=function(checked){
    (poBulk.rows||[]).forEach(x=>{
      const id=String(x.id);
      if(checked)poBulk.selected.add(id);else poBulk.selected.delete(id);
    });
    renderPOItemsWithStatus().catch(err=>showToast(err.message||'Could not refresh PO Items.','err'));
  };

  window.clearPOItemSelection=function(){
    poBulk.selected.clear();
    renderPOItemsWithStatus().catch(err=>showToast(err.message||'Could not refresh PO Items.','err'));
  };

  window.applyBulkPOItemStatus=async function(){
    if(!isAdminRole())return showToast('Admin access required.','err');
    const selected=(poBulk.rows||[]).filter(x=>poBulk.selected.has(String(x.id))&&!x.historical_stock_reconciled);
    if(!selected.length)return showToast('Select at least one live PO item.','err');
    const status=document.getElementById('poBulkItemStatus')?.value||'placed';
    if(!STATUSES.includes(norm(status)))return showToast('Invalid PO item status.','err');
    if(!confirm('Update '+selected.length+' selected live PO item(s) to '+statusLabel(status)+'?'))return;
    const r=await db.rpc('set_supplier_po_items_status_bulk',{
      p_supplier_po_item_ids:selected.map(x=>x.id),
      p_status:status
    });
    if(r.error)return showToast(r.error.message,'err');
    poBulk.selected.clear();
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
    showToast((r.data||0)+' PO item'+(Number(r.data||0)===1?'':'s')+' updated to '+statusLabel(status)+'.');
    await renderPOItemsWithStatus();
  };

  window.reconcileSelectedPOItems=async function(reconciled){
    if(!isAdminRole())return showToast('Admin access required.','err');
    const selected=(poBulk.rows||[]).filter(x=>poBulk.selected.has(String(x.id))&&(reconciled?!x.historical_stock_reconciled:x.historical_stock_reconciled));
    if(!selected.length)return showToast(reconciled?'Select at least one live PO item.':'Select at least one Historical / Reconciled PO item.','err');

    let note=null;
    if(reconciled){
      note=prompt('Historical reconciliation note for '+selected.length+' selected PO item(s):','Already reflected in opening/current stock');
      if(note===null)return;
      if(!confirm('Mark '+selected.length+' selected PO item(s) as already reflected in opening/current stock?\n\nThis will NOT add stock or create stock movements.'))return;
    }else{
      if(!confirm('Undo historical reconciliation for '+selected.length+' selected PO item(s)?\n\nTheir outstanding quantities will return to the live PO pipeline.'))return;
    }

    const r=await db.rpc('set_supplier_po_items_historical_reconciled',{
      p_supplier_po_item_ids:selected.map(x=>x.id),
      p_reconciled:!!reconciled,
      p_note:note
    });
    if(r.error)return showToast(r.error.message,'err');

    poBulk.selected.clear();
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    showToast((r.data||0)+' PO item'+(Number(r.data||0)===1?'':'s')+(reconciled?' reconciled without changing stock.':' restored to the live PO pipeline.'));
    await renderPOItemsWithStatus();
  };

  window._historicalPOReconciliationRows=window._historicalPOReconciliationRows||[];
  window._historicalPOReconciliationMode=window._historicalPOReconciliationMode||'needs';

  function historicalPOIsFullyReconciled(x){
    const out=Number(x.outstanding_items||0),rec=Number(x.reconciled_items||0);
    return rec>0&&out>0&&rec>=out;
  }
  function historicalPOIsCandidate(x){
    const out=Number(x.outstanding_items||0),rec=Number(x.reconciled_items||0);
    return out>rec;
  }
  window.renderHistoricalPOReconciliationBody=function(){
    const body=document.getElementById('modalBody');if(!body)return;
    const all=window._historicalPOReconciliationRows||[];
    const mode=window._historicalPOReconciliationMode||'needs';
    const rows=mode==='history'?all.filter(historicalPOIsFullyReconciled):all.filter(historicalPOIsCandidate);
    const needsCount=all.filter(historicalPOIsCandidate).length;
    const historyCount=all.filter(historicalPOIsFullyReconciled).length;
    body.innerHTML=`<div class="space-y-4">
      <div class="rounded-xl border border-purple-200 bg-purple-50 p-4 text-xs text-purple-900">
        <b>Use this only for imported / historical POs whose remaining quantities are already included in your opening or current physical stock.</b>
        Marking a PO here does <b>not</b> create any stock movement and does <b>not</b> increase On Hand. It moves the PO into historical purchasing history once all of its remaining inventory lines are reconciled.
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" onclick="setHistoricalPOReconciliationMode('needs')" class="px-3 py-2 rounded-xl border text-xs font-semibold ${mode==='needs'?'bg-[#211d18] text-white border-[#211d18]':'bg-white'}">Needs Reconciliation (${needsCount})</button>
        <button type="button" onclick="setHistoricalPOReconciliationMode('history')" class="px-3 py-2 rounded-xl border text-xs font-semibold ${mode==='history'?'bg-purple-700 text-white border-purple-700':'bg-white text-purple-700 border-purple-200'}">Reconciled History (${historyCount})</button>
      </div>
      <div class="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
        <label class="flex items-center gap-2 text-xs font-semibold"><input id="histPoSelectAll" type="checkbox" onchange="toggleHistoricalPOSelectAll(this.checked)"> Select all shown</label>
        <div class="text-[10px] text-gray-400">${rows.length} PO${rows.length===1?'':'s'} ${mode==='history'?'in reconciled history':'still needing reconciliation'}</div>
      </div>
      ${mode==='needs'?'<input id="histPoReconNote" class="w-full border rounded-xl px-3 py-2 text-xs" value="Already reflected in opening/current stock" placeholder="Reconciliation note">':''}
      <div class="max-h-[52vh] overflow-auto border rounded-xl divide-y">
        ${rows.length?rows.map(x=>{
          const out=Number(x.outstanding_items||0),rec=Number(x.reconciled_items||0);
          const remaining=Math.max(out-rec,0);
          return `<label class="flex gap-3 items-start p-3 hover:bg-gray-50 cursor-pointer ${mode==='history'?'bg-purple-50/20':''}">
            <input class="hist-po-check mt-1" type="checkbox" value="${x.supplier_po_id}">
            <div class="min-w-0 flex-1">
              <div class="flex flex-wrap items-center gap-2"><b class="text-sm">${esc(x.po_number||'PO')}</b>${mode==='history'?'<span class="px-2 py-0.5 rounded-md border border-purple-200 bg-purple-50 text-purple-700 text-[8px] font-bold">HISTORICAL / RECONCILED</span>':rec>0?'<span class="px-2 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-[8px] font-bold">PARTIAL</span>':''}</div>
              <div class="text-[10px] text-gray-500 mt-1">${esc(x.vendor_name||'')} · ${esc(String(x.order_date||''))}</div>
            </div>
            <div class="grid grid-cols-3 gap-4 text-right shrink-0">
              <div><div class="text-[8px] uppercase text-gray-400 font-bold">Outstanding</div><b class="text-xs">${Number(x.outstanding_qty||0).toLocaleString()}</b></div>
              <div><div class="text-[8px] uppercase text-purple-500 font-bold">Reconciled</div><b class="text-xs text-purple-700">${rec}</b></div>
              <div><div class="text-[8px] uppercase text-gray-400 font-bold">${mode==='history'?'Lines':'Still Live'}</div><b class="text-xs">${mode==='history'?out:remaining}</b></div>
            </div>
          </label>`;
        }).join(''):`<div class="p-10 text-center text-sm text-gray-400">${mode==='history'?'No reconciled historical POs yet.':'No POs currently need historical reconciliation.'}</div>`}
      </div>
      <div class="flex flex-wrap justify-end gap-2">
        ${mode==='history'
          ?'<button type="button" onclick="applyHistoricalPOReconciliation(false)" class="px-4 py-2 border border-purple-200 bg-purple-50 text-purple-700 rounded-xl text-xs font-semibold">Undo Selected Reconciliation</button>'
          :'<button type="button" onclick="applyHistoricalPOReconciliation(true)" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Mark Selected as Opening Stock</button>'}
      </div>
    </div>`;
  };

  window.setHistoricalPOReconciliationMode=function(mode){
    window._historicalPOReconciliationMode=mode==='history'?'history':'needs';
    renderHistoricalPOReconciliationBody();
  };

  window.openHistoricalPOReconciliation=async function(){
    if(!isAdminRole())return showToast('Admin access required.','err');
    openModal('Historical Stock Reconciliation','<div class="py-12 text-center text-sm text-gray-400">Loading Supplier POs...</div>');
    const r=await db.rpc('get_historical_po_reconciliation_candidates');
    if(r.error){
      document.getElementById('modalBody').innerHTML='<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-600">'+esc(r.error.message)+'</div>';
      return;
    }
    window._historicalPOReconciliationRows=Array.isArray(r.data)?r.data:[];
    if(!['needs','history'].includes(window._historicalPOReconciliationMode))window._historicalPOReconciliationMode='needs';
    renderHistoricalPOReconciliationBody();
  };

  window.toggleHistoricalPOSelectAll=function(checked){
    document.querySelectorAll('.hist-po-check').forEach(x=>x.checked=!!checked);
  };

  window.applyHistoricalPOReconciliation=async function(reconciled){
    if(!isAdminRole())return showToast('Admin access required.','err');
    const ids=[...document.querySelectorAll('.hist-po-check:checked')].map(x=>x.value).filter(Boolean);
    if(!ids.length)return showToast('Select at least one Supplier PO.','err');
    const note=document.getElementById('histPoReconNote')?.value.trim()||null;
    const msg=reconciled
      ?'Mark the selected PO remaining quantities as already reflected in opening/current stock? This will NOT add stock.'
      :'Undo historical stock reconciliation for the selected POs? Their outstanding quantities will return to the PO pipeline.';
    if(!confirm(msg))return;
    const r=await db.rpc('set_supplier_po_historical_reconciled',{
      p_supplier_po_ids:ids,
      p_reconciled:!!reconciled,
      p_note:note
    });
    if(r.error)return showToast(r.error.message,'err');
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
    showToast((r.data||0)+' PO item'+(Number(r.data||0)===1?'':'s')+(reconciled?' reconciled.':' restored to the PO pipeline.'));
    window._historicalPOReconciliationMode=reconciled?'history':'needs';
    if(typeof window.procurementWorkspace==='object'&&window.procurementWorkspace)window.procurementWorkspace.poView=reconciled?'history':'active';
    await openHistoricalPOReconciliation();
  };

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
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
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
    let r=await db.from('supplier_po_items').select('id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,procurement_status,historical_stock_reconciled,historical_stock_reconciliation_note,product_catalog(image_url)').eq('supplier_po_id',poId).order('created_at');
    if(r.error){
      r=await db.from('supplier_po_items').select('id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,procurement_status,historical_stock_reconciled,historical_stock_reconciliation_note').eq('supplier_po_id',poId).order('created_at');
    }
    if(r.error||!(r.data||[]).length)return;
    const items=r.data||[];
    const allHistorical=items.length>0&&items.every(i=>!!i.historical_stock_reconciled);
    const box=document.createElement('div');box.id='poItemProgressManager';box.className='mb-4 rounded-2xl border border-[#e9e3d8] overflow-hidden bg-white';
    box.innerHTML=`<div class="px-4 py-3 ${allHistorical?'bg-purple-50':'bg-[#fffaf0]'} border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><div class="font-bold text-sm">${allHistorical?'Historical Item Status':'Item Progress Status'}</div><div class="text-[10px] text-gray-500 mt-1">${allHistorical?'All PO inventory items are reconciled and locked as purchasing history. Undo reconciliation to reopen the live workflow.':'Update live products separately when some are in Production, Shipping or Arrived. Historical / Reconciled items stay locked.'}</div></div>${allHistorical?'':`<div class="flex gap-2"><select id="poAllItemStatus" class="border rounded-lg px-2 py-2 text-xs bg-white">${options('placed')}</select><button type="button" onclick="setAllPOItemStatuses('${poId}')" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">Apply to Live Items</button></div>`}</div><div class="divide-y">${items.map(i=>{
      const photo=i.image_url_snapshot||i.product_catalog?.image_url||'';
      const statusControl=i.historical_stock_reconciled
        ?'<div><div class="w-full border border-purple-200 rounded-xl px-3 py-2 text-xs font-semibold bg-purple-50 text-purple-700">Historical / Reconciled</div><div class="text-[8px] text-gray-400 mt-1">Locked</div></div>'
        :`<select onchange="saveSupplierPOItemStatus('${i.id}',this.value,this)" class="w-full border rounded-xl px-3 py-2 text-xs bg-white ${statusClass(i.procurement_status)}">${options(i.procurement_status)}</select>`;
      return `<div class="p-3 grid md:grid-cols-[58px_1fr_90px_230px] gap-3 items-center ${i.historical_stock_reconciled?'bg-purple-50/20':''}">${photoHtml(photo,52)}<div class="min-w-0"><div class="text-xs font-bold text-[#a77d1a] truncate">${esc(i.product_code_snapshot||'No Code')}${taxBadge(i)}</div><div class="text-sm truncate">${esc(i.item_name_snapshot||'')}</div>${i.historical_stock_reconciled?'<div class="text-[8px] text-purple-700 mt-1">Opening stock reconciled</div>':''}</div><div class="text-xs">Qty <b>${Number(i.qty||0)}</b></div>${statusControl}</div>`;
    }).join('')}</div>`;
    const firstList=section.querySelector('.divide-y.border.rounded-xl.mb-4');
    if(firstList)section.insertBefore(box,firstList);else section.prepend(box);
  }

  window.setAllPOItemStatuses=async function(poId){
    if(!isAdminRole())return showToast('Admin access required.','err');
    const status=document.getElementById('poAllItemStatus')?.value||'placed';
    const r=await db.from('supplier_po_items').update({procurement_status:status,updated_at:new Date().toISOString()}).eq('supplier_po_id',poId).eq('historical_stock_reconciled',false);
    if(r.error)return showToast(r.error.message,'err');
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
    showToast(`Live PO items updated: ${statusLabel(status)}`);
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
