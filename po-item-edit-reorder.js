// Edit and reorder existing Supplier PO items.
// Loaded after the existing PO edit/photo/typeahead enhancements.
(function(){
  const baseOpen=window.openEditSupplierPO;
  if(typeof baseOpen!=='function')return;

  function n(v){return Number(v||0)}
  function itemMoney(v,currency){return typeof money==='function'?money(v,currency||'USD'):(currency||'USD')+' '+n(v).toFixed(2)}

  async function getPOItems(poId){
    const r=await db.from('supplier_po_items')
      .select('id,supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,qty,unit_cost,shipping_cost,sort_order,procurement_status,created_at')
      .eq('supplier_po_id',poId)
      .order('sort_order',{ascending:true})
      .order('created_at',{ascending:true});
    if(r.error)throw r.error;
    return r.data||[];
  }

  async function linkedSet(items){
    const ids=items.map(x=>x.id).filter(Boolean);
    if(!ids.length)return new Set();
    const r=await db.from('fulfillment_links').select('supplier_po_item_id').in('supplier_po_item_id',ids);
    if(r.error){console.warn('PO link check:',r.error.message);return new Set()}
    return new Set((r.data||[]).map(x=>x.supplier_po_item_id));
  }

  function rowHtml(i,idx,total,currency,linked){
    const landed=n(i.unit_cost)+n(i.shipping_cost);
    return `<div class="p-3 po-editable-item" data-po-item-id="${esc(i.id)}">
      <div class="po-item-view grid md:grid-cols-[1fr_88px_115px_115px_170px] gap-2 items-center text-xs">
        <div class="min-w-0">
          <div class="flex items-center gap-2 flex-wrap">
            <b class="text-[#a77d1a]">${esc(i.product_code_snapshot||'No Code')}</b>
            ${linked?'<span class="px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 text-[9px] font-semibold">Linked to SR</span>':''}
          </div>
          <div class="text-gray-600 mt-0.5 truncate">${esc(i.item_name_snapshot||'')}</div>
          <div class="text-[9px] text-gray-400 mt-1">Shipping/unit ${itemMoney(i.shipping_cost||0,currency)} · Landed/unit ${itemMoney(landed,currency)}</div>
        </div>
        <div>Qty <b>${n(i.qty)}</b></div>
        <div>Cost <b>${itemMoney(i.unit_cost||0,currency)}</b></div>
        <div class="text-gray-500">#${idx+1}</div>
        <div class="flex justify-end gap-1.5 flex-wrap">
          <button type="button" onclick="movePOItem('${i.id}',-1)" ${idx===0?'disabled':''} class="px-2 py-1.5 border rounded-lg text-[10px] disabled:opacity-30" title="Move up">↑</button>
          <button type="button" onclick="movePOItem('${i.id}',1)" ${idx===total-1?'disabled':''} class="px-2 py-1.5 border rounded-lg text-[10px] disabled:opacity-30" title="Move down">↓</button>
          <button type="button" onclick="editPOItem('${i.id}')" class="px-3 py-1.5 border border-amber-200 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-semibold">Edit</button>
        </div>
      </div>

      <div class="po-item-edit hidden mt-3 rounded-xl border border-amber-100 bg-amber-50/40 p-3">
        <div class="grid md:grid-cols-12 gap-2">
          <div class="md:col-span-3">
            <label class="text-[9px] font-semibold text-gray-500">SKU / Code</label>
            <input class="pei-code mt-1 w-full border rounded-lg px-2 py-2 bg-white disabled:bg-gray-100" value="${esc(i.product_code_snapshot||'')}" ${linked?'disabled':''}>
          </div>
          <div class="md:col-span-4">
            <label class="text-[9px] font-semibold text-gray-500">Item Name</label>
            <input class="pei-name mt-1 w-full border rounded-lg px-2 py-2 bg-white disabled:bg-gray-100" value="${esc(i.item_name_snapshot||'')}" ${linked?'disabled':''}>
          </div>
          <div class="md:col-span-1">
            <label class="text-[9px] font-semibold text-gray-500">Qty</label>
            <input class="pei-qty mt-1 w-full border rounded-lg px-2 py-2 bg-white disabled:bg-gray-100" type="number" min="0.01" step="0.01" value="${n(i.qty)}" ${linked?'disabled':''}>
          </div>
          <div class="md:col-span-2">
            <label class="text-[9px] font-semibold text-gray-500">Unit Cost</label>
            <input class="pei-cost mt-1 w-full border rounded-lg px-2 py-2 bg-white" type="number" min="0" step="0.01" value="${n(i.unit_cost)}">
          </div>
          <div class="md:col-span-2">
            <label class="text-[9px] font-semibold text-gray-500">Shipping / Unit</label>
            <input class="pei-shipping mt-1 w-full border rounded-lg px-2 py-2 bg-white" type="number" min="0" step="0.01" value="${n(i.shipping_cost)}">
          </div>
        </div>
        ${linked?'<div class="mt-2 text-[9px] text-blue-700">This item is linked to an SR item. SKU, item name and quantity are locked; costing and position can still be changed.</div>':''}
        <div class="mt-3 flex justify-end gap-2">
          <button type="button" onclick="cancelPOItemEdit('${i.id}')" class="px-3 py-2 border rounded-lg text-xs">Cancel</button>
          <button type="button" onclick="savePOItemEdit('${i.id}')" class="px-4 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">Save Item</button>
        </div>
      </div>
    </div>`;
  }

  async function enhance(poId){
    const box=document.getElementById('poExistingItems');
    if(!box)return;
    let items=[];
    try{items=await getPOItems(poId)}catch(err){console.warn('PO item edit load:',err.message);return}
    const links=await linkedSet(items);
    const currency=document.getElementById('epoCurrency')?.value||'USD';
    box.dataset.poId=poId;
    box.innerHTML=items.length
      ? items.map((i,idx)=>rowHtml(i,idx,items.length,currency,links.has(i.id))).join('')
      : '<div class="p-4 text-xs text-gray-400">No PO items yet.</div>';
  }

  window.editPOItem=function(itemId){
    const row=document.querySelector(`[data-po-item-id="${CSS.escape(itemId)}"]`);
    if(!row)return;
    row.querySelector('.po-item-view')?.classList.add('hidden');
    row.querySelector('.po-item-edit')?.classList.remove('hidden');
  };

  window.cancelPOItemEdit=function(itemId){
    const row=document.querySelector(`[data-po-item-id="${CSS.escape(itemId)}"]`);
    if(!row)return;
    row.querySelector('.po-item-edit')?.classList.add('hidden');
    row.querySelector('.po-item-view')?.classList.remove('hidden');
  };

  window.savePOItemEdit=async function(itemId){
    const row=document.querySelector(`[data-po-item-id="${CSS.escape(itemId)}"]`);
    const box=document.getElementById('poExistingItems');
    if(!row||!box)return;
    const poId=box.dataset.poId;

    const cur=await db.from('supplier_po_items')
      .select('id,product_id,product_code_snapshot,item_name_snapshot,qty')
      .eq('id',itemId).single();
    if(cur.error)return showToast(cur.error.message,'err');

    const link=await db.from('fulfillment_links').select('id').eq('supplier_po_item_id',itemId).limit(1);
    const linked=!link.error&&(link.data||[]).length>0;

    let code=cur.data.product_code_snapshot;
    let name=cur.data.item_name_snapshot;
    let qty=n(cur.data.qty);
    let productId=cur.data.product_id||null;

    if(!linked){
      code=row.querySelector('.pei-code').value.trim();
      name=row.querySelector('.pei-name').value.trim();
      qty=n(row.querySelector('.pei-qty').value);
      if(!code||!name)return showToast('SKU / code and item name are required.','err');
      if(qty<=0)return showToast('Quantity must be greater than zero.','err');
      const p=await db.from('product_catalog').select('id').eq('code',code).maybeSingle();
      if(p.error)return showToast(p.error.message,'err');
      productId=p.data?.id||null;
    }

    const unitCost=n(row.querySelector('.pei-cost').value);
    const shipping=n(row.querySelector('.pei-shipping').value);
    if(unitCost<0||shipping<0)return showToast('Cost and shipping cannot be negative.','err');

    const patch={
      product_id:productId,
      product_code_snapshot:code,
      item_name_snapshot:name,
      qty,
      unit_cost:unitCost,
      shipping_cost:shipping,
      updated_at:new Date().toISOString()
    };
    const save=await db.from('supplier_po_items').update(patch).eq('id',itemId);
    if(save.error)return showToast(save.error.message,'err');

    showToast('PO item updated');
    await window.openEditSupplierPO(poId);
  };

  window.movePOItem=async function(itemId,direction){
    const box=document.getElementById('poExistingItems');
    if(!box)return;
    const poId=box.dataset.poId;
    const items=await getPOItems(poId);
    const idx=items.findIndex(x=>x.id===itemId);
    const nextIdx=idx+Number(direction||0);
    if(idx<0||nextIdx<0||nextIdx>=items.length)return;

    const a=items[idx],b=items[nextIdx];
    const aSort=n(a.sort_order)||idx+1;
    const bSort=n(b.sort_order)||nextIdx+1;

    const [r1,r2]=await Promise.all([
      db.from('supplier_po_items').update({sort_order:bSort,updated_at:new Date().toISOString()}).eq('id',a.id),
      db.from('supplier_po_items').update({sort_order:aSort,updated_at:new Date().toISOString()}).eq('id',b.id)
    ]);
    if(r1.error||r2.error)return showToast((r1.error||r2.error).message,'err');

    showToast(direction<0?'PO item moved up':'PO item moved down');
    await window.openEditSupplierPO(poId);
  };

  window.openEditSupplierPO=async function(){
    const poId=arguments[0];
    const out=await baseOpen.apply(this,arguments);
    await enhance(poId);
    return out;
  };
})();
