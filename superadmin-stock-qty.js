// Super Admin-only manual stock QTY increases for any existing Product Code.
// Uses an immutable, audited adjustment_in movement. Never updates product_catalog.stock_qty directly.
(function(){
  'use strict';
  const authorized=()=>state?.profile?.role==='super_admin';
  const escapeText=v=>typeof esc==='function'?esc(String(v??'')):
    String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]));
  let selected=null;
  let debounce=null;
  let searchSerial=0;
  let requestId='';
  let submitting=false;
  let locations=[];
  const whole=v=>Number.isInteger(Number(v)) && Number(v)>0 && Number(v)<=1000000;
  const cleanQuery=v=>String(v||'').trim().replace(/[%_,()]/g,' ').slice(0,90);
  const imageHTML=p=>p.image_url?
    '<img src="'+escapeText(p.image_url)+'" loading="lazy" decoding="async" class="w-11 h-11 object-contain rounded-lg border bg-white" onerror="this.style.display=\'none\'">':
    '<span class="w-11 h-11 rounded-lg border bg-gray-50 inline-flex items-center justify-center text-[9px] text-gray-400">No Photo</span>';

  async function searchProducts(q,force=false){
    if(!authorized())return;
    const box=document.getElementById('saQtyResults');
    if(!box)return;
    const token=++searchSerial;
    if(!q || q.trim().length<2){
      box.innerHTML='<div class="text-xs text-gray-500 p-3">Enter at least two characters of a product code or name.</div>';
      return;
    }
    box.innerHTML='<div class="p-3 text-xs text-gray-500">Searching products...</div>';
    try{
      const term='%'+cleanQuery(q)+'%';
      const [codeRes,nameRes]=await Promise.all([
        db.from('product_catalog').select('id,code,item_name,brand,image_url,active').ilike('code',term).eq('active',true).limit(20),
        db.from('product_catalog').select('id,code,item_name,brand,image_url,active').ilike('item_name',term).eq('active',true).limit(20)
      ]);
      if(codeRes.error)throw codeRes.error;
      if(nameRes.error)throw nameRes.error;
      if(token!==searchSerial || !document.getElementById('saQtyResults'))return;
      const byId=new Map([...(codeRes.data||[]),...(nameRes.data||[])].map(p=>[p.id,p]));
      const candidates=[...byId.values()].sort((a,b)=>{
        const t=String(q||'').toLowerCase(),ca=String(a.code||'').toLowerCase(),cb=String(b.code||'').toLowerCase();
        const score=x=>x===t?0:x.startsWith(t)?1:2;
        return score(ca)-score(cb)||ca.localeCompare(cb);
      }).slice(0,20);
      window._superAdminQtyCandidates=candidates;
      box.innerHTML=candidates.length?candidates.map(p=>
        '<button type="button" data-qty-pick="'+escapeText(p.id)+'" class="w-full flex items-center gap-3 p-2.5 text-left border-b last:border-0 hover:bg-amber-50">'+
        imageHTML(p)+'<span class="min-w-0"><span class="block font-bold text-xs text-[#9b792e]">'+escapeText(p.code)+'</span>'+
        '<span class="block text-xs truncate">'+escapeText(p.item_name||'Product information incomplete')+'</span>'+
        '<span class="block text-[10px] text-gray-400">'+escapeText(p.brand||'No brand entered')+'</span></span></button>'
      ).join(''):
      '<div class="text-xs text-gray-500 p-3">No matching active Product Code. Create the product first.</div>';
      box.querySelectorAll('[data-qty-pick]').forEach(b=>b.addEventListener('click',()=>chooseProduct(b.dataset.qtyPick)));
    }catch(err){
      if(token===searchSerial&&box)box.innerHTML='<div class="text-xs text-red-700 p-3">'+escapeText(err.message||'Search failed')+'</div>';
    }
  }

  async function showBalance(productId){
    const box=document.getElementById('saQtyCurrentBalance');
    if(!box)return;
    box.textContent='Loading current stock balance...';
    try{
      const r=await db.from('inventory_product_balance')
        .select('on_hand,locations')
        .eq('product_id',productId).maybeSingle();
      if(r.error)throw r.error;
      if(!document.getElementById('saQtyCurrentBalance')||selected?.id!==productId)return;
      const current=Number(r.data?.on_hand||0);
      box.textContent='Current total on hand: '+current.toLocaleString()+
        ' · This adjustment increases stock in only the selected destination.';
    }catch(_){
      if(document.getElementById('saQtyCurrentBalance'))box.textContent='Existing stock can be checked in Stock Balance.';
    }
  }

  function chooseProduct(id){
    const p=(window._superAdminQtyCandidates||[]).find(x=>String(x.id)===String(id));
    if(!p)return;
    selected=p;
    const input=document.getElementById('saQtyProduct');
    if(input)input.value=String(p.code||'');
    const box=document.getElementById('saQtyResults');
    if(box)box.innerHTML='<div class="border border-green-200 bg-green-50 rounded-lg p-3 text-xs text-green-800">'+
      'Selected: <b>'+escapeText(p.code)+'</b> · '+escapeText(p.item_name||'Incomplete product description')+
      '</div>';
    showBalance(p.id);
  }

  window.searchSuperAdminQtyProducts=function(value){
    clearTimeout(debounce);
    selected=null;
    const balance=document.getElementById('saQtyCurrentBalance');
    if(balance)balance.textContent='';
    debounce=setTimeout(()=>searchProducts(value),180);
  };

  window.openSuperAdminStockIncrease=async function(productId=''){
    if(!authorized())return showToast('Only Super Admin can increase a product’s QTY manually.','err');
    requestId=crypto.randomUUID();
    selected=null;
    searchSerial++;
    window._superAdminQtyCandidates=[];
    try{
      const r=await db.from('stock_locations')
        .select('id,code,name,active,location_type').eq('active',true).order('code').limit(200);
      if(r.error)throw r.error;
      locations=r.data||[];
      if(!locations.length)throw new Error('No active stock location is available.');
      openModal('Super Admin · Increase Product QTY',
        '<form id="superAdminQtyForm" class="space-y-4">'+
          '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">'+
          '<b>Manual Stock Increase (+QTY)</b><div class="mt-1">For verified stock corrections only. Every increase creates an audited Stock Adjustment + movement with your account and reason. Do not use this to receive a Supplier PO again.</div></div>'+
          '<div><label class="text-xs font-semibold">Product Code or Name *</label>'+
          '<input id="saQtyProduct" autocomplete="off" required oninput="searchSuperAdminQtyProducts(this.value)"'+
          ' placeholder="Search Product Code or name..." class="w-full border rounded-xl p-3 text-sm mt-1">'+
          '<div id="saQtyResults" class="max-h-52 overflow-y-auto border rounded-xl mt-2 bg-white">'+
          '<div class="p-3 text-xs text-gray-500">Enter at least two letters or digits.</div></div>'+
          '<div id="saQtyCurrentBalance" class="mt-1 text-xs text-gray-500"></div></div>'+
          '<div class="grid md:grid-cols-2 gap-3">'+
            '<div><label class="text-xs font-semibold">Increase By (pieces) *</label>'+
            '<input id="saQtyNumber" type="number" step="1" min="1" max="1000000" value="1" required class="w-full border rounded-xl p-3 text-sm mt-1"></div>'+
            '<div><label class="text-xs font-semibold">Add To Location *</label>'+
            '<select id="saQtyLocation" required class="w-full border rounded-xl p-3 text-sm mt-1 bg-white"><option value="">Select location</option>'+
            locations.map(l=>'<option value="'+escapeText(l.id)+'">'+escapeText(l.code+(l.name&&l.name!==l.code?' · '+l.name:''))+'</option>').join('')+
            '</select></div>'+
          '</div>'+
          '<div><label class="text-xs font-semibold">Reason for Manual Increase *</label>'+
          '<textarea id="saQtyReason" minlength="6" maxlength="1000" rows="3" required class="w-full border rounded-xl p-3 text-sm mt-1"'+
          ' placeholder="Example: Physically counted 3 previously unrecorded items at LU5. Reference: warehouse count 20 Oct."></textarea>'+
          '<div class="text-[10px] text-gray-500 mt-1">Reason, date, product, location and your account are stored in Stock Movement History.</div></div>'+
          '<button id="saQtySave" type="submit" class="w-full bg-[#211d18] text-white rounded-xl py-3 text-sm font-semibold">Review &amp; Confirm Increase</button>'+
        '</form>');
      const form=document.getElementById('superAdminQtyForm');
      if(!form)throw new Error('Could not load the Increase QTY form');
      form.onsubmit=saveIncrease;
      if(productId){
        const pr=await db.from('product_catalog')
          .select('id,code,item_name,brand,image_url,active').eq('id',productId).maybeSingle();
        if(pr.error)throw pr.error;
        if(pr.data?.active){
          window._superAdminQtyCandidates=[pr.data];
          chooseProduct(pr.data.id);
        }
      }
      document.getElementById('saQtyProduct')?.focus();
    }catch(e){showToast(e.message||'Cannot open Increase QTY','err')}
  };

  async function saveIncrease(ev){
    ev.preventDefault();
    if(!authorized())return showToast('Only Super Admin can increase product QTY.','err');
    if(submitting)return;
    const qty=Number(document.getElementById('saQtyNumber')?.value);
    const locationId=String(document.getElementById('saQtyLocation')?.value||'');
    const location=locations.find(x=>String(x.id)===locationId);
    const reason=String(document.getElementById('saQtyReason')?.value||'').trim();
    if(!selected?.id)return showToast('Select the exact Product Code from the results first.','err');
    if(!whole(qty))return showToast('Increase QTY must be a whole number from 1 to 1000000.','err');
    if(!location)return showToast('Select a destination location.','err');
    if(reason.length<6||reason.length>1000)return showToast('Explain the manual increase (6–1000 characters).','err');
    const message='Increase '+selected.code+' by +'+qty+' pieces at '+location.code+
      '?\n\nReason: '+reason+'\n\nThis immediately increases stock and records an audited adjustment. It is not a PO receipt.';
    if(!window.confirm(message))return;
    submitting=true;
    const btn=document.getElementById('saQtySave');
    if(btn){btn.disabled=true;btn.textContent='Recording audited adjustment...'}
    try{
      const result=await db.rpc('superadmin_increase_product_qty',{
        p_product_id:selected.id,
        p_location_id:locationId,
        p_qty:qty,
        p_reason:reason,
        p_request_id:requestId
      });
      if(result.error)throw result.error;
      const productCode=String(selected.code||'');
      closeModal();
      showToast('+'+qty+' pieces recorded for '+productCode+' at '+location.code+
        '. See Stock & Inventory → Movements (Adjustment +).');
      if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
      if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
      if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
    }catch(err){
      showToast(err.message||'Stock increase failed. No adjustment was confirmed.','err');
      if(btn){btn.disabled=false;btn.textContent='Review & Confirm Increase'}
    }finally{submitting=false}
  }
})();