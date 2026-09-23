// Procurement Needs Ordering: shows uncovered SR / pre-order quantities and lets Admin create or add them to supplier POs.
(function(){
  const baseRenderProcurementWorkspace=window.renderProcurementWorkspace;
  if(typeof baseRenderProcurementWorkspace!=='function'||!window.procurementWorkspace)return;
  const pw=window.procurementWorkspace;
  let needsView='detail';
  let needsCache=[];

  function norm(v=''){return String(v||'').trim().toLowerCase()}
  function isAdminRole(){return ['admin','super_admin'].includes(state.profile?.role||'')}
  function isPreOrder(o){
    return o?.sales_flow_type==='pre_order'||o?.order_type==='pre_order'||String(o?.sr_no||o?.order_no||'').toUpperCase().startsWith('SR');
  }
  function qty(v){return Number(v||0)}
  function fmtQty(v){const n=qty(v);return Number.isInteger(n)?String(n):n.toFixed(2).replace(/0+$/,'').replace(/\.$/,'')}
  function imageUrl(raw=''){return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw||''):(raw||'')}
  function imageHtml(raw,size=58){
    const u=imageUrl(raw);
    if(!u)return `<div style="width:${size}px;height:${size}px" class="rounded-xl bg-gray-100 border flex items-center justify-center text-[9px] text-gray-400 shrink-0">No Photo</div>`;
    return `<div style="width:${size}px;height:${size}px" class="rounded-xl bg-gray-100 border overflow-hidden shrink-0"><img src="${esc(u)}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full items-center justify-center text-[9px] text-gray-400">No Photo</div></div>`;
  }

  async function loadNeeds(){
    const ir=await db.from('sales_order_items').select('id,sales_order_id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,qty,line_position,created_at,sales_orders!inner(id,order_no,sr_no,order_date,order_type,sales_flow_type,status,customer_id,customers(name)),product_catalog(image_url)').eq('line_kind','product').not('product_id','is',null).order('created_at',{ascending:true});
    if(ir.error)throw ir.error;
    const items=(ir.data||[]).filter(i=>isPreOrder(i.sales_orders)&&!['cancelled'].includes(norm(i.sales_orders?.status)));
    const ids=items.map(i=>i.id);
    let links=[];
    if(ids.length){
      const lr=await db.from('fulfillment_links').select('sales_order_item_id,qty_allocated,supplier_po_items(supplier_pos(status))').in('sales_order_item_id',ids);
      if(lr.error)throw lr.error;
      links=lr.data||[];
    }
    const allocated=new Map();
    for(const l of links){
      const poStatus=norm(l.supplier_po_items?.supplier_pos?.status);
      if(poStatus==='cancelled')continue;
      allocated.set(l.sales_order_item_id,(allocated.get(l.sales_order_item_id)||0)+qty(l.qty_allocated));
    }
    const orderIds=[...new Set(items.map(i=>i.sales_order_id))];
    const payMap=new Map();
    if(orderIds.length){
      const sr=await db.from('sales_order_summary').select('id,amount_paid,balance_due,payment_status,sales_rep_name_snapshot').in('id',orderIds);
      if(!sr.error)(sr.data||[]).forEach(x=>payMap.set(x.id,x));
    }
    return items.map(i=>{
      const sold=qty(i.qty),poQty=allocated.get(i.id)||0,need=Math.max(0,Math.round((sold-poQty+Number.EPSILON)*100)/100);
      const summary=payMap.get(i.sales_order_id)||{};
      return {
        ...i,
        sold_qty:sold,
        allocated_qty:poQty,
        need_qty:need,
        customer_name:i.sales_orders?.customers?.name||'',
        sales_rep_name:summary.sales_rep_name_snapshot||'',
        sr_no:i.sales_orders?.sr_no||i.sales_orders?.order_no||'SR',
        order_date:i.sales_orders?.order_date||'',
        amount_paid:qty(summary.amount_paid),
        balance_due:qty(summary.balance_due),
        payment_status:summary.payment_status||'',
        image_url:i.image_url_snapshot||i.product_catalog?.image_url||''
      };
    }).filter(x=>x.need_qty>0.0001);
  }

  function filteredNeeds(){
    const q=norm(pw.search);
    if(!q)return needsCache;
    return needsCache.filter(x=>[x.sr_no,x.customer_name,x.product_code_snapshot,x.item_name_snapshot,x.sales_rep_name].some(v=>norm(v).includes(q)));
  }

  function paymentText(x){
    if(x.amount_paid>0)return `<span class="text-green-700 font-semibold">Paid ${money(x.amount_paid)}</span>${x.balance_due>0?`<span class="text-gray-400"> · Balance ${money(x.balance_due)}</span>`:''}`;
    return '<span class="text-amber-700 font-semibold">No payment recorded</span>';
  }

  function detailRows(rows){
    if(!rows.length)return empty('No items currently need ordering. All visible SR quantities are covered by supplier PO allocations.');
    return `<div class="card rounded-2xl overflow-hidden"><div class="divide-y">${rows.map(x=>`
      <div class="p-4 grid xl:grid-cols-[72px_1.35fr_1.1fr_240px_220px] gap-4 items-center">
        ${imageHtml(x.image_url,62)}
        <div class="min-w-0">
          <div class="text-xs font-extrabold text-[#a77d1a] truncate">${esc(x.product_code_snapshot||'No Code')}</div>
          <div class="font-semibold truncate">${esc(x.item_name_snapshot||'Item')}</div>
          <div class="text-[10px] text-gray-400 mt-1">Sales: ${esc(x.sales_rep_name||'-')}</div>
        </div>
        <div>
          <div class="font-bold">${esc(x.sr_no)}</div>
          <div class="text-xs text-gray-600">${esc(x.customer_name||'-')}</div>
          <div class="text-[10px] text-gray-400 mt-1">${esc(x.order_date||'')}</div>
          <div class="text-[10px] mt-1">${paymentText(x)}</div>
        </div>
        <div class="grid grid-cols-3 gap-2 text-center">
          <div class="rounded-xl bg-gray-50 border p-2"><div class="text-[9px] uppercase text-gray-400 font-bold">SR Qty</div><div class="font-bold">${fmtQty(x.sold_qty)}</div></div>
          <div class="rounded-xl bg-blue-50 border border-blue-100 p-2"><div class="text-[9px] uppercase text-blue-500 font-bold">PO Allocated</div><div class="font-bold text-blue-700">${fmtQty(x.allocated_qty)}</div></div>
          <div class="rounded-xl bg-amber-50 border border-amber-100 p-2"><div class="text-[9px] uppercase text-amber-600 font-bold">Need</div><div class="font-extrabold text-amber-700">${fmtQty(x.need_qty)}</div></div>
        </div>
        <div class="flex flex-col gap-2">
          <button onclick="needsCreateNewPO('${x.id}')" class="px-3 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Create New PO</button>
          <button onclick="needsAddExistingPO('${x.id}')" class="px-3 py-2.5 border rounded-xl text-xs font-semibold">Add to Existing PO</button>
        </div>
      </div>`).join('')}</div></div>`;
  }

  function groupedRows(rows){
    const map=new Map();
    for(const x of rows){
      const key=norm(x.product_code_snapshot)||x.product_id||x.id;
      if(!map.has(key))map.set(key,{code:x.product_code_snapshot,name:x.item_name_snapshot,image:x.image_url,total:0,rows:[]});
      const g=map.get(key);g.total+=x.need_qty;g.rows.push(x);if(!g.image&&x.image_url)g.image=x.image_url;
    }
    const groups=[...map.values()].sort((a,b)=>String(a.code||'').localeCompare(String(b.code||'')));
    if(!groups.length)return empty('No products currently need ordering.');
    return `<div class="grid gap-3">${groups.map(g=>`<div class="card rounded-2xl p-4">
      <div class="flex flex-col lg:flex-row lg:items-center gap-4">
        ${imageHtml(g.image,64)}
        <div class="min-w-0 flex-1"><div class="text-xs font-extrabold text-[#a77d1a]">${esc(g.code||'No Code')}</div><div class="font-bold">${esc(g.name||'Item')}</div><div class="text-xs text-gray-400 mt-1">Needed for ${g.rows.length} SR item${g.rows.length===1?'':'s'}</div></div>
        <div class="rounded-xl bg-amber-50 border border-amber-100 px-5 py-3 text-center"><div class="text-[9px] uppercase font-bold text-amber-600">Total Need to Order</div><div class="text-2xl font-extrabold text-amber-700">${fmtQty(g.total)}</div></div>
      </div>
      <div class="mt-4 border rounded-xl overflow-hidden divide-y">${g.rows.map(x=>`<div class="p-3 grid md:grid-cols-[1fr_1fr_80px_150px] gap-3 items-center text-xs"><div><b>${esc(x.sr_no)}</b><div class="text-gray-400">${esc(x.customer_name||'-')}</div></div><div>${paymentText(x)}</div><div>Need <b class="text-amber-700">${fmtQty(x.need_qty)}</b></div><button onclick="needsAddExistingPO('${x.id}')" class="px-3 py-2 border rounded-lg font-semibold">Add to PO</button></div>`).join('')}</div>
    </div>`).join('')}</div>`;
  }

  async function renderNeedsOrdering(){
    if(!isAdminRole())throw new Error('Admin access required.');
    needsCache=await loadNeeds();
    const rows=filteredNeeds();
    const totalQty=rows.reduce((a,x)=>a+x.need_qty,0);
    const productCount=new Set(rows.map(x=>norm(x.product_code_snapshot)||x.product_id||x.id)).size;
    const srCount=new Set(rows.map(x=>x.sales_order_id)).size;
    document.getElementById('content').innerHTML=`<div class="max-w-[1500px] mx-auto">
      <div class="pw-tabs">
        <button class="pw-tab" onclick="setProcurementTab('pos')">Supplier POs</button>
        <button class="pw-tab active" onclick="setProcurementTab('needs')">Needs Ordering <span class="ml-1 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700">${needsCache.length}</span></button>
        <button class="pw-tab" onclick="setProcurementTab('items')">PO Items</button>
        <button class="pw-tab" onclick="setProcurementTab('payments')">Supplier Payments</button>
        <button class="pw-tab" onclick="setProcurementTab('shipping')">Shipping / ETA</button>
        <button class="pw-tab" onclick="setProcurementTab('allocations')">SR Allocations</button>
      </div>
      <div class="rounded-xl bg-amber-50 border border-amber-100 p-3 text-xs text-amber-900 mb-4"><b>Needs Ordering</b> automatically shows SR / pre-order quantities that are not yet fully covered by supplier PO allocations. Once the full quantity is linked to a PO, it disappears from this list.</div>
      <div class="grid sm:grid-cols-3 gap-3 mb-4"><div class="pw-stat"><div class="pw-stat-label">SRs Waiting</div><div class="pw-stat-value">${srCount}</div></div><div class="pw-stat"><div class="pw-stat-label">Products</div><div class="pw-stat-value">${productCount}</div></div><div class="pw-stat"><div class="pw-stat-label">Total Qty to Order</div><div class="pw-stat-value text-amber-700">${fmtQty(totalQty)}</div></div></div>
      <div class="pw-toolbar"><input class="pw-search" value="${esc(pw.search)}" oninput="setProcurementSearch(this.value)" placeholder="Search SR, customer, product code, item name..."><div class="flex gap-2"><button onclick="needsSetView('detail')" class="px-3 py-2 rounded-xl text-xs font-semibold border ${needsView==='detail'?'bg-[#211d18] text-white border-[#211d18]':'bg-white'}">By Customer / SR</button><button onclick="needsSetView('group')" class="px-3 py-2 rounded-xl text-xs font-semibold border ${needsView==='group'?'bg-[#211d18] text-white border-[#211d18]':'bg-white'}">Grouped by Product</button></div></div>
      <div id="needsOrderingBody">${needsView==='group'?groupedRows(rows):detailRows(rows)}</div>
    </div>`;
  }

  window.needsSetView=function(v){needsView=v==='group'?'group':'detail';renderProcurementWorkspace()};

  function injectNeedsTab(){
    const tabs=document.querySelector('.pw-tabs');if(!tabs||tabs.querySelector('[data-needs-ordering-tab]'))return;
    const btn=document.createElement('button');btn.className='pw-tab';btn.dataset.needsOrderingTab='1';btn.onclick=()=>setProcurementTab('needs');btn.innerHTML='Needs Ordering';
    const first=tabs.children[0];if(first?.nextSibling)tabs.insertBefore(btn,first.nextSibling);else tabs.appendChild(btn);
  }

  window.renderProcurementWorkspace=async function(){
    if(pw.tab==='needs')return renderNeedsOrdering();
    const r=await baseRenderProcurementWorkspace.apply(this,arguments);
    injectNeedsTab();
    return r;
  };

  function needById(id){return needsCache.find(x=>x.id===id)}

  window.needsCreateNewPO=async function(itemId){
    const x=needById(itemId);if(!x)return showToast('This item is no longer in Needs Ordering. Refresh the page.','err');
    await openNewSupplierPO();
    setTimeout(()=>{
      const row=document.querySelector('#poCreateItems .po-create-item');if(!row)return;
      row.dataset.productId=x.product_id||'';
      const search=row.querySelector('.po-product-search');if(search)search.value=`${x.product_code_snapshot||''} · ${x.item_name_snapshot||''}`;
      const code=row.querySelector('.po-code');if(code)code.value=x.product_code_snapshot||'';
      const name=row.querySelector('.po-name');if(name)name.value=x.item_name_snapshot||'';
      const q=row.querySelector('.po-qty');if(q)q.value=fmtQty(x.need_qty);
      const box=row.querySelector('.po-create-preview');if(box)box.innerHTML=imageHtml(x.image_url,76);
      const note=document.getElementById('poNotes');if(note&&!note.value)note.value=`For ${x.sr_no} · ${x.customer_name}`;
      if(typeof poCreateRecalcRow==='function'&&q)poCreateRecalcRow(q);
    },0);
  };

  window.needsAddExistingPO=async function(itemId){
    const x=needById(itemId);if(!x)return showToast('This item is no longer in Needs Ordering. Refresh the page.','err');
    const pr=await db.from('supplier_pos').select('id,po_number,po_pending_reference,vendor_name,currency,status').order('created_at',{ascending:false});
    if(pr.error)return showToast(pr.error.message,'err');
    const pos=(pr.data||[]).filter(p=>norm(p.status)!=='cancelled');
    if(!pos.length)return showToast('Create a Supplier PO first.','err');
    openModal('Add Needed Item to Existing PO',`<form id="needsExistingPOForm" class="space-y-4">
      <div class="flex items-center gap-3 rounded-xl bg-amber-50 border border-amber-100 p-3">${imageHtml(x.image_url,58)}<div><div class="text-xs font-bold text-[#a77d1a]">${esc(x.product_code_snapshot||'')}</div><div class="font-semibold">${esc(x.item_name_snapshot||'')}</div><div class="text-xs text-gray-500">${esc(x.sr_no)} · ${esc(x.customer_name||'')} · Need ${fmtQty(x.need_qty)}</div></div></div>
      <div><label class="text-xs font-semibold">Supplier PO</label><select id="needsPOId" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${pos.map(p=>`<option value="${p.id}" data-currency="${esc(p.currency||'USD')}">${esc(p.po_number||p.po_pending_reference||'PO Pending')} · ${esc(p.vendor_name||'')}</option>`).join('')}</select></div>
      <div class="grid md:grid-cols-3 gap-3"><div><label class="text-xs font-semibold">Qty to Order / Allocate</label><input id="needsQty" type="number" min="0.01" max="${x.need_qty}" step="0.01" value="${fmtQty(x.need_qty)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div><div><label class="text-xs font-semibold">Unit Cost</label><input id="needsCost" type="number" min="0" step="0.01" value="0" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div><div><label class="text-xs font-semibold">Shipping / Unit</label><input id="needsShipping" type="number" min="0" step="0.01" value="0" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div></div>
      <div class="text-xs text-gray-500">This creates the PO item and immediately allocates that quantity to ${esc(x.sr_no)}, so the remaining quantity updates automatically.</div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Add Item & Allocate to SR</button>
    </form>`);
    document.getElementById('needsExistingPOForm').onsubmit=async e=>{
      e.preventDefault();
      const alloc=qty(document.getElementById('needsQty').value);
      if(alloc<=0||alloc>x.need_qty+0.0001)return showToast(`Quantity must be between 0 and ${fmtQty(x.need_qty)}.`,'err');
      const poId=document.getElementById('needsPOId').value;
      const item={supplier_po_id:poId,product_id:x.product_id||null,product_code_snapshot:x.product_code_snapshot,item_name_snapshot:x.item_name_snapshot,image_url_snapshot:x.image_url||null,qty:alloc,unit_cost:qty(document.getElementById('needsCost').value),shipping_cost:qty(document.getElementById('needsShipping').value)};
      const ir=await db.from('supplier_po_items').insert(item).select('id').single();
      if(ir.error)return showToast(ir.error.message,'err');
      const lr=await db.from('fulfillment_links').insert({sales_order_item_id:x.id,supplier_po_item_id:ir.data.id,qty_allocated:alloc});
      if(lr.error){await db.from('supplier_po_items').delete().eq('id',ir.data.id);return showToast(lr.error.message,'err')}
      closeModal();showToast('PO item added and allocated to SR');if(window.documentFlowState)window.documentFlowState.loaded=false;await renderProcurementWorkspace();
    };
  };
})();
