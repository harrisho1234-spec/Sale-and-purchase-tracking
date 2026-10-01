// Central Vendor Master for Procurement and Product Costing.
(function(){
  const vm={rows:[],loaded:false};
  const VENDOR_PRODUCT_TYPES=['Furniture','Lighting','Carpet','Accessories','Decor','Service'];
  const VENDOR_STYLES=['Classic','Contemporary','Modern','Neo-Classic'];

  function roleAllowed(){
    return typeof window.hasAppPermission==='function'
      ?window.hasAppPermission('procurement.vendor_manage')
      :['admin','super_admin'].includes(state.profile?.role||'');
  }
  function clean(v){return String(v==null?'':v).trim()}
  function viDate(v){
    const s=clean(v);if(!s)return '-';
    const m=s.match(/^(\d{4})-(\d{2})-(\d{2})/);if(!m)return s;
    const months=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    return m[3]+'-'+months[Number(m[2])-1]+'-'+m[1];
  }
  function checkGroup(name,values,selected){
    const set=new Set(Array.isArray(selected)?selected:[]);
    return values.map(x=>`<label class="flex items-center gap-2 rounded-lg border bg-white px-3 py-2 text-xs cursor-pointer"><input type="checkbox" name="${name}" value="${esc(x)}" ${set.has(x)?'checked':''}><span>${esc(x)}</span></label>`).join('');
  }
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
      Array.isArray(v.product_types)&&v.product_types.length?`Type: ${v.product_types.join(', ')}`:null,
      Array.isArray(v.styles)&&v.styles.length?`Style: ${v.styles.join(', ')}`:null,
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
        <h4 class="font-bold mb-1">Product Type & Style</h4>
        <div class="text-[10px] text-gray-400 mb-3">Select all categories and design styles this vendor supplies.</div>
        <div class="grid lg:grid-cols-2 gap-4">
          <div>
            <div class="text-xs font-semibold mb-2">Product Type</div>
            <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${checkGroup('viProductType',VENDOR_PRODUCT_TYPES,v.product_types)}</div>
          </div>
          <div>
            <div class="text-xs font-semibold mb-2">Style</div>
            <div class="grid grid-cols-2 gap-2">${checkGroup('viStyle',VENDOR_STYLES,v.styles)}</div>
          </div>
        </div>
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
      product_types:Array.from(document.querySelectorAll('input[name="viProductType"]:checked')).map(x=>x.value),
      styles:Array.from(document.querySelectorAll('input[name="viStyle"]:checked')).map(x=>x.value),
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
      vm.loaded=false;closeModal();showToast('Vendor added.');await renderVendorInfoPage();
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
      vm.loaded=false;closeModal();showToast('Vendor updated.');await renderVendorInfoPage();
    };
  };

  window.toggleVendorInfoActive=async function(id,active){
    if(!roleAllowed())return;
    const {error}=await db.from('vendors').update({active,updated_by:state.user.id}).eq('id',id);
    if(error)return showToast(error.message,'err');
    vm.loaded=false;showToast(active?'Vendor activated.':'Vendor made inactive.');await renderVendorInfoPage();
  };

  window.openMergeVendorInfo=async function(sourceId){
    if(!roleAllowed())return showToast('Admin access required.','err');
    await loadVendorMaster(true);
    const source=vm.rows.find(v=>v.id===sourceId);
    if(!source)return showToast('Vendor not found.','err');
    if(source.merged_into_vendor_id)return showToast('This vendor has already been merged. Use Undo Merge if you need to restore it.','err');
    const others=vm.rows.filter(v=>v.id!==sourceId&&!v.merged_into_vendor_id&&v.active!==false);
    const options=others.map(v=>`<option value="${esc(fmtVendor(v))}"></option><option value="${esc(v.name||'')}"></option>`).join('');

    const [poRes,pvRes,costRes]=await Promise.all([
      db.from('supplier_pos').select('id',{count:'exact',head:true}).eq('vendor_id',sourceId),
      db.from('product_vendors').select('product_id',{count:'exact',head:true}).eq('vendor_id',sourceId),
      db.from('product_costs').select('product_id',{count:'exact',head:true}).eq('vendor_id',sourceId)
    ]);
    const poCount=poRes.count||0,productCount=pvRes.count||0,costCount=costRes.count||0;

    openModal('Merge Vendor — '+source.name,`<form id="mergeVendorForm" class="space-y-5">
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
        <div class="text-[10px] uppercase font-bold mb-1">Archive this duplicate → Keep another master</div>
        <b>${esc(source.name)} (${esc(source.vendor_code)})</b> will be archived as <b>Merged</b>, not permanently deleted.
        Its linked POs, Product Costing and Product-Vendor relationships will move to the vendor you choose to keep.
      </div>
      <div class="grid grid-cols-3 gap-3">
        <div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">POs</div><div class="text-xl font-bold mt-1">${poCount}</div></div>
        <div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Products</div><div class="text-xl font-bold mt-1">${productCount}</div></div>
        <div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Costing Links</div><div class="text-xl font-bold mt-1">${costCount}</div></div>
      </div>
      <div>
        <label class="text-xs font-semibold">KEEP THIS MASTER VENDOR *</label>
        <input id="mergeVendorTarget" list="mergeVendorTargetList" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type vendor name or vendor code...">
        <datalist id="mergeVendorTargetList">${options}</datalist>
        <div id="mergeVendorTargetInfo" class="text-[10px] text-gray-400 mt-1">The selected vendor will remain as the master record.</div>
      </div>
      <div class="rounded-xl border p-3 text-xs text-gray-600">
        <b>Merge rule:</b> the kept vendor's existing information takes priority. Empty fields can be filled from the duplicate, and Product Types/Styles are combined. The archived source remains visible and the merge can be undone later.
      </div>
      <button id="mergeVendorBtn" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Merge Into Selected Vendor</button>
    </form>`);

    const input=document.getElementById('mergeVendorTarget');
    input.onchange=input.oninput=()=>{
      const target=findVendorMaster(input.value);
      const info=document.getElementById('mergeVendorTargetInfo');
      if(!target||target.id===sourceId){
        info.textContent='Choose a different Vendor Info record to keep.';
        info.className='text-[10px] text-red-600 mt-1';
        return;
      }
      info.textContent=`Keep ${target.name} (${target.vendor_code}) · ${vendorSelectionInfo(target)||'No extra defaults saved'}`;
      info.className='text-[10px] text-green-700 mt-1';
    };

    document.getElementById('mergeVendorForm').onsubmit=async e=>{
      e.preventDefault();
      const target=findVendorMaster(input.value);
      if(!target||target.id===sourceId)return showToast('Select a different vendor to keep.','err');
      if(!confirm(`ARCHIVE duplicate "${source.name}" and KEEP "${target.name}" as the master vendor? All links will move to "${target.name}", and you can undo this later.`))return;
      const btn=document.getElementById('mergeVendorBtn');btn.disabled=true;btn.textContent='Merging...';
      const {data,error}=await db.rpc('merge_vendor_records',{p_keep_vendor_id:target.id,p_merge_vendor_id:sourceId});
      if(error){btn.disabled=false;btn.textContent='Merge Into Selected Vendor';return showToast(error.message,'err')}
      vm.loaded=false;await loadVendorMaster(true);closeModal();
      showToast(`Vendor merged into ${target.name}. The source was archived and can be restored with Undo Merge.`);
      await renderVendorInfoPage();
    };
  };

  window.toggleVendorPOHistory=function(id){
    const el=document.getElementById('vendor-po-items-'+id);
    const icon=document.getElementById('vendor-po-icon-'+id);
    if(!el)return;
    const opening=el.classList.contains('hidden');
    el.classList.toggle('hidden',!opening);
    if(icon)icon.textContent=opening?'⌃':'⌄';
  };

  window.undoVendorInfoMerge=async function(historyId,sourceName,targetName){
    if(!roleAllowed())return showToast('Admin access required.','err');
    if(!confirm(`Undo the merge of "${sourceName}" into "${targetName}"? The original PO/product/vendor links will be restored.`))return;
    const {data,error}=await db.rpc('undo_vendor_merge',{p_history_id:historyId});
    if(error)return showToast(error.message,'err');
    vm.loaded=false;await loadVendorMaster(true);
    showToast(`Merge undone. ${sourceName} has been restored.`);
    await renderVendorInfoPage();
  };

  window.openVendorPOHistory=async function(vendorId){
    if(!roleAllowed())return;
    await loadVendorMaster();
    const vendor=vm.rows.find(v=>v.id===vendorId);
    if(!vendor)return showToast('Vendor not found.','err');

    openModal('PO History — '+vendor.name,'<div class="py-12 text-center text-sm text-gray-400">Loading PO history...</div>');
    try{
      const poRes=await db.from('supplier_pos').select('*').eq('vendor_id',vendorId).order('order_date',{ascending:false}).order('created_at',{ascending:false});
      if(poRes.error)throw poRes.error;
      const pos=poRes.data||[];
      if(!pos.length){
        const body=document.querySelector('#modalBody');
        if(body)body.innerHTML='<div class="rounded-xl border border-dashed p-10 text-center text-sm text-gray-400">No POs recorded for this vendor yet.</div>';
        return;
      }

      const ids=pos.map(p=>p.id);
      const [summaryRes,itemRes,paymentRes]=await Promise.all([
        db.from('supplier_po_summary').select('*').in('id',ids),
        db.from('supplier_po_items').select('id,supplier_po_id,product_code_snapshot,item_name_snapshot,qty,unit_cost,shipping_cost,shipping_currency,procurement_status,image_url_snapshot,created_at').in('supplier_po_id',ids).order('sort_order',{ascending:true,nullsFirst:false}).order('created_at',{ascending:true}),
        db.from('supplier_payments').select('id,supplier_po_id,payment_type,payment_date,amount,currency,reference_no,notes').in('supplier_po_id',ids).order('payment_date',{ascending:true})
      ]);
      if(summaryRes.error)throw summaryRes.error;
      if(itemRes.error)throw itemRes.error;
      if(paymentRes.error)throw paymentRes.error;

      const summaries=new Map((summaryRes.data||[]).map(x=>[x.id,x]));
      const itemsBy=new Map(),paymentsBy=new Map();
      (itemRes.data||[]).forEach(x=>{if(!itemsBy.has(x.supplier_po_id))itemsBy.set(x.supplier_po_id,[]);itemsBy.get(x.supplier_po_id).push(x)});
      (paymentRes.data||[]).forEach(x=>{if(!paymentsBy.has(x.supplier_po_id))paymentsBy.set(x.supplier_po_id,[]);paymentsBy.get(x.supplier_po_id).push(x)});

      const totalQty=(itemRes.data||[]).reduce((a,x)=>a+Number(x.qty||0),0);
      const totalItems=(itemRes.data||[]).length;
      const cards=pos.map(p=>{
        const s=summaries.get(p.id)||{};
        const items=itemsBy.get(p.id)||[];
        const pays=paymentsBy.get(p.id)||[];
        const qty=items.reduce((a,x)=>a+Number(x.qty||0),0);
        const label=p.po_number||p.po_pending_reference||'PO';
        return `<div class="rounded-2xl border bg-white overflow-hidden">
          <button type="button" onclick="toggleVendorPOHistory('${p.id}')" class="w-full p-4 text-left flex items-start justify-between gap-3 hover:bg-gray-50">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2"><b>${esc(label)}</b><span class="lr-badge lr-badge-gray">${esc(titleCase(p.status||'placed'))}</span><span class="lr-badge lr-badge-gray">${items.length} item line${items.length===1?'':'s'}</span><span class="lr-badge lr-badge-blue">Qty ${qty.toLocaleString()}</span></div>
              <div class="text-[10px] text-gray-400 mt-2">Ordered: ${esc(viDate(p.order_date))} · ETA: ${esc(viDate(p.estimated_arrival))}${p.actual_arrival?' · Arrived: '+esc(viDate(p.actual_arrival)):''}</div>
              <div class="text-xs mt-1">Goods: <b>${money(Number(s.po_total||0),p.currency||'USD')}</b> · Paid: <b class="text-green-600">${money(Number(s.amount_paid||0),p.currency||'USD')}</b> · Balance: <b class="${Number(s.balance_due||0)>0?'text-red-500':'text-green-600'}">${money(Number(s.balance_due||0),p.currency||'USD')}</b></div>
            </div>
            <span id="vendor-po-icon-${p.id}" class="text-gray-500 text-lg">⌄</span>
          </button>
          <div id="vendor-po-items-${p.id}" class="hidden border-t bg-[#faf9f6] p-4 space-y-3">
            <div>
              <div class="text-[9px] uppercase font-bold text-gray-400 mb-2">Ordered Items</div>
              ${items.length?items.map(i=>`<div class="flex items-center gap-3 py-2 border-b last:border-0"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${i.image_url_snapshot?`<img src="${esc(i.image_url_snapshot)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0 flex-1"><div class="text-[10px] font-bold text-[#a77d1a]">${esc(i.product_code_snapshot||'')}</div><div class="text-xs">${esc(i.item_name_snapshot||'Item')}</div></div><div class="text-right text-xs"><b>${Number(i.qty||0).toLocaleString()}x</b><div class="text-[9px] text-gray-400">${esc(titleCase(i.procurement_status||p.status||'placed'))}</div></div></div>`).join(''):'<div class="text-xs text-gray-400">No PO items.</div>'}
            </div>
            ${pays.length?`<div class="border-t pt-3"><div class="text-[9px] uppercase font-bold text-gray-400 mb-2">Supplier Payments</div>${pays.map(x=>`<div class="flex justify-between gap-3 py-1.5 text-xs"><div>${esc(viDate(x.payment_date))} · ${esc(titleCase(x.payment_type||'payment'))}${x.reference_no?' · '+esc(x.reference_no):''}</div><b class="text-green-600">${money(Number(x.amount||0),x.currency||p.currency||'USD')}</b></div>`).join('')}</div>`:''}
            ${p.notes?`<div class="border-t pt-3 text-xs text-gray-500"><b>PO Note:</b> ${esc(p.notes)}</div>`:''}
          </div>
        </div>`;
      }).join('');

      const html=`<div class="space-y-4">
        <div class="grid sm:grid-cols-3 gap-3">
          <div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">POs</div><div class="text-xl font-bold mt-1">${pos.length}</div></div>
          <div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Item Lines</div><div class="text-xl font-bold mt-1">${totalItems}</div></div>
          <div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Total Qty Ordered</div><div class="text-xl font-bold mt-1">${totalQty.toLocaleString()}</div></div>
        </div>
        <div class="text-[10px] text-gray-400">Click any PO to expand its ordered items and supplier payment history.</div>
        <div class="grid gap-3">${cards}</div>
      </div>`;

      const modal=document.getElementById('modalBody');
      if(modal)modal.innerHTML=html;
      else{
        const candidates=document.querySelectorAll('.modal-content, [data-modal-body]');
        if(candidates.length)candidates[candidates.length-1].innerHTML=html;
      }
    }catch(err){
      const modal=document.getElementById('modalBody');
      if(modal)modal.innerHTML=`<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-600 text-sm">Error: ${esc(err.message)}</div>`;
      else showToast(err.message,'err');
    }
  };

  window.renderVendorInfoBody=async function(search=''){
    if(!roleAllowed())throw new Error('Admin access required');
    const [vendors,poRes,pvRes,mergeRes]=await Promise.all([
      loadVendorMaster(),
      db.from('supplier_pos').select('vendor_id'),
      db.from('product_vendors').select('vendor_id,product_id'),
      db.from('vendor_merge_history').select('id,source_vendor_id,target_vendor_id,merged_at,undone_at').is('undone_at',null).order('merged_at',{ascending:false})
    ]);
    if(poRes.error)throw poRes.error;if(pvRes.error)throw pvRes.error;if(mergeRes.error)throw mergeRes.error;
    const activeMergeBySource=new Map();
    (mergeRes.data||[]).forEach(x=>{if(!activeMergeBySource.has(x.source_vendor_id))activeMergeBySource.set(x.source_vendor_id,x)});

    const poCounts=new Map();
    (poRes.data||[]).forEach(x=>x.vendor_id&&poCounts.set(x.vendor_id,(poCounts.get(x.vendor_id)||0)+1));
    const productCounts=new Map();
    (pvRes.data||[]).forEach(x=>x.vendor_id&&productCounts.set(x.vendor_id,(productCounts.get(x.vendor_id)||0)+1));

    const q=clean(search).toLowerCase();
    const rows=vendors.filter(v=>!q||[
      v.name,v.vendor_code,v.legal_name,v.contact_person,v.phone,v.email,v.country,v.city,
      ...(Array.isArray(v.product_types)?v.product_types:[]),
      ...(Array.isArray(v.styles)?v.styles:[]),
      v.default_currency,v.payment_terms,v.shipping_terms,v.sales_price_formula,v.notes
    ].filter(Boolean).join(' ').toLowerCase().includes(q));

    const merged=vendors.filter(v=>v.merged_into_vendor_id).length;
    const active=vendors.filter(v=>v.active&&!v.merged_into_vendor_id).length;
    const inactive=vendors.length-active-merged;

    return `<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-4">
      <div class="pw-stat"><div class="pw-stat-label">Vendors</div><div class="pw-stat-value">${vendors.length}</div></div>
      <div class="pw-stat"><div class="pw-stat-label">Active</div><div class="pw-stat-value text-green-600">${active}</div></div>
      <div class="pw-stat"><div class="pw-stat-label">Inactive</div><div class="pw-stat-value text-gray-400">${inactive}</div></div>
      <div class="pw-stat"><div class="pw-stat-label">Merged</div><div class="pw-stat-value text-purple-600">${merged}</div></div>
    </div>
    <div class="pw-grid">${rows.length?rows.map(v=>{const mh=activeMergeBySource.get(v.id);const mergeTarget=v.merged_into_vendor_id?vendors.find(x=>x.id===v.merged_into_vendor_id):null;return `<div class="pw-card vi-vendor-card ${v.merged_into_vendor_id?'opacity-80':''}">
      <div class="vi-vendor-card-grid">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-1.5">
            <b class="text-sm leading-tight">${esc(v.name)}</b>
            <span class="lr-badge lr-badge-gray">${esc(v.vendor_code)}</span>
            ${v.merged_into_vendor_id?`<span class="px-2 py-0.5 rounded-md border border-purple-200 bg-purple-50 text-purple-700 text-[8px] font-bold">MERGED → ${esc(mergeTarget?.name||'Master Vendor')}</span>`:`<span class="lr-badge ${v.active?'lr-badge-green':'lr-badge-gray'}">${v.active?'Active':'Inactive'}</span>`}
            <span class="lr-badge lr-badge-blue">${esc(v.default_currency||'USD')}</span>
          </div>

          <div class="vi-vendor-meta mt-1.5">
            <span>${esc(contactSummary(v))}</span>
            <span class="text-gray-300">•</span>
            <span class="text-gray-400">${esc([v.city,v.country].filter(Boolean).join(', ')||v.address||'No address')}</span>
          </div>

          ${(Array.isArray(v.product_types)&&v.product_types.length)||(Array.isArray(v.styles)&&v.styles.length)?`<div class="flex flex-wrap gap-1 mt-1.5">${(v.product_types||[]).map(x=>`<span class="vi-mini-tag bg-blue-50 border-blue-100 text-blue-700">${esc(x)}</span>`).join('')}${(v.styles||[]).map(x=>`<span class="vi-mini-tag bg-purple-50 border-purple-100 text-purple-700">${esc(x)}</span>`).join('')}</div>`:''}

          <div class="vi-vendor-compact-info">
            <div class="vi-compact-block">
              <span class="vi-compact-label">Purchasing Terms</span>
              <span class="vi-compact-value">${esc(termsSummary(v))}${v.moq_terms?` <span class="text-gray-400">· MOQ: ${esc(v.moq_terms)}</span>`:''}</span>
            </div>
            <div class="vi-compact-block vi-compact-price">
              <span class="vi-compact-label text-amber-700">Sales Price Formula</span>
              <span class="vi-compact-value">${esc(v.sales_price_formula||'No formula saved')}${v.default_markup_percent!=null?` <span class="text-amber-700">· Markup ${Number(v.default_markup_percent).toFixed(2)}%</span>`:''}</span>
            </div>
          </div>
        </div>

        <div class="vi-vendor-side">
          <div class="grid grid-cols-2 gap-1.5">
            <button type="button" onclick="openVendorPOHistory('${v.id}')" class="vi-side-stat hover:bg-amber-50 hover:border-amber-200 transition">
              <span class="text-gray-400">POs</span><b class="text-[#a77d1a]">${poCounts.get(v.id)||0}</b><span class="vi-history-link">History →</span>
            </button>
            <div class="vi-side-stat"><span class="text-gray-400">Products</span><b>${productCounts.get(v.id)||0}</b></div>
          </div>
          <div class="vi-vendor-actions">${v.merged_into_vendor_id
            ?`<button onclick="openEditVendorInfo('${v.id}')" class="vi-action-btn">View / Edit</button>${mh?`<button onclick="undoVendorInfoMerge('${mh.id}','${esc(v.name)}','${esc(mergeTarget?.name||'Master Vendor')}')" class="vi-action-btn border-purple-200 bg-purple-50 text-purple-700">Undo Merge</button>`:''}`
            :`<button onclick="openEditVendorInfo('${v.id}')" class="vi-action-btn">Edit</button><button onclick="openMergeVendorInfo('${v.id}')" class="vi-action-btn border-purple-200 bg-purple-50 text-purple-700">Merge</button><button onclick="toggleVendorInfoActive('${v.id}',${v.active?'false':'true'})" class="vi-action-btn ${v.active?'text-gray-600':'text-green-700 bg-green-50'}">${v.active?'Inactive':'Activate'}</button>`
          }</div>
        </div>
      </div>
    </div>`}).join(''):'<div class="card rounded-xl p-8 text-center text-sm text-gray-400">No vendors match your search.</div>'}</div>`;
  };

  function injectVendorInfoStyles(){
    if(document.getElementById('vendor-info-page-css'))return;
    const st=document.createElement('style');
    st.id='vendor-info-page-css';
    st.textContent=`
      .vi-toolbar{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-bottom:15px;flex-wrap:wrap}
      .vi-search{min-width:260px;max-width:520px;flex:1;border:1px solid #e4e4e7;border-radius:11px;padding:10px 13px;font-size:12px;background:#fff}
      .pw-stat{background:#fff;border:1px solid #eee8df;border-radius:14px;padding:14px}
      .pw-stat-label{font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#a1a1aa;font-weight:800}
      .pw-stat-value{font-size:20px;font-weight:800;margin-top:5px}
      .pw-grid{display:grid;gap:8px}
      .pw-card{background:#fff;border:1px solid #ece8e0;border-radius:13px;padding:10px 12px}
      .vi-vendor-card-grid{display:grid;grid-template-columns:minmax(0,1fr) 286px;gap:12px;align-items:start}
      .vi-vendor-meta{display:flex;flex-wrap:wrap;align-items:center;gap:6px;font-size:10px;color:#71717a;line-height:1.25}
      .vi-mini-tag{display:inline-flex;padding:2px 6px;border-width:1px;border-radius:6px;font-size:8px;font-weight:700;line-height:1.2}
      .vi-vendor-compact-info{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:6px;margin-top:7px}
      .vi-compact-block{border:1px solid #ececec;background:#fafafa;border-radius:9px;padding:6px 8px;min-width:0}
      .vi-compact-price{background:#fffaf0;border-color:#fde9b3}
      .vi-compact-label{display:block;font-size:8px;line-height:1;text-transform:uppercase;letter-spacing:.04em;font-weight:800;color:#a1a1aa}
      .vi-compact-value{display:block;margin-top:3px;font-size:10px;line-height:1.25;color:#3f3f46;overflow-wrap:anywhere}
      .vi-vendor-side{min-width:0}
      .vi-side-stat{min-height:42px;border:1px solid #e5e7eb;border-radius:9px;padding:6px 8px;font-size:10px;text-align:left;display:grid;grid-template-columns:1fr auto;gap:2px 8px;align-items:center;background:#fff}
      .vi-side-stat b{font-size:12px}
      .vi-history-link{grid-column:1/-1;font-size:8px;color:#a77d1a;line-height:1}
      .vi-vendor-actions{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:5px;margin-top:6px}
      .vi-action-btn{min-width:0;padding:6px 7px;border:1px solid #e5e7eb;border-radius:8px;font-size:9px;font-weight:700;line-height:1.15;background:#fff}
      @media(max-width:1000px){.vi-vendor-card-grid{grid-template-columns:1fr}.vi-vendor-side{display:grid;grid-template-columns:220px minmax(0,1fr);gap:6px}.vi-vendor-actions{margin-top:0}}
      @media(max-width:700px){.vi-search{max-width:none;width:100%}.vi-toolbar>*{width:100%}.vi-vendor-compact-info{grid-template-columns:1fr}.vi-vendor-side{display:block}.vi-vendor-actions{margin-top:6px}.pw-card{padding:10px}}
    `;
    document.head.appendChild(st);
  }

  window.renderVendorInfoPage=async function(){
    if(!roleAllowed())throw new Error('Vendor Info is available to Admin and Super Admin only.');
    injectVendorInfoStyles();
    document.getElementById('content').innerHTML=`
      <div class="max-w-[1500px] mx-auto">
        <div class="vi-toolbar">
          <input id="vendorInfoSearch" class="vi-search" placeholder="Search vendor, product type, style, contact, country, terms..." oninput="refreshVendorInfoPage(this.value)">
          <button onclick="openNewVendorInfo()" class="px-4 py-2 bg-[#211d18] text-white rounded-xl text-sm font-semibold">+ Vendor</button>
        </div>
        <div id="vendorInfoPageBody"><div class="py-16 text-center text-gray-400">Loading...</div></div>
      </div>
    `;
    await refreshVendorInfoPage('');
  };

  window.refreshVendorInfoPage=async function(search){
    const body=document.getElementById('vendorInfoPageBody');
    if(!body)return;
    try{
      body.innerHTML=await renderVendorInfoBody(search||'');
    }catch(err){
      body.innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`;
    }
  };

  // Vendor Info is a separate Products & Procurement page, not an internal Procurement tab.
  const previousVendorNavItems=window.navItems;
  if(typeof previousVendorNavItems==='function'){
    window.navItems=function(){
      const items=previousVendorNavItems.apply(this,arguments)||[];
      if(!roleAllowed())return items.filter(x=>x[0]!=='vendor-info');
      if(items.some(x=>x[0]==='vendor-info'))return items;
      const out=[];
      let inserted=false;
      for(const item of items){
        out.push(item);
        if(item[0]==='procurement'){
          out.push(['vendor-info','Vendor Info','⌂']);
          inserted=true;
        }
      }
      if(!inserted)out.push(['vendor-info','Vendor Info','⌂']);
      return out;
    };
  }

  const previousVendorGo=window.go;
  if(typeof previousVendorGo==='function'){
    window.go=async function(page){
      if(page!=='vendor-info')return previousVendorGo.apply(this,arguments);
      if(!roleAllowed()){
        showToast('Vendor Info is available to Admin and Super Admin only.','err');
        return;
      }
      state.page='vendor-info';
      renderNav();
      document.getElementById('pageTitle').textContent='Vendor Info';
      document.getElementById('pageSubtitle').textContent='Vendor contacts, purchasing terms, pricing formulas and product/PO relationships';
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
      try{await renderVendorInfoPage()}
      catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
    };
  }

  try{if(state?.profile)renderNav()}catch(_){}
})();