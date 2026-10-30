// Admin-only product detail overrides. Loaded after app.js.

async function lookupProductCodeConflict(code,excludeId=null){
  const clean=String(code||'').trim();
  if(!clean)return null;
  const {data,error}=await db.rpc('lookup_product_code',{p_code:clean,p_exclude_id:excludeId||null});
  if(error)throw error;
  return data||null;
}

function productCodeConflictMessage(x,typed){
  return 'Product Code "'+(x?.code||typed||'')+'" '+(x?.legacy_alias?'was previously used and is reserved':'already exists')
    +(x?.item_name?' for "'+x.item_name+'"':'')
    +(x?.legacy_alias&&x?.current_code?' (now '+x.current_code+')':'')
    +'. Use the existing product instead of creating another code.';
}

async function getProductAdminDetail(productId){
  if(!isAdmin()) return null;
  const {data,error}=await db.from('product_admin_details').select('*').eq('product_id',productId).maybeSingle();
  if(error) throw error;
  return data||null;
}

async function openProductDetail(id){
  let p=state.products.find(x=>x.id===id);
  if(!p){const {data,error}=await db.from('product_catalog').select('*').eq('id',id).single();if(error)return showToast(error.message,'err');p=data}
  if(!p)return showToast('Product not found','err');

  let cost=null,history=[],adminDetail=null;
  if(isAdmin()){
    const [c,h,a]=await Promise.all([
      db.from('product_costs').select('*').eq('product_id',id).maybeSingle(),
      db.from('stock_adjustments').select('*').eq('product_id',id).order('created_at',{ascending:false}).limit(8),
      db.from('product_admin_details').select('*').eq('product_id',id).maybeSingle()
    ]);
    if(c.error)return showToast(c.error.message,'err');
    if(h.error)return showToast(h.error.message,'err');
    if(a.error)return showToast(a.error.message,'err');
    cost=c.data||null;history=h.data||[];adminDetail=a.data||null;
  }

  const landed=Number(cost?.landed_cost||0);
  const margin=Number(p.sales_price||0)-landed;
  const marginPct=Number(p.sales_price||0)>0?margin/Number(p.sales_price)*100:0;

  openModal(`${p.code} · ${p.item_name}`,`
    <div class="grid md:grid-cols-[260px_1fr] gap-6">
      <div>
        <div class="aspect-square rounded-2xl overflow-hidden bg-gray-100">${productImage(p)}</div>
        <div class="mt-3 text-xs text-gray-400">${esc(p.brand||'')} ${p.class?'· '+esc(p.class):''}</div>
      </div>
      <div>
        <div class="grid grid-cols-2 gap-3 mb-5">
          <div class="bg-gray-50 rounded-xl p-3"><div class="text-[10px] uppercase text-gray-400 font-bold">Sales Price</div><div class="font-bold text-xl mt-1">${money(p.sales_price,p.currency)}</div></div>
          <div class="bg-gray-50 rounded-xl p-3"><div class="text-[10px] uppercase text-gray-400 font-bold">Stock</div><div class="font-bold text-xl mt-1">${Number(p.stock_qty||0)}</div></div>
        </div>
        <div class="space-y-3 text-sm">
          <div><span class="text-gray-400">Code:</span> <b>${esc(p.code)}</b></div>
          <div><span class="text-gray-400">Brand:</span> ${esc(p.brand||'-')}</div>
          <div><span class="text-gray-400">Class:</span> ${esc(p.class||'-')}</div>
          <div><span class="text-gray-400">Description:</span><div class="mt-1 text-gray-700 whitespace-pre-wrap">${esc(p.description||'-')}</div></div>
        </div>

        ${isAdmin()?`
          <div class="mt-6 border-t pt-5">
            <div class="flex items-center justify-between gap-3 mb-3">
              <h4 class="font-bold">Admin / Confidential</h4>
              <span class="text-xs px-2 py-1 rounded-full ${p.manual_override?'bg-amber-50 text-amber-700':'bg-green-50 text-green-700'}">${(String(p.source_row_key||'').startsWith('app:')||['app_created','app_products_sheet'].includes(String(p.source_system||'')))?(p.manual_override?'Queued for App Products':'App Products synced'):(p.manual_override?'App override':'Google Sheet synced')}</span>
            </div>
            <div class="grid sm:grid-cols-2 gap-2 text-sm">
              <div><span class="text-gray-400">Location:</span> ${esc(adminDetail?.location||'-')}</div>
              <div><span class="text-gray-400">Vendor:</span> ${esc(cost?.vendor_name||'-')}</div>
              <div><span class="text-gray-400">Unit Cost:</span> ${money(cost?.unit_cost||0,cost?.cost_currency||'USD')}</div>
              <div><span class="text-gray-400">Shipping:</span> ${money(cost?.shipping_cost||0,cost?.cost_currency||'USD')}</div>
              <div><span class="text-gray-400">Landed Cost:</span> ${money(landed,cost?.cost_currency||'USD')}</div>
              <div><span class="text-gray-400">Margin:</span> <b class="${margin>=0?'text-green-600':'text-red-600'}">${money(margin,p.currency)} (${marginPct.toFixed(1)}%)</b></div>
            </div>
            <div class="grid sm:grid-cols-3 gap-2 mt-4">
              <button onclick="openEditProduct('${id}')" class="px-3 py-2.5 bg-[#211d18] text-white rounded-xl text-sm">Edit Product</button>
              <button onclick="openChangeProductCode('${id}')" class="px-3 py-2.5 border border-amber-200 bg-amber-50 text-amber-800 rounded-xl text-sm">Change Product Code</button>
              <button onclick="openProductCodeHistory('${id}')" class="px-3 py-2.5 border border-blue-200 bg-blue-50 text-blue-800 rounded-xl text-sm">Code History</button>
              <button onclick="openAdjustStock('${id}')" class="px-3 py-2.5 border rounded-xl text-sm">Adjust Stock</button>
              <button onclick="openEditCosting('${id}')" class="px-3 py-2.5 border rounded-xl text-sm">Edit Costing</button>
            </div>
            ${state.profile?.role==='super_admin'?(p.archived_at?
 `<button onclick="restoreArchivedProduct('${id}')" class="mt-2 w-full px-3 py-2.5 border border-green-200 bg-green-50 text-green-700 rounded-xl text-xs font-semibold">Restore Archived Product</button>`:
 `<button onclick="deleteAppProduct('${id}')" class="mt-2 w-full px-3 py-2.5 border border-red-200 bg-red-50 text-red-700 rounded-xl text-xs font-semibold">Delete / Archive Product</button>`):''}
            ${p.manual_override&&!(String(p.source_row_key||'').startsWith('app:')||['app_created','app_products_sheet'].includes(String(p.source_system||'')))?`<button onclick="resumeProductSheetSync('${id}')" class="mt-2 w-full px-3 py-2 border border-amber-200 text-amber-700 bg-amber-50 rounded-xl text-xs">Resume Google Sheet sync for this product</button>`:''}
            ${history.length?`<div class="mt-5"><div class="text-xs font-bold uppercase text-gray-400 mb-2">Recent Stock Changes</div><div class="divide-y border rounded-xl">${history.map(h=>`<div class="p-2.5 flex justify-between gap-3 text-xs"><div><b>${esc(h.reason)}</b>${h.note?`<div class="text-gray-400">${esc(h.note)}</div>`:''}</div><div class="text-right"><b>${Number(h.previous_qty)} → ${Number(h.new_qty)}</b><div class="text-gray-400">${new Date(h.created_at).toLocaleString()}</div></div></div>`).join('')}</div></div>`:''}
          </div>`:''}
      </div>
    </div>`);
}




