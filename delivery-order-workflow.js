// Delivery Order workflow overlay for Customer Fulfillment.
// Keeps the existing linked-fulfillment screen intact and adds DO Requests + Delivery History.
(function(){
  const D={view:'linked',requests:[],history:[],expandedRequests:new Set()};

  function num(v){return Number(v||0)}
  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function qty(v){
    const x=Number(v||0);
    if(!Number.isFinite(x))return '0';
    return Number.isInteger(x)?x.toLocaleString():x.toLocaleString(undefined,{maximumFractionDigits:2});
  }
  function title(v){
    return String(v||'').replace(/[_-]+/g,' ').replace(/\b\w/g,function(m){return m.toUpperCase()});
  }
  function dateText(v){
    if(!v)return '';
    const s=String(v).slice(0,10);
    const p=s.split('-');
    return p.length===3?p[2]+'/'+p[1]+'/'+p[0]:s;
  }
  function role(){return String((typeof state!=='undefined'&&state&&state.profile&&state.profile.role)||'')}
  function canOperate(){return ['stock_controller','admin','super_admin'].includes(role())}
  function canEditDoNumber(){return ['admin','super_admin'].includes(role())}
  function deliveryActive(){
    const btn=[].slice.call(document.querySelectorAll('.inv-tab')).find(function(b){
      return String(b.getAttribute('onclick')||'').includes("setInventoryTab('delivery')");
    });
    return !!(btn&&btn.classList.contains('active'));
  }
  function body(){return document.getElementById('inventoryBody')}
  function searchValue(){const el=document.querySelector('.inv-search');return el?el.value:''}

  async function loadRequests(search){
    const r=await db.rpc('get_inventory_do_requests',{p_search:String(search||'').trim()||null});
    if(r.error)throw r.error;
    D.requests=r.data||[];
    return D.requests;
  }
  async function loadHistory(search){
    const r=await db.rpc('get_inventory_do_history',{p_search:String(search||'').trim()||null});
    if(r.error)throw r.error;
    D.history=(r.data||[]).filter(function(x){return num(x.delivered_qty)>0});
    return D.history;
  }

  function navHtml(reqCount,historyCount){
    function b(view,label,count){
      const active=D.view===view;
      return '<button type="button" onclick="setStockDeliveryView(\''+view+'\')" class="px-3 py-2 rounded-lg border text-[10px] font-semibold '+(active?'bg-[#211d18] text-white border-[#211d18]':'bg-white')+'">'+label+(count==null?'':' <span class="opacity-70">'+Number(count||0).toLocaleString()+'</span>')+'</button>';
    }
    return '<div id="deliveryOrderNav" class="rounded-xl border border-blue-100 bg-blue-50/40 p-3 mb-3">'+
      '<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">'+
        '<div><b class="text-sm">Customer Fulfillment</b><div class="text-[10px] text-gray-500 mt-1">Sales delivery requests, official DO numbers, Stock OUT and delivery history stay connected.</div></div>'+
        '<div class="flex flex-wrap gap-2">'+
          b('linked','Linked Fulfillment',null)+
          b('do','DO Requests',reqCount)+
          b('history','Delivery History',historyCount)+
        '</div>'+
      '</div>'+
    '</div>';
  }

  async function enhanceLinked(){
    const el=body();if(!el||!deliveryActive())return;
    try{
      const data=await Promise.all([loadRequests(searchValue()),loadHistory(searchValue())]);
      const old=document.getElementById('deliveryOrderNav');if(old)old.remove();
      el.insertAdjacentHTML('afterbegin',navHtml(data[0].length,data[1].length));
    }catch(_){}
  }

  function requestStatusClass(status){
    const s=String(status||'requested').toLowerCase();
    if(s==='partially_delivered')return 'bg-blue-50 border-blue-200 text-blue-700';
    if(s==='do_assigned')return 'bg-purple-50 border-purple-200 text-purple-700';
    return 'bg-amber-50 border-amber-200 text-amber-800';
  }

  function requestCard(req){
    const items=Array.isArray(req.items)?req.items:[];
    const hasDo=!!String(req.do_no||'').trim();
    const id=String(req.delivery_request_id);
    const expanded=D.expandedRequests.has(id);
    let itemHtml='';
    if(expanded)items.forEach(function(item){
      const remaining=num(item.remaining_qty);
      let actions='<span class="text-[10px] text-gray-400">View only</span>';
      if(canOperate()&&remaining>0){
        if(!item.inventory_tracking_enabled){
          actions='<button onclick="linkDoItemToStock(\''+esc(item.sales_order_item_id)+'\')" class="px-3 py-2 border border-amber-300 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-semibold">Link to Stock</button>';
        }else{
          actions='<button onclick="openStockFulfillmentStatus(\''+esc(item.sales_order_item_id)+'\')" class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-[10px] font-semibold">Status</button>';
          if(hasDo){
            actions+=' <button onclick="openDoStockRelease(\''+esc(req.delivery_request_id)+'\',\''+esc(item.delivery_request_item_id)+'\')" class="px-3 py-2 bg-[#211d18] text-white rounded-lg text-[10px] font-semibold">Release / OUT</button>';
          }else{
            actions+=' <span class="text-[9px] text-gray-400 px-2 py-2">Assign DO No. first</span>';
          }
        }
      }else if(remaining<=0){
        actions='<span class="px-2 py-1 rounded-lg border bg-green-50 border-green-200 text-green-700 text-[9px] font-bold">Completed</span>';
      }

      itemHtml+='<div class="py-3 grid lg:grid-cols-[1.7fr_90px_90px_95px_245px] gap-3 items-center">'+
        '<div class="flex gap-3 items-center min-w-0">'+
          '<div class="w-12 h-12 rounded-lg overflow-hidden bg-gray-100 shrink-0">'+(item.image_url?'<img src="'+esc(item.image_url)+'" class="w-full h-full object-cover">':'<div class="w-full h-full flex items-center justify-center text-[8px] text-gray-400">No Photo</div>')+'</div>'+
          '<div class="min-w-0"><div class="text-[10px] font-bold text-[#a77d1a]">'+esc(item.product_code||'')+'</div><div class="text-sm font-semibold truncate">'+esc(item.item_name||'')+'</div><div class="text-[9px] text-gray-400">'+(item.inventory_tracking_enabled?'Linked to Stock':'Not linked to Stock')+' · '+esc(title(item.fulfillment_status||'ordered'))+'</div></div>'+
        '</div>'+
        '<div class="text-xs"><div class="text-gray-400">DO Qty</div><b>'+qty(item.requested_qty)+'</b></div>'+
        '<div class="text-xs"><div class="text-gray-400">OUT</div><b class="text-green-700">'+qty(item.delivered_qty)+'</b></div>'+
        '<div class="text-xs"><div class="text-gray-400">Remaining</div><b class="'+(remaining>0?'text-amber-700':'text-green-700')+'">'+qty(remaining)+'</b></div>'+
        '<div class="flex flex-wrap gap-1.5 justify-end">'+actions+'</div>'+
      '</div>';
    });

    // Keep the official DO number, date and actions visible while hiding long
    // product lists until this individual request is expanded.
    return '<div class="inv-card">'+
      '<div class="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-2">'+
        '<button type="button" onclick="toggleDoRequestCard(\''+esc(id)+'\')" '+
          'aria-expanded="'+String(expanded)+'" aria-controls="do-request-details-'+esc(id)+'" '+
          'class="flex min-w-0 flex-1 items-center gap-3 text-left rounded-lg p-1.5 -m-1.5 hover:bg-gray-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500" '+
          'title="'+(expanded?'Collapse':'Expand')+' this Delivery Order">'+
          '<span aria-hidden="true" class="flex w-7 h-7 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-700 font-bold">'+(expanded?'▾':'▸')+'</span>'+
          '<span class="block min-w-0">'+
            '<span class="flex flex-wrap items-center gap-2"><b class="text-sm">'+esc(req.document_no||'Sales Order')+'</b>'+
              '<span class="px-2 py-0.5 rounded-full border text-[9px] font-bold '+requestStatusClass(req.request_status)+'">'+esc(title(req.request_status||'requested'))+'</span>'+
              (hasDo?'<span class="px-2 py-0.5 rounded-full border border-purple-200 bg-purple-50 text-purple-700 text-[9px] font-bold">'+esc(req.do_no)+'</span>':'')+
            '</span>'+
            '<span class="block text-xs text-gray-600 mt-1">'+esc(req.customer_name||'')+(req.sales_rep_name?' · '+esc(req.sales_rep_name):'')+'</span>'+
            '<span class="block text-[10px] text-gray-500 mt-1">Requested '+esc(dateText(req.requested_at))+(req.requested_delivery_date?' · Delivery '+esc(dateText(req.requested_delivery_date)):'')+' · '+items.length+' item'+(items.length===1?'':'s')+'</span>'+
          '</span>'+
        '</button>'+
        '<div class="flex flex-wrap items-center gap-2 lg:justify-end lg:pl-3">'+
          '<div class="text-xs text-right mr-1"><div class="text-gray-400">Requested / OUT</div><b>'+qty(req.total_requested_qty)+' / '+qty(req.total_delivered_qty)+'</b></div>'+
          (hasDo?'<button type="button" onclick="exportStockDeliveryOrder(\''+esc(id)+'\')" class="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-[10px] font-bold" title="Open the official Delivery Order, then print or save as PDF">↧ Export DO / PDF</button>':'')+
          (canEditDoNumber()?'<button type="button" onclick="assignDeliveryOrderNo(\''+esc(id)+'\')" class="px-3 py-2 rounded-lg border '+(hasDo?'border-purple-200 bg-purple-50 text-purple-700':'border-[#d8c28a] bg-[#fffaf0] text-[#8a6a1f]')+' text-[10px] font-bold">'+(hasDo?'Correct DO No.':'Assign Missing DO No.')+'</button>':'')+
        '</div>'+
      '</div>'+
      '<div id="do-request-details-'+esc(id)+'" class="'+(expanded?'mt-3 pt-2 border-t':'hidden')+'">'+
        (expanded?'<div class="space-y-1 pb-2">'+
          (req.delivery_address?'<div class="text-[10px] text-gray-500">Address: '+esc(req.delivery_address)+'</div>':'')+
          (req.request_note?'<div class="text-[10px] text-gray-500">Remark: '+esc(req.request_note)+'</div>':'')+
        '</div><div class="divide-y">'+itemHtml+'</div>':'')+
      '</div>'+
    '</div>';
  }

  // Expand/collapse from the already-loaded DO list; do not refetch data on
  // each tap (especially helpful when the list contains dozens of items).
  function paintDoRequests(){
    const el=body();if(!el||D.view!=='do'||!deliveryActive())return;
    const rows=D.requests,history=D.history;
    const cards=rows.map(requestCard).join('');
    const expandedCount=rows.filter(r=>D.expandedRequests.has(String(r.delivery_request_id))).length;
    el.innerHTML=navHtml(rows.length,history.length)+
      '<div class="rounded-xl border border-amber-100 bg-amber-50/40 p-3 mb-3 text-xs text-amber-900"><b>DO workflow:</b> the official DO number is generated automatically when Sales submits the request (DOYYMM-001, resetting each month). Stock OUT from this section records that number with the movement. Only Admin/Super Admin can correct an unused number.</div>'+
      '<div class="mb-3 flex flex-wrap items-center justify-between gap-2">'+
        '<div class="text-xs text-gray-500">'+rows.length+' DO request'+(rows.length===1?'':'s')+' · '+expandedCount+' expanded</div>'+
        '<div class="flex flex-wrap gap-2">'+
          '<button type="button" onclick="setAllDoRequestsExpanded(true)" '+(rows.length&&expandedCount<rows.length?'':'disabled')+' class="px-3 py-2 border rounded-lg text-xs font-semibold bg-white disabled:opacity-40">Expand All</button>'+
          '<button type="button" onclick="setAllDoRequestsExpanded(false)" '+(expandedCount?'':'disabled')+' class="px-3 py-2 border rounded-lg text-xs font-semibold bg-white disabled:opacity-40">Collapse All</button>'+
        '</div>'+
      '</div>'+
      '<div class="grid gap-3">'+(cards||'<div class="inv-card py-12 text-center text-sm text-gray-400">No open DO requests match this search.</div>')+'</div>';
  }

  window.toggleDoRequestCard=function(requestId){
    const id=String(requestId||'');
    if(!D.requests.some(x=>String(x.delivery_request_id)===id))return;
    if(D.expandedRequests.has(id))D.expandedRequests.delete(id);
    else D.expandedRequests.add(id);
    paintDoRequests();
    // Replacing the list should not discard keyboard focus from its toggle.
    const btn=[...document.querySelectorAll('#inventoryBody button[aria-controls]')]
      .find(x=>x.getAttribute('aria-controls')==='do-request-details-'+id);
    btn?.focus({preventScroll:true});
  };
  window.setAllDoRequestsExpanded=function(expand){
    D.expandedRequests.clear();
    if(expand)D.requests.forEach(x=>D.expandedRequests.add(String(x.delivery_request_id)));
    paintDoRequests();
  };

  async function renderRequests(){
    const el=body();if(!el)return;
    el.innerHTML='<div class="inv-card py-10 text-center text-sm text-gray-400">Loading DO requests...</div>';
    try{
      await Promise.all([loadRequests(searchValue()),loadHistory(searchValue())]);
      paintDoRequests();
    }catch(err){
      if(D.view==='do'&&deliveryActive())el.innerHTML='<div class="inv-card text-red-600">Error loading DO requests: '+esc(err.message||'Unknown error')+'</div>';
    }
  }

  async function renderHistory(){
    const el=body();if(!el)return;
    el.innerHTML='<div class="inv-card py-10 text-center text-sm text-gray-400">Loading delivery history...</div>';
    try{
      const data=await Promise.all([loadRequests(searchValue()),loadHistory(searchValue())]);
      const reqs=data[0],rows=data[1];
      let cards='';
      rows.forEach(function(h){
        const items=Array.isArray(h.items)?h.items:[];
        let itemText='';
        items.forEach(function(i){itemText+=esc((i.product_code||'')+(i.item_name?' · '+i.item_name:''))+'<br>'});
        cards+='<div class="inv-card grid lg:grid-cols-[1.1fr_1.5fr_100px_125px_auto] gap-4 items-center">'+
          '<div><div class="text-[9px] uppercase font-bold text-gray-400">Delivery Order</div><div class="font-bold text-purple-700">'+esc(h.do_no||'-')+'</div><div class="text-[10px] text-gray-500 mt-1">'+esc(h.document_no||'Sales Order')+'</div></div>'+
          '<div><div class="font-semibold">'+esc(h.customer_name||'')+'</div><div class="text-[10px] text-gray-500 mt-1">'+(itemText||'No item detail')+'</div></div>'+
          '<div class="text-xs"><div class="text-gray-400">OUT Qty</div><b class="text-green-700">'+qty(h.delivered_qty)+'</b></div>'+
          '<div class="text-xs text-right"><div class="text-gray-400">Last OUT</div><b>'+esc(dateText(h.delivered_date)||'-')+'</b>'+(h.requested_delivery_date?'<div class="text-[9px] text-gray-400 mt-1">Requested '+esc(dateText(h.requested_delivery_date))+'</div>':'')+'</div>'+
          '<div class="flex justify-end"><button type="button" onclick="exportStockDeliveryOrder(\''+esc(h.delivery_request_id)+'\')" class="px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-800 text-[10px] font-bold" title="Reprint this Delivery Order or save as PDF">↧ Export DO / PDF</button></div>'+
        '</div>';
      });
      el.innerHTML=navHtml(reqs.length,rows.length)+
        '<div class="rounded-xl border border-green-100 bg-green-50/50 p-3 mb-3 text-xs text-green-800"><b>Delivery History</b> shows actual DO-linked Stock OUT records. Search by DO number, invoice/order or customer.</div>'+
        '<div class="grid gap-3">'+(cards||'<div class="inv-card py-12 text-center text-sm text-gray-400">No DO-linked deliveries match this search.</div>')+'</div>';
    }catch(err){
      el.innerHTML='<div class="inv-card text-red-600">Error loading delivery history: '+esc(err.message||'Unknown error')+'</div>';
    }
  }

  window.setStockDeliveryView=function(view){
    const next=['linked','do','history'].includes(view)?view:'linked';
    // Reopening the DO tab starts with compact summaries. A stock-side
    // refresh while already on this tab preserves any expanded requests.
    if(next==='do'&&D.view!=='do')D.expandedRequests.clear();
    D.view=next;
    if(typeof window.renderStockInventory==='function')window.renderStockInventory();
  };
  window.showDoRequests=function(){window.setStockDeliveryView('do')};
  window.showDeliveryHistory=function(){window.setStockDeliveryView('history')};

  window.assignDeliveryOrderNo=async function(requestId){
    if(!canEditDoNumber())return showToast('Admin / Super Admin access required to correct DO numbers.','err');
    const req=D.requests.find(function(x){return String(x.delivery_request_id)===String(requestId)});
    if(!req)return showToast('DO request not found. Refresh and try again.','err');

    openModal((req.do_no?'Correct':'Assign Missing')+' Delivery Order Number',
      '<form id="assignDeliveryOrderForm" class="space-y-4">'+
        '<div class="rounded-xl border bg-[#fcfbf8] p-4"><div class="font-bold">'+esc(req.document_no||'Sales Order')+'</div><div class="text-xs text-gray-500 mt-1">'+esc(req.customer_name||'')+'</div><div class="text-[10px] text-gray-400 mt-1">Automatically generated as DOYYMM-NNN for the month of request. Admin corrections are allowed only before any Stock OUT has been released.</div></div>'+
        '<div><label class="text-xs font-semibold">Official DO Number *</label><input id="deliveryOrderNoInput" value="'+esc(req.do_no||'')+'" required class="mt-1 w-full border rounded-xl px-3 py-3 uppercase" placeholder="Example: DO2610-001"></div>'+
        '<button id="deliveryOrderNoSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save DO Correction</button>'+
      '</form>'
    );

    document.getElementById('assignDeliveryOrderForm').onsubmit=async function(e){
      e.preventDefault();
      const no=String(document.getElementById('deliveryOrderNoInput').value||'').trim().toUpperCase();
      if(!/^DO[0-9]{2}(0[1-9]|1[0-2])-[0-9]{3,}$/.test(no))return showToast('Use format DOYYMM-NNN, such as DO2610-001.','err');
      const btn=document.getElementById('deliveryOrderNoSave');btn.disabled=true;btn.textContent='Saving...';
      const r=await db.rpc('assign_delivery_order_no',{p_delivery_request_id:requestId,p_do_no:no});
      if(r.error){btn.disabled=false;btn.textContent='Save DO Correction';return showToast(r.error.message,'err')}
      closeModal();showToast('DO '+no+' assigned to this delivery batch.');
      if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
    };
  };

  window.linkDoItemToStock=async function(itemId){
    if(!canOperate())return;
    try{
      const r=await db.rpc('enable_inventory_tracking_for_sales_item',{p_sales_order_item_id:itemId});
      if(r.error)throw r.error;
      showToast('Item linked to Stock.');
      if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
    }catch(err){showToast(err.message||'Could not link Sales item to Stock.','err')}
  };

  window.openDoStockRelease=async function(requestId,requestItemId){
    if(!canOperate())return;
    try{
      let req=D.requests.find(function(x){return String(x.delivery_request_id)===String(requestId)});
      if(!req){
        await loadRequests('');
        req=D.requests.find(function(x){return String(x.delivery_request_id)===String(requestId)});
      }
      if(!req)return showToast('DO request not found.','err');
      if(!String(req.do_no||'').trim())return showToast('Assign the official DO number before Stock OUT.','err');

      const items=Array.isArray(req.items)?req.items:[];
      const item=items.find(function(x){return String(x.delivery_request_item_id)===String(requestItemId)});
      if(!item)return showToast('DO item not found. Refresh and try again.','err');
      if(num(item.remaining_qty)<=0)return showToast('This DO item is already fully delivered.','err');
      if(!item.inventory_tracking_enabled)return window.linkDoItemToStock(item.sales_order_item_id);

      const sr=await db.rpc('get_inventory_item_status_for_stock',{p_sales_order_item_id:item.sales_order_item_id});
      if(sr.error)throw sr.error;
      const statusRows=sr.data||[];
      const arrived=statusRows.filter(function(a){return String(a.status||'').toLowerCase()==='arrived'}).reduce(function(sum,a){return sum+num(a.qty)},0);
      if(arrived<=0)return showToast('Mark at least one unit Arrived before releasing this DO item.','err');

      const br=await db.from('inventory_product_balance').select('*').eq('product_id',item.product_id).maybeSingle();
      if(br.error)throw br.error;
      const locations=(br.data&&Array.isArray(br.data.locations)?br.data.locations:[]).filter(function(l){return num(l.qty)>0});
      if(!locations.length)return showToast('No physical stock location has quantity available for this product.','err');

      const maxQty=Math.min(num(item.remaining_qty),arrived);
      let locOptions='<option value="">Select stock location</option>';
      locations.forEach(function(l){
        locOptions+='<option value="'+esc(l.location_id)+'">'+esc(l.code||l.name||'Location')+' · On Hand '+qty(l.qty)+'</option>';
      });

      openModal('Release DO '+esc(req.do_no),
        '<form id="doStockReleaseForm" class="space-y-4">'+
          '<div class="rounded-xl border bg-gray-50 p-4"><div class="text-xs text-gray-500">'+esc(req.customer_name||'')+' · '+esc(req.document_no||'Sales Order')+'</div><div class="text-[10px] font-bold text-[#a77d1a] mt-1">'+esc(item.product_code||'')+'</div><div class="font-semibold">'+esc(item.item_name||'')+'</div><div class="text-xs mt-2">DO Qty '+qty(item.requested_qty)+' · OUT '+qty(item.delivered_qty)+' · <b>DO Remaining '+qty(item.remaining_qty)+'</b> · Arrived '+qty(arrived)+'</div></div>'+
          '<div class="rounded-xl border border-purple-100 bg-purple-50 p-3 text-xs text-purple-800"><b>DO No. '+esc(req.do_no)+'</b> will be stored on this Stock OUT movement automatically.</div>'+
          '<div class="grid md:grid-cols-2 gap-4">'+
            '<div><label class="text-xs font-semibold">Release Qty *</label><input id="doReleaseQty" type="number" min="1" max="'+maxQty+'" step="1" value="'+maxQty+'" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>'+
            '<div><label class="text-xs font-semibold">From Location *</label><select id="doReleaseLocation" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">'+locOptions+'</select></div>'+
            '<div><label class="text-xs font-semibold">Delivery Date</label><input id="doReleaseDate" type="date" value="'+new Date().toISOString().slice(0,10)+'" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>'+
            '<div><label class="text-xs font-semibold">Remark</label><input id="doReleaseNote" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional delivery remark"></div>'+
          '</div>'+
          '<button id="doReleaseSave" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Confirm DO Stock OUT</button>'+
        '</form>'
      );

      document.getElementById('doStockReleaseForm').onsubmit=async function(e){
        e.preventDefault();
        const releaseQty=Number(document.getElementById('doReleaseQty').value||0);
        if(!Number.isInteger(releaseQty)||releaseQty<=0||releaseQty>maxQty)return showToast('Release quantity must be a whole number from 1 to '+qty(maxQty)+'.','err');
        const locationId=document.getElementById('doReleaseLocation').value;
        if(!locationId)return showToast('Select a stock location.','err');
        const btn=document.getElementById('doReleaseSave');btn.disabled=true;btn.textContent='Releasing...';
        const rr=await db.rpc('release_sales_stock_do',{
          p_delivery_request_item_id:requestItemId,
          p_qty:releaseQty,
          p_location_id:locationId,
          p_delivery_date:document.getElementById('doReleaseDate').value||null,
          p_note:String(document.getElementById('doReleaseNote').value||'').trim()||null
        });
        if(rr.error){btn.disabled=false;btn.textContent='Confirm DO Stock OUT';return showToast(rr.error.message,'err')}
        closeModal();showToast('DO '+req.do_no+' Stock OUT recorded and added to Delivery History.');
        D.view='do';
        if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
      };
    }catch(err){showToast(err.message||'Could not release this DO item.','err')}
  };

  const previousBody=window.renderStockInventoryBody;
  if(typeof previousBody==='function'){
    window.renderStockInventoryBody=async function(){
      const result=await previousBody.apply(this,arguments);
      if(!deliveryActive())return result;
      if(D.view==='do')await renderRequests();
      else if(D.view==='history')await renderHistory();
      else await enhanceLinked();
      return result;
    };
  }
})();
