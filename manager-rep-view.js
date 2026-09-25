// Manager / Super Admin "View / Act as Sales Rep" workspace.
// This never exposes a salesperson password or changes the authenticated login.

state.managerRepContext = null;
try {
  const saved = sessionStorage.getItem('limperial_manager_rep_context');
  if (saved) state.managerRepContext = JSON.parse(saved);
} catch (_) {}

function canUseRepWorkspace(){
  return ['manager','super_admin'].includes(state.profile?.role||'');
}
function repWorkspaceActorLabel(){
  return state.profile?.role==='super_admin'?'Super Admin':'Manager';
}
function managerRepActive(){
  return canUseRepWorkspace() && !!state.managerRepContext?.user_id;
}
function managerRepId(){ return managerRepActive() ? state.managerRepContext.user_id : null; }
function managerRepName(){ return managerRepActive() ? (state.managerRepContext.display_name || state.managerRepContext.email || 'Sales Rep') : ''; }
function managerRepBanner(){
  if(!managerRepActive()) return '';
  return `<div class="mb-5 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
    <div><div class="text-xs font-bold text-amber-800 uppercase tracking-wide">${esc(repWorkspaceActorLabel())} Rep Workspace</div><div class="text-sm text-amber-900 mt-0.5">Viewing / acting for <b>${esc(managerRepName())}</b>. Actions are still recorded as performed by ${esc(state.profile?.display_name || state.user?.email || repWorkspaceActorLabel())}.</div></div>
    <div class="flex gap-2"><button onclick="go('rep-workspace')" class="px-3 py-2 rounded-lg border border-amber-300 bg-white text-xs font-semibold text-amber-900">Change Rep</button><button onclick="clearManagerRepContext()" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">${state.profile?.role==='super_admin'?'Full Super Admin':'All Sales'}</button></div>
  </div>`;
}

const _managerRepNavItems = navItems;
navItems = function(){
  const items = _managerRepNavItems();
  if(canUseRepWorkspace()) items.splice(1,0,['rep-workspace','Rep Workspace','⇄']);
  return items;
};

const _managerRepGo = go;
go = async function(page){
  if(page !== 'rep-workspace') return _managerRepGo(page);
  state.page = page; renderNav();
  document.getElementById('pageTitle').textContent = 'Rep Workspace';
  document.getElementById('pageSubtitle').textContent = 'View and work in a Sales Rep context without using their password';
  document.getElementById('content').innerHTML = '<div class="py-20 text-center text-gray-400">Loading...</div>';
  try { await renderManagerRepWorkspace(); }
  catch(err){ document.getElementById('content').innerHTML = `<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`; }
};

async function renderManagerRepWorkspace(){
  if(!canUseRepWorkspace()) throw new Error('Manager or Super Admin access required');
  const {data,error} = await db.from('app_users').select('user_id,display_name,email,role,active').eq('role','sales').eq('active',true).order('display_name');
  if(error) throw error;
  window._managerRepUsers = data || [];
  const current = managerRepId();
  document.getElementById('content').innerHTML = `
    ${current ? managerRepBanner() : ''}
    <div class="grid lg:grid-cols-[420px_1fr] gap-5">
      <div class="card rounded-2xl p-5 h-fit">
        <h3 class="font-bold text-lg">View / Act as Sales Rep</h3>
        <p class="text-xs text-gray-400 mt-1">This does not reveal or use the salesperson's password. You stay signed in as ${esc(repWorkspaceActorLabel())}.</p>
        <div class="mt-5">
          <label class="text-xs font-semibold">Sales Rep</label>
          <select id="managerRepSelect" class="mt-1 w-full border rounded-xl px-3 py-3 bg-white">
            <option value="">Select Sales Rep</option>
            ${(data||[]).map(u=>`<option value="${u.user_id}" ${current===u.user_id?'selected':''}>${esc(u.display_name||u.email)}</option>`).join('')}
          </select>
        </div>
        <button onclick="activateManagerRepContext()" class="mt-4 w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Open Rep Workspace</button>
        ${current?'<button onclick="clearManagerRepContext()" class="mt-2 w-full border rounded-xl py-3 text-sm font-semibold">Return to All Sales</button>':''}
      </div>
      <div class="card rounded-2xl p-5">
        <h3 class="font-bold">How this works</h3>
        <div class="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
          <div class="bg-gray-50 rounded-xl p-4"><b>Customers</b><div class="text-xs text-gray-500 mt-1">Shows only customers assigned to the selected Sales Rep.</div></div>
          <div class="bg-gray-50 rounded-xl p-4"><b>Sales Orders</b><div class="text-xs text-gray-500 mt-1">Shows only that rep's assigned orders.</div></div>
          <div class="bg-gray-50 rounded-xl p-4"><b>Payments & Tracking</b><div class="text-xs text-gray-500 mt-1">Filtered to the same Sales Rep.</div></div>
          <div class="bg-gray-50 rounded-xl p-4"><b>New Records</b><div class="text-xs text-gray-500 mt-1">Inside Rep Workspace, new customers and orders default to that Sales Rep. Outside Rep Workspace, your normal ${esc(repWorkspaceActorLabel())} assignment controls remain available.</div></div>
        </div>
        <div class="mt-4 rounded-xl border border-blue-100 bg-blue-50 p-4 text-xs text-blue-800">${state.profile?.role==='super_admin'
          ?'Your Super Admin permissions remain available. Rep Workspace only scopes the sales-facing customer/order/payment views and defaults new records to the selected Sales Rep.'
          :'Costing, supplier purchasing and other confidential Admin information remain unavailable to the Manager, even while using Rep Workspace.'}</div>
      </div>
    </div>`;
}

