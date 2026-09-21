// Role and sales-access overrides. Loaded after app.js and product-admin.js.

function isManager(){return state.profile?.role==='manager'}
function canManageSalesAccess(){return ['super_admin','admin','manager'].includes(state.profile?.role)}

navItems=function(){
  const base=[
    ['dashboard','Dashboard','▦'],
    ['customers','Customers','◉'],
    ['sales-orders','Sales Orders','▤'],
    ['tracking','Order Tracking','◎'],
    ['products','Products','◇'],
    ['payments','Payments','＄']
  ];
  if(isAdmin()) base.push(['procurement','Procurement','▣'],['supplier-pos','Supplier POs','⌑']);
  if(canManageSalesAccess()) base.push(['reports','Reports','▥'],['sales-access','Sales Access','⊕']);
  if(isSuper()) base.push(['users','Users & Access','♙']);
  return base;
};

go=async function(page){
  state.page=page;renderNav();
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
    'sales-access':['Sales Access','Grant Sales users access to extra customers or orders'],
    users:['Users & Access','Role management']
  };
  const meta=map[page]||['Dashboard','Sales & Order Management'];
  document.getElementById('pageTitle').textContent=meta[0];
  document.getElementById('pageSubtitle').textContent=meta[1];
  document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
  try{
    if(page==='dashboard')await renderDashboard();
    else if(page==='customers')await renderCustomers();
    else if(page==='products')await renderProducts();
    else if(page==='sales-orders')await renderSalesOrders();
    else if(page==='payments')await renderPayments();
    else if(page==='tracking')await renderTracking();
    else if(page==='supplier-pos'||page==='procurement')await renderSupplierPOs();
    else if(page==='reports')await renderReports();
    else if(page==='sales-access')await renderSalesAccess();
    else if(page==='users')await renderUsers();
  }catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
};

renderUsers=async function(){
  if(!isSuper())throw new Error('Super Admin only');
  const {data,error}=await db.from('app_users').select('*').order('display_name');
  if(error)throw error;
  document.getElementById('content').innerHTML=`
    <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
      <div><h3 class="font-bold text-lg">Users & Access</h3><p class="text-xs text-gray-400">Only Super Admin can create/delete users or change roles.</p></div>
      <button onclick="openCreateUser()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Add User</button>
    </div>
    <div class="card rounded-2xl overflow-hidden"><div class="divide-y">
      ${(data||[]).map(u=>`
        <div class="p-4 grid md:grid-cols-[1fr_170px_105px_90px] gap-3 items-center">
          <div><div class="font-semibold">${esc(u.display_name||u.email||u.user_id)}</div><div class="text-xs text-gray-400">${esc(u.email||'')}</div></div>
          <select onchange="updateUserRoleSafe('${u.user_id}',this.value)" class="border rounded-lg px-3 py-2 text-sm bg-white">
            <option value="sales" ${u.role==='sales'?'selected':''}>Sales</option>
            <option value="manager" ${u.role==='manager'?'selected':''}>Manager</option>
            <option value="admin" ${u.role==='admin'?'selected':''}>Admin</option>
            <option value="super_admin" ${u.role==='super_admin'?'selected':''}>Super Admin</option>
          </select>
          <button onclick="toggleUserActive('${u.user_id}',${u.active?'false':'true'})" class="px-3 py-2 rounded-lg text-xs font-semibold border ${u.active?'text-green-700 bg-green-50 border-green-200':'text-gray-600 bg-gray-50 border-gray-200'}">${u.active?'Active':'Inactive'}</button>
          <button ${u.user_id===state.user.id?'disabled':''} onclick="deleteAppUser('${u.user_id}','${esc(u.display_name||u.email||'this user')}')" class="px-3 py-2 rounded-lg text-xs font-semibold border text-red-600 border-red-200 disabled:opacity-30">Delete</button>
        </div>`).join('')||empty('No users found.')}
    </div></div>`;
};

