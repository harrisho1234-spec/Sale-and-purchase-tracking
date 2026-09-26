// Dedicated Sales Report: Month / Quarter / Year with multi-sales-rep filtering.
(function(){
  const reportState={
    rows:[],
    itemRows:[],
    view:'month',
    year:null,
    selectedReps:null,
    repMenuOpen:false,
    business:'all'
  };

  function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
  function repKey(r){return r.sales_rep_id||'__unassigned__'}
  function reportScopeUserId(){
    if(typeof managerRepActive==='function'&&managerRepActive())return managerRepId();
    if(typeof managerTestActive==='function'&&managerTestActive())return state.managerRepContext?.user_id||null;
    const role=state.profile?.role||'';
    if(['sales','manager'].includes(role))return state.user?.id||null;
    return null;
  }
  function canChooseReportReps(){
    return !reportScopeUserId()&&['admin','super_admin'].includes(state.profile?.role||'');
  }
  function reportBusinessLabel(){
    if(reportState.business==='RK')return 'LP Home (RK)';
    if(reportState.business==='TK')return "L'Imperial Luxury (TK)";
    if(reportState.business==='OTHER')return 'Pre-Order / Other';
    if(reportState.business==='RKTK')return 'RK + TK Combined';
    return 'All Business';
  }
  function rowInReportScope(r,includeBusiness=true){
    const scopeId=reportScopeUserId();
    if(scopeId&&r.sales_rep_id!==scopeId)return false;
    if(canChooseReportReps()&&!repSelected(repKey(r)))return false;
    if(includeBusiness&&reportState.business!=='all'){
      const code=String(r.business_code||'OTHER');
      if(reportState.business==='RKTK'&&!['RK','TK'].includes(code))return false;
      if(reportState.business!=='RKTK'&&code!==reportState.business)return false;
    }
    if(reportState.view!=='year'&&reportState.year&&yearOf(r.order_date)!==Number(reportState.year))return false;
    return true;
  }
  function yearOf(v){const y=Number(String(v||'').slice(0,4));return Number.isFinite(y)?y:null}
  function monthOf(v){const m=Number(String(v||'').slice(5,7));return m>=1&&m<=12?m:null}
  function reportYears(){
    return [...new Set(reportState.rows.map(r=>yearOf(r.order_date)).filter(Boolean))].sort((a,b)=>b-a);
  }
  function reportReps(){
    const map=new Map();
    reportState.rows.forEach(r=>{
      const key=repKey(r);
      if(!map.has(key))map.set(key,{key,name:r.sales_rep_name||'Unassigned'});
    });
    return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  }
  function repSelected(key){
    return reportState.selectedReps===null||reportState.selectedReps.has(key);
  }
  function selectedRepLabel(){
    const scopeId=reportScopeUserId();
    if(scopeId){
      const row=reportState.rows.find(r=>r.sales_rep_id===scopeId);
      return row?.sales_rep_name||((typeof managerTestActive==='function'&&managerTestActive())?state.managerRepContext?.display_name:'My Sales');
    }
    const reps=reportReps();
    if(reportState.selectedReps===null)return 'All Sales Reps';
    const count=reportState.selectedReps.size;
    if(count===0)return 'No Sales Reps';
    if(count===1){
      const key=[...reportState.selectedReps][0];
      return reps.find(x=>x.key===key)?.name||'1 Sales Rep';
    }
    return count+' Sales Reps';
  }
  function periodRows(){
    return (reportState.rows||[]).filter(r=>rowInReportScope(r,true));
  }
  function reportItemRows(){
    return (reportState.itemRows||[]).filter(r=>rowInReportScope(r,true));
  }
  function productLineLabel(r){
    const raw=String(r.product_class||'').trim();
    const styleTokens=new Set(['classic','modern','crystal','unspecified','unclassified']);
    const parts=raw.split(',').map(x=>x.trim()).filter(Boolean)
      .filter(x=>!styleTokens.has(x.toLowerCase()));
    if(parts.length)return [...new Set(parts)].join(', ');
    const type=String(r.product_type||'').trim();
    return type&& !['unspecified','unclassified'].includes(type.toLowerCase())?type:'Unspecified';
  }
  function aggregateItemDimension(kind){
    const map=new Map();
    reportItemRows().forEach(r=>{
      const label=kind==='brand'
        ?(String(r.brand||'').trim()||'Unspecified')
        :productLineLabel(r);
      if(!map.has(label))map.set(label,{label,actual:0,collection:0,confirmed:0,returns:0,qty:0,lines:0});
      const x=map.get(label);
      x.actual+=n(r.actual_sales);
      x.collection+=n(r.collection_value);
      x.confirmed+=n(r.confirmed_sales);
      x.returns+=n(r.return_value);
      x.qty+=n(r.qty);
      x.lines+=1;
    });
    return [...map.values()].sort((a,b)=>b.actual-a.actual);
  }
  function compactDimensionRows(rows,limit=12){
    if(rows.length<=limit)return rows;
    const head=rows.slice(0,limit);
    const rest=rows.slice(limit).reduce((a,r)=>{
      a.actual+=r.actual;a.collection+=r.collection;a.confirmed+=r.confirmed;a.returns+=r.returns;a.qty+=r.qty;a.lines+=r.lines;return a;
    },{label:'Other',actual:0,collection:0,confirmed:0,returns:0,qty:0,lines:0});
    return [...head,rest];
  }
  function dimensionBarCard(title,subtitle,rows){
    const data=compactDimensionRows(rows,12);
    const max=Math.max(...data.map(x=>x.actual),0);
    const total=data.reduce((s,x)=>s+x.actual,0);
    return `<div class="card rounded-2xl p-4">
      <div class="flex items-start justify-between gap-3 mb-4">
        <div><h4 class="font-bold">${esc(title)}</h4><div class="text-[10px] text-gray-400 mt-1">${esc(subtitle)}</div></div>
        <div class="text-[10px] text-gray-400 whitespace-nowrap">${rows.length} categor${rows.length===1?'y':'ies'}</div>
      </div>
      <div class="space-y-3">
        ${data.length?data.map((r,i)=>{
          const width=max>0?Math.max((r.actual/max)*100,r.actual>0?2:0):0;
          const share=total>0?r.actual/total*100:0;
          return `<div>
            <div class="grid grid-cols-[28px_minmax(0,1fr)_auto] gap-2 items-center mb-1">
              <div class="text-[10px] text-gray-400 font-semibold">#${i+1}</div>
              <div class="text-xs font-semibold truncate" title="${esc(r.label)}">${esc(r.label)}</div>
              <div class="text-right"><b class="text-xs">${money(r.actual)}</b><span class="text-[9px] text-gray-400 ml-1">${share.toFixed(1)}%</span></div>
            </div>
            <div class="ml-[36px] h-2 rounded-full bg-gray-100 overflow-hidden"><div class="h-full rounded-full bg-[#b3871e]" style="width:${width}%"></div></div>
            ${r.returns>0?`<div class="ml-[36px] mt-0.5 text-[9px] text-amber-600">Returns/CN −${money(r.returns)}</div>`:''}
          </div>`;
        }).join(''):'<div class="py-12 text-center text-sm text-gray-400">No product sales data for this selection.</div>'}
      </div>
    </div>`;
  }

  function businessBreakdown(){
    const map=new Map([
      ['RK',{label:'LP Home (RK)',actual:0,collection:0,confirmed:0,returns:0,qty:0,lines:0}],
      ['TK',{label:"L'Imperial Luxury (TK)",actual:0,collection:0,confirmed:0,returns:0,qty:0,lines:0}],
      ['OTHER',{label:'Pre-Order / Other',actual:0,collection:0,confirmed:0,returns:0,qty:0,lines:0}]
    ]);
    (reportState.rows||[]).filter(r=>rowInReportScope(r,false)).forEach(r=>{
      const key=['RK','TK'].includes(String(r.business_code||''))?String(r.business_code):'OTHER';
      const x=map.get(key);
      x.actual+=n(r.actual_sales);x.collection+=n(r.collection_value);x.confirmed+=n(r.confirmed_sales);x.returns+=n(r.return_value);x.lines+=1;
    });
    return [...map.values()].filter(x=>x.lines||x.actual||x.confirmed);
  }

  function bucketRows(){
    const rows=periodRows();
    const add=(b,r)=>{
      b.actual+=n(r.actual_sales);
      b.collection+=n(r.collection_value);
      b.confirmed+=n(r.confirmed_sales);
      b.returns+=n(r.return_value);
      b.invoice+=n(r.invoice_value);
      b.prepayment+=n(r.prepayment_value);
      b.pending+=n(r.pending_value);
      b.orders+=1;
    };

    if(reportState.view==='month'){
      const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const out=names.map((label,i)=>({key:i+1,label,actual:0,collection:0,confirmed:0,returns:0,invoice:0,prepayment:0,pending:0,orders:0}));
      rows.forEach(r=>{const m=monthOf(r.order_date);if(m)add(out[m-1],r)});
      return out;
    }
    if(reportState.view==='quarter'){
      const out=[1,2,3,4].map(q=>({key:q,label:'Q'+q,actual:0,collection:0,confirmed:0,returns:0,invoice:0,prepayment:0,pending:0,orders:0}));
      rows.forEach(r=>{const m=monthOf(r.order_date);if(m)add(out[Math.floor((m-1)/3)],r)});
      return out;
    }

    const years=[...new Set(rows.map(r=>yearOf(r.order_date)).filter(Boolean))].sort((a,b)=>a-b);
    return years.map(y=>{
      const b={key:y,label:String(y),actual:0,collection:0,confirmed:0,returns:0,invoice:0,prepayment:0,pending:0,orders:0};
      rows.filter(r=>yearOf(r.order_date)===y).forEach(r=>add(b,r));
      return b;
    });
  }
  function totals(rows){
    return rows.reduce((a,r)=>{
      a.actual+=n(r.actual_sales);
      a.collection+=n(r.collection_value);
      a.confirmed+=n(r.confirmed_sales);
      a.returns+=n(r.return_value);
      a.invoice+=n(r.invoice_value);
      a.prepayment+=n(r.prepayment_value);
      a.pending+=n(r.pending_value);
      a.orders++;
      return a;
    },{actual:0,collection:0,confirmed:0,returns:0,invoice:0,prepayment:0,pending:0,orders:0});
  }
  function tabButton(id,label){
    const active=reportState.view===id;
    return '<button type="button" onclick="setSalesReportView(\''+id+'\')" class="px-4 py-2 rounded-lg text-xs font-semibold '+(active?'bg-[#211d18] text-white':'bg-white border text-gray-600')+'">'+label+'</button>';
  }
  function kpiCard(label,value,sub,cls=''){
    return '<div class="card rounded-2xl p-4"><div class="text-[10px] uppercase tracking-wide font-bold text-gray-400">'+label+'</div><div class="text-2xl font-bold mt-1 '+cls+'">'+value+'</div><div class="text-[10px] text-gray-400 mt-1">'+sub+'</div></div>';
  }
  function reportRepMenu(){
    const reps=reportReps();
    return '<div id="reportRepMenu" class="'+(reportState.repMenuOpen?'':'hidden ')+'absolute z-[90] right-0 mt-2 w-[320px] max-h-[360px] overflow-y-auto bg-white border rounded-xl shadow-xl p-2">'
      +'<label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"><input type="checkbox" '+(reportState.selectedReps===null?'checked':'')+' onchange="salesReportSelectAllReps(this.checked)"><span class="font-semibold text-sm">All Sales Reps</span></label>'
      +'<div class="border-t my-1"></div>'
      +reps.map(r=>'<label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"><input type="checkbox" '+(repSelected(r.key)?'checked':'')+' onchange="salesReportToggleRep(\''+esc(r.key)+'\',this.checked)"><span class="text-sm">'+esc(r.name)+'</span></label>').join('')
      +'</div>';
  }
  function repBreakdown(){
    const rows=periodRows();
    const map=new Map();
    rows.forEach(r=>{
      const key=repKey(r);
      if(!map.has(key))map.set(key,{name:r.sales_rep_name||'Unassigned',actual:0,collection:0,confirmed:0,returns:0,orders:0});
      const x=map.get(key);
      x.actual+=n(r.actual_sales);x.collection+=n(r.collection_value);x.confirmed+=n(r.confirmed_sales);x.returns+=n(r.return_value);x.orders++;
    });
    return [...map.values()].sort((a,b)=>b.actual-a.actual);
  }
  function renderSalesReportBody(){
    const root=document.getElementById('salesReportRoot');if(!root)return;
    const rows=periodRows(),buckets=bucketRows(),t=totals(rows),years=reportYears(),repRows=repBreakdown();
    const brandRows=aggregateItemDimension('brand'),productLineRows=aggregateItemDimension('product_line'),businessRows=businessBreakdown();
    const max=Math.max(...buckets.map(x=>x.actual),0);
    const yearSelect=reportState.view==='year'?'':`
      <select id="salesReportYear" onchange="setSalesReportYear(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
        ${years.map(y=>`<option value="${y}" ${Number(reportState.year)===y?'selected':''}>${y}</option>`).join('')}
      </select>`;

    root.innerHTML=`
      <div class="card rounded-2xl p-4 mb-4">
        <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div>
            <h3 class="font-bold text-lg">Sales Report</h3>
            <p class="text-[11px] text-gray-400 mt-1"><b>Actual Sales</b> is the main result: Invoice value + Pre-payment − active Return/CN. Collection is cash received. Confirmed includes Invoice + Pre-payment + Pending. Cancelled orders/CNs are excluded.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex gap-1 p-1 rounded-xl bg-[#f7f5f1]">${tabButton('month','By Month')}${tabButton('quarter','By Quarter')}${tabButton('year','By Year')}</div>
            ${yearSelect}
            <select id="salesReportBusiness" onchange="setSalesReportBusiness(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm min-w-[180px]">
              <option value="all" ${reportState.business==='all'?'selected':''}>All Business</option>
              <option value="RKTK" ${reportState.business==='RKTK'?'selected':''}>RK + TK Combined</option>
              <option value="RK" ${reportState.business==='RK'?'selected':''}>LP Home (RK)</option>
              <option value="TK" ${reportState.business==='TK'?'selected':''}>L'Imperial Luxury (TK)</option>
              <option value="OTHER" ${reportState.business==='OTHER'?'selected':''}>Pre-Order / Other</option>
            </select>
            ${canChooseReportReps()?`<div class="relative">
              <button type="button" onclick="toggleSalesReportRepMenu()" class="min-w-[190px] flex items-center justify-between gap-3 border rounded-xl bg-white px-3 py-2.5 text-sm">
                <span class="truncate">${esc(selectedRepLabel())}</span><span class="text-gray-400">⌄</span>
              </button>
              ${reportRepMenu()}
            </div>`:`<div class="min-w-[170px] border rounded-xl bg-[#faf9f6] px-3 py-2.5 text-sm font-semibold text-gray-600">${esc(selectedRepLabel())}</div>`}
          </div>
        </div>
      </div>

      <div class="grid xl:grid-cols-3 gap-3 mb-3">
        <div class="rounded-2xl p-5 bg-[#211d18] text-white shadow-sm">
          <div class="text-[10px] uppercase tracking-[.16em] font-bold text-white/60">Main Result · Actual Sales</div>
          <div class="text-3xl font-bold mt-2">${money(t.actual)}</div>
          <div class="text-[10px] text-white/60 mt-2">Invoices ${money(t.invoice)} + Pre-payment ${money(t.prepayment)} − Returns ${money(t.returns)}</div>
        </div>
        ${kpiCard('Collection',money(t.collection),'Deposits + all payments actually received','text-green-600')}
        ${kpiCard('Confirmed Sales',money(t.confirmed),'Invoices + Pre-payment + Pending ('+money(t.pending)+' pending)','text-[#8a6514]')}
      </div>
      <div class="grid grid-cols-2 gap-3 mb-4">
        ${kpiCard('Returns / CN','−'+money(t.returns),'Active returned value','text-amber-600')}
        ${kpiCard('Orders',String(t.orders),'Included sales orders / SR')}
      </div>

      <div class="grid xl:grid-cols-[1.2fr_.8fr] gap-4">
        <div class="card rounded-2xl p-4">
          <div class="flex items-center justify-between gap-3 mb-4"><div><h4 class="font-bold">Sales by ${reportState.view==='month'?'Month':reportState.view==='quarter'?'Quarter':'Year'}</h4><div class="text-[10px] text-gray-400 mt-1">${reportState.view==='year'?'All available years':esc(String(reportState.year||''))} · ${esc(reportBusinessLabel())}</div></div><div class="text-xs text-gray-400">${esc(selectedRepLabel())}</div></div>
          <div class="space-y-3">
            ${buckets.length?buckets.map(b=>{
              const width=max>0?Math.max((b.actual/max)*100,b.actual>0?2:0):0;
              return `<div>
                <div class="flex items-center justify-between gap-3 text-xs mb-1"><div class="font-semibold w-14">${esc(b.label)}</div><div class="flex-1 text-right"><b>${money(b.actual)}</b><span class="text-gray-400 ml-2">${b.orders} order${b.orders===1?'':'s'}</span></div></div>
                <div class="ml-14 h-2 rounded-full bg-gray-100 overflow-hidden"><div class="h-full rounded-full bg-[#b3871e]" style="width:${width}%"></div></div>
              </div>`;
            }).join(''):'<div class="py-12 text-center text-sm text-gray-400">No sales data for this selection.</div>'}
          </div>
        </div>

        <div class="card rounded-2xl overflow-hidden">
          <div class="px-4 py-3 border-b"><h4 class="font-bold">Period Summary</h4></div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-[#faf9f6] text-gray-400 uppercase text-[9px]"><tr><th class="text-left px-3 py-2">Period</th><th class="text-right px-3 py-2">Actual</th><th class="text-right px-3 py-2">Collection</th><th class="text-right px-3 py-2">Confirmed</th><th class="text-right px-3 py-2">Returns</th><th class="text-right px-3 py-2">Orders</th></tr></thead>
              <tbody class="divide-y">${buckets.map(b=>`<tr><td class="px-3 py-2 font-semibold">${esc(b.label)}</td><td class="px-3 py-2 text-right font-bold">${money(b.actual)}</td><td class="px-3 py-2 text-right text-green-600">${money(b.collection)}</td><td class="px-3 py-2 text-right">${money(b.confirmed)}</td><td class="px-3 py-2 text-right text-amber-600">−${money(b.returns)}</td><td class="px-3 py-2 text-right">${b.orders}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="grid xl:grid-cols-[.8fr_1.2fr] gap-4 mt-4">
        ${dimensionBarCard('Sales by Business','RK = LP Home · TK = L\'Imperial Luxury',businessRows)}
        <div class="card rounded-2xl p-4">
          <div class="flex items-start justify-between gap-3 mb-4">
            <div><h4 class="font-bold">Business Unit Summary</h4><div class="text-[10px] text-gray-400 mt-1">Uses the invoice/document prefix to classify RK and TK.</div></div>
            <div class="text-[10px] text-gray-400">${esc(reportBusinessLabel())}</div>
          </div>
          <div class="grid sm:grid-cols-2 gap-3">
            ${['RK','TK'].map(code=>{
              const x=businessRows.find(b=>b.label.includes('('+code+')'))||{label:code,actual:0,collection:0,confirmed:0,returns:0,lines:0};
              return `<div class="rounded-xl border bg-[#faf9f6] p-4"><div class="text-[10px] uppercase font-bold text-gray-400">${esc(x.label)}</div><div class="text-2xl font-bold mt-1">${money(x.actual)}</div><div class="text-[10px] text-gray-400 mt-1">Collection ${money(x.collection)} · Confirmed ${money(x.confirmed)} · Returns −${money(x.returns)}</div></div>`;
            }).join('')}
          </div>
        </div>
      </div>

      <div class="grid xl:grid-cols-2 gap-4 mt-4">
        ${dimensionBarCard('Sales by Brand','Ranked by Actual Sales (invoice + pre-payment − returns).',brandRows)}
        ${dimensionBarCard('Sales by Product Line','Ranked by Actual Sales. Product classes are normalized (for example Sofa, Chandelier, Wall Lamp, Table).',productLineRows)}
      </div>

      <div class="card rounded-2xl overflow-hidden mt-4">
        <div class="px-4 py-3 border-b flex items-center justify-between"><div><h4 class="font-bold">Sales Rep Summary</h4><div class="text-[10px] text-gray-400 mt-0.5">Based on the selected period and Sales Rep filter.</div></div><div class="text-[10px] text-gray-400">${repRows.length} rep${repRows.length===1?'':'s'}</div></div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="bg-[#faf9f6] text-gray-400 uppercase text-[9px]"><tr><th class="text-left px-4 py-2">Sales Rep</th><th class="text-right px-4 py-2">Orders</th><th class="text-right px-4 py-2">Actual Sales</th><th class="text-right px-4 py-2">Collection</th><th class="text-right px-4 py-2">Confirmed</th><th class="text-right px-4 py-2">Returns</th></tr></thead>
            <tbody class="divide-y">${repRows.length?repRows.map(r=>`<tr><td class="px-4 py-3 font-semibold">${esc(r.name)}</td><td class="px-4 py-3 text-right">${r.orders}</td><td class="px-4 py-3 text-right font-bold">${money(r.actual)}</td><td class="px-4 py-3 text-right text-green-600">${money(r.collection)}</td><td class="px-4 py-3 text-right">${money(r.confirmed)}</td><td class="px-4 py-3 text-right text-amber-600">−${money(r.returns)}</td></tr>`).join(''):`<tr><td colspan="6" class="px-4 py-10 text-center text-gray-400">No sales data for this selection.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }

  window.renderReports=async function(){
    if(!['sales','manager','admin','super_admin'].includes(state.profile?.role||''))throw new Error('Sales, Manager, Admin or Super Admin access required');
    document.getElementById('pageTitle').textContent='Report';
    document.getElementById('pageSubtitle').textContent='Sales by period, RK/TK business, Sales Rep, brand and product line';
    document.getElementById('content').innerHTML='<div id="salesReportRoot"><div class="py-20 text-center text-gray-400">Loading sales report...</div></div>';

    const [summaryRes,itemRes]=await Promise.all([
      db.rpc('get_sales_report_rows_v3'),
      db.rpc('get_sales_report_item_rows_v3')
    ]);
    if(summaryRes.error)throw summaryRes.error;
    if(itemRes.error)throw itemRes.error;
    reportState.rows=summaryRes.data||[];
    reportState.itemRows=itemRes.data||[];

    const years=reportYears();
    if(!reportState.year||!years.includes(Number(reportState.year)))reportState.year=years[0]||new Date().getFullYear();
    renderSalesReportBody();
  };

  window.setSalesReportView=function(v){
    if(!['month','quarter','year'].includes(v))return;
    reportState.view=v;reportState.repMenuOpen=false;renderSalesReportBody();
  };
  window.setSalesReportYear=function(v){reportState.year=Number(v);reportState.repMenuOpen=false;renderSalesReportBody()};
  window.setSalesReportBusiness=function(v){reportState.business=['RKTK','RK','TK','OTHER'].includes(v)?v:'all';reportState.repMenuOpen=false;renderSalesReportBody()};
  window.toggleSalesReportRepMenu=function(){reportState.repMenuOpen=!reportState.repMenuOpen;renderSalesReportBody()};
  window.salesReportSelectAllReps=function(checked){
    if(checked)reportState.selectedReps=null;
    else reportState.selectedReps=new Set();
    reportState.repMenuOpen=true;renderSalesReportBody();
  };
  window.salesReportToggleRep=function(key,checked){
    const reps=reportReps();
    let set;
    if(reportState.selectedReps===null)set=new Set(reps.map(r=>r.key));
    else set=new Set(reportState.selectedReps);
    if(checked)set.add(key);else set.delete(key);
    reportState.selectedReps=set.size===reps.length?null:set;
    reportState.repMenuOpen=true;renderSalesReportBody();
  };

  const previousNavItems=window.navItems;
  if(typeof previousNavItems==='function'){
    window.navItems=function(){
      const items=(previousNavItems.apply(this,arguments)||[]).map(x=>x[0]==='reports'?['reports','Report',x[2]||'▥']:x);
      if(!items.some(x=>x[0]==='reports')&&['sales','manager'].includes(state.profile?.role||'')){
        items.push(['reports','Report','▥']);
      }
      return items;
    };
  }
})();