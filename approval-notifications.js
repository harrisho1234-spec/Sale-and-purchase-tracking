// Unified pending approvals notification center.
(function(){
  var A={orders:[],customers:[],payments:[],stages:[],assignments:[],conversions:[],stockActions:[],stockEdits:[],cnApprovals:[],cnFinance:[],doEdits:[],stockCountEdits:[],dailyReviews:[],loadWarnings:[],loading:false,activeType:'all'};

  function role(){return state.profile&&state.profile.role||''}
  function reviewer(){return typeof window.hasAppPermission==='function'?window.hasAppPermission('approvals.view'):['manager','admin','super_admin'].indexOf(role())>=0}
  function stockReviewer(){return typeof window.hasAppPermission==='function'?window.hasAppPermission('inventory.approve'):['admin','super_admin'].indexOf(role())>=0}
  function adminReviewer(){return ['admin','super_admin'].includes(role())}
  function cnReviewer(){return ['manager','admin','super_admin'].includes(role())&&
    (typeof window.hasAppPermission!=='function'||window.hasAppPermission('returns.approve'))}
  function stockTotal(){return A.stockActions.length+A.stockEdits.length}
  function cnTotal(){return A.cnApprovals.length+A.cnFinance.length}
  function total(){return A.orders.length+A.customers.length+A.payments.length+A.stages.length+
    A.assignments.length+A.conversions.length+stockTotal()+cnTotal()+A.doEdits.length+
    A.stockCountEdits.length+A.dailyReviews.length}
  function dateText(v){var d=new Date(v);return isNaN(d.getTime())?String(v||''):d.toLocaleString()}

  async function loadPending(){
    if(!reviewer()){A.orders=[];A.customers=[];A.payments=[];A.stages=[];A.assignments=[];A.conversions=[];A.stockActions=[];A.stockEdits=[];A.cnApprovals=[];A.cnFinance=[];A.doEdits=[];A.stockCountEdits=[];A.dailyReviews=[];A.loadWarnings=[];return}
    var stockActionPromise=stockReviewer()
      ?db.rpc('get_stock_action_requests',{p_status:'pending'})
      :Promise.resolve({data:[],error:null});
    var stockEditPromise=stockReviewer()
      ?db.from('stock_change_requests').select('id,status,requested_at').eq('status','pending').order('requested_at',{ascending:false}).limit(500)
      :Promise.resolve({data:[],error:null});
    var optional=function(p){return Promise.resolve(p).catch(function(error){return {data:[],error:error}})};
    var res=await Promise.all([
      db.rpc('get_visible_sales_order_edit_requests',{p_status:'pending'}),
      db.rpc('get_visible_customer_change_requests',{p_status:'pending'}),
      db.rpc('get_visible_sales_payment_requests',{p_status:'pending'}),
      db.rpc('get_visible_customer_lead_stage_change_requests',{p_status:'pending'}),
      db.rpc('get_pending_activity_sales_assignments'),
      db.rpc('get_pending_sr_conversion_requests'),
      stockActionPromise,
      stockEditPromise,
      cnReviewer()?optional(db.rpc('get_visible_cn_case_workflows')):Promise.resolve({data:[],error:null}),
      adminReviewer()?optional(db.rpc('get_delivery_order_edit_requests',{p_delivery_request_id:null,p_pending_only:true})):Promise.resolve({data:[],error:null}),
      adminReviewer()?optional(db.rpc('get_stock_count_edit_requests',{p_count_id:null,p_pending_only:true})):Promise.resolve({data:[],error:null}),
      typeof window.getSalesDailyApprovalQueue==='function'
        ?optional(window.getSalesDailyApprovalQueue().then(function(data){return {data:data,error:null}}))
        :Promise.resolve({data:[],error:null})
    ]);
    if(res[0].error)throw res[0].error;
    if(res[1].error)throw res[1].error;
    if(res[2].error)throw res[2].error;
    if(res[3].error)throw res[3].error;
    if(res[4].error)throw res[4].error;
    if(res[5].error)throw res[5].error;
    if(res[6].error)throw res[6].error;
    if(res[7].error)throw res[7].error;
    A.orders=res[0].data||[];
    A.customers=res[1].data||[];
    A.payments=res[2].data||[];
    A.stages=res[3].data||[];
    A.assignments=res[4].data||[];
    A.conversions=res[5].data||[];
    A.stockActions=res[6].data||[];
    A.stockEdits=res[7].data||[];
    A.loadWarnings=[];
    ['Return/CN','DO edits','Stock Count edits','Team Daily Review'].forEach(function(name,i){
      if(res[i+8].error){
        A.loadWarnings.push(name+' unavailable: '+String(res[i+8].error.message||res[i+8].error));
        console.warn('Pending '+name+':',res[i+8].error.message||res[i+8].error);
      }
    });
    var cnRows=Array.isArray(res[8].data)?res[8].data:[];
    var userId=String(state.user?.id||'');
    A.cnApprovals=cnReviewer()?cnRows.filter(function(c){
      return c.approval_status==='pending'&&String(c.requested_by)!==userId;
    }):[];
    A.cnFinance=cnReviewer()?cnRows.filter(function(c){
      return c.approval_status==='approved'&&c.stock_complete&&
        c.financial_decision==='pending'&&!c.closed_at;
    }):[];
    A.doEdits=adminReviewer()?(Array.isArray(res[9].data)?res[9].data:[]).filter(function(x){return x.status==='pending'}):[];
    A.stockCountEdits=adminReviewer()?(Array.isArray(res[10].data)?res[10].data:[]).filter(function(x){return x.status==='pending'}):[];
    A.dailyReviews=Array.isArray(res[11].data)?res[11].data:[];
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
      +'</div><p class="text-xs text-gray-500 mt-1">'+(count?'Sales and stock requests are waiting for review.':'No requests are waiting for review.')+'</p></div>'
      +'<div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3 xl:min-w-[900px]">'
      +'<button onclick="go(\'approvals\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">All Pending</div><div class="text-2xl font-bold mt-1">'+count+'</div></button>'
      +'<button onclick="openApprovalType(\'orders\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Order Edits</div><div class="text-2xl font-bold mt-1">'+A.orders.length+'</div></button>'
      +'<button onclick="openApprovalType(\'customers\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Customers</div><div class="text-2xl font-bold mt-1">'+A.customers.length+'</div></button>'
      +'<button onclick="openApprovalType(\'payments\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Payments</div><div class="text-2xl font-bold mt-1">'+A.payments.length+'</div></button>'
      +'<button onclick="openApprovalType(\'stages\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Stage Changes</div><div class="text-2xl font-bold mt-1">'+A.stages.length+'</div></button>'
      +'<button onclick="openApprovalType(\'assignments\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Sales Assignments</div><div class="text-2xl font-bold mt-1">'+A.assignments.length+'</div></button>'
      +'<button onclick="openApprovalType(\'conversions\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">TK/RK Conversions</div><div class="text-2xl font-bold mt-1">'+A.conversions.length+'</div></button>'
      +'<button onclick="openApprovalType(\'cn_approval\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">CN Approvals</div><div class="text-2xl font-bold mt-1">'+A.cnApprovals.length+'</div></button>'
      +'<button onclick="openApprovalType(\'cn_finance\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">CN Credit Decisions</div><div class="text-2xl font-bold mt-1">'+A.cnFinance.length+'</div></button>'
      +'<button onclick="openApprovalType(\'daily\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Daily Reviews</div><div class="text-2xl font-bold mt-1">'+A.dailyReviews.length+'</div></button>'
      +(adminReviewer()?'<button onclick="openApprovalType(\'do_edit\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">DO Edits</div><div class="text-2xl font-bold mt-1">'+A.doEdits.length+'</div></button>':'')
      +(adminReviewer()?'<button onclick="openApprovalType(\'stock_count_edit\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Stock Count Edits</div><div class="text-2xl font-bold mt-1">'+A.stockCountEdits.length+'</div></button>':'')
      +(stockReviewer()?'<button onclick="openApprovalType(\'stock\')" class="rounded-xl border bg-white px-4 py-3 text-left"><div class="text-[9px] uppercase font-bold text-gray-400">Stock</div><div class="text-2xl font-bold mt-1">'+stockTotal()+'</div></button>':'')
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
      renderApprovalTypePanels();
      if(typeof window.refreshAppNotifications==='function')
        window.refreshAppNotifications().catch(function(err){console.warn('Refresh approval bell:',err.message||err)});
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

  function customerRequestKind(r){
    var reason=String((r.requested_customer||{})._workflow_reason||'');
    if(reason==='ownership_claim'||reason==='ownership_claim_phone')return 'Ownership Claim';
    if(reason==='crm_ownership_claim')return 'CRM Customer Ownership Claim';
    if(reason==='activity_customer_request')return 'Showroom / Online Customer';
    if(reason==='history_customer_request')return 'Historical Showroom / Online Customer';
    if(reason==='history_customer_link')return 'Link Historical Customer';
    if(reason==='buy_conversion')return 'Buyer → Customer Master';
    return r.request_type==='create'?'New Customer':'Customer Change';
  }

  window.openStockApprovalRequests=async function(){
    if(!stockReviewer())return showToast('Admin access required.','err');
    closeModal();
    if(typeof go==='function')await go('stock-inventory');
    if(typeof setInventoryTab==='function')await setInventoryTab('requests');
  };


  // Opening a CN from Approvals reuses the existing server-authorized CN
  // workflow. The reviewer still must approve/reject or make a credit decision.
  window.openCNApprovalFromCenter=async function(id){
    if(!cnReviewer())return showToast('CN management approval permission required.','err');
    closeModal();
    await go('returns');
    var found=(window._visibleSalesReturns||[]).some(function(x){return String(x.return_id)===String(id)});
    if(!found)return showToast('CN not visible in your current Return/CN scope. Open Returns / CN or check manager context.','err');
    if(typeof window.viewSalesReturn==='function')await window.viewSalesReturn(id);
  };
  window.openDOEditApprovalFromCenter=async function(){
    if(!adminReviewer())return showToast('Admin or Super Admin required.','err');
    closeModal();
    if(typeof window.openDeliveryOrderEditQueue==='function')await window.openDeliveryOrderEditQueue();
  };
  window.openStockCountApprovalFromCenter=async function(){
    if(!adminReviewer())return showToast('Admin or Super Admin required.','err');
    closeModal();
    if(typeof window.openStockCountEditQueue==='function')await window.openStockCountEditQueue(null,true);
  };
  window.openDailyApprovalFromCenter=async function(reportId,date,personId){
    if(typeof window.openSalesDailyApprovalItem!=='function')
      return showToast('Team Daily Review is unavailable.','err');
    closeModal();
    await window.openSalesDailyApprovalItem(reportId,date,personId);
  };

  function requestHtml(r,type){
    if(type==='cn_approval'||type==='cn_finance'){
      var finance=type==='cn_finance';
      return '<button type="button" onclick="openCNApprovalFromCenter(\''+esc(r.return_id)+'\')" class="w-full text-left rounded-xl border border-amber-200 bg-white p-4 hover:bg-amber-50">'+
        '<div class="flex flex-wrap justify-between items-start gap-3"><div><div class="flex flex-wrap gap-2 items-center">'+
        '<span class="rounded-md px-2 py-1 text-[9px] font-bold '+(finance?'bg-blue-50 text-blue-700':'bg-amber-100 text-amber-800')+'">'+(finance?'CN CREDIT DECISION':'RETURN / CN APPROVAL')+'</span><b>'+esc(r.cn_no||'Credit Note')+'</b></div>'+
        '<div class="text-xs text-gray-600 mt-2">'+esc(r.customer_name||'Customer')+' · '+esc(r.action||'Return')+'</div>'+
        '<div class="text-xs text-gray-700 mt-2">'+(finance?'Stock handling complete; approve Customer Credit or close without credit.':'Approve or reject before Stock can process the return.')+'</div></div>'+
        '<div class="text-right text-xs text-gray-500">'+(finance?'Financial review':'Management review')+
        '<div class="mt-1">'+esc(dateText(r.approved_at||r.requested_at||r.created_at))+'</div><b class="text-amber-700 mt-2 block">Review →</b></div></div></button>';
    }
    if(type==='do_edit'){
      return '<button type="button" onclick="openDOEditApprovalFromCenter()" class="w-full text-left rounded-xl border p-4 hover:bg-amber-50">'+
        '<div class="flex justify-between gap-3 items-center"><div><span class="rounded-md px-2 py-1 text-[9px] font-bold bg-amber-100 text-amber-800">DO EDIT</span>'+
        '<b class="ml-2">'+esc(r.do_no||r.document_no||'Delivery Order')+'</b>'+
        '<div class="text-xs text-gray-500 mt-2">'+esc(r.customer_name||'')+' · '+esc(r.reason||'Correction requested')+'</div></div>'+
        '<b class="text-xs text-amber-700">Review →</b></div></button>';
    }
    if(type==='stock_count_edit'){
      return '<button type="button" onclick="openStockCountApprovalFromCenter()" class="w-full text-left rounded-xl border p-4 hover:bg-amber-50">'+
        '<div class="flex justify-between gap-3 items-center"><div><span class="rounded-md px-2 py-1 text-[9px] font-bold bg-amber-100 text-amber-800">STOCK COUNT EDIT</span>'+
        '<b class="ml-2">'+esc(String(r.period_month||'Stock Count').slice(0,7))+'</b>'+
        '<div class="text-xs text-gray-500 mt-2">'+esc(r.reason||'Review stock count corrections')+'</div></div>'+
        '<b class="text-xs text-amber-700">Review →</b></div></button>';
    }
    if(type==='daily'){
      return '<button type="button" onclick="openDailyApprovalFromCenter(\''+esc(r.report_id)+'\',\''+esc(r.date)+'\',\''+esc(r.userId||'')+'\')" class="w-full text-left rounded-xl border p-4 hover:bg-amber-50">'+
        '<div class="flex justify-between gap-3 items-center"><div>'+
        '<span class="rounded-md px-2 py-1 text-[9px] font-bold bg-blue-50 text-blue-700">'+(r.kind==='edit'?'DAILY EDIT REQUEST':'DAILY RESULT REVIEW')+'</span>'+
        '<b class="ml-2">'+esc(r.salesperson||'Sales')+'</b>'+
        '<div class="text-xs text-gray-500 mt-2">'+esc(r.date||'')+' · '+esc(r.kind==='edit'?(r.section||'')+' · '+(r.reason||'Correction request'):'Evening Result submitted')+'</div></div>'+
        '<b class="text-xs text-amber-700">Review →</b></div></button>';
    }
    if(type==='conversion'){
      return '<button type="button" onclick="openSrConversionApproval(\''+esc(r.request_id)+'\')" class="w-full text-left rounded-xl border border-amber-200 bg-white p-4 hover:bg-amber-50">'
      +'<div class="flex flex-wrap justify-between items-center gap-3"><div><div class="flex gap-2 items-center"><span class="rounded-md px-2 py-1 text-[9px] bg-amber-100 text-amber-800 font-bold">TK/RK CONVERSION</span><b>'+esc(r.sr_no||'SR')+'</b></div>'
      +'<div class="text-xs mt-2 text-gray-600">'+esc(r.customer_name||'Customer')+' · '+esc(r.sales_rep_name||'Sales')+'</div>'
      +'<div class="text-xs mt-2"><b>'+esc(r.invoice_type||'TK')+' · '+esc(r.invoice_no||'')+'</b> · '+esc(r.sales_category==='project'?'Project (PJ)':'Standard')+'</div></div>'
      +'<div class="text-right text-xs text-gray-500">Requested by '+esc(r.requested_by_name||'Sales')+'<div class="mt-1">'+esc(dateText(r.requested_at))+'</div><b class="text-amber-700 mt-2 block">Review →</b></div></div></button>';
    }
    if(type==='assignment'){
      return '<button type="button" onclick="openActivitySalesAssignmentApproval(\''+esc(r.request_id)+'\')" class="w-full text-left rounded-xl border border-amber-200 bg-amber-50/40 p-4 hover:bg-amber-50">'
        +'<div class="flex items-center justify-between flex-wrap gap-3"><div><div class="flex gap-2 items-center"><span class="px-2 py-1 rounded text-[9px] bg-amber-100 font-bold text-amber-800">SALES ASSIGNMENT</span><b>'+esc(r.customer_name||'Customer')+'</b></div>'
        +'<div class="text-xs text-gray-500 mt-2">'+esc(r.activity_type==='online'?'Online':'Showroom Visit')+' · '+esc(r.business_code||'')+'</div>'
        +'<div class="text-xs mt-2">'+esc(r.from_sales_name||'Unassigned')+' → <b>'+esc(r.to_sales_name||'Sales Rep')+'</b></div>'
        +'</div><div class="text-right text-xs text-gray-500">Requested by <b>'+esc(r.requested_by_name||'Sales')+'</b><div class="mt-1">'+esc(dateText(r.requested_at))+'</div><div class="text-amber-700 mt-2 font-semibold">Review →</div></div></div></button>';
    }
    if(type==='stock'){
      return '<button type="button" onclick="openStockApprovalRequests()" class="w-full text-left rounded-xl border border-amber-200 bg-amber-50/40 p-4 hover:bg-amber-50">'
        +'<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3">'
        +'<div><div class="flex flex-wrap items-center gap-2"><span class="px-2 py-1 rounded-md text-[9px] font-bold bg-amber-100 text-amber-800">STOCK</span><b>Stock & Inventory Approvals</b></div>'
        +'<div class="text-xs text-gray-500 mt-1">'+stockTotal()+' pending stock request'+(stockTotal()===1?'':'s')+'</div>'
        +'<div class="text-xs text-gray-700 mt-2">Open Stock & Inventory → Approvals / Requests to review full product details and approve or reject.</div></div>'
        +'<span class="text-xs font-semibold text-amber-700">Open →</span>'
        +'</div></button>';
    }
    var order=type==='order',payment=type==='payment',stage=type==='stage';
    var title=order
      ?(r.document_no||'Order Edit')
      :payment
        ?(r.document_no||'Payment')
        :stage
          ?(r.customer_name||'Customer')
          :(r.customer_name||'Customer');
    var subtitle=order
      ?((r.customer_name||'Customer')+' · '+(r.sales_rep_name||'Sales Rep'))
      :payment
        ?((r.customer_name||'Customer')+' · '+money(r.amount,r.currency||'USD'))
        :stage
          ?((r.sales_rep_name||'Sales Rep')+' · '+(r.from_stage||'-')+' → '+(r.to_stage||'-'))
          :customerRequestKind(r);
    var click=order
      ? "openSalesEditRequestDetail('"+r.request_id+"')"
      :payment
        ? "openSalesPaymentRequestDetail('"+r.request_id+"')"
        :stage
          ? "openCustomerStageChangeRequestDetail('"+r.request_id+"')"
          : "openCustomerRequestDetail('"+r.request_id+"')";
    var badgeClass=order
      ?'bg-blue-50 text-blue-700'
      :payment
        ?'bg-purple-50 text-purple-700'
        :stage
          ?'bg-amber-50 text-amber-700'
          :'bg-green-50 text-green-700';
    var badgeText=order?'ORDER EDIT':payment?'PAYMENT':stage?'STAGE CORRECTION':((r.requested_customer||{})._workflow_reason==='ownership_claim'?'CUSTOMER CLAIM':'CUSTOMER');
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
    if(filter==='all'||filter==='stages')A.stages.forEach(function(x){rows.push({type:'stage',x:x})});
    if(filter==='all'||filter==='assignments')A.assignments.forEach(function(x){rows.push({type:'assignment',x:x})});
    if(filter==='all'||filter==='conversions')A.conversions.forEach(function(x){rows.push({type:'conversion',x:x})});
    if(filter==='all'||filter==='cn_approval')A.cnApprovals.forEach(function(x){rows.push({type:'cn_approval',x:x})});
    if(filter==='all'||filter==='cn_finance')A.cnFinance.forEach(function(x){rows.push({type:'cn_finance',x:x})});
    if(filter==='all'||filter==='do_edit')A.doEdits.forEach(function(x){rows.push({type:'do_edit',x:x})});
    if(filter==='all'||filter==='stock_count_edit')A.stockCountEdits.forEach(function(x){rows.push({type:'stock_count_edit',x:x})});
    if(filter==='all'||filter==='daily')A.dailyReviews.forEach(function(x){rows.push({type:'daily',x:x})});
    if((filter==='all'||filter==='stock')&&stockReviewer()&&stockTotal()>0){
      var latest=([].concat(A.stockActions||[],A.stockEdits||[]).sort(function(a,b){return new Date(b.requested_at)-new Date(a.requested_at)})[0]||{});
      rows.push({type:'stock',x:{requested_at:latest.requested_at||new Date().toISOString()}});
    }
    rows.sort(function(a,b){return (Date.parse(b.x.requested_at||b.x.created_at||b.x.approved_at)||0)-(Date.parse(a.x.requested_at||a.x.created_at||a.x.approved_at)||0)});
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
      +'<button onclick="closeModal();openApprovalCenter(\'stages\')" class="rounded-xl border px-3 py-3 '+(filter==='stages'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Stage Changes</div><div class="text-xl font-bold">'+A.stages.length+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'assignments\')" class="rounded-xl border px-3 py-3 '+(filter==='assignments'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Assignments</div><div class="text-xl font-bold">'+A.assignments.length+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'conversions\')" class="rounded-xl border px-3 py-3 '+(filter==='conversions'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">TK/RK</div><div class="text-xl font-bold">'+A.conversions.length+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'cn_approval\')" class="rounded-xl border px-3 py-3 '+(filter==='cn_approval'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">CN Approval</div><div class="text-xl font-bold">'+A.cnApprovals.length+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'cn_finance\')" class="rounded-xl border px-3 py-3 '+(filter==='cn_finance'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">CN Credit</div><div class="text-xl font-bold">'+A.cnFinance.length+'</div></button>'
      +'<button onclick="closeModal();openApprovalCenter(\'daily\')" class="rounded-xl border px-3 py-3 '+(filter==='daily'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Daily Review</div><div class="text-xl font-bold">'+A.dailyReviews.length+'</div></button>'
      +(adminReviewer()?'<button onclick="closeModal();openApprovalCenter(\'do_edit\')" class="rounded-xl border px-3 py-3 '+(filter==='do_edit'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">DO Edit</div><div class="text-xl font-bold">'+A.doEdits.length+'</div></button>':'')
      +(adminReviewer()?'<button onclick="closeModal();openApprovalCenter(\'stock_count_edit\')" class="rounded-xl border px-3 py-3 '+(filter==='stock_count_edit'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Stock Count</div><div class="text-xl font-bold">'+A.stockCountEdits.length+'</div></button>':'')
      +(stockReviewer()?'<button onclick="closeModal();openApprovalCenter(\'stock\')" class="rounded-xl border px-3 py-3 '+(filter==='stock'?'bg-[#211d18] text-white':'bg-white')+'"><div class="text-[9px] uppercase font-bold opacity-70">Stock</div><div class="text-xl font-bold">'+stockTotal()+'</div></button>':'')
      +'</div>'
      +'<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">Each request opens its existing permission-controlled approval process. CNs may need both management approval and a later Customer Credit decision. Daily reviews cover the last 30 days.</div>'
      +(A.loadWarnings.length?'<div class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">'+A.loadWarnings.map(esc).join(' · ')+'</div>':'')
      +'<div class="grid gap-2 max-h-[58vh] overflow-y-auto pr-1">'
      +(rows.length?rows.map(function(r){return requestHtml(r.x,r.type)}).join(''):'<div class="rounded-xl border border-dashed p-10 text-center text-sm text-gray-400">No pending requests.</div>')
      +'</div></div>';
    openModal('Pending Approvals',html);
  };

  // Keep all review types on the SAME Approvals page. Each count is the
  // number of actionable, permission-visible pending requests in that type.
  function approvalTypes(){
    var types=[
      {key:'all',label:'All Pending',count:total()},
      {key:'cn_approval',label:'Return / CN Approval',count:A.cnApprovals.length,show:cnReviewer()},
      {key:'cn_finance',label:'CN Credit Decisions',count:A.cnFinance.length,show:cnReviewer()},
      {key:'orders',label:'Order Edits',count:A.orders.length},
      {key:'payments',label:'Payments',count:A.payments.length},
      {key:'conversions',label:'TK/RK Conversions',count:A.conversions.length},
      {key:'customers',label:'Customer Requests',count:A.customers.length},
      {key:'stages',label:'Stage Corrections',count:A.stages.length},
      {key:'assignments',label:'Sales Assignments',count:A.assignments.length},
      {key:'stock',label:'Stock Approvals',count:stockTotal(),show:stockReviewer()},
      {key:'do_edit',label:'DO Edit Requests',count:A.doEdits.length,show:adminReviewer()},
      {key:'stock_count_edit',label:'Stock Count Edits',count:A.stockCountEdits.length,show:adminReviewer()},
      {key:'daily',label:'Team Daily Review',count:A.dailyReviews.length}
    ];
    return types.filter(function(t){return t.show!==false});
  }

  function typeGroupHtml(type,rows){
    return '<section class="rounded-xl border border-[#ede8df] overflow-hidden" data-approval-group="'+type.key+'">'+
      '<button type="button" onclick="setApprovalType(\''+type.key+'\')" class="w-full px-4 py-3 flex flex-wrap items-center justify-between gap-2 text-left bg-[#faf8f4] hover:bg-[#f2eee7]">'+
      '<span class="text-sm font-semibold">'+esc(type.label)+'</span>'+
      '<span class="inline-flex items-center justify-center rounded-full bg-white border text-xs font-bold min-w-[28px] h-7 px-2">'+type.count+'</span></button>'+
      '<div class="p-3 grid gap-2">'+rows.map(function(r){return requestHtml(r.x,r.type)}).join('')+'</div>'+
      '</section>';
  }

  function renderApprovalTypePanels(){
    if(!reviewer()||state.page!=='approvals')return;
    var filters=document.getElementById('approvalTypeFilters');
    var body=document.getElementById('approvalTypeResults');
    var summary=document.getElementById('approvalTypeSummary');
    var heading=document.getElementById('approvalTypeHeading');
    if(!filters||!body||!summary||!heading)return;
    var types=approvalTypes();
    if(!types.some(function(t){return t.key===A.activeType}))A.activeType='all';
    var active=types.find(function(t){return t.key===A.activeType})||types[0];

    filters.innerHTML=types.map(function(t){
      var selected=t.key===active.key;
      return '<button type="button" data-approval-type="'+t.key+'" aria-pressed="'+selected+'" onclick="setApprovalType(\''+t.key+'\')" class="inline-flex items-center gap-2 px-3 py-2.5 rounded-xl border text-xs font-semibold transition-colors '+
        (selected?'bg-[#211d18] text-white border-[#211d18]':'bg-white text-gray-700 border-[#e7e1d7] hover:border-[#ba9a5a]')+'">'+
        esc(t.label)+'<span class="inline-flex justify-center items-center min-w-[23px] h-[23px] px-1.5 rounded-full text-[11px] font-bold '+
        (selected?'bg-white/20 text-white':t.count?'bg-amber-100 text-amber-900':'bg-gray-100 text-gray-500')+'">'+t.count+'</span></button>';
    }).join('');

    heading.textContent=active.key==='all'?'Pending Requests by Type':active.label;
    summary.textContent=active.key==='all'
      ?total()+' pending request'+(total()===1?'':'s')+' across '+types.filter(function(t){return t.key!=='all'&&t.count>0}).length+' active approval type(s).'
      :active.count+' pending request'+(active.count===1?'':'s')+' in this approval type.';
    if(active.key==='all'){
      var groups=types.filter(function(t){return t.key!=='all'&&t.count>0});
      body.innerHTML=groups.length
        ?groups.map(function(t){return typeGroupHtml(t,rowsFor(t.key))}).join('')
        :'<div class="rounded-xl border border-dashed p-10 text-center text-sm text-gray-500">No pending approvals. All review types are up to date.</div>';
    }else{
      var rows=rowsFor(active.key);
      body.innerHTML=rows.length
        ?'<div class="grid gap-2">'+rows.map(function(r){return requestHtml(r.x,r.type)}).join('')+'</div>'
        :'<div class="rounded-xl border border-dashed p-10 text-center text-sm text-gray-500">No pending '+esc(active.label.toLowerCase())+' requests.</div>';
    }
  }

  window.setApprovalType=function(type){
    if(!reviewer())return showToast('Manager/Admin access required.','err');
    if(!approvalTypes().some(function(t){return t.key===type}))return;
    A.activeType=type;
    renderApprovalTypePanels();
  };

  window.openApprovalType=async function(type){
    if(!reviewer())return showToast('Manager/Admin access required.','err');
    if(!approvalTypes().some(function(t){return t.key===type}))return;
    A.activeType=type;
    if(state.page!=='approvals')await go('approvals');
    else renderApprovalTypePanels();
  };

  window.renderApprovals=async function(){
    if(!reviewer())throw new Error('Manager/Admin access required');
    await loadPending();
    document.getElementById('content').innerHTML=
      '<div class="space-y-5">'+
      '<div class="card rounded-2xl p-5">'+
        '<div class="flex flex-wrap justify-between items-center gap-3">'+
          '<div><h2 class="font-bold text-lg">Approval Types</h2>'+
          '<p class="text-xs text-gray-500 mt-1">Choose a type to see its requests here, or choose All Pending to see every type separately.</p></div>'+
          '<div class="text-sm font-semibold text-gray-700">Total Pending <b class="ml-1 rounded-full bg-[#211d18] text-white px-3 py-1.5">'+total()+'</b></div>'+
        '</div>'+
        '<div id="approvalTypeFilters" role="group" aria-label="Filter pending approvals by type" class="flex flex-wrap gap-2 mt-4"></div>'+
      '</div>'+
      (A.loadWarnings.length?'<div class="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 p-3 text-xs">Some review queues could not load: '+A.loadWarnings.map(esc).join(' · ')+'</div>':'')+
      '<div class="card rounded-2xl p-5">'+
        '<div class="flex flex-wrap justify-between items-center gap-3 mb-4">'+
          '<div><h3 id="approvalTypeHeading" class="font-bold text-lg">Pending Requests by Type</h3>'+
          '<p id="approvalTypeSummary" class="text-xs text-gray-500 mt-1"></p></div>'+
          '<button type="button" onclick="renderApprovals().then(refreshApprovalNotifications)" class="px-3 py-2 border rounded-lg text-xs font-semibold">Refresh</button>'+
        '</div>'+
        '<div id="approvalTypeResults" class="grid gap-4"></div>'+
      '</div>'+
      '</div>';
    renderApprovalTypePanels();
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
      document.getElementById('pageSubtitle').textContent='Review CN, Sales, payments, delivery, stock and daily reports';
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
  wrapReview('reviewCNCase');
  wrapReview('finalizeCNNoCredit');
  wrapReview('setSalesReturnFinancialTreatment');
  wrapReview('resubmitCNCase');
  wrapReview('reviewSrConversion');
  setTimeout(function(){
    [
      'reviewCustomerStageChangeRequest','reviewDeliveryOrderEdit',
      'reviewStockCountEdit','reviewActivitySalesAssignment'
    ].forEach(wrapReview);
  },100);
  // Keep the sidebar/nav notification count fresh while the app is open.
  // The separate bell/PWA push notification uses the database attention RPC.
  setInterval(function(){
    if(reviewer()&&(!document.visibilityState||document.visibilityState==='visible'))refresh();
  },60000);

  try{
    if(state&&state.profile&&reviewer()){
      renderNav();
      setTimeout(refresh,50);
    }
  }catch(_){}
})();