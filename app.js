const { createClient } = window.supabase;
const db = createClient(APP_CONFIG.SUPABASE_URL, APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);

const state = {
  session: null,
  user: null,
  profile: null,
  page: 'dashboard',
  customers: [],
  products: [],
  orders: [],
  orderSummary: [],
  supplierPOs: [],
  supplierSummary: []
};

const ADMIN_ROLES = ['super_admin','admin'];

function money(v, currency='USD'){
  const n = Number(v || 0);
  try { return new Intl.NumberFormat('en-US',{style:'currency',currency}).format(n); }
  catch { return '$' + n.toFixed(2); }
}
function esc(v=''){ return String(v).replace(/[&<>"']/g,s=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[s])); }
function isAdmin(){ return state.profile && ADMIN_ROLES.includes(state.profile.role); }
function isSuper(){ return state.profile?.role === 'super_admin'; }
function titleCase(s=''){ return s.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase()); }
function showToast(msg,type='ok'){
  const d=document.createElement('div');
  d.className=`fixed right-4 top-20 z-[120] px-4 py-3 rounded-xl shadow-lg text-sm ${type==='err'?'bg-red-600':'bg-[#211d18]'} text-white`;
  d.textContent=msg; document.body.appendChild(d); setTimeout(()=>d.remove(),2600);
}

function navItems(){
  const base = [
    ['dashboard','Dashboard','▦'],
    ['customers','Customers','◉'],
    ['sales-orders','Sales Orders','▤'],
    ['tracking','Order Tracking','◎'],
    ['products','Products','◇'],
    ['payments','Payments','＄']
  ];
  if(isAdmin()) base.push(['procurement','Procurement','▣'],['supplier-pos','Supplier POs','⌑'],['reports','Reports','▥']);
  if(isSuper()) base.push(['users','Users & Access','♙']);
  return base;
}
function renderNav(){
  const html=navItems().map(([id,label,icon])=>`<button onclick="go('${id}')" class="sidebar-btn ${state.page===id?'active':''} w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-gray-600 hover:bg-gray-100"><span class="nav-icon w-5 text-center">${icon}</span><span>${label}</span></button>`).join('');
  document.getElementById('sidebarNav').innerHTML=html;
  document.getElementById('mobileNav').innerHTML=`<div class="grid grid-cols-2 gap-2">${navItems().map(([id,label])=>`<button onclick="go('${id}');document.getElementById('mobileNav').classList.add('hidden')" class="text-left px-3 py-2 border rounded-lg text-xs">${label}</button>`).join('')}</div>`;
}

async function boot(){
  const { data } = await db.auth.getSession();
  state.session = data.session || null;
  if(!state.session){ showLogin(); return; }
  state.user=state.session.user;
  const ok=await loadProfile();
  if(!ok){ showLogin('Your login exists, but this account has not been assigned an app role yet. Run admin_setup.sql once, then refresh.'); return; }
  showApp(); await go('dashboard');
}
async function loadProfile(){
  const { data,error }=await db.from('app_users').select('*').eq('user_id',state.user.id).maybeSingle();
  if(error || !data) return false;
  state.profile=data; return true;
}
function showLogin(msg=''){
  document.getElementById('loadingScreen').classList.add('hidden');
  document.getElementById('appShell').classList.add('hidden');
  const s=document.getElementById('loginScreen'); s.classList.remove('hidden'); s.classList.add('flex');
  if(msg){ const e=document.getElementById('loginError');e.textContent=msg;e.classList.remove('hidden'); }
}
function showApp(){
  document.getElementById('loadingScreen').classList.add('hidden');
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('appShell').classList.remove('hidden');
  document.getElementById('sidebarUser').innerHTML=`<div class="font-semibold text-gray-800">${esc(state.profile.display_name||state.user.email)}</div><div>${titleCase(state.profile.role)}</div>`;
  renderNav();
}
document.getElementById('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const email=document.getElementById('loginEmail').value.trim();
  const password=document.getElementById('loginPassword').value;
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error){ const el=document.getElementById('loginError');el.textContent=error.message;el.classList.remove('hidden');return; }
  state.session=data.session;state.user=data.user;
  if(!await loadProfile()){ showLogin('Account login is valid, but no app role is assigned yet.'); return; }
  showApp(); await go('dashboard');
});
async function logout(){ await db.auth.signOut(); location.reload(); }
document.getElementById('mobileMenuBtn').onclick=()=>document.getElementById('mobileNav').classList.toggle('hidden');

