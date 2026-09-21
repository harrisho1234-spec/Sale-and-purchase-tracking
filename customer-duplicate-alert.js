// Warn when a contact method is already registered to another customer / Sales Rep.
// Loaded after customer-directory-contacts.js.
(function(){
  const timers=new WeakMap();

  function role(){return state.profile?.role||''}
  function managerContext(){return typeof managerRepActive==='function'&&managerRepActive()}
  function intendedHandler(form){
    if(role()==='sales')return state.user?.id||null;
    if(role()==='manager'&&managerContext())return managerRepId();
    return form?.querySelector('#mcHandler,#mecHandler')?.value||null;
  }
  function handlerLabel(r){return r.handled_by_name||r.handled_by_email||'another Sales Rep'}

  function warningBox(row){
    let box=row.querySelector('.contact-duplicate-warning');
    if(!box){
      box=document.createElement('div');
      box.className='contact-duplicate-warning hidden col-span-full mt-1 rounded-lg border px-3 py-2 text-[11px]';
      row.appendChild(box);
    }
    return box;
  }

  function clearWarning(row){
    const box=warningBox(row);
    box.className='contact-duplicate-warning hidden col-span-full mt-1 rounded-lg border px-3 py-2 text-[11px]';
    box.innerHTML='';
    row.dataset.contactConflict='';
  }

  async function checkRow(row){
    const input=row?.querySelector('.cc-value');
    const type=row?.querySelector('.cc-type')?.value||'phone';
    const value=input?.value?.trim()||'';
    if(!input||value.length<3){clearWarning(row);return;}

    const form=row.closest('form');
    const exclude=form?.dataset.customerId||null;
    const handler=intendedHandler(form);
    const box=warningBox(row);
    box.className='contact-duplicate-warning col-span-full mt-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-[11px] text-gray-500';
    box.textContent='Checking contact...';
    row.dataset.contactConflict='checking';

    const {data,error}=await db.rpc('check_customer_contact_duplicate',{
      p_type:type,
      p_value:value,
      p_exclude_customer_id:exclude||null
    });
    if(error){
      console.warn('Duplicate contact check failed:',error.message);
      clearWarning(row);
      return;
    }
    const hits=data||[];
    if(!hits.length){clearWarning(row);return;}

    const other=hits.find(x=>x.assigned_sales_id&&handler&&x.assigned_sales_id!==handler)||hits[0];
    const otherSales=!!(other.assigned_sales_id&&handler&&other.assigned_sales_id!==handler);
    const customer=other.customer_name||'another customer';
    const owner=handlerLabel(other);

    if(otherSales){
      row.dataset.contactConflict='other';
      box.className='contact-duplicate-warning col-span-full mt-1 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-[11px] text-red-700';
      box.innerHTML=`<b>⚠ Contact already registered.</b> This contact is already under <b>${esc(customer)}</b>, handled by <b>${esc(owner)}</b>. Please check with that Sales Rep before creating a duplicate customer.`;
      input.classList.add('border-red-300','bg-red-50');
    }else{
      row.dataset.contactConflict='same';
      box.className='contact-duplicate-warning col-span-full mt-1 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800';
      box.innerHTML=`<b>⚠ Duplicate contact.</b> This contact is already saved under <b>${esc(customer)}</b>${other.assigned_sales_id?` and handled by <b>${esc(owner)}</b>`:''}.`;
      input.classList.add('border-amber-300','bg-amber-50');
    }
  }

  function scheduleCheck(row){
    const input=row?.querySelector('.cc-value');if(!input)return;
    input.classList.remove('border-red-300','bg-red-50','border-amber-300','bg-amber-50');
    clearTimeout(timers.get(input));
    timers.set(input,setTimeout(()=>checkRow(row),350));
  }

  document.addEventListener('input',e=>{
    if(e.target?.classList?.contains('cc-value'))scheduleCheck(e.target.closest('.customer-contact-row'));
  });
  document.addEventListener('change',e=>{
    if(e.target?.classList?.contains('cc-type'))scheduleCheck(e.target.closest('.customer-contact-row'));
    if(['mcHandler','mecHandler'].includes(e.target?.id)){
      e.target.closest('form')?.querySelectorAll('.customer-contact-row').forEach(scheduleCheck);
    }
  });
  document.addEventListener('blur',e=>{
    if(e.target?.classList?.contains('cc-value'))checkRow(e.target.closest('.customer-contact-row'));
  },true);

  // If a user chooses to save despite the live warning, require a final confirmation.
  document.addEventListener('submit',e=>{
    if(!['multiCustomerForm','multiEditCustomerForm'].includes(e.target?.id))return;
    const conflicts=[...e.target.querySelectorAll('.customer-contact-row')].filter(r=>r.dataset.contactConflict==='other');
    if(conflicts.length&&!confirm('One or more contact details already belong to a customer handled by another Sales Rep. Save anyway?')){
      e.preventDefault();
      e.stopImmediatePropagation();
      conflicts[0]?.querySelector('.cc-value')?.focus();
    }
  },true);

  const baseNew=window.openNewCustomer;
  if(typeof baseNew==='function')window.openNewCustomer=async function(){
    const r=await baseNew.apply(this,arguments);
    const form=document.getElementById('multiCustomerForm');
    if(form)form.dataset.customerId='';
    return r;
  };

  const baseEdit=window.openEditCustomer;
  if(typeof baseEdit==='function')window.openEditCustomer=async function(id){
    const r=await baseEdit.apply(this,arguments);
    const form=document.getElementById('multiEditCustomerForm');
    if(form)form.dataset.customerId=id||'';
    return r;
  };
})();
