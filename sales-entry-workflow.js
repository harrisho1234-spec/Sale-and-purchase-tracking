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
  function calcSalesEntry(){
    let subtotal=0;
    lineRows().forEach(r=>{
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

  window.addOrderItemRow=function(){
    const wrap=document.getElementById('orderItems');
    if(!wrap || !state.products.length) return;
    const flow=currentFlow();
    const d=document.createElement('div');
    d.className='grid md:grid-cols-12 gap-2 p-3 bg-gray-50 rounded-xl order-item-row';
    d.innerHTML=`
      <select class="product-select md:col-span-5 border rounded-lg px-2 py-2" onchange="syncItemPrice(this)">
        ${state.products.map(p=>`<option value="${p.id}" data-price="${Number(p.sales_price||0)}" data-code="${esc(p.code)}" data-name="${esc(p.item_name)}" data-image="${esc(p.image_url||'')}">${esc(p.code)} · ${esc(p.item_name)}</option>`).join('')}
      </select>
      <input class="qty md:col-span-2 border rounded-lg px-2 py-2" type="number" min="0.01" step="0.01" value="1" placeholder="Qty" oninput="salesEntryRecalc()">
      <input class="unit-price md:col-span-2 border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="${Number(state.products[0]?.sales_price||0)}" placeholder="Unit price" oninput="salesEntryRecalc()">
      <input class="line-discount md:col-span-2 border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="0" placeholder="Discount" oninput="salesEntryRecalc()">
      <button type="button" onclick="this.closest('.order-item-row').remove();salesEntryRecalc()" class="md:col-span-1 border rounded-lg text-red-500 font-bold">×</button>
      <select class="source-type hidden"><option value="stock" ${flow==='stock_sale'?'selected':''}>Stock</option><option value="pre_order" ${flow==='pre_order'?'selected':''}>Pre-order</option></select>`;
    wrap.appendChild(d);
    salesEntryRecalc();
  };

  window.syncItemPrice=function(sel){
    const row=sel.closest('.order-item-row');
    if(!row)return;
    row.querySelector('.unit-price').value=sel.selectedOptions[0]?.dataset.price||0;
    salesEntryRecalc();
  };

  window.openNewOrder=async function(){
    if(role()==='manager' && !managerContextActive()) return showToast('Choose a Sales Rep in Rep Workspace before creating a sale.','err');
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
          <div class="flex items-center justify-between mb-2"><div><h4 class="font-bold">Items</h4><div class="text-[10px] text-gray-400">Selling price and line discount can be adjusted by Sales.</div></div><button type="button" onclick="addOrderItemRow()" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Add Item</button></div>
          <div id="orderItems" class="space-y-3"></div>
        </div>

        <div class="grid md:grid-cols-2 gap-4 border-t pt-4">
          <div><label class="text-xs font-semibold">Order Discount Amount</label><input id="orderDiscount" type="number" min="0" step="0.01" value="0" oninput="salesEntryRecalc()" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
          <div><label class="text-xs font-semibold">Deposit Entry</label><select id="depositMode" onchange="salesEntryRecalc()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="amount">By Amount</option><option value="percent">By Percentage (%)</option></select></div>
          <div><label id="depositValueLabel" class="text-xs font-semibold">Deposit Amount</label><input id="depositValue" type="number" min="0" step="0.01" value="0" oninput="salesEntryRecalc()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 3000"></div>
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

    const flow=currentFlow();
    const invoiceType=document.getElementById('salesInvoiceType')?.value||'TK';
    const docNo=normalizeDoc(flow,invoiceType,document.getElementById('salesDocumentNo').value);
    if(!docNo) return showToast(flow==='pre_order'?'Enter the SR number.':'Enter the TK/RK invoice number.','err');
    if(flow==='pre_order' && !docNo.startsWith('SR')) return showToast('Pre-order document number must begin with SR.','err');
    if(flow==='stock_sale' && !docNo.startsWith(invoiceType)) return showToast(`Invoice number must begin with ${invoiceType}.`,'err');

    const calc=calcSalesEntry();
    if(calc.total<=0) return showToast('Order total must be greater than zero.','err');
    if(calc.depositMode==='percent' && calc.depositValue>100) return showToast('Deposit percentage cannot be more than 100%.','err');
    if(calc.depositAmount>calc.total+0.001) return showToast('Deposit amount cannot be greater than the order total.','err');

    const repId=effectiveSalesRepId();
    const repName=effectiveSalesRepName();
    const orderDate=document.getElementById('orderDate').value;
    const order={
      customer_id:document.getElementById('orderCustomer').value,
      sales_rep_id:repId,
      sales_rep_name_snapshot:repName||null,
      order_date:orderDate,
      order_type:flow==='pre_order'?'pre_order':'in_stock',
      sales_flow_type:flow,
      status:'confirmed',
      currency:'USD',
      order_discount:calc.orderDiscount,
      notes:document.getElementById('orderNotes').value.trim()||null,
      created_by:state.user.id,
      order_no:docNo,
      invoice_no:flow==='stock_sale'?docNo:null,
      sr_no:flow==='pre_order'?docNo:null,
      sales_invoice_no:flow==='stock_sale'?docNo:null,
      sales_invoice_type:flow==='stock_sale'?invoiceType:null,
      invoice_request_status:flow==='stock_sale'?'not_needed':'not_requested',
      deposit_input_type:calc.depositMode,
      deposit_input_value:calc.depositValue
    };

    const {data:so,error}=await db.from('sales_orders').insert(order).select().single();
    if(error){
      const msg=String(error.message||'');
      return showToast(msg.toLowerCase().includes('duplicate')?'That SR/TK/RK number already exists.':msg,'err');
    }

    const items=rows.map(r=>{
      const s=r.querySelector('.product-select'),opt=s.selectedOptions[0];
      return {
        sales_order_id:so.id,
        product_id:s.value,
        product_code_snapshot:opt.dataset.code,
        item_name_snapshot:opt.dataset.name,
        image_url_snapshot:opt.dataset.image||null,
        qty:Number(r.querySelector('.qty').value),
        unit_price:Number(r.querySelector('.unit-price').value),
        discount_amount:Number(r.querySelector('.line-discount').value||0),
        source_type:flow==='pre_order'?'pre_order':'stock',
        fulfillment_status:flow==='pre_order'?'pending':'ready'
      };
    });

    const invalid=items.some(i=>!i.product_id || i.qty<=0 || i.unit_price<0 || i.discount_amount<0);
    if(invalid){ await db.from('sales_orders').delete().eq('id',so.id); return showToast('Please check item quantity, price and discount.','err'); }

    const {error:itemErr}=await db.from('sales_order_items').insert(items);
    if(itemErr){ await db.from('sales_orders').delete().eq('id',so.id); return showToast(itemErr.message,'err'); }

    if(calc.depositAmount>0){
      const note=calc.depositMode==='percent' ? `Initial deposit ${calc.depositValue}%` : 'Initial deposit amount';
      const {error:payErr}=await db.from('sales_payments').insert({
        sales_order_id:so.id,
        amount:calc.depositAmount,
        payment_date:orderDate,
        method:document.getElementById('paymentMethod').value.trim()||'Deposit',
        notes:note,
        received_by:state.user.id
      });
      if(payErr){ await db.from('sales_orders').delete().eq('id',so.id); return showToast(payErr.message,'err'); }
    }

    if(managerContextActive() && typeof recordManagerRepAction==='function'){
      await recordManagerRepAction('create_sales_order','sales_order',so.id,{document_no:docNo,flow_type:flow,deposit_amount:calc.depositAmount});
    }

    if(window.documentFlowState) window.documentFlowState.loaded=false;
    closeModal();
    showToast(flow==='pre_order'?`Pre-order ${docNo} created`:`${invoiceType} invoice ${docNo} created`);
    await go('sales-orders');
  };
})();