// Global customer directory + multiple customer contact methods.
// Loaded last. Keeps Sales/AR private while allowing all staff to check customer ownership.
(function(){
  let directoryTimer=null;
  let customerPage=1;
  let customerPageSize=(function(){
    try{
      const v=sessionStorage.getItem('customer_page_size')||'20';
      return v==='all'?'all':([20,40].includes(Number(v))?Number(v):20);
    }catch(_){return 20}
  })();
  let customerCurrentList=null;
  const contactTypes=['phone','telegram','whatsapp','line','wechat','email','other'];

  function role(){return state.profile?.role||''}
  function managerContext(){return typeof managerRepActive==='function'&&managerRepActive()}
  function canAssignHandler(){return ['super_admin','admin','manager'].includes(role())}
  function fmtDate(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function metaFor(id){return window._customerAssignmentMeta?.get(id)||{}}
  function metricsFor(id){return window._customerSalesMetrics?.get(id)||{sales:0,paid:0,ar:0,pending:0,orders:0}}
  function handlerName(c){const m=metaFor(c.id);if(m.assigned_sales_name)return m.assigned_sales_name;if(m.assigned_sales_email)return m.assigned_sales_email;if(c.assigned_sales_id===state.user?.id)return state.profile?.display_name||state.user?.email||'Me';return c.assigned_sales_id?'Assigned':'Unassigned'}
  function contactsFor(id){return window._customerContactsMap?.get(id)||[]}
  function typeLabel(t){return ({phone:'Phone',telegram:'Telegram',whatsapp:'WhatsApp',line:'LINE',wechat:'WeChat',email:'Email',other:'Other'})[t]||titleCase(t||'Contact')}
  function contactIcon(t){return ({phone:'☎',telegram:'✈',whatsapp:'◉',line:'L',wechat:'W',email:'@',other:'•'})[t]||'•'}

  async function loadVisibleContacts(){
    const ids=(state.customers||[]).map(c=>c.id);
    if(!ids.length){window._customerContactsMap=new Map();return;}
    const {data,error}=await db.from('customer_contacts').select('*').in('customer_id',ids).order('created_at');
    if(error){console.warn('Customer contacts unavailable:',error.message);window._customerContactsMap=new Map();return;}
    const map=new Map();for(const x of data||[]){if(!map.has(x.customer_id))map.set(x.customer_id,[]);map.get(x.customer_id).push(x)}window._customerContactsMap=map;
  }

  function contactSummary(c){
    const cs=contactsFor(c.id);
    const source=cs.length?cs:[...(c.phone?[{contact_type:'phone',contact_value:c.phone}]:[]),...(c.email?[{contact_type:'email',contact_value:c.email}]:[])];
    if(!source.length)return '<span class="text-[11px] text-gray-300">No contact</span>';
    return `<div class="flex flex-wrap gap-1">${source.slice(0,3).map(x=>`<span class="inline-flex max-w-full items-center gap-1 rounded-md bg-gray-50 border px-1.5 py-1 text-[9px] text-gray-600"><span>${contactIcon(x.contact_type)}</span><span class="truncate max-w-[125px]">${esc(x.contact_value||'')}</span></span>`).join('')}${source.length>3?`<span class="text-[9px] text-gray-400 self-center">+${source.length-3}</span>`:''}</div>`;
  }

  function customerPageCount(total){
    if(customerPageSize==='all')return 1;
    return Math.max(1,Math.ceil(total/Number(customerPageSize||20)));
  }
  function pagedCustomers(list){
    customerCurrentList=list||[];
    const pages=customerPageCount((customerCurrentList||[]).length);
    if(customerPage>pages)customerPage=pages;
    if(customerPage<1)customerPage=1;
    if(customerPageSize==='all')return customerCurrentList;
    const start=(customerPage-1)*Number(customerPageSize);
    return customerCurrentList.slice(start,start+Number(customerPageSize));
  }
  function renderCustomerPager(){
    const root=document.getElementById('customerPager');
    if(!root)return;
    const total=customerCurrentList.length;
    const pages=customerPageCount(total);
    const all=customerPageSize==='all';
    const size=all?total:Number(customerPageSize||20);
    const start=total?(all?1:(customerPage-1)*size+1):0;
    const end=total?(all?total:Math.min(customerPage*size,total)):0;
    root.innerHTML=`
      <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div class="text-[11px] text-gray-500">Showing <b>${start}–${end}</b> of <b>${total}</b> customer${total===1?'':'s'}</div>
        <div class="flex items-center gap-2">
          <select onchange="setCustomerPageSize(this.value)" class="border rounded-lg bg-white px-2.5 py-2 text-xs">
            <option value="20" ${customerPageSize===20?'selected':''}>20 / page</option>
            <option value="40" ${customerPageSize===40?'selected':''}>40 / page</option>
            <option value="all" ${customerPageSize==='all'?'selected':''}>Show all</option>
          </select>
          ${all?'':`<button type="button" onclick="changeCustomerPage(-1)" ${customerPage<=1?'disabled':''} class="px-3 py-2 border rounded-lg bg-white text-xs font-semibold disabled:opacity-40">Prev</button><span class="text-[11px] text-gray-500 whitespace-nowrap">Page <b>${customerPage}</b> / ${pages}</span><button type="button" onclick="changeCustomerPage(1)" ${customerPage>=pages?'disabled':''} class="px-3 py-2 border rounded-lg bg-white text-xs font-semibold disabled:opacity-40">Next</button>`}
        </div>
      </div>`;
  }
  window.setCustomerPageSize=function(v){
    customerPageSize=v==='all'?'all':([20,40].includes(Number(v))?Number(v):20);
    customerPage=1;
    try{sessionStorage.setItem('customer_page_size',String(customerPageSize))}catch(_){}
    renderCustomerEditRows(Array.isArray(customerCurrentList)?customerCurrentList:(state.customers||[]));
  };
  window.changeCustomerPage=function(delta){
    const pages=customerPageCount(customerCurrentList.length);
    customerPage=Math.max(1,Math.min(pages,customerPage+Number(delta||0)));
    renderCustomerEditRows(customerCurrentList||[]);
    document.getElementById('customerRows')?.scrollIntoView({behavior:'smooth',block:'start'});
  };
  function ensureCustomerPager(){
    if(document.getElementById('customerPager'))return;
    const rows=document.getElementById('customerRows');
    const head=document.querySelector('#content .hidden.lg\\:grid');
    if(!rows)return;
    const p=document.createElement('div');
    p.id='customerPager';
    p.className='mb-3 rounded-xl border bg-[#faf9f6] px-3 py-2.5';
    if(head)head.parentNode.insertBefore(p,head);
    else rows.parentNode.insertBefore(p,rows);
  }

  // Replace only the row renderer. The existing Customers page still calculates the correct Sales/AR portfolio.
  window.renderCustomerEditRows=function(list){
    const root=document.getElementById('customerRows');if(!root)return;
    ensureCustomerPager();
    const pageRows=pagedCustomers(list||[]);
    root.innerHTML=pageRows.map(c=>{
      const note=String(c.notes||'').trim(),m=metricsFor(c.id);
      return `<div class="customer-edit-row bg-white border border-[#ece8e0] rounded-2xl px-4 py-3 grid lg:grid-cols-[1.12fr_1.18fr_1fr_.82fr_.72fr_.72fr_.72fr_1.05fr_auto] gap-3 lg:gap-4 items-center shadow-[0_3px_14px_rgba(31,25,18,.025)]">
        <div class="min-w-0"><div class="font-bold text-[14px] truncate">${esc(c.name||'')}</div><div class="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[9px] text-gray-400">${c.customer_code?`<span class="text-[#b3871e] font-bold">${esc(c.customer_code)}</span>`:''}<span>Since ${esc(fmtDate(c.created_at))}</span></div></div>
        <div class="min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Contacts</div>${contactSummary(c)}</div>
        <div class="text-[12px] text-gray-500 min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Address</div><div class="truncate">${esc(c.address||'-')}</div></div>
        <div class="min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Handled By</div><span class="inline-flex max-w-full px-2 py-1 rounded-lg border border-amber-100 bg-amber-50 text-[10px] font-bold text-amber-800 truncate">${esc(handlerName(c))}</span></div>
        <div><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Sales</div><div class="text-[12px] font-bold text-gray-800">${money(m.sales)}</div><div class="text-[9px] text-gray-400">${m.orders} order${m.orders===1?'':'s'}</div></div>
        <div><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Received</div><div class="text-[12px] font-bold text-green-600">${money(m.paid)}</div></div>
        <div><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Active AR</div><div class="text-[12px] font-bold ${m.ar>0?'text-red-500':'text-green-600'}">${money(m.ar)}</div>${m.pending>0?`<div class="text-[9px] text-blue-500">+${money(m.pending)} pending</div>`:''}</div>
        <div class="min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Note</div>${note?`<div class="text-[11px] text-gray-500 line-clamp-2" title="${esc(note)}">${esc(note)}</div>`:'<span class="text-[11px] text-gray-300">No note</span>'}</div>
        <div class="flex justify-end"><button onclick="openEditCustomer('${c.id}')" class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50">Edit</button></div>
      </div>`;
    }).join('')||empty('No customers yet.');
    renderCustomerPager();
  };

  window.filterCustomerRows=function(){
    customerPage=1;
    const q=(document.getElementById('customerSearch')?.value||'').trim().toLowerCase();
    const list=!q?state.customers:state.customers.filter(c=>{
      const x=metricsFor(c.id),contacts=contactsFor(c.id).flatMap(v=>[v.contact_type,v.label,v.contact_value]);
      return [c.name,c.customer_code,c.phone,c.email,c.address,c.notes,fmtDate(c.created_at),x.sales,x.paid,x.ar,...contacts].some(v=>String(v||'').toLowerCase().includes(q));
    });
    renderCustomerEditRows(list);
  };

  const baseRenderCustomers=window.renderCustomers;
  window.renderCustomers=async function(){
    await baseRenderCustomers.apply(this,arguments);
    await loadVisibleContacts();
    customerPage=1;
    const head=document.querySelector('#content .hidden.lg\\:grid');
    if(head){const cols=head.children;if(cols[1])cols[1].textContent='Contacts';}
    ensureCustomerPager();
    renderCustomerEditRows(state.customers||[]);
  };

  function contactTypeOptions(selected='phone'){return contactTypes.map(t=>`<option value="${t}" ${t===selected?'selected':''}>${typeLabel(t)}</option>`).join('')}
  function contactRow(x={}){return `<div class="customer-contact-row grid grid-cols-[135px_120px_minmax(0,1fr)_44px] gap-2 items-end p-2.5 bg-gray-50 border rounded-xl">
    <div><label class="text-[9px] uppercase font-bold text-gray-400">Type</label><select class="cc-type mt-1 w-full border rounded-lg px-2 py-2 bg-white text-xs">${contactTypeOptions(x.contact_type||'phone')}</select></div>
    <div><label class="text-[9px] uppercase font-bold text-gray-400">Label</label><input class="cc-label mt-1 w-full border rounded-lg px-2 py-2 text-xs" value="${esc(x.label||'')}" placeholder="Main, Office..."></div>
    <div><label class="text-[9px] uppercase font-bold text-gray-400">Number / Username</label><input class="cc-value mt-1 w-full border rounded-lg px-3 py-2 text-xs" value="${esc(x.contact_value||'')}" placeholder="012..., @telegram, WhatsApp..."></div>
    <button type="button" onclick="this.closest('.customer-contact-row').remove()" class="h-[34px] border rounded-lg text-red-500 font-bold">×</button>
  </div>`}
  window.addCustomerContactRow=function(type='phone'){document.getElementById('customerContactRows')?.insertAdjacentHTML('beforeend',contactRow({contact_type:type}))}
  function readContactRows(){return [...document.querySelectorAll('#customerContactRows .customer-contact-row')].map(r=>({contact_type:r.querySelector('.cc-type').value,label:r.querySelector('.cc-label').value.trim()||null,contact_value:r.querySelector('.cc-value').value.trim()})).filter(x=>x.contact_value)}

  async function handlerOptions(selected=''){
    if(!canAssignHandler())return '';
    const {data,error}=await db.from('app_users').select('user_id,display_name,email,role,active').in('role',['sales','manager']).eq('active',true).order('role').order('display_name');
    if(error)return '<option value="">Unassigned</option>';
    return `<option value="">Unassigned</option>${(data||[]).map(u=>`<option value="${u.user_id}" ${u.user_id===selected?'selected':''}>${esc(u.display_name||u.email)} — ${u.role==='sales'?'Sales':(u.user_id===state.user?.id?'Manager (Me)':'Manager')}</option>`).join('')}`;
  }
  function effectiveHandler(){if(role()==='sales')return state.user.id;if(managerContext())return managerRepId();return null}

  window.openNewCustomer=async function(){
    const fixed=effectiveHandler(),opts=await handlerOptions(fixed||'');
    openModal('Add Customer',`<form id="multiCustomerForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Customer Name</label><input id="mcName" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Customer name"></div>
      <div><label class="text-xs font-semibold">Customer Code</label><input id="mcCode" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><input id="mcAddress" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Address"></div>
      ${(canAssignHandler()&&!fixed)
        ?`<div class="md:col-span-2"><label class="text-xs font-semibold">Assign Customer To</label><select id="mcHandler" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${opts}</select><div class="text-[10px] text-gray-400 mt-1">${role()==='manager'?'Optional — leave Unassigned, choose a Sales Rep, or choose yourself as Manager.':'Optional. Leave Unassigned and assign later if preferred.'}</div></div>`
        :`<div class="md:col-span-2 rounded-xl border bg-gray-50 px-4 py-3 text-xs text-gray-600">
            Handled by: <b>${esc(role()==='sales'
              ?(state.profile?.display_name||state.user?.email||'You')
              :(managerContext()?managerRepName():'Unassigned'))}</b>
            ${role()==='manager'&&!managerContext()?'<div class="text-[10px] text-gray-400 mt-1">Customer will be created immediately. You can assign it to a Sales Rep afterward from Edit Customer.</div>':''}
          </div>`}
      <div class="md:col-span-2 border-t pt-4"><div class="flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Contact Methods</div><div class="text-[10px] text-gray-400">Add multiple phone numbers, Telegram users, WhatsApp, LINE, WeChat or email.</div></div><button type="button" onclick="addCustomerContactRow('phone')" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Contact</button></div><div id="customerContactRows" class="grid gap-2 mt-3">${contactRow({contact_type:'phone',label:'Main'})}${contactRow({contact_type:'telegram',label:'Telegram'})}</div></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="mcNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Preferences, project, delivery instructions, follow-up note..."></textarea></div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer</button>
    </form>`);
    document.getElementById('multiCustomerForm').onsubmit=saveMultiCustomer;
  };

  async function saveMultiCustomer(e){
    e.preventDefault();
    const contacts=readContactRows(),firstPhone=contacts.find(x=>x.contact_type==='phone')?.contact_value||null,firstEmail=contacts.find(x=>x.contact_type==='email')?.contact_value||null;
    const handler=effectiveHandler()||(document.getElementById('mcHandler')?.value||null);
    const row={name:document.getElementById('mcName').value.trim(),customer_code:document.getElementById('mcCode').value.trim()||null,address:document.getElementById('mcAddress').value.trim()||null,notes:document.getElementById('mcNotes').value.trim()||null,phone:firstPhone,email:firstEmail,assigned_sales_id:handler,created_by:state.user.id,active:true};
    if(!row.name)return showToast('Customer name is required.','err');
    const cr=await db.from('customers').insert(row).select('id').single();if(cr.error)return showToast(cr.error.message,'err');
    if(contacts.length){const ci=await db.from('customer_contacts').insert(contacts.map((x,i)=>({...x,customer_id:cr.data.id,is_primary:i===0,created_by:state.user.id})));if(ci.error)return showToast(`Customer saved, but contacts could not be saved: ${ci.error.message}`,'err');}
    if(managerContext()&&typeof recordManagerRepAction==='function')await recordManagerRepAction('create_customer','customer',cr.data.id,{customer_name:row.name});
    closeModal();
    if(role()==='manager'&&!managerContext()){
      const selected=document.getElementById('mcHandler');
      const selectedText=handler&&selected?.selectedOptions?.[0]?.textContent?.trim();
      if(handler===state.user.id)showToast('Customer added and assigned to you');
      else if(handler)showToast(`Customer added and assigned to ${selectedText||'selected Sales Rep'}`);
      else showToast('Customer added as Unassigned');
    }
    else if(managerContext())showToast(`Customer added and assigned to ${managerRepName()}`);
    else showToast('Customer added');
    await go('customers');
  }

  window.openEditCustomer=async function(id){
    let c=(state.customers||[]).find(x=>x.id===id);if(!c){const r=await db.from('customers').select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');c=r.data;}
    const [cc,opts]=await Promise.all([db.from('customer_contacts').select('*').eq('customer_id',id).order('created_at'),handlerOptions(c.assigned_sales_id)]);if(cc.error)return showToast(cc.error.message,'err');
    const m=metricsFor(c.id),cs=cc.data||[];
    openModal(`Edit Customer — ${c.name||''}`,`<form id="multiEditCustomerForm" class="grid md:grid-cols-2 gap-4">
      <div class="md:col-span-2 grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border bg-[#faf9f6] p-4"><div><div class="text-[9px] uppercase font-bold text-gray-400">Customer Since</div><div class="text-sm font-semibold mt-1">${esc(fmtDate(c.created_at))}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Current Handler</div><div class="text-sm font-semibold mt-1">${esc(handlerName(c))}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Sales</div><div class="text-sm font-semibold mt-1">${money(m.sales)}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Received</div><div class="text-sm font-semibold text-green-600 mt-1">${money(m.paid)}</div></div><div><div class="text-[9px] uppercase font-bold text-gray-400">AR</div><div class="text-sm font-semibold ${m.ar>0?'text-red-500':'text-green-600'} mt-1">${money(m.ar)}</div></div></div>
      <div><label class="text-xs font-semibold">Customer Name</label><input id="mecName" required value="${esc(c.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Customer Code</label><input id="mecCode" value="${esc(c.customer_code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><input id="mecAddress" value="${esc(c.address||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      ${canAssignHandler()?`<div class="md:col-span-2"><label class="text-xs font-semibold">Assign / Reassign Sales Rep</label><select id="mecHandler" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${opts}</select><div class="text-[10px] text-gray-400 mt-1">${role()==='manager'?'Manager can assign an unassigned customer or transfer the customer to another Sales Rep.':'Changing this transfers the customer portfolio to another Sales Rep/Manager.'}</div></div>`:''}
      <div class="md:col-span-2 border-t pt-4"><div class="flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Contact Methods</div><div class="text-[10px] text-gray-400">Phone numbers and social usernames can be added, edited or removed.</div></div><button type="button" onclick="addCustomerContactRow('phone')" class="px-3 py-2 border rounded-lg text-xs font-semibold">+ Contact</button></div><div id="customerContactRows" class="grid gap-2 mt-3">${(cs.length?cs:[...(c.phone?[{contact_type:'phone',label:'Main',contact_value:c.phone}]:[]),...(c.email?[{contact_type:'email',label:'Email',contact_value:c.email}]:[])]).map(contactRow).join('')||contactRow({contact_type:'phone',label:'Main'})}</div></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="mecNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(c.notes||'')}</textarea></div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer Changes</button>
    </form>`);
    document.getElementById('multiEditCustomerForm').onsubmit=async e=>{
      e.preventDefault();const contacts=readContactRows(),firstPhone=contacts.find(x=>x.contact_type==='phone')?.contact_value||null,firstEmail=contacts.find(x=>x.contact_type==='email')?.contact_value||null;
      const patch={name:document.getElementById('mecName').value.trim(),customer_code:document.getElementById('mecCode').value.trim()||null,address:document.getElementById('mecAddress').value.trim()||null,notes:document.getElementById('mecNotes').value.trim()||null,phone:firstPhone,email:firstEmail,updated_at:new Date().toISOString()};
      if(canAssignHandler()&&document.getElementById('mecHandler'))patch.assigned_sales_id=document.getElementById('mecHandler').value||null;if(!patch.name)return showToast('Customer name is required.','err');
      const up=await db.from('customers').update(patch).eq('id',id);if(up.error)return showToast(up.error.message,'err');
      const del=await db.from('customer_contacts').delete().eq('customer_id',id);if(del.error)return showToast(del.error.message,'err');
      if(contacts.length){const ins=await db.from('customer_contacts').insert(contacts.map((x,i)=>({...x,customer_id:id,is_primary:i===0,created_by:state.user.id})));if(ins.error)return showToast(ins.error.message,'err');}
      closeModal();showToast('Customer updated');await renderCustomers();
    };
  };

  function directoryPanel(){return `<div id="globalCustomerDirectory" class="card rounded-2xl p-4 mb-5"><div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3"><div><h3 class="font-bold">Customer Directory Check</h3><p class="text-[11px] text-gray-400 mt-0.5">Search all company customers before engaging them. Sales/AR, notes and addresses remain private to the assigned team.</p></div><div class="relative w-full lg:max-w-xl"><input id="globalCustomerSearch" oninput="globalCustomerSearchChanged(this.value)" class="w-full border rounded-xl px-4 py-3 pr-10 bg-white" placeholder="Search all customers: name, phone, Telegram, WhatsApp..."><span class="absolute right-3 top-3 text-gray-400">⌕</span></div></div><div id="globalCustomerResults" class="hidden mt-3 border-t pt-3"></div></div>`}

  function renderDirectoryResults(rows,q){
    const root=document.getElementById('globalCustomerResults');if(!root)return;
    if(String(q||'').trim().length<2){root.classList.add('hidden');root.innerHTML='';return;}
    root.classList.remove('hidden');
    if(!rows?.length){root.innerHTML='<div class="py-3 text-xs text-gray-400">No matching customer found.</div>';return;}
    root.innerHTML=`<div class="grid gap-2">${rows.map(r=>{
      const cs=Array.isArray(r.contacts)?r.contacts:[];const owner=r.is_own?'My Customer':(r.handled_by_name||r.handled_by_email?`Handled by ${r.handled_by_name||r.handled_by_email}`:'Unassigned');
      return `<div class="rounded-xl border bg-white px-4 py-3 flex flex-col md:flex-row md:items-center md:justify-between gap-3"><div class="min-w-0"><div class="flex flex-wrap items-center gap-2"><b>${esc(r.customer_name||'')}</b>${r.customer_code?`<span class="text-[9px] font-bold text-[#b3871e]">${esc(r.customer_code)}</span>`:''}<span class="px-2 py-1 rounded-md text-[9px] font-bold ${r.is_own?'bg-green-50 border border-green-200 text-green-700':'bg-amber-50 border border-amber-200 text-amber-800'}">${esc(owner)}</span></div><div class="flex flex-wrap gap-1 mt-2">${cs.slice(0,6).map(c=>`<span class="inline-flex items-center gap-1 px-2 py-1 bg-gray-50 border rounded-md text-[10px] text-gray-600"><b>${esc(typeLabel(c.type))}:</b> ${esc(c.value||'')}</span>`).join('')||'<span class="text-[10px] text-gray-400">No contact saved</span>'}</div></div>${r.is_own?'<button onclick="go(\'customers\')" class="px-3 py-2 border rounded-lg text-xs font-semibold whitespace-nowrap">Open My Customers</button>':''}</div>`;
    }).join('')}</div>`;
  }

  window.globalCustomerSearchChanged=function(v){clearTimeout(directoryTimer);const q=String(v||'').trim();if(q.length<2){renderDirectoryResults([],q);return;}directoryTimer=setTimeout(async()=>{const root=document.getElementById('globalCustomerResults');if(root){root.classList.remove('hidden');root.innerHTML='<div class="py-3 text-xs text-gray-400">Searching...</div>';}const {data,error}=await db.rpc('search_customer_directory',{p_query:q});if(error){if(root)root.innerHTML=`<div class="py-3 text-xs text-red-500">${esc(error.message)}</div>`;return;}renderDirectoryResults(data||[],q);},250)};

  function mountDashboardCustomerSearch(){
    const content=document.getElementById('content');
    if(!content||document.getElementById('globalCustomerDirectory'))return;
    const wrap=document.createElement('div');
    wrap.innerHTML=directoryPanel();
    const panel=wrap.firstElementChild;
    const banner=content.firstElementChild?.classList?.contains('mb-5')&&content.firstElementChild?.textContent?.includes('Manager Rep Workspace')?content.firstElementChild:null;
    if(banner&&banner.nextSibling)content.insertBefore(panel,banner.nextSibling);
    else content.insertBefore(panel,content.firstChild);
  }

  const baseDashboard=window.renderDashboard;
  window.renderDashboard=async function(){
    await baseDashboard.apply(this,arguments);
    mountDashboardCustomerSearch();
    requestAnimationFrame(mountDashboardCustomerSearch);
    setTimeout(mountDashboardCustomerSearch,60);
  };
})();