async function retryProductCodeSheetWriteback(id){
  if(!isAdmin())return showToast('Admin or Super Admin access required.','err');
  if(!confirm('Retry updating the Price Structure code? First correct any duplicate brand rows or unsupported formulas.'))return;
  const r=await db.rpc('admin_retry_product_code_sheet_writeback',{p_product_id:id});
  if(r.error)return showToast(r.error.message||'Could not retry sheet update.','err');
  showToast('Price Structure update queued again for the next automatic synchronization.');
  await openProductCodeHistory(id);
}

async function openProductCodeHistory(id){
  if(!isAdmin())return showToast('Admin or Super Admin access required.','err');
  try{
    const [r,w]=await Promise.all([
      db.rpc('get_product_code_history',{p_product_id:id}),
      db.rpc('get_product_code_sheet_writeback_status',{p_product_id:id})
    ]);
    if(r.error)throw r.error;
    if(w.error)throw w.error;
    const writeback=w.data||{status:'not_required'};
    const data=r.data||{},changes=Array.isArray(data.changes)?data.changes:[],aliases=Array.isArray(data.aliases)?data.aliases:[];
    const history=changes.length
      ?changes.map(x=>'<div class="rounded-xl border p-3 space-y-1">'+
        '<div class="font-mono text-sm font-bold">'+esc(x.old_code||'')+' → '+esc(x.new_code||'')+'</div>'+
        '<div class="text-xs text-gray-500">'+esc(x.changed_by||'')+' · '+esc(x.changed_at?new Date(x.changed_at).toLocaleString('en-GB'):'')+'</div>'+
        '<div class="text-xs">Reason: '+esc(x.reason||'Not provided')+'</div></div>').join('')
      :'<div class="rounded-xl border bg-gray-50 p-4 text-xs text-gray-500">No previous code changes recorded.</div>';
    const legacy=aliases.length?aliases.map(x=>'<span class="inline-flex rounded-full border bg-gray-50 px-3 py-1 text-xs font-mono">'+esc(x.code)+'</span>').join(' '):'<span class="text-xs text-gray-500">None</span>';
    openModal('Product Code Master & History',`
      <div class="space-y-4">
        <div class="rounded-xl bg-blue-50 border border-blue-100 p-4">
          <div class="uppercase text-[10px] text-blue-800 font-bold">Current active code</div>
          <div class="font-mono font-extrabold text-xl text-blue-900 mt-1">${esc(data.current_code||'')}</div>
          <div class="text-xs text-blue-800 mt-2">One permanent product ID · older codes remain aliases, not separate stock or products.</div>
        </div>
        ${data.source_original_code?'<div class="text-xs text-gray-600">Original Price Structure source code: <b class="font-mono">'+esc(data.source_original_code)+'</b></div>':''}
        ${writeback.status!=='not_required'?'<div class="text-xs border rounded-xl p-3 '+(writeback.status==='applied'?'border-green-200 bg-green-50 text-green-800':writeback.status==='needs_review'?'border-red-200 bg-red-50 text-red-700':'border-amber-200 bg-amber-50 text-amber-800')+'"><b>Price Structure sheet:</b> '+(writeback.status==='applied'?'Updated':writeback.status==='needs_review'?'Needs review':'Queued for automatic update')+(writeback.note?'<div class="mt-1">'+esc(writeback.note)+'</div>':'')+'</div>':''}
        <button id="retryProductCodeSheetBtn" type="button" class="mt-2 mb-2 px-3 py-1.5 rounded-lg border border-red-300 bg-white text-red-800 text-xs font-bold" style="display:none">Retry Sheet Update After Correction</button>
        <div><div class="text-xs font-bold mb-2">All historical codes</div><div class="flex flex-wrap gap-2">${legacy}</div></div>
        <div><div class="text-xs font-bold mb-2">Code change history</div><div class="space-y-2 max-h-[45vh] overflow-y-auto">${history}</div></div>
      </div>`);
    const retry=document.getElementById('retryProductCodeSheetBtn');
    if(retry&&writeback.status==='needs_review'){
      retry.style.display='inline-block';
      retry.onclick=()=>retryProductCodeSheetWriteback(id);
    }
  }catch(err){showToast(err.message||'Could not load code history.','err')}
}

