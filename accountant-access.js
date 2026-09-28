// Accountant role UI restrictions.
// Loaded last so it can apply a final read-only/request-only boundary over all other modules.
(function(){
  function isAccountant(){return (state.profile?.role||'')==='accountant'}
  const allowedPages=new Set(['dashboard','customers','sales-orders','reports']);

  const previousNavItems=window.navItems;
  if(typeof previousNavItems==='function'){
    window.navItems=function(){
      const items=previousNavItems.apply(this,arguments)||[];
      if(!isAccountant())return items;
      return items.filter(x=>allowedPages.has(x[0]));
    };
  }

  const previousGo=window.go;
  if(typeof previousGo==='function'){
    window.go=async function(page){
      if(isAccountant()&&!allowedPages.has(page)){
        showToast('Accountant access is limited to Customers, Sales Tracking and Sales Report.','err');
        return previousGo('dashboard');
      }
      return previousGo.apply(this,arguments);
    };
  }

  const previousOpenNewOrder=window.openNewOrder;
  if(typeof previousOpenNewOrder==='function'){
    window.openNewOrder=function(){
      if(isAccountant())return showToast('Accountant cannot create or act as a Sales Rep.','err');
      return previousOpenNewOrder.apply(this,arguments);
    };
  }

  const previousOpenNewCustomer=window.openNewCustomer;
  if(typeof previousOpenNewCustomer==='function'){
    window.openNewCustomer=function(){
      if(isAccountant())return showToast('Accountant can view customers and request changes, but cannot create customers.','err');
      return previousOpenNewCustomer.apply(this,arguments);
    };
  }

  function decorateSalesTracking(){
    if(!isAccountant())return;
    document.querySelectorAll('#salesTrackingRoot button[onclick="openNewOrder()"]').forEach(b=>b.remove());
    const root=document.getElementById('salesTrackingRoot');
    if(root&&!root.querySelector('[data-accountant-readonly]')){
      const note=document.createElement('div');
      note.dataset.accountantReadonly='1';
      note.className='mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800';
      note.innerHTML='<b>Accountant access:</b> You can view all Sales Tracking records and submit edit requests. You cannot create orders, act as a Sales Rep, edit live records directly, or approve requests.';
      root.insertBefore(note,root.firstChild);
    }
  }

  const previousSalesBody=window.renderSalesTrackingBody;
  if(typeof previousSalesBody==='function'){
    window.renderSalesTrackingBody=function(){
      const out=previousSalesBody.apply(this,arguments);
      decorateSalesTracking();
      setTimeout(decorateSalesTracking,40);
      return out;
    };
  }

  function decorateCustomers(){
    if(!isAccountant())return;
    document.querySelectorAll('#content button[onclick="openNewCustomer()"]').forEach(b=>b.remove());
    document.querySelectorAll('#content button[onclick^="openEditCustomer("]').forEach(b=>{
      if(!/pending/i.test(b.textContent||''))b.textContent='Request Edit';
    });
    const rows=document.getElementById('customerRows');
    const parent=rows?.parentElement;
    if(parent&&!document.querySelector('[data-accountant-customer-note]')){
      const note=document.createElement('div');
      note.dataset.accountantCustomerNote='1';
      note.className='mb-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-xs text-blue-800';
      note.innerHTML='<b>Accountant access:</b> Customer information is view-only. Use <b>Request Edit</b> when a correction is needed; Manager/Admin must approve it before the live customer record changes.';
      parent.insertBefore(note,parent.firstChild);
    }
  }

  const previousRenderCustomers=window.renderCustomers;
  if(typeof previousRenderCustomers==='function'){
    window.renderCustomers=async function(){
      const out=await previousRenderCustomers.apply(this,arguments);
      decorateCustomers();
      setTimeout(decorateCustomers,40);
      return out;
    };
  }

  try{
    if(isAccountant()){
      renderNav();
      if(state.page&&!allowedPages.has(state.page))setTimeout(()=>go('dashboard'),0);
    }
  }catch(_){}
})();