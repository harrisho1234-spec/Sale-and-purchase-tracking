// Ensure Sales Tracking redraws after document-flow metadata finishes loading.
(function(){
  const previous=window.renderSalesOrders;
  if(!previous)return;
  window.renderSalesOrders=async function(){
    await previous();
    if(window.documentFlowState?.loaded && typeof window.renderSalesTrackingBody==='function'){
      window.renderSalesTrackingBody();
    }
  };
})();