async function openChangeProductCode(id){
  if(!isAdmin())return showToast('Admin or Super Admin access required.','err');
  const p=productById(id);
  if(!p)return showToast('Product not found. Refresh Products.','err');
  const priceManaged=p.source_system==='price_structure_v3_private_push'||String(p.source_row_key||'').startsWith('price:');
  openModal('Change Product Code',`<form id="productCodeChangeForm" class="space-y-4">
    <div class="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-900">
      <b>Rename the existing product — do not recreate it.</b> Inventory and linked sales/PO items keep the same internal product ID.
      Previously issued documents retain their original code snapshots. Old codes cannot be reassigned to a different product.
    </div>
    ${priceManaged?'<div class="rounded-xl border border-blue-200 bg-blue-50 p-3 text-xs text-blue-900"><b>Price Structure synchronized product.</b> This change updates the code in Sales & Order Management, while retaining the original Price Structure source identity. Future imports of the old code will update this SAME product, not create another. A secure writeback job will update the corresponding Price Structure brand row when the five-minute Apps Script trigger is installed. Old inventory and costing codes remain linked by lookups. The separate Showroom catalog may need its own refresh.</div>':''}
    <div><label class="text-xs font-bold">Current Code</label><div class="mt-1 border bg-gray-50 rounded-xl p-3 font-mono text-sm">${esc(p.code)}</div></div>
    <label class="block text-xs font-bold">New Product Code<input id="productNewCode" required maxlength="100" class="mt-1 w-full border rounded-xl p-3" value="${esc(p.code)}"></label>
    <label class="block text-xs font-bold">Reason for Change *<textarea id="productCodeReason" rows="2" maxlength="1000" required placeholder="Wrong code, updated manufacturer number..." class="mt-1 w-full border rounded-xl p-3"></textarea></label>
    <button id="productCodeSaveBtn" type="submit" class="w-full bg-[#211d18] text-white py-3 rounded-xl font-bold">Confirm Code Change</button>
  </form>`);
  document.getElementById('productCodeChangeForm').onsubmit=async e=>{
    e.preventDefault();
    const code=document.getElementById('productNewCode').value.trim();
    const reason=document.getElementById('productCodeReason').value.trim();
    if(!code||!reason)return showToast('New code and change reason are required.','err');
    if(code.toLowerCase()===String(p.code||'').toLowerCase())return showToast('Enter a different product code.','err');
    try{
      const existing=await lookupProductCodeConflict(code,id);
      if(existing)return showToast(productCodeConflictMessage(existing,code),'err');
    }catch(error){return showToast(error.message||'Could not validate product code.','err');}
    if(!confirm('Change product code from '+p.code+' to '+code+'? The existing product, inventory and historical documents remain linked.'))return;
    const btn=document.getElementById('productCodeSaveBtn');
    btn.disabled=true;btn.textContent='Updating code...';
    try{
      const r=await db.rpc('admin_change_product_code',{p_product_id:id,p_new_code:code,p_reason:reason});
      if(r.error)throw r.error;
      closeModal();
      showToast('Product code changed to '+String(r.data)+'. '+(priceManaged?'Price Structure update queued. View Code History for status.':'Old code saved in history.'));
      if(typeof loadProducts==='function')await loadProducts();
      if(typeof renderProducts==='function')await renderProducts();
    }catch(err){btn.disabled=false;btn.textContent='Confirm Code Change';showToast(err.message||'Could not change code.','err')}
  };
}

