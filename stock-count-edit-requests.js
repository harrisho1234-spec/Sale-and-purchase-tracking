// Stock Count edit requests: Stock Controller proposes; Admin/Super Admin reviews.
// Nothing in a submitted count changes before the server-side approval RPC commits.
(function(){
  'use strict';
  const E={count:null,items:[],products:[],updates:new Map(),removals:new Set(),additions:new Map(),requests:[],reviewMap:new Map()};
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c]))}
  function numText(v){return v==null?'—':String(v)}
  function role(){return String((typeof state!=='undefined'&&state.profile?.role)||'')}
  function canRequest(){return ['stock_controller','admin','super_admin'].includes(role()) &&
    (typeof window.hasAppPermission!=='function'||window.hasAppPermission('inventory.operate'))}
  function canReview(){return ['admin','super_admin'].includes(role())}
  function dateOnly(s){return String(s||'').slice(0,10)}
  function validQty(v,allowBlank){
    const s=String(v??'').trim();
    if(s===''&&allowBlank)return null;
    if(s===''||!Number.isSafeInteger(Number(s))||Number(s)<0)throw new Error('Quantities must be whole numbers, 0 or higher.');
    return Number(s);
  }
  function inner(){return document.getElementById('stockCountEditOverlay')}
  function overlay(markup){
    document.getElementById('stockCountEditOverlay')?.remove();
    // Use a separate overlay so the original count remains available on close.
    document.body.insertAdjacentHTML('beforeend',
      '<div id="stockCountEditOverlay" class="fixed inset-0 z-[250] bg-black/50 flex items-center justify-center p-3 md:p-5" onclick="if(event.target===this)closeStockCountEditOverlay()">'+
      '<section role="dialog" aria-modal="true" aria-label="Stock Count Edit Request" class="bg-white w-full max-w-5xl max-h-[94vh] flex flex-col rounded-2xl shadow-2xl border overflow-hidden">'+markup+'</section></div>');
  }
  function frame(title,subtitle,content,actions){
    return '<header class="p-4 border-b flex flex-wrap items-start justify-between gap-3 bg-[#fcfaf5]">'+
      '<div><h3 class="font-bold text-lg">'+esc(title)+'</h3><div class="text-xs text-gray-500 mt-1">'+esc(subtitle||'')+'</div></div>'+
      '<button type="button" onclick="closeStockCountEditOverlay()" class="px-3 py-2 border rounded-lg text-sm font-semibold">✕ Close</button></header>'+
      '<div class="p-4 space-y-4 overflow-y-auto flex-1">'+content+'</div>'+
      (actions?'<footer class="p-4 border-t bg-white flex flex-wrap justify-end gap-2">'+actions+'</footer>':'');
  }
  window.closeStockCountEditOverlay=()=>{inner()?.remove();E.count=null;};

  async function fetchCount(id){
    const [c,items]=await Promise.all([
      db.from('stock_counts').select('*,stock_locations(code,name)').eq('id',id).single(),
      db.from('stock_count_items').select('*,product_catalog(code,item_name,image_url)').eq('stock_count_id',id).limit(5000)
    ]);
    if(c.error||items.error)throw c.error||items.error;
    return {count:c.data,items:items.data||[]};
  }
  async function ensureProducts(){
    if(E.products.length)return E.products;
    const r=await db.from('inventory_product_balance').select('product_id,code,item_name,image_url,on_hand').limit(5000);
    if(r.error)throw r.error;
    E.products=r.data||[];
    return E.products;
  }
  window.openStockCountEditRequest=async function(countId){
    if(!canRequest())return showToast('Stock operation access required for edit requests.','err');
    try{
      const [data,requests,products]=await Promise.all([
        fetchCount(countId),
        db.rpc('get_stock_count_edit_requests',{p_count_id:countId,p_pending_only:true}),
        ensureProducts()
      ]);
      if(requests.error)throw requests.error;
      if(!['submitted','reconciled'].includes(data.count.status))
        return showToast('Edit requests are available for Submitted/Reconciled counts. Closed counts need Admin review.','err');
      if((requests.data||[]).some(x=>x.status==='pending'))return showToast('This Stock Count already has a pending edit request.','err');
      E.count=data.count;E.items=data.items;E.products=products;
      E.updates.clear();E.removals.clear();E.additions.clear();
      const month=dateOnly(data.count.period_month).slice(0,7);
      const countDate=dateOnly(data.count.count_date||data.count.created_at);
      const form=
        '<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Request only:</b> this does not alter the submitted count. An Admin must approve before changes apply. Correct an item using Edit, remove a wrong item, or add a missing one. Closed counts cannot be changed this way.</div>'+
        '<div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">'+
          '<label class="text-xs font-semibold">Stock Count Month<input id="scerMonth" type="month" value="'+esc(month)+'" required class="block w-full mt-1 border rounded-lg px-3 py-2 text-sm"></label>'+
          '<label class="text-xs font-semibold">Physical Count Date<input id="scerDate" type="date" value="'+esc(countDate)+'" required class="block w-full mt-1 border rounded-lg px-3 py-2 text-sm"></label>'+
          '<label class="text-xs font-semibold">Location<div class="mt-1 py-2 px-3 border rounded-lg bg-gray-50 text-sm">'+esc(data.count.stock_locations?.code||'All Locations')+' (unchanged)</div></label>'+
        '</div>'+
        '<label class="block text-xs font-semibold">Count Note<textarea id="scerCountNote" rows="2" class="mt-1 w-full border rounded-lg p-2 text-sm">'+esc(data.count.note||'')+'</textarea></label>'+
        '<div class="grid lg:grid-cols-2 gap-4">'+
          '<section class="min-w-0 rounded-xl border p-3"><b class="text-sm">Correct / Remove Counted Items</b>'+
            '<input id="scerSearch" oninput="filterStockCountEditItems(this.value)" class="mt-2 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Search item code or name...">'+
            '<div id="scerItems" class="mt-2 max-h-[270px] overflow-y-auto divide-y"></div>'+
            '<div id="scerSelected" class="mt-3 border-t pt-3 space-y-2"></div>'+
          '</section>'+
          '<section class="min-w-0 rounded-xl border p-3"><b class="text-sm">Add Missing Product</b>'+
            '<input id="scerProductSearch" oninput="filterStockCountEditProducts(this.value)" class="mt-2 w-full border rounded-lg px-3 py-2 text-sm" placeholder="Search product code or name...">'+
            '<div id="scerProductResults" class="mt-2 max-h-[230px] overflow-y-auto divide-y"></div>'+
            '<div id="scerAdded" class="mt-3 border-t pt-3 space-y-2"></div>'+
          '</section>'+
        '</div>'+
        '<label class="block text-xs font-semibold">Reason for changes *<textarea id="scerReason" rows="2" maxlength="1200" required class="mt-1 w-full border rounded-lg p-2 text-sm" placeholder="Explain what was submitted incorrectly and why the correction is needed"></textarea></label>';
      overlay(frame('Request Stock Count Edit',month+' · '+String(data.items.length)+' items · '+data.count.status,
        form,
        '<button type="button" onclick="closeStockCountEditOverlay()" class="px-4 py-2 border rounded-lg text-xs font-semibold">Cancel</button>'+
        '<button type="button" id="scerSubmit" onclick="submitStockCountEditRequest()" class="px-4 py-2 rounded-lg text-xs font-semibold bg-[#211d18] text-white">Submit Edit Request</button>'));
      window.filterStockCountEditItems('');
      window.filterStockCountEditProducts('');
      renderSelected();
    }catch(err){showToast(err.message||'Could not prepare Stock Count edit request.','err')}
  };
  function itemLabel(i){return esc(i.product_catalog?.code||'')+' · '+esc(i.product_catalog?.item_name||'Product')}
  window.filterStockCountEditItems=function(query){
    const root=document.getElementById('scerItems');if(!root)return;
    const q=String(query||'').toLowerCase().trim();
    const filtered=E.items.filter(i=>(String(i.product_catalog?.code||'')+' '+String(i.product_catalog?.item_name||'')).toLowerCase().includes(q));
    root.innerHTML='<div class="text-[10px] text-gray-400 py-1">'+filtered.length+' matching · showing first 35</div>'+
      filtered.slice(0,35).map(i=>{
        const id=esc(i.id),selected=E.updates.has(i.id)||E.removals.has(i.id);
        return '<div class="flex items-center justify-between gap-2 py-2 text-xs">'+
          '<div class="min-w-0"><div class="font-bold truncate">'+itemLabel(i)+'</div><div class="text-[10px] text-gray-400">Physical '+numText(i.physical_qty)+' · QB '+numText(i.qb_qty)+'</div></div>'+
          '<button type="button" onclick="selectStockCountEditItem(\''+id+'\')" class="shrink-0 rounded-lg border px-2 py-1.5 '+(selected?'bg-amber-50 border-amber-300':'bg-white')+' text-xs font-semibold">'+(selected?'Selected':'Edit / Remove')+'</button></div>';
      }).join('');
  };
  window.selectStockCountEditItem=function(id){
    const i=E.items.find(r=>r.id===id);if(!i)return;
    E.removals.delete(id);
    if(E.updates.has(id)){E.updates.delete(id)}
    else E.updates.set(id,{item_id:id,physical_qty:i.physical_qty,qb_qty:i.qb_qty,note:i.note||''});
    window.filterStockCountEditItems(document.getElementById('scerSearch')?.value||'');renderSelected();
  };
  window.toggleStockCountRemove=function(id){
    if(E.removals.has(id)){E.removals.delete(id);const i=E.items.find(r=>r.id===id);if(i)E.updates.set(id,{item_id:id,physical_qty:i.physical_qty,qb_qty:i.qb_qty,note:i.note||''})}
    else{E.removals.add(id);E.updates.delete(id)}
    window.filterStockCountEditItems(document.getElementById('scerSearch')?.value||'');renderSelected();
  };
  window.setStockCountEditField=function(id,field,value,added){
    const row=added?E.additions.get(id):E.updates.get(id);
    if(row&&['physical_qty','qb_qty','note'].includes(field))row[field]=value;
  };
  function selectedRow(id,item,added){
    const name=added?esc(E.products.find(p=>p.product_id===id)?.code||id):itemLabel(item);
    const data=added?E.additions.get(id):E.updates.get(id);
    return '<div class="rounded-lg border border-amber-200 bg-amber-50/40 p-2 text-xs">'+
      '<div class="flex flex-wrap justify-between gap-2 mb-2"><b class="break-all">'+name+'</b>'+
      (added?'<button type="button" class="text-red-700 font-bold" onclick="removeNewStockCountEditItem(\''+esc(id)+'\')">Remove</button>':
      '<div class="flex gap-3"><button class="text-red-700 font-bold" onclick="toggleStockCountRemove(\''+esc(id)+'\')">Remove counted item</button><button class="text-gray-600 font-bold" onclick="selectStockCountEditItem(\''+esc(id)+'\')">Undo</button></div>')+
      '</div>'+
      '<div class="grid grid-cols-2 gap-2"><label>Physical Qty<input type="number" min="0" step="1" value="'+esc(data.physical_qty??'')+'" oninput="setStockCountEditField(\''+esc(id)+'\',\'physical_qty\',this.value,'+(added?'true':'false')+')" class="w-full border rounded-lg p-2 mt-1"></label>'+
      '<label>QB Qty<input type="number" min="0" step="1" value="'+esc(data.qb_qty??'')+'" oninput="setStockCountEditField(\''+esc(id)+'\',\'qb_qty\',this.value,'+(added?'true':'false')+')" class="w-full border rounded-lg p-2 mt-1"></label></div>'+
      '<label class="block mt-2">Note<input value="'+esc(data.note||'')+'" oninput="setStockCountEditField(\''+esc(id)+'\',\'note\',this.value,'+(added?'true':'false')+')" class="block w-full border rounded-lg p-2 mt-1"></label></div>';
  }
  function renderSelected(){
    const el=document.getElementById('scerSelected');if(el){
      const rows=[...E.updates.keys()].map(id=>selectedRow(id,E.items.find(i=>i.id===id),false));
      const removalRows=[...E.removals].map(id=>{
        const i=E.items.find(r=>r.id===id);
        return '<div class="border border-red-200 bg-red-50 rounded-lg p-2 flex justify-between text-xs gap-2"><span>Remove '+itemLabel(i||{})+'</span><button type="button" class="font-bold text-blue-700" onclick="toggleStockCountRemove(\''+esc(id)+'\')">Undo</button></div>';
      });
      el.innerHTML=(rows.length||removalRows.length?'<div class="text-xs font-bold mb-1">Proposed changes</div>':'')+rows.join('')+removalRows.join('');
    }
    const added=document.getElementById('scerAdded');if(added)added.innerHTML=
      [...E.additions.keys()].map(id=>selectedRow(id,null,true)).join('')||
      '<div class="text-xs text-gray-400">No new items selected.</div>';
  }
  window.filterStockCountEditProducts=function(query){
    const root=document.getElementById('scerProductResults');if(!root)return;
    const q=String(query||'').toLowerCase().trim();
    if(!q){root.innerHTML='<div class="text-xs text-gray-400 py-2">Enter a product code or name to search.</div>';return}
    const existing=new Set(E.items.map(i=>i.product_id));
    const filtered=E.products.filter(p=>
      !existing.has(p.product_id)&&!E.additions.has(p.product_id)&&
      (String(p.code||'')+' '+String(p.item_name||'')).toLowerCase().includes(q)).slice(0,20);
    root.innerHTML=filtered.length?filtered.map(p=>'<button type="button" class="flex items-center justify-between w-full text-left text-xs py-2 gap-2" onclick="addNewStockCountEditItem(\''+esc(p.product_id)+'\')"><span class="min-w-0 truncate">'+esc(p.code)+' · '+esc(p.item_name)+'</span><b class="text-blue-700 shrink-0">+ Add</b></button>').join(''):
      '<div class="py-2 text-xs text-gray-400">No matching new products.</div>';
  };
  window.addNewStockCountEditItem=function(id){
    if(E.count?.location_id==null)return showToast('Items cannot be added to an All Locations count.','err');
    E.additions.set(id,{product_id:id,physical_qty:'',qb_qty:'',note:''});
    window.filterStockCountEditProducts(document.getElementById('scerProductSearch')?.value||'');
    renderSelected();
  };
  window.removeNewStockCountEditItem=function(id){E.additions.delete(id);renderSelected();window.filterStockCountEditProducts(document.getElementById('scerProductSearch')?.value||'')};
  window.submitStockCountEditRequest=async function(){
    if(!E.count)return;
    const button=document.getElementById('scerSubmit');
    try{
      const month=String(document.getElementById('scerMonth')?.value||'');
      const date=String(document.getElementById('scerDate')?.value||'');
      const reason=String(document.getElementById('scerReason')?.value||'').trim();
      if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)||!/^\d{4}-\d{2}-\d{2}$/.test(date))throw new Error('Choose a valid month and Count Date.');
      if(!reason)throw new Error('Enter a reason for the requested correction.');
      const pack=r=>({...(r.item_id?{item_id:r.item_id}:{product_id:r.product_id}),
        physical_qty:validQty(r.physical_qty,false),qb_qty:validQty(r.qb_qty,true),note:String(r.note||'').trim()||null});
      const updates=[...E.updates.values()].map(pack),additions=[...E.additions.values()].map(pack);
      if(button){button.disabled=true;button.textContent='Submitting...'}
      const rpc=await db.rpc('request_stock_count_edit',{
        p_count_id:E.count.id,p_period_month:month+'-01',p_count_date:date,
        p_note:document.getElementById('scerCountNote')?.value||'',
        p_updates:updates,p_removals:[...E.removals],p_additions:additions,p_reason:reason
      });
      if(rpc.error)throw rpc.error;
      const countId=E.count.id;
      window.closeStockCountEditOverlay();
      showToast('Stock Count edit request submitted for Admin / Super Admin approval.');
      await window.openStockCount(countId);
    }catch(err){showToast(err.message||'Could not request Stock Count edit.','err')}
    finally{if(button&&button.isConnected){button.disabled=false;button.textContent='Submit Edit Request'}}
  };

  async function listRequests(countId,pendingOnly){
    const result=await db.rpc('get_stock_count_edit_requests',{p_count_id:countId||null,p_pending_only:!!pendingOnly});
    if(result.error)throw result.error;
    E.requests=Array.isArray(result.data)?result.data:[];
    E.reviewMap=new Map(E.requests.map(r=>[r.id,r]));
    return E.requests;
  }
  async function itemNameMap(rows){
    const ids=new Set();
    for(const r of rows){
      for(const i of r.original?.items||[])if(i.product_id)ids.add(i.product_id);
      for(const i of r.proposed?.additions||[])if(i.product_id)ids.add(i.product_id);
    }
    if(!ids.size)return new Map();
    const out=await db.from('product_catalog').select('id,code,item_name').in('id',[...ids].slice(0,800)).limit(800);
    if(out.error)throw out.error;
    return new Map((out.data||[]).map(p=>[p.id,(p.code||'')+' · '+(p.item_name||'Product')]));
  }
  function compareText(v){return v==null||v===''?'—':String(v)}
  function changesHtml(r,productLabels){
    const original=r.original||{},proposed=r.proposed||{};
    let out='';
    const change=(label,a,b)=>{
      if(String(a??'')===String(b??''))return '';
      return '<div class="flex flex-wrap gap-2 text-xs py-1"><b class="min-w-[100px]">'+esc(label)+'</b><span class="text-red-700 line-through">'+esc(compareText(a))+'</span><span>→</span><span class="font-bold text-green-800">'+esc(compareText(b))+'</span></div>';
    };
    out+=change('Month',dateOnly(original.period_month).slice(0,7),dateOnly(proposed.period_month).slice(0,7));
    out+=change('Count Date',dateOnly(original.count_date),dateOnly(proposed.count_date));
    out+=change('Count Note',original.note,proposed.note);
    const before=new Map((original.items||[]).map(x=>[x.item_id,x]));
    for(const u of proposed.updates||[]){
      const old=before.get(u.item_id)||{},name=productLabels.get(old.product_id)||old.product_id||'Product';
      const diff=change('Physical',old.physical_qty,u.physical_qty)+change('QB',old.qb_qty,u.qb_qty)+change('Item Note',old.note,u.note);
      if(diff)out+='<div class="border rounded-lg p-2 mt-2"><b class="text-xs">'+esc(name)+'</b>'+diff+'</div>';
    }
    for(const id of proposed.removals||[]){
      const old=before.get(id)||{},name=productLabels.get(old.product_id)||old.product_id||'Product';
      out+='<div class="text-xs text-red-700 mt-2"><b>Remove item:</b> '+esc(name)+' (Physical '+esc(compareText(old.physical_qty))+')</div>';
    }
    for(const a of proposed.additions||[]){
      out+='<div class="text-xs text-green-800 mt-2"><b>Add item:</b> '+esc(productLabels.get(a.product_id)||a.product_id)+
        ' · Physical '+esc(compareText(a.physical_qty))+' · QB '+esc(compareText(a.qb_qty))+'</div>';
    }
    return out||'<div class="text-xs text-gray-400">No visible field differences</div>';
  }
  function reviewCard(r,labels){
    const pending=r.status==='pending';
    return '<div class="rounded-xl border p-3 space-y-2">'+
      '<div class="flex flex-wrap justify-between gap-2"><div><b class="text-sm">'+esc(dateOnly(r.period_month).slice(0,7))+' · '+esc(r.location||'')+'</b>'+
        '<div class="text-xs text-gray-500">'+esc(r.requested_by_name||'')+' · '+esc(new Date(r.requested_at).toLocaleString())+'</div></div>'+
        '<span class="text-xs font-bold '+(pending?'text-amber-700':'text-gray-500')+'">'+esc(r.status.toUpperCase())+'</span></div>'+
      '<div class="text-xs"><b>Reason:</b> '+esc(r.reason||'')+'</div>'+
      '<div class="rounded-lg bg-gray-50 p-2">'+changesHtml(r,labels)+'</div>'+
      (r.reviewer_note?'<div class="text-xs text-gray-600">Review note: '+esc(r.reviewer_note)+'</div>':'')+
      (canReview()&&pending?'<div class="space-y-2 border-t pt-2"><label class="text-xs">Review note (optional)<input id="scerReviewNote_'+esc(r.id)+'" class="w-full border rounded-lg p-2 mt-1" placeholder="Optional explanation for approve/reject"></label>'+
        '<div class="flex flex-wrap gap-2 justify-end"><button onclick="reviewStockCountEdit(\''+esc(r.id)+'\',false)" class="px-3 py-2 border border-red-200 text-red-700 rounded-lg text-xs font-semibold">Reject</button>'+
        '<button onclick="reviewStockCountEdit(\''+esc(r.id)+'\',true)" class="px-3 py-2 bg-green-700 text-white rounded-lg text-xs font-semibold">Approve Changes</button></div></div>':'')+
    '</div>';
  }
  window.openStockCountEditQueue=async function(countId=null,pendingOnly=false){
    if(!canReview()&&role()!=='stock_controller')return showToast('You do not have access to Stock Count requests.','err');
    try{
      const rows=await listRequests(countId,pendingOnly);
      const labels=await itemNameMap(rows);
      overlay(frame('Stock Count Edit Requests',
        rows.length+' request(s) · Admin/Super Admin approval required',
        '<div class="space-y-3">'+(rows.length?rows.map(r=>reviewCard(r,labels)).join(''):
        '<div class="text-sm p-8 text-center text-gray-400">No edit requests found.</div>')+'</div>',''));
    }catch(err){showToast(err.message||'Could not load Stock Count edit requests.','err')}
  };
  window.reviewStockCountEdit=async function(id,approve){
    if(!canReview())return showToast('Admin / Super Admin approval required.','err');
    const row=E.reviewMap.get(id);
    if(!row||row.status!=='pending')return showToast('Refresh the pending edit list.','err');
    if(approve&&!confirm('Approve proposed corrections to this Stock Count? This updates the submitted count, but does not create stock movements.'))return;
    const note=document.getElementById('scerReviewNote_'+id)?.value||null;
    const res=await db.rpc('review_stock_count_edit',{p_request_id:id,p_approve:!!approve,p_note:note});
    if(res.error)return showToast(res.error.message||'Review failed.','err');
    showToast(approve?'Stock Count corrections approved.':'Stock Count edit request rejected.');
    const targetCount=row.stock_count_id;
    window.closeStockCountEditOverlay();
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
    if(typeof window.renderStockInventory==='function')window.renderStockInventory();
    if(document.getElementById('modalBody')&&document.getElementById('modal')?.classList.contains('opacity-100'))await window.openStockCount(targetCount);
    else await window.openStockCountEditQueue(null,true);
  };

  const previousOpen=window.openStockCount;
  if(typeof previousOpen==='function'){
    window.openStockCount=async function(countId){
      const result=await previousOpen.apply(this,arguments);
      if(!document.getElementById('modalBody')||!countId)return result;
      try{
        const [countResult,requests]=await Promise.all([
          db.from('stock_counts').select('id,status,count_date').eq('id',countId).single(),
          db.rpc('get_stock_count_edit_requests',{p_count_id:countId,p_pending_only:false})
        ]);
        if(countResult.error||requests.error)return result;
        if(document.getElementById('stockCountEditTools'))return result;
        const count=countResult.data,pending=(requests.data||[]).filter(x=>x.status==='pending');
        const hasRequests=(requests.data||[]).length>0;
        const actionRow=document.getElementById('stockCountActionBar');
        if(!actionRow)return result;
        const wrap=document.createElement('div');
        wrap.id='stockCountEditTools';
        wrap.className='w-full flex flex-wrap items-center gap-2 justify-end mb-2';
        wrap.innerHTML=
          (canRequest()&&['submitted','reconciled'].includes(count.status)&&!pending.length?
            '<button type="button" onclick="openStockCountEditRequest(\''+esc(countId)+'\')" class="px-3 py-2 rounded-lg bg-blue-700 text-white text-xs font-semibold">Request Edit</button>':'')+
          (hasRequests?'<button type="button" onclick="openStockCountEditQueue(\''+esc(countId)+'\')" class="px-3 py-2 rounded-lg border text-xs font-semibold">'+(canReview()?'Review':'View')+' Edit Requests'+(pending.length?' ('+pending.length+' pending)':'')+'</button>':'')+
          (count.status==='closed'?'<span class="text-[10px] text-gray-500">Closed count: corrections require Admin reopening.</span>':'')+
          (pending.length?'<span class="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 px-2 py-1 text-xs font-semibold">Pending edit approval · closing blocked</span>':'');
        actionRow.parentElement.insertBefore(wrap,actionRow);
      }catch(err){console.warn('Count edit request controls unavailable',err)}
      return result;
    };
  }
})();