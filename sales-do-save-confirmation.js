/* Explicit receipt for new Sales Orders and optional DO requests.
 * Uses existing Sales Tracking DO form; does NOT create orders or DOs itself. */
(function(){
  'use strict';
  let lastReceipt=null;
  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  window.showSavedSalesDoConfirmation=function(receipt){
    if(!receipt||!receipt.orderId)return;
    lastReceipt={
      orderId:String(receipt.orderId),
      documentNo:String(receipt.documentNo||'Sales Order'),
      hasDo:!!receipt.hasDo,
      doNo:String(receipt.doNo||''),
      requestedDate:String(receipt.requestedDate||''),
      itemCount:Number(receipt.itemCount||0),
      customerReviewPending:!!receipt.customerReviewPending
    };
    const doc=escapeHtml(lastReceipt.documentNo);
    const hasDo=lastReceipt.hasDo;
    const date=escapeHtml(lastReceipt.requestedDate);
    const details=hasDo
      ?'<div class="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-2">'+
         '<div class="font-bold text-blue-900">✓ DO Request Created</div>'+
         '<div class="font-bold text-lg text-[#211d18]">'+
           (lastReceipt.doNo?'DO '+escapeHtml(lastReceipt.doNo):'DO request saved — number not retrieved')+
         '</div>'+
         '<div class="text-xs text-blue-800">Requested Delivery Date: <b>'+date+
         '</b> · '+lastReceipt.itemCount+' product line(s) · Sent to Stock</div>'+
         (!lastReceipt.doNo?'<div class="text-xs text-amber-800">Check Inventory → Customer Fulfillment → DO Requests for the official number.</div>':'')+
       '</div>'
      :'<div class="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-2">'+
         '<div class="font-bold text-amber-900">Sales Order saved — No DO requested</div>'+
         '<div class="text-xs text-amber-800">No Delivery Order was sent to Stock. Request one now or later from Sales Tracking.</div>'+
       '</div>';
    const action=hasDo?''
      :'<button type="button" onclick="requestDoFromOrderConfirmation()" '+
       'class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-bold">'+
       'Request DO Now →</button>';
    openModal('Sales Order Saved · '+doc,
      '<div class="space-y-4">'+
        '<div class="rounded-xl border border-green-200 bg-green-50 p-4">'+
          '<div class="text-base font-bold text-green-800">✓ Sales Order '+doc+' saved successfully</div>'+
          (lastReceipt.customerReviewPending?'<div class="text-xs text-amber-800 mt-1">Customer review pending.</div>':'')+
        '</div>'+details+
        '<div class="flex flex-wrap gap-2 justify-end">'+
          '<button type="button" onclick="closeModal()" class="px-4 py-2.5 rounded-xl border bg-white text-xs font-bold">Close</button>'+
          action+
        '</div>'+
      '</div>');
  };

  window.requestDoFromOrderConfirmation=async function(){
    const orderId=lastReceipt?.orderId;
    if(!orderId)return;
    if(typeof window.openExistingSalesDoRequest!=='function'){
      showToast('Open Sales Tracking and click REQUEST DO for this order.','err');
      return;
    }
    closeModal();
    try{
      // The tracking view is normally loaded by go('sales-orders') during save.
      // If navigation was interrupted, refresh it without creating a new order.
      if(!window.trackingRedesign?.salesOrders?.some(o=>String(o.id)===orderId)){
        await go('sales-orders');
      }
      await window.openExistingSalesDoRequest(orderId);
    }catch(error){
      showToast(error?.message||'Open Sales Tracking and select REQUEST DO on the saved order.','err');
    }
  };
})();