async function openEditProduct(id){
  const p=productById(id);if(!p||!isAdmin())return;
  let adminDetail=null;
  try{adminDetail=await getProductAdminDetail(id)}catch(err){return showToast(err.message,'err')}

  openModal('Edit Product',`<form id="editProductForm" class="grid md:grid-cols-2 gap-4">
    <div><label class="text-xs font-semibold">Code</label><input id="epCode" value="${esc(p.code)}" required readonly class="mt-1 w-full border rounded-xl px-3 py-2 bg-gray-50"><div class="text-[10px] text-amber-700 mt-1">Use Change Product Code in Product Details to rename with an audit record.</div><div id="epCodeStatus" class="text-[10px] mt-1 text-gray-400"></div></div>
    <div><label class="text-xs font-semibold">Item Name</label><input id="epName" value="${esc(p.item_name)}" required class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Brand</label><input id="epBrand" value="${esc(p.brand||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Class</label><input id="epClass" value="${esc(p.class||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Sales Price</label><input id="epPrice" type="number" step="0.01" min="0" value="${Number(p.sales_price||0)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Location</label><input id="epLocation" value="${esc(adminDetail?.location||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div class="md:col-span-2"><label class="text-xs font-semibold">Description</label><textarea id="epDescription" class="mt-1 w-full border rounded-xl px-3 py-2" rows="3">${esc(p.description||'')}</textarea></div>
    <div class="md:col-span-2">
      <label class="text-xs font-semibold">Product Photo</label>
      <div class="mt-1 grid sm:grid-cols-[110px_1fr] gap-3 items-start">
        <button type="button" id="epPhotoPick" class="w-[110px] h-[110px] rounded-xl border border-dashed bg-gray-50 overflow-hidden flex items-center justify-center relative hover:bg-gray-100" title="Upload replacement photo">
          <img id="epPhotoPreview" src="${esc(normalizeGoogleImageUrl(p.image_url||''))}" alt="" class="w-full h-full object-cover ${p.image_url?'':'hidden'}">
          <span id="epPhotoPlaceholder" class="text-[10px] text-gray-400 font-semibold text-center px-2 ${p.image_url?'hidden':''}">Upload<br>Photo</span>
        </button>
        <div>
          <input id="epPhotoFile" type="file" accept="image/*" class="hidden">
          <div class="flex flex-wrap gap-2">
            <button type="button" id="epPhotoUploadBtn" class="px-3 py-2 rounded-xl border bg-white text-xs font-semibold">Replace Photo</button>
            <button type="button" id="epPhotoClearBtn" class="px-3 py-2 rounded-xl border bg-white text-xs text-gray-500">Use URL Instead</button>
          </div>
          <div id="epPhotoStatus" class="text-[10px] text-gray-400 mt-2">Choose an image up to 8 MB. The new upload will replace the current product photo.</div>
          <div id="epPhotoUrlWrap" class="mt-2 hidden">
            <label class="text-[10px] font-semibold text-gray-500">Photo URL (optional fallback)</label>
            <input id="epImage" value="${esc(p.image_url||'')}" class="mt-1 w-full border rounded-xl px-3 py-2 text-xs">
          </div>
        </div>
      </div>
    </div>
    <div class="md:col-span-2 text-xs border rounded-xl bg-gray-50 p-3">Availability: <b>${p.archived_at?'Archived':p.active?'Active':'Inactive'}</b>. Only Super Admin can delete/archive or restore a product from its Product Details.</div>
    <div class="md:col-span-2 text-xs bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3">Saving here marks this product as app-managed so Google Sheet product sync will not overwrite it.</div>
    <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Product</button>
  </form>`);

  const epCode=document.getElementById('epCode');
  const epCodeStatus=document.getElementById('epCodeStatus');
  const epPhotoFile=document.getElementById('epPhotoFile');
  const epPhotoPick=document.getElementById('epPhotoPick');
  const epPhotoUploadBtn=document.getElementById('epPhotoUploadBtn');
  const epPhotoClearBtn=document.getElementById('epPhotoClearBtn');
  const epPhotoPreview=document.getElementById('epPhotoPreview');
  const epPhotoPlaceholder=document.getElementById('epPhotoPlaceholder');
  const epPhotoStatus=document.getElementById('epPhotoStatus');
  const epPhotoUrlWrap=document.getElementById('epPhotoUrlWrap');
  let epSelectedPhoto=null;
  const openPhotoPicker=()=>epPhotoFile?.click();
  epPhotoPick?.addEventListener('click',openPhotoPicker);
  epPhotoUploadBtn?.addEventListener('click',openPhotoPicker);
  epPhotoClearBtn?.addEventListener('click',()=>{
    epPhotoUrlWrap?.classList.toggle('hidden');
    if(epPhotoUrlWrap&&!epPhotoUrlWrap.classList.contains('hidden'))document.getElementById('epImage')?.focus();
  });
  epPhotoFile?.addEventListener('change',()=>{
    const file=epPhotoFile.files?.[0]||null;
    if(!file){epSelectedPhoto=null;return;}
    if(!String(file.type||'').startsWith('image/')){
      showToast('Please choose an image file.','err');
      epPhotoFile.value='';epSelectedPhoto=null;return;
    }
    if(file.size>8*1024*1024){
      showToast('Photo must be 8 MB or smaller.','err');
      epPhotoFile.value='';epSelectedPhoto=null;return;
    }
    epSelectedPhoto=file;
    if(epPhotoPreview){
      epPhotoPreview.src=URL.createObjectURL(file);
      epPhotoPreview.classList.remove('hidden');
    }
    epPhotoPlaceholder?.classList.add('hidden');
    if(epPhotoStatus){
      epPhotoStatus.textContent='Ready to replace photo with '+file.name+'.';
      epPhotoStatus.className='text-[10px] text-green-600 mt-2';
    }
  });

  epCode?.addEventListener('input',()=>{if(epCodeStatus){epCodeStatus.textContent='';epCodeStatus.className='text-[10px] mt-1 text-gray-400';}});
  epCode?.addEventListener('blur',async()=>{
    const code=epCode.value.trim();
    if(!code)return;
    try{
      const conflict=await lookupProductCodeConflict(code,id);
      if(epCodeStatus){
        epCodeStatus.textContent=conflict?productCodeConflictMessage(conflict,code):'Code available';
        epCodeStatus.className='text-[10px] mt-1 '+(conflict?'text-red-600':'text-green-600');
      }
    }catch(_){}
  });

  document.getElementById('editProductForm').onsubmit=async e=>{
    e.preventDefault();
    const newCode=document.getElementById('epCode').value.trim();
    if(!newCode)return showToast('Product Code is required.','err');
    try{
      const conflict=await lookupProductCodeConflict(newCode,id);
      if(conflict){
        if(epCodeStatus){
          epCodeStatus.textContent=productCodeConflictMessage(conflict,newCode);
          epCodeStatus.className='text-[10px] mt-1 text-red-600';
        }
        epCode?.focus();
        return showToast(productCodeConflictMessage(conflict,newCode),'err');
      }
    }catch(err){
      return showToast(err.message||'Could not validate Product Code.','err');
    }
    const row={
      code:newCode,item_name:document.getElementById('epName').value.trim(),
      brand:document.getElementById('epBrand').value.trim()||null,class:document.getElementById('epClass').value.trim()||null,
      sales_price:Number(document.getElementById('epPrice').value||0),description:document.getElementById('epDescription').value.trim()||null,
      active:p.active,manual_override:true
    };
    if(!epSelectedPhoto)row.image_url=normalizeGoogleImageUrl(document.getElementById('epImage')?.value||p.image_url||'');
    const {error:e1}=await db.from('product_catalog').update(row).eq('id',id);
    if(e1){
      const msg=String(e1.message||'');
      return showToast((e1.code==='23505'||/already exists|duplicate key|unique constraint/i.test(msg))
        ? 'Product Code "'+newCode+'" already exists. Use the existing product instead.'
        : msg,'err');
    }
    const {error:e2}=await db.from('product_admin_details').upsert({product_id:id,location:document.getElementById('epLocation').value.trim()||null,updated_at:new Date().toISOString()},{onConflict:'product_id'});if(e2)return showToast(e2.message,'err');

    if(epSelectedPhoto){
      if(typeof window.uploadProductDrivePhoto!=='function'){
        return showToast('Product details were updated, but the photo uploader is unavailable. Refresh the app and try the photo again.','err');
      }
      const submitBtn=document.querySelector('#editProductForm button[type="submit"]');
      if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Uploading Photo...';}
      if(epPhotoStatus){
        epPhotoStatus.textContent='Uploading replacement photo...';
        epPhotoStatus.className='text-[10px] text-amber-600 mt-2';
      }
      try{
        const uploadedUrl=await window.uploadProductDrivePhoto(id,newCode,epSelectedPhoto);
        if(uploadedUrl){
          row.image_url=uploadedUrl;
          p.image_url=uploadedUrl;
        }
      }catch(photoErr){
        if(submitBtn){submitBtn.disabled=false;submitBtn.textContent='Save Product';}
        if(epPhotoStatus){
          epPhotoStatus.textContent='Photo upload failed: '+(photoErr.message||photoErr);
          epPhotoStatus.className='text-[10px] text-red-600 mt-2';
        }
        return showToast('Product details saved, but photo replacement failed: '+(photoErr.message||photoErr),'err');
      }
    }

    closeModal();showToast(epSelectedPhoto?'Product updated and photo replaced':'Product updated');await renderProducts();
  };
}

