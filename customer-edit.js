// Editable customer profiles + notes + ownership + customer-level Sales/AR portfolio.
// Creator identity is kept in the database for audit, but is intentionally not shown in the UI.
(function(){
  function managerContext(){return typeof managerRepActive==='function'&&managerRepActive()}
  function managerBanner(){return managerContext()&&typeof managerRepBanner==='function'?managerRepBanner():''}
  function role(){return state.profile?.role||''}
  function isSalesUser(){return role()==='sales'}
  function canAssignHandler(){return ['super_admin','admin','manager'].includes(role())}
  function fmtDate(v){if(!v)return '-';const d=new Date(v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function norm(v=''){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function isPendingPre(o){const pre=['pre_order','mixed'].includes(norm(o?.order_type))||norm(o?.sales_flow_type)==='pre_order'||String(o?.sr_no||'').toUpperCase().startsWith('SR');return pre&&!o?.sales_invoice_no&&!o?.invoice_issued_at}
  function isSettled(o){return norm(o?.payment_status)==='paid'||Number(o?.balance_due||0)<=0.001}
  function metaFor(id){return window._customerAssignmentMeta?.get(id)||{}}
  function handlerName(c){
    const m=metaFor(c.id);
    if(m.assigned_sales_name)return m.assigned_sales_name;
    if(m.assigned_sales_email)return m.assigned_sales_email;
    if(c.assigned_sales_id===state.user?.id)return state.profile?.display_name||state.user?.email||'Me';
    return c.assigned_sales_id?'Assigned':'Unassigned';
  }
  function metricsFor(id){return window._customerSalesMetrics?.get(id)||{sales:0,paid:0,ar:0,pending:0,orders:0}}

  function customerCard(c){
    const note=String(c.notes||'').trim(),m=metricsFor(c.id);
    return `<div class="customer-edit-row bg-white border border-[#ece8e0] rounded-2xl px-4 py-3 grid lg:grid-cols-[1.15fr_.9fr_1fr_.85fr_.72fr_.72fr_.72fr_1.1fr_auto] gap-3 lg:gap-4 items-center shadow-[0_3px_14px_rgba(31,25,18,.025)]">
      <div class="min-w-0">
        <div class="font-bold text-[14px] truncate">${esc(c.name||'')}</div>
        <div class="flex flex-wrap gap-x-2 gap-y-0.5 mt-0.5 text-[9px] text-gray-400">${c.customer_code?`<span class="text-[#b3871e] font-bold">${esc(c.customer_code)}</span>`:''}<span>Since ${esc(fmtDate(c.created_at))}</span></div>
      </div>
      <div class="min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Contact</div><div class="text-[12px] text-gray-700 truncate">${esc(c.phone||'-')}</div><div class="text-[10px] text-gray-400 truncate">${esc(c.email||'')}</div></div>
      <div class="text-[12px] text-gray-500 min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Address</div><div class="truncate">${esc(c.address||'-')}</div></div>
      <div class="min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Handled By</div><span class="inline-flex max-w-full px-2 py-1 rounded-lg border border-amber-100 bg-amber-50 text-[10px] font-bold text-amber-800 truncate">${esc(handlerName(c))}</span></div>
      <div><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Sales</div><div class="text-[12px] font-bold text-gray-800">${money(m.sales)}</div><div class="text-[9px] text-gray-400">${m.orders} order${m.orders===1?'':'s'}</div></div>
      <div><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Received</div><div class="text-[12px] font-bold text-green-600">${money(m.paid)}</div></div>
      <div><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">AR</div><div class="text-[12px] font-bold ${m.ar>0?'text-red-500':'text-green-600'}">${money(m.ar)}</div></div>
      <div class="min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Note</div>${note?`<div class="text-[11px] text-gray-500 line-clamp-2" title="${esc(note)}">${esc(note)}</div>`:'<span class="text-[11px] text-gray-300">No note</span>'}</div>
      <div class="flex justify-end"><button onclick="openEditCustomer('${c.id}')" class="px-3 py-2 rounded-lg border border-gray-200 bg-white text-gray-700 text-xs font-semibold hover:bg-gray-50">Edit</button></div>
    </div>`;
  }

  window.renderCustomerEditRows=function(list){
    const root=document.getElementById('customerRows');if(!root)return;
    root.innerHTML=(list||[]).map(customerCard).join('')||empty('No customers yet.');
  };

  window.filterCustomerRows=function(){
    const q=(document.getElementById('customerSearch')?.value||'').trim().toLowerCase();
    const list=!q?state.customers:state.customers.filter(c=>{
      const m=metaFor(c.id),x=metricsFor(c.id);
      return [c.name,c.customer_code,c.phone,c.email,c.address,c.notes,m.assigned_sales_name,m.assigned_sales_email,fmtDate(c.created_at),x.sales,x.paid,x.ar].some(v=>String(v||'').toLowerCase().includes(q));
    });
    renderCustomerEditRows(list);
  };

  async function loadCustomerMeta(){
    const {data,error}=await db.rpc('get_visible_customer_assignment_meta');
    if(error){console.warn('Customer assignment metadata unavailable:',error.message);window._customerAssignmentMeta=new Map();return;}
    window._customerAssignmentMeta=new Map((data||[]).map(x=>[x.customer_id,x]));
  }

  async function loadCustomerSalesMetrics(){
    let q=db.from('sales_order_summary').select('customer_id,sales_rep_id,order_total,amount_paid,balance_due,status,payment_status,order_type,sales_flow_type,sr_no,sales_invoice_no,invoice_issued_at');
    if(isSalesUser())q=q.eq('sales_rep_id',state.user.id);
    else if(managerContext())q=q.eq('sales_rep_id',managerRepId());
    const {data,error}=await q;
    if(error){console.warn('Customer sales metrics unavailable:',error.message);window._customerSalesMetrics=new Map();return;}
    const map=new Map();
    for(const o of data||[]){
      if(String(o.status||'').toLowerCase()==='cancelled')continue;
      const x=map.get(o.customer_id)||{sales:0,paid:0,ar:0,pending:0,orders:0};
      x.sales+=Number(o.order_total||0);x.paid+=Number(o.amount_paid||0);if(isPendingPre(o)&&!isSettled(o))x.pending+=Number(o.balance_due||0);else if(!isSettled(o))x.ar+=Number(o.balance_due||0);x.orders+=1;
      map.set(o.customer_id,x);
    }
    window._customerSalesMetrics=map;
  }

  function portfolioTotals(){
    let sales=0,paid=0,ar=0,pending=0,orders=0;
    for(const c of state.customers||[]){const m=metricsFor(c.id);sales+=m.sales;paid+=m.paid;ar+=m.ar;pending+=Number(m.pending||0);orders+=m.orders;}
    return {sales,paid,ar,pending,orders};
  }

  window.renderCustomers=async function(){
    let q=db.from('customers').select('*').order('name');
    if(isSalesUser())q=q.eq('assigned_sales_id',state.user.id);
    else if(managerContext())q=q.eq('assigned_sales_id',managerRepId());
    const [cr]=await Promise.all([q,loadCustomerMeta(),loadCustomerSalesMetrics()]);
    const {data,error}=cr;if(error)throw error;
    state.customers=data||[];
    const t=portfolioTotals();
    const label=isSalesUser()?'My Customers':managerContext()?'Rep Customers':'Customers';
    const subtitle=isSalesUser()?'Your assigned customer portfolio, sales and AR':managerContext()?`${managerRepName()} customer portfolio, sales and AR`:'Customer master, ownership, sales and AR';
    const pt=document.getElementById('pageTitle'),ps=document.getElementById('pageSubtitle');if(pt)pt.textContent=label;if(ps)ps.textContent=subtitle;
    document.getElementById('content').innerHTML=`
      ${managerBanner()}
      <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
        ${kpi(label,state.customers.length,'Assigned customer profiles')}
        ${kpi('Sales',money(t.sales),`${t.orders} visible order${t.orders===1?'':'s'}`)}
        ${kpi('Amount Received',money(t.paid),'Customer payments','text-green-600')}
        ${kpi('Active Balance Due (AR)',money(t.ar),t.pending>0?'Pending pre-orders: '+money(t.pending):'Current collectible customer balance','text-red-600')}
      </div>
      <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
        <input id="customerSearch" oninput="filterCustomerRows()" class="border rounded-xl px-4 py-3 w-full max-w-xl bg-white" placeholder="Search customer, phone, handler, note...">
        <button onclick="openNewCustomer()" class="px-4 py-3 bg-[#211d18] text-white rounded-xl text-sm font-semibold whitespace-nowrap">+ Customer</button>
      </div>
      <div class="hidden lg:grid grid-cols-[1.15fr_.9fr_1fr_.85fr_.72fr_.72fr_.72fr_1.1fr_auto] gap-4 px-4 pb-2 text-[9px] uppercase tracking-wide font-bold text-gray-400">
        <div>Customer</div><div>Contact</div><div>Address</div><div>Handled By</div><div>Sales</div><div>Received</div><div>Active AR</div><div>Note</div><div></div>
      </div>
      <div id="customerRows" class="grid gap-2"></div>`;
    renderCustomerEditRows(state.customers);
  };

  async function handlerOptions(selectedId){
    if(!canAssignHandler())return '';
    const {data,error}=await db.from('app_users').select('user_id,display_name,email,role,active').in('role',['sales','manager']).eq('active',true).order('role').order('display_name');
    if(error)return '';
    return `<option value="">Unassigned</option>${(data||[]).map(u=>`<option value="${u.user_id}" ${u.user_id===selectedId?'selected':''}>${esc(u.display_name||u.email)} — ${u.role==='sales'?'Sales':'Manager'}</option>`).join('')}`;
  }

  window.openEditCustomer=async function(id){
    let c=(state.customers||[]).find(x=>x.id===id);
    if(!c){const r=await db.from('customers').select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');c=r.data;}
    const opts=await handlerOptions(c.assigned_sales_id),m=metricsFor(c.id);
    openModal(`Edit Customer — ${c.name||''}`,`
      <form id="editCustomerForm" class="grid md:grid-cols-2 gap-4">
        <div class="md:col-span-2 grid grid-cols-2 sm:grid-cols-5 gap-3 rounded-xl border bg-[#faf9f6] p-4">
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Customer Since</div><div class="text-sm font-semibold mt-1">${esc(fmtDate(c.created_at))}</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Current Handler</div><div class="text-sm font-semibold mt-1">${esc(handlerName(c))}</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Sales</div><div class="text-sm font-semibold mt-1">${money(m.sales)}</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Received</div><div class="text-sm font-semibold text-green-600 mt-1">${money(m.paid)}</div></div>
          <div><div class="text-[9px] uppercase font-bold text-gray-400">Active AR</div><div class="text-sm font-semibold ${m.ar>0?'text-red-500':'text-green-600'} mt-1">${money(m.ar)}</div>${m.pending>0?`<div class="text-[9px] text-blue-500 mt-0.5">+${money(m.pending)} pending pre-order</div>`:''}</div>
        </div>
        <div><label class="text-xs font-semibold">Customer Name</label><input id="editCustomerName" required value="${esc(c.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Customer Code</label><input id="editCustomerCode" value="${esc(c.customer_code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>
        <div><label class="text-xs font-semibold">Phone</label><input id="editCustomerPhone" value="${esc(c.phone||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Email</label><input id="editCustomerEmail" type="email" value="${esc(c.email||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><input id="editCustomerAddress" value="${esc(c.address||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        ${canAssignHandler()?`<div class="md:col-span-2"><label class="text-xs font-semibold">Handled By / Assigned Sales</label><select id="editCustomerHandler" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${opts}</select><div class="text-[10px] text-gray-400 mt-1">Changing this transfers the customer to another Sales Rep/Manager.</div></div>`:''}
        <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="editCustomerNotes" rows="4" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Preferences, project, delivery instructions, follow-up note...">${esc(c.notes||'')}</textarea><div class="text-[10px] text-gray-400 mt-1">This note stays on the customer profile and is searchable from the Customers page.</div></div>
        <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer Changes</button>
      </form>`);
    document.getElementById('editCustomerForm').onsubmit=async e=>{
      e.preventDefault();
      const patch={
        name:document.getElementById('editCustomerName').value.trim(),
        customer_code:document.getElementById('editCustomerCode').value.trim()||null,
        phone:document.getElementById('editCustomerPhone').value.trim()||null,
        email:document.getElementById('editCustomerEmail').value.trim()||null,
        address:document.getElementById('editCustomerAddress').value.trim()||null,
        notes:document.getElementById('editCustomerNotes').value.trim()||null,
        updated_at:new Date().toISOString()
      };
      if(canAssignHandler()&&document.getElementById('editCustomerHandler'))patch.assigned_sales_id=document.getElementById('editCustomerHandler').value||null;
      if(!patch.name)return showToast('Customer name is required.','err');
      const r=await db.from('customers').update(patch).eq('id',id).select('*').single();
      if(r.error)return showToast(r.error.message,'err');
      closeModal();showToast('Customer updated');await renderCustomers();
    };
  };
})();