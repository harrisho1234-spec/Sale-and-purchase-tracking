// Final Manager customer-create override.
// Loaded after all customer/manager enhancements so no earlier Rep Workspace restriction can win.
(function(){
  const previousOpenNewCustomer=window.openNewCustomer;

  function isManagerAccount(){return state.profile?.role==='manager'}
  function escLocal(v){return typeof esc==='function'?esc(v):String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]))}

  async function assignmentOptions(){
    const {data,error}=await db.from('app_users')
      .select('user_id,display_name,email,role,active')
      .eq('active',true)
      .in('role',['sales','manager'])
      .order('role')
      .order('display_name');
    if(error)throw error;

    const me=state.user?.id;
    const users=(data||[]).filter(u=>u.role==='sales'||u.user_id===me);
    const contextId=(typeof managerRepActive==='function'&&managerRepActive())?managerRepId():null;

    return '<option value="">Unassigned</option>'+users.map(u=>{
      const selected=contextId===u.user_id?' selected':'';
      const label=u.user_id===me
        ? (u.display_name||u.email||'Manager')+' — Manager (Me)'
        : (u.display_name||u.email||'Sales Rep')+' — Sales';
      return '<option value="'+escLocal(u.user_id)+'"'+selected+'>'+escLocal(label)+'</option>';
    }).join('');
  }

  function contactRow(type='phone',label=''){
    const types=[
      ['phone','Phone'],['telegram','Telegram'],['whatsapp','WhatsApp'],
      ['line','LINE'],['wechat','WeChat'],['email','Email'],['other','Other']
    ];
    return `<div class="manager-new-customer-contact grid grid-cols-[135px_120px_minmax(0,1fr)_44px] gap-2 items-end p-2.5 bg-gray-50 border rounded-xl">
      <div><label class="text-[9px] uppercase font-bold text-gray-400">Type</label><select class="mnc-type mt-1 w-full border rounded-lg px-2 py-2 bg-white text-xs">${types.map(([v,t])=>`<option value="${v}" ${v===type?'selected':''}>${t}</option>`).join('')}</select></div>
      <div><label class="text-[9px] uppercase font-bold text-gray-400">Label</label><input class="mnc-label mt-1 w-full border rounded-lg px-2 py-2 text-xs" value="${escLocal(label)}" placeholder="Main, Office..."></div>
      <div><label class="text-[9px] uppercase font-bold text-gray-400">Number / Username</label><input class="mnc-value mt-1 w-full border rounded-lg px-3 py-2 text-xs" placeholder="012..., @telegram, WhatsApp..."></div>
      <button type="button" onclick="this.closest('.manager-new-customer-contact').remove()" class="h-[34px] border rounded-lg text-red-500 font-bold">×</button>
    </div>`;
  }

  window.addManagerCustomerContact=function(type='phone'){
    document.getElementById('managerNewCustomerContacts')?.insertAdjacentHTML('beforeend',contactRow(type,type==='phone'?'Main':''));
  };

  function readContacts(){
    return [...document.querySelectorAll('.manager-new-customer-contact')].map(r=>({
      contact_type:r.querySelector('.mnc-type')?.value||'other',
      label:r.querySelector('.mnc-label')?.value.trim()||null,
      contact_value:r.querySelector('.mnc-value')?.value.trim()||''
    })).filter(x=>x.contact_value);
  }

  window.openManagerDirectCustomer=async function(){
    let opts;
    try{opts=await assignmentOptions()}
    catch(err){return showToast('Could not load Sales Reps: '+err.message,'err')}

    openModal('Add Customer',`<form id="managerDirectCustomerForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Customer Name</label><input id="mdcName" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Customer name"></div>
      <div><label class="text-xs font-semibold">Customer Code</label><input id="mdcCode" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>

      <div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><input id="mdcAddress" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Address"></div>

      <div class="md:col-span-2">
        <label class="text-xs font-semibold">Assign Customer To</label>
        <select id="mdcHandler" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${opts}</select>
        <div class="text-[10px] text-gray-400 mt-1">Optional — leave <b>Unassigned</b>, choose a Sales Rep, or choose <b>Manager (Me)</b>. No Rep Workspace is required.</div>
      </div>

      <div class="md:col-span-2 border-t pt-4">
        <div class="flex items-center justify-between gap-3">
          <div><div class="font-bold text-sm">Contact Methods</div><div class="text-[10px] text-gray-400">Add phone, Telegram, WhatsApp, LINE, WeChat or email.</div></div>
          <button type="button" onclick="addManagerCustomerContact('phone')" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Contact</button>
        </div>
        <div id="managerNewCustomerContacts" class="grid gap-2 mt-3">${contactRow('phone','Main')}${contactRow('telegram','Telegram')}</div>
      </div>

      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="mdcNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Preferences, project, delivery instructions, follow-up note..."></textarea></div>

      <button id="managerDirectCustomerSave" class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer</button>
    </form>`);

    document.getElementById('managerDirectCustomerForm').onsubmit=saveManagerDirectCustomer;
  };

  window.saveManagerDirectCustomer=async function(e){
    e.preventDefault();
    if(!isManagerAccount())return showToast('Manager access required.','err');

    const btn=document.getElementById('managerDirectCustomerSave');
    const contacts=readContacts();
    const firstPhone=contacts.find(x=>x.contact_type==='phone')?.contact_value||null;
    const firstEmail=contacts.find(x=>x.contact_type==='email')?.contact_value||null;
    const assigned=document.getElementById('mdcHandler')?.value||null;
    const name=document.getElementById('mdcName')?.value.trim()||'';
    if(!name)return showToast('Customer name is required.','err');

    const row={
      name,
      customer_code:document.getElementById('mdcCode')?.value.trim()||null,
      address:document.getElementById('mdcAddress')?.value.trim()||null,
      notes:document.getElementById('mdcNotes')?.value.trim()||null,
      phone:firstPhone,
      email:firstEmail,
      assigned_sales_id:assigned,
      created_by:state.user.id,
      active:true
    };

    btn.disabled=true;btn.textContent='Saving...';
    try{
      const {data,error}=await db.from('customers').insert(row).select('id').single();
      if(error)throw error;

      if(contacts.length){
        const {error:contactError}=await db.from('customer_contacts').insert(
          contacts.map((x,i)=>({...x,customer_id:data.id,is_primary:i===0,created_by:state.user.id}))
        );
        if(contactError)showToast('Customer saved, but contacts could not be saved: '+contactError.message,'err');
      }

      const select=document.getElementById('mdcHandler');
      const selectedText=assigned&&select?.selectedOptions?.[0]?.textContent?.trim();
      closeModal();
      if(assigned===state.user.id)showToast('Customer added and assigned to you');
      else if(assigned)showToast('Customer added and assigned to '+(selectedText||'selected Sales Rep'));
      else showToast('Customer added as Unassigned');
      await go('customers');
    }catch(err){
      showToast(err.message||'Could not add customer','err');
      btn.disabled=false;btn.textContent='Save Customer';
    }
  };

  window.openNewCustomer=function(){
    if(isManagerAccount())return window.openManagerDirectCustomer();
    return typeof previousOpenNewCustomer==='function'
      ? previousOpenNewCustomer.apply(this,arguments)
      : showToast('Customer form is unavailable.','err');
  };
})();