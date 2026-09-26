// Editable customer "Since" date. Keeps system created_at untouched for audit.
// Loaded after customer directory + duplicate contact alert.
(function(){
  function role(){return state.profile?.role||''}
  function managerContext(){return typeof managerRepActive==='function'&&managerRepActive()}
  function canAssignHandler(){return ['super_admin','admin','manager'].includes(role())}
  function canSeeCustomerId(){return ['super_admin','admin','manager'].includes(role())&&!managerContext()}
  function effectiveHandler(){if(role()==='sales')return state.user?.id||null;if(role()==='manager'&&managerContext())return managerRepId();return null}
  function metricsFor(id){return window._customerSalesMetrics?.get(id)||{sales:0,paid:0,ar:0,orders:0}}
  function metaFor(id){return window._customerAssignmentMeta?.get(id)||{}}
  function handlerName(c){const m=metaFor(c.id);if(m.assigned_sales_name)return m.assigned_sales_name;if(m.assigned_sales_email)return m.assigned_sales_email;if(c.assigned_sales_id===state.user?.id)return state.profile?.display_name||state.user?.email||'Me';return c.assigned_sales_id?'Assigned':'Unassigned'}
  function dateValue(v){if(!v)return '';return String(v).slice(0,10)}
  function todayValue(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
  function fmtDate(v){if(!v)return '-';const s=dateValue(v);const [y,m,d]=s.split('-').map(Number);if(!y||!m||!d)return String(v);return new Date(y,m-1,d).toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}

  async function handlerOptions(selected=''){
    if(!canAssignHandler())return '';
    const {data,error}=await db.from('app_users').select('user_id,display_name,email,role,active').in('role',['sales','manager']).eq('active',true).order('role').order('display_name');
    if(error)return '<option value="">Unassigned</option>';
    return `<option value="">Unassigned</option>${(data||[]).map(u=>`<option value="${u.user_id}" ${u.user_id===selected?'selected':''}>${esc(u.display_name||u.email)} — ${u.role==='sales'?'Sales':'Manager'}</option>`).join('')}`;
  }

  function contactTypeOptions(selected='phone'){
    const labels={phone:'Phone',telegram:'Telegram',whatsapp:'WhatsApp',line:'LINE',wechat:'WeChat',email:'Email',other:'Other'};
    return Object.keys(labels).map(t=>`<option value="${t}" ${t===selected?'selected':''}>${labels[t]}</option>`).join('');
  }
  function contactRow(x={}){return `<div class="customer-contact-row grid grid-cols-[135px_120px_minmax(0,1fr)_44px] gap-2 items-end p-2.5 bg-gray-50 border rounded-xl">
    <div><label class="text-[9px] uppercase font-bold text-gray-400">Type</label><select class="cc-type mt-1 w-full border rounded-lg px-2 py-2 bg-white text-xs">${contactTypeOptions(x.contact_type||'phone')}</select></div>
    <div><label class="text-[9px] uppercase font-bold text-gray-400">Label</label><input class="cc-label mt-1 w-full border rounded-lg px-2 py-2 text-xs" value="${esc(x.label||'')}" placeholder="Main, Office..."></div>
    <div><label class="text-[9px] uppercase font-bold text-gray-400">Number / Username</label><input class="cc-value mt-1 w-full border rounded-lg px-3 py-2 text-xs" value="${esc(x.contact_value||'')}" placeholder="012..., @telegram, WhatsApp..."></div>
    <button type="button" onclick="this.closest('.customer-contact-row').remove()" class="h-[34px] border rounded-lg text-red-500 font-bold">×</button>
  </div>`}
  function readContacts(){return [...document.querySelectorAll('#customerContactRows .customer-contact-row')].map(r=>({contact_type:r.querySelector('.cc-type').value,label:r.querySelector('.cc-label').value.trim()||null,contact_value:r.querySelector('.cc-value').value.trim()})).filter(x=>x.contact_value)}

  // Keep the customer list's "Since" date aligned with customer_since without changing system created_at.
  const baseRows=window.renderCustomerEditRows;
  if(typeof baseRows==='function'){
    window.renderCustomerEditRows=function(list){
      const touched=[];(list||[]).forEach(c=>{if(c.customer_since){touched.push([c,c.created_at]);c.created_at=c.customer_since;}});
      try{return baseRows.apply(this,arguments)}finally{touched.forEach(([c,v])=>c.created_at=v)}
    };
  }

  window.openNewCustomer=async function(){
    if(role()==='manager'&&!managerContext())return showToast('Choose a Sales Rep in Rep Workspace before creating a customer.','err');
    const fixed=effectiveHandler(),opts=await handlerOptions(fixed||'');
    openModal('Add Customer',`<form id="multiCustomerForm" data-customer-id="" class="grid md:grid-cols-2 gap-4">
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Name</label><input id="mcName" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Customer name"></div>
      <div class="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700"><b>Customer ID is automatic.</b> Phone numbers are normalized before duplicate checking, so formats such as 012 345 678, 012345678, 012-345-678 and +855 12 345 678 are treated as the same number.</div>
      <div><label class="text-xs font-semibold">Customer Since</label><input id="mcCustomerSince" type="date" value="${todayValue()}" class="mt-1 w-full border rounded-xl px-3 py-2.5"><div class="text-[10px] text-gray-400 mt-1">Editable business date. The real system creation time is kept separately for audit.</div></div>
      <div><label class="text-xs font-semibold">Address</label><input id="mcAddress" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Address"></div>
      ${canAssignHandler()&&!fixed?`<div class="md:col-span-2"><label class="text-xs font-semibold">Handled By / Assigned Sales</label><select id="mcHandler" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${opts}</select></div>`:`<div class="md:col-span-2 rounded-xl border bg-gray-50 px-4 py-3 text-xs text-gray-600">Handled by: <b>${esc(role()==='sales'?(state.profile?.display_name||state.user?.email||'You'):(managerContext()?managerRepName():'Unassigned'))}</b></div>`}
      <div class="md:col-span-2 border-t pt-4"><div class="flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Contact Methods</div><div class="text-[10px] text-gray-400">Add multiple phone numbers, Telegram users, WhatsApp, LINE, WeChat or email.</div></div><button type="button" onclick="addCustomerContactRow('phone')" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Contact</button></div><div id="customerContactRows" class="grid gap-2 mt-3">${contactRow({contact_type:'phone',label:'Main'})}${contactRow({contact_type:'telegram',label:'Telegram'})}</div></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="mcNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Preferences, project, delivery instructions, follow-up note..."></textarea></div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer</button>
    </form>`);
    document.getElementById('multiCustomerForm').onsubmit=async e=>{
      e.preventDefault();
      const contacts=readContacts(),firstPhone=contacts.find(x=>x.contact_type==='phone')?.contact_value||null,firstEmail=contacts.find(x=>x.contact_type==='email')?.contact_value||null;
      const handler=effectiveHandler()||(document.getElementById('mcHandler')?.value||null);
      const row={name:document.getElementById('mcName').value.trim(),customer_since:document.getElementById('mcCustomerSince').value||todayValue(),address:document.getElementById('mcAddress').value.trim()||null,notes:document.getElementById('mcNotes').value.trim()||null,phone:firstPhone,email:firstEmail,assigned_sales_id:handler,created_by:state.user.id,active:true};
      if(!row.name)return showToast('Customer name is required.','err');
      if(firstPhone){
        const match=await db.rpc('find_customer_identity_by_phone',{p_phone:firstPhone});
        if(match.error)return showToast(match.error.message,'err');
        if(match.data&&match.data.matched)return showToast('This phone number already belongs to '+(match.data.customer_name||'an existing customer')+'. Use the existing customer instead.','err');
      }
      const cr=await db.from('customers').insert(row).select('id,customer_code').single();if(cr.error)return showToast(cr.error.message,'err');
      if(contacts.length){const ci=await db.from('customer_contacts').insert(contacts.map((x,i)=>({...x,customer_id:cr.data.id,is_primary:i===0,created_by:state.user.id})));if(ci.error)return showToast(`Customer saved, but contacts could not be saved: ${ci.error.message}`,'err');}
      if(role()==='manager'&&managerContext()&&typeof recordManagerRepAction==='function')await recordManagerRepAction('create_customer','customer',cr.data.id,{customer_name:row.name});
      closeModal();showToast('Customer added');await go('customers');
    };
  };

  window.openEditCustomer=async function(id){
    let c=(state.customers||[]).find(x=>x.id===id);if(!c){const r=await db.from('customers').select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');c=r.data;}
    const [cc,opts]=await Promise.all([db.from('customer_contacts').select('*').eq('customer_id',id).order('created_at'),handlerOptions(c.assigned_sales_id)]);if(cc.error)return showToast(cc.error.message,'err');
    const m=metricsFor(c.id),cs=cc.data||[],since=c.customer_since||dateValue(c.created_at)||todayValue();
    openModal(`Edit Customer — ${c.name||''}`,`<form id="multiEditCustomerForm" data-customer-id="${id}" class="grid md:grid-cols-2 gap-4">
      <div class="md:col-span-2 grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border bg-[#faf9f6] p-4"><div><div class="text-[9px] uppercase font-bold text-gray-400">Customer Since</div><div class="text-sm font-semibold mt-1">${esc(fmtDate(since))}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Current Handler</div><div class="text-sm font-semibold mt-1">${esc(handlerName(c))}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Sales</div><div class="text-sm font-semibold mt-1">${money(m.sales)}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Received</div><div class="text-sm font-semibold text-green-600 mt-1">${money(m.paid)}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">AR</div><div class="text-sm font-semibold ${m.ar>0?'text-red-500':'text-green-600'} mt-1">${money(m.ar)}</div></div></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Name</label><input id="mecName" required value="${esc(c.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      ${canSeeCustomerId()?`<div class="md:col-span-2 rounded-xl border bg-[#faf9f6] px-4 py-3"><div class="text-[9px] uppercase font-bold text-gray-400">Customer ID</div><div class="mt-1 font-bold text-[#b3871e]">${esc(c.customer_code||'-')}</div><div class="text-[9px] text-gray-400 mt-1">Automatic and permanent — it cannot be edited.</div></div>`:''}
      <div><label class="text-xs font-semibold">Customer Since</label><input id="mecCustomerSince" type="date" value="${esc(dateValue(since))}" class="mt-1 w-full border rounded-xl px-3 py-2.5"><div class="text-[10px] text-gray-400 mt-1">You can correct/backdate the customer date without changing the system audit timestamp.</div></div>
      <div><label class="text-xs font-semibold">Address</label><input id="mecAddress" value="${esc(c.address||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      ${canAssignHandler()?`<div class="md:col-span-2"><label class="text-xs font-semibold">Handled By / Assigned Sales</label><select id="mecHandler" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${opts}</select><div class="text-[10px] text-gray-400 mt-1">Changing this transfers the customer portfolio to another Sales Rep/Manager.</div></div>`:''}
      <div class="md:col-span-2 border-t pt-4"><div class="flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Contact Methods</div><div class="text-[10px] text-gray-400">Phone numbers and social usernames can be added, edited or removed.</div></div><button type="button" onclick="addCustomerContactRow('phone')" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Contact</button></div><div id="customerContactRows" class="grid gap-2 mt-3">${(cs.length?cs:[...(c.phone?[{contact_type:'phone',label:'Main',contact_value:c.phone}]:[]),...(c.email?[{contact_type:'email',label:'Email',contact_value:c.email}]:[])]).map(contactRow).join('')||contactRow({contact_type:'phone',label:'Main'})}</div></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="mecNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(c.notes||'')}</textarea></div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer Changes</button>
    </form>`);
    document.getElementById('multiEditCustomerForm').onsubmit=async e=>{
      e.preventDefault();
      const contacts=readContacts(),firstPhone=contacts.find(x=>x.contact_type==='phone')?.contact_value||null,firstEmail=contacts.find(x=>x.contact_type==='email')?.contact_value||null;
      const patch={name:document.getElementById('mecName').value.trim(),customer_since:document.getElementById('mecCustomerSince').value||null,address:document.getElementById('mecAddress').value.trim()||null,notes:document.getElementById('mecNotes').value.trim()||null,phone:firstPhone,email:firstEmail,updated_at:new Date().toISOString()};
      if(canAssignHandler()&&document.getElementById('mecHandler'))patch.assigned_sales_id=document.getElementById('mecHandler').value||null;
      if(!patch.name)return showToast('Customer name is required.','err');
      if(firstPhone){
        const match=await db.rpc('find_customer_identity_by_phone',{p_phone:firstPhone});
        if(match.error)return showToast(match.error.message,'err');
        if(match.data&&match.data.matched&&match.data.customer_id&&String(match.data.customer_id)!==String(id))return showToast('This phone number already belongs to '+(match.data.customer_name||'another customer')+'.','err');
      }
      const up=await db.from('customers').update(patch).eq('id',id);if(up.error)return showToast(up.error.message,'err');
      const del=await db.from('customer_contacts').delete().eq('customer_id',id);if(del.error)return showToast(del.error.message,'err');
      if(contacts.length){const ins=await db.from('customer_contacts').insert(contacts.map((x,i)=>({...x,customer_id:id,is_primary:i===0,created_by:state.user.id})));if(ins.error)return showToast(ins.error.message,'err');}
      closeModal();showToast('Customer updated');await renderCustomers();
    };
  };
})();