function activateManagerRepContext(){
  if(!canUseRepWorkspace()) return showToast('Manager or Super Admin access required','err');
  const id = document.getElementById('managerRepSelect')?.value;
  if(!id) return showToast('Select a Sales Rep first.','err');
  const u = (window._managerRepUsers||[]).find(x=>x.user_id===id);
  if(!u) return showToast('Sales Rep not found.','err');
  state.managerRepContext = {user_id:u.user_id,display_name:u.display_name,email:u.email};
  sessionStorage.setItem('limperial_manager_rep_context',JSON.stringify(state.managerRepContext));
  showToast(`Rep workspace opened for ${u.display_name||u.email}`);
  go('dashboard');
}

function clearManagerRepContext(){
  state.managerRepContext = null;
  sessionStorage.removeItem('limperial_manager_rep_context');
  showToast(state.profile?.role==='super_admin'?'Returned to full Super Admin view':'Returned to All Sales view');
  go('dashboard');
}

async function recordManagerRepAction(action,entityType,entityId,details={}){
  if(!managerRepActive()) return;
  const {error}=await db.from('manager_rep_actions').insert({
    manager_user_id:state.user.id,
    sales_user_id:managerRepId(),
    action,
    entity_type:entityType||null,
    entity_id:entityId||null,
    details
  });
  if(error) console.warn('Manager rep audit log failed:',error.message);
}

const _managerBaseRenderDashboard = renderDashboard;
renderDashboard = async function(){
  if(!managerRepActive()) return _managerBaseRenderDashboard();
  const {data,error}=await db.from('sales_order_summary').select('*').eq('sales_rep_id',managerRepId()).order('created_at',{ascending:false});
  if(error) throw error;
  state.orderSummary=data||[];
  const total=state.orderSummary.reduce((a,x)=>a+Number(x.order_total||0),0);
  const paid=state.orderSummary.reduce((a,x)=>a+Number(x.amount_paid||0),0);
  const bal=state.orderSummary.reduce((a,x)=>a+Number(x.balance_due||0),0);
  const active=state.orderSummary.filter(x=>!['completed','cancelled'].includes(x.status)).length;
  document.getElementById('content').innerHTML=`${managerRepBanner()}<div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">${kpi('Rep Sales',money(total),managerRepName())}${kpi('Amount Received',money(paid),'Customer payments','text-green-600')}${kpi('Balance Due',money(bal),'Outstanding receivables','text-red-600')}${kpi('Active Orders',active,'Not completed')}</div><div class="grid xl:grid-cols-3 gap-5"><div class="xl:col-span-2 card rounded-2xl overflow-hidden"><div class="p-5 border-b flex justify-between items-center"><div><h3 class="font-bold">Recent Orders — ${esc(managerRepName())}</h3><p class="text-xs text-gray-400">${esc(repWorkspaceActorLabel())} Rep Workspace</p></div><button onclick="openNewOrder()" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">+ New Order</button></div><div class="divide-y">${state.orderSummary.slice(0,8).map(orderRow).join('')||empty('No orders assigned to this Sales Rep yet.')}</div></div><div class="card rounded-2xl p-5 h-fit"><h3 class="font-bold mb-4">Rep Actions</h3><div class="grid gap-2"><button onclick="openNewCustomer()" class="p-3 border rounded-xl text-left text-sm hover:bg-gray-50">+ Add Customer for ${esc(managerRepName())}</button><button onclick="openNewOrder()" class="p-3 border rounded-xl text-left text-sm hover:bg-gray-50">+ Create Order for ${esc(managerRepName())}</button><button onclick="go('rep-workspace')" class="p-3 border rounded-xl text-left text-sm hover:bg-gray-50">⇄ Change Sales Rep</button></div></div></div>`;
};

