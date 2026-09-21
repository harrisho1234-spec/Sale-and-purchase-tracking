// Small compatibility fix loaded after sales-edit-reports.js.
(function(){
  const base=window.openEditSalesOrder;
  if(typeof base!=='function')return;
  window.openEditSalesOrder=async function(orderId){
    const out=await base(orderId);
    const doc=document.getElementById('editDocumentNo');
    const type=document.getElementById('editInvoiceType');
    if(doc&&type){
      const v=String(doc.value||'').trim().toUpperCase();
      type.value=v.startsWith('RK')?'RK':'TK';
    }
    return out;
  };
})();