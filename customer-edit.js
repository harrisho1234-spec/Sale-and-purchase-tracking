// Editable customer profiles + notes.
// Loaded last so Customers stays consistent in normal and Manager Rep Workspace views.
(function(){
  function managerContext(){return typeof managerRepActive==='function'&&managerRepActive()}
  function managerBanner(){return managerContext()&&typeof managerRepBanner==='function'?managerRepBanner():''}

  function customerCard(c){
    const note=String(c.notes||'').trim();
    return `<div class="customer-edit-row bg-white border border-[#ece8e0] rounded-2xl px-5 py-4 grid lg:grid-cols-[1.2fr_.8fr_1fr_1.2fr_1.4fr_auto] gap-3 lg:gap-5 items-center shadow-[0_3px_14px_rgba(31,25,18,.025)]">
      <div class="min-w-0"><div class="font-bold text-[15px] truncate">${esc(c.name||'')}</div>${c.customer_code?`<div class="text-[10px] text-[#b3871e] font-bold mt-0.5">${esc(c.customer_code)}</div>`:''}</div>
      <div class="text-sm text-gray-700"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Phone</div>${esc(c.phone||'-')}</div>
      <div class="text-sm text-gray-500 min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Email</div><div class="truncate">${esc(c.email||'-')}</div></div>
      <div class="text-sm text-gray-500 min-w-0"><div class="lg:hidden text-[9px] uppercase text-gray-400 font-bold mb-1">Address</div><div class="truncate">${esc(c.address||'-')}</div></div>
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
    const list=!q?state.customers:state.customers.filter(c=>[
      c.name,c.customer_code,c.phone,c.email,c.address,c.notes
    ].some(v=>String(v||'').toLowerCase().includes(q)));
    renderCustomerEditRows(list);
  };

  window.renderCustomers=async function(){
    let q=db.from('customers').select('*').order('name');
    if(managerContext())q=q.eq('assigned_sales_id',managerRepId());
    const {data,error}=await q;if(error)throw error;
    state.customers=data||[];
    document.getElementById('content').innerHTML=`
      ${managerBanner()}
      <div class="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between mb-4">
        <input id="customerSearch" oninput="filterCustomerRows()" class="border rounded-xl px-4 py-3 w-full max-w-xl bg-white" placeholder="Search customer, phone, address, note...">
        <button onclick="openNewCustomer()" class="px-4 py-3 bg-[#211d18] text-white rounded-xl text-sm font-semibold whitespace-nowrap">+ Customer</button>
      </div>
      <div class="hidden lg:grid grid-cols-[1.2fr_.8fr_1fr_1.2fr_1.4fr_auto] gap-5 px-5 pb-2 text-[9px] uppercase tracking-wide font-bold text-gray-400">
        <div>Customer</div><div>Phone</div><div>Email</div><div>Address</div><div>Note</div><div></div>
      </div>
      <div id="customerRows" class="grid gap-2"></div>`;
    renderCustomerEditRows(state.customers);
  };

  window.openEditCustomer=async function(id){
    let c=(state.customers||[]).find(x=>x.id===id);
    if(!c){const r=await db.from('customers').select('*').eq('id',id).single();if(r.error)return showToast(r.error.message,'err');c=r.data;}
    openModal(`Edit Customer — ${c.name||''}`,`
      <form id="editCustomerForm" class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Customer Name</label><input id="editCustomerName" required value="${esc(c.name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Customer Code</label><input id="editCustomerCode" value="${esc(c.customer_code||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>
        <div><label class="text-xs font-semibold">Phone</label><input id="editCustomerPhone" value="${esc(c.phone||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Email</label><input id="editCustomerEmail" type="email" value="${esc(c.email||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><input id="editCustomerAddress" value="${esc(c.address||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
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
      if(!patch.name)return showToast('Customer name is required.','err');
      const r=await db.from('customers').update(patch).eq('id',id).select('*').single();
      if(r.error)return showToast(r.error.message,'err');
      const idx=state.customers.findIndex(x=>x.id===id);if(idx>=0)state.customers[idx]=r.data;
      closeModal();showToast('Customer updated');await renderCustomers();
    };
  };
})();