const _managerBaseRenderCustomers = renderCustomers;
renderCustomers = async function(){
  if(!managerRepActive()) return _managerBaseRenderCustomers();
  const {data,error}=await db.from('customers').select('*').eq('assigned_sales_id',managerRepId()).order('name');
  if(error) throw error;
  state.customers=data||[];
  document.getElementById('content').innerHTML=`${managerRepBanner()}<div class="flex justify-between mb-4"><input id="customerSearch" oninput="filterCustomerRows()" class="border rounded-xl px-4 py-2 w-full max-w-md" placeholder="Search ${esc(managerRepName())}'s customers..."><button onclick="openNewCustomer()" class="ml-3 px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ Customer</button></div><div class="card rounded-2xl overflow-hidden"><div id="customerRows" class="divide-y">${customerRows(state.customers)}</div></div>`;
};

const _managerBaseRenderSalesOrders = renderSalesOrders;
renderSalesOrders = async function(){
  if(!managerRepActive()) return _managerBaseRenderSalesOrders();
  const {data,error}=await db.from('sales_order_summary').select('*').eq('sales_rep_id',managerRepId()).order('created_at',{ascending:false});
  if(error) throw error;
  state.orderSummary=data||[];
  document.getElementById('content').innerHTML=`${managerRepBanner()}<div class="flex justify-end mb-4"><button onclick="openNewOrder()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ New Sales Order</button></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${state.orderSummary.map(orderRow).join('')||empty('No orders assigned to this Sales Rep.')}</div></div>`;
};

const _managerBaseRenderPayments = renderPayments;
renderPayments = async function(){
  if(!managerRepActive()) return _managerBaseRenderPayments();
  const {data,error}=await db.from('sales_payments').select('*,sales_orders!inner(order_no,customer_id,sales_rep_id,customers(name))').eq('sales_orders.sales_rep_id',managerRepId()).order('payment_date',{ascending:false});
  if(error) throw error;
  document.getElementById('content').innerHTML=`${managerRepBanner()}<div class="card rounded-2xl overflow-hidden"><div class="divide-y">${(data||[]).map(p=>`<div class="p-4 grid md:grid-cols-5 gap-2"><b>${esc(p.sales_orders?.order_no||'')}</b><span>${esc(p.sales_orders?.customers?.name||'')}</span><span>${esc(p.payment_date)}</span><span class="text-green-600 font-semibold">${money(p.amount)}</span><span class="text-xs text-gray-400">${esc(p.method||'')}</span></div>`).join('')||empty('No payments for this Sales Rep.')}</div></div>`;
};

const _managerBaseRenderTracking = renderTracking;
renderTracking = async function(){
  if(!managerRepActive()) return _managerBaseRenderTracking();
  const {data,error}=await db.from('sales_order_items').select('id,product_code_snapshot,item_name_snapshot,qty,fulfillment_status,sales_orders!inner(order_no,sales_rep_id,customers(name))').eq('sales_orders.sales_rep_id',managerRepId()).order('created_at',{ascending:false});
  if(error) throw error;
  document.getElementById('content').innerHTML=`${managerRepBanner()}<div class="grid gap-3">${(data||[]).map(i=>`<div class="card rounded-xl p-4 flex justify-between gap-4"><div><b>${esc(i.sales_orders?.order_no||'')}</b> <span class="text-xs text-gray-400">${esc(i.sales_orders?.customers?.name||'')}</span><div class="mt-1 text-sm">${esc(i.product_code_snapshot)} · ${esc(i.item_name_snapshot)} × ${i.qty}</div></div><span class="px-2 py-1 h-fit rounded-full bg-gray-100 text-xs font-semibold">${titleCase(i.fulfillment_status)}</span></div>`).join('')||empty('No order items for this Sales Rep.')}</div>`;
};

