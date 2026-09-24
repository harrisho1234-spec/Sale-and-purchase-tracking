// loaded after sales-entry-workflow.js
(function(){
  let depositBasis='amount';
  let discountBasis='amount';

  window.ensureOrderFormData=async function(){
    let cq=db.from('customers').select('*').eq('active',true).order('name');
    if(typeof managerRepActive==='function'&&managerRepActive()) cq=cq.eq('assigned_sales_id',managerRepId());
    const all=[];
    for(let from=0;;from+=1000){
      const r=await db.from('product_catalog').select('*').eq('active',true).order('item_name').range(from,from+999);
      if(r.error) throw r.error;
      all.push(...(r.data||[]));
      if(!r.data||r.data.length<1000) break;
    }
    const c=await cq;
    if(c.error) throw c.error;
    state.customers=c.data||[];
    state.products=all;
  };

  function rawSubtotal(){
    let s=0;
    document.querySelectorAll('#orderItems .order-item-row').forEach(r=>{
      s+=Math.max(
        Number(r.querySelector('.qty')?.value||0)*Number(r.querySelector('.unit-price')?.value||0)-Number(r.querySelector('.line-discount')?.value||0),
        0
      );
    });
    return Math.round((s+Number.EPSILON)*100)/100;
  }

  function syncDiscount(){
    const p=document.getElementById('orderDiscountPercent');
    const a=document.getElementById('orderDiscountAmount');
    const hidden=document.getElementById('orderDiscount');
    if(!p||!a||!hidden) return;
    const subtotal=rawSubtotal();
    if(discountBasis==='percent'){
      const pct=Math.max(0,Math.min(100,Number(p.value||0)));
      const amt=Math.round((subtotal*pct/100+Number.EPSILON)*100)/100;
      a.value=String(amt);
      hidden.value=String(amt);
    }else{
      const amt=Math.max(0,Math.min(subtotal,Number(a.value||0)));
      a.value=String(amt);
      p.value=String(subtotal>0?Math.round((amt/subtotal*100+Number.EPSILON)*100)/100:0);
      hidden.value=String(amt);
    }
  }

  function total(){
    return Math.max(rawSubtotal()-Number(document.getElementById('orderDiscount')?.value||0),0);
  }

  function syncDeposit(){
    const p=document.getElementById('depositPercent');
    const a=document.getElementById('depositAmount');
    const m=document.getElementById('depositMode');
    const v=document.getElementById('depositValue');
    if(!p||!a||!m||!v) return;
    const t=total();
    if(depositBasis==='percent'){
      const pct=Math.max(0,Math.min(100,Number(p.value||0)));
      const amt=Math.round((t*pct/100+Number.EPSILON)*100)/100;
      a.value=String(amt);
      m.value='percent';
      v.value=String(pct);
    }else{
      const amt=Math.max(0,Math.min(t,Number(a.value||0)));
      a.value=String(amt);
      p.value=String(t>0?Math.round((amt/t*100+Number.EPSILON)*100)/100:0);
      m.value='amount';
      v.value=String(amt);
    }
  }

  const rec=window.salesEntryRecalc;
  window.salesEntryRecalc=function(){
    syncDiscount();
    syncDeposit();
    return rec();
  };

  window.salesDiscountPercentChanged=function(){discountBasis='percent';salesEntryRecalc()};
  window.salesDiscountAmountChanged=function(){discountBasis='amount';salesEntryRecalc()};
  window.salesDepositPercentChanged=function(){depositBasis='percent';salesEntryRecalc()};
  window.salesDepositAmountChanged=function(){depositBasis='amount';salesEntryRecalc()};

  // Quantity is counted as pieces: browser arrows move 1 -> 2 -> 3, not 1.01.
  const baseAddItem=window.addOrderItemRow;
  window.addOrderItemRow=function(){
    baseAddItem();
    const rows=document.querySelectorAll('#orderItems .order-item-row');
    const row=rows[rows.length-1];
    const qty=row?.querySelector('.qty');
    if(qty){qty.step='1';qty.min='1';if(Number(qty.value||0)<1)qty.value='1'}
  };

  const open=window.openNewOrder;
  window.openNewOrder=async function(){
    await open();

    const oldDiscount=document.getElementById('orderDiscount');
    const oldDepositMode=document.getElementById('depositMode');
    if(!oldDiscount||!oldDepositMode) return;

    const grid=oldDiscount.closest('.grid');
    if(!grid) return;

    discountBasis='amount';
    depositBasis='amount';
    grid.innerHTML=`
      <div>
        <label class="text-xs font-semibold">Order Discount %</label>
        <input id="orderDiscountPercent" type="number" min="0" max="100" step="0.01" value="0" oninput="salesDiscountPercentChanged()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 10">
        <div class="text-[10px] text-gray-400 mt-1">Type % and amount calculates automatically.</div>
      </div>
      <div>
        <label class="text-xs font-semibold">Order Discount Amount</label>
        <input id="orderDiscountAmount" type="number" min="0" step="0.01" value="0" oninput="salesDiscountAmountChanged()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 40">
        <input id="orderDiscount" type="hidden" value="0">
        <div class="text-[10px] text-gray-400 mt-1">Or type amount and % calculates automatically.</div>
      </div>
      <div>
        <label class="text-xs font-semibold">Deposit %</label>
        <input id="depositPercent" type="number" min="0" max="100" step="0.01" value="0" oninput="salesDepositPercentChanged()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 30">
        <div class="text-[10px] text-gray-400 mt-1">Type % and amount calculates automatically.</div>
      </div>
      <div>
        <label class="text-xs font-semibold">Deposit Amount</label>
        <input id="depositAmount" type="number" min="0" step="0.01" value="0" oninput="salesDepositAmountChanged()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 3000">
        <input id="depositMode" type="hidden" value="amount">
        <input id="depositValue" type="hidden" value="0">
        <div class="text-[10px] text-gray-400 mt-1">Or type amount and % calculates automatically.</div>
      </div>
      <div class="md:col-span-2">
        <label class="text-xs font-semibold">Payment Method</label>
        <input id="paymentMethod" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Cash, ABA, Bank Transfer...">
      </div>`;

    // Ensure every already-created item row also uses whole-number quantity stepping.
    document.querySelectorAll('#orderItems .qty').forEach(q=>{q.step='1';q.min='1';if(Number(q.value||0)<1)q.value='1'});
    salesEntryRecalc();
  };

  function mgr(){return typeof managerRepActive==='function'&&managerRepActive()}
  function canAddPayment(){
    return ['sales','manager','admin','super_admin'].includes(state.profile?.role||'');
  }
  function canEditPayment(){
    const r=state.profile?.role||'';
    if(r==='sales')return false;
    return r!=='manager'||mgr();
  }
  async function sums(){
    let q=db.from('sales_order_summary').select('*').neq('status','cancelled').order('order_date',{ascending:false});
    if(mgr())q=q.eq('sales_rep_id',managerRepId());
    const r=await q;
    if(r.error)throw r.error;
    return r.data||[];
  }
  function d(o){return o.sales_invoice_no||o.sr_no||o.invoice_no||o.order_no||'Order'}

  window.openAddCustomerPayment=async function(){
    if(!canAddPayment())return showToast('You do not have permission to add a payment.','err');
    const list=(await sums()).filter(o=>Number(o.balance_due||0)>0.001);
    if(!list.length)return showToast('No outstanding customer balances.','err');
    window._cp=list;
    openModal('Add Customer Payment',`<form id="cpForm" class="grid md:grid-cols-2 gap-4">
      <div class="md:col-span-2"><label class="text-xs font-semibold">Order / Invoice</label><select id="cpOrder" onchange="cpRefresh()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">${list.map(o=>`<option value="${o.id}">${esc(d(o))} · ${esc(o.customer_name||'')} · Balance ${money(o.balance_due,o.currency||'USD')}</option>`).join('')}</select></div>
      <div class="md:col-span-2 rounded-xl bg-gray-50 border p-4 grid grid-cols-3 gap-3"><div><div class="text-[9px] text-gray-400 font-bold">TOTAL</div><div id="cpTotal" class="font-bold"></div></div><div><div class="text-[9px] text-gray-400 font-bold">PAID</div><div id="cpPaid" class="font-bold text-green-600"></div></div><div><div class="text-[9px] text-gray-400 font-bold">BALANCE</div><div id="cpBalance" class="font-bold text-red-500"></div></div></div>
      <div><label class="text-xs font-semibold">Payment Amount</label><input id="cpAmount" type="number" min="0.01" step="0.01" required class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Partial payment allowed"></div>
      <div><label class="text-xs font-semibold">Payment Date</label><input id="cpDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
      <div><label class="text-xs font-semibold">Method</label><input id="cpMethod" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Cash, ABA, Bank Transfer"></div>
      <div><label class="text-xs font-semibold">Reference</label><input id="cpRef" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Note</label><textarea id="cpNote" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Second deposit"></textarea></div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Add Payment</button>
    </form>`);
    cpRefresh();
    cpForm.onsubmit=saveCP;
  };

  window.cpRefresh=function(){
    const o=(window._cp||[]).find(x=>x.id===cpOrder.value);
    if(!o)return;
    cpTotal.textContent=money(o.order_total,o.currency);
    cpPaid.textContent=money(o.amount_paid,o.currency);
    cpBalance.textContent=money(o.balance_due,o.currency);
    cpAmount.max=String(Number(o.balance_due||0));
  };

  window.saveCP=async function(e){
    e.preventDefault();
    const o=(window._cp||[]).find(x=>x.id===cpOrder.value),amt=Number(cpAmount.value||0);
    if(!o||amt<=0)return showToast('Enter a payment amount.','err');
    if(amt>Number(o.balance_due||0)+.001)return showToast('Payment cannot be more than balance.','err');
    const r=await db.from('sales_payments').insert({sales_order_id:o.id,payment_date:cpDate.value,amount:amt,method:cpMethod.value.trim()||null,reference_no:cpRef.value.trim()||null,notes:cpNote.value.trim()||'Additional customer payment',received_by:state.user.id}).select('id').single();
    if(r.error)return showToast(r.error.message,'err');
    if(mgr()&&typeof recordManagerRepAction==='function'){
      await recordManagerRepAction('add_customer_payment','sales_payment',r.data.id,{sales_order_id:o.id,document_no:d(o),amount:amt});
    }
    closeModal();showToast('Customer payment added');go('payments');
  };

  window.openEditCustomerPayment=async function(id){
    if(!canEditPayment())return showToast('Open a Sales Rep in Rep Workspace to edit that rep\'s payment.','err');
    const r=await db.from('sales_payments').select('*').eq('id',id).single();
    if(r.error)return showToast(r.error.message,'err');
    const p=r.data;
    openModal('Edit Customer Payment',`<form id="epForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Amount</label><input id="epAmount" type="number" min="0.01" step="0.01" value="${Number(p.amount||0)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
      <div><label class="text-xs font-semibold">Date</label><input id="epDate" type="date" value="${esc(p.payment_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
      <div><label class="text-xs font-semibold">Method</label><input id="epMethod" value="${esc(p.method||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
      <div><label class="text-xs font-semibold">Reference</label><input id="epRef" value="${esc(p.reference_no||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Note</label><textarea id="epNote" class="mt-1 w-full border rounded-xl px-3 py-2">${esc(p.notes||'')}</textarea></div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3">Save Correction</button>
    </form>`);
    epForm.onsubmit=async e=>{
      e.preventDefault();
      const u=await db.from('sales_payments').update({amount:Number(epAmount.value||0),payment_date:epDate.value,method:epMethod.value.trim()||null,reference_no:epRef.value.trim()||null,notes:epNote.value.trim()||null}).eq('id',id);
      if(u.error)return showToast(u.error.message,'err');
      closeModal();showToast('Payment updated');go('payments');
    };
  };

  window.renderPayments=async function(){
    let q=db.from('sales_payments').select('id,payment_date,amount,method,reference_no,notes,sales_orders!inner(order_no,invoice_no,sr_no,sales_invoice_no,sales_rep_id,customers(name))').order('payment_date',{ascending:false});
    if(mgr())q=q.eq('sales_orders.sales_rep_id',managerRepId());
    const [p,s]=await Promise.all([q,sums()]);
    if(p.error)throw p.error;
    const ar=s.reduce((a,o)=>a+Number(o.balance_due||0),0);
    document.getElementById('content').innerHTML=`${mgr()&&typeof managerRepBanner==='function'?managerRepBanner():''}<div class="flex justify-between items-center mb-4"><div class="text-sm text-gray-500">Current AR: <b class="text-red-500">${money(ar)}</b></div>${canAddPayment()?'<button onclick="openAddCustomerPayment()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ Add Payment</button>':''}</div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${(p.data||[]).map(x=>`<div class="p-4 grid md:grid-cols-6 gap-2 items-center"><div><b>${esc(x.sales_orders?.sales_invoice_no||x.sales_orders?.sr_no||x.sales_orders?.invoice_no||x.sales_orders?.order_no||'')}</b><div class="text-[10px] text-gray-400">${esc(x.sales_orders?.customers?.name||'')}</div></div><div>${esc(x.payment_date||'')}</div><div class="text-green-600 font-bold">${money(x.amount)}</div><div>${esc(x.method||'-')}</div><div class="text-xs text-gray-400">${esc(x.reference_no||x.notes||'')}</div><div>${canEditPayment()?`<button onclick="openEditCustomerPayment('${x.id}')" class="px-3 py-2 border rounded-lg text-xs">Edit</button>`:''}</div></div>`).join('')||empty('No customer payments yet.')}</div></div>`;
  };
})();