openCreateUser=function(){
  if(!isSuper())return showToast('Super Admin only','err');
  openModal('Create User',`<form id="createUserForm" class="space-y-4">
    <div class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold text-gray-600">Name</label><input id="newUserName" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Staff name"></div>
      <div><label class="text-xs font-semibold text-gray-600">Email</label><input id="newUserEmail" type="email" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="staff@company.com"></div>
      <div><label class="text-xs font-semibold text-gray-600">Password</label><input id="newUserPassword" type="password" minlength="8" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Minimum 8 characters"></div>
      <div><label class="text-xs font-semibold text-gray-600">Role</label><select id="newUserRole" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="sales">Sales</option><option value="manager">Manager</option><option value="admin">Admin</option><option value="super_admin">Super Admin</option></select></div>
    </div>
    <label class="flex items-center gap-2 text-sm"><input id="newUserActive" type="checkbox" checked class="w-4 h-4"><span>Active user</span></label>
    <div class="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">If the email already exists, the existing login is updated and the selected role is applied.</div>
    <button id="createUserSubmitBtn" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Create / Update User</button>
  </form>`);
  document.getElementById('createUserForm').onsubmit=saveNewUser;
};

async function updateUserRoleSafe(id,role){
  if(id===state.user.id&&role!=='super_admin'){await go('users');return showToast('You cannot demote your own Super Admin account.','err')}
  const {error}=await db.from('app_users').update({role}).eq('user_id',id);
  if(error){showToast(error.message,'err');await go('users')}else{showToast('Role updated');await go('users')}
}

async function deleteAppUser(id,name){
  if(!isSuper())return showToast('Super Admin only','err');
  if(id===state.user.id)return showToast('You cannot delete your own account.','err');
  if(!confirm(`Delete ${name}? Historical sales/order records will be kept, but this login will be removed.`))return;
  try{
    const {data,error}=await db.functions.invoke('delete-app-user',{body:{user_id:id}});
    if(error)throw error;
    if(data?.error)throw new Error(data.error);
    showToast('User deleted');await go('users');
  }catch(err){showToast(err.message||'Could not delete user','err')}
}

async function renderSalesAccess(){
  if(!canManageSalesAccess())throw new Error('Manager access required');
  const [ur,cr,or,gr]=await Promise.all([
    db.from('app_users').select('user_id,display_name,email,role,active').eq('role','sales').eq('active',true).order('display_name'),
    db.from('customers').select('id,name,customer_code,assigned_sales_id').order('name'),
    db.from('sales_order_summary').select('id,order_no,customer_name,order_date').order('created_at',{ascending:false}),
    db.from('sales_access_grants').select('*').order('created_at',{ascending:false})
  ]);
  if(ur.error)throw ur.error;if(cr.error)throw cr.error;if(or.error)throw or.error;if(gr.error)throw gr.error;
  window._salesAccessData={users:ur.data||[],customers:cr.data||[],orders:or.data||[],grants:gr.data||[]};
  const d=window._salesAccessData;
  const userName=id=>{const u=d.users.find(x=>x.user_id===id);return u?.display_name||u?.email||id};
  const customerName=id=>{const c=d.customers.find(x=>x.id===id);return c?`${c.name}${c.customer_code?' · '+c.customer_code:''}`:id};
  const orderName=id=>{const o=d.orders.find(x=>x.id===id);return o?`${o.order_no} · ${o.customer_name}`:id};
  document.getElementById('content').innerHTML=`
    <div class="grid xl:grid-cols-[380px_1fr] gap-5">
      <div class="card rounded-2xl p-5 h-fit">
        <h3 class="font-bold">Grant Sales Access</h3><p class="text-xs text-gray-400 mt-1">Give a Sales user access to an extra customer or a specific order.</p>
        <form id="grantAccessForm" class="space-y-3 mt-5">
          <div><label class="text-xs font-semibold">Sales User</label><select id="grantSalesUser" required class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="">Select Sales user</option>${d.users.map(u=>`<option value="${u.user_id}">${esc(u.display_name||u.email)}</option>`).join('')}</select></div>
          <div><label class="text-xs font-semibold">Grant Scope</label><select id="grantScope" onchange="refreshGrantTargets()" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="customer">Whole Customer</option><option value="order">Specific Sales Order</option></select></div>
          <div><label class="text-xs font-semibold">Customer / Order</label><select id="grantTarget" required class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"></select></div>
          <div><label class="text-xs font-semibold">Access Level</label><select id="grantLevel" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="edit">View + Edit</option><option value="view">View Only</option></select></div>
          <div><label class="text-xs font-semibold">Expires</label><input id="grantExpires" type="datetime-local" class="mt-1 w-full border rounded-xl px-3 py-2"><div class="text-[10px] text-gray-400 mt-1">Leave blank for permanent access.</div></div>
          <div><label class="text-xs font-semibold">Reason / Note</label><textarea id="grantReason" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: Covering Nary while she is on leave"></textarea></div>
          <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Grant Access</button>
        </form>
      </div>
      <div class="card rounded-2xl overflow-hidden">
        <div class="p-5 border-b"><h3 class="font-bold">Access Grants</h3><p class="text-xs text-gray-400">Manager/Admin/Super Admin controlled exceptions for Sales users.</p></div>
        <div class="divide-y">${d.grants.length?d.grants.map(g=>{
          const target=g.customer_id?customerName(g.customer_id):orderName(g.sales_order_id);
          const expired=g.expires_at&&new Date(g.expires_at)<new Date();
          const active=g.active&&!expired;
          return `<div class="p-4 grid md:grid-cols-[1fr_1.3fr_90px_100px] gap-3 items-center"><div><b>${esc(userName(g.sales_user_id))}</b><div class="text-xs text-gray-400">${titleCase(g.access_level)}${g.expires_at?' · until '+new Date(g.expires_at).toLocaleString():''}</div></div><div><div class="text-sm">${esc(target)}</div>${g.reason?`<div class="text-xs text-gray-400">${esc(g.reason)}</div>`:''}</div><span class="text-xs font-semibold ${active?'text-green-600':'text-gray-400'}">${active?'Active':expired?'Expired':'Revoked'}</span>${active?`<button onclick="revokeSalesAccess('${g.id}')" class="px-3 py-2 border border-red-200 text-red-600 rounded-lg text-xs">Revoke</button>`:'<span></span>'}</div>`
        }).join(''):empty('No access grants yet.')}</div>
      </div>
    </div>`;
  refreshGrantTargets();
  document.getElementById('grantAccessForm').onsubmit=saveSalesAccessGrant;
}