const _managerBaseOpenNewCustomer = openNewCustomer;
openNewCustomer = function(){
  return _managerBaseOpenNewCustomer();
};

const _managerBaseOpenNewOrder = openNewOrder;
openNewOrder = async function(){
  if(isManager()&&!managerRepActive()) return showToast('Choose a Sales Rep in Rep Workspace before creating an order.','err');
  return _managerBaseOpenNewOrder();
};

const _managerBaseEnsureOrderFormData = ensureOrderFormData;
ensureOrderFormData = async function(){
  if(!managerRepActive()) return _managerBaseEnsureOrderFormData();
  const [c,p]=await Promise.all([
    db.from('customers').select('*').eq('active',true).eq('assigned_sales_id',managerRepId()).order('name'),
    db.from('product_catalog').select('*').eq('active',true).order('item_name').limit(2000)
  ]);
  if(c.error) throw c.error;if(p.error) throw p.error;
  state.customers=c.data||[];state.products=p.data||[];
};

const _managerBaseSaveCustomer = saveCustomer;
saveCustomer = async function(e){
  if(!managerRepActive()) return _managerBaseSaveCustomer(e);
  e.preventDefault();
  const row=Object.fromEntries(new FormData(e.target).entries());
  row.assigned_sales_id=managerRepId();
  row.created_by=state.user.id;
  const {data,error}=await db.from('customers').insert(row).select('id,name').single();
  if(error) return showToast(error.message,'err');
  await recordManagerRepAction('create_customer','customer',data.id,{customer_name:data.name});
  closeModal();showToast(`Customer added for ${managerRepName()}`);await go('customers');
};

const _managerBaseSaveOrder = saveOrder;
saveOrder = async function(e){
  if(!managerRepActive()) return _managerBaseSaveOrder(e);
  e.preventDefault();
  const rows=[...document.querySelectorAll('.order-item-row')];
  if(!rows.length) return showToast('Add at least one item.','err');
  const order={
    customer_id:document.getElementById('orderCustomer').value,
    sales_rep_id:managerRepId(),
    sales_rep_name_snapshot:managerRepName(),
    order_date:document.getElementById('orderDate').value,
    order_type:document.getElementById('orderType').value,
    status:'confirmed',currency:'USD',
    order_discount:Number(document.getElementById('orderDiscount').value||0),
    notes:document.getElementById('orderNotes').value,
    created_by:state.user.id,
    order_no:'SO-'+new Date().getFullYear()+'-'+Date.now().toString().slice(-6)
  };
  const {data:so,error}=await db.from('sales_orders').insert(order).select().single();
  if(error) return showToast(error.message,'err');
  const items=rows.map(r=>{const s=r.querySelector('.product-select'),opt=s.selectedOptions[0];return{
    sales_order_id:so.id,product_id:s.value,product_code_snapshot:opt.dataset.code,item_name_snapshot:opt.dataset.name,image_url_snapshot:opt.dataset.image||null,
    qty:Number(r.querySelector('.qty').value),unit_price:Number(r.querySelector('.unit-price').value),discount_amount:Number(r.querySelector('.line-discount').value||0),source_type:r.querySelector('.source-type').value
  }});
  const {error:itemErr}=await db.from('sales_order_items').insert(items);
  if(itemErr) return showToast(itemErr.message,'err');
  const pay=Number(document.getElementById('initialPayment').value||0);
  if(pay>0){
    const {error:payErr}=await db.from('sales_payments').insert({sales_order_id:so.id,amount:pay,payment_date:order.order_date,method:document.getElementById('paymentMethod').value,received_by:state.user.id});
    if(payErr) return showToast(payErr.message,'err');
  }
  await recordManagerRepAction('create_sales_order','sales_order',so.id,{order_no:so.order_no,item_count:items.length,initial_payment:pay});
  closeModal();showToast(`Order created for ${managerRepName()}`);await go('sales-orders');
};
