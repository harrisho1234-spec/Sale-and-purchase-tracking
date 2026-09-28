// Final Super Admin Customer Master delete controls.
// Loaded after all customer overlays so later modules cannot hide the action.
(function(){
  function managerContext(){
    return typeof managerRepActive==='function' && managerRepActive();
  }
  function canDeleteCustomerMaster(){
    return (state.profile?.role||'')==='super_admin' && !managerContext();
  }
  function customerFromState(id){
    return (state.customers||[]).find(c=>String(c.id)===String(id))||null;
  }
  function customerIdFromRow(row){
    if(row?.dataset?.customerId)return row.dataset.customerId;
    const edit=row?.querySelector('button[onclick*="openEditCustomer"]');
    const raw=edit?.getAttribute('onclick')||'';
    return raw.match(/openEditCustomer\('([^']+)'\)/)?.[1]||'';
  }

  async function loadDeleteStatus(id){
    const [orders,returns,credits]=await Promise.all([
      db.from('sales_orders').select('id',{count:'exact',head:true}).eq('customer_id',id),
      db.from('sales_returns').select('id',{count:'exact',head:true}).eq('customer_id',id),
      db.from('sales_credit_applications').select('id',{count:'exact',head:true}).eq('customer_id',id)
    ]);
    const err=orders.error||returns.error||credits.error;
    if(err)throw err;
    return {
      orders:Number(orders.count||0),
      returns:Number(returns.count||0),
      credits:Number(credits.count||0)
    };
  }

  function decorateCustomerDeleteButtons(){
    if(!canDeleteCustomerMaster())return;
    document.querySelectorAll('#customerRows .customer-edit-row').forEach(row=>{
      if(row.querySelector('.customer-master-delete-btn, button[onclick*="openDeleteCustomer"]'))return;
      const id=customerIdFromRow(row);if(!id)return;
      const edit=row.querySelector('button[onclick*="openEditCustomer"]');
      if(!edit)return;
      const btn=document.createElement('button');
      btn.type='button';
      btn.className='customer-master-delete-btn px-3 py-2 rounded-lg border border-red-200 bg-red-50 text-red-600 text-xs font-semibold hover:bg-red-100';
      btn.textContent='Delete';
      btn.onclick=e=>{e.stopPropagation();openDeleteCustomer(id)};
      edit.parentElement?.appendChild(btn);
      edit.parentElement?.classList.add('gap-2');
    });
  }

  const baseRows=window.renderCustomerEditRows;
  if(typeof baseRows==='function'){
    window.renderCustomerEditRows=function(){
      const out=baseRows.apply(this,arguments);
      decorateCustomerDeleteButtons();
      requestAnimationFrame(decorateCustomerDeleteButtons);
      return out;
    };
  }

  const baseCustomers=window.renderCustomers;
  if(typeof baseCustomers==='function'){
    window.renderCustomers=async function(){
      const out=await baseCustomers.apply(this,arguments);
      decorateCustomerDeleteButtons();
      requestAnimationFrame(decorateCustomerDeleteButtons);
      setTimeout(decorateCustomerDeleteButtons,60);
      return out;
    };
  }

  const baseEdit=window.openEditCustomer;
  if(typeof baseEdit==='function'){
    window.openEditCustomer=async function(id){
      const out=await baseEdit.apply(this,arguments);
      if(!canDeleteCustomerMaster())return out;
      const form=document.getElementById('multiEditCustomerForm')||document.getElementById('editCustomerForm');
      if(!form||form.querySelector('.customer-master-delete-modal-btn, button[onclick*="openDeleteCustomer"]'))return out;

      const submit=[...form.querySelectorAll('button')].find(b=>b.type!=='button');
      if(!submit)return out;

      const actions=document.createElement('div');
      actions.className='md:col-span-2 flex flex-col sm:flex-row gap-2 pt-2 border-t';

      const del=document.createElement('button');
      del.type='button';
      del.className='customer-master-delete-modal-btn sm:w-auto px-5 py-3 border border-red-200 bg-red-50 text-red-600 rounded-xl font-semibold hover:bg-red-100';
      del.textContent='Delete Customer';
      del.onclick=()=>openDeleteCustomer(id);

      submit.parentNode.insertBefore(actions,submit);
      actions.appendChild(del);
      submit.classList.remove('md:col-span-2');
      submit.classList.add('flex-1');
      actions.appendChild(submit);
      return out;
    };
  }

  window.openDeleteCustomer=async function(id){
    if(!canDeleteCustomerMaster())return showToast('Super Admin access required.','err');

    let c=customerFromState(id);
    if(!c){
      const cr=await db.from('customers').select('*').eq('id',id).single();
      if(cr.error)return showToast(cr.error.message,'err');
      c=cr.data;
    }

    let s;
    try{s=await loadDeleteStatus(id)}
    catch(err){return showToast(err.message,'err')}

    const total=s.orders+s.returns+s.credits;
    if(total>0){
      openModal('Cannot Delete Customer — '+(c.name||''),`
        <div class="space-y-4">
          <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <b>This Customer Master has transaction history and cannot be deleted.</b>
            <div class="mt-2">Sales Orders: <b>${s.orders}</b> · Returns/CN: <b>${s.returns}</b> · Credit Applications: <b>${s.credits}</b></div>
            <div class="mt-2 text-xs">Keeping this customer protects invoice, payment, return and accounting history.</div>
          </div>
          <button type="button" onclick="closeModal()" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Close</button>
        </div>`);
      return;
    }

    openModal('Delete Customer — '+(c.name||''),`
      <div class="space-y-4">
        <div class="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
          <b>This will permanently delete the Customer Master.</b>
          <div class="mt-2">Because there are no transactions, deletion is allowed. Any linked CRM identity is removed as well; showroom/online activity logs remain as unlinked history.</div>
          <div class="mt-2"><b>Customer ID ${esc(c.customer_code||'-')} will be released and can be reused automatically.</b></div>
        </div>
        <div class="rounded-xl border bg-white p-4">
          <div class="font-bold">${esc(c.name||'Customer')}</div>
          <div class="text-xs text-gray-500 mt-1">${esc(c.customer_code||'-')}${c.phone?' · '+esc(c.phone):''}</div>
        </div>
        <div class="flex gap-2">
          <button type="button" onclick="closeModal()" class="flex-1 border rounded-xl py-3 font-semibold">Cancel</button>
          <button type="button" id="deleteCustomerMasterFinalBtn" onclick="deleteCustomerNow('${id}')" class="flex-1 bg-red-600 text-white rounded-xl py-3 font-semibold">Delete Customer</button>
        </div>
      </div>`);
  };

  window.deleteCustomerNow=async function(id){
    if(!canDeleteCustomerMaster())return showToast('Super Admin access required.','err');
    const btn=document.getElementById('deleteCustomerMasterFinalBtn');
    if(btn){btn.disabled=true;btn.textContent='Deleting...'}
    const {data,error}=await db.rpc('delete_customer_master_superadmin',{p_customer_id:id});
    if(error){
      if(btn){btn.disabled=false;btn.textContent='Delete Customer'}
      return showToast(error.message,'err');
    }
    closeModal();
    const released=data?.released_customer_code||'Customer ID';
    showToast('Customer deleted. '+released+' is available for reuse.');
    await go('customers');
  };

  setTimeout(decorateCustomerDeleteButtons,100);
})();