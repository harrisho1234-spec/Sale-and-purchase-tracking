// Smart stock movement UX: source locations and quantity follow the selected SKU's real location balance.
(function(){
  const S={
    balance:null,
    balanceProductId:'',
    activeLocations:[],
    loadingLocations:null,
    seq:0
  };

  function n(v){return Number(v||0)}
  function esc(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
  function q(v){
    const x=Number(v||0);
    if(!Number.isFinite(x))return '0';
    return Number.isInteger(x)?x.toLocaleString():x.toLocaleString(undefined,{maximumFractionDigits:2});
  }
  function normLocations(raw){
    let rows=raw;
    if(typeof rows==='string'){try{rows=JSON.parse(rows)}catch(_){rows=[]}}
    return Array.isArray(rows)?rows:[];
  }
  function sourceRows(){
    return normLocations(S.balance?.locations)
      .map(x=>({
        location_id:String(x.location_id||x.id||''),
        code:String(x.code||''),
        name:String(x.name||''),
        qty:n(x.qty??x.on_hand??0)
      }))
      .filter(x=>x.location_id&&x.qty>0)
      .sort((a,b)=>a.code.localeCompare(b.code)||a.name.localeCompare(b.name));
  }
  async function ensureActiveLocations(){
    if(S.activeLocations.length)return S.activeLocations;
    if(S.loadingLocations)return S.loadingLocations;
    S.loadingLocations=(async()=>{
      const r=await db.from('stock_locations').select('id,code,name,location_type,active,sort_order').eq('active',true).order('sort_order').order('code');
      if(r.error)throw r.error;
      S.activeLocations=(r.data||[]).map(x=>({
        id:String(x.id),code:String(x.code||''),name:String(x.name||''),location_type:String(x.location_type||'')
      }));
      return S.activeLocations;
    })();
    try{return await S.loadingLocations}finally{S.loadingLocations=null}
  }
  async function loadBalance(productId){
    const id=String(productId||'');
    if(!id){S.balance=null;S.balanceProductId='';return null}
    if(S.balance&&S.balanceProductId===id)return S.balance;
    const seq=++S.seq;
    const r=await db.from('inventory_product_balance').select('product_id,code,item_name,on_hand,reserved,available,locations').eq('product_id',id).maybeSingle();
    if(seq!==S.seq)return null;
    if(r.error)throw r.error;
    S.balance=r.data||{product_id:id,locations:[]};
    S.balanceProductId=id;
    return S.balance;
  }
  function ensureHelp(){
    const wrap=document.getElementById('smFromWrap');
    if(wrap&&!document.getElementById('smSourceStockHelp')){
      wrap.insertAdjacentHTML('beforeend','<div id="smSourceStockHelp" class="mt-1 text-[10px] text-gray-400"></div>');
    }
    const qty=document.getElementById('smQty');
    if(qty&&!document.getElementById('smQtySmartHelp')){
      qty.insertAdjacentHTML('afterend','<div id="smQtySmartHelp" class="mt-1 text-[10px] text-gray-400"></div>');
    }
  }
  function setSaveState(ok,message=''){
    const btn=document.getElementById('smSave');
    if(btn){
      btn.disabled=!ok;
      btn.classList.toggle('opacity-50',!ok);
      btn.classList.toggle('cursor-not-allowed',!ok);
    }
    const help=document.getElementById('smQtySmartHelp');
    if(help){
      help.textContent=message||'';
      help.className='mt-1 text-[10px] text-gray-400';
    }
  }
  function fillSourceOptions(){
    const sel=document.getElementById('smFrom');if(!sel)return;
    const prev=sel.value;
    const rows=sourceRows();
    if(!document.getElementById('smProductId')?.value){
      sel.innerHTML='<option value="">Choose Product / SKU first</option>';
      sel.value='';
      return rows;
    }
    if(!rows.length){
      sel.innerHTML='<option value="">No stock location available</option>';
      sel.value='';
      return rows;
    }
    sel.innerHTML='<option value="">Select source location</option>'+rows.map(x=>`<option value="${esc(x.location_id)}"> ${esc(x.code||x.name||'Location')} · ${q(x.qty)} in stock</option>`).join('');
    if(rows.some(x=>x.location_id===prev))sel.value=prev;
    else if(rows.length===1)sel.value=rows[0].location_id;
    else sel.value='';
    return rows;
  }
  function fillDestinationOptions(){
    const sel=document.getElementById('smTo');if(!sel)return;
    const type=document.getElementById('smType')?.value||'in';
    const source=document.getElementById('smFrom')?.value||'';
    const prev=sel.value;
    let rows=S.activeLocations.slice();
    if(type==='transfer'&&source)rows=rows.filter(x=>x.id!==source);
    sel.innerHTML='<option value="">Select destination location</option>'+rows.map(x=>`<option value="${esc(x.id)}">${esc(x.code||x.name||'Location')}${x.name&&x.name!==x.code?' · '+esc(x.name):''}</option>`).join('');
    if(rows.some(x=>x.id===prev))sel.value=prev;
    else sel.value='';
  }
  function updateSourceAndQty(){
    ensureHelp();
    const type=document.getElementById('smType')?.value||'in';
    const needFrom=['out','broken','transfer','adjustment_out'].includes(type);
    const qtyInput=document.getElementById('smQty');
    const help=document.getElementById('smSourceStockHelp');
    if(!needFrom){
      if(qtyInput){qtyInput.removeAttribute('max');qtyInput.disabled=false}
      if(help)help.textContent='';
      setSaveState(true,'');
      return;
    }

    const rows=sourceRows();
    const source=document.getElementById('smFrom')?.value||'';
    const row=rows.find(x=>x.location_id===source);
    if(!rows.length){
      if(qtyInput){qtyInput.value='';qtyInput.disabled=true;qtyInput.removeAttribute('max')}
      if(help)help.innerHTML='<span class="text-red-600 font-semibold">This SKU has no stock in any location.</span>';
      setSaveState(false,'No quantity can be moved because this SKU has no source-location stock.');
      return;
    }
    if(!source||!row){
      if(qtyInput){qtyInput.disabled=true;qtyInput.removeAttribute('max')}
      if(help)help.textContent=rows.length===1?'1 stocked location available.':'Choose one of the '+rows.length+' locations that actually holds this SKU.';
      setSaveState(false,'Select a source location to set the allowed quantity.');
      return;
    }

    const max=row.qty;
    if(qtyInput){
      qtyInput.disabled=false;
      qtyInput.max=String(max);
      let current=n(qtyInput.value);
      if(current<=0)current=1;
      if(current>max)current=max;
      qtyInput.value=String(current);
      qtyInput.oninput=window.smartStockMovementQtyChanged;
    }
    if(help)help.innerHTML=`Available at <b>${esc(row.code||row.name||'selected location')}</b>: <b class="text-green-700">${q(max)}</b>`;
    setSaveState(true,`Maximum from ${row.code||row.name||'selected location'}: ${q(max)}`);
  }
  function validateQty(){
    const type=document.getElementById('smType')?.value||'in';
    const needFrom=['out','broken','transfer','adjustment_out'].includes(type);
    if(!needFrom)return true;
    const source=document.getElementById('smFrom')?.value||'';
    const row=sourceRows().find(x=>x.location_id===source);
    const input=document.getElementById('smQty');
    if(!row||!input)return false;
    const qty=n(input.value);
    const help=document.getElementById('smQtySmartHelp');
    if(qty<=0){
      input.setCustomValidity('Quantity must be greater than zero');
      if(help){help.textContent='Quantity must be greater than zero.';help.className='mt-1 text-[10px] text-red-600'}
      return false;
    }
    if(qty>row.qty){
      input.setCustomValidity('Only '+q(row.qty)+' available at '+(row.code||row.name||'this location'));
      if(help){help.textContent='Too high — only '+q(row.qty)+' available at '+(row.code||row.name||'this location')+'.';help.className='mt-1 text-[10px] text-red-600'}
      return false;
    }
    input.setCustomValidity('');
    if(help){help.textContent='Maximum from '+(row.code||row.name||'selected location')+': '+q(row.qty);help.className='mt-1 text-[10px] text-gray-400'}
    return true;
  }

  window.smartStockMovementQtyChanged=function(){
    const ok=validateQty();
    const btn=document.getElementById('smSave');
    if(btn){
      btn.disabled=!ok;
      btn.classList.toggle('opacity-50',!ok);
      btn.classList.toggle('cursor-not-allowed',!ok);
    }
  };
  window.smartStockMovementSourceChanged=function(){
    fillDestinationOptions();
    updateSourceAndQty();
    validateQty();
  };

  async function refreshSmartMovement(){
    const form=document.getElementById('stockMovementForm');if(!form)return;
    ensureHelp();
    try{
      await ensureActiveLocations();
      const productId=document.getElementById('smProductId')?.value||'';
      const type=document.getElementById('smType')?.value||'in';
      const needFrom=['out','broken','transfer','adjustment_out'].includes(type);
      if(productId)await loadBalance(productId);
      else {S.balance=null;S.balanceProductId=''}
      if(needFrom)fillSourceOptions();
      fillDestinationOptions();
      const from=document.getElementById('smFrom');
      if(from)from.onchange=window.smartStockMovementSourceChanged;
      updateSourceAndQty();
      validateQty();
    }catch(err){
      const help=document.getElementById('smSourceStockHelp');
      if(help)help.innerHTML='<span class="text-red-600">Could not load location stock: '+esc(err.message||'Unknown error')+'</span>';
    }
  }

  const baseChoose=window.chooseStockProduct;
  if(typeof baseChoose==='function'){
    window.chooseStockProduct=function(productId){
      const r=baseChoose.apply(this,arguments);
      Promise.resolve(r).finally(()=>refreshSmartMovement());
      return r;
    };
  }

  const baseInputChanged=window.stockProductInputChanged;
  if(typeof baseInputChanged==='function'){
    window.stockProductInputChanged=function(){
      const r=baseInputChanged.apply(this,arguments);
      S.balance=null;S.balanceProductId='';S.seq++;
      setTimeout(refreshSmartMovement,0);
      return r;
    };
  }

  const baseTypeChanged=window.stockMovementTypeChanged;
  if(typeof baseTypeChanged==='function'){
    window.stockMovementTypeChanged=function(){
      const r=baseTypeChanged.apply(this,arguments);
      setTimeout(refreshSmartMovement,0);
      return r;
    };
  }

  // Re-check just before the original submit handler runs.
  document.addEventListener('submit',function(e){
    if(e.target?.id!=='stockMovementForm')return;
    if(!validateQty()){
      e.preventDefault();
      e.stopImmediatePropagation();
      document.getElementById('smQty')?.reportValidity();
    }
  },true);
})();
