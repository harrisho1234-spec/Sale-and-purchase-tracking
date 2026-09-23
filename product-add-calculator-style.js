// Calculator-style Add Product modal with direct photo upload to Supabase Storage.
// Loaded after product-admin.js so it intentionally overrides openNewProduct only.
(function(){
  const BUCKET='product-images';
  let selectedProductPhoto=null;

  function moneyPlain(v){
    const n=Number(v||0);
    return '$'+n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }
  function safePathPart(v){
    return String(v||'product').trim().replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/-+/g,'-').slice(0,80)||'product';
  }
  function resetModalWidth(){
    const box=document.querySelector('#modal > div');
    if(!box)return;
    box.classList.remove('max-w-6xl');
    box.classList.add('max-w-4xl');
  }
  function widenModal(){
    const box=document.querySelector('#modal > div');
    if(!box)return;
    box.classList.remove('max-w-4xl');
    box.classList.add('max-w-6xl');
  }
  function addStyles(){
    if(document.getElementById('product-add-calculator-style'))return;
    const style=document.createElement('style');
    style.id='product-add-calculator-style';
    style.textContent=`
      .pa-shell{border:1px solid #e6e9ef;border-radius:14px;overflow:hidden;background:#fff}
      .pa-head{display:grid;grid-template-columns:118px 1fr;gap:14px;padding:14px;background:#f8f9fb;border-bottom:1px solid #e7eaf0}
      .pa-photo{width:108px;height:108px;border:1px dashed #cbd2dc;border-radius:12px;background:#fff;display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:pointer;position:relative}
      .pa-photo:hover{border-color:#8f98a8;background:#fbfcfd}
      .pa-photo img{width:100%;height:100%;object-fit:cover;display:none}
      .pa-photo .pa-placeholder{text-align:center;font-size:10px;line-height:1.25;color:#7b8494;font-weight:700}
      .pa-metrics{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;align-items:end}
      .pa-field label{display:block;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.025em;color:#626b7b;margin:0 0 4px}
      .pa-field input,.pa-field select,.pa-field textarea{width:100%;border:1px solid #d9dee7;border-radius:8px;background:#fff;padding:8px 9px;font-size:12px;outline:none}
      .pa-field input:focus,.pa-field select:focus,.pa-field textarea:focus{border-color:#9aa3b2;box-shadow:0 0 0 3px rgba(17,24,39,.05)}
      .pa-output{height:36px;border:1px solid #dfe4eb;border-radius:8px;background:#fff;display:flex;align-items:center;padding:0 9px;font-size:12px;font-weight:850}
      .pa-sales{font-size:16px;background:#f8fafc}
      .pa-margin.good{color:#0f8a4b}.pa-margin.bad{color:#dc2626}
      .pa-details{padding:13px 14px 14px}
      .pa-details-grid{display:grid;grid-template-columns:1fr 1.6fr 1fr .65fr 1fr;gap:9px}
      .pa-desc{grid-column:span 3}
      .pa-note{margin-top:10px;padding:9px 10px;border-radius:9px;background:#faf9f6;border:1px solid #eee8df;font-size:10px;color:#6b7280}
      .pa-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:13px}
      .pa-actions button{border-radius:9px;padding:10px 16px;font-size:12px;font-weight:750}
      .pa-uploading{opacity:.65;pointer-events:none}
      @media(max-width:900px){
        .pa-head{grid-template-columns:1fr}.pa-photo{width:96px;height:96px}
        .pa-metrics{grid-template-columns:repeat(2,minmax(0,1fr))}
        .pa-details-grid{grid-template-columns:1fr 1fr}.pa-desc{grid-column:span 2}
      }
      @media(max-width:560px){
        .pa-metrics,.pa-details-grid{grid-template-columns:1fr}.pa-desc{grid-column:span 1}
      }
    `;
    document.head.appendChild(style);
  }

  async function uploadProductPhoto(productId,code,file){
    if(!file)return '';
    if(!String(file.type||'').startsWith('image/'))throw new Error('Please choose an image file.');
    if(file.size>8*1024*1024)throw new Error('Photo must be 8 MB or smaller.');

    const ext=(file.name.split('.').pop()||'jpg').replace(/[^a-zA-Z0-9]/g,'').toLowerCase()||'jpg';
    const token=(crypto.randomUUID?crypto.randomUUID():Date.now()+'-'+Math.random().toString(36).slice(2));
    const path=`products/${safePathPart(code)}/${productId}-${token}.${ext}`;
    const up=await db.storage.from(BUCKET).upload(path,file,{cacheControl:'3600',upsert:false,contentType:file.type||undefined});
    if(up.error)throw up.error;
    const pub=db.storage.from(BUCKET).getPublicUrl(path);
    const url=pub?.data?.publicUrl||'';
    if(!url)throw new Error('Photo uploaded but public URL could not be created.');
    const saved=await db.from('product_catalog').update({image_url:url,manual_override:true}).eq('id',productId);
    if(saved.error)throw saved.error;
    return url;
  }

  function recalc(){
    const cost=Number(document.getElementById('paCost')?.value||0);
    const shipping=Number(document.getElementById('paShipping')?.value||0);
    const price=Number(document.getElementById('paPrice')?.value||0);
    const landed=cost+shipping;
    const profit=price-landed;
    const margin=price>0?(profit/price*100):0;
    const landedEl=document.getElementById('paLanded');
    const marginEl=document.getElementById('paMargin');
    if(landedEl)landedEl.textContent=moneyPlain(landed);
    if(marginEl){
      marginEl.textContent=margin.toFixed(2)+'%';
      marginEl.classList.toggle('good',margin>=0);
      marginEl.classList.toggle('bad',margin<0);
    }
  }

  window.openNewProduct=function(){
    if(!isAdmin())return;
    addStyles();
    selectedProductPhoto=null;

    openModal('Add Product',`
      <form id="productForm" class="space-y-3">
        <div class="pa-shell">
          <div class="pa-head">
            <div>
              <label class="pa-photo" for="paPhotoInput">
                <img id="paPhotoPreview" alt="Product photo">
                <span id="paPhotoText" class="pa-placeholder">Add<br>Photo<br><span style="font-weight:500">JPG / PNG / WEBP</span></span>
              </label>
              <input id="paPhotoInput" type="file" accept="image/*" class="hidden">
            </div>

            <div class="pa-metrics">
              <div class="pa-field">
                <label>Costing / Unit</label>
                <input id="paCost" type="number" min="0" step="0.01" value="0" placeholder="0.00">
              </div>
              <div class="pa-field">
                <label>Shipping / Unit</label>
                <input id="paShipping" type="number" min="0" step="0.01" value="0" placeholder="0.00">
              </div>
              <div class="pa-field">
                <label>Landed / Unit</label>
                <div id="paLanded" class="pa-output">$0.00</div>
              </div>
              <div class="pa-field">
                <label>Sales Price</label>
                <input id="paPrice" class="pa-sales" type="number" min="0" step="0.01" value="0" placeholder="0.00">
              </div>
              <div class="pa-field">
                <label>Margin</label>
                <div id="paMargin" class="pa-output pa-margin good">0.00%</div>
              </div>
            </div>
          </div>

          <div class="pa-details">
            <div class="pa-details-grid">
              <div class="pa-field">
                <label>Code / SKU</label>
                <input id="paCode" required placeholder="Code">
              </div>
              <div class="pa-field">
                <label>Product</label>
                <input id="paName" required placeholder="Product name">
              </div>
              <div class="pa-field">
                <label>Brand</label>
                <input id="paBrand" placeholder="Brand">
              </div>
              <div class="pa-field">
                <label>Stock Qty</label>
                <input id="paQty" type="number" min="0" step="0.01" value="0">
              </div>
              <div class="pa-field">
                <label>Class</label>
                <input id="paClass" placeholder="Class">
              </div>

              <div class="pa-field">
                <label>Location</label>
                <input id="paLocation" placeholder="Location">
              </div>
              <div class="pa-field pa-desc">
                <label>Size / Description</label>
                <input id="paDescription" placeholder="Size, dimensions or product description">
              </div>
              <div class="pa-field">
                <label>Currency</label>
                <select id="paCurrency"><option value="USD">USD</option></select>
              </div>
            </div>

            <div class="pa-note">
              The photo is uploaded directly from your computer/phone and stored in the app's product-image storage. You no longer need to paste an Image URL. New products are queued to the <b>App Products</b> sheet automatically.
            </div>
          </div>
        </div>

        <div class="pa-actions">
          <button type="button" onclick="closeModal()" class="border bg-white">Cancel</button>
          <button id="paSaveBtn" type="submit" class="bg-[#211d18] text-white">Save Product</button>
        </div>
      </form>
    `);
    widenModal();

    const photo=document.getElementById('paPhotoInput');
    photo.addEventListener('change',()=>{
      selectedProductPhoto=photo.files?.[0]||null;
      const img=document.getElementById('paPhotoPreview');
      const txt=document.getElementById('paPhotoText');
      if(!selectedProductPhoto){img.style.display='none';img.removeAttribute('src');txt.style.display='block';return;}
      if(!String(selectedProductPhoto.type||'').startsWith('image/')){showToast('Please choose an image file.','err');photo.value='';selectedProductPhoto=null;return;}
      if(selectedProductPhoto.size>8*1024*1024){showToast('Photo must be 8 MB or smaller.','err');photo.value='';selectedProductPhoto=null;return;}
      img.src=URL.createObjectURL(selectedProductPhoto);img.style.display='block';txt.style.display='none';
    });

    ['paCost','paShipping','paPrice'].forEach(id=>document.getElementById(id)?.addEventListener('input',recalc));
    recalc();

    document.getElementById('productForm').onsubmit=async e=>{
      e.preventDefault();
      const form=e.currentTarget;
      const btn=document.getElementById('paSaveBtn');
      const code=document.getElementById('paCode').value.trim();
      const name=document.getElementById('paName').value.trim();
      if(!code||!name)return showToast('Product code and product name are required.','err');

      const unitCost=Number(document.getElementById('paCost').value||0);
      const shipping=Number(document.getElementById('paShipping').value||0);
      const landed=unitCost+shipping;
      const location=document.getElementById('paLocation').value.trim()||null;
      const brand=document.getElementById('paBrand').value.trim()||null;

      btn.disabled=true;btn.textContent=selectedProductPhoto?'Saving & uploading photo...':'Saving product...';
      form.classList.add('pa-uploading');

      try{
        const productRow={
          code,
          item_name:name,
          brand,
          class:document.getElementById('paClass').value.trim()||null,
          description:document.getElementById('paDescription').value.trim()||null,
          stock_qty:Number(document.getElementById('paQty').value||0),
          sales_price:Number(document.getElementById('paPrice').value||0),
          currency:'USD',
          active:true,
          manual_override:true,
          source_system:'app_created',
          source_row_key:'app:'+code.toLowerCase()
        };

        const ins=await db.from('product_catalog').insert(productRow).select('id').single();
        if(ins.error)throw ins.error;
        const productId=ins.data.id;

        const admin=await db.from('product_admin_details').upsert({
          product_id:productId,
          location,
          updated_at:new Date().toISOString()
        },{onConflict:'product_id'});
        if(admin.error)throw admin.error;

        const cost=await db.from('product_costs').upsert({
          product_id:productId,
          vendor_name:brand,
          cost_currency:'USD',
          unit_cost:unitCost,
          shipping_cost:shipping,
          landed_cost:landed,
          notes:'Created from Add Product',
          updated_at:new Date().toISOString()
        },{onConflict:'product_id'});
        if(cost.error)throw cost.error;

        let photoWarning='';
        if(selectedProductPhoto){
          try{await uploadProductPhoto(productId,code,selectedProductPhoto)}
          catch(photoErr){photoWarning=' Product saved, but photo upload failed: '+photoErr.message}
        }

        resetModalWidth();
        closeModal();
        showToast(photoWarning?photoWarning:'Product added · queued for App Products sync',photoWarning?'err':'ok');
        await renderProducts();
      }catch(err){
        showToast(err.message||String(err),'err');
        btn.disabled=false;btn.textContent='Save Product';form.classList.remove('pa-uploading');
      }
    };
  };

  // Restore the normal modal width when the user closes this modal.
  const originalClose=window.closeModal;
  window.closeModal=function(){
    resetModalWidth();
    selectedProductPhoto=null;
    return originalClose.apply(this,arguments);
  };
})();
