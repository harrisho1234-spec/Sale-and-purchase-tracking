// Super Admin exception: allow an unmatched code/item to be used on a new sale.
// The manual item is created as an inactive catalog record so existing order/merge validation stays safe.
(function(){
  const isSuper=()=>state.profile?.role==='super_admin';
  const baseShow=window.showSalesProductSuggestions;
  const baseOpen=window.openNewOrder;

  function parseManual(raw){
    const s=String(raw||'').trim();
    if(!s)return {code:'',name:''};
    const parts=s.split(/\s+[·|]\s+/);
    if(parts.length>1){
      const code=String(parts.shift()||'').trim().toUpperCase();
      const name=parts.join(' · ').trim()||code;
      return {code,name};
    }
    return {code:s.toUpperCase(),name:s};
  }

  async function findOrCreateManual(row,raw){
    const {code,name}=parseManual(raw);
    if(!code)throw new Error('Enter a product code or item name first.');

    let existing=await db.from('product_catalog')
      .select('id,code,item_name,image_url,sales_price,currency,active')
      .eq('code',code)
      .maybeSingle();
    if(existing.error)throw existing.error;

    let p=existing.data||null;
    if(!p){
      const ins=await db.from('product_catalog').insert({
        code,
        item_name:name,
        sales_price:0,
        stock_qty:0,
        currency:'USD',
        active:false,
        manual_override:true
      }).select('id,code,item_name,image_url,sales_price,currency,active').single();
      if(ins.error)throw ins.error;
      p=ins.data;
    }

    row.dataset.manualItem='1';
    row.querySelector('.product-id').value=p.id||'';
    row.querySelector('.product-code').value=p.code||code;
    row.querySelector('.product-name').value=p.item_name||name||code;
    row.querySelector('.product-image').value=p.image_url||'';
    row.querySelector('.product-search-input').value=`${p.code||code} · ${p.item_name||name||code}`;
    row.querySelector('.product-suggestions')?.classList.add('hidden');

    if(Array.isArray(state.products)&&!state.products.some(x=>x.id===p.id))state.products.push(p);
    return p;
  }

  window.createSuperAdminManualSalesItem=async function(btn){
    if(!isSuper())return showToast('Only Super Admin can create an unmatched manual item.','err');
    const row=btn.closest('.order-item-row');
    const input=row?.querySelector('.product-search-input');
    if(!row||!input)return;
    btn.disabled=true;
    const old=btn.innerHTML;
    btn.innerHTML='Creating manual item...';
    try{
      const p=await findOrCreateManual(row,input.value);
      showToast(`Manual item ${p.code||''} is ready for this order.`);
    }catch(err){
      showToast(err.message||String(err),'err');
      btn.disabled=false;
      btn.innerHTML=old;
    }
  };

  if(typeof baseShow==='function'){
    window.showSalesProductSuggestions=function(input){
      const out=baseShow.apply(this,arguments);
      if(!isSuper())return out;
      const row=input?.closest('.order-item-row');
      const box=row?.querySelector('.product-suggestions');
      if(!row||!box||row.querySelector('.product-id')?.value)return out;
      const raw=String(input.value||'').trim();
      if(!raw)return out;
      const noMatch=/No matching product code or item name/i.test(box.textContent||'');
      if(noMatch){
        const {code,name}=parseManual(raw);
        box.innerHTML=`
          <div class="px-3 py-2 text-[10px] text-gray-400 border-b">No matching catalog product.</div>
          <button type="button" onclick="createSuperAdminManualSalesItem(this)" class="w-full text-left px-3 py-3 hover:bg-amber-50">
            <div class="text-[10px] uppercase font-extrabold text-amber-700">Super Admin Manual Item</div>
            <div class="text-sm font-semibold text-gray-800 mt-0.5">Use ${esc(code)}${name&&name!==code?` · ${esc(name)}`:''}</div>
            <div class="text-[10px] text-gray-500 mt-1">Creates an inactive catalog record so this item can be saved without an existing match.</div>
          </button>`;
        box.classList.remove('hidden');
      }
      return out;
    };
  }

  if(typeof baseOpen==='function'){
    window.openNewOrder=async function(){
      const out=await baseOpen.apply(this,arguments);
      if(!isSuper())return out;
      const items=document.querySelector('#orderForm #orderItems')?.parentElement;
      if(items&&!document.getElementById('superAdminManualItemHint')){
        const hint=document.createElement('div');
        hint.id='superAdminManualItemHint';
        hint.className='mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] text-amber-800';
        hint.innerHTML='<b>Super Admin:</b> if a product is not in the catalog, type the code (or <b>CODE · Item Name</b>) and choose <b>Super Admin Manual Item</b> from the suggestion box.';
        items.appendChild(hint);
      }
      return out;
    };
  }
})();