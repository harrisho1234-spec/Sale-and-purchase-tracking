// Stock Count UX improvements: in-place Add Item, reversible Set 0, clearer variance labels.
(function(){
  const UX={products:[],existingByCount:new Map()};

  function num(v){return Number(v||0)}
  function html(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function qty(v){const x=Number(v||0);return Number.isInteger(x)?String(x):String(Math.round(x*100)/100)}
  function role(){return String((typeof state!=='undefined'&&state?.profile?.role)||'')}
  function canEdit(){return ['stock_controller','admin','super_admin'].includes(role())}
  function modalBody(){return document.getElementById('modalBody')}

  function findRowsContainer(){
    const first=document.querySelector('#modalBody .stock-count-row');
    if(first?.parentElement)return first.parentElement;
    const headers=[...document.querySelectorAll('#modalBody .sticky')];
    const h=headers.find(x=>/product/i.test(x.textContent||'')&&/physical/i.test(x.textContent||''));
    return h?.parentElement||null;
  }

  function updateTopItemCount(){
    const body=modalBody();if(!body)return;
    const labels=[...body.querySelectorAll('div')].filter(x=>String(x.textContent||'').trim().toUpperCase()==='ITEMS');
    const label=labels[0];
    const value=label?.parentElement?.querySelector('b');
    const total=body.querySelectorAll('.stock-count-row').length;
    if(value)value.textContent=String(total);
  }

  function updateZeroButton(row){
    const input=row?.querySelector('.count-physical');
    const btn=row?.querySelector('.count-zero-action');
    if(!input||!btn)return;
    const isZero=String(input.value||'').trim()==='0';
    btn.textContent=isZero?'Clear':'Set 0';
    btn.title=isZero?'Clear Physical Qty back to not counted':'Counted: no physical stock found';
    btn.classList.toggle('text-red-600',isZero);
    btn.classList.toggle('border-red-200',isZero);
    btn.classList.toggle('bg-red-50',isZero);
  }

  function decorateRow(row){
    if(!row||row.dataset.stockCountUx==='1')return;
    row.dataset.stockCountUx='1';
    const input=row.querySelector('.count-physical');
    const oldBtn=[...row.querySelectorAll('button')].find(b=>String(b.getAttribute('onclick')||'').includes('setStockCountPhysicalZero'));
    if(oldBtn){
      oldBtn.className='count-zero-action shrink-0 px-2 h-8 rounded-lg border bg-gray-50 text-[9px] font-bold whitespace-nowrap';
      oldBtn.setAttribute('type','button');
      updateZeroButton(row);
    }
    if(input){
      input.addEventListener('input',()=>{updateZeroButton(row);row.classList.add('ring-1','ring-amber-300')});
      input.title='Enter the quantity physically found. Blank = not counted.';
    }
    row.querySelector('.count-qb')?.addEventListener('input',()=>row.classList.add('ring-1','ring-amber-300'));
    row.querySelector('.count-note')?.addEventListener('input',()=>row.classList.add('ring-1','ring-amber-300'));
    const v=row.querySelector('.count-var');
    if(v)v.title='Physical variance = Physical Qty − System Qty';
    const qv=row.querySelector('.count-qbvar');
    if(qv)qv.title='QB variance = QB Qty − System Qty';
  }

  function decorateStockCount(countId){
    const body=modalBody();if(!body)return;
    body.querySelectorAll('.stock-count-row').forEach(decorateRow);

    const sticky=[...body.querySelectorAll('.sticky')].find(x=>/product/i.test(x.textContent||'')&&/physical/i.test(x.textContent||''));
    if(sticky){
      const cols=[...sticky.children];
      if(cols[4]){cols[4].textContent='Physical Var';cols[4].title='Physical Qty − System Qty'}
      if(cols[5]){cols[5].textContent='QB Var';cols[5].title='QB Qty − System Qty'}
    }

    const guide=[...body.querySelectorAll('.text-\\[10px\\]')].find(x=>String(x.textContent||'').includes('Physical Qty:'));
    if(guide&&!document.getElementById('stockCountVarianceHelp')){
      guide.insertAdjacentHTML('beforeend',`<div id="stockCountVarianceHelp" class="mt-1 text-[9px] text-gray-400"><b>Physical Var = Physical − System.</b> Example: System 1, Physical 0 = <b class="text-red-600">−1</b> (1 unit missing). <b>Set 0</b> means counted and none found; click <b>Clear</b> to undo.</div>`);
    }

    if(countId&&!document.getElementById('stockCountSaveDraftBtn')){
      const submit=[...body.querySelectorAll('button')].find(b=>String(b.getAttribute('onclick')||'').includes('submitStockCount'));
      if(submit){
        submit.insertAdjacentHTML('beforebegin',`<button id="stockCountSaveDraftBtn" type="button" onclick="saveStockCountDraft('${html(countId)}')" class="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-xl text-xs font-semibold">Save Draft</button>`);
      }
    }
    updateTopItemCount();
    if(typeof window.updateStockCountProgress==='function')window.updateStockCountProgress();
  }

  function rowHtml(i){
    const system=num(i.system_qty);
    const physical=i.physical_qty==null?'':num(i.physical_qty);
    const qb=i.qb_qty==null?'':num(i.qb_qty);
    const variance=i.physical_qty!=null&&num(i.physical_qty)!==system;
    const p=i.product_catalog||{};
    const search=[p.code,p.item_name,p.brand].filter(Boolean).join(' ').toLowerCase();
    const photo=p.image_url
      ?`<img src="${html(p.image_url)}" alt="" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display='none';this.nextElementSibling?.classList.remove('hidden')"><div class="hidden w-full h-full items-center justify-center text-[7px] text-gray-400">No Photo</div>`
      :'<div class="w-full h-full flex items-center justify-center text-[7px] text-gray-400">No Photo</div>';
    return `<div data-count-item="${html(i.id)}" data-system="${system}" data-search="${html(search)}" data-variance="${variance?'1':'0'}" class="stock-count-row p-2 grid gap-2 items-center text-xs ${variance?'bg-red-50/40':''}" style="grid-template-columns:320px 90px 140px 110px 80px 80px 220px 70px">
      <div class="min-w-0 flex items-center gap-2.5"><div class="w-10 h-10 rounded-lg overflow-hidden bg-gray-100 border shrink-0">${photo}</div><div class="min-w-0"><div class="text-[9px] font-bold text-[#a77d1a] truncate">${html(p.code||'')}</div><div class="truncate">${html(p.item_name||'')}</div></div></div>
      <b class="text-right pr-2">${qty(system)}</b>
      <div class="flex items-center gap-1"><input class="count-physical min-w-0 w-full border rounded-lg px-2 py-1.5" type="number" min="0" step="1" value="${physical}" oninput="updateStockCountProgress();filterStockCountRows()" onkeydown="stockCountPhysicalKeydown(event,'${html(i.id)}')"><button type="button" onclick="setStockCountPhysicalZero('${html(i.id)}')" class="count-zero-action shrink-0 px-2 h-8 rounded-lg border bg-gray-50 text-[9px] font-bold whitespace-nowrap">Set 0</button></div>
      <input class="count-qb min-w-0 w-full border rounded-lg px-2 py-1.5" type="number" min="0" step="1" value="${qb}">
      <b class="count-var text-right pr-2 ${variance?'text-red-600':''}">${i.physical_qty==null?'-':qty(num(i.physical_qty)-system)}</b>
      <span class="count-qbvar text-right pr-2">${i.qb_qty==null?'-':qty(num(i.qb_qty)-system)}</span>
      <input class="count-note min-w-0 w-full border rounded-lg px-2 py-1.5" value="${html(i.note||'')}">
      <button onclick="saveStockCountRow('${html(i.id)}',true)" class="px-2 py-1.5 border rounded-lg text-[9px] font-semibold">Save</button>
    </div>`;
  }

  async function ensureProducts(){
    if(UX.products.length)return UX.products;
    const r=await db.from('inventory_product_balance').select('product_id,code,item_name,brand,image_url,on_hand').order('item_name').limit(5000);
    if(r.error)throw r.error;
    UX.products=r.data||[];
    return UX.products;
  }

  window.closeStockCountAddPanel=function(){
    document.getElementById('stockCountAddOverlay')?.remove();
  };

  window.openAddStockCountItem=async function(countId){
    if(!canEdit())return;
    const body=modalBody();if(!body)return;
    try{
      await ensureProducts();
      const er=await db.from('stock_count_items').select('product_id').eq('stock_count_id',countId).limit(5000);
      if(er.error)throw er.error;
      UX.existingByCount.set(String(countId),new Set((er.data||[]).map(x=>String(x.product_id))));
    }catch(err){return showToast(err.message||'Could not load products.','err')}
    document.getElementById('stockCountAddOverlay')?.remove();
    body.insertAdjacentHTML('beforeend',`<div id="stockCountAddOverlay" class="fixed inset-0 z-[220] bg-black/25 flex items-center justify-center p-4" onclick="if(event.target===this)closeStockCountAddPanel()">
      <div class="bg-white rounded-2xl shadow-2xl border w-full max-w-xl max-h-[78vh] overflow-visible p-5">
        <div class="flex items-center justify-between gap-3 mb-4"><div><h3 class="font-bold text-base">Add Item to Stock Count</h3><div class="text-[10px] text-gray-400 mt-1">The current count stays open in the background.</div></div><button type="button" onclick="closeStockCountAddPanel()" class="w-8 h-8 rounded-lg border text-gray-500">×</button></div>
        <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800 mb-3"><b>Use this when a product is physically found at this location but is missing from the count list.</b></div>
        <div><label class="text-xs font-semibold">Product / SKU</label><div class="relative"><input id="scAddProductSearchInline" autocomplete="off" oninput="showStockCountAddSuggestionsInline(this,'${html(countId)}')" onfocus="showStockCountAddSuggestionsInline(this,'${html(countId)}')" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type product code or item name..."><div id="scAddProductSuggestionsInline" class="mt-2 max-h-80 overflow-y-auto border rounded-xl"></div></div></div>
      </div>
    </div>`);
    setTimeout(()=>{const x=document.getElementById('scAddProductSearchInline');x?.focus();showStockCountAddSuggestionsInline(x,countId)},30);
  };

  window.showStockCountAddSuggestionsInline=function(input,countId){
    const box=document.getElementById('scAddProductSuggestionsInline');if(!box)return;
    const query=String(input?.value||'').trim().toLowerCase();
    const existing=UX.existingByCount.get(String(countId))||new Set();
    let rows=UX.products.filter(p=>!query||[p.code,p.item_name,p.brand].filter(Boolean).join(' ').toLowerCase().includes(query));
    rows=rows.filter(p=>!existing.has(String(p.product_id))).slice(0,30);
    box.innerHTML=rows.length?rows.map(p=>`<button type="button" onclick="addStockCountProductInline('${html(countId)}','${html(p.product_id)}')" class="w-full text-left px-3 py-2.5 hover:bg-amber-50 border-b last:border-0 flex gap-3 items-center"><div class="w-11 h-11 rounded-lg overflow-hidden bg-gray-100 shrink-0">${p.image_url?`<img src="${html(p.image_url)}" class="w-full h-full object-cover">`:'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>'}</div><div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">${html(p.code||'')}</div><div class="text-sm font-semibold truncate">${html(p.item_name||'')}</div><div class="text-[10px] text-gray-400">${html(p.brand||'')} · Current on hand ${qty(p.on_hand)}</div></div></button>`).join(''):'<div class="p-4 text-sm text-gray-400">No matching product.</div>';
  };

  window.addStockCountProductInline=async function(countId,productId){
    const box=document.getElementById('scAddProductSuggestionsInline');
    if(box)box.innerHTML='<div class="p-4 text-sm text-gray-400">Adding item...</div>';
    const r=await db.rpc('add_stock_count_item',{p_count_id:countId,p_product_id:productId});
    if(r.error){showToast(r.error.message,'err');const x=document.getElementById('scAddProductSearchInline');return showStockCountAddSuggestionsInline(x,countId)}
    const itemId=r.data;
    const fr=await db.from('stock_count_items').select('*,product_catalog(code,item_name,brand,image_url),stock_locations(code,name)').eq('id',itemId).single();
    if(fr.error)return showToast(fr.error.message,'err');
    const container=findRowsContainer();
    if(!container)return showToast('Item was added, but the list could not update in place. Reopen the count to see it.','err');
    container.insertAdjacentHTML('beforeend',rowHtml(fr.data));
    const row=container.querySelector('[data-count-item="'+String(itemId)+'"]');
    if(row){row.dataset.productId=String(productId);decorateRow(row)}
    if(!UX.existingByCount.has(String(countId)))UX.existingByCount.set(String(countId),new Set());
    UX.existingByCount.get(String(countId)).add(String(productId));
    closeStockCountAddPanel();
    updateTopItemCount();
    if(typeof window.updateStockCountProgress==='function')window.updateStockCountProgress();
    showToast('Item added without refreshing the Stock Count.');
    setTimeout(()=>{row?.scrollIntoView({behavior:'smooth',block:'center'});row?.querySelector('.count-physical')?.focus()},80);
  };

  window.setStockCountPhysicalZero=async function(itemId){
    const row=document.querySelector('[data-count-item="'+itemId+'"]');if(!row)return;
    const input=row.querySelector('.count-physical');if(!input||input.disabled)return;
    const wasZero=String(input.value||'').trim()==='0';
    input.value=wasZero?'':'0';
    updateZeroButton(row);
    if(typeof window.updateStockCountProgress==='function')window.updateStockCountProgress();
    const physical=input.value.trim();
    const qb=row.querySelector('.count-qb')?.value.trim()||'';
    const note=row.querySelector('.count-note')?.value.trim()||null;
    const sr=await db.rpc('save_stock_count_item',{
      p_item_id:itemId,
      p_physical_qty:physical===''?null:Number(physical),
      p_qb_qty:qb===''?null:Number(qb),
      p_note:note
    });
    if(sr.error){
      input.value=wasZero?'0':'';
      updateZeroButton(row);
      return showToast(sr.error.message,'err');
    }
    const system=num(row.dataset.system),p=physical===''?null:num(physical),qv=qb===''?null:num(qb);
    const variance=p!=null&&p!==system;
    row.dataset.variance=variance?'1':'0';
    row.classList.toggle('bg-red-50/40',variance);
    const vc=row.querySelector('.count-var');
    if(vc){vc.textContent=p==null?'-':qty(p-system);vc.classList.toggle('text-red-600',variance)}
    const qvc=row.querySelector('.count-qbvar');if(qvc)qvc.textContent=qv==null?'-':qty(qv-system);
    if(typeof window.filterStockCountRows==='function')window.filterStockCountRows();
    showToast(wasZero?'Physical Qty cleared — item is uncounted again.':'Physical Qty saved as 0. You can still edit or Clear it.');
  };


  function collectStockCountDraftItems(){
    const rows=[...document.querySelectorAll('#modalBody .stock-count-row')];
    const items=[];
    for(const row of rows){
      const itemId=row.dataset.countItem;
      const physical=String(row.querySelector('.count-physical')?.value||'').trim();
      const qb=String(row.querySelector('.count-qb')?.value||'').trim();
      const note=String(row.querySelector('.count-note')?.value||'').trim();
      if(physical!==''&&(!Number.isInteger(Number(physical))||Number(physical)<0)){
        row.querySelector('.count-physical')?.focus();
        throw new Error('Physical Qty must be a whole number: 0, 1, 2, 3...');
      }
      if(qb!==''&&(!Number.isInteger(Number(qb))||Number(qb)<0)){
        row.querySelector('.count-qb')?.focus();
        throw new Error('QB Qty must be a whole number: 0, 1, 2, 3...');
      }
      items.push({
        item_id:itemId,
        physical_qty:physical===''?null:Number(physical),
        qb_qty:qb===''?null:Number(qb),
        note:note||null
      });
    }
    return items;
  }

  window.saveStockCountDraft=async function(countId,options={}){
    const btn=document.getElementById('stockCountSaveDraftBtn');
    const oldText=btn?.textContent||'Save Draft';
    try{
      const items=collectStockCountDraftItems();
      if(btn){btn.disabled=true;btn.textContent='Saving Draft...'}
      const r=await db.rpc('save_stock_count_draft',{p_count_id:countId,p_items:items});
      if(r.error)throw r.error;
      document.querySelectorAll('#modalBody .stock-count-row').forEach(row=>{
        row.classList.remove('ring-1','ring-amber-300');
      });
      if(!options.silent)showToast('Draft saved. You can close this count and continue later.');
      return true;
    }catch(err){
      if(!options.silent)showToast(err.message||'Could not save draft.','err');
      return false;
    }finally{
      if(btn){btn.disabled=false;btn.textContent=oldText}
    }
  };

  window.fillStockCountBlanksZero=async function(countId){
    if(!confirm('Mark every remaining blank Physical Qty as 0? Blank means NOT COUNTED; 0 means COUNTED and none physically found. You can still change any row afterward while the count is Draft.'))return;
    const r=await db.rpc('fill_stock_count_blank_physical_zero',{p_count_id:countId});
    if(r.error)return showToast(r.error.message,'err');
    document.querySelectorAll('#modalBody .stock-count-row').forEach(row=>{
      const input=row.querySelector('.count-physical');
      if(input&&String(input.value||'').trim()===''){
        input.value='0';
        const system=num(row.dataset.system);
        const variance=system!==0;
        row.dataset.variance=variance?'1':'0';
        row.classList.toggle('bg-red-50/40',variance);
        const vc=row.querySelector('.count-var');
        if(vc){vc.textContent=qty(-system);vc.classList.toggle('text-red-600',variance)}
        updateZeroButton(row);
      }
    });
    if(typeof window.filterStockCountRows==='function')window.filterStockCountRows();
    if(typeof window.updateStockCountProgress==='function')window.updateStockCountProgress();
    showToast((r.data||0)+' blank item(s) marked as 0. No refresh needed.');
  };

  const baseOpen=window.openStockCount;
  if(typeof baseOpen==='function'){
    window.openStockCount=async function(){
      const countId=arguments[0];
      const r=await baseOpen.apply(this,arguments);
      setTimeout(()=>decorateStockCount(countId),0);
      return r;
    };
  }

  const baseSubmit=window.submitStockCount;
  if(typeof baseSubmit==='function'){
    window.submitStockCount=async function(countId){
      const saved=await window.saveStockCountDraft(countId,{silent:true});
      if(!saved)return showToast('Please fix the highlighted count values before submitting.','err');
      return baseSubmit.apply(this,arguments);
    };
  }

  // Also decorate an already-open count if this script loads after it.
  setTimeout(()=>decorateStockCount(null),100);
})();