function openNewProduct(){
  if(!isAdmin())return;
  openModal('Add Product',`<form id="productForm" class="grid md:grid-cols-2 gap-4">
    <input name="code" required class="border rounded-xl px-3 py-2" placeholder="Code"><input name="item_name" required class="border rounded-xl px-3 py-2" placeholder="Item name">
    <input name="brand" class="border rounded-xl px-3 py-2" placeholder="Brand"><input name="class" class="border rounded-xl px-3 py-2" placeholder="Class">
    <input name="sales_price" type="number" min="0" step="0.01" class="border rounded-xl px-3 py-2" placeholder="Sales price"><input name="stock_qty" type="number" min="0" step="0.01" class="border rounded-xl px-3 py-2" placeholder="Stock quantity">
    <input name="location" class="border rounded-xl px-3 py-2" placeholder="Location"><input name="currency" value="USD" class="border rounded-xl px-3 py-2" placeholder="Currency">
    <textarea name="description" class="md:col-span-2 border rounded-xl px-3 py-2" placeholder="Description"></textarea><input name="image_url" class="md:col-span-2 border rounded-xl px-3 py-2" placeholder="Image URL">
    <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3">Save Product</button>
  </form>`);
  document.getElementById('productForm').onsubmit=async e=>{
    e.preventDefault();const f=Object.fromEntries(new FormData(e.target).entries());const location=f.location||null;delete f.location;
    f.sales_price=Number(f.sales_price||0);f.stock_qty=Number(f.stock_qty||0);f.image_url=normalizeGoogleImageUrl(f.image_url);f.manual_override=true;Object.keys(f).forEach(k=>f[k]===''&&(f[k]=null));
    const {data,error}=await db.from('product_catalog').insert(f).select('id').single();if(error)return showToast(error.message,'err');
    if(location){const {error:e2}=await db.from('product_admin_details').insert({product_id:data.id,location});if(e2)return showToast(e2.message,'err')}
    closeModal();showToast('Product added');await renderProducts();
  };
}


