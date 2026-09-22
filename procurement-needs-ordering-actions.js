// Makes "Create New PO" from Needs Ordering create the PO item and allocate it back to the SR immediately.
(function(){
  function norm(v=''){return String(v||'').trim().toLowerCase()}
  function n(v){return Number(v||0)}
  function qfmt(v){const x=n(v);return Number.isInteger(x)?String(x):x.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}
  function imageUrl(raw=''){return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw||''):(raw||'')}
  function photo(raw,size=58){const u=imageUrl(raw);if(!u)return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 flex items-center justify-center text-[9px] text-gray-400 shrink-0">No Photo</div>`;return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 overflow-hidden shrink-0"><img src="${esc(u)}" class="w-full h-full object-cover"></div>`}

  async function loadNeed(id){
    const ir=await db.from('sales_order_items').select('id,sales_order_id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,sales_orders!inner(sr_no,order_no,customers(name)),product_catalog(image_url)').eq('id',id).single();
    if(ir.error)throw ir.error;
    const lr=await db.from('fulfillment_links').select('qty_allocated,supplier_po_items(supplier_pos(status))').eq('sales_order_item_id',id);
    if(lr.error)throw lr.error;
    let allocated=0;for(const l of (lr.data||[])){if(norm(l.supplier_po_items?.supplier_pos?.status)!=='cancelled')allocated+=n(l.qty_allocated)}
    const need=Math.max(0,Math.round((n(ir.data.qty)-allocated+Number.EPSILON)*100)/100);
    return {...ir.data,need,allocated,image:ir.data.image_url_snapshot||ir.data.product_catalog?.image_url||'',sr:ir.data.sales_orders?.sr_no||ir.data.sales_orders?.order_no||'SR',customer:ir.data.sales_orders?.customers?.name||''};
  }

  window.needsCreateNewPO=async function(itemId){
    let x;try{x=await loadNeed(itemId)}catch(err){return showToast(err.message,'err')}
    if(x.need<=0)return showToast('This SR item is already fully covered by supplier PO allocation.','err');
    openModal('Create Supplier PO for Needed Item',`<form id="needsNewPOForm" class="space-y-5">
      <div class="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-100 p-3">${photo(x.image,60)}<div><div class="text-xs font-bold text-[#a77d1a]">${esc(x.product_code_snapshot||'')}</div><div class="font-semibold">${esc(x.item_name_snapshot||'')}</div><div class="text-xs text-gray-500">${esc(x.sr)} · ${esc(x.customer)} · Need ${qfmt(x.need)}</div></div></div>
      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Official PO Number</label><input id="npoNo" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Leave blank if pending"></div>
        <div><label class="text-xs font-semibold">Vendor / Supplier</label><input id="npoVendor" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Order Date</label><input id="npoDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Currency</label><select id="npoCurrency" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option>USD</option><option>EUR</option><option>CNY</option><option>GBP</option></select></div>
        <div><label class="text-xs font-semibold">Shipping Agent</label><input id="npoAgent" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">ETA</label><input id="npoEta" type="date" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Qty to Order / Allocate</label><input id="npoQty" type="number" min="0.01" max="${x.need}" step="0.01" value="${qfmt(x.need)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Unit Cost</label><input id="npoCost" type="number" min="0" step="0.01" value="0" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Shipping / Unit</label><input id="npoShip" type="number" min="0" step="0.01" value="0" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">PO Document / Supplier File</label><input id="npoFile" type="file" accept=".pdf,image/*" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white text-xs"></div>
      </div>
      <div><label class="text-xs font-semibold">Notes</label><textarea id="npoNotes" class="mt-1 w-full border rounded-xl px-3 py-2.5" rows="2">For ${esc(x.sr)} · ${esc(x.customer)}</textarea></div>
      <div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">Saving here creates the Supplier PO, adds this item, and links the selected quantity back to ${esc(x.sr)} automatically.</div>
      <button id="npoSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Create PO & Allocate</button>
    </form>`);
    document.getElementById('needsNewPOForm').onsubmit=async e=>{
      e.preventDefault();const btn=document.getElementById('npoSave');btn.disabled=true;btn.textContent='Saving...';
      const alloc=n(document.getElementById('npoQty').value);if(alloc<=0||alloc>x.need+0.0001){btn.disabled=false;btn.textContent='Create PO & Allocate';return showToast(`Quantity must be between 0 and ${qfmt(x.need)}.`,'err')}
      const official=document.getElementById('npoNo').value.trim()||null,file=document.getElementById('npoFile').files?.[0]||null;if(!official&&!file){btn.disabled=false;btn.textContent='Create PO & Allocate';return showToast('Enter a PO number or upload the pending supplier/order document.','err')}
      let poId=null,poItemId=null;
      try{
        const row={po_number:official,vendor_name:document.getElementById('npoVendor').value.trim(),order_date:document.getElementById('npoDate').value,currency:document.getElementById('npoCurrency').value,status:'placed',shipping_agent:document.getElementById('npoAgent').value.trim()||null,estimated_arrival:document.getElementById('npoEta').value||null,notes:document.getElementById('npoNotes').value.trim()||null,created_by:state.user.id,po_pending_reference:official?null:`Pending ${new Date().toLocaleDateString()}`};
        if(!row.vendor_name)throw new Error('Vendor / Supplier is required.');
        const pr=await db.from('supplier_pos').insert(row).select('id').single();if(pr.error)throw pr.error;poId=pr.data.id;
        if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${poId}/${Date.now()}-${safe}`;const up=await db.storage.from('po-documents').upload(path,file,{upsert:false});if(up.error)throw up.error;const ur=await db.from('supplier_pos').update({po_document_path:path,po_document_name:file.name}).eq('id',poId);if(ur.error)throw ur.error}
        const ii=await db.from('supplier_po_items').insert({supplier_po_id:poId,product_id:x.product_id||null,product_code_snapshot:x.product_code_snapshot,item_name_snapshot:x.item_name_snapshot,image_url_snapshot:x.image||null,qty:alloc,unit_cost:n(document.getElementById('npoCost').value),shipping_cost:n(document.getElementById('npoShip').value)}).select('id').single();if(ii.error)throw ii.error;poItemId=ii.data.id;
        const fl=await db.from('fulfillment_links').insert({sales_order_item_id:x.id,supplier_po_item_id:poItemId,qty_allocated:alloc});if(fl.error)throw fl.error;
        closeModal();if(window.documentFlowState)window.documentFlowState.loaded=false;showToast('Supplier PO created and SR quantity allocated');await renderProcurementWorkspace();
      }catch(err){
        if(poItemId)await db.from('supplier_po_items').delete().eq('id',poItemId);
        if(poId)await db.from('supplier_pos').delete().eq('id',poId);
        showToast(err.message||'Could not create Supplier PO','err');btn.disabled=false;btn.textContent='Create PO & Allocate';
      }
    };
  };
})();
