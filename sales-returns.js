// Customer return / Credit Note (CN) workflow.
// Keeps the original TK/RK/SR and payments intact; a CN records returned items separately.
(function(){
  function role(){return state.profile?.role||''}
  function allowed(){return ['sales','manager','admin','super_admin'].includes(role())}
  function canEditCN(){return allowed()}
  function canChangeCNStatus(){return ['manager','admin','super_admin'].includes(role())}
  function canDeleteCN(){return ['admin','super_admin'].includes(role())}
  function managerContext(){return typeof managerRepActive==='function'&&managerRepActive()}
  function fmtDate(v){if(!v)return '-';const d=new Date(String(v).length===10?v+'T00:00:00':v);return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString('en-GB',{day:'numeric',month:'short',year:'numeric'})}
  function today(){const d=new Date(),y=d.getFullYear(),m=String(d.getMonth()+1).padStart(2,'0'),day=String(d.getDate()).padStart(2,'0');return `${y}-${m}-${day}`}
  function actionLabel(v){return ({return_only:'Return Only / No Refund',return_to_stock:'Return to Stock',exchange:'Exchange',damaged_return:'Damaged / Defective Return'})[v]||titleCase(v||'')}
  function dispositionLabel(v){return ({return_to_stock:'Return to Stock',damaged_hold:'Damaged Hold',exchange:'Exchange',no_stock_action:'No Stock Action'})[v]||titleCase(v||'')}
  function conditionLabel(v){return ({good:'Good',damaged:'Damaged',defective:'Defective',other:'Other'})[v]||titleCase(v||'')}
  function statusBadge(v){const cls=v==='received'?'bg-green-50 border-green-200 text-green-700':v==='cancelled'?'bg-gray-100 border-gray-200 text-gray-500':'bg-amber-50 border-amber-200 text-amber-700';return `<span class="inline-flex px-2 py-1 rounded-lg border text-[9px] uppercase tracking-wide font-bold ${cls}">${esc(v||'-')}</span>`}

  // Add Returns / CN to the same navigation system used by the rest of the app.
  const baseNavItems=window.navItems;
  if(typeof baseNavItems==='function')window.navItems=function(){
    const items=baseNavItems.apply(this,arguments)||[];
    if(allowed()&&!items.some(x=>x[0]==='returns')){
      const at=Math.max(0,items.findIndex(x=>x[0]==='payments')+1);
      items.splice(at,0,['returns','Returns / CN','↩']);
    }
    return items;
  };

  const baseGo=window.go;
  window.go=async function(page){
    if(page!=='returns')return baseGo.apply(this,arguments);
    if(!allowed())return showToast('You do not have access to Returns / CN.','err');
    state.page='returns';renderNav();
    document.getElementById('pageTitle').textContent='Returns / Credit Notes';
    document.getElementById('pageSubtitle').textContent='Customer returned items and CN tracking';
    document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
    try{await renderReturnsPage()}catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
  };

  window.renderReturnsPage=async function(){
    const {data,error}=await db.rpc('get_visible_sales_returns');
    if(error)throw error;
    let rows=data||[];
    if(managerContext())rows=rows.filter(x=>x.sales_rep_id===managerRepId());
    window._visibleSalesReturns=rows;
    const current=rows.filter(x=>x.status==='confirmed').length;
    const received=rows.filter(x=>x.status==='received').length;
    const value=rows.filter(x=>x.status!=='cancelled').reduce((a,x)=>a+Number(x.return_value||0),0);
    document.getElementById('content').innerHTML=`
      ${managerContext()&&typeof managerRepBanner==='function'?managerRepBanner():''}
      <div id="salesReturnsRoot">
        <div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-5">
          ${kpi('Credit Notes',rows.length,'Visible CN documents')}
          ${kpi('Awaiting Return',current,'Confirmed CN')}
          ${kpi('Received',received,'Physically returned')}
          ${kpi('Net Return Value',money(value),'After applicable sales discounts')}
        </div>
        <div class="card rounded-2xl p-4 mb-4 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
          <div><h3 class="font-bold">Returns / Credit Notes</h3><p class="text-[11px] text-gray-400 mt-1">Original invoices and payments remain unchanged. One CN can include items from multiple invoices for the same customer.</p></div>
          <div class="flex flex-col sm:flex-row gap-2 w-full lg:w-auto">
            <input id="returnSearch" oninput="filterSalesReturns()" class="border rounded-xl px-4 py-2.5 min-w-[280px] bg-white" placeholder="Search CN, customer, invoice...">
            <button onclick="openNewSalesReturn()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold whitespace-nowrap">+ New CN</button>
          </div>
        </div>
        <div id="salesReturnRows" class="grid gap-2"></div>
      </div>`;
    renderSalesReturnRows(rows);
  };

  window.filterSalesReturns=function(){
    const q=(document.getElementById('returnSearch')?.value||'').trim().toLowerCase();
    const src=window._visibleSalesReturns||[];
    const rows=!q?src:src.filter(r=>[r.cn_no,r.customer_name,r.original_document_no,r.reason,r.action,r.status,r.notes].some(v=>String(v||'').toLowerCase().includes(q)));
    renderSalesReturnRows(rows);
  };

  function renderSalesReturnRows(rows){
    const root=document.getElementById('salesReturnRows');if(!root)return;
    if(!rows.length){root.innerHTML=empty('No Credit Notes yet.');return;}
    root.innerHTML=rows.map(r=>`<div class="bg-white border border-[#ece8e0] rounded-2xl px-4 py-3 shadow-[0_3px_14px_rgba(31,25,18,.025)]">
      <div class="grid md:grid-cols-2 xl:grid-cols-[.8fr_1.25fr_.9fr_.85fr_.85fr_auto] gap-3 xl:gap-4 items-center">
        <div><div class="font-bold text-[15px]">${esc(r.cn_no||'')}</div><div class="text-[10px] text-gray-400 mt-0.5">${esc(fmtDate(r.return_date))}</div></div>
        <div class="min-w-0"><div class="font-semibold text-sm truncate">${esc(r.customer_name||'')}</div><div class="text-[10px] text-gray-400 truncate">Invoice(s): ${esc(r.original_document_no||'-')}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Action</div><div class="text-xs font-semibold mt-1">${esc(actionLabel(r.action))}</div></div>
        <div>${statusBadge(r.status)}${r.reason?`<div class="text-[10px] text-gray-400 truncate mt-1" title="${esc(r.reason)}">${esc(r.reason)}</div>`:''}</div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Net Return Value</div><div class="text-sm font-bold mt-1">${money(r.return_value)}</div><div class="text-[9px] text-gray-400">${Number(r.item_count||0)} item(s) · after discount</div></div>
        <div class="flex justify-end gap-2 flex-wrap">
          <button onclick="viewSalesReturn('${r.return_id}')" class="px-3 py-2 border rounded-lg text-xs font-semibold">View</button>
          ${canEditCN()&&r.status!=='cancelled'?`<button onclick="openEditSalesReturn('${r.return_id}')" class="px-3 py-2 border border-amber-200 bg-amber-50 text-amber-800 rounded-lg text-xs font-semibold">Edit</button>`:''}
          ${canChangeCNStatus()&&r.status==='confirmed'?`<button onclick="setSalesReturnStatus('${r.return_id}','received')" class="px-3 py-2 border border-green-200 bg-green-50 text-green-700 rounded-lg text-xs font-semibold">Received</button><button onclick="setSalesReturnStatus('${r.return_id}','cancelled')" class="px-3 py-2 border border-red-100 text-red-500 rounded-lg text-xs font-semibold">Cancel</button>`:''}
          ${canDeleteCN()?`<button onclick="deleteSalesReturn('${r.return_id}')" class="px-3 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg text-xs font-semibold">Delete</button>`:''}
        </div>
      </div>
    </div>`).join('');
  }

  window.openNewSalesReturn=async function(){
    const {data,error}=await db.rpc('get_returnable_sales_orders');if(error)return showToast(error.message,'err');
    let orders=data||[];
    if(managerContext())orders=orders.filter(x=>x.sales_rep_id===managerRepId());
    window._returnableSalesOrders=orders;
    openModal('Create Customer Return / CN',`<form id="salesReturnForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">CN Number</label><input id="returnCnNo" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Leave blank for automatic CN"><div class="text-[10px] text-gray-400 mt-1">Example: CN-00015</div></div>
      <div><label class="text-xs font-semibold">Return Date</label><input id="returnDate" type="date" value="${today()}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div class="md:col-span-2 relative">
        <label class="text-xs font-semibold">Start With Invoice / Customer</label>
        <input id="returnOrderSearch" autocomplete="off" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white" placeholder="Type TK / RK / SR number or customer name..." onfocus="showReturnOrderSuggestions(this.value)" oninput="returnOrderSearchChanged(this.value)">
        <input id="returnOrder" type="hidden">
        <div id="returnOrderSuggestions" class="hidden absolute z-[120] left-0 right-0 top-full mt-1 max-h-72 overflow-y-auto bg-white border rounded-xl shadow-xl"></div>
        <div class="text-[10px] text-gray-400 mt-1">Choose one invoice first. You can then add more invoices belonging to the same customer.</div>
      </div>
      <div class="md:col-span-2">
        <div class="flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Source Invoices</div><div class="text-[10px] text-gray-400 mt-0.5">One CN can include multiple invoices for the same customer.</div></div><div id="returnInvoiceCount" class="text-[10px] font-semibold text-gray-400"></div></div>
        <div id="returnAdditionalInvoicesArea" class="mt-2 rounded-xl border bg-gray-50 p-4 text-sm text-gray-400">Choose the first invoice above.</div>
      </div>
      <div><label class="text-xs font-semibold">Return Action</label><select id="returnAction" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="return_only">Return Only / No Refund</option><option value="return_to_stock">Return to Stock</option><option value="exchange">Exchange</option><option value="damaged_return">Damaged / Defective Return</option></select></div>
      <div><label class="text-xs font-semibold">Reason</label><input id="returnReason" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Changed model, wrong item, damaged..."></div>
      <div class="md:col-span-2 border-t pt-4"><div class="font-bold text-sm">Returned Items</div><div class="text-[10px] text-gray-400 mt-1">Only select the quantities actually coming back from the customer.</div><div id="returnItemsArea" class="mt-3 rounded-xl border bg-gray-50 p-4 text-sm text-gray-400">Select the original sale first.</div></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">CN Notes</label><textarea id="returnNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Return details, replacement instruction, warehouse note..."></textarea></div>
      <div class="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700">Return value is calculated from the net sold value after applicable line and order discounts. Creating a CN does not automatically refund the customer or change AR.</div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Create Credit Note</button>
    </form>`);
    document.getElementById('returnAction').onchange=e=>syncReturnDisposition(e.target.value);
    showReturnOrderSuggestions('');
    document.getElementById('salesReturnForm').onsubmit=saveSalesReturn;
  };

  function returnOrderLabel(o){
    return `${o.document_no||'Sale'} — ${o.customer_name||''} — ${fmtDate(o.order_date)}`;
  }

  function matchingReturnOrders(q){
    const s=String(q||'').trim().toLowerCase();
    const orders=window._returnableSalesOrders||[];
    if(!s)return orders.slice(0,30);
    return orders.filter(o=>{
      const hay=[o.document_no,o.customer_name,o.order_date,o.customer_code]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(s);
    }).slice(0,30);
  }

  window.showReturnOrderSuggestions=function(q){
    const box=document.getElementById('returnOrderSuggestions');
    if(!box)return;
    const matches=matchingReturnOrders(q);
    box.innerHTML=matches.length?matches.map(o=>`
      <button type="button" class="w-full text-left px-4 py-3 border-b last:border-b-0 hover:bg-[#faf7f0]" onclick="chooseReturnOrder('${o.order_id}')">
        <div class="font-semibold text-sm">${esc(o.document_no||'Sale')} — ${esc(o.customer_name||'')}</div>
        <div class="text-[10px] text-gray-400 mt-0.5">${esc(fmtDate(o.order_date))}</div>
      </button>`).join(''):`<div class="px-4 py-3 text-sm text-gray-400">No matching returnable sale found.</div>`;
    box.classList.remove('hidden');
  };

  window.returnOrderSearchChanged=function(q){
    const hidden=document.getElementById('returnOrder');
    if(hidden)hidden.value='';
    const root=document.getElementById('returnItemsArea');
    if(root)root.innerHTML='Select the original sale first.';
    showReturnOrderSuggestions(q);
  };

  window.chooseReturnOrder=async function(orderId){
    const order=(window._returnableSalesOrders||[]).find(o=>o.order_id===orderId);
    if(!order)return;
    const hidden=document.getElementById('returnOrder');
    const input=document.getElementById('returnOrderSearch');
    const box=document.getElementById('returnOrderSuggestions');
    if(hidden)hidden.value=orderId;
    if(input)input.value=returnOrderLabel(order);
    if(box)box.classList.add('hidden');
    await loadReturnableItems(orderId);
  };

  function syncReturnDisposition(action){
    const v=action==='return_to_stock'?'return_to_stock':action==='exchange'?'exchange':action==='damaged_return'?'damaged_hold':'no_stock_action';
    document.querySelectorAll('.return-item-disposition').forEach(x=>x.value=v);
  }

  async function loadReturnableItems(orderId){
    const root=document.getElementById('returnItemsArea');if(!root)return;
    if(!orderId){root.innerHTML='Select the original sale first.';return;}
    root.innerHTML='Loading items...';
    const {data,error}=await db.rpc('get_returnable_order_items',{p_sales_order_id:orderId});
    if(error){root.innerHTML=`<div class="text-red-500">${esc(error.message)}</div>`;return;}
    const rows=(data||[]).filter(x=>Number(x.qty_available||0)>0);
    if(!rows.length){root.innerHTML='<div class="text-amber-700">No quantity remains available for return on this sale.</div>';return;}
    const action=document.getElementById('returnAction')?.value||'return_only';
    const defaultDisp=action==='return_to_stock'?'return_to_stock':action==='exchange'?'exchange':action==='damaged_return'?'damaged_hold':'no_stock_action';
    root.innerHTML=`<div class="grid gap-2">${rows.map(x=>`<div class="sales-return-item bg-white border rounded-xl p-3" data-id="${x.sales_order_item_id}" data-max="${Number(x.qty_available||0)}">
      <div class="grid grid-cols-[30px_minmax(0,1fr)] lg:grid-cols-[30px_minmax(0,1.5fr)_100px_150px_170px] gap-3 items-center">
        <input type="checkbox" class="return-item-check w-4 h-4">
        <div class="min-w-0"><div class="font-semibold text-sm truncate">${esc(x.item_name||'Item')}</div><div class="text-[10px] text-gray-400">${esc(x.product_code||'')}${x.product_code?' • ':''}Sold ${Number(x.qty_sold||0)} • Returned ${Number(x.qty_returned||0)} • Available ${Number(x.qty_available||0)}</div></div>
        <div><label class="text-[9px] uppercase font-bold text-gray-400">Qty</label><input type="number" min="1" max="${Number(x.qty_available||0)}" step="1" value="1" class="return-item-qty mt-1 w-full border rounded-lg px-2 py-2 text-sm"></div>
        <div><label class="text-[9px] uppercase font-bold text-gray-400">Condition</label><select class="return-item-condition mt-1 w-full border rounded-lg px-2 py-2 bg-white text-xs"><option value="good">Good</option><option value="damaged">Damaged</option><option value="defective">Defective</option><option value="other">Other</option></select></div>
        <div><label class="text-[9px] uppercase font-bold text-gray-400">Handling</label><select class="return-item-disposition mt-1 w-full border rounded-lg px-2 py-2 bg-white text-xs"><option value="no_stock_action" ${defaultDisp==='no_stock_action'?'selected':''}>No Stock Action</option><option value="return_to_stock" ${defaultDisp==='return_to_stock'?'selected':''}>Return to Stock</option><option value="damaged_hold" ${defaultDisp==='damaged_hold'?'selected':''}>Damaged Hold</option><option value="exchange" ${defaultDisp==='exchange'?'selected':''}>Exchange</option></select></div>
      </div>
      <input class="return-item-note mt-2 w-full border rounded-lg px-3 py-2 text-xs" placeholder="Item return note (optional)">
    </div>`).join('')}</div>`;
  }

  async function saveSalesReturn(e){
    e.preventDefault();
    const orderId=document.getElementById('returnOrder').value;
    if(!orderId)return showToast('Select the original sale.','err');
    const selected=[...document.querySelectorAll('.sales-return-item')].filter(r=>r.querySelector('.return-item-check')?.checked);
    if(!selected.length)return showToast('Select at least one returned item.','err');
    const items=[];
    for(const r of selected){
      const qty=Number(r.querySelector('.return-item-qty').value||0),max=Number(r.dataset.max||0);
      if(qty<=0||qty>max)return showToast(`Return quantity must be between 1 and ${max}.`,'err');
      items.push({sales_order_item_id:r.dataset.id,qty,condition:r.querySelector('.return-item-condition').value,disposition:r.querySelector('.return-item-disposition').value,notes:r.querySelector('.return-item-note').value.trim()||null});
    }
    const btn=e.target.querySelector('button');if(btn){btn.disabled=true;btn.textContent='Creating CN...'}
    const {data,error}=await db.rpc('create_sales_return',{p_sales_order_id:orderId,p_cn_no:document.getElementById('returnCnNo').value.trim()||null,p_return_date:document.getElementById('returnDate').value,p_action:document.getElementById('returnAction').value,p_reason:document.getElementById('returnReason').value.trim()||null,p_notes:document.getElementById('returnNotes').value.trim()||null,p_items:items});
    if(error){if(btn){btn.disabled=false;btn.textContent='Create Credit Note'}return showToast(error.message,'err')}
    const out=Array.isArray(data)?data[0]:data;closeModal();showToast(`${out?.cn_no||'Credit Note'} created`);await renderReturnsPage();
  }

  window.viewSalesReturn=async function(id){
    const h=(window._visibleSalesReturns||[]).find(x=>x.return_id===id);
    const {data,error}=await db.rpc('get_sales_return_items_detail',{p_return_id:id});if(error)return showToast(error.message,'err');
    const items=data||[];
    openModal(h?.cn_no||'Credit Note',`<div class="space-y-4">
      <div class="grid grid-cols-2 lg:grid-cols-5 gap-3 rounded-xl border bg-[#faf9f6] p-4">
        <div><div class="text-[9px] uppercase font-bold text-gray-400">CN</div><div class="font-bold mt-1">${esc(h?.cn_no||'-')}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Original</div><div class="font-semibold mt-1">${esc(h?.original_document_no||'-')}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Customer</div><div class="font-semibold mt-1">${esc(h?.customer_name||'-')}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Return Date</div><div class="font-semibold mt-1">${esc(fmtDate(h?.return_date))}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Status</div><div class="mt-1">${statusBadge(h?.status)}</div></div>
      </div>
      <div class="grid sm:grid-cols-2 gap-3"><div class="border rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Action</div><div class="font-semibold mt-1">${esc(actionLabel(h?.action))}</div></div><div class="border rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Net Return Value</div><div class="font-bold mt-1">${money(h?.return_value||0)}</div><div class="text-[9px] text-gray-400">After line + order discounts · no automatic refund</div></div></div>
      ${h?.reason?`<div class="border rounded-xl p-3"><div class="text-[9px] uppercase font-bold text-gray-400">Reason</div><div class="text-sm mt-1">${esc(h.reason)}</div></div>`:''}
      <div><div class="font-bold text-sm mb-2">Returned Items</div><div class="grid gap-2">${items.map(x=>{const gross=Number(x.qty||0)*Number(x.unit_price||0),net=Number(x.return_value||0),discount=Math.max(gross-net,0);return `<div class="border rounded-xl p-3 bg-white"><div class="flex flex-col md:flex-row md:justify-between gap-3"><div><div class="font-semibold">${esc(x.item_name||'Item')}</div><div class="text-[10px] text-gray-400">${esc(x.product_code||'')}</div>${x.notes?`<div class="text-[10px] text-gray-500 mt-1">${esc(x.notes)}</div>`:''}</div><div class="flex flex-wrap gap-5"><div><div class="text-[9px] uppercase font-bold text-gray-400">Returned</div><b>${Number(x.qty||0)} of ${Number(x.qty_sold||0)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Gross Value</div><b>${money(gross)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Discount Applied</div><b class="text-amber-700">−${money(discount)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Net Return Value</div><b>${money(net)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Condition</div><b>${esc(conditionLabel(x.condition))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Handling</div><b>${esc(dispositionLabel(x.disposition))}</b></div></div></div></div>`}).join('')}</div></div>
      ${h?.notes?`<div class="rounded-xl border bg-gray-50 p-3"><div class="text-[9px] uppercase font-bold text-gray-400">CN Notes</div><div class="text-sm mt-1">${esc(h.notes)}</div></div>`:''}
      <div class="rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700">This CN records the return only. Customer payments and AR are not automatically changed.</div>
      <div class="flex justify-end gap-2 flex-wrap">
        ${canEditCN()&&h?.status!=='cancelled'?`<button onclick="openEditSalesReturn('${id}')" class="px-4 py-2 border border-amber-200 bg-amber-50 text-amber-800 rounded-lg text-xs font-semibold">Edit CN</button>`:''}
        ${canDeleteCN()?`<button onclick="deleteSalesReturn('${id}')" class="px-4 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg text-xs font-semibold">Delete CN</button>`:''}
      </div>
    </div>`);
  };

  window.openEditSalesReturn=async function(id){
    if(!canEditCN())return showToast('You do not have permission to edit Credit Notes.','err');
    const h=(window._visibleSalesReturns||[]).find(x=>x.return_id===id);
    if(!h)return showToast('Credit Note not found.','err');
    if(h.status==='cancelled')return showToast('Cancelled Credit Notes cannot be edited.','err');

    const {data,error}=await db.rpc('get_sales_return_items_detail',{p_return_id:id});
    if(error)return showToast(error.message,'err');
    const items=data||[];
    const condOptions=['good','damaged','defective','other'];
    const dispOptions=['no_stock_action','return_to_stock','damaged_hold','exchange'];

    openModal(`Edit ${h.cn_no||'Credit Note'}`,`
      <form id="editSalesReturnForm" class="grid md:grid-cols-2 gap-4">
        <div><label class="text-xs font-semibold">CN Number</label><input value="${esc(h.cn_no||'')}" disabled class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-gray-50 text-gray-500"></div>
        <div><label class="text-xs font-semibold">Original Sale</label><input value="${esc(h.original_document_no||'')}" disabled class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-gray-50 text-gray-500"></div>
        <div><label class="text-xs font-semibold">Return Date</label><input id="editReturnDate" type="date" value="${esc(h.return_date||today())}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
        <div><label class="text-xs font-semibold">Return Action</label><select id="editReturnAction" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="return_only" ${h.action==='return_only'?'selected':''}>Return Only / No Refund</option><option value="return_to_stock" ${h.action==='return_to_stock'?'selected':''}>Return to Stock</option><option value="exchange" ${h.action==='exchange'?'selected':''}>Exchange</option><option value="damaged_return" ${h.action==='damaged_return'?'selected':''}>Damaged / Defective Return</option></select></div>
        <div class="md:col-span-2"><label class="text-xs font-semibold">Reason</label><input id="editReturnReason" value="${esc(h.reason||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Reason for return"></div>

        <div class="md:col-span-2 border-t pt-4">
          <div class="font-bold text-sm">Returned Items</div>
          <div class="text-[10px] text-gray-400 mt-1">Change the returned quantity here. Example: if 3 were sold and only 1 came back, enter 1. Enter 0 to remove an item from this CN.</div>
          <div class="grid gap-2 mt-3">
            ${items.map(x=>`<div class="edit-return-item border rounded-xl p-3 bg-white" data-sales-order-item-id="${x.sales_order_item_id}" data-max="${Number(x.max_edit_qty||0)}">
              <div class="grid lg:grid-cols-[minmax(0,1.5fr)_110px_150px_180px] gap-3 items-end">
                <div><div class="font-semibold text-sm">${esc(x.item_name||'Item')}</div><div class="text-[10px] text-gray-400">${esc(x.product_code||'')} · Sold ${Number(x.qty_sold||0)} · Other CN returns ${Number(x.qty_returned_other||0)} · Max for this CN ${Number(x.max_edit_qty||0)}</div></div>
                <div><label class="text-[9px] uppercase font-bold text-gray-400">Return Qty</label><input class="edit-return-qty mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" max="${Number(x.max_edit_qty||0)}" step="1" value="${Number(x.qty||0)}"></div>
                <div><label class="text-[9px] uppercase font-bold text-gray-400">Condition</label><select class="edit-return-condition mt-1 w-full border rounded-lg px-2 py-2 bg-white">${condOptions.map(v=>`<option value="${v}" ${x.condition===v?'selected':''}>${conditionLabel(v)}</option>`).join('')}</select></div>
                <div><label class="text-[9px] uppercase font-bold text-gray-400">Handling</label><select class="edit-return-disposition mt-1 w-full border rounded-lg px-2 py-2 bg-white">${dispOptions.map(v=>`<option value="${v}" ${x.disposition===v?'selected':''}>${dispositionLabel(v)}</option>`).join('')}</select></div>
              </div>
              <input class="edit-return-note mt-2 w-full border rounded-lg px-3 py-2 text-xs" value="${esc(x.notes||'')}" placeholder="Item return note (optional)">
            </div>`).join('')}
          </div>
        </div>

        <div class="md:col-span-2"><label class="text-xs font-semibold">CN Notes</label><textarea id="editReturnNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5">${esc(h.notes||'')}</textarea></div>
        <div class="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700">Editing the CN changes only the return record. It does not delete the original sale or automatically change customer payments / AR.</div>
        <div class="md:col-span-2 flex justify-between gap-2 flex-wrap">
          ${canDeleteCN()?`<button type="button" onclick="deleteSalesReturn('${id}')" class="px-4 py-2 border border-red-200 bg-red-50 text-red-600 rounded-lg text-xs font-semibold">Delete CN</button>`:'<span></span>'}
          <div class="flex gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 border rounded-lg text-xs">Cancel</button><button class="px-5 py-2 bg-[#211d18] text-white rounded-lg text-xs font-semibold">Save CN Changes</button></div>
        </div>
      </form>`);

    document.getElementById('editSalesReturnForm').onsubmit=async e=>{
      e.preventDefault();
      const rows=[...document.querySelectorAll('.edit-return-item')];
      const payload=[];
      for(const r of rows){
        const qty=Number(r.querySelector('.edit-return-qty').value||0);
        const max=Number(r.dataset.max||0);
        if(qty<0||qty>max)return showToast(`Return quantity must be between 0 and ${max}.`,'err');
        payload.push({
          sales_order_item_id:r.dataset.salesOrderItemId,
          qty,
          condition:r.querySelector('.edit-return-condition').value,
          disposition:r.querySelector('.edit-return-disposition').value,
          notes:r.querySelector('.edit-return-note').value.trim()||null
        });
      }
      if(!payload.some(x=>x.qty>0))return showToast('A Credit Note must contain at least one returned item.','err');
      const btn=e.target.querySelector('button[type="submit"]');if(btn){btn.disabled=true;btn.textContent='Saving...'}
      const res=await db.rpc('update_sales_return',{
        p_return_id:id,
        p_return_date:document.getElementById('editReturnDate').value,
        p_action:document.getElementById('editReturnAction').value,
        p_reason:document.getElementById('editReturnReason').value.trim()||null,
        p_notes:document.getElementById('editReturnNotes').value.trim()||null,
        p_items:payload
      });
      if(res.error){if(btn){btn.disabled=false;btn.textContent='Save CN Changes'}return showToast(res.error.message,'err')}
      closeModal();showToast('Credit Note updated');await renderReturnsPage();
    };
  };

  window.deleteSalesReturn=async function(id){
    if(!canDeleteCN())return showToast('Only Admin or Super Admin can delete a Credit Note.','err');
    const h=(window._visibleSalesReturns||[]).find(x=>x.return_id===id);
    const label=h?.cn_no||'this Credit Note';
    if(!confirm(`Delete ${label}?\n\nThis removes the CN and its returned-item records only. The original sale, products and payments remain unchanged. Returned quantities from this CN become available to return again.\n\nThis cannot be undone.`))return;
    const {data,error}=await db.rpc('delete_sales_return',{p_return_id:id});
    if(error)return showToast(error.message,'err');
    closeModal();showToast(`${data||label} deleted`);await renderReturnsPage();
  };

  window.setSalesReturnStatus=async function(id,status){
    const msg=status==='received'?'Mark this CN as physically received?':'Cancel this Credit Note?';if(!confirm(msg))return;
    const {error}=await db.rpc('update_sales_return_status',{p_return_id:id,p_status:status});if(error)return showToast(error.message,'err');
    showToast(status==='received'?'Return marked as received':'Credit Note cancelled');await renderReturnsPage();
  };

  // Re-render navigation now that navItems includes Returns / CN.
  try{if(state?.profile)renderNav()}catch(_e){}
})();