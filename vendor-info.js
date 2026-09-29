// Central Vendor Master for Procurement and Product Costing.
(function(){
  const vm={rows:[],loaded:false};

  function roleAllowed(){return ['admin','super_admin'].includes(state.profile?.role||'')}
  function clean(v){return String(v==null?'':v).trim()}
  function fmtVendor(v){return v?[`${v.name||''}`,v.vendor_code||''].filter(Boolean).join(' · '):''}
  function contactSummary(v){return [v.contact_person,v.phone,v.email].filter(Boolean).join(' · ')||'No contact information'}
  function termsSummary(v){return [v.payment_terms,v.shipping_terms,v.lead_time_days!=null?`${v.lead_time_days} day lead time`:null].filter(Boolean).join(' · ')||'No purchasing terms yet'}

  window.loadVendorMaster=async function(force=false){
    if(!roleAllowed())return [];
    if(vm.loaded&&!force)return vm.rows;
    const {data,error}=await db.from('vendors').select('*').order('active',{ascending:false}).order('name');
    if(error)throw error;
    vm.rows=data||[];
    vm.loaded=true;
    window.vendorMasterRows=vm.rows;
    return vm.rows;
  };

  window.vendorMasterDisplay=fmtVendor;

  window.vendorMasterOptionsHtml=function(activeOnly=true){
    return (vm.rows||[])
      .filter(v=>!activeOnly||v.active)
      .map(v=>`<option value="${esc(fmtVendor(v))}"></option><option value="${esc(v.name||'')}"></option>`)
      .join('');
  };

  window.findVendorMaster=function(value){
    const raw=clean(value);if(!raw)return null;
    const low=raw.toLowerCase();
    const prefix=raw.split(' · ')[0].trim().toLowerCase();
    return (vm.rows||[]).find(v=>String(v.id)===raw)
      ||(vm.rows||[]).find(v=>clean(v.name).toLowerCase()===low)
      ||(vm.rows||[]).find(v=>clean(v.vendor_code).toLowerCase()===low)
      ||(vm.rows||[]).find(v=>clean(v.name).toLowerCase()===prefix)
      ||(vm.rows||[]).find(v=>fmtVendor(v).toLowerCase()===low)
      ||null;
  };

  window.vendorSelectionInfo=function(v){
    if(!v)return '';
    const formula=clean(v.sales_price_formula);
    const bits=[
      v.default_currency?`Currency: ${v.default_currency}`:null,
      v.payment_terms?`Payment: ${v.payment_terms}`:null,
      v.shipping_terms?`Shipping: ${v.shipping_terms}`:null,
      v.lead_time_days!=null?`Lead time: ${v.lead_time_days} days`:null,
      v.default_markup_percent!=null?`Markup: ${Number(v.default_markup_percent).toFixed(2)}%`:null,
      formula?`Formula: ${formula.length>120?formula.slice(0,117)+'...':formula}`:null
    ].filter(Boolean);
    return bits.join(' · ');
  };

  window.applyVendorMasterSelection=function(input,hiddenId,currencyId,infoId){
    const v=findVendorMaster(input?.value||'');
    const hidden=document.getElementById(hiddenId);
    if(hidden)hidden.value=v?.id||'';
    if(v&&input)input.value=v.name||input.value;
    const cur=document.getElementById(currencyId);
    if(v&&cur&&v.default_currency){
      cur.value=v.default_currency;
      cur.dispatchEvent(new Event('change',{bubbles:true}));
    }
    const info=document.getElementById(infoId);
    if(info){
      info.textContent=v?vendorSelectionInfo(v):clean(input?.value)?'Not linked to Vendor Info. You can still save, but add/link this vendor later for consistency.':'';
      info.className=v?'text-[10px] text-blue-600 mt-1':'text-[10px] text-amber-600 mt-1';
    }
    return v;
  };

  function vendorForm(v){
    v=v||{};
    return `<form id="vendorInfoForm" class="space-y-5">
      <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Vendor Master.</b> This information is reused in Supplier POs and Product Costing. Updating a vendor does not rewrite historical PO text snapshots.</div>

      <div class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Vendor Name *</label><input id="viName" value="${esc(v.name||'')}" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Company / supplier name"></div>
        <div><label class="text-xs font-semibold">Vendor Code</label><input value="${esc(v.vendor_code||'Automatic')}" readonly class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-gray-50 font-semibold"></div>
        <div><label class="text-xs font-semibold">Legal / Company Name</label><input id="viLegal" value="${esc(v.legal_name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Main Contact Person</label><input id="viContact" value="${esc(v.contact_person||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Phone</label><input id="viPhone" value="${esc(v.phone||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Email</label><input id="viEmail" type="email" value="${esc(v.email||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">WhatsApp</label><input id="viWhatsApp" value="${esc(v.whatsapp||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Telegram</label><input id="viTelegram" value="${esc(v.telegram||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">WeChat</label><input id="viWechat" value="${esc(v.wechat||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Website</label><input id="viWebsite" value="${esc(v.website||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      </div>

      <div class="border-t pt-5">
        <h4 class="font-bold mb-3">Address & Purchasing Defaults</h4>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="text-xs font-semibold">Country</label><input id="viCountry" value="${esc(v.country||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">City</label><input id="viCity" value="${esc(v.city||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div class="md:col-span-2"><label class="text-xs font-semibold">Address</label><textarea id="viAddress" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(v.address||'')}</textarea></div>
          <div><label class="text-xs font-semibold">Default Currency</label><select id="viCurrency" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${['USD','EUR','CNY','GBP'].map(x=>`<option value="${x}" ${x===(v.default_currency||'USD')?'selected':''}>${x}</option>`).join('')}</select></div>
          <div><label class="text-xs font-semibold">Lead Time (days)</label><input id="viLead" type="number" min="0" step="1" value="${v.lead_time_days==null?'':Number(v.lead_time_days)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Payment Terms</label><input id="viPayment" value="${esc(v.payment_terms||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: 30% deposit, 70% before shipping"></div>
          <div><label class="text-xs font-semibold">Deposit Terms</label><input id="viDeposit" value="${esc(v.deposit_terms||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Shipping / Incoterms</label><input id="viShipping" value="${esc(v.shipping_terms||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="EXW / FOB / CIF / vendor delivery..."></div>
          <div><label class="text-xs font-semibold">MOQ / Minimum Order</label><input id="viMOQ" value="${esc(v.moq_terms||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        </div>
      </div>

      <div class="border-t pt-5">
        <h4 class="font-bold mb-3">Sales Price Formula</h4>
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="text-xs font-semibold">Default Markup %</label><input id="viMarkup" type="number" min="0" step="0.01" value="${v.default_markup_percent==null?'':Number(v.default_markup_percent)}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional"></div>
          <div class="md:col-span-2"><label class="text-xs font-semibold">Formula / Pricing Rule</label><textarea id="viFormula" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: (Cost + shipping) × 1.80, then round to nearest $10">${esc(v.sales_price_formula||'')}</textarea><div class="text-[10px] text-gray-400 mt-1">Stored as the vendor's pricing rule for reference. We can later automate the formula once each vendor rule is finalized.</div></div>
        </div>
      </div>

      <div class="border-t pt-5 grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">Warranty / After-sales Terms</label><textarea id="viWarranty" rows="4" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(v.warranty_terms||'')}</textarea></div>
        <div><label class="text-xs font-semibold">Terms & Conditions</label><textarea id="viTerms" rows="4" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(v.terms_conditions||'')}</textarea></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Internal Notes</label><textarea id="viNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(v.notes||'')}</textarea></div>
        <label class="md:col-span-2 flex items-center gap-2 text-sm"><input id="viActive" type="checkbox" ${v.active!==false?'checked':''}> Active vendor</label>
      </div>

      <button id="viSaveBtn" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Vendor</button>
    </form>`;
  }

  function formRow(){
    return {
      name:clean(document.getElementById('viName')?.value),
      legal_name:clean(document.getElementById('viLegal')?.value)||null,
      contact_person:clean(document.getElementById('viContact')?.value)||null,
      phone:clean(document.getElementById('viPhone')?.value)||null,
      email:clean(document.getElementById('viEmail')?.value)||null,
      whatsapp:clean(document.getElementById('viWhatsApp')?.value)||null,
      telegram:clean(document.getElementById('viTelegram')?.value)||null,
      wechat:clean(document.getElementById('viWechat')?.value)||null,
      website:clean(document.getElementById('viWebsite')?.value)||null,
      country:clean(document.getElementById('viCountry')?.value)||null,
      city:clean(document.getElementById('viCity')?.value)||null,
      address:clean(document.getElementById('viAddress')?.value)||null,
      default_currency:document.getElementById('viCurrency')?.value||'USD',
      payment_terms:clean(document.getElementById('viPayment')?.value)||null,
      deposit_terms:clean(document.getElementById('viDeposit')?.value)||null,
      shipping_terms:clean(document.getElementById('viShipping')?.value)||null,
      lead_time_days:clean(document.getElementById('viLead')?.value)===''?null:Number(document.getElementById('viLead').value),
      moq_terms:clean(document.getElementById('viMOQ')?.value)||null,
      sales_price_formula:clean(document.getElementById('viFormula')?.value)||null,
      default_markup_percent:clean(document.getElementById('viMarkup')?.value)===''?null:Number(document.getElementById('viMarkup').value),
      warranty_terms:clean(document.getElementById('viWarranty')?.value)||null,
      terms_conditions:clean(document.getElementById('viTerms')?.value)||null,
      notes:clean(document.getElementById('viNotes')?.value)||null,
      active:!!document.getElementById('viActive')?.checked,
      updated_by:state.user.id
    };
  }

  window.openNewVendorInfo=async function(){
    if(!roleAllowed())return showToast('Admin access required.','err');
    openModal('Add Vendor',vendorForm(null));
    document.getElementById('vendorInfoForm').onsubmit=async e=>{
      e.preventDefault();
      const row=formRow();
      if(!row.name)return showToast('Vendor name is required.','err');
      row.created_by=state.user.id;
      const btn=document.getElementById('viSaveBtn');btn.disabled=true;btn.textContent='Saving...';
      const {error}=await db.from('vendors').insert(row);
      if(error){btn.disabled=false;btn.textContent='Save Vendor';return showToast(error.message,'err')}
      vm.loaded=false;closeModal();showToast('Vendor added.');await renderProcurementWorkspace();
    };
  };

  window.openEditVendorInfo=async function(id){
    if(!roleAllowed())return;
    await loadVendorMaster();
    const v=vm.rows.find(x=>x.id===id);
    if(!v)return showToast('Vendor not found.','err');
    openModal('Edit Vendor — '+v.name,vendorForm(v));
    document.getElementById('vendorInfoForm').onsubmit=async e=>{
      e.preventDefault();
      const row=formRow();
      if(!row.name)return showToast('Vendor name is required.','err');
      const btn=document.getElementById('viSaveBtn');btn.disabled=true;btn.textContent='Saving...';
      const {error}=await db.from('vendors').update(row).eq('id',id);
      if(error){btn.disabled=false;btn.textContent='Save Vendor';return showToast(error.message,'err')}
      vm.loaded=false;closeModal();showToast('Vendor updated.');await renderProcurementWorkspace();
    };
  };

  window.toggleVendorInfoActive=async function(id,active){
    if(!roleAllowed())return;
    const {error}=await db.from('vendors').update({active,updated_by:state.user.id}).eq('id',id);
    if(error)return showToast(error.message,'err');
    vm.loaded=false;showToast(active?'Vendor activated.':'Vendor made inactive.');await renderProcurementWorkspace();
  };

  window.renderVendorInfoBody=async function(search=''){
    if(!roleAllowed())throw new Error('Admin access required');
    const [vendors,poRes,pvRes]=await Promise.all([
      loadVendorMaster(),
      db.from('supplier_pos').select('vendor_id'),
      db.from('product_vendors').select('vendor_id,product_id')
    ]);
    if(poRes.error)throw poRes.error;if(pvRes.error)throw pvRes.error;

    const poCounts=new Map();
    (poRes.data||[]).forEach(x=>x.vendor_id&&poCounts.set(x.vendor_id,(poCounts.get(x.vendor_id)||0)+1));
    const productCounts=new Map();
    (pvRes.data||[]).forEach(x=>x.vendor_id&&productCounts.set(x.vendor_id,(productCounts.get(x.vendor_id)||0)+1));

    const q=clean(search).toLowerCase();
    const rows=vendors.filter(v=>!q||[
      v.name,v.vendor_code,v.legal_name,v.contact_person,v.phone,v.email,v.country,v.city,
      v.default_currency,v.payment_terms,v.shipping_terms,v.sales_price_formula,v.notes
    ].filter(Boolean).join(' ').toLowerCase().includes(q));

    const active=vendors.filter(v=>v.active).length;
    const inactive=vendors.length-active;

    return `<div class="grid sm:grid-cols-3 gap-3 mb-4">
      <div class="pw-stat"><div class="pw-stat-label">Vendors</div><div class="pw-stat-value">${vendors.length}</div></div>
      <div class="pw-stat"><div class="pw-stat-label">Active</div><div class="pw-stat-value text-green-600">${active}</div></div>
      <div class="pw-stat"><div class="pw-stat-label">Inactive</div><div class="pw-stat-value text-gray-400">${inactive}</div></div>
    </div>
    <div class="pw-grid">${rows.length?rows.map(v=>`<div class="pw-card">
      <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2"><b class="text-base">${esc(v.name)}</b><span class="lr-badge lr-badge-gray">${esc(v.vendor_code)}</span><span class="lr-badge ${v.active?'lr-badge-green':'lr-badge-gray'}">${v.active?'Active':'Inactive'}</span><span class="lr-badge lr-badge-blue">${esc(v.default_currency||'USD')}</span></div>
          <div class="text-xs text-gray-500 mt-2">${esc(contactSummary(v))}</div>
          <div class="text-[10px] text-gray-400 mt-1">${esc([v.city,v.country].filter(Boolean).join(', ')||v.address||'No address')}</div>
          <div class="grid md:grid-cols-2 gap-3 mt-4">
            <div class="rounded-xl bg-gray-50 border p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Purchasing Terms</div><div class="text-xs mt-1">${esc(termsSummary(v))}</div>${v.moq_terms?`<div class="text-[10px] text-gray-500 mt-1">MOQ: ${esc(v.moq_terms)}</div>`:''}</div>
            <div class="rounded-xl bg-[#fffaf0] border border-amber-100 p-3"><div class="text-[9px] uppercase font-bold text-amber-700">Sales Price Formula</div><div class="text-xs mt-1">${esc(v.sales_price_formula||'No formula saved')}${v.default_markup_percent!=null?`<div class="text-[10px] text-amber-700 mt-1">Default markup: ${Number(v.default_markup_percent).toFixed(2)}%</div>`:''}</div></div>
          </div>
        </div>
        <div class="lg:w-[170px] shrink-0">
          <div class="grid grid-cols-2 lg:grid-cols-1 gap-2 text-xs mb-3"><div class="rounded-lg border p-2"><span class="text-gray-400">POs</span> <b class="float-right">${poCounts.get(v.id)||0}</b></div><div class="rounded-lg border p-2"><span class="text-gray-400">Products</span> <b class="float-right">${productCounts.get(v.id)||0}</b></div></div>
          <div class="flex lg:flex-col gap-2"><button onclick="openEditVendorInfo('${v.id}')" class="flex-1 px-3 py-2 border rounded-lg text-xs font-semibold">Edit</button><button onclick="toggleVendorInfoActive('${v.id}',${v.active?'false':'true'})" class="flex-1 px-3 py-2 border rounded-lg text-xs font-semibold ${v.active?'text-gray-600':'text-green-700 bg-green-50'}">${v.active?'Make Inactive':'Activate'}</button></div>
        </div>
      </div>
    </div>`).join(''):'<div class="card rounded-xl p-8 text-center text-sm text-gray-400">No vendors match your search.</div>'}</div>`;
  };
})();