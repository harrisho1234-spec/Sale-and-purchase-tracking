// Granular Users & Access permission builder.
// Keeps the existing application UI/workflows intact and replaces only Users & Access administration.
(function(){
  const A=window.granularAccessState||{
    loaded:false,
    loading:false,
    permissions:{},
    restrictAssigned:true,
    roleKey:'',
    roleName:'',
    hasCustom:false,
    adminTab:'users',
    adminSnapshot:null,
    users:[],
    builder:null
  };
  window.granularAccessState=A;

  const AREAS=[
    {
      id:'customers',label:'Customers & credit',icon:'◉',
      activities:[
        {key:'customers.view',label:'View customers',description:'View customer profiles and customer sales history.',view:true},
        {key:'customers.create',label:'Create customers',description:'Add new customers.'},
        {key:'customers.edit',label:'Edit customers',description:'Edit customer details when record scope allows.'},
        {key:'customers.delete',label:'Delete customers',description:'Delete customer records where allowed.'}
      ]
    },
    {
      id:'sales-orders',label:'Sales orders',icon:'▤',
      activities:[
        {key:'sales_orders.view',label:'View sales orders',description:'View quotations, orders and invoice-linked sales records.',view:true},
        {key:'sales_orders.create',label:'Create sales orders',description:'Create new customer orders.'},
        {key:'sales_orders.edit',label:'Edit sales orders',description:'Edit permitted Sales Orders.'},
        {key:'sales_orders.delete',label:'Delete sales orders',description:'Delete transactions where the workflow allows.'},
        {key:'sales_orders.print',label:'Print sales documents',description:'Print Sales Orders and related customer documents.'},
        {key:'sales_orders.export',label:'Export sales data',description:'Export Sales Order data and reports.'},
        {key:'sales.view_all',label:'View all sales records',description:'See all customers and Sales Reps instead of only owned/assigned records.'}
      ]
    },
    {
      id:'tracking',label:'Order tracking',icon:'◎',
      activities:[
        {key:'tracking.view',label:'View order tracking',description:'View item and order fulfillment status.',view:true},
        {key:'tracking.edit',label:'Update tracking status',description:'Change permitted item tracking stages.'}
      ]
    },
    {
      id:'payments-returns',label:'Payments & returns',icon:'$',
      activities:[
        {key:'payments.view',label:'View payments',description:'View deposits and customer payment history.',view:true},
        {key:'payments.create',label:'Add payments / deposits',description:'Create payment or deposit records.'},
        {key:'payments.edit',label:'Edit payment records',description:'Edit or request edits to payments.'},
        {key:'payments.approve',label:'Approve payment changes',description:'Approve payment-related requests.'},
        {key:'returns.view',label:'View returns',description:'View return and customer credit records.',view:true},
        {key:'returns.create',label:'Create returns',description:'Create customer return records.'},
        {key:'returns.edit',label:'Edit returns',description:'Edit permitted return records.'},
        {key:'returns.approve',label:'Approve returns',description:'Approve return requests.'}
      ]
    },
    {
      id:'products',label:'Products',icon:'◇',
      activities:[
        {key:'products.view',label:'View products',description:'View product catalog and stock summary.',view:true},
        {key:'products.sales_price_view',label:'View Sales Price',description:'Show the normal product Sales Price. Does not grant cost, landed cost, margin or Tax pricing access.'},
        {key:'products.create',label:'Create products',description:'Add products to the catalog.'},
        {key:'products.edit',label:'Edit products',description:'Edit product information.'},
        {key:'products.delete',label:'Delete products',description:'Delete products where allowed.'},
        {key:'products.tax_view',label:'View Tax Inventory',description:'Access Tax Inventory classification and stock view.',view:true},
        {key:'products.tax_manage',label:'Manage confidential Tax setup',description:'Protected Super Admin tax pricing/classification controls.',protected:true}
      ]
    },
    {
      id:'inventory',label:'Inventory & stock',icon:'↔',
      activities:[
        {key:'inventory.view',label:'View Stock & Inventory',description:'View balances, movements, receiving and fulfillment.',view:true},
        {key:'inventory.operate',label:'Operate stock',description:'Request or perform permitted stock movements.'},
        {key:'inventory.transfer',label:'Transfer stock',description:'Move stock between locations.'},
        {key:'inventory.approve',label:'Approve stock actions',description:'Approve Stock OUT and protected movement requests.'},
        {key:'inventory.reconcile',label:'Historical / month-end reconciliation',description:'Perform protected reconciliation workflows.'},
        {key:'inventory.count',label:'Manage stock counts',description:'Start and work with stock counts.'},
        {key:'inventory.reports',label:'View inventory reports',description:'View inventory-specific reports.',view:true}
      ]
    },
    {
      id:'purchasing',label:'Purchasing & suppliers',icon:'⌑',
      activities:[
        {key:'procurement.view',label:'View Procurement',description:'View Supplier POs, PO items, shipping and allocations.',view:true},
        {key:'procurement.po_create',label:'Create Supplier POs',description:'Create purchase orders.'},
        {key:'procurement.po_edit',label:'Edit Supplier POs',description:'Edit PO details and items.'},
        {key:'procurement.po_delete',label:'Delete Supplier POs',description:'Delete permitted POs.'},
        {key:'procurement.po_receive',label:'Receive PO stock',description:'Receive arrived PO items into stock.'},
        {key:'procurement.vendor_manage',label:'Manage Vendor Info',description:'Create and edit vendor information.'},
        {key:'procurement.supplier_payments',label:'Manage Supplier Payments',description:'Record and update supplier payments.'},
        {key:'procurement.shipping',label:'Update Shipping / ETA',description:'Maintain PO shipping and ETA status.'},
        {key:'procurement.allocations',label:'Manage SR / PO allocations',description:'Manage customer allocation relationships.'},
        {key:'procurement.historical_reconcile',label:'PO historical reconciliation',description:'Reconcile historical POs already reflected in opening stock.'}
      ]
    },
    {
      id:'finance-reports',label:'Finance & reports',icon:'▥',
      activities:[
        {key:'reports.view',label:'View reports',description:'View permitted sales and business reports.',view:true},
        {key:'reports.export',label:'Export reports',description:'Export report data.'},
        {key:'finance.ar_view',label:'View Accounts Receivable',description:'View Active AR and customer balances.',view:true},
        {key:'finance.cost_margin_view',label:'View cost & margin',description:'View cost and margin-sensitive information.',view:true},
        {key:'finance.payment_records',label:'View payment records',description:'View detailed financial payment records.',view:true}
      ]
    },
    {
      id:'management',label:'Company & administration',icon:'♙',
      activities:[
        {key:'approvals.view',label:'View approvals',description:'Open approval queues.',view:true},
        {key:'approvals.manage',label:'Approve / reject requests',description:'Take action on permitted approval requests.'},
        {key:'sales_access.manage',label:'Manage Sales Access',description:'Grant Sales users access to extra customers or orders.'},
        {key:'stock_locations.manage',label:'Manage Stock Locations',description:'Create and maintain stock locations.'},
        {key:'users.manage',label:'Manage Users & Access',description:'Protected Super Admin account and permission administration.',protected:true},
        {key:'activity_logs.view',label:'View access activity log',description:'Protected audit trail for access changes.',protected:true,view:true}
      ]
    }
  ];

  const PAGE_PERMISSIONS={
    customers:'customers.view',
    'sales-orders':'sales_orders.view',
    tracking:'tracking.view',
    'rep-workspace':'sales_orders.view',
    products:'products.view',
    payments:'payments.view',
    returns:'returns.view',
    'stock-inventory':'inventory.view',
    procurement:'procurement.view',
    'supplier-pos':'procurement.view',
    'vendor-info':'procurement.vendor_manage',
    reports:'reports.view',
    'customer-database':'reports.view',
    'showroom-visit':'reports.view',
    online:'reports.view',
    approvals:'approvals.view',
    'sales-access':'sales_access.manage',
    'stock-locations':'stock_locations.manage',
    users:'users.manage'
  };

  const ROLE_FALLBACK={
    sales:new Set(['customers.view','customers.create','customers.edit','sales_orders.view','sales_orders.create','sales_orders.edit','sales_orders.print','tracking.view','tracking.edit','payments.view','returns.view','returns.create','products.view','products.sales_price_view','reports.view']),
    accountant:new Set(['customers.view','sales_orders.view','tracking.view','payments.view','payments.create','payments.edit','returns.view','products.view','products.sales_price_view','inventory.view','inventory.reports','reports.view','reports.export','finance.ar_view','finance.cost_margin_view','finance.payment_records']),
    stock_controller:new Set(['products.view','inventory.view','inventory.operate','inventory.transfer','inventory.count','inventory.reports','procurement.view','procurement.po_receive']),
    manager:new Set(['customers.view','customers.create','customers.edit','sales_orders.view','sales_orders.create','sales_orders.edit','sales_orders.print','sales_orders.export','sales.view_all','tracking.view','tracking.edit','payments.view','payments.create','payments.edit','returns.view','returns.create','returns.edit','products.view','products.sales_price_view','inventory.view','inventory.reports','reports.view','reports.export','finance.ar_view','approvals.view','approvals.manage','sales_access.manage']),
    admin:new Set(AREAS.flatMap(a=>a.activities.map(x=>x.key)).filter(k=>!['users.manage','products.tax_manage','activity_logs.view'].includes(k))),
    super_admin:new Set(AREAS.flatMap(a=>a.activities.map(x=>x.key)))
  };

  const ROLE_LABELS={
    sales:'Sales',
    accountant:'Accountant',
    stock_controller:'Stock Controller',
    manager:'Manager',
    admin:'Admin',
    super_admin:'Super Admin'
  };

  function escText(v){
    if(typeof esc==='function')return esc(v==null?'':String(v));
    return String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  }
  function currentRole(){return String((typeof state!=='undefined'&&state.profile&&state.profile.role)||'')}
  function isSuperAdmin(){return currentRole()==='super_admin'}
  function legacyPermission(key){
    if(currentRole()==='super_admin')return true;
    return !!ROLE_FALLBACK[currentRole()]?.has(key);
  }

  window.hasAppPermission=function(key){
    if(currentRole()==='super_admin')return true;
    if(A.loaded)return !!A.permissions?.[key];
    return legacyPermission(key);
  };

  window.canAccessAppPage=function(page){
    if(page==='dashboard')return true;
    if(page==='users')return isSuperAdmin();
    const p=PAGE_PERMISSIONS[page];
    return p?window.hasAppPermission(p):true;
  };

  async function loadMyAccess(force=false){
    if(A.loading)return;
    if(A.loaded&&!force)return;
    if(typeof db==='undefined'||typeof state==='undefined'||!state.user||!state.profile)return;
    A.loading=true;
    try{
      const r=await db.rpc('get_my_effective_access');
      if(r.error)throw r.error;
      const d=r.data||{};
      A.permissions=d.permissions||{};
      A.restrictAssigned=!!d.restrict_assigned_customers;
      A.roleKey=d.role_key||currentRole();
      A.roleName=d.role_name||ROLE_LABELS[A.roleKey]||A.roleKey;
      A.hasCustom=!!d.has_custom_override;
      A.loaded=true;
      try{if(typeof renderNav==='function')renderNav()}catch(_){}
      if(state.page&&!window.canAccessAppPage(state.page)){
        setTimeout(()=>{try{go('dashboard')}catch(_){}},0);
      }
    }catch(err){
      console.warn('Granular access could not be loaded:',err);
    }finally{A.loading=false}
  }
  window.reloadMyAccess=()=>loadMyAccess(true);

  const oldNavItems=window.navItems;
  if(typeof oldNavItems==='function'){
    window.navItems=function(){
      const items=oldNavItems.apply(this,arguments)||[];
      if(!A.loaded)return items;
      return items.filter(item=>window.canAccessAppPage(item[0]));
    };
  }

  const oldGo=window.go;
  if(typeof oldGo==='function'){
    window.go=async function(page){
      if(A.loaded&&!window.canAccessAppPage(page)){
        showToast('You do not have access to this area.','err');
        if(page!=='dashboard')return oldGo('dashboard');
        return;
      }
      return oldGo.apply(this,arguments);
    };
  }

  function enabledCount(perms){
    return AREAS.flatMap(a=>a.activities).filter(x=>!!perms?.[x.key]).length;
  }
  function roleByKey(key){
    return (A.adminSnapshot?.roles||[]).find(r=>r.role_key===key)||null;
  }
  function overrideByUser(id){
    return (A.adminSnapshot?.overrides||[]).find(o=>String(o.user_id)===String(id))||null;
  }
  function userById(id){return (A.users||[]).find(u=>String(u.user_id)===String(id))||null}

  async function loadAdminData(){
    if(!isSuperAdmin())throw new Error('Super Admin only');
    const [users,snapshot]=await Promise.all([
      db.from('app_users').select('*').order('display_name'),
      db.rpc('get_access_admin_snapshot')
    ]);
    if(users.error)throw users.error;
    if(snapshot.error)throw snapshot.error;
    A.users=users.data||[];
    A.adminSnapshot=snapshot.data||{roles:[],overrides:[],audit:[]};
    window._usersAccessRows=A.users;
  }

  function userAccessStatus(u){
    const o=overrideByUser(u.user_id);
    if(u.role==='super_admin')return '<span class="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[9px] font-bold">PROTECTED FULL ACCESS</span>';
    return o
      ?'<span class="px-2 py-1 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[9px] font-bold">CUSTOM ACCESS</span>'
      :'<span class="px-2 py-1 rounded-lg border bg-gray-50 text-gray-500 text-[9px] font-bold">ROLE DEFAULTS</span>';
  }

  function roleOptions(current){
    const roles=A.adminSnapshot?.roles||[];
    return roles.map(r=>'<option value="'+escText(r.role_key)+'" '+(r.role_key===current?'selected':'')+'>'+escText(r.display_name||ROLE_LABELS[r.role_key]||r.role_key)+'</option>').join('');
  }

  function usersTabHtml(){
    return '<div class="card rounded-2xl overflow-hidden"><div class="divide-y">'+
      (A.users.length?A.users.map(u=>{
        const role=roleByKey(u.role);
        const o=overrideByUser(u.user_id);
        return '<div class="p-4 grid xl:grid-cols-[1.15fr_180px_160px_auto] gap-3 items-center">'+
          '<div><div class="font-semibold">'+escText(u.display_name||u.email||u.user_id)+'</div><div class="text-xs text-gray-400">'+escText(u.email||'')+'</div><div class="mt-2 flex flex-wrap gap-2 items-center">'+userAccessStatus(u)+(o?'<span class="text-[9px] text-gray-400">Overrides '+Object.keys(o.permissions||{}).length+' activities</span>':'')+'</div></div>'+
          '<div><div class="text-[9px] uppercase font-bold text-gray-400 mb-1">Role Template</div><select onchange="updateUserRoleSafe(\''+u.user_id+'\',this.value)" class="w-full border rounded-lg px-3 py-2 text-sm bg-white">'+roleOptions(u.role)+'</select><div class="text-[9px] text-gray-400 mt-1">'+escText(role?.display_name||ROLE_LABELS[u.role]||u.role)+'</div></div>'+
          '<button onclick="toggleUserActive(\''+u.user_id+'\','+(u.active?'false':'true')+')" class="px-3 py-2 rounded-lg text-xs font-semibold border '+(u.active?'text-green-700 bg-green-50 border-green-200':'text-gray-600 bg-gray-50 border-gray-200')+'">'+(u.active?'Active':'Inactive')+'</button>'+
          '<div class="flex flex-wrap justify-end gap-2">'+
            (u.role!=='super_admin'?'<button onclick="openUserPermissionBuilder(\''+u.user_id+'\')" class="px-3 py-2 rounded-lg text-xs font-semibold border border-blue-200 bg-blue-50 text-blue-700">Permissions</button>':'')+
            '<button onclick="openEditAppUser(\''+u.user_id+'\')" class="px-3 py-2 rounded-lg text-xs font-semibold border bg-white text-gray-700">Edit User</button>'+
            (u.user_id!==state.user.id?'<button onclick="openResetAppUserPassword(\''+u.user_id+'\')" class="px-3 py-2 rounded-lg text-xs font-semibold border border-amber-200 bg-amber-50 text-amber-800">Reset Password</button>':'')+
            '<button '+(u.user_id===state.user.id?'disabled':'')+' onclick="deleteAppUser(\''+u.user_id+'\',\''+escText(u.display_name||u.email||'this user').replace(/'/g,'&#39;')+'\')" class="px-3 py-2 rounded-lg text-xs font-semibold border text-red-600 border-red-200 disabled:opacity-30">Delete</button>'+
          '</div>'+
        '</div>';
      }).join(''):(typeof empty==='function'?empty('No users found.'):'<div class="p-8 text-center text-gray-400">No users found.</div>'))+
    '</div></div>';
  }

  function rolesTabHtml(){
    const counts={};
    A.users.forEach(u=>counts[u.role]=(counts[u.role]||0)+1);
    return '<div class="grid md:grid-cols-2 xl:grid-cols-3 gap-4">'+(A.adminSnapshot?.roles||[]).map(r=>{
      const cnt=enabledCount(r.permissions||{});
      const protectedRole=r.role_key==='super_admin';
      return '<div class="card rounded-2xl p-5">'+
        '<div class="flex justify-between gap-3"><div><div class="font-bold">'+escText(r.display_name||r.role_key)+'</div><div class="text-[10px] text-gray-400 mt-1">'+escText(r.role_key)+' · '+(counts[r.role_key]||0)+' user'+((counts[r.role_key]||0)===1?'':'s')+'</div></div>'+
        (protectedRole?'<span class="h-fit px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-[9px] font-bold">PROTECTED</span>':'')+'</div>'+
        '<div class="grid grid-cols-2 gap-2 mt-4"><div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Activities</div><div class="text-xl font-black mt-1">'+cnt+'</div></div><div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Sales Scope</div><div class="text-xs font-bold mt-2">'+(r.restrict_assigned_customers?'Assigned only':'All allowed')+'</div></div></div>'+
        '<button '+(protectedRole?'disabled':'')+' onclick="openRolePermissionBuilder(\''+escText(r.role_key)+'\')" class="mt-4 w-full px-3 py-2.5 rounded-xl border text-xs font-semibold '+(protectedRole?'opacity-40':'bg-white hover:bg-gray-50')+'">'+(protectedRole?'Super Admin always has full access':'Edit Role Permissions')+'</button>'+
      '</div>';
    }).join('')+'</div>';
  }

  function auditTabHtml(){
    const audit=A.adminSnapshot?.audit||[];
    return '<div class="card rounded-2xl overflow-hidden"><div class="divide-y">'+(audit.length?audit.map(x=>{
      const actor=userById(x.changed_by);
      return '<div class="p-4 grid md:grid-cols-[160px_1fr_220px] gap-3 items-center"><div><span class="px-2 py-1 rounded-lg border text-[9px] font-bold">'+escText(String(x.target_type||'').toUpperCase())+'</span><div class="text-[10px] text-gray-400 mt-2">'+escText(x.target_key||'')+'</div></div><div class="text-xs"><b>Access configuration changed</b><div class="text-[10px] text-gray-400 mt-1">By '+escText(actor?.display_name||actor?.email||'Super Admin')+'</div></div><div class="text-[10px] text-gray-400 text-right">'+escText(x.changed_at?new Date(x.changed_at).toLocaleString():'')+'</div></div>';
    }).join(''):'<div class="p-10 text-center text-sm text-gray-400">No permission changes recorded yet.</div>')+'</div></div>';
  }

  window.setUsersAccessTab=async function(tab){
    A.adminTab=['users','roles','audit'].includes(tab)?tab:'users';
    await renderUsers();
  };

  window.renderUsers=async function(){
    if(!isSuperAdmin())throw new Error('Super Admin only');
    await loadAdminData();
    const tab=A.adminTab||'users';
    document.getElementById('content').innerHTML=
      '<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3 mb-4">'+
        '<div><h3 class="font-bold text-lg">Users & Access</h3><p class="text-xs text-gray-400 mt-1">Role templates provide defaults. Give individual users custom access only when they need exceptions.</p></div>'+
        '<div class="flex flex-wrap gap-2"><button onclick="openCreateUser()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Add User</button></div>'+
      '</div>'+
      '<div class="mb-4 flex flex-wrap gap-2">'+
        '<button onclick="setUsersAccessTab(\'users\')" class="px-4 py-2 rounded-xl border text-xs font-semibold '+(tab==='users'?'bg-[#211d18] text-white border-[#211d18]':'bg-white')+'">Users</button>'+
        '<button onclick="setUsersAccessTab(\'roles\')" class="px-4 py-2 rounded-xl border text-xs font-semibold '+(tab==='roles'?'bg-[#211d18] text-white border-[#211d18]':'bg-white')+'">Role Templates</button>'+
        '<button onclick="setUsersAccessTab(\'audit\')" class="px-4 py-2 rounded-xl border text-xs font-semibold '+(tab==='audit'?'bg-[#211d18] text-white border-[#211d18]':'bg-white')+'">Access Log</button>'+
      '</div>'+
      '<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 mb-4"><b>Flexible access:</b> edit a role once to update its members. Users with <b>Custom Access</b> keep only their specific overrides; all other permissions continue to inherit from the role.</div>'+
      (tab==='roles'?rolesTabHtml():tab==='audit'?auditTabHtml():usersTabHtml());
  };

  function areaFor(id){return AREAS.find(a=>a.id===id)||AREAS[0]}
  function mutableActivities(area){
    return area.activities.filter(x=>!x.protected);
  }
  function areaLevel(area,perms){
    const acts=mutableActivities(area);
    if(!acts.length)return 'none';
    const enabled=acts.filter(x=>!!perms[x.key]).length;
    if(enabled===0)return 'none';
    if(enabled===acts.length)return 'full';
    return 'partial';
  }
  function levelLabel(area,perms){
    const l=areaLevel(area,perms);
    return l==='full'?'Full':l==='partial'?'Partial':'None';
  }

  function filteredAreas(){
    const q=String(A.builder?.search||'').trim().toLowerCase();
    if(!q)return AREAS;
    return AREAS.filter(a=>
      a.label.toLowerCase().includes(q)||
      a.activities.some(x=>x.label.toLowerCase().includes(q)||x.description.toLowerCase().includes(q))
    );
  }

  function builderTitle(){
    const b=A.builder;
    if(b.type==='role')return 'Role permissions';
    return 'User permissions';
  }

  function renderPermissionBuilder(){
    const b=A.builder;if(!b)return;
    const area=areaFor(b.areaId);
    const areas=filteredAreas();
    const perms=b.workPermissions||{};
    const level=areaLevel(area,perms);
    const enabled=AREAS.flatMap(a=>a.activities).filter(x=>!!perms[x.key]).length;
    const targetName=b.type==='role'
      ?(b.displayName||ROLE_LABELS[b.roleKey]||b.roleKey)
      :(b.user?.display_name||b.user?.email||'User');

    document.getElementById('modalTitle').textContent=builderTitle();
    document.getElementById('modalBody').innerHTML=
      '<div class="space-y-4">'+
        '<div><div class="font-bold text-lg">'+escText(targetName)+'</div><div class="text-xs text-gray-500 mt-1">'+(b.type==='role'?'Choose access by business area and activity. Changes apply to members using this role unless they have a custom override.':'This user inherits '+escText(b.roleName)+' defaults. Saving stores only the differences from the role.')+'</div></div>'+
        (b.type==='role'?'<div><label class="text-xs font-semibold text-gray-600">Role name</label><input id="accessRoleName" value="'+escText(b.displayName||'')+'" oninput="granularAccessState.builder.displayName=this.value" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>':'')+
        '<label class="flex items-center gap-2 text-sm"><input type="checkbox" '+(b.restrictAssigned?'checked':'')+' onchange="granularAccessState.builder.restrictAssigned=this.checked"><span>Restrict sales records to assigned / owned customers</span></label>'+
        '<div class="rounded-2xl border overflow-hidden">'+
          '<div class="p-4 border-b flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div><div class="font-bold">Area & activity access</div><div class="text-xs text-gray-500 mt-1">Choose an area, then set its allowed activities.</div></div><div class="text-xs text-gray-500">'+enabled+' activities enabled</div><input value="'+escText(b.search||'')+'" oninput="setAccessBuilderSearch(this.value)" placeholder="Find an area or activity…" class="border rounded-xl px-3 py-2 text-xs w-full md:w-64"></div>'+
          '<div class="grid lg:grid-cols-[320px_1fr] min-h-[430px]">'+
            '<div class="border-r bg-gray-50 p-2 max-h-[58vh] overflow-auto">'+
              (areas.length?areas.map(a=>'<button onclick="selectAccessBuilderArea(\''+a.id+'\')" class="w-full flex items-center gap-2 px-3 py-3 rounded-xl text-left text-sm '+(a.id===area.id?'bg-white border shadow-sm':'hover:bg-white')+'"><span class="w-5 text-center">'+a.icon+'</span><span class="flex-1">'+escText(a.label)+'</span><span class="text-[10px] text-gray-500">'+levelLabel(a,perms)+'</span></button>').join(''):'<div class="p-6 text-center text-xs text-gray-400">No matching areas.</div>')+
            '</div>'+
            '<div class="p-5 max-h-[58vh] overflow-auto">'+
              '<div class="flex flex-wrap items-start justify-between gap-3"><div><div class="font-bold">'+escText(area.label)+'</div><div class="text-xs text-gray-500 mt-1">Set the access level or choose individual activities.</div></div><div class="text-[10px] text-gray-400">'+area.activities.filter(x=>!!perms[x.key]).length+' / '+area.activities.length+' enabled</div></div>'+
              '<div class="mt-4"><div class="text-xs font-semibold mb-2">Access level</div><div class="flex flex-wrap gap-2">'+
                ['none','full','partial'].map(x=>'<button onclick="setAccessBuilderAreaLevel(\''+area.id+'\',\''+x+'\')" class="px-4 py-2.5 rounded-xl border text-xs font-semibold '+(level===x?'border-blue-600 bg-blue-50 text-blue-800':'bg-white')+'">'+(x==='none'?'None':x==='full'?'Full':'Partial')+'</button>').join('')+
              '</div></div>'+
              '<div class="mt-4 text-xs text-gray-500">Full enables every editable activity in this area. Partial lets you choose individual activities. Protected Super Admin controls stay locked.</div>'+
              '<button onclick="setAccessBuilderViewOnly(\''+area.id+'\')" class="mt-4 px-3 py-2 rounded-xl border border-amber-300 bg-amber-50 text-amber-800 text-xs font-semibold">View only in this area</button>'+
              '<div class="mt-5 divide-y">'+area.activities.map(x=>{
                const locked=!!x.protected;
                return '<label class="py-3 flex gap-3 '+(locked?'opacity-60':'cursor-pointer')+'"><input type="checkbox" '+(perms[x.key]?'checked':'')+' '+(locked?'disabled':'')+' onchange="setAccessBuilderPermission(\''+x.key+'\',this.checked)" class="mt-1"><span><span class="text-sm font-medium">'+escText(x.label)+(locked?' <span class="text-[9px] text-amber-700">PROTECTED</span>':'')+'</span><span class="block text-[10px] text-gray-500 mt-1">'+escText(x.description)+'</span></span></label>';
              }).join('')+'</div>'+
            '</div>'+
          '</div>'+
        '</div>'+
        '<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">'+
          '<div class="text-[10px] text-gray-400">'+(b.type==='user'&&b.hasExistingOverride?'This user currently has custom access. Reset to role defaults if the exception is no longer needed.':'')+'</div>'+
          '<div class="flex flex-wrap justify-end gap-2">'+
            (b.type==='user'&&b.hasExistingOverride?'<button type="button" onclick="resetUserAccessToRole()" class="px-4 py-2.5 rounded-xl border border-red-200 text-red-600 text-xs font-semibold">Reset to Role Defaults</button>':'')+
            '<button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl border text-xs font-semibold">Cancel</button>'+
            '<button type="button" onclick="saveAccessPermissionBuilder()" class="px-4 py-2.5 rounded-xl bg-[#17324d] text-white text-xs font-semibold">Save & Continue</button>'+
          '</div>'+
        '</div>'+
      '</div>';
  }

  window.setAccessBuilderSearch=function(v){if(!A.builder)return;A.builder.search=v||'';renderPermissionBuilder()};
  window.selectAccessBuilderArea=function(id){if(!A.builder)return;A.builder.areaId=id;renderPermissionBuilder()};
  window.setAccessBuilderPermission=function(key,value){if(!A.builder)return;A.builder.workPermissions[key]=!!value;renderPermissionBuilder()};
  window.setAccessBuilderAreaLevel=function(id,level){
    if(!A.builder)return;
    const area=areaFor(id);
    const acts=mutableActivities(area);
    if(level==='full')acts.forEach(x=>A.builder.workPermissions[x.key]=true);
    else if(level==='none')acts.forEach(x=>A.builder.workPermissions[x.key]=false);
    else if(level==='partial'){
      const current=areaLevel(area,A.builder.workPermissions);
      if(current==='none')acts.filter(x=>x.view).forEach(x=>A.builder.workPermissions[x.key]=true);
      else if(current==='full'){
        const firstNonView=acts.find(x=>!x.view);
        if(firstNonView)A.builder.workPermissions[firstNonView.key]=false;
      }
    }
    renderPermissionBuilder();
  };
  window.setAccessBuilderViewOnly=function(id){
    if(!A.builder)return;
    const area=areaFor(id);
    mutableActivities(area).forEach(x=>A.builder.workPermissions[x.key]=!!x.view);
    renderPermissionBuilder();
  };

  function widenAccessModal(){
    const shell=document.querySelector('#modal > div');
    if(shell){shell.dataset.oldMaxWidth=shell.style.maxWidth||'';shell.style.maxWidth='1180px'}
  }
  const previousCloseModal=window.closeModal;
  if(typeof previousCloseModal==='function'){
    window.closeModal=function(){
      const shell=document.querySelector('#modal > div');
      if(shell&&shell.dataset.oldMaxWidth!==undefined){
        shell.style.maxWidth=shell.dataset.oldMaxWidth;
        delete shell.dataset.oldMaxWidth;
      }
      A.builder=null;
      return previousCloseModal.apply(this,arguments);
    };
  }

  window.openRolePermissionBuilder=function(roleKey){
    if(!isSuperAdmin())return showToast('Super Admin only','err');
    const role=roleByKey(roleKey);
    if(!role)return showToast('Role template not found.','err');
    if(roleKey==='super_admin')return showToast('Super Admin permissions are protected and always full.','err');
    A.builder={
      type:'role',roleKey,
      displayName:role.display_name||ROLE_LABELS[roleKey]||roleKey,
      workPermissions:{...(role.permissions||{})},
      restrictAssigned:!!role.restrict_assigned_customers,
      areaId:'customers',search:''
    };
    openModal('Role permissions','');
    widenAccessModal();
    renderPermissionBuilder();
  };

  window.openUserPermissionBuilder=function(userId){
    if(!isSuperAdmin())return showToast('Super Admin only','err');
    const u=userById(userId);
    if(!u)return showToast('User not found.','err');
    if(u.role==='super_admin')return showToast('Super Admin permissions are protected.','err');
    const role=roleByKey(u.role);
    if(!role)return showToast('Role template not found.','err');
    const ov=overrideByUser(userId);
    const base={...(role.permissions||{})};
    const effective={...base,...(ov?.permissions||{})};
    A.builder={
      type:'user',userId,user:u,roleKey:u.role,roleName:role.display_name||ROLE_LABELS[u.role]||u.role,
      basePermissions:base,
      workPermissions:effective,
      baseRestrict:!!role.restrict_assigned_customers,
      restrictAssigned:ov?.restrict_assigned_customers==null?!!role.restrict_assigned_customers:!!ov.restrict_assigned_customers,
      hasExistingOverride:!!ov,
      areaId:'customers',search:''
    };
    openModal('User permissions','');
    widenAccessModal();
    renderPermissionBuilder();
  };

  window.saveAccessPermissionBuilder=async function(){
    if(!A.builder||!isSuperAdmin())return;
    const b=A.builder;
    try{
      if(b.type==='role'){
        const r=await db.rpc('save_access_role_template',{
          p_role_key:b.roleKey,
          p_display_name:String(b.displayName||'').trim()||ROLE_LABELS[b.roleKey]||b.roleKey,
          p_permissions:b.workPermissions||{},
          p_restrict_assigned_customers:!!b.restrictAssigned
        });
        if(r.error)throw r.error;
        closeModal();showToast('Role permissions saved.');
      }else{
        const diff={};
        const keys=new Set([...Object.keys(b.basePermissions||{}),...Object.keys(b.workPermissions||{})]);
        keys.forEach(k=>{
          if(!!b.workPermissions[k]!==!!b.basePermissions[k])diff[k]=!!b.workPermissions[k];
        });
        const restrictOverride=(!!b.restrictAssigned===!!b.baseRestrict)?null:!!b.restrictAssigned;
        if(Object.keys(diff).length===0&&restrictOverride===null){
          const r=await db.rpc('clear_user_access_override',{p_user_id:b.userId});
          if(r.error)throw r.error;
          closeModal();showToast('User now follows role defaults.');
        }else{
          const r=await db.rpc('save_user_access_override',{
            p_user_id:b.userId,
            p_permissions:diff,
            p_restrict_assigned_customers:restrictOverride
          });
          if(r.error)throw r.error;
          closeModal();showToast('Custom user access saved.');
        }
      }
      await renderUsers();
    }catch(err){showToast(err.message||'Could not save access settings.','err')}
  };

  window.resetUserAccessToRole=async function(){
    const b=A.builder;
    if(!b||b.type!=='user')return;
    if(!confirm('Reset this user to the current role defaults? Their custom access exceptions will be removed.'))return;
    const r=await db.rpc('clear_user_access_override',{p_user_id:b.userId});
    if(r.error)return showToast(r.error.message,'err');
    closeModal();showToast('User reset to role defaults.');
    await renderUsers();
  };

  // Keep Create/Edit User role dropdowns aligned with the editable role template names.
  const previousOpenCreateUser=window.openCreateUser;
  if(typeof previousOpenCreateUser==='function'){
    window.openCreateUser=function(){
      const out=previousOpenCreateUser.apply(this,arguments);
      const sel=document.getElementById('newUserRole');
      if(sel&&A.adminSnapshot?.roles?.length){
        const current=sel.value||'sales';
        sel.innerHTML=roleOptions(current);
        sel.value=current;
      }
      return out;
    };
  }

  const previousOpenEditAppUser=window.openEditAppUser;
  if(typeof previousOpenEditAppUser==='function'){
    window.openEditAppUser=function(){
      const out=previousOpenEditAppUser.apply(this,arguments);
      const sel=document.getElementById('editAppUserRole');
      if(sel&&A.adminSnapshot?.roles?.length){
        const current=sel.value;
        sel.innerHTML=roleOptions(current);
        sel.value=current;
      }
      return out;
    };
  }

  // Refresh granular access after a role change made from Users & Access.
  const previousUpdateUserRoleSafe=window.updateUserRoleSafe;
  if(typeof previousUpdateUserRoleSafe==='function'){
    window.updateUserRoleSafe=async function(){
      const out=await previousUpdateUserRoleSafe.apply(this,arguments);
      try{await loadAdminData()}catch(_){}
      return out;
    };
  }

  let tries=0;
  const boot=setInterval(()=>{
    tries++;
    try{
      if(typeof state!=='undefined'&&state.user&&state.profile){
        clearInterval(boot);
        loadMyAccess(true);
      }else if(tries>100)clearInterval(boot);
    }catch(_){if(tries>100)clearInterval(boot)}
  },100);

  // Permission changes made by Super Admin are picked up by signed-in users without requiring a new login.
  setInterval(()=>{
    try{
      if(typeof state!=='undefined'&&state.user&&state.profile&&!document.hidden)loadMyAccess(true);
    }catch(_){}
  },60000);
})();