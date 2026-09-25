// Customer popup return/CN history + return-aware summary.
// Loaded after customer-order-history.js so it can extend the existing customer detail modal.
(function(){
  function norm(v=''){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
  function fmtDate(v){
    if(!v)return '-';
    const d=new Date(String(v).slice(0,10)+'T00:00:00');
    return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'});
  }
  function docNo(o){return o.sales_invoice_no||o.sr_no||o.invoice_no||o.order_no||'Order'}
  function isPre(o){return ['pre_order','mixed'].includes(norm(o.order_type))||norm(o.sales_flow_type)==='pre_order'||String(o.sr_no||'').toUpperCase().startsWith('SR')}
  function isPendingPre(o){return isPre(o)&&!o.sales_invoice_no&&!o.invoice_issued_at}
  function isSettled(o){return norm(o.payment_status)==='paid'||num(o.balance_due)<=0.001}
  function returnActionLabel(v){
    return ({
      return_only:'Return Only / No Refund',
      return_to_stock:'Return to Stock',
      exchange:'Exchange',
      damaged_return:'Damaged / Defective Return'
    })[v]||titleCase(v||'Return');
  }
  function orderStatusBadge(o){
    if(norm(o.status)==='cancelled')return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-500">Cancelled</span>';
    if(isSettled(o))return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-green-50 text-green-700 border border-green-100">Settled</span>';
    if(isPendingPre(o))return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">Pre-Order</span>';
    return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">Balance Due</span>';
  }
  function returnStatusBadge(v){
    const s=norm(v);
    const cls=s==='received'
      ?'bg-green-50 border-green-200 text-green-700'
      :s==='cancelled'
        ?'bg-gray-100 border-gray-200 text-gray-500'
        :'bg-amber-50 border-amber-200 text-amber-700';
    return `<span class="inline-flex px-2 py-1 rounded-lg border text-[9px] uppercase tracking-wide font-bold ${cls}">${esc(v||'-')}</span>`;
  }
  function itemSummary(order){
    const items=order.sales_order_items||[];
    if(!items.length)return '<span class="text-gray-400">No item detail</span>';
    const names=items.slice(0,4).map(i=>i.product_code_snapshot||i.item_name_snapshot||'Item');
    return `${items.length} item${items.length===1?'':'s'} · ${esc(names.join(', '))}${items.length>4?'…':''}`;
  }

  window.openCustomerOrders=async function(customerId){
    let customer=(state.customers||[]).find(c=>c.id===customerId);
    if(!customer){
      const cr=await db.from('customers').select('*').eq('id',customerId).single();
      if(cr.error)return showToast(cr.error.message,'err');
      customer=cr.data;
    }

    openModal(`Customer — ${customer.name||''}`,`<div class="py-12 text-center text-sm text-gray-400">Loading customer orders and returns...</div>`);

    const [sr,dr,rr,rf]=await Promise.all([
      db.from('sales_order_summary').select('*').eq('customer_id',customerId).order('order_date',{ascending:false}),
      db.from('sales_orders').select(`id,sales_invoice_no,sr_no,invoice_no,order_no,sales_flow_type,order_type,invoice_issued_at,sales_order_items(id,product_code_snapshot,item_name_snapshot,qty,fulfillment_status)`).eq('customer_id',customerId),
      db.rpc('get_visible_sales_returns'),
      db.from('sales_returns').select('id,sales_order_id,financial_effect,credit_amount').eq('customer_id',customerId)
    ]);

    if(sr.error)return showToast(sr.error.message,'err');
    if(dr.error)console.warn('Customer order item detail unavailable:',dr.error.message);
    if(rr.error)console.warn('Customer return history unavailable:',rr.error.message);
    if(rf.error)console.warn('Customer return financial detail unavailable:',rf.error.message);

    const detailMap=new Map((dr.data||[]).map(x=>[x.id,x]));
    const orders=(sr.data||[]).map(o=>({...o,...(detailMap.get(o.id)||{})}));
    const orderIds=new Set(orders.map(o=>o.id));

    const allVisibleReturns=rr.error?[]:(rr.data||[]);
    const returns=allVisibleReturns.filter(r=>orderIds.has(r.sales_order_id));
    window._visibleSalesReturns=allVisibleReturns;

    const financialMap=new Map((rf.data||[]).map(x=>[x.id,x]));
    const returnByOrder=new Map();
    for(const r of returns){
      const merged={...r,...(financialMap.get(r.return_id)||{})};
      if(!returnByOrder.has(r.sales_order_id))returnByOrder.set(r.sales_order_id,[]);
      returnByOrder.get(r.sales_order_id).push(merged);
    }

    const visible=orders.filter(o=>norm(o.status)!=='cancelled');
    const validReturns=returns
      .filter(r=>norm(r.status)!=='cancelled')
      .map(r=>({...r,...(financialMap.get(r.return_id)||{})}));

    const grossSales=visible.reduce((a,o)=>a+num(o.order_total),0);
    const returnValue=validReturns.reduce((a,r)=>a+num(r.return_value),0);
    const netSales=Math.max(grossSales-returnValue,0);
    const paid=visible.reduce((a,o)=>a+num(o.amount_paid),0);

    // Shared accounting rule:
    // Active AR = Invoice Total - Cash Received - Approved Customer Credit Applied.
    // sales_order_summary.balance_due already contains the approved customer-credit deduction.
    const adjustedBalance=o=>Math.max(num(o.balance_due),0);
    const balanceBeforeCredit=visible.reduce((a,o)=>a+(!isPendingPre(o)?num(o.gross_balance_due):0),0);
    const customerCreditApplied=visible.reduce((a,o)=>a+(!isPendingPre(o)?num(o.credit_applied):0),0);
    const activeAR=visible.reduce((a,o)=>a+(!isPendingPre(o)?num(o.balance_due):0),0);
    const pending=visible.reduce((a,o)=>a+(isPendingPre(o)?num(o.balance_due):0),0);

    const body=document.getElementById('modalBody');
    if(!body)return;

    body.innerHTML=`
      <div class="space-y-5">
        <div class="rounded-2xl border bg-[#faf9f6] p-4">
          <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div>
              <div class="font-serif text-xl font-bold">${esc(customer.name||'')}</div>
              <div class="text-xs text-gray-500 mt-1">${esc(customer.phone||'No phone')}${customer.address?' · '+esc(customer.address):''}</div>
            </div>
            <div class="flex gap-2 flex-wrap">
              <button onclick="closeModal();openEditCustomer('${customerId}')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">Edit Customer</button>
              <button onclick="customerToSalesTracking('${customerId}')" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Open in Sales Tracking</button>
            </div>
          </div>

          <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3 mt-4">
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Orders</div><div class="text-lg font-bold mt-1">${orders.length}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Gross Sales</div><div class="text-lg font-bold mt-1">${money(grossSales)}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Returns</div><div class="text-lg font-bold text-amber-600 mt-1">−${money(returnValue)}</div><div class="text-[9px] text-gray-400 mt-0.5">${validReturns.length} active CN${validReturns.length===1?'':'s'}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Net Sales</div><div class="text-lg font-bold mt-1">${money(netSales)}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Received</div><div class="text-lg font-bold text-green-600 mt-1">${money(paid)}</div></div>
            <div>
              <div class="text-[9px] uppercase font-bold text-gray-400">Active AR / Net Amount Due</div>
              <div class="text-lg font-bold ${activeAR>0?'text-red-500':'text-green-600'} mt-1">${money(activeAR)}</div>
              ${customerCreditApplied>0?`<div class="text-[9px] text-blue-600 mt-0.5">${money(balanceBeforeCredit)} − ${money(customerCreditApplied)} customer credit</div>`:'' }
            </div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Pending Pre-Order</div><div class="text-lg font-bold text-blue-600 mt-1">${money(pending)}</div></div>
          </div>

          ${returnValue>0?`
            <div class="mt-3 pt-3 border-t text-[10px] text-gray-500">
              <b>Active AR = Invoice Total − Cash Received − Approved Customer Credit Applied.</b> Received remains actual cash collected only; customer credit reduces what is owed but is not counted as cash received.
            </div>`:''}
        </div>

        <div>
          <div class="flex items-center justify-between mb-2"><h4 class="font-bold">Order History</h4><div class="text-[10px] text-gray-400">Newest first</div></div>
          <div class="grid gap-2 max-h-[42vh] overflow-y-auto pr-1">
            ${orders.length?orders.map(o=>{
              const pendingPre=isPendingPre(o)&&!isSettled(o);
              const balLabel=pendingPre?'Est. Balance':(isSettled(o)?'Balance':'Active Balance');
              const paidLabel=pendingPre?'Pre-Order Deposit':'Paid';
              const orderReturns=(returnByOrder.get(o.id)||[]).filter(r=>norm(r.status)!=='cancelled');
              const orderReturnValue=orderReturns.reduce((a,r)=>a+num(r.return_value),0);
              const orderNet=Math.max(num(o.order_total)-orderReturnValue,0);
              const shownBalance=adjustedBalance(o);
              return `<div class="rounded-xl border border-[#ece8e0] bg-white p-4">
                <div class="grid md:grid-cols-[1fr_auto] gap-3 items-start">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <b>${esc(docNo(o))}</b>
                      ${orderStatusBadge(o)}
                      ${o.sales_rep_name_snapshot?`<span class="px-2 py-1 rounded-lg text-[9px] font-semibold bg-[#fff9e8] text-[#8a650e] border border-[#f1d891]">Sold by: ${esc(o.sales_rep_name_snapshot)}</span>`:''}
                      ${orderReturns.length?`<span class="px-2 py-1 rounded-lg text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200">↩ ${orderReturns.length} Return/CN</span>`:''}
                    </div>
                    <div class="text-[11px] text-gray-400 mt-1">${esc(fmtDate(o.order_date))} · ${isPre(o)?'Pre-Order / SR':'Stock Sale / TK-RK'}</div>
                    <div class="text-[11px] text-gray-500 mt-2 truncate">${itemSummary(o)}</div>
                    ${orderReturns.length?`<div class="text-[10px] text-amber-700 mt-2">Returned value: <b>${money(orderReturnValue,o.currency)}</b> · Net after returns: <b>${money(orderNet,o.currency)}</b></div>`:''}
                  </div>
                  <div class="grid grid-cols-3 gap-4 text-right text-xs min-w-[270px]">
                    <div>
                      <div class="text-[9px] uppercase text-gray-400 font-bold">Total</div>
                      <div class="font-bold mt-1">${money(o.order_total,o.currency)}</div>
                      ${orderReturns.length?`<div class="text-[9px] text-amber-600 mt-0.5">Net ${money(orderNet,o.currency)}</div>`:''}
                    </div>
                    <div><div class="text-[9px] uppercase text-gray-400 font-bold">${paidLabel}</div><div class="font-bold text-green-600 mt-1">${money(o.amount_paid,o.currency)}</div></div>
                    <div><div class="text-[9px] uppercase text-gray-400 font-bold">${balLabel}</div><div class="font-bold mt-1 ${pendingPre?'text-gray-400':shownBalance>0?'text-red-500':'text-green-600'}">${money(shownBalance,o.currency)}</div></div>
                  </div>
                </div>
              </div>`;
            }).join(''):'<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No visible orders for this customer.</div>'}
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between gap-3 mb-2">
            <div>
              <h4 class="font-bold">Return / Credit Note History</h4>
              <div class="text-[10px] text-gray-400 mt-0.5">All Return/CN cases connected to this customer.</div>
            </div>
            <div class="text-[10px] text-amber-700 font-semibold">${validReturns.length} active · ${returns.length} total</div>
          </div>

          <div class="grid gap-2 max-h-[34vh] overflow-y-auto pr-1">
            ${returns.length?returns.map(r=>{
              const fin=financialMap.get(r.return_id)||{};
              const cancelled=norm(r.status)==='cancelled';
              const creditApplied=norm(fin.financial_effect)==='credit_ar'&&num(fin.credit_amount)>0;
              return `<div class="rounded-xl border ${cancelled?'bg-gray-50 opacity-70':'bg-white'} p-4">
                <div class="grid md:grid-cols-[1fr_auto] gap-3 items-start">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2">
                      <b>${esc(r.cn_no||'Credit Note')}</b>
                      ${returnStatusBadge(r.status)}
                      <span class="px-2 py-1 rounded-lg text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-100">${esc(returnActionLabel(r.action))}</span>
                    </div>
                    <div class="text-[11px] text-gray-400 mt-1">${esc(fmtDate(r.return_date))} · Original: <b class="text-gray-600">${esc(r.original_document_no||'-')}</b></div>
                    <div class="text-[11px] text-gray-500 mt-2">${Number(r.item_count||0)} returned item${Number(r.item_count||0)===1?'':'s'}${r.reason?' · '+esc(r.reason):''}</div>
                    ${cancelled
                      ?`<div class="text-[10px] text-gray-400 mt-2">Cancelled CN — no customer credit applied.</div>`
                      :`<div class="text-[10px] text-amber-700 mt-2">Net return value is after applicable discounts. Customer credit affects AR only when approved.</div>`}
                  </div>

                  <div class="flex items-center gap-4">
                    <div class="text-right">
                      <div class="text-[9px] uppercase text-gray-400 font-bold">Net Return Value</div>
                      <div class="font-bold text-amber-700 mt-1">${money(r.return_value)}</div>
                    </div>
                    <button onclick="viewSalesReturn('${r.return_id}')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">View</button>
                  </div>
                </div>
              </div>`;
            }).join(''):'<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No Return / Credit Note cases for this customer.</div>'}
          </div>
        </div>
      </div>`;
  };
})();