async function deleteAppProduct(id){
  if(state.profile?.role!=='super_admin')return showToast('Only Super Admin can delete/archive products.','err');
  const p=productById(id);
  if(!p)return showToast('Product not found.','err');
  if(p.archived_at||p.active===false)return showToast('Product is already inactive or archived.','err');

  if(!confirm(
    'DELETE / ARCHIVE PRODUCT: '+(p.code||p.item_name||'Product')+'\n\n'+
    'This removes the product from the active catalog, but does not erase its product ID, Sales Orders, POs, or stock history.\n\n'+
    'Products that still have stock or unfinished Sales Orders / Supplier POs cannot be archived.\n\n'+
    'Only you as Super Admin can restore the product. Continue?'
  ))return;

  const {data,error}=await db.rpc('superadmin_archive_product',{
    p_product_id:id,p_reason:'Archived by Super Admin from Products'
  });
  if(error)return showToast(error.message||'Could not archive product.','err');
  closeModal();
  showToast('Product '+(data?.code||p.code||'')+' archived. Historical records preserved.');
  await renderProducts();
}

async function restoreArchivedProduct(id){
  if(state.profile?.role!=='super_admin')return showToast('Only Super Admin can restore products.','err');
  const p=productById(id);
  if(!p||!p.archived_at)return showToast('Product is not in the archived list.','err');
  if(!confirm('Restore '+(p.code||p.item_name)+' to the active Products catalog?'))return;
  const {error}=await db.rpc('superadmin_restore_product',{p_product_id:id});
  if(error)return showToast(error.message||'Could not restore product.','err');
  closeModal();
  showToast('Product restored to the active catalog.');
  await renderProducts();
}
