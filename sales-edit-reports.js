// Sales order editing + dedicated Reports page.
// Loaded last so it can safely extend the tracking redesign without changing the existing dashboard.
(function(){
  const editState={order:null,items:[],linked:new Set(),paid:0,deleted:[],discountBasis:'amount'};
  const reportState={orders:[],items:[]};

  function role(){return state.profile?.role||''}
  function mgrCtx(){return typeof managerRepActive==='function'&&managerRepActive()}
  function canEditOrdersUI(){return ['super_admin','admin','sales'].includes(role()) || (role()==='manager'&&mgrCtx())}
  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function docNo(o){return o?.sales_invoice_no||o?.sr_no||o?.invoice_no||o?.order_no||'Order'}
  function flow(o){return (o?.sales_flow_type||o?.order_type)==='pre_order'?'pre_order':'stock_sale'}

  function decorateEditButtons(){
    if(!canEditOrdersUI()||!window.trackingRedesign?.salesOrders)return;
    for(const o of window.trackingRedesign.salesOrders){
      const trigger=document.querySelector(`button[onclick="toggleSalesInvoice('${o.id}')"]`);
      const card=trigger?.closest('.lr-order-card');
      if(!card||card.querySelector(`.sales-edit-order-btn[data-order-id="${o.id}"]`))continue;
      let box=card.querySelector(`.sales-assign-box[data-order-id="${o.id}"]`);
      if(!box){
        const right=card.querySelector('.lr-order-main > div:last-child')||card.querySelector('.lr-order-main');
        if(!right)continue;
        box=document.createElement('div');
        box.className='sales-edit-box col-span-2 mt-2 pt-2 border-t flex items-center justify-end gap-2 flex-wrap';
        right.appendChild(box);
      }
      const b=document.createElement('button');
      b.className='sales-edit-order-btn px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-[10px] font-bold';
      b.dataset.orderId=o.id;
      b.textContent='Edit Order';
      b.onclick=()=>openEditSalesOrder(o.id);
      box.appendChild(b);
    }
  }

  const prevSalesBody=window.renderSalesTrackingBody;
  if(typeof prevSalesBody==='function'){
    window.renderSalesTrackingBody=function(){const x=prevSalesBody.apply(this,arguments);setTimeout(decorateEditButtons,0);return x};
  }
  const prevSalesOrders=window.renderSalesOrders;
  if(typeof prevSalesOrders==='function'){
    window.renderSalesOrders=async function(){const x=await prevSalesOrders.apply(this,arguments);setTimeout(decorateEditButtons,0);return x};
  }

  async function loadEditData(orderId){
    await ensureOrderFormData();
    const [or,ir,sr,rr]=await Promise.all([
      db.from('sales_orders').select('*').eq('id',orderId).single(),
      db.from('sales_order_items').select('*').eq('sales_order_id',orderId).order('created_at'),
      db.from('sales_order_summary').select('*').eq('id',orderId).single(),
      db.rpc('get_visible_sales_procurement_refs')
    ]);
    if(or.error)throw or.error;if(ir.error)throw ir.error;if(sr.error)throw sr.error;
    editState.order=or.data;editState.items=ir.data||[];editState.paid=Number(sr.data?.amount_paid||0);editState.deleted=[];editState.discountBasis='amount';
    editState.linked=new Set((rr.data||[]).filter(x=>x.sales_order_id===orderId).map(x=>x.sales_order_item_id));
  }

  function editProductTypeFromClass(value){
    const s=String(value||'').trim().toLowerCase();
    if(!s)return 'Unclassified';
    if(/chandelier|wall lamp|ceiling lamp|ceiling fixture|stand lamp|light bulb|lamp|lighting/.test(s))return 'Lighting';
    if(/carpet|rug/.test(s))return 'Carpet';
    if(/accessor|mirror|decor|vase|ornament/.test(s))return 'Accessories';
    return 'Furniture';
  }
  function editServiceCode(value){
    return ({'Service Fee':'SERVICE-FEE','Maintenance Fee':'MAINTENANCE-FEE','Cleaning Fee':'CLEANING-FEE','Delivery / Installation':'DELIVERY-INSTALLATION','Other Fee':'OTHER-FEE'})[value]||'SERVICE-FEE';
  }
  window.editServiceFeeChanged=function(sel){
    const r=sel.closest('.edit-order-item-row');if(!r)return;
    const kind=sel.value||'Service Fee';
    r.querySelector('.edit-product-code').value=editServiceCode(kind);
    r.querySelector('.edit-product-class').value=kind;
    r.querySelector('.edit-product-type').value='Service';
    const name=r.querySelector('.edit-service-name');
    if(name&&!name.value.trim())name.value=kind;
    if(name)r.querySelector('.edit-product-name').value=name.value.trim()||kind;
  };
  window.editServiceFeeNameChanged=function(input){
    const r=input.closest('.edit-order-item-row');if(!r)return;
    const sel=r.querySelector('.edit-service-fee-type');
    r.querySelector('.edit-product-name').value=input.value.trim()||(sel?.value||'Service Fee');
  };

  function editProductMatches(q){
    const s=String(q||'').trim().toLowerCase();
    return (state.products||[]).map(p=>{
      const code=String(p.code||'').toLowerCase(),name=String(p.item_name||'').toLowerCase(),brand=String(p.brand||'').toLowerCase();
      let score=99;if(code===s)score=0;else if(code.startsWith(s))score=1;else if(code.includes(s))score=2;else if(name.startsWith(s))score=3;else if(name.includes(s))score=4;else if(brand.includes(s))score=5;
      return {p,score};
    }).filter(x=>!s||x.score<99).sort((a,b)=>a.score-b.score||String(a.p.code||'').localeCompare(String(b.p.code||''))).slice(0,12).map(x=>x.p);
  }

  window.showEditProductSuggestions=function(input){
    const row=input.closest('.edit-order-item-row'),box=row?.querySelector('.edit-product-suggestions');if(!row||!box||input.disabled)return;
    const m=editProductMatches(input.value);
    box.innerHTML=m.length?m.map(p=>`<button type="button" class="w-full text-left px-3 py-2 hover:bg-amber-50 border-b last:border-b-0" data-id="${esc(p.id)}" data-code="${esc(p.code||'')}" data-name="${esc(p.item_name||'')}" data-image="${esc(p.image_url||'')}" data-price="${Number(p.sales_price||0)}" data-class="${esc(p.class||'')}" onclick="chooseEditProduct(this)"><div class="text-xs font-bold text-[#a77d1a]">${esc(p.code||'No code')}</div><div class="text-sm truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400">${esc(p.brand||'')} ${p.class?'· '+esc(p.class):''} · ${money(p.sales_price||0,p.currency||'USD')}</div></button>`).join(''):'<div class="px-3 py-3 text-xs text-gray-400">No matching product.</div>';
    box.classList.remove('hidden');
  };
  window.editProductInputChanged=function(input){const r=input.closest('.edit-order-item-row');if(!r)return;r.querySelector('.edit-product-id').value='';r.querySelector('.edit-product-code').value='';r.querySelector('.edit-product-name').value='';r.querySelector('.edit-product-image').value='';r.querySelector('.edit-product-class').value='';r.querySelector('.edit-product-type').value='';showEditProductSuggestions(input)};
  window.chooseEditProduct=function(btn){
    const r=btn.closest('.edit-order-item-row');if(!r)return;
    r.querySelector('.edit-product-id').value=btn.dataset.id||'';r.querySelector('.edit-product-code').value=btn.dataset.code||'';r.querySelector('.edit-product-name').value=btn.dataset.name||'';r.querySelector('.edit-product-image').value=btn.dataset.image||'';r.querySelector('.edit-product-class').value=btn.dataset.class||'';r.querySelector('.edit-product-type').value=editProductTypeFromClass(btn.dataset.class||'');r.querySelector('.edit-product-search').value=`${btn.dataset.code||''} · ${btn.dataset.name||''}`;r.querySelector('.edit-unit-price').value=Number(btn.dataset.price||0);r.querySelector('.edit-product-suggestions').classList.add('hidden');editOrderRecalc();
  };

  function itemRow(i=null){
    const linked=!!(i?.id&&editState.linked.has(i.id));
    const service=(i?.line_kind==='service')||(!i?.product_id&&i?.product_type_snapshot==='Service');
    if(service){
      const feeClass=i?.product_class_snapshot||'Service Fee';
      const feeName=i?.item_name_snapshot||feeClass;
      const options=['Service Fee','Maintenance Fee','Cleaning Fee','Delivery / Installation','Other Fee'];
      return `<div class="edit-order-item-row grid md:grid-cols-12 gap-2 p-3 bg-amber-50/50 border border-amber-100 rounded-xl" data-item-id="${esc(i?.id||'')}" data-linked="0">
        <div class="md:col-span-5">
          <label class="text-[10px] font-semibold text-gray-500">Service / Fee</label>
          <div class="grid sm:grid-cols-2 gap-2 mt-1">
            <select class="edit-service-fee-type w-full border rounded-lg px-3 py-2 bg-white" onchange="editServiceFeeChanged(this)">${options.map(x=>`<option ${x===feeClass?'selected':''}>${x}</option>`).join('')}</select>
            <input class="edit-service-name w-full border rounded-lg px-3 py-2 bg-white" value="${esc(feeName)}" placeholder="Description / custom fee name" oninput="editServiceFeeNameChanged(this)">
          </div>
          <input type="hidden" class="edit-line-kind" value="service">
          <input type="hidden" class="edit-product-id" value="">
          <input type="hidden" class="edit-product-code" value="${esc(i?.product_code_snapshot||editServiceCode(feeClass))}">
          <input type="hidden" class="edit-product-name" value="${esc(feeName)}">
          <input type="hidden" class="edit-product-image" value="">
          <input type="hidden" class="edit-product-class" value="${esc(feeClass)}">
          <input type="hidden" class="edit-product-type" value="Service">
          <div class="text-[9px] text-amber-700 mt-1">Non-physical charge · no stock or procurement item.</div>
        </div>
        <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Qty</label><input class="edit-qty mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0.01" step="0.01" value="${Number(i?.qty||1)}" oninput="editOrderRecalc()"></div>
        <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Unit Price</label><input class="edit-unit-price mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="${Number(i?.unit_price||0)}" oninput="editOrderRecalc()"></div>
        <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Line Discount</label><input class="edit-line-discount mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="${Number(i?.discount_amount||0)}" oninput="editOrderRecalc()"></div>
        <div class="md:col-span-1 flex items-end"><button type="button" onclick="removeEditOrderItem(this)" class="w-full h-[42px] border rounded-lg text-red-500 font-bold bg-white">×</button></div>
      </div>`;
    }
    const productText=i?`${i.product_code_snapshot||''} · ${i.item_name_snapshot||''}`:'';
    return `<div class="edit-order-item-row grid md:grid-cols-12 gap-2 p-3 bg-gray-50 rounded-xl" data-item-id="${esc(i?.id||'')}" data-linked="${linked?'1':'0'}">
      <div class="md:col-span-5 relative"><label class="text-[10px] font-semibold text-gray-500">Product Code / Item</label><input ${linked?'disabled':''} value="${esc(productText)}" class="edit-product-search mt-1 w-full border rounded-lg px-3 py-2 bg-white disabled:bg-gray-100" placeholder="Type product code or item name..." onfocus="showEditProductSuggestions(this)" oninput="editProductInputChanged(this)"><input type="hidden" class="edit-line-kind" value="product"><input type="hidden" class="edit-product-id" value="${esc(i?.product_id||'')}"><input type="hidden" class="edit-product-code" value="${esc(i?.product_code_snapshot||'')}"><input type="hidden" class="edit-product-name" value="${esc(i?.item_name_snapshot||'')}"><input type="hidden" class="edit-product-image" value="${esc(i?.image_url_snapshot||'')}"><input type="hidden" class="edit-product-class" value="${esc(i?.product_class_snapshot||'')}"><input type="hidden" class="edit-product-type" value="${esc(i?.product_type_snapshot||'')}"><div class="edit-product-suggestions hidden absolute z-[100] left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border rounded-xl shadow-xl"></div>${linked?'<div class="text-[9px] text-blue-600 mt-1">Linked to Procurement — product and qty are locked until unlinked.</div>':''}</div>
      <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Qty</label><input ${linked?'disabled':''} class="edit-qty mt-1 w-full border rounded-lg px-2 py-2 disabled:bg-gray-100" type="number" min="1" step="1" value="${Number(i?.qty||1)}" oninput="editOrderRecalc()"></div>
      <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Unit Price</label><input class="edit-unit-price mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="${Number(i?.unit_price||0)}" oninput="editOrderRecalc()"></div>
      <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Line Discount</label><input class="edit-line-discount mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="${Number(i?.discount_amount||0)}" oninput="editOrderRecalc()"></div>
      <div class="md:col-span-1 flex items-end"><button type="button" ${linked?'disabled':''} onclick="removeEditOrderItem(this)" class="w-full h-[42px] border rounded-lg text-red-500 font-bold disabled:opacity-30">×</button></div>
    </div>`;
  }

  window.addEditOrderItem=function(){document.getElementById('editOrderItems')?.insertAdjacentHTML('beforeend',itemRow());editOrderRecalc()};
  window.addEditServiceFee=function(){document.getElementById('editOrderItems')?.insertAdjacentHTML('beforeend',itemRow({line_kind:'service',product_code_snapshot:'SERVICE-FEE',item_name_snapshot:'Service Fee',product_class_snapshot:'Service Fee',product_type_snapshot:'Service',qty:1,unit_price:0,discount_amount:0}));editOrderRecalc()};
  window.removeEditOrderItem=function(btn){const r=btn.closest('.edit-order-item-row');if(!r)return;const id=r.dataset.itemId;if(id)editState.deleted.push(id);r.remove();editOrderRecalc()};
  function editSubtotal(){let s=0;document.querySelectorAll('#editOrderItems .edit-order-item-row').forEach(r=>{s+=Math.max(Number(r.querySelector('.edit-qty')?.value||0)*Number(r.querySelector('.edit-unit-price')?.value||0)-Number(r.querySelector('.edit-line-discount')?.value||0),0)});return round2(s)}
  window.editDiscountPercentChanged=function(){editState.discountBasis='percent';editOrderRecalc()};
  window.editDiscountAmountChanged=function(){editState.discountBasis='amount';editOrderRecalc()};
  window.editOrderRecalc=function(){
    const subtotal=editSubtotal(),p=document.getElementById('editDiscountPercent'),a=document.getElementById('editDiscountAmount');let amt=0;
    if(p&&a){if(editState.discountBasis==='percent'){const pct=Math.max(0,Math.min(100,Number(p.value||0)));amt=round2(subtotal*pct/100);a.value=String(amt)}else{amt=Math.max(0,Math.min(subtotal,Number(a.value||0)));a.value=String(amt);p.value=String(subtotal?round2(amt/subtotal*100):0)}}
    const total=Math.max(round2(subtotal-amt),0),bal=Math.max(round2(total-editState.paid),0);
    const vals={editSubtotal:subtotal,editDiscountPreview:amt,editTotal:total,editPaid:editState.paid,editBalance:bal};Object.entries(vals).forEach(([id,v])=>{const el=document.getElementById(id);if(el)el.textContent=money(v)});
  };

  window.openEditSalesOrder=async function(orderId){
    if(!canEditOrdersUI())return showToast('You do not have edit access here.','err');
    try{await loadEditData(orderId)}catch(e){return showToast(e.message||'Could not load order','err')}
    const o=editState.order,f=flow(o),linkedCount=editState.linked.size;
    const currentType=o.sales_invoice_type||String(o.sales_invoice_no||o.order_no||'').toUpperCase().startsWith('RK')?'RK':'TK';
    openModal(`Edit ${docNo(o)}`,`<form id="editSalesOrderForm" class="space-y-5">
      <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">Payments are kept separately. Editing the order changes the order total and AR automatically. ${linkedCount?`${linkedCount} item(s) linked to Procurement are protected from product/qty changes.`:''}</div>
      <div class="grid md:grid-cols-2 gap-3">
        <div><label class="text-xs font-semibold">Customer</label><select id="editOrderCustomer" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">${state.customers.map(c=>`<option value="${c.id}" ${c.id===o.customer_id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div><label class="text-xs font-semibold">Sale Type</label><input disabled value="${f==='pre_order'?'Pre-Order — SR':'Stock Sale — TK / RK'}" class="mt-1 w-full border rounded-xl px-3 py-2 bg-gray-50 text-gray-500"><div class="text-[9px] text-gray-400 mt-1">Sale type is locked after creation to protect the PO/SR workflow.</div></div>
        ${f==='stock_sale'?`<div><label class="text-xs font-semibold">Invoice Type</label><select id="editInvoiceType" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="TK" ${currentType==='TK'?'selected':''}>TK</option><option value="RK" ${currentType==='RK'?'selected':''}>RK</option></select></div>`:''}
        <div><label class="text-xs font-semibold">${f==='pre_order'?'SR Number':'TK / RK Invoice Number'}</label><input id="editDocumentNo" required value="${esc(f==='pre_order'?(o.sr_no||o.order_no||''):(o.sales_invoice_no||o.invoice_no||o.order_no||''))}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
        <div><label class="text-xs font-semibold">Order Date</label><input id="editOrderDate" type="date" value="${esc(o.order_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
        <div><label class="text-xs font-semibold">Assigned Sales</label><input disabled value="${esc(o.sales_rep_name_snapshot||'Unassigned')}" class="mt-1 w-full border rounded-xl px-3 py-2 bg-gray-50 text-gray-500"></div>
      </div>
      <div><div class="flex items-center justify-between gap-3 mb-2"><div><h4 class="font-bold">Items</h4><div class="text-[10px] text-gray-400">You can correct products, service fees, qty, price and discount.</div></div><div class="flex gap-2"><button type="button" onclick="addEditOrderItem()" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Product</button><button type="button" onclick="addEditServiceFee()" class="px-3 py-2 border border-amber-300 bg-amber-50 text-amber-800 rounded-lg text-xs font-semibold">+ Service / Fee</button></div></div><div id="editOrderItems" class="space-y-3">${editState.items.map(itemRow).join('')}</div></div>
      <div class="grid md:grid-cols-2 gap-4 border-t pt-4"><div><label class="text-xs font-semibold">Order Discount %</label><input id="editDiscountPercent" type="number" min="0" max="100" step="0.01" value="0" oninput="editDiscountPercentChanged()" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Order Discount Amount</label><input id="editDiscountAmount" type="number" min="0" step="0.01" value="${Number(o.order_discount||0)}" oninput="editDiscountAmountChanged()" class="mt-1 w-full border rounded-xl px-3 py-2"></div></div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-2 rounded-2xl bg-[#faf8f3] border border-[#eee8df] p-4"><div><div class="text-[9px] uppercase font-bold text-gray-400">Subtotal</div><div id="editSubtotal" class="font-bold mt-1"></div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Discount</div><div id="editDiscountPreview" class="font-bold mt-1"></div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Order Total</div><div id="editTotal" class="font-bold mt-1"></div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Paid</div><div id="editPaid" class="font-bold text-green-600 mt-1"></div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">AR / Balance</div><div id="editBalance" class="font-bold text-red-500 mt-1"></div></div></div>
      <div><label class="text-xs font-semibold">Notes</label><textarea id="editOrderNotes" class="mt-1 w-full border rounded-xl px-3 py-2" rows="3">${esc(o.notes||'')}</textarea></div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Order Changes</button>
    </form>`);
    editState.discountBasis='amount';editOrderRecalc();
    document.getElementById('editSalesOrderForm').onsubmit=saveEditSalesOrder;
  };

  async function saveEditSalesOrder(e){
    e.preventDefault();const o=editState.order,f=flow(o),rows=[...document.querySelectorAll('#editOrderItems .edit-order-item-row')];if(!rows.length)return showToast('Order must have at least one item.','err');
    const subtotal=editSubtotal(),discount=Math.max(0,Math.min(subtotal,Number(document.getElementById('editDiscountAmount').value||0))),total=Math.max(round2(subtotal-discount),0);if(total+0.001<editState.paid)return showToast(`Order total cannot be lower than payments already received (${money(editState.paid)}).`,'err');
    const raw=String(document.getElementById('editDocumentNo').value||'').trim().toUpperCase().replace(/\s+/g,'');if(!raw)return showToast('Enter the SR/TK/RK number.','err');
    let doc=raw,type=null;if(f==='pre_order'){if(!doc.startsWith('SR'))doc='SR-'+doc.replace(/^[-:]+/,'')}else{type=document.getElementById('editInvoiceType').value;if(!doc.startsWith(type))doc=type+doc.replace(/^[-:]+/,'')}
    const patch={customer_id:document.getElementById('editOrderCustomer').value,order_date:document.getElementById('editOrderDate').value,order_discount:discount,notes:document.getElementById('editOrderNotes').value.trim()||null,order_no:doc};
    if(f==='pre_order'){patch.sr_no=doc}else{patch.invoice_no=doc;patch.sales_invoice_no=doc;patch.sales_invoice_type=type}
    const up=await db.from('sales_orders').update(patch).eq('id',o.id);if(up.error)return showToast(up.error.message,'err');
    for(const r of rows){
      const id=r.dataset.itemId||null,linked=r.dataset.linked==='1',lineKind=r.querySelector('.edit-line-kind')?.value||'product';const row={line_kind:lineKind,product_id:lineKind==='service'?null:(r.querySelector('.edit-product-id').value||null),product_code_snapshot:r.querySelector('.edit-product-code').value||null,item_name_snapshot:r.querySelector('.edit-product-name').value||null,image_url_snapshot:lineKind==='service'?null:(r.querySelector('.edit-product-image').value||null),product_class_snapshot:r.querySelector('.edit-product-class')?.value||null,product_type_snapshot:r.querySelector('.edit-product-type')?.value||null,qty:Number(r.querySelector('.edit-qty')?.value||1),unit_price:Number(r.querySelector('.edit-unit-price').value||0),discount_amount:Number(r.querySelector('.edit-line-discount').value||0),source_type:f==='pre_order'?'pre_order':'stock'};
      if((lineKind!=='service'&&!row.product_id)||!row.product_code_snapshot||!row.item_name_snapshot||row.qty<=0||row.unit_price<0||row.discount_amount<0)return showToast('Check all item/service descriptions, qty, price and discount values.','err');
      if(id){const payload=linked?{unit_price:row.unit_price,discount_amount:row.discount_amount}:{...row};const x=await db.from('sales_order_items').update(payload).eq('id',id);if(x.error)return showToast(x.error.message,'err')}
      else{row.sales_order_id=o.id;row.fulfillment_status=lineKind==='service'?'ready':(f==='pre_order'?'pending':'ready');const x=await db.from('sales_order_items').insert(row);if(x.error)return showToast(x.error.message,'err')}
    }
    for(const id of editState.deleted){const x=await db.rpc('delete_sales_order_item_safe',{p_item_id:id});if(x.error)return showToast(x.error.message,'err')}
    if(role()==='manager'&&mgrCtx()&&typeof recordManagerRepAction==='function')await recordManagerRepAction('edit_sales_order','sales_order',o.id,{document_no:doc,total});
    closeModal();showToast('Order updated');await go('sales-orders');
  }

  // ----- Dedicated Reports page -----
  function reportDocType(o){if((o.sales_flow_type||o.order_type)==='pre_order'||String(o.sr_no||o.order_no||'').toUpperCase().startsWith('SR'))return 'SR';return o.sales_invoice_type||String(o.sales_invoice_no||o.invoice_no||o.order_no||'').slice(0,2).toUpperCase()||'Other'}
  function pct(a,b){return b>0?Math.round(a/b*1000)/10:0}
  async function loadReportData(){
    let oq=db.from('sales_order_summary').select('*').neq('status','cancelled').order('order_date',{ascending:false});
    let iq=db.from('sales_order_items').select('id,qty,fulfillment_status,sales_order_id,sales_orders!inner(sales_rep_id,order_date,status)').order('created_at',{ascending:false});
    if(mgrCtx()){oq=oq.eq('sales_rep_id',managerRepId());iq=iq.eq('sales_orders.sales_rep_id',managerRepId())}
    const [o,i]=await Promise.all([oq,iq]);if(o.error)throw o.error;if(i.error)throw i.error;reportState.orders=o.data||[];reportState.items=i.data||[];
  }
  function periodDates(mode){const now=new Date(),iso=d=>d.toISOString().slice(0,10);if(mode==='month')return [iso(new Date(now.getFullYear(),now.getMonth(),1)),iso(now)];if(mode==='year')return [`${now.getFullYear()}-01-01`,iso(now)];return ['','']}
  window.reportPeriodChanged=function(){const m=document.getElementById('reportPeriod').value,[f,t]=periodDates(m);if(m!=='custom'){document.getElementById('reportFrom').value=f;document.getElementById('reportTo').value=t}runSalesReport()};
  window.runSalesReport=function(){
    const from=document.getElementById('reportFrom')?.value||'',to=document.getElementById('reportTo')?.value||'',rep=document.getElementById('reportRep')?.value||'',doc=document.getElementById('reportDoc')?.value||'',pay=document.getElementById('reportPay')?.value||'';
    let list=reportState.orders.filter(o=>(!from||o.order_date>=from)&&(!to||o.order_date<=to)&&(!rep||o.sales_rep_id===rep)&&(!doc||reportDocType(o)===doc));
    if(pay==='outstanding')list=list.filter(o=>Number(o.balance_due||0)>.001);if(pay==='paid')list=list.filter(o=>Number(o.balance_due||0)<=.001);
    const ids=new Set(list.map(o=>o.id)),items=reportState.items.filter(i=>ids.has(i.sales_order_id));
    renderReportBody(list,items);
  };
  function renderReportBody(list,items){
    const sales=list.reduce((a,o)=>a+Number(o.order_total||0),0),received=list.reduce((a,o)=>a+Number(o.amount_paid||0),0),ar=list.reduce((a,o)=>a+Number(o.balance_due||0),0),avg=list.length?sales/list.length:0;
    const reps=new Map();for(const o of list){const k=o.sales_rep_id||'unassigned',r=reps.get(k)||{name:o.sales_rep_name_snapshot||'Unassigned',orders:0,sales:0,paid:0,ar:0};r.orders++;r.sales+=Number(o.order_total||0);r.paid+=Number(o.amount_paid||0);r.ar+=Number(o.balance_due||0);reps.set(k,r)}const repRows=[...reps.values()].sort((a,b)=>b.sales-a.sales),maxRep=Math.max(1,...repRows.map(r=>r.sales));
    const docs={SR:0,TK:0,RK:0,Other:0};list.forEach(o=>{const d=reportDocType(o);docs[d in docs?d:'Other']++});
    const st=new Map();items.forEach(i=>{const s=i.fulfillment_status||'pending';st.set(s,(st.get(s)||0)+Number(i.qty||0))});
    const outstanding=list.filter(o=>Number(o.balance_due||0)>.001).sort((a,b)=>Number(b.balance_due)-Number(a.balance_due)).slice(0,12);
    document.getElementById('reportBody').innerHTML=`
      <div class="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-5">${kpi('Sales',money(sales),`${list.length} orders`)}${kpi('Received',money(received),`${pct(received,sales)}% collection`,'text-green-600')}${kpi('AR / Balance',money(ar),'Outstanding receivables','text-red-600')}${kpi('Average Order',money(avg),'Average sales value')}${kpi('Orders',list.length,`${docs.SR} SR · ${docs.TK} TK · ${docs.RK} RK`)}</div>
      <div class="grid xl:grid-cols-2 gap-5 mb-5">
        <div class="card rounded-2xl overflow-hidden"><div class="p-5 border-b"><h3 class="font-bold">Sales by Rep</h3><p class="text-xs text-gray-400">Sales, collection and outstanding AR</p></div><div class="divide-y">${repRows.length?repRows.map(r=>`<div class="p-4"><div class="flex justify-between gap-3"><div><b>${esc(r.name)}</b><div class="text-[10px] text-gray-400">${r.orders} orders · ${pct(r.paid,r.sales)}% collected</div></div><div class="text-right"><b>${money(r.sales)}</b><div class="text-[10px] text-red-500">AR ${money(r.ar)}</div></div></div><div class="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden"><div class="h-full bg-[#b38b2e]" style="width:${Math.max(2,r.sales/maxRep*100)}%"></div></div></div>`).join(''):empty('No sales in this period.')}</div></div>
        <div class="card rounded-2xl p-5"><h3 class="font-bold">Order / Fulfillment Mix</h3><div class="grid grid-cols-4 gap-2 mt-4">${Object.entries(docs).map(([k,v])=>`<div class="rounded-xl border p-3 text-center"><div class="text-[10px] text-gray-400 font-bold">${k}</div><div class="text-xl font-extrabold mt-1">${v}</div></div>`).join('')}</div><div class="mt-5 space-y-2">${[...st.entries()].sort((a,b)=>b[1]-a[1]).map(([s,v])=>`<div class="flex justify-between text-sm border-b pb-2"><span>${esc(titleCase(s))}</span><b>${v}</b></div>`).join('')||'<div class="text-xs text-gray-400">No item activity.</div>'}</div></div>
      </div>
      <div class="card rounded-2xl overflow-hidden"><div class="p-5 border-b flex justify-between"><div><h3 class="font-bold">Outstanding AR</h3><p class="text-xs text-gray-400">Largest balances in the selected period</p></div><b class="text-red-500">${money(ar)}</b></div><div class="divide-y">${outstanding.length?outstanding.map(o=>`<div class="p-4 grid md:grid-cols-[150px_1fr_150px_150px] gap-2 items-center"><b>${esc(docNo(o))}</b><div>${esc(o.customer_name||'')}<div class="text-[10px] text-gray-400">${esc(o.sales_rep_name_snapshot||'Unassigned')} · ${esc(o.order_date||'')}</div></div><div class="text-sm">Total ${money(o.order_total,o.currency||'USD')}</div><div class="font-bold text-red-500">${money(o.balance_due,o.currency||'USD')}</div></div>`).join(''):empty('No outstanding AR in this selection.')}</div></div>`;
  }

  window.renderReports=async function(){
    if(!['super_admin','admin','manager'].includes(role()))throw new Error('Manager access required');
    await loadReportData();
    const reps=[...new Map(reportState.orders.filter(o=>o.sales_rep_id).map(o=>[o.sales_rep_id,o.sales_rep_name_snapshot||o.sales_rep_id])).entries()].sort((a,b)=>String(a[1]).localeCompare(String(b[1])));
    const [f,t]=periodDates('month');
    document.getElementById('content').innerHTML=`${mgrCtx()&&typeof managerRepBanner==='function'?managerRepBanner():''}<div class="card rounded-2xl p-4 mb-5"><div class="grid md:grid-cols-5 gap-3"><div><label class="text-[10px] font-bold text-gray-400">PERIOD</label><select id="reportPeriod" onchange="reportPeriodChanged()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="month">This Month</option><option value="year">This Year</option><option value="all">All Time</option><option value="custom">Custom</option></select></div><div><label class="text-[10px] font-bold text-gray-400">FROM</label><input id="reportFrom" type="date" value="${f}" onchange="runSalesReport()" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-[10px] font-bold text-gray-400">TO</label><input id="reportTo" type="date" value="${t}" onchange="runSalesReport()" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-[10px] font-bold text-gray-400">SALES REP</label><select id="reportRep" onchange="runSalesReport()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white" ${mgrCtx()?'disabled':''}><option value="">All Sales Reps</option>${reps.map(([id,n])=>`<option value="${id}" ${mgrCtx()&&id===managerRepId()?'selected':''}>${esc(n)}</option>`).join('')}</select></div><div class="grid grid-cols-2 gap-2"><div><label class="text-[10px] font-bold text-gray-400">DOCUMENT</label><select id="reportDoc" onchange="runSalesReport()" class="mt-1 w-full border rounded-xl px-2 py-2 bg-white"><option value="">All</option><option>SR</option><option>TK</option><option>RK</option></select></div><div><label class="text-[10px] font-bold text-gray-400">PAYMENT</label><select id="reportPay" onchange="runSalesReport()" class="mt-1 w-full border rounded-xl px-2 py-2 bg-white"><option value="">All</option><option value="outstanding">Outstanding</option><option value="paid">Paid</option></select></div></div></div></div><div id="reportBody"></div>`;
    runSalesReport();
  };

  setTimeout(decorateEditButtons,300);
})();