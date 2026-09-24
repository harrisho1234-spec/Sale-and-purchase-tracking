// Unified pending approvals notification center.
(function(){
  var A={orders:[],customers:[],payments:[],loading:false};

  function role(){return state.profile&&state.profile.role||''}
  function reviewer(){return ['manager','admin','super_admin'].indexOf(role())>=0}
  function total(){return A.orders.length+A.customers.length+A.payments.length}
  function dateText(v){var d=new Date(v);return isNaN(d.getTime())?String(v||''):d.toLocaleString()}

  async function loadPending(){
    if(!reviewer()){A.orders=[];A.customers=[];A.payments=[];return}
    var res=await Promise.all([
      db.rpc('get_visible_sales_order_edit_requests',{p_status:'pending'}),
      db.rpc('get_visible_customer_change_requests',{p_status:'pending'}),
      db.rpc('get_visible_sales_payment_requests',{p_status:'pending'})
    ]);
    if(res[0].error)throw res[0].error;
    if(res[1].error)throw res[1].error;
    if(res[2].error)throw res[2].error;
    A.orders=res[0].data||[];
    A.customers=res[1].data||[];
    A.payments=res[2].data||[];
  }

  function addNavBadge(){
    if(!reviewer())return;
    var count=total();
    var buttons=[].slice.call(document.querySelectorAll('#sidebarNav button'));
    var btn=buttons.find(function(b){return String(b.getAttribute('onclick')||'').indexOf("go('approvals')")>=0});
    if(btn){
      var badge=btn.querySelector('.approval-count-badge');
      if(!badge){
        badge=document.createElement('span');
        badge.className='approval-count-badge ml-auto min-w-[22px] h-[22px] px-1.5 rounded-full bg-red-500 text-white text-[10px] font-bold inline-flex items-center justify-center';
        btn.appendChild(badge);
      }
      badge.textContent=String(count);
      badge.style.display=count?'inline-flex':'none';
    }
    var groupBadge=document.getElementById('sidebar-finance-approval-badge');
    if(groupBadge){
      groupBadge.textContent=String(count);
      groupBadge.style.display=count?'inline-flex':'none';
    }
  }

  function addHeaderButton(){
    if(!reviewer())return;
    var title=document.getElementById('pageTitle');
    var row=title&&title.closest('.h-16');
    var actions=row&&row.querySelector('.flex.items-center.gap-2');
    if(!actions)return;
    var b=document.getElementById('approvalHeaderBtn');
    if(!b){
      b=document.createElement('button');
      b.id='approvalHeaderBtn';
      b.type='button';
      b.className='px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-800 text-xs font-semibold whitespace-nowrap';
      b.onclick=function(){go('approvals')};
      actions.insertBefore(b,actions.firstElementChild);
    }
    var count=total();
    b.innerHTML=count
      ? 'Approvals <span class="ml-1 inline-flex min-w-[20px] h-[20px] px-1 rounded-full bg-red-500 text-white items-center justify-center text-[9px]">'+count+'</span>'
      : 'Approvals';
  }

  function dashboardCard(){
    if(!reviewer()||state.page!=='dashboard')return;
    var root=document.getElementById('content');
    if(!root)return;
    var old=root.querySelector('[data-approval-dashboard]');
    if(old)old.remove();

    var count=total();
    var box=document.createElement('div');
    box.setAttribute('data-approval-dashboard','1');
    box.className='mb-5 rounded-2xl border '+(count?'border-amber-200 bg-amber-50':'border-gray-200 bg-white')+' p-5 shadow-sm';
    box.innerHTML=
      '<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">'
      +'<div><div class="flex items-center gap-2"><h3 class="text-lg font-bold">Pending Approvals</h3>'
      +(count?'<span class="inline-flex min-w-[28px] h-[28px] px-2 rounded-full bg-red-500 text-white items-center justify-center text-xs font-bold">'+count+'</span>':'')
      +'</div><p class="text-xs text-gray-500 mt-1">'+(count?'Sales requests are waiting for review.':'No Sales requests are waiting for review.')+'</p></div>'
      +'<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:min-w-[650px]">'
      +'<button onclick="go(\'approvals\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">All Pending</div><div class="text-2xl font-bold mt-1">'+count+'</div></button>'
      +'<button onclick="openApprovalCenter(\'orders\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Order Edits</div><div class="text-2xl font-bold mt-1">'+A.orders.length+'</div></button>'
      +'<button onclick="openApprovalCenter(\'customers\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Customers</div><div class="text-2xl font-bold mt-1">'+A.customers.length+'</div></button>'
      +'<button onclick="openApprovalCenter(\'payments\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Payments</div><div class="text-2xl font-bold mt-1">'+A.payments.length+'</div></button>'
      +'</div></div>';
    root.insertBefore(box,root.firstChild);
  }

  async function refresh(){
    if(!reviewer()||A.loading)return;
    A.loading=true;
    try{
      await loadPending();
      addNavBadge();
      addHeaderButton();
      dashboardCard();
    }catch(e){
      console.warn('Approval notifications:',e.message);
    }finally{
      A.loading=false;
    }
  }
  window.refreshApprovalNotifications=refresh;

  var oldNavItems=window.navItems;
  if(typeof oldNavItems==='function'){
    window.navItems=function(){
      var items=oldNavItems.apply(this,arguments);
      if(!reviewer()||items.some(function(x){return x[0]==='approvals'}))return items;
      var copy=items.slice();
      var i=copy.findIndex(function(x){return x[0]==='dashboard'});
      copy.splice(i>=0?i+1:0,0,['approvals','Approvals','✓']);
      return copy;
    };
  }

  var oldRenderNav=window.renderNav;
  if(typeof oldRenderNav==='function'){
    window.renderNav=function(){
      var out=oldRenderNav.apply(this,arguments);
      if(reviewer()){
        addNavBadge();
        addHeaderButton();
        setTimeout(refresh,20);
      }
      return out;
    };
  }

  function requestHtml(r,type){
    var order=type==='order',payment=type==='payment';
    var title=order?(r.document_no||'Order Edit'):payment?(r.document_no||'Payment'):(r.customer_name||'Customer');
    var subtitle=order
      ?((r.customer_name||'Customer')+' · '+(r.sales_rep_name||'Sales Rep'))
      :payment
        ?((r.customer_name||'Customer')+' · '+money(r.amount,r.currency||'USD'))
        :(r.request_type==='create'?'New Customer':'Customer Change');
    var click=order
      ? "openSalesEditRequestDetail('"+r.request_id+"')"
      :payment
        ? "openSalesPaymentRequestDetail('"+r.request_id+"')"
        : "openCustomerRequestDetail('"+r.request_id+"')";
    var badgeClass=order?'bg-blue-50 text-blue-700':payment?'bg-purple-50 text-purple-700':'bg-green-50 text-green-700';
    var badgeText=order?'ORDER EDIT':payment?'PAYMENT':'CUSTOMER';
    var detail=payment
      ?((r.method||'Payment')+(r.reference_no?' · '+r.reference_no:''))
      :(r.request_note||'No request note');

    return '<button type="button" onclick="'+click+'" class="w-full text-left rounded-xl border bg-white p-4 hover:bg-amber-50/40">'
      +'<div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">'
      +'<div class="min-w-0"><div class="flex flex-wrap items-center gap-2">'
      +'<span class="px-2 py-1 rounded-md text-[9px] font-bold '+badgeClass+'">'+badgeText+'</span>'
      +'<b>'+esc(title)+'</b></div><div class="text-xs text-gray-500 mt-1">'+esc(subtitle)+'</div>'
      +'<div class="text-xs text-gray-700 mt-2">'+esc(detail)+'</div></div>'
      +'<div class="text-right shrink-0"><div class="text-[10px] text-gray-400">Requested by</div><div class="text-xs font-semibold">'+esc(r.requested_by_name||'Sales')+'</div><div class="text-[10px] text-gray-400 mt-1">'+esc(dateText(r.requested_at))+'</div></div>'
      +'</div></button>';
  }

  function rowsFor(filter){
    var rows=[];
    if(filter==='all'||filter==='orders')A.orders.forEach(function(x){rows.push({type:'order',x:x})});
    if(filter==='all'||filter==='customers')A.customers.forEach(function(x){rows.push({type:'customer',x:x})});
    if(filter==='all'||filter==='payments')A.payments.forEach(function(x){rows.push({type:'payment',x:x})});
    rows.sort(function(a,b){return new Date(b.x.requested_at)-new Date(a.x.requested_at)});
    return rows;
  }

  window.openApprovalCenter=async function(filter){
    filter=filter||'all';
    if(!reviewer())return showToast('Manager/Admin access required.','err');
    try{await loadPending()}catch(e){return showToast(e.message,'err')}
    var rows=rowsFor(filter);

    var html='<div class="space-y-4">'
      +'<div class="grid grid-cols-2 md:grid-cols-4 gap-2">'
      +'<button onclick="closeModal();openApprovalCenter(\'all\')" class="rounded-xl border px-3 py-3 '+(filter==='all'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">All</div><div class="text-xl font-bold">'+total()+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'orders\')" class="rounded-xl border px-3 py-3 '+(filter==='orders'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Order Edits</div><div class="text-xl font-bold">'+A.orders.length+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'customers\')" class="rounded-xl border px-3 py-3 '+(filter==='customers'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Customers</div><div class="text-xl font-bold">'+A.customers.length+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'payments\')" class="rounded-xl border px-3 py-3 '+(filter==='payments'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Payments</div><div class="text-xl font-bold">'+A.payments.length+'</div></button>'
      +'</div>'
      +'<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">Open a request to review it, make any final adjustment, then approve/post/publish or reject.</div>'
      +'<div class="grid gap-2 max-h-[58vh] overflow-y-auto pr-1">'
      +(rows.length?rows.map(function(r){return requestHtml(r.x,r.type)}).join(''):'<div class="rounded-xl border border-dashed p-10 text-center text-sm text-gray-400">No pending requests.</div>')
      +'</div></div>';
    openModal('Pending Approvals',html);
  };

  window.renderApprovals=async function(){
    if(!reviewer())throw new Error('Manager/Admin access required');
    await loadPending();
    var rows=rowsFor('all');

    document.getElementById('content').innerHTML=
      '<div class="space-y-5">'
      +'<div class="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">'
      +'<button onclick="openApprovalCenter(\'all\')" class="card rounded-2xl p-5 text-left border"><div class="text-[10px] uppercase font-bold text-gray-400">All Pending</div><div class="text-3xl font-bold mt-2">'+total()+'</div><div class="text-xs text-gray-400 mt-1">Awaiting review</div></button>'
      +'<button onclick="openApprovalCenter(\'orders\')" class="card rounded-2xl p-5 text-left"><div class="text-[10px] uppercase font-bold text-gray-400">Order Edit Requests</div><div class="text-3xl font-bold mt-2">'+A.orders.length+'</div><div class="text-xs text-gray-400 mt-1">Sales order corrections</div></button>'
      +'<button onclick="openApprovalCenter(\'customers\')" class="card rounded-2xl p-5 text-left"><div class="text-[10px] uppercase font-bold text-gray-400">Customer Requests</div><div class="text-3xl font-bold mt-2">'+A.customers.length+'</div><div class="text-xs text-gray-400 mt-1">New customers and changes</div></button>'
      +'<button onclick="openApprovalCenter(\'payments\')" class="card rounded-2xl p-5 text-left"><div class="text-[10px] uppercase font-bold text-gray-400">Payment Requests</div><div class="text-3xl font-bold mt-2">'+A.payments.length+'</div><div class="text-xs text-gray-400 mt-1">Deposits and payments</div></button>'
      +'</div>'
      +'<div class="card rounded-2xl p-5"><div class="flex items-center justify-between gap-3 mb-4"><div><h3 class="font-bold text-lg">Waiting for Review</h3><p class="text-xs text-gray-400">Newest first</p></div><button onclick="renderApprovals().then(refreshApprovalNotifications)" class="px-3 py-2 border rounded-lg text-xs font-semibold">Refresh</button></div>'
      +'<div class="grid gap-2">'+(rows.length?rows.map(function(r){return requestHtml(r.x,r.type)}).join(''):'<div class="rounded-xl border border-dashed p-10 text-center text-sm text-gray-400">No pending approvals.</div>')+'</div></div>'
      +'</div>';

    addNavBadge();
    addHeaderButton();
  };

  var oldGo=window.go;
  if(typeof oldGo==='function'){
    window.go=async function(page){
      if(page!=='approvals')return oldGo.apply(this,arguments);
      if(!reviewer())return oldGo('dashboard');
      state.page='approvals';
      renderNav();
      document.getElementById('pageTitle').textContent='Pending Approvals';
      document.getElementById('pageSubtitle').textContent='Review Sales requests before they become final';
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading approvals...</div>';
      try{await renderApprovals()}catch(e){document.getElementById('content').innerHTML='<div class="card rounded-xl p-5 text-red-600">Error: '+esc(e.message)+'</div>'}
    };
  }

  var oldDashboard=window.renderDashboard;
  if(typeof oldDashboard==='function'){
    window.renderDashboard=async function(){
      var out=await oldDashboard.apply(this,arguments);
      try{await loadPending();dashboardCard();addNavBadge();addHeaderButton()}catch(e){console.warn('Dashboard approvals:',e.message)}
      return out;
    };
  }

  function wrapReview(name){
    var old=window[name];
    if(typeof old!=='function')return;
    window[name]=async function(){
      var out=await old.apply(this,arguments);
      setTimeout(refresh,50);
      return out;
    };
  }
  wrapReview('reviewSalesEditRequest');
  wrapReview('reviewCustomerRequest');
  wrapReview('reviewSalesPaymentRequest');

  try{
    if(state&&state.profile&&reviewer()){
      renderNav();
      setTimeout(refresh,50);
    }
  }catch(_){}
})();