async function go(page){
  state.page=page; renderNav();
  const map={
    dashboard:['Dashboard','Business overview'],
    customers:['Customers','Customer master & ownership'],
    'sales-orders':['Sales Orders','Create and manage customer orders'],
    tracking:['Order Tracking','Follow each item from order to delivery'],
    products:['Products','Selling catalog and stock'],
    payments:['Payments','Customer payment history'],
    procurement:['Procurement','Private purchasing view'],
    'supplier-pos':['Supplier POs','Vendor orders and balances'],
    reports:['Reports','Sales, receivables and order status'],
    users:['Users & Access','Role management']
  };
  document.getElementById('pageTitle').textContent=map[page][0];
  document.getElementById('pageSubtitle').textContent=map[page][1];
  const c=document.getElementById('content'); c.innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
  try{
    if(page==='dashboard') await renderDashboard();
    else if(page==='customers') await renderCustomers();
    else if(page==='products') await renderProducts();
    else if(page==='sales-orders') await renderSalesOrders();
    else if(page==='payments') await renderPayments();
    else if(page==='tracking') await renderTracking();
    else if(page==='supplier-pos'||page==='procurement') await renderSupplierPOs(page);
    else if(page==='reports') await renderReports();
    else if(page==='users') await renderUsers();
  }catch(err){ c.innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`; }
}
async function refreshCurrentPage(){ await go(state.page); }

async function renderDashboard(){
  const [ordersRes,poRes] = await Promise.all([
    db.from('sales_order_summary').select('*').order('created_at',{ascending:false}),
    isAdmin()?db.from('supplier_po_summary').select('*').order('created_at',{ascending:false}):Promise.resolve({data:[]})
  ]);
  state.orderSummary=ordersRes.data||[]; state.supplierSummary=poRes.data||[];
  const total=state.orderSummary.reduce((a,x)=>a+Number(x.order_total||0),0);
  const paid=state.orderSummary.reduce((a,x)=>a+Number(x.amount_paid||0),0);
  const bal=state.orderSummary.reduce((a,x)=>a+Number(x.balance_due||0),0);
  const active=state.orderSummary.filter(x=>!['completed','cancelled'].includes(x.status)).length;
  document.getElementById('content').innerHTML=`
    <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
      ${kpi('Total Sales',money(total),'All visible orders')}
      ${kpi('Amount Received',money(paid),'Customer payments','text-green-600')}
      ${kpi('Balance Due',money(bal),'Outstanding receivables','text-red-600')}
      ${kpi('Active Orders',active,'Not completed')}
    </div>
    <div class="grid xl:grid-cols-3 gap-5">
      <div class="xl:col-span-2 card rounded-2xl overflow-hidden">
        <div class="p-5 border-b flex justify-between items-center"><div><h3 class="font-bold">Recent Sales Orders</h3><p class="text-xs text-gray-400">Latest customer activity</p></div><button onclick="openNewOrder()" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">+ New Order</button></div>
        <div class="divide-y">${state.orderSummary.slice(0,8).map(orderRow).join('')||empty('No sales orders yet.')}</div>
      </div>
      <div class="space-y-5">
        <div class="card rounded-2xl p-5">
          <h3 class="font-bold mb-4">Quick Actions</h3>
          <div class="grid gap-2">
            <button onclick="openNewCustomer()" class="p-3 border rounded-xl text-left text-sm hover:bg-gray-50">+ Add Customer</button>
            <button onclick="openNewOrder()" class="p-3 border rounded-xl text-left text-sm hover:bg-gray-50">+ Create Sales Order</button>
            ${isAdmin()?'<button onclick="openNewProduct()" class="p-3 border rounded-xl text-left text-sm hover:bg-gray-50">+ Add Product</button><button onclick="openNewSupplierPO()" class="p-3 border rounded-xl text-left text-sm hover:bg-gray-50">+ Create Supplier PO</button>':''}
          </div>
        </div>
      </div>
    </div>`;
}
function kpi(label,val,sub,cls='text-gray-900'){return `<div class="card rounded-2xl p-4"><div class="text-[10px] uppercase tracking-wider text-gray-400 font-bold">${label}</div><div class="mt-2 text-2xl md:text-3xl font-extrabold ${cls}">${val}</div><div class="text-[10px] text-gray-400 mt-1">${sub}</div></div>`}
function empty(t){return `<div class="p-8 text-center text-sm text-gray-400">${t}</div>`}
function orderRow(o){return `<div class="p-4 flex items-center justify-between gap-3 hover:bg-gray-50"><div><div class="font-bold">${esc(o.order_no)}</div><div class="text-xs text-gray-500">${esc(o.customer_name)} · ${esc(o.order_date||'')}</div></div><div class="text-right"><div class="font-semibold">${money(o.order_total,o.currency)}</div><div class="text-xs ${Number(o.balance_due)>0?'text-red-500':'text-green-600'}">${Number(o.balance_due)>0?'Balance '+money(o.balance_due,o.currency):'Paid'}</div></div></div>`}

async function renderCustomers(){
  const {data,error}=await db.from('customers').select('*').order('name');
  if(error) throw error; state.customers=data||[];
  document.getElementById('content').innerHTML=`<div class="flex justify-between mb-4"><input id="customerSearch" oninput="filterCustomerRows()" class="border rounded-xl px-4 py-2 w-full max-w-md" placeholder="Search customer, phone..."><button onclick="openNewCustomer()" class="ml-3 px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ Customer</button></div>
  <div class="card rounded-2xl overflow-hidden"><div id="customerRows" class="divide-y">${customerRows(state.customers)}</div></div>`;
}
function customerRows(list){return list.map(c=>`<div class="p-4 grid md:grid-cols-4 gap-2"><div><div class="font-semibold">${esc(c.name)}</div><div class="text-xs text-gray-400">${esc(c.customer_code||'')}</div></div><div class="text-sm">${esc(c.phone||'-')}</div><div class="text-sm text-gray-500">${esc(c.email||'-')}</div><div class="text-xs text-gray-400">${esc(c.address||'')}</div></div>`).join('')||empty('No customers yet.')}
function filterCustomerRows(){const q=document.getElementById('customerSearch').value.toLowerCase();document.getElementById('customerRows').innerHTML=customerRows(state.customers.filter(c=>JSON.stringify(c).toLowerCase().includes(q)));}

async function renderProducts(){
  const {data,error}=await db.from('product_catalog').select('*').order('item_name');
  if(error) throw error; state.products=data||[];
  document.getElementById('content').innerHTML=`<div class="flex justify-between mb-4"><input id="productSearch" oninput="filterProductRows()" class="border rounded-xl px-4 py-2 w-full max-w-md" placeholder="Search code, item, brand...">${isAdmin()?'<button onclick="openNewProduct()" class="ml-3 px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ Product</button>':''}</div>
  <div id="productRows" class="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">${productCards(state.products)}</div>`;
}
function productCards(list){return list.map(p=>`<div class="card rounded-2xl p-4 flex gap-4"><div class="w-20 h-20 rounded-xl bg-gray-100 overflow-hidden shrink-0">${p.image_url?`<img src="${esc(p.image_url)}" class="w-full h-full object-cover">`:''}</div><div class="min-w-0"><div class="text-[10px] gold font-bold">${esc(p.code)}</div><div class="font-semibold truncate">${esc(p.item_name)}</div><div class="text-xs text-gray-400">${esc(p.brand||'')}</div><div class="mt-2 flex gap-3 text-xs"><b>${money(p.sales_price,p.currency)}</b><span>Stock ${p.stock_qty}</span></div></div></div>`).join('')||empty('No products yet.')}
function filterProductRows(){const q=document.getElementById('productSearch').value.toLowerCase();document.getElementById('productRows').innerHTML=productCards(state.products.filter(p=>JSON.stringify(p).toLowerCase().includes(q)));}

async function renderSalesOrders(){
  const {data,error}=await db.from('sales_order_summary').select('*').order('created_at',{ascending:false});
  if(error) throw error; state.orderSummary=data||[];
  document.getElementById('content').innerHTML=`<div class="flex justify-end mb-4"><button onclick="openNewOrder()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ New Sales Order</button></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${state.orderSummary.map(orderRow).join('')||empty('No sales orders.')}</div></div>`;
}

async function renderPayments(){
  const {data,error}=await db.from('sales_payments').select('*,sales_orders(order_no,customer_id,customers(name))').order('payment_date',{ascending:false});
  if(error) throw error;
  document.getElementById('content').innerHTML=`<div class="card rounded-2xl overflow-hidden"><div class="divide-y">${(data||[]).map(p=>`<div class="p-4 grid md:grid-cols-5 gap-2"><b>${esc(p.sales_orders?.order_no||'')}</b><span>${esc(p.sales_orders?.customers?.name||'')}</span><span>${esc(p.payment_date)}</span><span class="text-green-600 font-semibold">${money(p.amount)}</span><span class="text-xs text-gray-400">${esc(p.method||'')}</span></div>`).join('')||empty('No payments yet.')}</div></div>`;
}
async function renderTracking(){
  const {data,error}=await db.from('sales_order_items').select('id,product_code_snapshot,item_name_snapshot,qty,fulfillment_status,sales_orders(order_no,customers(name))').order('created_at',{ascending:false});
  if(error) throw error;
  document.getElementById('content').innerHTML=`<div class="grid gap-3">${(data||[]).map(i=>`<div class="card rounded-xl p-4 flex justify-between gap-4"><div><b>${esc(i.sales_orders?.order_no||'')}</b> <span class="text-xs text-gray-400">${esc(i.sales_orders?.customers?.name||'')}</span><div class="mt-1 text-sm">${esc(i.product_code_snapshot)} · ${esc(i.item_name_snapshot)} × ${i.qty}</div></div><span class="px-2 py-1 h-fit rounded-full bg-gray-100 text-xs font-semibold">${titleCase(i.fulfillment_status)}</span></div>`).join('')||empty('No items to track.')}</div>`;
}
async function renderSupplierPOs(mode){
  if(!isAdmin()) throw new Error('Access denied');
  const {data,error}=await db.from('supplier_po_summary').select('*').order('created_at',{ascending:false});
  if(error) throw error; state.supplierSummary=data||[];
  document.getElementById('content').innerHTML=`<div class="flex justify-end mb-4"><button onclick="openNewSupplierPO()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm">+ Supplier PO</button></div><div class="card rounded-2xl overflow-hidden"><div class="divide-y">${state.supplierSummary.map(p=>`<div class="p-4 grid md:grid-cols-5 gap-2"><b>${esc(p.po_number)}</b><span>${esc(p.vendor_name)}</span><span>${titleCase(p.status)}</span><span>${money(p.po_total,p.currency)}</span><span class="${Number(p.balance_due)>0?'text-red-600':'text-green-600'}">${money(p.balance_due,p.currency)}</span></div>`).join('')||empty('No supplier POs.')}</div></div>`;
}
async function renderReports(){
  await renderDashboard();
}
async function renderUsers(){
  if(!isSuper()) throw new Error('Super Admin only');

  const {data,error}=await db
    .from('app_users')
    .select('*')
    .order('display_name');

  if(error) throw error;

  document.getElementById('content').innerHTML=`
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div>
        <h3 class="font-bold text-lg">Users & Access</h3>
        <p class="text-xs text-gray-400">Create logins and control access roles.</p>
      </div>
      <button onclick="openCreateUser()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold">
        + Add User
      </button>
    </div>

    <div class="card rounded-2xl overflow-hidden">
      <div class="divide-y">
        ${(data||[]).map(u=>`
          <div class="p-4 grid md:grid-cols-[1fr_170px_110px] gap-3 items-center">
            <div>
              <div class="font-semibold">${esc(u.display_name || u.email || u.user_id)}</div>
              <div class="text-xs text-gray-400">${esc(u.email || '')}</div>
            </div>

            <select
              onchange="updateUserRole('${u.user_id}',this.value)"
              class="border rounded-lg px-3 py-2 text-sm bg-white">
              <option value="sales" ${u.role==='sales'?'selected':''}>Sales</option>
              <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
              <option value="super_admin" ${u.role==='super_admin'?'selected':''}>Super Admin</option>
            </select>

            <button
              onclick="toggleUserActive('${u.user_id}', ${u.active ? 'false' : 'true'})"
              class="px-3 py-2 rounded-lg text-xs font-semibold border ${u.active ? 'text-green-700 bg-green-50 border-green-200' : 'text-gray-600 bg-gray-50 border-gray-200'}">
              ${u.active ? 'Active' : 'Inactive'}
            </button>
          </div>
        `).join('') || empty('No users found.')}
      </div>
    </div>`;
}

function openCreateUser(){
  if(!isSuper()) return showToast('Super Admin only','err');

  openModal('Create User',`
    <form id="createUserForm" class="space-y-4">
      <div class="grid md:grid-cols-2 gap-4">
        <div>
          <label class="text-xs font-semibold text-gray-600">Name</label>
          <input id="newUserName" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Staff name">
        </div>

        <div>
          <label class="text-xs font-semibold text-gray-600">Email</label>
          <input id="newUserEmail" type="email" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="staff@company.com">
        </div>

        <div>
          <label class="text-xs font-semibold text-gray-600">Password</label>
          <input id="newUserPassword" type="password" minlength="8" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Minimum 8 characters">
        </div>

        <div>
          <label class="text-xs font-semibold text-gray-600">Role</label>
          <select id="newUserRole" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">
            <option value="sales">Sales</option>
            <option value="admin">Admin</option>
            <option value="super_admin">Super Admin</option>
          </select>
        </div>
      </div>

      <label class="flex items-center gap-2 text-sm">
        <input id="newUserActive" type="checkbox" checked class="w-4 h-4">
        <span>Active user</span>
      </label>

      <div class="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
        The user can sign in immediately with the email and password you create here.
      </div>

      <button id="createUserSubmitBtn" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">
        Create User
      </button>
    </form>
  `);

  document.getElementById('createUserForm').onsubmit = saveNewUser;
}

async function saveNewUser(e){
  e.preventDefault();

  const btn = document.getElementById('createUserSubmitBtn');
  btn.disabled = true;
  btn.textContent = 'Creating...';

  const payload = {
    name: document.getElementById('newUserName').value.trim(),
    email: document.getElementById('newUserEmail').value.trim(),
    password: document.getElementById('newUserPassword').value,
    role: document.getElementById('newUserRole').value,
    active: document.getElementById('newUserActive').checked
  };

  try{
    const {data,error} = await db.functions.invoke('create-app-user', {
      body: payload
    });

    if(error) throw error;
    if(data?.error) throw new Error(data.error);

    closeModal();
    showToast('User created successfully');
    await go('users');
  }catch(err){
    showToast(err.message || 'Could not create user','err');
    btn.disabled = false;
    btn.textContent = 'Create User';
  }
}

async function updateUserRole(id,role){
  const {error}=await db
    .from('app_users')
    .update({role})
    .eq('user_id',id);

  if(error) showToast(error.message,'err');
  else {
    showToast('Role updated');
    if(id === state.user.id){
      await loadProfile();
      renderNav();
    }
  }
}

async function toggleUserActive(id,active){
  if(id === state.user.id && active === false){
    return showToast('You cannot deactivate your own Super Admin account here.','err');
  }

  const {error}=await db
    .from('app_users')
    .update({active})
    .eq('user_id',id);

  if(error) showToast(error.message,'err');
  else {
    showToast(active ? 'User activated' : 'User deactivated');
    await go('users');
  }
}

function openModal(title,body){document.getElementById('modalTitle').textContent=title;document.getElementById('modalBody').innerHTML=body;document.getElementById('modal').classList.remove('hidden');}
function closeModal(){document.getElementById('modal').classList.add('hidden');}

function openNewCustomer(){
  openModal('Add Customer',`<form id="customerForm" class="grid md:grid-cols-2 gap-4">
  <input name="name" required class="border rounded-xl px-3 py-2" placeholder="Customer name">
  <input name="customer_code" class="border rounded-xl px-3 py-2" placeholder="Customer code (optional)">
  <input name="phone" class="border rounded-xl px-3 py-2" placeholder="Phone">
  <input name="email" type="email" class="border rounded-xl px-3 py-2" placeholder="Email">
  <input name="address" class="md:col-span-2 border rounded-xl px-3 py-2" placeholder="Address">
  <textarea name="notes" class="md:col-span-2 border rounded-xl px-3 py-2" placeholder="Notes"></textarea>
  <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3">Save Customer</button></form>`);
  document.getElementById('customerForm').onsubmit=saveCustomer;
}
async function saveCustomer(e){
  e.preventDefault();const f=new FormData(e.target);const row=Object.fromEntries(f.entries());
  row.assigned_sales_id=state.user.id;row.created_by=state.user.id;
  const {error}=await db.from('customers').insert(row); if(error)return showToast(error.message,'err');
  closeModal();showToast('Customer added');await go('customers');
}

function openNewProduct(){
  if(!isAdmin()) return;
  openModal('Add Product',`<form id="productForm" class="grid md:grid-cols-2 gap-4">
  <input name="code" required class="border rounded-xl px-3 py-2" placeholder="Code / SKU">
  <input name="item_name" required class="border rounded-xl px-3 py-2" placeholder="Item name">
  <input name="brand" class="border rounded-xl px-3 py-2" placeholder="Brand">
  <input name="class" class="border rounded-xl px-3 py-2" placeholder="Class">
  <input name="sales_price" type="number" step="0.01" class="border rounded-xl px-3 py-2" placeholder="Sales price">
  <input name="stock_qty" type="number" step="0.01" class="border rounded-xl px-3 py-2" placeholder="Stock quantity">
  <input name="image_url" class="md:col-span-2 border rounded-xl px-3 py-2" placeholder="Image URL">
  <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3">Save Product</button></form>`);
  document.getElementById('productForm').onsubmit=async e=>{e.preventDefault();const row=Object.fromEntries(new FormData(e.target).entries());row.sales_price=Number(row.sales_price||0);row.stock_qty=Number(row.stock_qty||0);const {error}=await db.from('product_catalog').insert(row);if(error)return showToast(error.message,'err');closeModal();showToast('Product added');await go('products');};
}

async function ensureOrderFormData(){
  const [c,p]=await Promise.all([db.from('customers').select('*').eq('active',true).order('name'),db.from('product_catalog').select('*').eq('active',true).order('item_name')]);
  state.customers=c.data||[];state.products=p.data||[];
}
async function openNewOrder(){
  await ensureOrderFormData();
  if(!state.customers.length) return showToast('Add a customer first','err');
  if(!state.products.length) return showToast('Add products first','err');
  openModal('Create Sales Order',`<form id="orderForm" class="space-y-5">
  <div class="grid md:grid-cols-3 gap-3">
   <select id="orderCustomer" class="border rounded-xl px-3 py-2">${state.customers.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
   <select id="orderType" class="border rounded-xl px-3 py-2"><option value="in_stock">In Stock</option><option value="pre_order">Pre-Order</option><option value="mixed">Mixed</option></select>
   <input id="orderDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="border rounded-xl px-3 py-2">
  </div>
  <div id="orderItems" class="space-y-3"></div>
  <button type="button" onclick="addOrderItemRow()" class="px-3 py-2 border rounded-lg text-sm">+ Add Item</button>
  <div class="grid md:grid-cols-3 gap-3 border-t pt-4">
   <input id="orderDiscount" type="number" step="0.01" value="0" class="border rounded-xl px-3 py-2" placeholder="Order discount">
   <input id="initialPayment" type="number" step="0.01" value="0" class="border rounded-xl px-3 py-2" placeholder="Payment received">
   <input id="paymentMethod" class="border rounded-xl px-3 py-2" placeholder="Payment method">
  </div>
  <textarea id="orderNotes" class="w-full border rounded-xl px-3 py-2" placeholder="Notes"></textarea>
  <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Confirm Order</button></form>`);
  addOrderItemRow();
  document.getElementById('orderForm').onsubmit=saveOrder;
}
function addOrderItemRow(){
  const wrap=document.getElementById('orderItems');
  const d=document.createElement('div');d.className='grid md:grid-cols-6 gap-2 p-3 bg-gray-50 rounded-xl order-item-row';
  d.innerHTML=`<select class="product-select md:col-span-2 border rounded-lg px-2 py-2" onchange="syncItemPrice(this)">${state.products.map(p=>`<option value="${p.id}" data-price="${p.sales_price}" data-code="${esc(p.code)}" data-name="${esc(p.item_name)}" data-image="${esc(p.image_url||'')}">${esc(p.code)} · ${esc(p.item_name)}</option>`).join('')}</select>
  <input class="qty border rounded-lg px-2 py-2" type="number" min="0.01" step="0.01" value="1" placeholder="Qty">
  <input class="unit-price border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="${state.products[0]?.sales_price||0}" placeholder="Unit price">
  <input class="line-discount border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="0" placeholder="Discount">
  <select class="source-type border rounded-lg px-2 py-2"><option value="stock">Stock</option><option value="pre_order">Pre-order</option></select>`;
  wrap.appendChild(d);
}
function syncItemPrice(sel){sel.closest('.order-item-row').querySelector('.unit-price').value=sel.selectedOptions[0].dataset.price||0;}
async function saveOrder(e){
  e.preventDefault();
  const rows=[...document.querySelectorAll('.order-item-row')];
  if(!rows.length)return;
  const order={
    customer_id:document.getElementById('orderCustomer').value,
    sales_rep_id:state.user.id,
    order_date:document.getElementById('orderDate').value,
    order_type:document.getElementById('orderType').value,
    status:'confirmed',currency:'USD',
    order_discount:Number(document.getElementById('orderDiscount').value||0),
    notes:document.getElementById('orderNotes').value,
    created_by:state.user.id,
    order_no:'SO-'+new Date().getFullYear()+'-'+Date.now().toString().slice(-6)
  };
  const {data:so,error}=await db.from('sales_orders').insert(order).select().single();
  if(error)return showToast(error.message,'err');
  const items=rows.map(r=>{const s=r.querySelector('.product-select');const opt=s.selectedOptions[0];return{
    sales_order_id:so.id,product_id:s.value,product_code_snapshot:opt.dataset.code,item_name_snapshot:opt.dataset.name,image_url_snapshot:opt.dataset.image||null,
    qty:Number(r.querySelector('.qty').value),unit_price:Number(r.querySelector('.unit-price').value),discount_amount:Number(r.querySelector('.line-discount').value||0),source_type:r.querySelector('.source-type').value
  }});
  const {error:itemErr}=await db.from('sales_order_items').insert(items); if(itemErr)return showToast(itemErr.message,'err');
  const pay=Number(document.getElementById('initialPayment').value||0);
  if(pay>0){const {error:payErr}=await db.from('sales_payments').insert({sales_order_id:so.id,amount:pay,payment_date:order.order_date,method:document.getElementById('paymentMethod').value,received_by:state.user.id});if(payErr)return showToast(payErr.message,'err');}
  closeModal();showToast('Sales order created');await go('sales-orders');
}

function openNewSupplierPO(){
  if(!isAdmin())return;
  openModal('Create Supplier PO',`<form id="poForm" class="grid md:grid-cols-2 gap-4">
  <input name="vendor_name" required class="border rounded-xl px-3 py-2" placeholder="Vendor / Supplier">
  <input name="order_date" type="date" value="${new Date().toISOString().slice(0,10)}" class="border rounded-xl px-3 py-2">
  <select name="currency" class="border rounded-xl px-3 py-2"><option>USD</option><option>EUR</option><option>CNY</option><option>GBP</option></select>
  <input name="shipping_agent" class="border rounded-xl px-3 py-2" placeholder="Shipping agent">
  <input name="deposit_due_date" type="date" class="border rounded-xl px-3 py-2">
  <input name="balance_due_date" type="date" class="border rounded-xl px-3 py-2">
  <input name="estimated_arrival" type="date" class="border rounded-xl px-3 py-2">
  <textarea name="notes" class="md:col-span-2 border rounded-xl px-3 py-2" placeholder="Notes"></textarea>
  <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3">Create Supplier PO</button></form>`);
  document.getElementById('poForm').onsubmit=async e=>{e.preventDefault();const row=Object.fromEntries(new FormData(e.target).entries());row.po_number='PO-'+new Date().getFullYear()+'-'+Date.now().toString().slice(-6);row.status='placed';row.created_by=state.user.id;Object.keys(row).forEach(k=>row[k]===''&&(row[k]=null));const {error}=await db.from('supplier_pos').insert(row);if(error)return showToast(error.message,'err');closeModal();showToast('Supplier PO created');await go('supplier-pos');};
}

boot();
