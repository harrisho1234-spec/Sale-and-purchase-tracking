// Admin-only product detail overrides. Loaded after app.js.

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
              <span class="text-xs px-2 py-1 rounded-full ${p.manual_override?'bg-amber-50 text-amber-700':'bg-green-50 text-green-700'}">${p.manual_override?'App-managed':'Google Sheet synced'}</span>
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
              <button onclick="openAdjustStock('${id}')" class="px-3 py-2.5 border rounded-xl text-sm">Adjust Stock</button>
              <button onclick="openEditCosting('${id}')" class="px-3 py-2.5 border rounded-xl text-sm">Edit Costing</button>
            </div>
            ${p.manual_override?`<button onclick="resumeProductSheetSync('${id}')" class="mt-2 w-full px-3 py-2 border border-amber-200 text-amber-700 bg-amber-50 rounded-xl text-xs">Resume Google Sheet sync for this product</button>`:''}
            ${history.length?`<div class="mt-5"><div class="text-xs font-bold uppercase text-gray-400 mb-2">Recent Stock Changes</div><div class="divide-y border rounded-xl">${history.map(h=>`<div class="p-2.5 flex justify-between gap-3 text-xs"><div><b>${esc(h.reason)}</b>${h.note?`<div class="text-gray-400">${esc(h.note)}</div>`:''}</div><div class="text-right"><b>${Number(h.previous_qty)} → ${Number(h.new_qty)}</b><div class="text-gray-400">${new Date(h.created_at).toLocaleString()}</div></div></div>`).join('')}</div></div>`:''}
          </div>`:''}
      </div>
    </div>`);
}

async function openEditProduct(id){
  const p=productById(id);if(!p||!isAdmin())return;
  let adminDetail=null;
  try{adminDetail=await getProductAdminDetail(id)}catch(err){return showToast(err.message,'err')}

  openModal('Edit Product',`<form id="editProductForm" class="grid md:grid-cols-2 gap-4">
    <div><label class="text-xs font-semibold">Code / SKU</label><input id="epCode" value="${esc(p.code)}" required class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Item Name</label><input id="epName" value="${esc(p.item_name)}" required class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Brand</label><input id="epBrand" value="${esc(p.brand||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Class</label><input id="epClass" value="${esc(p.class||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Sales Price</label><input id="epPrice" type="number" step="0.01" min="0" value="${Number(p.sales_price||0)}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div><label class="text-xs font-semibold">Location</label><input id="epLocation" value="${esc(adminDetail?.location||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <div class="md:col-span-2"><label class="text-xs font-semibold">Description</label><textarea id="epDescription" class="mt-1 w-full border rounded-xl px-3 py-2" rows="3">${esc(p.description||'')}</textarea></div>
    <div class="md:col-span-2"><label class="text-xs font-semibold">Photo URL</label><input id="epImage" value="${esc(p.image_url||'')}" class="mt-1 w-full border rounded-xl px-3 py-2"></div>
    <label class="flex items-center gap-2 text-sm"><input id="epActive" type="checkbox" ${p.active?'checked':''}> Active product</label>
    <div class="md:col-span-2 text-xs bg-amber-50 border border-amber-100 text-amber-800 rounded-xl p-3">Saving here marks this product as app-managed so Google Sheet product sync will not overwrite it.</div>
    <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Product</button>
  </form>`);

  document.getElementById('editProductForm').onsubmit=async e=>{
    e.preventDefault();
    const row={
      code:document.getElementById('epCode').value.trim(),item_name:document.getElementById('epName').value.trim(),
      brand:document.getElementById('epBrand').value.trim()||null,class:document.getElementById('epClass').value.trim()||null,
      sales_price:Number(document.getElementById('epPrice').value||0),description:document.getElementById('epDescription').value.trim()||null,
      image_url:normalizeGoogleImageUrl(document.getElementById('epImage').value),active:document.getElementById('epActive').checked,manual_override:true
    };
    const {error:e1}=await db.from('product_catalog').update(row).eq('id',id);if(e1)return showToast(e1.message,'err');
    const {error:e2}=await db.from('product_admin_details').upsert({product_id:id,location:document.getElementById('epLocation').value.trim()||null,updated_at:new Date().toISOString()},{onConflict:'product_id'});if(e2)return showToast(e2.message,'err');
    closeModal();showToast('Product updated');await renderProducts();
  };
}

function openNewProduct(){
  if(!isAdmin())return;
  openModal('Add Product',`<form id="productForm" class="grid md:grid-cols-2 gap-4">
    <input name="code" required class="border rounded-xl px-3 py-2" placeholder="Code / SKU"><input name="item_name" required class="border rounded-xl px-3 py-2" placeholder="Item name">
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
