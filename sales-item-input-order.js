// Preserve sales item display order exactly as entered by the user.
// Database stores line_position; this file applies it across edit, tracking and status UIs.
(function(){
  async function fetchPositions(orderIds){
    const ids=[...new Set((orderIds||[]).filter(Boolean))];
    const map=new Map();
    for(let i=0;i<ids.length;i+=100){
      const chunk=ids.slice(i,i+100);
      const {data,error}=await db.from('sales_order_items').select('id,sales_order_id,line_position').in('sales_order_id',chunk);
      if(error){console.warn('Could not load item order:',error.message);continue;}
      for(const row of data||[]) map.set(row.id,Number(row.line_position||999999));
    }
    return map;
  }

  function sortItems(items,pos){
    return (items||[])
      .map((item,index)=>({item,index}))
      .sort((a,b)=>{
        const pa=pos.has(a.item.id)?pos.get(a.item.id):999999;
        const pb=pos.has(b.item.id)?pos.get(b.item.id):999999;
        return pa-pb||a.index-b.index;
      })
      .map(x=>x.item);
  }

  async function sortTrackingData(){
    const ui=window.trackingRedesign;
    if(!ui)return;
    const all=[...(ui.salesOrders||[]),...(ui.trackingOrders||[])];
    const pos=await fetchPositions(all.map(o=>o.id));
    for(const o of all){if(Array.isArray(o.items))o.items=sortItems(o.items,pos);}
    if(Array.isArray(ui.salesOrders))ui.salesItems=ui.salesOrders.flatMap(o=>(o.items||[]).map(i=>({...i,order:o})));
  }

  async function reorderEditRows(orderId){
    const wrap=document.getElementById('editOrderItems');
    if(!wrap)return;
    const pos=await fetchPositions([orderId]);
    const rows=[...wrap.querySelectorAll('.edit-order-item-row')];
    rows
      .map((row,index)=>({row,index,id:row.dataset.itemId||''}))
      .sort((a,b)=>{
        const pa=a.id&&pos.has(a.id)?pos.get(a.id):999999;
        const pb=b.id&&pos.has(b.id)?pos.get(b.id):999999;
        return pa-pb||a.index-b.index;
      })
      .forEach(x=>wrap.appendChild(x.row));
  }

  async function reorderStatusRows(orderId){
    const sels=[...document.querySelectorAll('#itemStatusForm .item-status-select')];
    if(!sels.length)return;
    const pos=await fetchPositions([orderId]);
    const rows=sels.map((sel,index)=>({row:sel.parentElement,index,id:sel.dataset.itemId||''}));
    const parent=rows[0]?.row?.parentElement;
    if(!parent)return;
    rows.sort((a,b)=>{
      const pa=a.id&&pos.has(a.id)?pos.get(a.id):999999;
      const pb=b.id&&pos.has(b.id)?pos.get(b.id):999999;
      return pa-pb||a.index-b.index;
    }).forEach(x=>parent.appendChild(x.row));
  }

  const baseOpenEdit=window.openEditSalesOrder;
  if(typeof baseOpenEdit==='function')window.openEditSalesOrder=async function(orderId){
    const r=await baseOpenEdit.apply(this,arguments);
    await reorderEditRows(orderId);
    return r;
  };

  const baseStatus=window.openItemStatusManager;
  if(typeof baseStatus==='function')window.openItemStatusManager=async function(orderId){
    const r=await baseStatus.apply(this,arguments);
    await reorderStatusRows(orderId);
    return r;
  };

  const baseSalesPage=window.renderSalesOrders;
  if(typeof baseSalesPage==='function')window.renderSalesOrders=async function(){
    const r=await baseSalesPage.apply(this,arguments);
    await sortTrackingData();
    if(typeof window.renderSalesTrackingBody==='function')window.renderSalesTrackingBody();
    return r;
  };

  const baseTrackingPage=window.renderTracking;
  if(typeof baseTrackingPage==='function')window.renderTracking=async function(){
    const r=await baseTrackingPage.apply(this,arguments);
    await sortTrackingData();
    if(typeof window.renderOrderTrackingBody==='function')window.renderOrderTrackingBody();
    return r;
  };
})();
