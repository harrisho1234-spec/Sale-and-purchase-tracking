// Whole-PO Arrived action shared by Manage PO, PO Status / ETA and Edit Supplier PO.
// Individual item statuses remain independently editable for split/partial shipments.
(function(){
  'use strict';
  const busy=new Set();
  const nice=po=>po?.po_number||po?.po_pending_reference||'this PO';
  window.confirmWholePOArrival=async function(poId,eta){
    if(!poId)throw new Error('Supplier PO is required.');
    const id=String(poId);
    if(busy.has(id))return false;
    busy.add(id);
    try{
      const [poRes,itemsRes]=await Promise.all([
        db.from('supplier_pos').select('id,po_number,po_pending_reference,status').eq('id',id).single(),
        db.from('supplier_po_items').select('id,procurement_status,historical_stock_reconciled').eq('supplier_po_id',id)
      ]);
      if(poRes.error)throw poRes.error;
      if(itemsRes.error)throw itemsRes.error;
      const po=poRes.data;
      const items=itemsRes.data||[];
      const historical=items.filter(x=>x.historical_stock_reconciled);
      const closed=items.filter(x=>!x.historical_stock_reconciled&&x.procurement_status==='closed');
      const cancelled=items.filter(x=>!x.historical_stock_reconciled&&x.procurement_status==='cancelled');
      const live=items.filter(x=>!x.historical_stock_reconciled&&!['closed','cancelled'].includes(x.procurement_status));
      if(!live.length)throw new Error('No live items can be marked Arrived. Historical / reconciled, cancelled and completed items are protected.');
      const toChange=live.filter(x=>x.procurement_status!=='arrived');
      const changed=String(po.status||'')!=='arrived'||toChange.length>0;
      const excluded=[historical.length&&historical.length+' historical/reconciled',closed.length&&closed.length+' completed',cancelled.length&&cancelled.length+' cancelled'].filter(Boolean);
      if(changed){
        const message='Mark '+nice(po)+' as ARRIVED and update all '+live.length+' active PO item line'+(live.length===1?'':'s')+' to Arrived?'
          +(toChange.length?'\n\n'+toChange.length+' item line'+(toChange.length===1?' is':'s are')+' currently not Arrived.':'')
          +(excluded.length?'\n\nProtected items will stay unchanged: '+excluded.join(', ')+'.':'')
          +'\n\nThis updates shipping/procurement status only. It DOES NOT add stock or record a Stock IN. Use Stock & Inventory → Receive PO separately after checking physical quantities.';
        if(!window.confirm(message))return false;
      }
      const res=await db.rpc('mark_supplier_po_all_items_arrived',{
        p_po_id:id,p_eta:eta||null
      });
      if(res.error)throw res.error;
      if(window.documentFlowState)window.documentFlowState.loaded=false;
      if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
      if(typeof window.invalidateInventoryTasks==='function')window.invalidateInventoryTasks();
      const updated=Number(res.data?.updated_item_lines||0);
      showToast(nice(po)+' Arrived; '+updated+' PO item status'+(updated===1?'':'es')+' updated. Stock not received automatically.');
      return true;
    }finally{busy.delete(id)}
  };
})();
