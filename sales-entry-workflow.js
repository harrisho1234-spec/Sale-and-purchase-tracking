// Sales entry workflow: Stock Sale (TK/RK) or Pre-Order (SR), with deposit by % or amount.
// Loaded last so it safely overrides the older generic Sales Order form.

(function(){
  function role(){ return state.profile?.role || ''; }
  function managerContextActive(){ return typeof managerRepActive==='function' && managerRepActive(); }
  function effectiveSalesRepId(){ return managerContextActive() ? managerRepId() : state.user.id; }
  function effectiveSalesRepName(){
    if(managerContextActive()) return managerRepName();
    return state.profile?.display_name || state.user?.email || '';
  }
  function round2(v){ return Math.round((Number(v||0)+Number.EPSILON)*100)/100; }
  function cleanDoc(v){ return String(v||'').trim().toUpperCase().replace(/\s+/g,''); }
  function normalizeDoc(flow,invoiceType,raw){
    let v=cleanDoc(raw);
    if(flow==='pre_order'){
      if(!v.startsWith('SR')) v='SR-'+v.replace(/^[-:]+/,'');
      return v;
    }
    if(!v.startsWith(invoiceType)) v=invoiceType+v.replace(/^[-:]+/,'');
    return v;
  }
  function currentFlow(){ return document.getElementById('salesFlowType')?.value || 'stock_sale'; }
  function lineRows(){ return [...document.querySelectorAll('#orderItems .order-item-row')]; }
  function productTypeFromClass(value){
    const s=String(value||'').trim().toLowerCase();
    if(!s)return 'Unclassified';
    if(/chandelier|wall lamp|ceiling lamp|ceiling fixture|stand lamp|light bulb|lamp|lighting/.test(s))return 'Lighting';
    if(/carpet|rug/.test(s))return 'Carpet';
    if(/accessor|mirror|decor|vase|ornament/.test(s))return 'Accessories';
    return 'Furniture';
  }
  function updateProductMeta(row,productClass){
    if(!row)return;
    const cls=String(productClass||'').trim();
    const type=productTypeFromClass(cls);
    const classInput=row.querySelector('.product-class');
    const typeInput=row.querySelector('.product-type');
    const classLabel=row.querySelector('.product-class-label');
    const typeLabel=row.querySelector('.product-type-label');
    if(classInput)classInput.value=cls;
    if(typeInput)typeInput.value=type;
    if(classLabel)classLabel.textContent=cls||'Unclassified';
    if(typeLabel)typeLabel.textContent=type;
  }
  function salesImageUrl(raw){
    return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw||''):(raw||'');
  }
  function salesProductPhotoBox(url,size=64){
    const u=salesImageUrl(url);
    if(!u)return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 flex items-center justify-center text-[9px] text-gray-400 shrink-0">No Photo</div>`;
    return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 overflow-hidden shrink-0"><img src="${esc(u)}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full items-center justify-center text-[9px] text-gray-400">No Photo</div></div>`;
  }
  window.updateSalesProductPhotoPreview=function(row,url){
    const box=row?.querySelector('.sales-product-preview');
    if(box)box.innerHTML=salesProductPhotoBox(url||'',64);
  };

  function serviceCode(value){
    return ({
      'Service Fee':'SERVICE-FEE',
      'Maintenance Fee':'MAINTENANCE-FEE',
      'Cleaning Fee':'CLEANING-FEE',
      'Delivery / Installation':'DELIVERY-INSTALLATION',
      'Other Fee':'OTHER-FEE'
    })[value]||'SERVICE-FEE';
  }
  window.serviceFeeChanged=function(sel){
    const row=sel.closest('.order-item-row');if(!row)return;
    const kind=sel.value||'Service Fee';
    row.querySelector('.product-code').value=serviceCode(kind);
    row.querySelector('.product-class').value=kind;
    row.querySelector('.product-type').value='Service';
    row.querySelector('.product-type-label').textContent='Service';
    row.querySelector('.product-class-label').textContent=kind;
    const name=row.querySelector('.service-name');
    const defaults=['Service Fee','Maintenance Fee','Cleaning Fee','Delivery / Installation','Other Fee'];
    if(name&&(!name.value.trim()||defaults.includes(name.value.trim())))name.value=kind;
    if(name)row.querySelector('.product-name').value=name.value.trim()||kind;
  };
  window.serviceFeeNameChanged=function(input){
    const row=input.closest('.order-item-row');if(!row)return;
    const sel=row.querySelector('.service-fee-type');
    row.querySelector('.product-name').value=input.value.trim()||(sel?.value||'Service Fee');
  };

  function syncSalesLineDiscount(row,basis){
    if(!row)return;
    if(basis)row.dataset.discountBasis=basis;
    const qty=Math.max(Number(row.querySelector('.qty')?.value||0),0);
    const price=Math.max(Number(row.querySelector('.unit-price')?.value||0),0);
    const gross=round2(qty*price);
    const pctInput=row.querySelector('.line-discount-percent');
    const amtInput=row.querySelector('.line-discount');
    if(!pctInput||!amtInput)return;
    const mode=row.dataset.discountBasis||'amount';
    if(mode==='percent'){
      const pct=Math.max(0,Math.min(100,Number(pctInput.value||0)));
      pctInput.value=String(round2(pct));
      amtInput.value=String(round2(gross*pct/100));
    }else{
      const amt=Math.max(0,Math.min(gross,Number(amtInput.value||0)));
      amtInput.value=String(round2(amt));
      pctInput.value=String(gross?round2(amt/gross*100):0);
    }
  }
  window.salesLineDiscountPercentChanged=function(input){
    const row=input.closest('.order-item-row');syncSalesLineDiscount(row,'percent');salesEntryRecalc();
  };
  window.salesLineDiscountAmountChanged=function(input){
    const row=input.closest('.order-item-row');syncSalesLineDiscount(row,'amount');salesEntryRecalc();
  };
  window.salesLineValueChanged=function(input){
    const row=input.closest('.order-item-row');syncSalesLineDiscount(row);salesEntryRecalc();
  };

  function calcSalesEntry(){
    let subtotal=0;
    lineRows().forEach(r=>{
      syncSalesLineDiscount(r);
      const qty=Number(r.querySelector('.qty')?.value||0);
      const price=Number(r.querySelector('.unit-price')?.value||0);
      const discount=Number(r.querySelector('.line-discount')?.value||0);
      subtotal+=Math.max(qty*price-discount,0);
    });
    const orderDiscount=Math.max(Number(document.getElementById('orderDiscount')?.value||0),0);
    const total=Math.max(subtotal-orderDiscount,0);
    const depositMode=document.getElementById('depositMode')?.value||'amount';
    const depositValue=Math.max(Number(document.getElementById('depositValue')?.value||0),0);
    const depositAmount=depositMode==='percent' ? round2(total*depositValue/100) : round2(depositValue);
    const ar=round2(Math.max(total-depositAmount,0));
    return {subtotal:round2(subtotal),orderDiscount:round2(orderDiscount),total:round2(total),depositMode,depositValue:round2(depositValue),depositAmount,ar};
  }

  window.salesEntryRecalc=function(){
    const c=calcSalesEntry();
    const flow=currentFlow();
    const depositLabel=document.getElementById('depositValueLabel');
    const depositInput=document.getElementById('depositValue');
    if(depositLabel) depositLabel.textContent=c.depositMode==='percent'?'Deposit %':'Deposit Amount';
    if(depositInput){
      depositInput.max=c.depositMode==='percent'?'100':'';
      depositInput.placeholder=c.depositMode==='percent'?'Example: 30':'Example: 3000';
    }
    const ids={salesSubtotal:c.subtotal,salesOrderDiscountPreview:c.orderDiscount,salesOrderTotal:c.total,salesDepositPreview:c.depositAmount,salesARPreview:c.ar};
    Object.entries(ids).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.textContent=money(val,'USD')});
    const flowHint=document.getElementById('salesFlowHint');
    if(flowHint) flowHint.innerHTML=flow==='pre_order'
      ? '<b>Pre-Order:</b> enter the SR number. Procurement can later link supplier PO items to these SR items.'
      : '<b>Stock Sale:</b> enter the official TK or RK invoice number for the stock sale.';
  };

  window.updateSalesDocumentFields=function(){
    const flow=currentFlow();
    const typeWrap=document.getElementById('invoiceTypeWrap');
    const docLabel=document.getElementById('salesDocumentLabel');
    const doc=document.getElementById('salesDocumentNo');
    if(typeWrap) typeWrap.style.display=flow==='stock_sale'?'block':'none';
    if(docLabel) docLabel.textContent=flow==='pre_order'?'SR Number':'TK / RK Invoice Number';
    if(doc) doc.placeholder=flow==='pre_order'?'Example: SR-2026-001':'Example: TK2609-001 or RK2609-001';
    const type=flow==='pre_order'?'pre_order':'stock';
    lineRows().forEach(r=>{const s=r.querySelector('.source-type');if(s)s.value=type});
    salesEntryRecalc();
  };

  function productMatches(q){
    const s=String(q||'').trim().toLowerCase();
    const list=state.products||[];
    if(!s) return list.slice(0,10);
    return list
      .map(p=>{
        const code=String(p.code||'').toLowerCase();
        const name=String(p.item_name||'').toLowerCase();
        const brand=String(p.brand||'').toLowerCase();
        let score=99;
        if(code===s) score=0;
        else if(code.startsWith(s)) score=1;
        else if(code.includes(s)) score=2;
        else if(name.startsWith(s)) score=3;
        else if(name.includes(s)) score=4;
        else if(brand.includes(s)) score=5;
        return {p,score};
      })
      .filter(x=>x.score<99)
      .sort((a,b)=>a.score-b.score || String(a.p.code||'').localeCompare(String(b.p.code||'')))
      .slice(0,12)
      .map(x=>x.p);
  }

  window.showSalesProductSuggestions=function(input){
    const row=input.closest('.order-item-row');
    if(!row) return;
    const box=row.querySelector('.product-suggestions');
    const matches=productMatches(input.value);
    if(!matches.length){
      box.innerHTML='<div class="px-3 py-3 text-xs text-gray-400">No matching product code or item name.</div>';
    }else{
      box.innerHTML=matches.map(p=>`<button type="button" class="w-full text-left px-3 py-2 hover:bg-amber-50 border-b last:border-b-0 flex items-center gap-2" data-id="${esc(p.id)}" data-code="${esc(p.code||'')}" data-name="${esc(p.item_name||'')}" data-image="${esc(p.image_url||'')}" data-price="${Number(p.sales_price||0)}" data-class="${esc(p.class||'')}" onclick="chooseSalesProduct(this)">${salesProductPhotoBox(p.image_url||'',42)}<div class="min-w-0 flex-1"><div class="text-xs font-bold text-[#a77d1a]">${esc(p.code||'No code')}</div><div class="text-sm truncate">${esc(p.item_name||'')}</div><div class="text-[10px] text-gray-400 truncate">${esc(p.brand||'')} ${p.class?'· '+esc(p.class):''} · ${money(p.sales_price||0,p.currency||'USD')}</div></div></button>`).join('');
    }
    box.classList.remove('hidden');
  };

  window.chooseSalesProduct=function(btn){
    const row=btn.closest('.order-item-row');
    if(!row) return;
    row.querySelector('.product-id').value=btn.dataset.id||'';
    row.querySelector('.product-code').value=btn.dataset.code||'';
    row.querySelector('.product-name').value=btn.dataset.name||'';
    row.querySelector('.product-image').value=btn.dataset.image||'';
    updateSalesProductPhotoPreview(row,btn.dataset.image||'');
    row.querySelector('.product-search-input').value=`${btn.dataset.code||''} · ${btn.dataset.name||''}`;
    row.querySelector('.unit-price').value=Number(btn.dataset.price||0);
    updateProductMeta(row,btn.dataset.class||'');
    row.querySelector('.product-suggestions').classList.add('hidden');
    salesEntryRecalc();
  };

  window.salesProductInputChanged=function(input){
    const row=input.closest('.order-item-row');
    if(!row)return;
    row.querySelector('.product-id').value='';
    row.querySelector('.product-code').value='';
    row.querySelector('.product-name').value='';
    row.querySelector('.product-image').value='';
    const raw=String(input.value||'').trim().toLowerCase();
    const exact=(state.products||[]).find(p=>String(p.code||'').trim().toLowerCase()===raw);
    updateSalesProductPhotoPreview(row,exact?.image_url||'');
    updateProductMeta(row,'');
    showSalesProductSuggestions(input);
  };

  window.addOrderItemRow=function(){
    const wrap=document.getElementById('orderItems');
    if(!wrap || !state.products.length) return;
    const flow=currentFlow();
    const d=document.createElement('div');
    d.className='grid md:grid-cols-12 gap-2 p-3 bg-gray-50 rounded-xl order-item-row';
    d.dataset.discountBasis='amount';
    d.innerHTML=`
      <div class="md:col-span-5">
        <div class="flex items-start gap-3">
          <div class="sales-product-preview shrink-0">${salesProductPhotoBox('',64)}</div>
          <div class="relative min-w-0 flex-1">
            <label class="text-[10px] font-semibold text-gray-500">Product Code / Item</label>
            <input type="text" autocomplete="off" class="product-search-input mt-1 w-full border rounded-lg px-3 py-2 bg-white" placeholder="Type product code or item name..." onfocus="showSalesProductSuggestions(this)" oninput="salesProductInputChanged(this)">
            <input type="hidden" class="product-id"><input type="hidden" class="product-code"><input type="hidden" class="product-name"><input type="hidden" class="product-image"><input type="hidden" class="product-class"><input type="hidden" class="product-type">
            <div class="product-suggestions hidden absolute z-[100] left-0 right-0 top-full mt-1 max-h-64 overflow-y-auto bg-white border rounded-xl shadow-xl"></div>
            <div class="mt-1.5 flex flex-wrap gap-1.5 text-[9px]">
              <span class="px-2 py-1 rounded-full bg-white border text-gray-500">Type: <b class="product-type-label text-gray-700">Unclassified</b></span>
              <span class="px-2 py-1 rounded-full bg-white border text-gray-500">Class: <b class="product-class-label text-gray-700">Unclassified</b></span>
            </div>
          </div>
        </div>
      </div>
      <div class="md:col-span-1"><label class="text-[10px] font-semibold text-gray-500">Qty</label><input class="qty mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0.01" step="0.01" value="1" oninput="salesLineValueChanged(this)"></div>
      <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Unit Price</label><input class="unit-price mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="0" oninput="salesLineValueChanged(this)"></div>
      <div class="md:col-span-3"><label class="text-[10px] font-semibold text-gray-500">Line Discount</label><div class="grid grid-cols-2 gap-1 mt-1"><input aria-label="Line Discount Percent" title="Discount %" placeholder="%" class="line-discount-percent w-full border rounded-lg px-2 py-2" type="number" min="0" max="100" step="0.01" value="0" oninput="salesLineDiscountPercentChanged(this)"><input aria-label="Line Discount Amount" title="Discount Amount" placeholder="Amount" class="line-discount w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="0" oninput="salesLineDiscountAmountChanged(this)"></div></div>
      <div class="md:col-span-1 flex items-end"><button type="button" onclick="this.closest('.order-item-row').remove();salesEntryRecalc()" class="w-full h-[42px] border rounded-lg text-red-500 font-bold">×</button></div>
      <select class="source-type hidden"><option value="stock" ${flow==='stock_sale'?'selected':''}>Stock</option><option value="pre_order" ${flow==='pre_order'?'selected':''}>Pre-order</option></select>`;
    wrap.appendChild(d);
    salesEntryRecalc();
  };

  window.addServiceFeeRow=function(){
    const wrap=document.getElementById('orderItems');
    if(!wrap)return;
    const flow=currentFlow();
    const d=document.createElement('div');
    d.className='grid md:grid-cols-12 gap-2 p-3 bg-amber-50/50 border border-amber-100 rounded-xl order-item-row service-item-row';
    d.dataset.discountBasis='amount';
    d.innerHTML=`
      <div class="md:col-span-5">
        <label class="text-[10px] font-semibold text-gray-500">Service / Fee</label>
        <div class="grid sm:grid-cols-2 gap-2 mt-1">
          <select class="service-fee-type w-full border rounded-lg px-3 py-2 bg-white" onchange="serviceFeeChanged(this)">
            <option>Service Fee</option>
            <option>Maintenance Fee</option>
            <option>Cleaning Fee</option>
            <option>Delivery / Installation</option>
            <option>Other Fee</option>
          </select>
          <input type="text" class="service-name w-full border rounded-lg px-3 py-2 bg-white" value="Service Fee" placeholder="Description / custom fee name" oninput="serviceFeeNameChanged(this)">
        </div>
        <input type="hidden" class="line-kind" value="service">
        <input type="hidden" class="product-id">
        <input type="hidden" class="product-code" value="SERVICE-FEE">
        <input type="hidden" class="product-name" value="Service Fee">
        <input type="hidden" class="product-image">
        <input type="hidden" class="product-class" value="Service Fee">
        <input type="hidden" class="product-type" value="Service">
        <div class="mt-1.5 flex flex-wrap gap-1.5 text-[9px]">
          <span class="px-2 py-1 rounded-full bg-white border text-gray-500">Type: <b class="product-type-label text-gray-700">Service</b></span>
          <span class="px-2 py-1 rounded-full bg-white border text-gray-500">Class: <b class="product-class-label text-gray-700">Service Fee</b></span>
          <span class="px-2 py-1 rounded-full bg-white border text-amber-700">No physical stock item</span>
        </div>
      </div>
      <div class="md:col-span-1"><label class="text-[10px] font-semibold text-gray-500">Qty</label><input class="qty mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0.01" step="0.01" value="1" oninput="salesLineValueChanged(this)"></div>
      <div class="md:col-span-2"><label class="text-[10px] font-semibold text-gray-500">Unit Price</label><input class="unit-price mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="0" oninput="salesLineValueChanged(this)"></div>
      <div class="md:col-span-3"><label class="text-[10px] font-semibold text-gray-500">Line Discount</label><div class="grid grid-cols-2 gap-1 mt-1"><input aria-label="Line Discount Percent" title="Discount %" placeholder="%" class="line-discount-percent w-full border rounded-lg px-2 py-2" type="number" min="0" max="100" step="0.01" value="0" oninput="salesLineDiscountPercentChanged(this)"><input aria-label="Line Discount Amount" title="Discount Amount" placeholder="Amount" class="line-discount w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="0" oninput="salesLineDiscountAmountChanged(this)"></div></div>
      <div class="md:col-span-1 flex items-end"><button type="button" onclick="this.closest('.order-item-row').remove();salesEntryRecalc()" class="w-full h-[42px] border rounded-lg text-red-500 font-bold bg-white">×</button></div>
      <select class="source-type hidden"><option value="stock" ${flow==='stock_sale'?'selected':''}>Stock</option><option value="pre_order" ${flow==='pre_order'?'selected':''}>Pre-order</option></select>`;
    wrap.appendChild(d);
    salesEntryRecalc();
  };

  window.openNewOrder=async function(){
    await ensureOrderFormData();
    if(!state.customers.length) return showToast('Add a customer first','err');
    if(!state.products.length) return showToast('No products are available','err');

    openModal('Create Sale / Customer Order',`
      <form id="orderForm" class="space-y-5">
        <div class="rounded-xl border border-amber-100 bg-amber-50 p-3 text-xs text-amber-900" id="salesFlowHint"><b>Stock Sale:</b> enter the official TK or RK invoice number for the stock sale.</div>
        <div class="grid md:grid-cols-2 gap-3">
          <div><label class="text-xs font-semibold">Customer</label><select id="orderCustomer" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select></div>
          <div><label class="text-xs font-semibold">Sale Type</label><select id="salesFlowType" onchange="updateSalesDocumentFields()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="stock_sale">Stock Sale — TK / RK</option><option value="pre_order">Pre-Order — SR</option></select></div>
          <div id="invoiceTypeWrap"><label class="text-xs font-semibold">Invoice Type</label><select id="salesInvoiceType" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="TK">TK</option><option value="RK">RK</option></select></div>
          <div><label id="salesDocumentLabel" class="text-xs font-semibold">TK / RK Invoice Number</label><input id="salesDocumentNo" required class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: TK2609-001 or RK2609-001"></div>
          <div><label class="text-xs font-semibold">Order Date</label><input id="orderDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
          <div><label class="text-xs font-semibold">Sales Rep</label><input disabled value="${esc(effectiveSalesRepName())}" class="mt-1 w-full border rounded-xl px-3 py-2 bg-gray-50 text-gray-500"></div>
        </div>

        <div>
          <div class="flex items-center justify-between gap-3 mb-2"><div><h4 class="font-bold">Items</h4><div class="text-[10px] text-gray-400">Add a catalog product or a non-physical charge such as service, maintenance or cleaning.</div></div><div class="flex gap-2"><button type="button" onclick="addOrderItemRow()" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Product</button><button type="button" onclick="addServiceFeeRow()" class="px-3 py-2 border border-amber-300 bg-amber-50 text-amber-800 rounded-lg text-xs font-semibold">+ Service / Fee</button></div></div>
          <div id="orderItems" class="space-y-3"></div>
        </div>

        <div class="grid md:grid-cols-2 gap-4 border-t pt-4">
          <div><label class="text-xs font-semibold">Order Discount Amount</label><input id="orderDiscount" type="number" min="0" step="0.01" value="0" oninput="salesEntryRecalc()" class="mt-1 w-full border rounded-xl px-3 py-2"><div class="text-[10px] text-gray-400 mt-1">Optional discount applied to the whole order.</div></div>
          <div><label class="text-xs font-semibold">Deposit Entry</label><select id="depositMode" onchange="salesEntryRecalc()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="amount">By Amount</option><option value="percent">By Percentage (%)</option></select></div>
          <div><label id="depositValueLabel" class="text-xs font-semibold">Deposit Amount</label><input id="depositValue" type="number" min="0" step="0.01" value="0" oninput="salesEntryRecalc()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 3000"><div class="text-[10px] text-gray-400 mt-1">This becomes the first customer payment.</div></div>
          <div><label class="text-xs font-semibold">Payment Method</label><input id="paymentMethod" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Cash, ABA, Bank Transfer..."></div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-5 gap-2 rounded-2xl bg-[#faf8f3] border border-[#eee8df] p-4">
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Subtotal</div><div id="salesSubtotal" class="font-bold mt-1">$0.00</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Order Discount</div><div id="salesOrderDiscountPreview" class="font-bold mt-1">$0.00</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Order Total</div><div id="salesOrderTotal" class="font-bold mt-1">$0.00</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Deposit Paid</div><div id="salesDepositPreview" class="font-bold text-green-600 mt-1">$0.00</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">AR / Balance</div><div id="salesARPreview" class="font-bold text-red-500 mt-1">$0.00</div></div>
        </div>

        <textarea id="orderNotes" class="w-full border rounded-xl px-3 py-2" placeholder="Notes"></textarea>
        <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Sale / Order</button>
      </form>`);

    addOrderItemRow();
    updateSalesDocumentFields();
    document.getElementById('orderForm').onsubmit=saveOrder;
  };

  window.saveOrder=async function(e){
    e.preventDefault();
    const rows=lineRows();
    if(!rows.length) return showToast('Add at least one item.','err');
    const missingProduct=rows.find(r=>(r.querySelector('.line-kind')?.value||'product')!=='service'&&!r.querySelector('.product-id')?.value);
    if(missingProduct){ missingProduct.querySelector('.product-search-input')?.focus(); return showToast('Choose a matching product from the suggestion list.','err'); }
    const missingService=rows.find(r=>(r.querySelector('.line-kind')?.value||'product')==='service'&&!String(r.querySelector('.product-name')?.value||'').trim());
    if(missingService){ missingService.querySelector('.service-name')?.focus(); return showToast('Enter a service or fee description.','err'); }

    const flow=currentFlow();
    const invoiceType=document.getElementById('salesInvoiceType')?.value||'TK';
    const docNo=normalizeDoc(flow,invoiceType,document.getElementById('salesDocumentNo').value);
    if(!docNo) return showToast(flow==='pre_order'?'Enter the SR number.':'Enter the TK/RK invoice number.','err');
    if(flow==='pre_order' && !docNo.startsWith('SR')) return showToast('Pre-order document number must begin with SR.','err');
    if(flow==='stock_sale' && !docNo.startsWith(invoiceType)) return showToast(`Invoice number must begin with ${invoiceType}.`,'err');

    const calc=calcSalesEntry();
    // Zero-value orders are valid: complimentary items, warranty/service cases,
    // samples, or a 100% order discount can legitimately produce a $0 total.
    // Negative prices/discounts are still rejected by the item validation below.
    if(calc.depositMode==='percent' && calc.depositValue>100) return showToast('Deposit percentage cannot be more than 100%.','err');
    if(calc.depositAmount>calc.total+0.001) return showToast('Deposit amount cannot be greater than the order total.','err');

    const repId=effectiveSalesRepId();
    const repName=effectiveSalesRepName();
    const orderDate=document.getElementById('orderDate').value;
    const order={customer_id:document.getElementById('orderCustomer').value,sales_rep_id:repId,sales_rep_name_snapshot:repName||null,order_date:orderDate,order_type:flow==='pre_order'?'pre_order':'in_stock',sales_flow_type:flow,status:'confirmed',currency:'USD',order_discount:calc.orderDiscount,notes:document.getElementById('orderNotes').value.trim()||null,created_by:state.user.id,order_no:docNo,invoice_no:flow==='stock_sale'?docNo:null,sr_no:flow==='pre_order'?docNo:null,sales_invoice_no:flow==='stock_sale'?docNo:null,sales_invoice_type:flow==='stock_sale'?invoiceType:null,invoice_request_status:flow==='stock_sale'?'not_needed':'not_requested',deposit_input_type:calc.depositMode,deposit_input_value:calc.depositValue};

    const {data:so,error}=await db.from('sales_orders').insert(order).select().single();
    if(error){const msg=String(error.message||'');return showToast(msg.toLowerCase().includes('duplicate')?'That SR/TK/RK number already exists.':msg,'err');}

    const items=rows.map(r=>{const lineKind=r.querySelector('.line-kind')?.value||'product';return {sales_order_id:so.id,line_kind:lineKind,product_id:lineKind==='service'?null:(r.querySelector('.product-id').value||null),product_code_snapshot:r.querySelector('.product-code').value,item_name_snapshot:r.querySelector('.product-name').value,image_url_snapshot:lineKind==='service'?null:(r.querySelector('.product-image').value||null),product_class_snapshot:r.querySelector('.product-class')?.value||null,product_type_snapshot:r.querySelector('.product-type')?.value||null,qty:Number(r.querySelector('.qty').value),unit_price:Number(r.querySelector('.unit-price').value),discount_amount:Number(r.querySelector('.line-discount').value||0),source_type:flow==='pre_order'?'pre_order':'stock',fulfillment_status:lineKind==='service'?'arrived':(flow==='pre_order'?'ordered':'arrived')}});
    const invalid=items.some(i=>(i.line_kind!=='service'&&!i.product_id)||!i.product_code_snapshot||!i.item_name_snapshot||i.qty<=0||i.unit_price<0||i.discount_amount<0);
    if(invalid){await db.from('sales_orders').delete().eq('id',so.id);return showToast('Please check item quantity, price and discount.','err');}

    const {error:itemErr}=await db.from('sales_order_items').insert(items);
    if(itemErr){await db.from('sales_orders').delete().eq('id',so.id);return showToast(itemErr.message,'err');}

    if(calc.depositAmount>0){
      const note=calc.depositMode==='percent' ? `Initial deposit ${calc.depositValue}%` : 'Initial deposit amount';
      if(state.profile?.role==='sales'){
        const req=await db.rpc('submit_sales_payment_request',{
          p_order_id:so.id,
          p_amount:calc.depositAmount,
          p_payment_date:orderDate,
          p_method:document.getElementById('paymentMethod').value.trim()||'Deposit',
          p_reference_no:null,
          p_notes:note
        });
        if(req.error){await db.from('sales_orders').delete().eq('id',so.id);return showToast(req.error.message,'err');}
      }else{
        const {error:payErr}=await db.from('sales_payments').insert({sales_order_id:so.id,amount:calc.depositAmount,payment_date:orderDate,method:document.getElementById('paymentMethod').value.trim()||'Deposit',notes:note,received_by:state.user.id});
        if(payErr){await db.from('sales_orders').delete().eq('id',so.id);return showToast(payErr.message,'err');}
      }
    }

    if(managerContextActive() && typeof recordManagerRepAction==='function'){
      await recordManagerRepAction('create_sales_order','sales_order',so.id,{document_no:docNo,flow_type:flow,deposit_amount:calc.depositAmount});
    }
    if(window.documentFlowState) window.documentFlowState.loaded=false;
    closeModal();
    showToast((flow==='pre_order'?`Pre-order ${docNo} created`:`${invoiceType} invoice ${docNo} created`)+(state.profile?.role==='sales'&&calc.depositAmount>0?' · Deposit pending approval':''));
    await go('sales-orders');
  };

  document.addEventListener('click',e=>{
    if(!e.target.closest('.order-item-row')) document.querySelectorAll('.product-suggestions').forEach(x=>x.classList.add('hidden'));
  });
})();