// Adds an "All" Sales Tracking filter: all non-cancelled sales, including active and settled records.
(function(){
  const ui=window.trackingRedesign;
  if(!ui||typeof window.renderSalesTrackingBody!=='function')return;

  const baseRender=window.renderSalesTrackingBody;
  const baseExport=window.exportSalesTrackingCsv;

  function norm(v=''){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function nonCancelled(list){return (list||[]).filter(o=>norm(o?.status)!=='cancelled')}

  function injectAllChip(){
    const root=document.getElementById('salesTrackingRoot');
    const row=root?.querySelector('.lr-chip-row');
    if(!row)return;

    let btn=row.querySelector('[data-sales-all-filter="1"]');
    if(!btn){
      btn=document.createElement('button');
      btn.type='button';
      btn.dataset.salesAllFilter='1';
      btn.className='lr-chip';
      btn.textContent='All';
      btn.onclick=()=>window.setSalesStatus?.('all');
      row.insertBefore(btn,row.firstChild);
    }

    const isAll=ui.salesStatus==='all';
    btn.classList.toggle('active',isAll);
    if(isAll){
      [...row.querySelectorAll('.lr-chip')].forEach(x=>{
        if(x!==btn)x.classList.remove('active');
      });
    }
  }

  window.renderSalesTrackingBody=function(){
    if(ui.salesStatus!=='all'){
      const out=baseRender.apply(this,arguments);
      injectAllChip();
      return out;
    }

    // "All" means every non-cancelled sale: open + pre-order + settled.
    const originalOrders=ui.salesOrders||[];
    const originalItems=ui.salesItems||[];
    ui.salesOrders=nonCancelled(originalOrders);
    ui.salesItems=ui.salesOrders.flatMap(o=>(o.items||[]).map(i=>({...i,order:o})));
    let out;
    try{out=baseRender.apply(this,arguments)}finally{
      ui.salesOrders=originalOrders;
      ui.salesItems=originalItems;
    }
    injectAllChip();
    return out;
  };

  if(typeof baseExport==='function'){
    window.exportSalesTrackingCsv=function(){
      if(ui.salesStatus!=='all')return baseExport.apply(this,arguments);
      const originalOrders=ui.salesOrders||[];
      const originalItems=ui.salesItems||[];
      ui.salesOrders=nonCancelled(originalOrders);
      ui.salesItems=ui.salesOrders.flatMap(o=>(o.items||[]).map(i=>({...i,order:o})));
      try{return baseExport.apply(this,arguments)}finally{
        ui.salesOrders=originalOrders;
        ui.salesItems=originalItems;
      }
    };
  }
})();
