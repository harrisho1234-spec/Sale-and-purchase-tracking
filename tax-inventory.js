// Tax classification is product metadata. Stock quantities always come from the ledger.
(function(){
  const T={products:[],byId:new Map(),productOnly:false,procurementOnly:false,preview:[],busy:false};
  const norm=v=>String(v??'').trim().toLowerCase();
  const superAdmin=()=>state.profile?.role==='super_admin'&&state.profile?.active!==false;
  window.taxFetchAll=async function(table,columns='*',order='id',rpc=false){
    const rows=[];
    for(let from=0;;from+=1000){
      const query=rpc?db.rpc(table):db.from(table).select(columns);
      const r=await query.order(order).range(from,from+999);
      if(r.error)throw r.error;
      rows.push(...(r.data||[]));
      if((r.data||[]).length<1000)return rows;
    }
  };
  window.loadTaxProducts=async function(){
    T.products=await taxFetchAll('product_catalog','id,code,item_name,active,tax_item,tax_group_or_set,tax_note,tax_updated_at,tax_updated_by');
    T.byId=new Map(T.products.map(p=>[p.id,p]));
    return T.products;
  };
  window.taxProduct=p=>p&&Object.hasOwn(p,'tax_item')?p:(T.byId.get(p?.product_id||p?.id)||p||{});
  window.taxBadge=p=>taxProduct(p).tax_item?'<span class="tax-badge">TAX</span>':'';
  window.taxProductMatches=p=>!T.productOnly||!!taxProduct(p).tax_item;
  window.taxProcurementMatches=p=>!T.procurementOnly||!!taxProduct(p).tax_item;
  window.taxFilterControl=context=>`<label class="inline-flex gap-2 items-center text-xs px-3 py-2 border rounded-xl bg-white"><input type="checkbox" ${T[context==='products'?'productOnly':'procurementOnly']?'checked':''} onchange="setTaxOnly('${context}',this.checked)">Tax Items Only</label>`;
  window.setTaxOnly=function(context,value){
    T[context==='products'?'productOnly':'procurementOnly']=!!value;
    if(context==='products'){state.productPage=1;return renderProducts()}
    return renderProcurementWorkspace();
  };
  const style=document.createElement('style');
  style.textContent='.tax-badge{display:inline-block;margin-left:6px;padding:2px 6px;border:1px solid #d6b55d;border-radius:5px;color:#795600;background:#fff6d8;font-size:9px;font-weight:800;vertical-align:middle}.tax-panel{margin-bottom:16px;padding:16px;border:1px solid #ead7a1;background:#fffdf5;border-radius:12px}.tax-table{width:100%;font-size:12px;border-collapse:collapse}.tax-table td,.tax-table th{padding:8px;text-align:left;border-bottom:1px solid #eee;overflow-wrap:anywhere}';
  document.head.appendChild(style);

  window.taxMetadataPanel=function(p){
    p=taxProduct(p);
    return `<section class="tax-panel"><div class="flex justify-between gap-3"><b>Tax classification ${taxBadge(p)}</b>${superAdmin()?`<button class="px-3 py-2 border rounded-xl text-xs" onclick="openTaxEditor('${p.id||p.product_id}')">Edit Tax Classification</button>`:''}</div><div class="text-xs mt-2">Tax Item: <b>${p.tax_item?'Yes':'No'}</b> · Group / Set: ${esc(p.tax_group_or_set||'—')}</div>${p.tax_note?`<div class="text-xs mt-2 whitespace-pre-wrap">${esc(p.tax_note)}</div>`:''}${p.tax_updated_at?`<div class="text-[10px] text-gray-500 mt-2">Updated ${esc(new Date(p.tax_updated_at).toLocaleString())}</div>`:''}</section>`;
  };
  async function refreshAfterTax(){
    await loadTaxProducts();
    window.invalidateInventoryCache?.();
    if(state.page==='products')await renderProducts();
    else if(state.page==='stock-inventory')await renderStockInventory();
    else if(state.page==='procurement')await renderProcurementWorkspace();
  }
  window.openTaxEditor=async function(id){
    if(!superAdmin())return showToast('Super Admin only.','err');
    try{
      await loadTaxProducts();const p=T.byId.get(id);if(!p)throw new Error('Product not found.');
      openModal('Edit Tax Classification',`<form id="taxEditForm" class="space-y-4"><p><b>${esc(p.code)}</b> · ${esc(p.item_name)}</p><label class="flex gap-2"><input id="taxFlag" type="checkbox" ${p.tax_item?'checked':''}>Tax Item</label><label class="block">Tax Group / Set (optional)<input id="taxGroup" maxlength="200" value="${esc(p.tax_group_or_set||'')}" class="w-full border rounded-xl p-3"></label><label class="block">Tax Note (optional)<textarea id="taxNote" maxlength="2000" class="w-full border rounded-xl p-3">${esc(p.tax_note||'')}</textarea></label><p class="text-xs text-gray-500">This updates product classification. Inventory quantities continue to follow the stock ledger.</p><button class="px-4 py-3 bg-[#211d18] text-white rounded-xl">Save Tax Classification</button></form>`);
      document.getElementById('taxEditForm').onsubmit=async e=>{
        e.preventDefault();const button=e.target.querySelector('button');button.disabled=true;
        try{
          const r=await db.rpc('set_product_tax_metadata',{p_items:[{product_id:p.id,code:p.code,expected_tax_updated_at:p.tax_updated_at,tax_item:document.getElementById('taxFlag').checked,tax_group_or_set:document.getElementById('taxGroup').value.trim()||null,tax_note:document.getElementById('taxNote').value.trim()||null}]});
          if(r.error)throw r.error;closeModal();await refreshAfterTax();showToast('Tax classification saved.');
        }catch(err){showToast(err.message,'err')}finally{button.disabled=false}
      };
    }catch(err){showToast(err.message,'err')}
  };

  // CSV/TSV parser supports quoted commas, tabs, line breaks, and escaped quotes.
  window.parseTaxCodes=function(text){
    text=String(text||'').replace(/^\uFEFF/,'');
    const delimiter=text.split(/\r?\n/)[0].includes('\t')?'\t':',';
    const rows=[];let row=[],cell='',quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i];
      if(c==='"'){
        if(quoted&&text[i+1]==='"'){cell+='"';i++}
        else if(quoted||cell==='')quoted=!quoted;
        else throw new Error('Invalid quote in SKU input.');
      }else if(c===delimiter&&!quoted){row.push(cell);cell=''}
      else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(x=>x.trim()))rows.push(row);row=[];cell=''}
      else cell+=c;
    }
    if(quoted)throw new Error('Unclosed quote in SKU input.');
    row.push(cell);if(row.some(x=>x.trim()))rows.push(row);
    if(rows.length&&['sku','code','product code','product_code'].includes(norm(rows[0][0])))rows.shift();
    if(rows.length>500)throw new Error('Use at most 500 rows per batch.');
    return rows.map((r,i)=>{
      if(r.length>3)throw new Error(`Row ${i+1}: expected SKU, optional group/set, optional note.`);
      const result={code:String(r[0]||'').trim()};
      if(r.length>1)result.tax_group_or_set=r[1].trim()||null;
      if(r.length>2)result.tax_note=r[2].trim()||null;
      if((result.tax_group_or_set||'').length>200||(result.tax_note||'').length>2000)throw new Error(`Row ${i+1}: group/set or note is too long.`);
      return result;
    });
  };
  window.matchTaxCodes=function(rows,products){
    const codes=new Map();for(const p of products){const key=norm(p.code);if(!codes.has(key))codes.set(key,[]);codes.get(key).push(p)}
    const counts=new Map();rows.forEach(r=>counts.set(norm(r.code),(counts.get(norm(r.code))||0)+1));
    return rows.map(r=>{
      const matches=codes.get(norm(r.code))||[];
      const status=!r.code?'Missing code':counts.get(norm(r.code))>1?'Duplicate input':matches.length>1?'Ambiguous code':!matches.length?'Unmatched':'Matched';
      return {...r,status,product:status==='Matched'?matches[0]:null};
    });
  };
  window.openBulkTaxTagging=async function(){
    if(!superAdmin())return showToast('Super Admin only.','err');
    T.preview=[];
    openModal('Bulk Tax Tagging',`<div class="space-y-4"><p class="text-sm">Paste one SKU per line, or upload CSV / TSV / TXT. Optional columns: <b>SKU, group/set, note</b>. Omitted columns keep existing values; empty columns clear them. Matching ignores case and surrounding spaces.</p><label class="block text-sm">Upload codes<input id="taxUpload" type="file" accept=".csv,.tsv,.txt" class="block mt-2"></label><label class="block text-sm">SKU / product codes<textarea id="taxPaste" rows="7" class="w-full border rounded-xl p-3 mt-2" placeholder="SKU,group/set,note"></textarea></label><label class="flex gap-2"><input id="taxBulkFlag" type="checkbox" checked>Mark selected products as Tax Items (uncheck to remove classification)</label><button id="taxPreviewButton" onclick="previewTaxTagging()" class="px-4 py-2 border rounded-xl">Preview Matches</button><div id="taxPreview" aria-live="polite"></div></div>`);
    const invalidate=()=>{T.preview=[];document.getElementById('taxPreview').innerHTML=''};
    document.getElementById('taxPaste').oninput=invalidate;
    document.getElementById('taxBulkFlag').onchange=invalidate;
    document.getElementById('taxUpload').onchange=async e=>{
      try{const file=e.target.files[0];if(!file)return;if(file.size>1048576)throw new Error('Upload a file smaller than 1 MB.');document.getElementById('taxPaste').value=await file.text();invalidate()}catch(err){showToast(err.message,'err')}
    };
  };
  window.previewTaxTagging=async function(){
    if(!superAdmin()||T.busy)return;
    const button=document.getElementById('taxPreviewButton');button.disabled=true;
    T.preview=[];document.getElementById('taxPreview').innerHTML='Loading preview…';
    try{
      const source=document.getElementById('taxPaste').value,flag=document.getElementById('taxBulkFlag').checked;
      const rows=parseTaxCodes(source);if(!rows.length)throw new Error('Enter at least one SKU.');
      await loadTaxProducts();
      if(document.getElementById('taxPaste')?.value!==source||document.getElementById('taxBulkFlag')?.checked!==flag)return;
      T.preview=matchTaxCodes(rows,T.products).map(r=>({...r,tax_item:flag}));
      const matched=T.preview.filter(r=>r.product).length;
      document.getElementById('taxPreview').innerHTML=`<p class="text-sm mb-2"><b>${matched} matched</b> · ${rows.length-matched} unmatched / ambiguous / duplicate. Only checked matches will be updated.</p><div class="max-h-80 overflow-auto"><table class="tax-table"><thead><tr><th>Select</th><th>SKU / Product</th><th>Status</th><th>Tax Item</th><th>Group / Set</th><th>Note</th></tr></thead><tbody>${T.preview.map((r,i)=>`<tr><td><input type="checkbox" data-tax-index="${i}" ${r.product?'checked':'disabled'} aria-label="Select ${esc(r.code)}"></td><td>${esc(r.code)}<br>${esc(r.product?.item_name||'')}${r.product?.active===false?' (inactive)':''}</td><td>${esc(r.status)}</td><td>${r.product?(r.product.tax_item?'Yes':'No')+' → '+(flag?'Yes':'No'):'—'}</td><td>${esc(r.product?.tax_group_or_set||'—')} → ${esc(Object.hasOwn(r,'tax_group_or_set')?(r.tax_group_or_set||'—'):(r.product?.tax_group_or_set||'—'))}</td><td>${esc(r.product?.tax_note||'—')} → ${esc(Object.hasOwn(r,'tax_note')?(r.tax_note||'—'):(r.product?.tax_note||'—'))}</td></tr>`).join('')}</tbody></table></div><button id="taxApply" onclick="applyTaxTagging()" ${matched?'':'disabled'} class="mt-4 px-4 py-3 bg-[#211d18] text-white rounded-xl disabled:opacity-40">Apply Selected Products</button>`;
    }catch(err){document.getElementById('taxPreview').textContent=err.message}finally{button.disabled=false}
  };
  window.applyTaxTagging=async function(){
    if(!superAdmin()||T.busy)return;
    const selected=[...document.querySelectorAll('[data-tax-index]:checked')].map(el=>T.preview[Number(el.dataset.taxIndex)]).filter(r=>r?.product);
    if(!selected.length)return showToast('Select at least one matched product.','err');
    const p_items=selected.map(r=>{const item={product_id:r.product.id,code:r.product.code,expected_tax_updated_at:r.product.tax_updated_at,tax_item:r.tax_item};for(const key of ['tax_group_or_set','tax_note'])if(Object.hasOwn(r,key))item[key]=r[key];return item});
    T.busy=true;const button=document.getElementById('taxApply');button.disabled=true;
    try{
      const result=await db.rpc('set_product_tax_metadata',{p_items});if(result.error)throw result.error;
      T.preview=[];closeModal();await refreshAfterTax();showToast(`${result.data} products updated.`);
    }catch(err){showToast(err.message,'err')}finally{T.busy=false;button.disabled=false}
  };

  // Install wrappers after the existing role, procurement, and stock modules.
  window.installTaxInventoryUI=function(){
  const oldProducts=window.renderProducts;
  window.renderProducts=async function(){await loadTaxProducts();await oldProducts.apply(this,arguments);const input=document.getElementById('productSearch')||document.getElementById('stockControllerProductSearch');if(input)input.insertAdjacentHTML('afterend',taxFilterControl('products')+(superAdmin()?'<button onclick="openBulkTaxTagging()" class="px-3 py-2 border rounded-xl text-xs">Bulk Tax Tagging</button>':''))};
  const oldFiltered=window.filteredProducts;
  window.filteredProducts=function(){return oldFiltered.apply(this,arguments).filter(taxProductMatches)};
  const oldDetail=window.openProductDetail;
  window.openProductDetail=async function(id){await loadTaxProducts();await oldDetail.apply(this,arguments);const p=T.byId.get(id);if(p)document.getElementById('modalBody')?.insertAdjacentHTML('afterbegin',taxMetadataPanel(p))};
  const oldStockCard=window.openProductStockCard;
  window.openProductStockCard=async function(id){await oldStockCard.apply(this,arguments);const p=window.inventoryBalanceMap?.get(id);if(p)document.getElementById('modalBody')?.insertAdjacentHTML('afterbegin',taxMetadataPanel(p))};
  window.openProductStockHistory=window.openProductStockCard;
  const oldProc=window.renderProcurementWorkspace;
  window.renderProcurementWorkspace=async function(){await loadTaxProducts();await oldProc.apply(this,arguments);if(['items','needs','ordered'].includes(window.procurementWorkspace?.tab))document.querySelector('.pw-toolbar')?.insertAdjacentHTML('beforeend',taxFilterControl('procurement'))};
  window.renderSupplierPOs=window.renderProcurementWorkspace;
  };
})();