function refreshGrantTargets(){
  const d=window._salesAccessData;if(!d)return;
  const scope=document.getElementById('grantScope')?.value||'customer';
  const el=document.getElementById('grantTarget');if(!el)return;
  if(scope==='customer')el.innerHTML='<option value="">Select Customer</option>'+d.customers.map(c=>`<option value="${c.id}">${esc(c.name)}${c.customer_code?' · '+esc(c.customer_code):''}</option>`).join('');
  else el.innerHTML='<option value="">Select Sales Order</option>'+d.orders.map(o=>`<option value="${o.id}">${esc(o.order_no)} · ${esc(o.customer_name||'')}</option>`).join('');
}

async function saveSalesAccessGrant(e){
  e.preventDefault();
  const salesUser=document.getElementById('grantSalesUser').value,scope=document.getElementById('grantScope').value,target=document.getElementById('grantTarget').value;
  if(!salesUser||!target)return showToast('Select a Sales user and target.','err');
  const expiresRaw=document.getElementById('grantExpires').value;
  const row={sales_user_id:salesUser,access_level:document.getElementById('grantLevel').value,reason:document.getElementById('grantReason').value.trim()||null,active:true,expires_at:expiresRaw?new Date(expiresRaw).toISOString():null,granted_by:state.user.id};
  let q=db.from('sales_access_grants').select('id').eq('sales_user_id',salesUser);
  if(scope==='customer')q=q.eq('customer_id',target).is('sales_order_id',null);else q=q.eq('sales_order_id',target);
  const {data:existing,error:qerr}=await q.maybeSingle();if(qerr)return showToast(qerr.message,'err');
  let result;
  if(existing?.id){const patch={...row,customer_id:scope==='customer'?target:null,sales_order_id:scope==='order'?target:null};result=await db.from('sales_access_grants').update(patch).eq('id',existing.id)}
  else{const insert={...row,customer_id:scope==='customer'?target:null,sales_order_id:scope==='order'?target:null};result=await db.from('sales_access_grants').insert(insert)}
  if(result.error)return showToast(result.error.message,'err');
  showToast('Sales access granted');await renderSalesAccess();
}

async function revokeSalesAccess(id){
  const {error}=await db.from('sales_access_grants').update({active:false}).eq('id',id);
  if(error)return showToast(error.message,'err');
  showToast('Access revoked');await renderSalesAccess();
}
