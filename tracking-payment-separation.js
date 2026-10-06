// Separate operational Order Tracking from Sales Tracking + quick additional deposit/payment entry.
// Loaded last so it can safely refine the existing tracking/payment workflows.
(function(){
  function norm(v){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function isPreOrder(o){
    const t=norm(o?.order_type);
    const no=String(o?.order_no||o?.sr_no||'').trim().toUpperCase();
    return t==='pre_order'||t==='mixed'||no.startsWith('SR');
  }
  function mgrCtx(){return typeof managerRepActive==='function'&&managerRepActive()}
  function canAddPayment(){
    const r=state.profile?.role||'';
    return ['sales','manager','admin','super_admin'].includes(r);
  }
  function docNo(o){return o?.sales_invoice_no||o?.sr_no||o?.invoice_no||o?.order_no||'Order'}

  // ---------------------------------------------------------
  // ORDER TRACKING = SR / PRE-ORDER FULFILLMENT ONLY.
  // Stock-sale TK/RK stays in Sales Tracking.
  // ---------------------------------------------------------
  const baseOrderTrackingBody=window.renderOrderTrackingBody;
  if(typeof baseOrderTrackingBody==='function'){
    window.renderOrderTrackingBody=function(){
      const ui=window.trackingRedesign;
      if(ui&&Array.isArray(ui.trackingOrders)){
        ui.trackingOrders=ui.trackingOrders.filter(isPreOrder);
      }
      const r=baseOrderTrackingBody.apply(this,arguments);
      const root=document.getElementById('orderTrackingRoot');
      if(root&&!document.getElementById('orderTrackingScopeNotice')){
        root.insertAdjacentHTML('afterbegin',`
          <div id="orderTrackingScopeNotice" class="mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800">
            <b>Order Tracking is for SR / Pre-Order fulfillment.</b> Production, shipping, ETA, arrival and delivery are tracked here. TK/RK stock sales remain in <b>Sales Tracking</b>.
          </div>`);
      }
      return r;
    };
  }

  // ---------------------------------------------------------
  // QUICK ADDITIONAL DEPOSIT / PAYMENT FROM SALES TRACKING.
  // ---------------------------------------------------------
  window.openSalesQuickPayment=async function(orderId){
    if(!canAddPayment())return showToast('You do not have permission to add a payment.','err');
    const {data:o,error}=await db.from('sales_order_summary').select('*').eq('id',orderId).single();
    if(error)return showToast(error.message,'err');
    const balance=Number(o.balance_due||0);
    if(balance<=0.001)return showToast('This order has no outstanding balance.','err');

    openModal(`Add Deposit / Payment — ${docNo(o)}`,`
      <form id="quickPaymentForm" class="grid md:grid-cols-2 gap-4">
        <div class="md:col-span-2 rounded-xl bg-[#faf9f6] border p-4 grid grid-cols-3 gap-3">
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Order Total</div><div class="font-bold mt-1">${money(o.order_total,o.currency||'USD')}</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Paid</div><div class="font-bold text-green-600 mt-1">${money(o.amount_paid,o.currency||'USD')}</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">AR / Balance</div><div class="font-bold text-red-500 mt-1">${money(balance,o.currency||'USD')}</div></div>
        </div>
        <div class="md:col-span-2 text-xs text-gray-500">${esc(o.customer_name||'Customer')} · ${esc(docNo(o))}</div>
        <div><label class="text-xs font-semibold">Additional Deposit / Payment</label><input id="quickPayAmount" type="number" min="0.01" max="${balance}" step="0.01" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Partial payment allowed"></div>
        <div><label class="text-xs font-semibold">Payment Date</label><input id="quickPayDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Method</label><input id="quickPayMethod" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Cash, ABA, Bank Transfer..."></div>
        <div><label class="text-xs font-semibold">Reference</label><input id="quickPayRef" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Note</label><textarea id="quickPayNote" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: Second deposit"></textarea></div>
        <div class="md:col-span-2 rounded-xl border border-amber-100 bg-amber-50 px-4 py-3 text-[11px] text-amber-800">This adds another payment to the existing order. It does not replace the original deposit. Paid and AR update automatically.</div>
        <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Deposit / Payment</button>
      </form>`);

    document.getElementById('quickPaymentForm').onsubmit=async e=>{
      e.preventDefault();
      const amt=Number(document.getElementById('quickPayAmount').value||0);
      if(amt<=0)return showToast('Enter a payment amount.','err');
      if(amt>balance+0.001)return showToast(`Payment cannot be more than the balance (${money(balance,o.currency||'USD')}).`,'err');
      const row={
        sales_order_id:o.id,
        payment_date:document.getElementById('quickPayDate').value,
        amount:amt,
        method:document.getElementById('quickPayMethod').value.trim()||null,
        reference_no:document.getElementById('quickPayRef').value.trim()||null,
        notes:document.getElementById('quickPayNote').value.trim()||'Additional deposit / payment',
        received_by:state.user.id
      };
      const {error:saveErr}=await db.from('sales_payments').insert(row);
      if(saveErr)return showToast(saveErr.message,'err');
      closeModal();
      showToast('Deposit / payment added');
      await go('sales-orders');
    };
  };

  function decorateQuickPaymentButtons(){
    if(!canAddPayment())return;
    const orders=window.trackingRedesign?.salesOrders||[];
    for(const o of orders){
      if(Number(o.balance_due||0)<=0.001)continue;
      const trigger=document.querySelector(`button[onclick="toggleSalesInvoice('${o.id}')"]`);
      const card=trigger?.closest('.lr-order-card');
      if(!card||card.querySelector(`.quick-payment-btn[data-order-id="${o.id}"]`))continue;
      let box=card.querySelector(`.sales-assign-box[data-order-id="${o.id}"]`)||card.querySelector('.sales-edit-box');
      if(!box){
        const right=card.querySelector('.lr-order-main > div:last-child')||card.querySelector('.lr-order-main');
        if(!right)continue;
        box=document.createElement('div');
        box.className='sales-payment-box col-span-2 mt-2 pt-2 border-t flex items-center justify-end gap-2 flex-wrap';
        right.appendChild(box);
      }
      const b=document.createElement('button');
      b.type='button';
      b.className='quick-payment-btn px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-green-700 text-[10px] font-bold';
      b.dataset.orderId=o.id;
      b.textContent='+ Deposit / Payment';
      b.onclick=()=>openSalesQuickPayment(o.id);
      box.appendChild(b);
    }
  }

  const baseSalesBody=window.renderSalesTrackingBody;
  if(typeof baseSalesBody==='function'){
    window.renderSalesTrackingBody=function(){
      const r=baseSalesBody.apply(this,arguments);
      setTimeout(decorateQuickPaymentButtons,100);
      return r;
    };
  }
  const baseSalesPage=window.renderSalesOrders;
  if(typeof baseSalesPage==='function'){
    window.renderSalesOrders=async function(){
      const r=await baseSalesPage.apply(this,arguments);
      setTimeout(decorateQuickPaymentButtons,120);
      return r;
    };
  }

  // Make the existing Payments page wording clearer too.
  const basePayments=window.renderPayments;
  if(typeof basePayments==='function'){
    window.renderPayments=async function(){
      const r=await basePayments.apply(this,arguments);
      const btn=[...document.querySelectorAll('#content button')].find(x=>x.getAttribute('onclick')==='openAddCustomerPayment()');
      if(btn)btn.textContent='+ Add Deposit / Payment';
      return r;
    };
  }
})();