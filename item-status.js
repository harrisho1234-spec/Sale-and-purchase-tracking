// Item delivery / installation status controls.
// Loaded last so Installed is treated as a completed tracking state.
(function(){
  const terminalStatuses=new Set(['delivered']);
  const statusOptions=['ordered','production','shipping','arrived','delivered'];
  function canEdit(){return ['sales','manager','admin','super_admin'].includes(state.profile?.role||'')}
  function norm(v){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function canonical(v){const s=norm(v);return s==='pending'||s==='reserved'?'ordered':s==='ready'?'arrived':s==='installed'?'delivered':s}\n  function label(v){return titleCase(canonical(v)||'Ordered')}
  function allOrders(){return [...(window.trackingRedesign?.salesOrders||[]),...(window.trackingRedesign?.trackingOrders||[])]}
  function findOrder(id){return allOrders().find(o=>o.id===id)}

  async function loadOrder(id){
    const local=findOrder(id);if(local?.items?.length)return local;
    const {data,error}=await db.from('sales_orders').select(`id,order_no,invoice_no,sr_no,sales_invoice_no,customer_id,customers(name),sales_order_items(id,product_code_snapshot,item_name_snapshot,qty,fulfillment_status)`).eq('id',id).single();
    if(error)throw error;
    return {...data,customer_name:data.customers?.name||'',items:data.sales_order_items||[]};
  }

  window.openItemStatusManager=async function(orderId){
    if(!canEdit())return showToast('You do not have permission to update item status.','err');
    try{
      const o=await loadOrder(orderId);window._statusOrder=o;
      const doc=o.sales_invoice_no||o.sr_no||o.invoice_no||o.order_no||'Order';
      openModal('Update Item Tracking',`
        <form id="itemStatusForm" class="space-y-4">
          <div class="rounded-xl border bg-gray-50 p-4"><div class="text-[10px] uppercase font-bold text-gray-400">Order / Invoice</div><div class="font-bold mt-1">${esc(doc)}</div><div class="text-xs text-gray-500 mt-1">${esc(o.customer_name||'')}</div></div>
          <div class="rounded-xl border border-green-100 bg-green-50 p-3 text-xs text-green-800">Use the simplified progress flow: <b>Ordered → Production → Shipping → Arrived → Delivered</b>.</div>
          <div class="grid gap-3">${(o.items||[]).map(i=>`<div class="grid md:grid-cols-[1fr_210px] gap-3 items-center rounded-xl border p-3"><div><div class="font-bold text-sm">${esc(i.product_code_snapshot||'No Code')} · ${esc(i.item_name_snapshot||'Item')}</div><div class="text-[10px] text-gray-400 mt-1">Qty ${Number(i.qty||0)}</div></div><select class="item-status-select border rounded-xl px-3 py-2 bg-white" data-item-id="${i.id}">${statusOptions.map(s=>`<option value="${s}" ${canonical(i.fulfillment_status)===s?'selected':''}>${label(s)}</option>`).join('')}</select></div>`).join('')}</div>
          <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Item Status</button>
        </form>`);
      document.getElementById('itemStatusForm').onsubmit=saveItemStatuses;
    }catch(e){showToast(e.message,'err')}
  };

  window.saveItemStatuses=async function(e){
    e.preventDefault();
    const o=window._statusOrder;if(!o)return;
    const now=new Date().toISOString();
    for(const sel of document.querySelectorAll('.item-status-select')){
      const id=sel.dataset.itemId,status=sel.value;
      const up=await db.from('sales_order_items').update({fulfillment_status:status}).eq('id',id);
      if(up.error)return showToast(up.error.message,'err');
      const trackingStatus=status;
      const tr={sales_order_item_id:id,status:trackingStatus,updated_by:state.user.id,updated_at:now,delivered_at:terminalStatuses.has(status)?now:null};
      const tu=await db.from('item_tracking').upsert(tr,{onConflict:'sales_order_item_id'});
      if(tu.error)return showToast(tu.error.message,'err');
      for(const order of allOrders()){
        const item=(order.items||[]).find(x=>x.id===id);if(item)item.fulfillment_status=status;
      }
    }
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    closeModal();showToast('Item tracking updated');
    await go(state.page==='tracking'?'tracking':'sales-orders');
  };

  function addSalesButtons(){
    if(!canEdit()||!window.trackingRedesign?.salesOrders)return;
    for(const o of window.trackingRedesign.salesOrders){
      const trigger=document.querySelector(`button[onclick="toggleSalesInvoice('${o.id}')"]`);
      const card=trigger?.closest('.lr-order-card');if(!card||card.querySelector(`.item-status-btn[data-order-id="${o.id}"]`))continue;
      const right=card.querySelector('.lr-order-main > div:last-child');if(!right)continue;
      const b=document.createElement('button');b.className='item-status-btn col-span-2 justify-self-end px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-green-800 text-[10px] font-bold';b.dataset.orderId=o.id;b.textContent='Update Item Status';b.onclick=()=>openItemStatusManager(o.id);right.appendChild(b);
      if((o.items||[]).length&&o.items.every(i=>terminalStatuses.has(norm(i.fulfillment_status)))){
        const flow=card.querySelector('.document-flow-panel');const last=flow?.querySelector('.flex.gap-2.overflow-x-auto > div:last-child');if(last){last.classList.remove('bg-gray-50','border-gray-200');last.classList.add('bg-green-50','border-green-200');const t=last.querySelector('div');if(t){t.className='text-[9px] font-extrabold uppercase text-green-700';t.textContent='✓ Delivered';}}
      }
      card.querySelectorAll('.lr-item-row').forEach(row=>{const txt=row.textContent.toLowerCase();if(txt.includes('installed')){const badges=[...row.querySelectorAll('.lr-badge')];const badge=badges.find(x=>x.textContent.trim().toLowerCase()==='installed');if(badge){badge.classList.remove('lr-badge-amber','lr-badge-gray','lr-badge-blue');badge.classList.add('lr-badge-green');}}});
    }
  }

  function temporarilyMapInstalled(list){
    const changed=[];(list||[]).forEach(o=>(o.items||[]).forEach(i=>{if(norm(i.fulfillment_status)==='installed'){changed.push(i);i.fulfillment_status='delivered'}}));return ()=>changed.forEach(i=>i.fulfillment_status='installed');
  }

  function decorateTracking(){
    if(!canEdit())return;
    for(const o of window.trackingRedesign?.trackingOrders||[]){
      let wrap=document.getElementById('track-order-'+o.id)?.querySelector('.lr-track-order');
      if(!wrap){wrap=[...document.querySelectorAll('#orderTrackingRoot .lr-track-order')].find(x=>x.textContent.includes(o.order_no||o.invoice_no||''));}
      const head=wrap?.querySelector('.lr-track-order-head');if(head&&!head.querySelector('.item-status-btn')){const right=head.lastElementChild;const b=document.createElement('button');b.className='item-status-btn mt-2 px-3 py-2 rounded-lg border border-green-200 bg-green-50 text-green-800 text-[10px] font-bold';b.textContent='Update Item Status';b.onclick=e=>{e.stopPropagation();openItemStatusManager(o.id)};right?.appendChild(b);}
    }
    document.querySelectorAll('#orderTrackingRoot .lr-track-item').forEach(row=>{for(const o of window.trackingRedesign?.trackingOrders||[]){const item=(o.items||[]).find(i=>i.product_code_snapshot&&row.textContent.includes(i.product_code_snapshot)&&terminalStatuses.has(norm(i.fulfillment_status)));if(!item)continue;const badges=[...row.querySelectorAll('.lr-badge')];const stage=badges.find(x=>x.textContent.includes('Arrived / Completed'));if(stage){stage.textContent=label(item.fulfillment_status);stage.classList.remove('lr-badge-gray','lr-badge-blue','lr-badge-amber');stage.classList.add('lr-badge-green');}break;}});
  }

  const baseSales=window.renderSalesTrackingBody;
  if(typeof baseSales==='function')window.renderSalesTrackingBody=function(){const r=baseSales.apply(this,arguments);setTimeout(addSalesButtons,20);return r};
  const baseSalesPage=window.renderSalesOrders;
  if(typeof baseSalesPage==='function')window.renderSalesOrders=async function(){const r=await baseSalesPage.apply(this,arguments);setTimeout(addSalesButtons,20);return r};
  const baseTrack=window.renderOrderTrackingBody;
  if(typeof baseTrack==='function')window.renderOrderTrackingBody=function(){const restore=temporarilyMapInstalled(window.trackingRedesign?.trackingOrders);const r=baseTrack.apply(this,arguments);restore();setTimeout(decorateTracking,0);return r};
  const baseTrackPage=window.renderTracking;
  if(typeof baseTrackPage==='function')window.renderTracking=async function(){const r=await baseTrackPage.apply(this,arguments);setTimeout(decorateTracking,20);return r};
})();