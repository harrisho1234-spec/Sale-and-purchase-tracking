(function(){
  const cache=new Map();
  window.stockCountReportShowSystem=false;

  function n(v){return Number(v||0)}
  function q(v){const x=n(v);return Number.isInteger(x)?x.toLocaleString():x.toLocaleString(undefined,{maximumFractionDigits:2})}
  function e(v){return typeof esc==='function'?esc(v==null?'':String(v)):String(v==null?'':v)}
  function periodKey(v){return String(v||'').slice(0,7)+'-01'}
  function periodEnd(v){const d=new Date(periodKey(v)+'T00:00:00');return new Date(d.getFullYear(),d.getMonth()+1,0)}
  function titleDate(v){return periodEnd(v).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'2-digit'})}
  function allowed(){return ['stock_controller','accountant','manager','admin','super_admin'].includes(state.profile?.role||'')}

  async function loadData(periodMonth,force=false){
    const period=periodKey(periodMonth);
    if(!force&&cache.has(period))return cache.get(period);
    const [locRes,dataRes,countRes]=await Promise.all([
      db.from('stock_locations').select('id,code,name,sort_order,active').eq('active',true).order('sort_order').order('code'),
      db.rpc('get_stock_count_summary_report',{p_period_month:period}),
      db.from('stock_counts').select('id,period_month,location_id,status,created_at,stock_locations(code,name,sort_order)').eq('period_month',period).order('created_at',{ascending:false})
    ]);
    if(locRes.error)throw locRes.error;if(dataRes.error)throw dataRes.error;if(countRes.error)throw countRes.error;
    const rank={closed:4,reconciled:3,submitted:2,draft:1},byLoc=new Map();
    for(const x of countRes.data||[]){
      const p=byLoc.get(x.location_id);
      if(!p||(rank[x.status]||0)>(rank[p.status]||0)||((rank[x.status]||0)===(rank[p.status]||0)&&String(x.created_at)>String(p.created_at)))byLoc.set(x.location_id,x);
    }
    const out={period,locations:locRes.data||[],rows:dataRes.data||[],counts:[...byLoc.values()]};
    cache.set(period,out);return out;
  }
  window.loadStockCountReportData=loadData;

  function gridTemplate(data,showSystem){
    return showSystem
      ? '190px 310px 55px 95px 110px 75px 65px 65px 95px 65px 75px repeat('+data.locations.length+',58px) 70px 70px 210px'
      : '190px 310px 55px 95px 110px repeat('+data.locations.length+',58px) 70px 210px';
  }

  function systemCells(r){
    return '<div class="px-2 py-2 text-right">'+q(r.stock_opening)+'</div>'+
      '<div class="px-2 py-2 text-right">'+q(r.stock_in)+'</div>'+
      '<div class="px-2 py-2 text-right">'+q(r.stock_out)+'</div>'+
      '<div class="px-2 py-2 text-right font-semibold">'+q(r.stock_ending)+'</div>'+
      '<div class="px-2 py-2 text-right">'+(r.qb_qty==null?'':q(r.qb_qty))+'</div>'+
      '<div class="px-2 py-2 text-right">'+(r.old_stock==null?'':q(r.old_stock))+'</div>';
  }

  function rowHtml(r,data,counted,showSystem){
    const lc=r.location_counts||{};
    const locationCells=data.locations.map(l=>{
      const has=Object.prototype.hasOwnProperty.call(lc,l.code)&&lc[l.code]!=null;
      return '<div class="px-2 py-2 text-right '+(!counted.has(l.code)?'bg-gray-50 text-gray-300':'')+'">'+(has?q(lc[l.code]):'')+'</div>';
    }).join('');

    return '<div class="grid items-center text-[10px] border-b" style="grid-template-columns:'+gridTemplate(data,showSystem)+'">'+
      '<div class="px-2 py-2 font-semibold text-[#8a5a00]">'+e(r.code||'')+'</div>'+
      '<div class="px-2 py-2">'+e(r.item_name||'')+'</div>'+
      '<div class="px-2 py-2">'+e(r.uom||'Pcs')+'</div>'+
      '<div class="px-2 py-2 truncate">'+e(r.category||'')+'</div>'+
      '<div class="px-2 py-2 truncate">'+e(r.brand||'')+'</div>'+
      (showSystem?systemCells(r):'')+
      locationCells+
      '<div class="px-2 py-2 text-right font-semibold">'+q(r.total_counted)+'</div>'+
      (showSystem?'<div class="px-2 py-2 text-right font-bold '+(n(r.compare_qty)!==0?'text-red-600':'text-green-600')+'">'+q(r.compare_qty)+'</div>':'')+
      '<div class="px-2 py-2 truncate">'+e(r.remark||'')+'</div></div>';
  }

  function headerHtml(data,dt,showSystem){
    const locationHeaders=data.locations.map(l=>'<div class="font-bold text-center">'+e(l.code)+'</div>').join('');
    const systemHeaders=showSystem
      ? '<div class="px-2 py-3 font-bold">Stock Opening</div><div class="px-2 py-3 font-bold">Stock In</div><div class="px-2 py-3 font-bold">Stock Out</div><div class="px-2 py-3 font-bold">Stock Ending on '+e(dt)+'</div><div class="px-2 py-3 font-bold">QB</div><div class="px-2 py-3 font-bold">Old Stock</div>'
      : '';
    return '<div class="sticky top-0 z-20 grid bg-[#fff200] border-b border-black text-[9px] text-center items-center" style="grid-template-columns:'+gridTemplate(data,showSystem)+'">'+
      '<div class="px-2 py-3 font-bold">Items Code</div><div class="px-2 py-3 font-bold">Items Name</div><div class="px-2 py-3 font-bold">U/M</div><div class="px-2 py-3 font-bold">Category</div><div class="px-2 py-3 font-bold">Brand</div>'+
      systemHeaders+locationHeaders+'<div class="px-2 py-3 font-bold">Total</div>'+(showSystem?'<div class="px-2 py-3 font-bold">Compare</div>':'')+'<div class="px-2 py-3 font-bold">Remark</div></div>';
  }

  function renderModal(data){
    const counted=new Set(data.counts.map(x=>x.stock_locations?.code).filter(Boolean));
    const complete=counted.size===data.locations.length;
    const dt=titleDate(data.period);
    const showSystem=!!window.stockCountReportShowSystem;
    const preview=data.rows.slice(0,100);

    document.getElementById('modalBody').innerHTML='<div class="space-y-4">'+
      '<div class="rounded-xl border '+(complete?'border-green-200 bg-green-50':'border-amber-200 bg-amber-50')+' p-3">'+
        '<div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">'+
          '<div><div class="text-sm font-bold">Stock Count on '+e(dt)+' (ALL)</div><div class="text-[10px] '+(complete?'text-green-700':'text-amber-800')+' mt-1">'+counted.size+' of '+data.locations.length+' active locations have a Stock Count for this month. '+(complete?'Report is complete.':'Missing locations are left blank, not treated as zero.')+'</div></div>'+
          '<div class="flex flex-wrap gap-2">'+
            '<button onclick="toggleStockCountReportSystem()" class="px-4 py-2.5 border border-blue-200 bg-blue-50 text-blue-700 rounded-xl text-xs font-semibold">'+(showSystem?'Hide System / Reconciliation':'Show System / Reconciliation')+'</button>'+
            '<button onclick="exportStockCountSummaryExcel(\''+data.period+'\')" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Export Excel - Template Style</button>'+
          '</div>'+
        '</div>'+
        (!showSystem?'<div class="mt-2 text-[10px] text-gray-500">System, Opening/In/Out/Ending, QB, Old Stock and Compare are hidden. Turn them on only when you want reconciliation.</div>':'')+
      '</div>'+
      '<div class="max-h-[67vh] overflow-auto border rounded-xl bg-white">'+
        headerHtml(data,dt,showSystem)+
        (preview.length?preview.map(r=>rowHtml(r,data,counted,showSystem)).join(''):'<div class="p-10 text-center text-sm text-gray-400">No stock-count report rows.</div>')+
      '</div>'+
      (data.rows.length>100?'<div class="text-center text-[10px] text-gray-400">Preview shows first 100 of '+data.rows.length.toLocaleString()+' item codes. Excel export includes all rows.</div>':'')+
    '</div>';
  }

  window.toggleStockCountReportSystem=function(){
    window.stockCountReportShowSystem=!window.stockCountReportShowSystem;
    const data=window._stockCountSummaryReport;
    if(data)renderModal(data);
  };

  window.openStockCountSummaryReport=async function(periodMonth){
    if(!allowed())return showToast('Stock Count report access required.','err');
    window.stockCountReportShowSystem=false;
    openModal('Stock Count Report','<div class="py-14 text-center text-sm text-gray-400">Preparing ALL-location stock count report...</div>');
    try{
      const data=await loadData(periodMonth,true);
      window._stockCountSummaryReport=data;
      renderModal(data);
    }catch(err){
      document.getElementById('modalBody').innerHTML='<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-600 text-sm">Error: '+e(err.message)+'</div>';
    }
  };

  const prev=window.openStockCount;
  if(typeof prev==='function')window.openStockCount=async function(countId){
    await prev.apply(this,arguments);
    const res=await db.from('stock_counts').select('period_month').eq('id',countId).single();
    if(res.error)return;
    const body=document.getElementById('modalBody'),root=body?.firstElementChild;
    if(!root||root.querySelector('[data-all-location-report]'))return;
    const bar=document.createElement('div');bar.setAttribute('data-all-location-report','1');bar.className='flex justify-end';
    bar.innerHTML='<button class="px-4 py-2 border border-amber-200 bg-amber-50 text-[#8a5a00] rounded-xl text-xs font-semibold">View ALL Location Report</button>';
    bar.querySelector('button').onclick=()=>openStockCountSummaryReport(res.data.period_month);
    root.insertBefore(bar,root.children[1]||null);
  };
})();