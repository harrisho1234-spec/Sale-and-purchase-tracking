// Google Drive photo upload support for Supplier PO items.
// Requires APP_CONFIG.DRIVE_PHOTO_UPLOAD_URL to point to the deployed Apps Script web app.
(function(){
  const baseOpenEditSupplierPO=window.openEditSupplierPO;
  if(typeof baseOpenEditSupplierPO!=='function')return;

  function uploadUrl(){return String(window.APP_CONFIG?.DRIVE_PHOTO_UPLOAD_URL||'').trim()}
  function imgUrl(raw){return typeof normalizeGoogleImageUrl==='function'?normalizeGoogleImageUrl(raw||''):(raw||'')}
  function photoHtml(url,size=64){
    const u=imgUrl(url);
    if(!u)return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 flex items-center justify-center text-[9px] text-gray-400 shrink-0">No Photo</div>`;
    return `<div style="width:${size}px;height:${size}px" class="rounded-xl border bg-gray-100 overflow-hidden shrink-0"><img src="${esc(u)}" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'"><div style="display:none" class="w-full h-full items-center justify-center text-[9px] text-gray-400">No Photo</div></div>`;
  }
  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
  function fileToBase64(file){return new Promise((resolve,reject)=>{const fr=new FileReader();fr.onload=()=>resolve(String(fr.result||'').split(',').pop()||'');fr.onerror=()=>reject(new Error('Could not read photo file.'));fr.readAsDataURL(file)})}
  function uploaderReady(){return /^https:\/\/script\.google\.com\/macros\/s\//i.test(uploadUrl())}

  function addHidden(form,name,value){const i=document.createElement('input');i.type='hidden';i.name=name;i.value=String(value??'');form.appendChild(i)}

  async function uploadPOItemPhoto(itemId,file,updateProduct=true){
    if(!uploaderReady())throw new Error('Google Drive photo uploader is not connected yet.');
    if(!file)throw new Error('Choose a photo first.');
    if(!String(file.type||'').startsWith('image/'))throw new Error('Please choose an image file.');
    if(file.size>8*1024*1024)throw new Error('Photo must be 8 MB or smaller.');

    const {data:sessionData,error:sessionErr}=await db.auth.getSession();
    if(sessionErr||!sessionData?.session?.access_token)throw new Error('Your login session expired. Please sign in again.');
    const token=sessionData.session.access_token;
    const before=await db.from('supplier_po_items').select('drive_file_id,image_url_snapshot').eq('id',itemId).single();
    if(before.error)throw before.error;
    const base64=await fileToBase64(file);

    const frameName='drive-photo-'+Date.now()+'-'+Math.random().toString(36).slice(2);
    const iframe=document.createElement('iframe');iframe.name=frameName;iframe.style.display='none';document.body.appendChild(iframe);
    const form=document.createElement('form');form.method='POST';form.action=uploadUrl();form.target=frameName;form.style.display='none';
    addHidden(form,'access_token',token);
    addHidden(form,'supabase_url',APP_CONFIG.SUPABASE_URL);
    addHidden(form,'supabase_key',APP_CONFIG.SUPABASE_PUBLISHABLE_KEY);
    addHidden(form,'po_item_id',itemId);
    addHidden(form,'file_name',file.name||'product-photo.jpg');
    addHidden(form,'mime_type',file.type||'image/jpeg');
    addHidden(form,'update_product',updateProduct?'true':'false');
    addHidden(form,'base64',base64);
    document.body.appendChild(form);
    form.submit();

    const oldId=String(before.data?.drive_file_id||'');
    const oldUrl=String(before.data?.image_url_snapshot||'');
    let result=null;
    for(let i=0;i<45;i++){
      await sleep(1000);
      const r=await db.from('supplier_po_items').select('drive_file_id,image_url_snapshot').eq('id',itemId).single();
      if(!r.error){
        const newId=String(r.data?.drive_file_id||'');
        const newUrl=String(r.data?.image_url_snapshot||'');
        if((newId&&newId!==oldId)||(newUrl&&newUrl!==oldUrl)){result=r.data;break;}
      }
    }
    form.remove();setTimeout(()=>iframe.remove(),1000);
    if(!result)throw new Error('Google Drive upload did not finish. Please try again or check the Apps Script deployment.');
    return result;
  }

  function injectNewItemPhotoField(poId){
    const form=document.getElementById('addPOItemForm');if(!form)return;
    if(!document.getElementById('poiPhoto')){
      const button=form.querySelector('button[type="submit"],button:not([type])');
      const wrap=document.createElement('div');wrap.className='md:col-span-5 rounded-xl border border-[#e8e2d8] bg-white p-3';
      wrap.innerHTML=`
        <div class="flex flex-col sm:flex-row gap-3 sm:items-center">
          <div id="poiPhotoPreview">${photoHtml('',64)}</div>
          <div class="flex-1 min-w-0">
            <label class="text-xs font-semibold">Product Photo <span class="text-gray-400 font-normal">(optional)</span></label>
            <input id="poiPhoto" type="file" accept="image/*" class="mt-1 w-full border rounded-lg px-3 py-2 bg-white text-xs">
            <label class="mt-2 flex items-center gap-2 text-[10px] text-gray-600"><input id="poiPhotoUpdateCatalog" type="checkbox" checked> Also use this as the Product Catalog photo when the SKU matches an existing product.</label>
            <div class="text-[10px] text-gray-400 mt-1">The photo is stored in Google Drive, not inside the app database.</div>
          </div>
        </div>`;
      if(button)form.insertBefore(wrap,button);else form.appendChild(wrap);
      document.getElementById('poiPhoto').addEventListener('change',e=>{
        const f=e.target.files?.[0];const box=document.getElementById('poiPhotoPreview');if(!box)return;
        if(!f){box.innerHTML=photoHtml('',64);return;}
        const u=URL.createObjectURL(f);box.innerHTML=photoHtml(u,64);
      });
    }

    // Replace the original handler so we can get the new PO item ID, then attach its Drive photo.
    form.onsubmit=async e=>{
      e.preventDefault();
      const code=document.getElementById('poiCode').value.trim();
      const name=document.getElementById('poiName').value.trim();
      if(!code||!name)return showToast('Product code and item name are required.','err');
      const photo=document.getElementById('poiPhoto')?.files?.[0]||null;
      if(photo&&!uploaderReady())return showToast('Google Drive photo upload needs one-time setup first.','err');

      let productId=null;
      const q=await db.from('product_catalog').select('id').eq('code',code).maybeSingle();
      if(!q.error&&q.data)productId=q.data.id;
      const row={
        supplier_po_id:poId,
        product_id:productId,
        product_code_snapshot:code,
        item_name_snapshot:name,
        qty:Number(document.getElementById('poiQty').value||0),
        unit_cost:Number(document.getElementById('poiCost').value||0),
        shipping_cost:Number(document.getElementById('poiShipping').value||0)
      };
      if(!row.qty||row.qty<=0)return showToast('Enter a valid quantity.','err');
      const save=await db.from('supplier_po_items').insert(row).select('id').single();
      if(save.error)return showToast(save.error.message,'err');

      if(photo){
        showToast('PO item saved. Uploading photo to Google Drive...');
        try{
          await uploadPOItemPhoto(save.data.id,photo,!!document.getElementById('poiPhotoUpdateCatalog')?.checked);
          showToast('PO item and Google Drive photo saved');
        }catch(err){
          showToast(`PO item saved, but photo upload failed: ${err.message}`,'err');
        }
      }else showToast('PO item added');
      await openEditSupplierPO(poId);
    };
  }

  async function loadPhotoRows(poId){
    let r=await db.from('supplier_po_items').select('id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,drive_file_id,created_at,product_catalog(image_url)').eq('supplier_po_id',poId).order('created_at');
    if(r.error){
      r=await db.from('supplier_po_items').select('id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,drive_file_id,created_at').eq('supplier_po_id',poId).order('created_at');
    }
    if(r.error)throw r.error;
    return r.data||[];
  }

  async function injectExistingPhotoManager(poId){
    const form=document.getElementById('addPOItemForm');if(!form)return;
    document.getElementById('poItemPhotoManager')?.remove();
    let items=[];try{items=await loadPhotoRows(poId)}catch(err){console.warn('PO photo rows:',err.message);return;}
    if(!items.length)return;
    const wrap=document.createElement('div');wrap.id='poItemPhotoManager';wrap.className='mt-4 rounded-xl border border-[#eee8df] overflow-hidden';
    wrap.innerHTML=`
      <div class="px-4 py-3 bg-[#faf9f6] border-b"><div class="font-bold text-sm">PO Item Photos</div><div class="text-[10px] text-gray-400 mt-1">Upload or replace product photos. Files are stored in Google Drive.</div></div>
      <div class="divide-y">${items.map(i=>{
        const u=i.image_url_snapshot||i.product_catalog?.image_url||'';
        return `<div class="p-3 flex items-center gap-3">
          ${photoHtml(u,58)}
          <div class="min-w-0 flex-1"><div class="text-xs font-bold text-[#a77d1a] truncate">${esc(i.product_code_snapshot||'No Code')}</div><div class="text-sm truncate">${esc(i.item_name_snapshot||'')}</div><div class="text-[9px] text-gray-400 mt-1">${i.drive_file_id?'Stored in Google Drive':'No PO-item Drive photo yet'}</div></div>
          <button type="button" onclick="choosePOItemDrivePhoto('${i.id}','${poId}')" class="px-3 py-2 border rounded-lg text-[10px] font-semibold whitespace-nowrap">${u?'Replace Photo':'Upload Photo'}</button>
        </div>`;
      }).join('')}</div>`;
    form.insertAdjacentElement('afterend',wrap);
  }

  window.choosePOItemDrivePhoto=function(itemId,poId){
    if(!uploaderReady())return showToast('Google Drive photo upload needs one-time setup first.','err');
    const input=document.createElement('input');input.type='file';input.accept='image/*';input.style.display='none';document.body.appendChild(input);
    input.onchange=async()=>{
      const file=input.files?.[0];if(!file){input.remove();return;}
      showToast('Uploading photo to Google Drive...');
      try{
        await uploadPOItemPhoto(itemId,file,true);
        showToast('Google Drive photo updated');
        await openEditSupplierPO(poId);
      }catch(err){showToast(err.message,'err')}
      input.remove();
    };
    input.click();
  };

  async function enhance(poId){
    injectNewItemPhotoField(poId);
    await injectExistingPhotoManager(poId);
  }

  window.openEditSupplierPO=async function(poId){
    const r=await baseOpenEditSupplierPO.apply(this,arguments);
    await enhance(poId);
    return r;
  };
})();
