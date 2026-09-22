// Click a customer row to review that customer's complete visible order history.
// Loaded after customer rendering scripts so it can decorate the existing Customers UI safely.
(function(){
  function norm(v=''){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function num(v){const n=Number(v||0);return Number.isFinite(n)?n:0}
  function fmtDate(v){if(!v)return '-';const d=new Date(String(v).slice(0,10)+'T00:00:00');return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function docNo(o){return o.sales_invoice_no||o.sr_no||o.invoice_no||o.order_no||'Order'}
  function isPre(o){return ['pre_order','mixed'].includes(norm(o.order_type))||norm(o.sales_flow_type)==='pre_order'||String(o.sr_no||'').toUpperCase().startsWith('SR')}
  function isPendingPre(o){return isPre(o)&&!o.sales_invoice_no&&!o.invoice_issued_at}
  function isSettled(o){return norm(o.payment_status)==='paid'||num(o.balance_due)<=0.001}

  function decorateCustomerRows(list){
    const root=document.getElementById('customerRows');
    if(!root)return;
    const rows=[...root.querySelectorAll('.customer-edit-row')];
    rows.forEach((row,i)=>{
      const c=(list||[])[i];
      if(!c)return;
      row.dataset.customerId=c.id;
      row.classList.add('cursor-pointer','transition','hover:border-amber-200','hover:shadow-md');
      row.title='Click to view customer orders';
      row.setAttribute('role','button');
      row.setAttribute('tabindex','0');
      row.onclick=e=>{
        if(e.target.closest('button,a,input,select,textarea,label'))return;
        openCustomerOrders(c.id);
      };
      row.onkeydown=e=>{
        if((e.key==='Enter'||e.key===' ')&&!e.target.closest('button,a,input,select,textarea')){
          e.preventDefault();openCustomerOrders(c.id);
        }
      };

      // Do not use Tailwind arbitrary-value classes (for example text-[14px]) as a CSS selector.
      // Their square brackets require special escaping and caused the Customers page to crash.
      const firstCell=row.firstElementChild;
      const name=firstCell?.querySelector('.font-bold');
      if(name){
        name.classList.add('hover:text-[#b3871e]');
        name.innerHTML=`<span class="inline-flex items-center gap-1.5">${esc(c.name||'')} <span class="text-[10px] text-[#b3871e] font-semibold">View orders ›</span></span>`;
      }
    });
  }

  const baseRenderRows=window.renderCustomerEditRows;
  if(typeof baseRenderRows==='function'){
    window.renderCustomerEditRows=function(list){
      const out=baseRenderRows.apply(this,arguments);
      decorateCustomerRows(list||[]);
      return out;
    };
  }

  function statusBadge(o){
    if(norm(o.status)==='cancelled')return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-gray-100 text-gray-500">Cancelled</span>';
    if(isSettled(o))return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-green-50 text-green-700 border border-green-100">Settled</span>';
    if(isPendingPre(o))return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-100">Pre-Order</span>';
    return '<span class="px-2 py-1 rounded-lg text-[10px] font-bold bg-red-50 text-red-600 border border-red-100">Balance Due</span>';
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

    openModal(`Customer — ${customer.name||''}`,`<div class="py-12 text-center text-sm text-gray-400">Loading customer orders...</div>`);

    const [sr,dr]=await Promise.all([
      db.from('sales_order_summary').select('*').eq('customer_id',customerId).order('order_date',{ascending:false}),
      db.from('sales_orders').select(`id,sales_invoice_no,sr_no,invoice_no,order_no,sales_flow_type,order_type,invoice_issued_at,sales_order_items(id,product_code_snapshot,item_name_snapshot,qty,fulfillment_status)`).eq('customer_id',customerId)
    ]);
    if(sr.error)return showToast(sr.error.message,'err');
    if(dr.error)console.warn('Customer order item detail unavailable:',dr.error.message);

    const detailMap=new Map((dr.data||[]).map(x=>[x.id,x]));
    const orders=(sr.data||[]).map(o=>({...o,...(detailMap.get(o.id)||{})}));
    const visible=orders.filter(o=>norm(o.status)!=='cancelled');
    const sales=visible.reduce((a,o)=>a+num(o.order_total),0);
    const paid=visible.reduce((a,o)=>a+num(o.amount_paid),0);
    const activeAR=visible.reduce((a,o)=>a+(!isPendingPre(o)&&!isSettled(o)?num(o.balance_due):0),0);
    const pending=visible.reduce((a,o)=>a+(isPendingPre(o)&&!isSettled(o)?num(o.balance_due):0),0);

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
            <div class="flex gap-2">
              <button onclick="closeModal();openEditCustomer('${customerId}')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">Edit Customer</button>
              <button onclick="customerToSalesTracking('${customerId}')" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Open in Sales Tracking</button>
            </div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4">
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Orders</div><div class="text-lg font-bold mt-1">${orders.length}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Sales</div><div class="text-lg font-bold mt-1">${money(sales)}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Received</div><div class="text-lg font-bold text-green-600 mt-1">${money(paid)}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Active AR</div><div class="text-lg font-bold text-red-500 mt-1">${money(activeAR)}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Pending Pre-Order</div><div class="text-lg font-bold text-blue-600 mt-1">${money(pending)}</div></div>
          </div>
        </div>

        <div>
          <div class="flex items-center justify-between mb-2"><h4 class="font-bold">Order History</h4><div class="text-[10px] text-gray-400">Newest first</div></div>
          <div class="grid gap-2 max-h-[55vh] overflow-y-auto pr-1">
            ${orders.length?orders.map(o=>{
              const pendingPre=isPendingPre(o)&&!isSettled(o);
              const balLabel=pendingPre?'Est. Balance':(isSettled(o)?'Balance':'Active Balance');
              const paidLabel=pendingPre?'Pre-Order Deposit':'Paid';
              return `<div class="rounded-xl border border-[#ece8e0] bg-white p-4">
                <div class="grid md:grid-cols-[1fr_auto] gap-3 items-start">
                  <div class="min-w-0">
                    <div class="flex flex-wrap items-center gap-2"><b>${esc(docNo(o))}</b>${statusBadge(o)}</div>
                    <div class="text-[11px] text-gray-400 mt-1">${esc(fmtDate(o.order_date))} · ${isPre(o)?'Pre-Order / SR':'Stock Sale / TK-RK'}</div>
                    <div class="text-[11px] text-gray-500 mt-2 truncate">${itemSummary(o)}</div>
                  </div>
                  <div class="grid grid-cols-3 gap-4 text-right text-xs min-w-[270px]">
                    <div><div class="text-[9px] uppercase text-gray-400 font-bold">Total</div><div class="font-bold mt-1">${money(o.order_total,o.currency)}</div></div>
                    <div><div class="text-[9px] uppercase text-gray-400 font-bold">${paidLabel}</div><div class="font-bold text-green-600 mt-1">${money(o.amount_paid,o.currency)}</div></div>
                    <div><div class="text-[9px] uppercase text-gray-400 font-bold">${balLabel}</div><div class="font-bold mt-1 ${pendingPre?'text-gray-400':num(o.balance_due)>0?'text-red-500':'text-green-600'}">${money(o.balance_due,o.currency)}</div></div>
                  </div>
                </div>
              </div>`;
            }).join(''):'<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No visible orders for this customer.</div>'}
          </div>
        </div>
      </div>`;
  };

  window.customerToSalesTracking=function(customerId){
    closeModal();
    if(window.trackingRedesign){
      trackingRedesign.salesCustomer=customerId;
      trackingRedesign.salesStatus='all';
      trackingRedesign.salesSearch='';
    }
    go('sales-orders');
  };

  // If Customers was already rendered before this script loaded, decorate it now.
  setTimeout(()=>{
    if(document.getElementById('customerRows'))decorateCustomerRows(state.customers||[]);
  },250);
})();
