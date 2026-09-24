// Bottom Add Item buttons + quantity-level item status tracking.
// Allows one sales line (e.g. Qty 3) to have mixed statuses such as Installed 1 + Ready 2.
(function(){
  const statusOptions=['ordered','production','shipping','arrived','delivered'];
  const terminalStatuses=new Set(['delivered']);

  function canEdit(){return ['sales','manager','admin','super_admin'].includes(state.profile?.role||'')}
  function norm(v){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function canonical(v){const s=norm(v);return s==='pending'||s==='reserved'?'ordered':s==='ready'?'arrived':s==='installed'?'delivered':s}\n  function label(v){return titleCase(canonical(v)||'Ordered')}
  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function allOrders(){return [...(window.trackingRedesign?.salesOrders||[]),...(window.trackingRedesign?.trackingOrders||[])]}

  // ---------------------------------------------------------
  // Add Item button at BOTH the top and bottom of long forms.
  // ---------------------------------------------------------
  function injectBottomAddButtons(){
    const editItems=document.getElementById('editOrderItems');
    if(editItems&&!document.getElementById('editOrderBottomAddItem')){
      const d=document.createElement('div');
      d.id='editOrderBottomAddItem';
      d.className='mt-3';
      d.innerHTML='<button type="button" onclick="addEditOrderItem()" class="w-full border border-dashed border-[#d8c28a] bg-[#fffdf7] text-[#8a6818] rounded-xl px-4 py-3 text-sm font-semibold hover:bg-amber-50">+ Add Another Item</button>';
      editItems.insertAdjacentElement('afterend',d);
    }

    const newItems=document.getElementById('orderItems');
    if(newItems&&!document.getElementById('newOrderBottomAddItem')){
      const d=document.createElement('div');
      d.id='newOrderBottomAddItem';
      d.className='mt-3';
      d.innerHTML='<button type="button" onclick="addOrderItemRow()" class="w-full border border-dashed border-[#d8c28a] bg-[#fffdf7] text-[#8a6818] rounded-xl px-4 py-3 text-sm font-semibold hover:bg-amber-50">+ Add Another Item</button>';
      newItems.insertAdjacentElement('afterend',d);
    }
  }

  const baseEditOrder=window.openEditSalesOrder;
  if(typeof baseEditOrder==='function')window.openEditSalesOrder=async function(){
    const r=await baseEditOrder.apply(this,arguments);setTimeout(injectBottomAddButtons,0);return r;
  };

  const baseNewOrder=window.openNewOrder;
  if(typeof baseNewOrder==='function')window.openNewOrder=async function(){
    const r=await baseNewOrder.apply(this,arguments);setTimeout(injectBottomAddButtons,0);return r;
  };

  // ---------------------------------------------------------
  // Flexible status allocation UI.
  // ---------------------------------------------------------
  async function loadStatusOrder(orderId){
    const {data,error}=await db.from('sales_orders').select(`
      id,order_no,invoice_no,sr_no,sales_invoice_no,customer_id,customers(name),
      sales_order_items(id,product_code_snapshot,item_name_snapshot,qty,fulfillment_status)
    `).eq('id',orderId).single();
    if(error)throw error;
    return {...data,customer_name:data.customers?.name||'',items:data.sales_order_items||[]};
  }

  function statusOptionsHtml(selected){
    const current=canonical(selected);\n    const legacy=norm(selected)==='cancelled'?'<option value="cancelled" selected disabled>Cancelled (historical)</option>':'';\n    return legacy+statusOptions.map(s=>`<option value="${s}" ${current===s?'selected':''}>${label(s)}</option>`).join('');
  }

  function allocationRow(a={status:'ordered',qty:1}){
    return `<div class="flex-status-row grid grid-cols-[minmax(0,1fr)_120px_42px] gap-2 items-end">
      <div><label class="text-[9px] uppercase font-bold text-gray-400">Status</label><select class="flex-status-select mt-1 w-full border rounded-lg px-3 py-2 bg-white text-xs" onchange="flexStatusRecalc(this.closest('.flex-status-card'))">${statusOptionsHtml(a.status)}</select></div>
      <div><label class="text-[9px] uppercase font-bold text-gray-400">Qty</label><input class="flex-status-qty mt-1 w-full border rounded-lg px-3 py-2 text-xs" type="number" min="0.01" step="0.01" value="${Number(a.qty||0)}" oninput="flexStatusRecalc(this.closest('.flex-status-card'))"></div>
      <button type="button" onclick="removeFlexStatusRow(this)" class="h-[38px] border rounded-lg text-red-500 font-bold">×</button>
    </div>`;
  }

  function cardSummaryHtml(item,allocs){
    const total=Number(item.qty||0);
    return `<div class="flex-status-card rounded-xl border p-4" data-item-id="${item.id}" data-total="${total}">
      <div class="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mb-3">
        <div><div class="font-bold text-sm">${esc(item.product_code_snapshot||'No Code')} · ${esc(item.item_name_snapshot||'Item')}</div><div class="text-[10px] text-gray-400 mt-1">Total Qty ${total}</div></div>
        <div class="flex items-center gap-2"><span class="flex-status-total text-[10px] font-bold px-2 py-1 rounded-lg bg-green-50 text-green-700 border border-green-200">Assigned ${total} / ${total}</span><button type="button" onclick="addFlexStatusRow(this.closest('.flex-status-card'))" class="px-3 py-1.5 rounded-lg border text-[10px] font-bold">+ Split Status</button></div>
      </div>
      <div class="flex-status-rows grid gap-2">${allocs.map(allocationRow).join('')}</div>
      <div class="flex-status-preview mt-3 flex flex-wrap gap-1"></div>
    </div>`;
  }

  window.flexStatusRecalc=function(card){
    if(!card)return;
    const total=Number(card.dataset.total||0);
    const rows=[...card.querySelectorAll('.flex-status-row')];
    let assigned=0;const counts=new Map();
    rows.forEach(r=>{
      const q=Math.max(Number(r.querySelector('.flex-status-qty')?.value||0),0);
      const s=r.querySelector('.flex-status-select')?.value||'ordered';
      assigned+=q;counts.set(s,round2((counts.get(s)||0)+q));
    });
    assigned=round2(assigned);
    const ok=Math.abs(assigned-total)<0.0001;
    const t=card.querySelector('.flex-status-total');
    if(t){t.textContent=`Assigned ${assigned} / ${total}`;t.className=`flex-status-total text-[10px] font-bold px-2 py-1 rounded-lg border ${ok?'bg-green-50 text-green-700 border-green-200':'bg-red-50 text-red-700 border-red-200'}`;}
    const p=card.querySelector('.flex-status-preview');
    if(p)p.innerHTML=[...counts.entries()].filter(([,q])=>q>0).map(([s,q])=>`<span class="px-2 py-1 rounded-md text-[9px] font-bold border ${terminalStatuses.has(s)?'bg-green-50 border-green-200 text-green-700':s==='cancelled'?'bg-gray-50 border-gray-200 text-gray-500':'bg-amber-50 border-amber-200 text-amber-800'}">${label(s)} ${q}</span>`).join('');
    return ok;
  };

  window.addFlexStatusRow=function(card){
    if(!card)return;
    const total=Number(card.dataset.total||0),rows=[...card.querySelectorAll('.flex-status-row')];
    if(rows.length>=statusOptions.length)return showToast('All available statuses are already listed.','err');
    const largest=rows.sort((a,b)=>Number(b.querySelector('.flex-status-qty').value||0)-Number(a.querySelector('.flex-status-qty').value||0))[0];
    const largestQty=Number(largest?.querySelector('.flex-status-qty')?.value||0);
    if(largestQty<=0.01||total<=0.01)return showToast('There is no quantity available to split.','err');
    const used=new Set([...card.querySelectorAll('.flex-status-select')].map(x=>x.value));
    const next=statusOptions.find(s=>!used.has(s))||'ordered';
    const move=largestQty>1?1:round2(largestQty/2);
    if(move<=0)return showToast('There is no quantity available to split.','err');
    largest.querySelector('.flex-status-qty').value=round2(largestQty-move);
    card.querySelector('.flex-status-rows').insertAdjacentHTML('beforeend',allocationRow({status:next,qty:move}));
    flexStatusRecalc(card);
  };

  window.removeFlexStatusRow=function(btn){
    const card=btn.closest('.flex-status-card'),row=btn.closest('.flex-status-row');if(!card||!row)return;
    const rows=[...card.querySelectorAll('.flex-status-row')];
    if(rows.length<=1)return showToast('Each item needs at least one status.','err');
    const qty=Number(row.querySelector('.flex-status-qty')?.value||0);
    const other=rows.find(r=>r!==row);
    if(other)other.querySelector('.flex-status-qty').value=round2(Number(other.querySelector('.flex-status-qty').value||0)+qty);
    row.remove();flexStatusRecalc(card);
  };

  window.openItemStatusManager=async function(orderId){
    if(!canEdit())return showToast('You do not have permission to update item status.','err');
    try{
      const [o,br]=await Promise.all([loadStatusOrder(orderId),db.rpc('get_sales_item_status_quantities',{p_sales_order_id:orderId})]);
      if(br.error)throw br.error;
      window._flexStatusOrder=o;
      const map=new Map();
      for(const x of br.data||[]){if(!map.has(x.sales_order_item_id))map.set(x.sales_order_item_id,[]);map.get(x.sales_order_item_id).push({status:x.status,qty:Number(x.qty||0)});}
      const doc=o.sales_invoice_no||o.sr_no||o.invoice_no||o.order_no||'Order';
      openModal('Update Item Tracking',`
        <form id="itemStatusForm" class="space-y-4">
          <div class="rounded-xl border bg-gray-50 p-4"><div class="text-[10px] uppercase font-bold text-gray-400">Order / Invoice</div><div class="font-bold mt-1">${esc(doc)}</div><div class="text-xs text-gray-500 mt-1">${esc(o.customer_name||'')}</div></div>
          <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Flexible quantity status:</b> one product line can now be split. Example: Qty 3 = <b>Shipping 1</b> + <b>Arrived 2</b>. The quantities must always add up to the sold quantity.</div>
          <div class="grid gap-3">${(o.items||[]).map(i=>cardSummaryHtml(i,map.get(i.id)||[{status:canonical(i.fulfillment_status)||'ordered',qty:Number(i.qty||0)}])).join('')}</div>
          <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Item Status</button>
        </form>`);
      document.querySelectorAll('.flex-status-card').forEach(flexStatusRecalc);
      document.getElementById('itemStatusForm').onsubmit=saveItemStatuses;
    }catch(e){showToast(e.message||'Could not load item status','err')}
  };

  window.saveItemStatuses=async function(e){
    e.preventDefault();
    const o=window._flexStatusOrder;if(!o)return;
    const payload=[];
    for(const card of document.querySelectorAll('.flex-status-card')){
      if(!flexStatusRecalc(card))return showToast('Each item status quantity must add up exactly to the item quantity.','err');
      const allocations=[...card.querySelectorAll('.flex-status-row')].map(r=>({status:r.querySelector('.flex-status-select').value,qty:Number(r.querySelector('.flex-status-qty').value||0)})).filter(x=>x.qty>0);
      payload.push({sales_order_item_id:card.dataset.itemId,allocations});
    }
    const {error}=await db.rpc('save_sales_item_status_quantities',{p_sales_order_id:o.id,p_items:payload});
    if(error)return showToast(error.message,'err');
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    closeModal();showToast('Item tracking updated');
    await go(state.page==='tracking'?'tracking':'sales-orders');
  };

  // ---------------------------------------------------------
  // Show mixed-quantity statuses on Sales Tracking / Tracking.
  // ---------------------------------------------------------
  async function loadExplicitBreakdowns(){
    const {data,error}=await db.from('sales_item_status_quantities').select('sales_order_item_id,status,qty').order('status');
    if(error){console.warn('Status breakdown unavailable:',error.message);return new Map();}
    const map=new Map();for(const x of data||[]){if(!map.has(x.sales_order_item_id))map.set(x.sales_order_item_id,[]);map.get(x.sales_order_item_id).push(x)}return map;
  }

  function breakdownHtml(rows){
    return `<div class="flex-status-summary mt-1.5 flex flex-wrap gap-1">${rows.map(x=>`<span class="px-1.5 py-0.5 rounded-md text-[9px] font-bold border ${terminalStatuses.has(norm(x.status))?'bg-green-50 border-green-200 text-green-700':norm(x.status)==='cancelled'?'bg-gray-50 border-gray-200 text-gray-500':'bg-amber-50 border-amber-200 text-amber-800'}">${label(norm(x.status))} ${Number(x.qty||0)}</span>`).join('')}</div>`;
  }

  function decorateRow(row,item,parts){
    if(!row||!item||!parts||parts.length<=1)return;
    row.querySelector('.flex-status-summary')?.remove();
    const target=row.querySelector('.min-w-0')||row.children?.[1]||row;
    target.insertAdjacentHTML('beforeend',breakdownHtml(parts));
    const expected=norm(item.fulfillment_status);
    [...row.querySelectorAll('.lr-badge')].forEach(b=>{if(norm(b.textContent)===expected)b.style.display='none'});
  }

  async function decorateMixedStatuses(){
    const map=await loadExplicitBreakdowns();if(!map.size)return;

    for(const o of window.trackingRedesign?.salesOrders||[]){
      const trigger=document.querySelector(`button[onclick="toggleSalesInvoice('${o.id}')"]`);
      const card=trigger?.closest('.lr-order-card');if(!card)continue;
      const rows=[...card.querySelectorAll('.lr-item-row')];
      (o.items||[]).forEach((item,idx)=>decorateRow(rows[idx],item,map.get(item.id)));
    }

    for(const o of window.trackingRedesign?.trackingOrders||[]){
      let wrap=document.getElementById('track-order-'+o.id)?.querySelector('.lr-track-order');
      if(!wrap){wrap=[...document.querySelectorAll('#orderTrackingRoot .lr-track-order')].find(x=>x.textContent.includes(o.order_no||o.invoice_no||''));}
      const rows=[...(wrap?.querySelectorAll('.lr-track-item')||[])];
      (o.items||[]).forEach((item,idx)=>decorateRow(rows[idx],item,map.get(item.id)));
    }
  }

  const baseSalesBody=window.renderSalesTrackingBody;
  if(typeof baseSalesBody==='function')window.renderSalesTrackingBody=function(){const r=baseSalesBody.apply(this,arguments);setTimeout(decorateMixedStatuses,40);return r};
  const baseSalesPage=window.renderSalesOrders;
  if(typeof baseSalesPage==='function')window.renderSalesOrders=async function(){const r=await baseSalesPage.apply(this,arguments);setTimeout(decorateMixedStatuses,50);return r};
  const baseTrackBody=window.renderOrderTrackingBody;
  if(typeof baseTrackBody==='function')window.renderOrderTrackingBody=function(){const r=baseTrackBody.apply(this,arguments);setTimeout(decorateMixedStatuses,40);return r};
  const baseTrackPage=window.renderTracking;
  if(typeof baseTrackPage==='function')window.renderTracking=async function(){const r=await baseTrackPage.apply(this,arguments);setTimeout(decorateMixedStatuses,50);return r};
})();