// Supplier PO editing for the PO -> SR -> TK/RK workflow.
// Loaded after document-flow.js.

(function(){
  function nrm(v=''){return String(v||'').trim().toLowerCase()}
  function dformat(v){if(!v)return 'TBD';const d=new Date(String(v).length<=10?v+'T00:00:00':v);return Number.isNaN(d.getTime())?v:d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function badge(status){const s=nrm(status);return s==='arrived'?'lr-badge-green':s==='shipping'?'lr-badge-blue':s==='production'?'lr-badge-amber':'lr-badge-gray'}

  window.renderSupplierPOs=async function(){
    if(!isAdmin())throw new Error('Access denied');
    const [sr,pr]=await Promise.all([
      db.from('supplier_po_summary').select('*').order('created_at',{ascending:false}),
      db.from('supplier_pos').select('id,po_number,po_document_path,po_document_name,po_pending_reference,status,estimated_arrival,vendor_name,shipping_agent,order_date,currency,notes').order('created_at',{ascending:false})
    ]);
    if(sr.error)throw sr.error;if(pr.error)throw pr.error;
    const m=new Map((pr.data||[]).map(x=>[x.id,x]));
    document.getElementById('content').innerHTML=`
      <div class="flex justify-end mb-4"><button onclick="openNewSupplierPO()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ Supplier PO</button></div>
      <div class="card rounded-2xl overflow-hidden"><div class="divide-y">
        ${(sr.data||[]).map(p=>{const x=m.get(p.id)||{};return `<div class="p-4 grid md:grid-cols-[1fr_1.2fr_120px_130px_150px] gap-3 items-center">
          <div><b>${esc(x.po_number||'PO Pending')}</b><div class="text-[10px] text-gray-400">${esc(x.po_pending_reference||'')}</div></div>
          <div class="text-sm">${esc(p.vendor_name||x.vendor_name||'-')}<div class="text-[10px] text-gray-400">${esc(x.shipping_agent||'')}</div></div>
          <span class="lr-badge ${badge(p.status)}">${esc(titleCase(p.status||'placed'))}</span>
          <div class="text-xs">ETA: <b>${esc(dformat(p.estimated_arrival||x.estimated_arrival))}</b><div class="text-[10px] text-gray-400">Balance ${money(p.balance_due,p.currency)}</div></div>
          <div class="flex flex-wrap justify-end gap-2"><button onclick="openEditSupplierPO('${p.id}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold">Edit / Items</button>${x.po_document_path?`<button onclick="viewPODocument('${p.id}')" class="px-3 py-2 border border-blue-200 text-blue-600 rounded-lg text-[10px] font-semibold">Document</button>`:''}</div>
        </div>`}).join('')||empty('No supplier POs.')}
      </div></div>`;
  };

  async function loadPOEditData(poId){
    const [p,i]=await Promise.all([
      db.from('supplier_pos').select('*').eq('id',poId).single(),
      db.from('supplier_po_items').select('*').eq('supplier_po_id',poId).order('created_at')
    ]);
    if(p.error)throw p.error;if(i.error)throw i.error;return {po:p.data,items:i.data||[]};
  }

  window.openEditSupplierPO=async function(poId){
    try{
      const d=await loadPOEditData(poId),p=d.po;
      openModal('Edit Supplier PO',`<div class="space-y-6">
        <form id="editPOForm" class="grid md:grid-cols-2 gap-4">
          <div><label class="text-xs font-semibold">Official PO Number</label><input id="epoNo" value="${esc(p.po_number||'')}" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Leave blank while pending"></div>
          <div><label class="text-xs font-semibold">Vendor</label><input id="epoVendor" value="${esc(p.vendor_name||'')}" required class="mt-1 w-full border rounded-xl px-3 py-2"></div>
          <div><label class="text-xs font-semibold">Status</label><select id="epoStatus" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">${['placed','production','shipping','arrived'].map(s=>`<option value="${s}" ${p.status===s?'selected':''}>${titleCase(s)}</option>`).join('')}</select></div>
          <div><label class="text-xs font-semibold">ETA</label><input id="epoEta" type="date" value="${esc(p.estimated_arrival||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
          <div><label class="text-xs font-semibold">Shipping Agent</label><input id="epoAgent" value="${esc(p.shipping_agent||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
          <div><label class="text-xs font-semibold">Order Date</label><input id="epoDate" type="date" value="${esc(p.order_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
          <div class="md:col-span-2"><label class="text-xs font-semibold">Replace / Add PO Document</label><input id="epoFile" type="file" accept=".pdf,image/*" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">${p.po_document_name?`<div class="text-[10px] text-gray-400 mt-1">Current: ${esc(p.po_document_name)}</div>`:''}</div>
          <div class="md:col-span-2"><label class="text-xs font-semibold">Notes</label><textarea id="epoNotes" class="mt-1 w-full border rounded-xl px-3 py-2">${esc(p.notes||'')}</textarea></div>
          <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save PO Changes</button>
        </form>

        <div class="border-t pt-5">
          <div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">PO Items</h4><div class="text-xs text-gray-400">Items here can be linked to SR customer items.</div></div><span class="lr-badge lr-badge-gray">${d.items.length} items</span></div>
          <div class="divide-y border rounded-xl mb-4">${d.items.length?d.items.map(i=>`<div class="p-3 grid md:grid-cols-[1fr_90px_120px] gap-2 text-xs"><div><b>${esc(i.product_code_snapshot||'No Code')}</b><div class="text-gray-500 mt-0.5">${esc(i.item_name_snapshot||'')}</div></div><div>Qty <b>${Number(i.qty||0)}</b></div><div class="text-right">Cost <b>${money(i.unit_cost||0,p.currency||'USD')}</b></div></div>`).join(''):'<div class="p-4 text-xs text-gray-400">No PO items yet.</div>'}</div>
          <form id="addPOItemForm" class="grid md:grid-cols-12 gap-3 bg-gray-50 rounded-xl p-4">
            <div class="md:col-span-5 min-w-0">
              <label class="text-[10px] font-semibold text-gray-500">Product Code / Item</label>
              <input id="poiCode" required class="mt-1 w-full min-w-0 border rounded-lg px-3 py-2 bg-white" placeholder="Type SKU / code or item name...">
            </div>
            <div class="md:col-span-4 min-w-0">
              <label class="text-[10px] font-semibold text-gray-500">Item Name</label>
              <input id="poiName" required class="mt-1 w-full min-w-0 border rounded-lg px-3 py-2 bg-white" placeholder="Item name">
            </div>
            <div class="md:col-span-3">
              <label class="text-[10px] font-semibold text-gray-500">Qty</label>
              <input id="poiQty" type="number" min="0.01" step="0.01" value="1" required class="mt-1 w-full border rounded-lg px-3 py-2 bg-white" placeholder="Qty">
            </div>
            <div class="md:col-span-6">
              <label class="text-[10px] font-semibold text-gray-500">Unit Cost</label>
              <input id="poiCost" type="number" min="0" step="0.01" value="0" class="mt-1 w-full border rounded-lg px-3 py-2 bg-white" placeholder="Unit cost">
            </div>
            <div class="md:col-span-6">
              <label class="text-[10px] font-semibold text-gray-500">Shipping / Unit</label>
              <input id="poiShipping" type="number" min="0" step="0.01" value="0" class="mt-1 w-full border rounded-lg px-3 py-2 bg-white" placeholder="Shipping / unit">
            </div>
            <button class="md:col-span-12 w-full bg-[#b38b2e] text-white rounded-lg py-2.5 font-semibold">+ Add PO Item</button>
          </form>
        </div>
      </div>`);

      document.getElementById('editPOForm').onsubmit=async e=>{
        e.preventDefault();
        const file=document.getElementById('epoFile').files[0]||null;
        const patch={po_number:document.getElementById('epoNo').value.trim()||null,vendor_name:document.getElementById('epoVendor').value.trim(),status:document.getElementById('epoStatus').value,estimated_arrival:document.getElementById('epoEta').value||null,shipping_agent:document.getElementById('epoAgent').value.trim()||null,order_date:document.getElementById('epoDate').value||p.order_date,notes:document.getElementById('epoNotes').value.trim()||null};
        const r=await db.from('supplier_pos').update(patch).eq('id',poId);if(r.error)return showToast(r.error.message,'err');
        if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${poId}/${Date.now()}-${safe}`;const up=await db.storage.from('po-documents').upload(path,file,{upsert:false});if(up.error)return showToast(`PO updated but file upload failed: ${up.error.message}`,'err');const u=await db.from('supplier_pos').update({po_document_path:path,po_document_name:file.name}).eq('id',poId);if(u.error)return showToast(u.error.message,'err')}
        showToast('Supplier PO updated');closeModal();if(window.documentFlowState)window.documentFlowState.loaded=false;await go('supplier-pos');
      };

      document.getElementById('addPOItemForm').onsubmit=async e=>{
        e.preventDefault();const code=document.getElementById('poiCode').value.trim(),name=document.getElementById('poiName').value.trim();
        let productId=null;const q=await db.from('product_catalog').select('id').eq('code',code).maybeSingle();if(!q.error&&q.data)productId=q.data.id;
        const row={supplier_po_id:poId,product_id:productId,product_code_snapshot:code,item_name_snapshot:name,qty:Number(document.getElementById('poiQty').value||0),unit_cost:Number(document.getElementById('poiCost').value||0),shipping_cost:Number(document.getElementById('poiShipping').value||0)};
        const r=await db.from('supplier_po_items').insert(row);if(r.error)return showToast(r.error.message,'err');showToast('PO item added');await openEditSupplierPO(poId);
      };
    }catch(err){showToast(err.message,'err')}
  };
})();