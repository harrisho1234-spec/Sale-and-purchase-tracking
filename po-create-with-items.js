// Create Supplier PO with items in one workflow.
// Loaded last so it replaces the older header-only Create / Upload Supplier PO modal.
(function(){
  let poProducts=[];
  let poItemSeq=0;

  function isAdminRole(){return ['admin','super_admin'].includes(state.profile?.role||'')}
  function uploaderReady(){return /^https:\/\/script\.google\.com\/macros\/s\//i.test(String(window.APP_CONFIG?.DRIVE_PHOTO_UPLOAD_URL||''))}
  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function imgUrl(raw){return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw||''):(raw||'')}
  function photoBox(url,size=72){
    const u=imgUrl(url);
    if(!u)return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 flex items-center justify-center text-[9px] text-gray-400 shrink-0">No Photo</div>`;
    return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 overflow-hidden shrink-0"><img src="${esc(u)}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full items-center justify-center text-[9px] text-gray-400">No Photo</div></div>`;
  }
  function fileToBase64(file){return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result||'').split(',').pop()||'');r.onerror=()=>reject(new Error('Could not read photo file.'));r.readAsDataURL(file)})}
  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
  function addHidden(form,name,value){const i=document.createElement('input');i.type='hidden';i.name=name;i.value=String(value??'');form.appendChild(i)}

  async function uploadPOItemPhoto(itemId,file,updateProduct=true){
    if(!uploaderReady())throw new Error('Google Drive photo uploader is not connected.');
    if(!file)throw new Error('Choose a photo first.');
    if(!String(file.type||'').startsWith('image/'))throw new Error('Please choose an image file.');
    if(file.size>8*1024*1024)throw new Error('Photo must be 8 MB or smaller.');

    const {data:sessionData,error:sessionErr}=await db.auth.getSession();
    if(sessionErr||!sessionData?.session?.access_token)throw new Error('Your login session expired. Please sign in again.');
    const token=sessionData.session.access_token;
    const before=await db.from('supplier_po_items').select('drive_file_id,image_url_snapshot').eq('id',itemId).single();
    if(before.error)throw before.error;
    const base64=await fileToBase64(file);

    const frameName='po-create-drive-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const iframe=document.createElement('iframe');iframe.name=frameName;iframe.style.display='none';document.body.appendChild(iframe);
    const form=document.createElement('form');form.method='POST';form.action=APP_CONFIG.DRIVE_PHOTO_UPLOAD_URL;form.target=frameName;form.style.display='none';
    addHidden(form,'access_token',token);
    addHidden(form,'supabase_url',APP_CONFIG.SUPABASE_URL);
    addHidden(form,'supabase_key',APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);
    addHidden(form,'po_item_id',itemId);
    addHidden(form,'file_name',file.name||'product-photo.jpg');
    addHidden(form,'mime_type',file.type||'image/jpeg');
    addHidden(form,'update_product',updateProduct?'true':'false');
    addHidden(form,'base64',base64);
    document.body.appendChild(form);form.submit();

    const oldId=String(before.data?.drive_file_id||'');
    const oldUrl=String(before.data?.image_url_snapshot||'');
    let result=null;
    for(let i=0;i<60;i++){
      await sleep(1000);
      const r=await db.from('supplier_po_items').select('drive_file_id,image_url_snapshot').eq('id',itemId).single();
      if(!r.error){
        const newId=String(r.data?.drive_file_id||'');
        const newUrl=String(r.data?.image_url_snapshot||'');
        if((newId&&newId!==oldId)||(newUrl&&newUrl!==oldUrl)){result=r.data;break;}
      }
    }
    form.remove();setTimeout(()=>iframe.remove(),1000);
    if(!result)throw new Error('Google Drive upload did not finish. Please check the Apps Script deployment.');
    return result;
  }

  async function loadProducts(){
    const all=[];
    for(let from=0;;from+=1000){
      const r=await db.from('product_catalog').select('id,code,item_name,brand,class,image_url,active').order('item_name').range(from,from+999);
      if(r.error)throw r.error;
      all.push(...(r.data||[]));
      if(!r.data||r.data.length<1000)break;
    }
    poProducts=all;
  }

  function productDisplay(p){return `${p.code||''} · ${p.item_name||''}`}
  function findProduct(value){
    const raw=String(value||'').trim();if(!raw)return null;
    const code=raw.split(' · ')[0].trim().toLowerCase();
    return poProducts.find(p=>String(p.code||'').toLowerCase()===code)||poProducts.find(p=>productDisplay(p).toLowerCase()===raw.toLowerCase())||null;
  }

  function rowHtml(){
    const n=++poItemSeq;
    return `<div class="po-create-item rounded-2xl border border-[#ebe6dd] bg-[#fffefb] p-4" data-index="${n}" data-product-id="">
      <div class="flex flex-col lg:flex-row gap-4">
        <div class="po-create-preview shrink-0">${photoBox('',76)}</div>
        <div class="flex-1 min-w-0 grid md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div class="md:col-span-2 xl:col-span-3">
            <label class="text-[10px] uppercase font-bold text-gray-400">Search Existing Product</label>
            <input list="poCreateProductList" class="po-product-search mt-1 w-full border rounded-xl px-3 py-2.5 text-sm" placeholder="Type product code or item name" onchange="poCreatePickProduct(this)">
          </div>
          <div class="xl:col-span-1">
            <label class="text-[10px] uppercase font-bold text-gray-400">Qty</label>
            <input class="po-qty mt-1 w-full border rounded-xl px-3 py-2.5" type="number" min="0.01" step="0.01" value="1" oninput="poCreateRecalcRow(this)">
          </div>
          <div class="xl:col-span-1">
            <label class="text-[10px] uppercase font-bold text-gray-400">Unit Cost</label>
            <input class="po-unit-cost mt-1 w-full border rounded-xl px-3 py-2.5" type="number" min="0" step="0.01" value="0" oninput="poCreateRecalcRow(this)">
          </div>
          <div class="xl:col-span-1">
            <label class="text-[10px] uppercase font-bold text-gray-400">Shipping / Unit</label>
            <input class="po-shipping mt-1 w-full border rounded-xl px-3 py-2.5" type="number" min="0" step="0.01" value="0" oninput="poCreateRecalcRow(this)">
          </div>
          <div class="md:col-span-1 xl:col-span-2">
            <label class="text-[10px] uppercase font-bold text-gray-400">Product Code / SKU</label>
            <input class="po-code mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="SKU / Code" oninput="poCreateManualCode(this)">
          </div>
          <div class="md:col-span-1 xl:col-span-3">
            <label class="text-[10px] uppercase font-bold text-gray-400">Item Name</label>
            <input class="po-name mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Item name">
          </div>
          <div class="xl:col-span-1 flex items-end">
            <div class="w-full rounded-xl bg-gray-50 border px-3 py-2.5"><div class="text-[9px] uppercase font-bold text-gray-400">Line Cost</div><div class="po-line-total text-sm font-bold mt-0.5">$0.00</div></div>
          </div>
        </div>
        <button type="button" onclick="poCreateRemoveItem(this)" class="self-start w-10 h-10 border rounded-xl text-red-500 font-bold">×</button>
      </div>
      <div class="mt-4 pt-4 border-t grid md:grid-cols-[1fr_auto] gap-3 items-center">
        <div>
          <label class="text-xs font-semibold">Product Photo <span class="text-gray-400 font-normal">(optional)</span></label>
          <input type="file" accept="image/*" class="po-photo mt-1 w-full border rounded-xl px-3 py-2 bg-white text-xs" onchange="poCreatePhotoChanged(this)">
          <div class="text-[10px] text-gray-400 mt-1">Photo is stored in your Google Drive Product Photos folder.</div>
        </div>
        <div class="space-y-2 text-[10px] text-gray-600">
          <label class="flex items-center gap-2"><input type="checkbox" class="po-update-photo" checked> Use uploaded photo as Product Catalog photo too.</label>
          <label class="flex items-center gap-2"><input type="checkbox" class="po-create-product" checked> If this is a new SKU, add it to Product Catalog as inactive.</label>
        </div>
      </div>
    </div>`;
  }

  window.poCreateAddItem=function(){
    const wrap=document.getElementById('poCreateItems');if(!wrap)return;
    wrap.insertAdjacentHTML('beforeend',rowHtml());
  };
  window.poCreateRemoveItem=function(btn){
    const row=btn.closest('.po-create-item');if(!row)return;
    row.remove();
    if(!document.querySelector('#poCreateItems .po-create-item'))poCreateAddItem();
  };
  window.poCreatePickProduct=function(input){
    const row=input.closest('.po-create-item');if(!row)return;
    const p=findProduct(input.value);
    if(!p){row.dataset.productId='';return;}
    row.dataset.productId=p.id;
    row.querySelector('.po-code').value=p.code||'';
    row.querySelector('.po-name').value=p.item_name||'';
    row.querySelector('.po-create-preview').innerHTML=photoBox(p.image_url||'',76);
  };
  window.poCreateManualCode=function(input){
    const row=input.closest('.po-create-item');if(!row)return;
    const p=poProducts.find(x=>String(x.code||'').toLowerCase()===String(input.value||'').trim().toLowerCase());
    if(p){row.dataset.productId=p.id;row.querySelector('.po-product-search').value=productDisplay(p);row.querySelector('.po-name').value=p.item_name||'';row.querySelector('.po-create-preview').innerHTML=photoBox(p.image_url||'',76)}
    else row.dataset.productId='';
  };
  window.poCreatePhotoChanged=function(input){
    const row=input.closest('.po-create-item'),box=row?.querySelector('.po-create-preview');if(!box)return;
    const f=input.files?.[0];
    if(!f){const p=poProducts.find(x=>x.id===row.dataset.productId);box.innerHTML=photoBox(p?.image_url||'',76);return;}
    if(!String(f.type||'').startsWith('image/')){input.value='';return showToast('Please choose an image file.','err')}
    if(f.size>8*1024*1024){input.value='';return showToast('Photo must be 8 MB or smaller.','err')}
    box.innerHTML=photoBox(URL.createObjectURL(f),76);
  };
  window.poCreateRecalcRow=function(input){
    const row=input.closest('.po-create-item');if(!row)return;
    const qty=Number(row.querySelector('.po-qty')?.value||0),cost=Number(row.querySelector('.po-unit-cost')?.value||0),ship=Number(row.querySelector('.po-shipping')?.value||0);
    const cur=document.getElementById('poCurrency')?.value||'USD';
    row.querySelector('.po-line-total').textContent=money(round2(qty*(cost+ship)),cur);
  };
  window.poCreateRecalcAll=function(){document.querySelectorAll('#poCreateItems .po-create-item .po-qty').forEach(poCreateRecalcRow)};

  async function ensureProduct(row,currency){
    const code=row.querySelector('.po-code').value.trim();
    const name=row.querySelector('.po-name').value.trim();
    if(!code&&!name)return {skip:true};
    if(!code||!name)throw new Error('Every PO item needs both Product Code and Item Name.');
    const qty=Number(row.querySelector('.po-qty').value||0);if(qty<=0)throw new Error(`Enter a valid quantity for ${code}.`);

    let product=poProducts.find(p=>p.id===row.dataset.productId)||poProducts.find(p=>String(p.code||'').toLowerCase()===code.toLowerCase())||null;
    if(!product&&row.querySelector('.po-create-product')?.checked){
      const ins=await db.from('product_catalog').insert({code,item_name:name,sales_price:0,stock_qty:0,currency:currency||'USD',active:false,manual_override:true}).select('id,code,item_name,image_url').single();
      if(ins.error){
        const again=await db.from('product_catalog').select('id,code,item_name,image_url').eq('code',code).maybeSingle();
        if(again.error||!again.data)throw ins.error;
        product=again.data;
      }else product=ins.data;
      poProducts.push(product);
    }
    return {skip:false,code,name,qty,product};
  }

  async function savePO(e){
    e.preventDefault();
    const btn=document.getElementById('poCreateSaveBtn');
    const status=document.getElementById('poCreateSaveStatus');
    const official=document.getElementById('poOfficialNo').value.trim()||null;
    const file=document.getElementById('poFile').files[0]||null;
    if(!official&&!file)return showToast('Enter a PO number or upload the pending PO/order document.','err');

    const rows=[...document.querySelectorAll('#poCreateItems .po-create-item')];
    btn.disabled=true;btn.textContent='Saving Supplier PO...';
    try{
      const currency=document.getElementById('poCurrency').value;
      const prepared=[];
      for(const r of rows){const x=await ensureProduct(r,currency);if(!x.skip)prepared.push({row:r,...x});}

      const poRow={
        po_number:official,
        vendor_name:document.getElementById('poVendor').value.trim(),
        order_date:document.getElementById('poOrderDate').value,
        currency,
        status:'placed',
        shipping_agent:document.getElementById('poAgent').value.trim()||null,
        estimated_arrival:document.getElementById('poEta').value||null,
        notes:document.getElementById('poNotes').value.trim()||null,
        created_by:state.user.id,
        po_pending_reference:official?null:`Pending ${new Date().toLocaleDateString()}`
      };
      if(!poRow.vendor_name)throw new Error('Vendor / Supplier is required.');
      const saved=await db.from('supplier_pos').insert(poRow).select('id').single();
      if(saved.error)throw saved.error;
      const poId=saved.data.id;

      if(file){
        status.textContent='Uploading PO document...';
        const safe=file.name.replace(/[^a-zA-Z0-9._-]/g,'_'),path=`${poId}/${Date.now()}-${safe}`;
        const up=await db.storage.from('po-documents').upload(path,file,{upsert:false});
        if(up.error)throw new Error(`PO saved but document upload failed: ${up.error.message}`);
        const doc=await db.from('supplier_pos').update({po_document_path:path,po_document_name:file.name}).eq('id',poId);
        if(doc.error)throw doc.error;
      }

      const photoJobs=[];
      let itemNo=0;
      for(const x of prepared){
        itemNo++;status.textContent=`Saving item ${itemNo} of ${prepared.length}...`;
        const product=x.product;
        const item={
          supplier_po_id:poId,
          product_id:product?.id||null,
          product_code_snapshot:x.code,
          item_name_snapshot:x.name,
          image_url_snapshot:product?.image_url||null,
          qty:x.qty,
          unit_cost:Number(x.row.querySelector('.po-unit-cost').value||0),
          shipping_cost:Number(x.row.querySelector('.po-shipping').value||0)
        };
        const ir=await db.from('supplier_po_items').insert(item).select('id').single();
        if(ir.error)throw ir.error;
        const photo=x.row.querySelector('.po-photo')?.files?.[0]||null;
        if(photo)photoJobs.push({id:ir.data.id,file:photo,update:!!x.row.querySelector('.po-update-photo')?.checked,code:x.code});
      }

      let failed=0;
      for(let i=0;i<photoJobs.length;i++){
        const j=photoJobs[i];status.textContent=`Uploading product photo ${i+1} of ${photoJobs.length} to Google Drive...`;
        try{await uploadPOItemPhoto(j.id,j.file,j.update)}catch(err){failed++;console.warn('PO item photo upload failed:',j.code,err)}
      }

      closeModal();
      if(window.documentFlowState)window.documentFlowState.loaded=false;
      if(failed)showToast(`Supplier PO saved. ${failed} product photo${failed===1?'':'s'} could not upload.`,'err');
      else showToast(prepared.length?`Supplier PO created with ${prepared.length} item${prepared.length===1?'':'s'}`:(official?'Supplier PO created':'Pending PO uploaded'));
      await go('procurement');
    }catch(err){
      showToast(err.message||'Could not save Supplier PO','err');
      btn.disabled=false;btn.textContent='Save Supplier PO';status.textContent='';
    }
  }

  window.openNewSupplierPO=async function(){
    if(!isAdminRole())return showToast('Admin access required','err');
    try{await loadProducts()}catch(err){return showToast(`Could not load products: ${err.message}`,'err')}
    poItemSeq=0;
    const options=poProducts.map(p=>`<option value="${esc(productDisplay(p))}"></option>`).join('');
    openModal('Create / Upload Supplier PO',`
      <form id="newPOFlowForm" class="space-y-5">
        <div class="grid md:grid-cols-2 gap-4">
          <div><label class="text-xs font-semibold">Official PO Number</label><input id="poOfficialNo" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Leave blank if pending"></div>
          <div><label class="text-xs font-semibold">Vendor / Supplier</label><input id="poVendor" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Order Date</label><input id="poOrderDate" type="date" value="${new Date().toISOString().slice(0,10)}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">Currency</label><select id="poCurrency" onchange="poCreateRecalcAll()" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option>USD</option><option>EUR</option><option>CNY</option><option>GBP</option></select></div>
          <div><label class="text-xs font-semibold">Shipping Agent</label><input id="poAgent" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div><label class="text-xs font-semibold">ETA</label><input id="poEta" type="date" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
          <div class="md:col-span-2"><label class="text-xs font-semibold">PO Document / Supplier Order File</label><input id="poFile" type="file" accept=".pdf,image/*" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><div class="text-[10px] text-gray-400 mt-1">If Accounting has not issued a PO number yet, upload the supplier/order document here.</div></div>
        </div>

        <div class="border-t pt-5">
          <div class="flex items-center justify-between gap-3 mb-3"><div><h4 class="font-bold">PO Items / Products</h4><p class="text-xs text-gray-400">Add the products on this supplier PO now. You can search existing products or enter a new SKU.</p></div><button type="button" onclick="poCreateAddItem()" class="px-3 py-2 border rounded-xl text-xs font-semibold">+ Add Item</button></div>
          <datalist id="poCreateProductList">${options}</datalist>
          <div id="poCreateItems" class="grid gap-3"></div>
          <button type="button" onclick="poCreateAddItem()" class="mt-3 w-full border border-dashed border-[#d8c28a] bg-[#fffdf7] text-[#8a6818] rounded-xl px-4 py-3 text-sm font-semibold">+ Add Another Item</button>
        </div>

        <div><label class="text-xs font-semibold">Notes</label><textarea id="poNotes" class="mt-1 w-full border rounded-xl px-3 py-2.5" rows="3"></textarea></div>
        <div id="poCreateSaveStatus" class="text-xs text-gray-500 text-center"></div>
        <button id="poCreateSaveBtn" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold disabled:opacity-50">Save Supplier PO</button>
      </form>`);
    poCreateAddItem();
    document.getElementById('newPOFlowForm').onsubmit=savePO;
  };
})();
