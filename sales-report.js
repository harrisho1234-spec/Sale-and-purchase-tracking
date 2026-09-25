// Dedicated Sales Report: Month / Quarter / Year with multi-sales-rep filtering.
(function(){
  const reportState={
    rows:[],
    view:'month',
    year:null,
    selectedReps:null,
    repMenuOpen:false
  };

  function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
  function repKey(r){return r.sales_rep_id||'__unassigned__'}
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
    let rows=reportState.rows.filter(r=>repSelected(repKey(r)));
    if(reportState.view!=='year'&&reportState.year){
      rows=rows.filter(r=>yearOf(r.order_date)===Number(reportState.year));
    }
    return rows;
  }
  function bucketRows(){
    const rows=periodRows();
    const add=(b,r)=>{
      b.gross+=n(r.gross_sales);
      b.returns+=n(r.return_value);
      b.net+=n(r.net_sales);
      b.received+=n(r.amount_received);
      b.orders+=1;
    };

    if(reportState.view==='month'){
      const names=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      const out=names.map((label,i)=>({key:i+1,label,gross:0,returns:0,net:0,received:0,orders:0}));
      rows.forEach(r=>{const m=monthOf(r.order_date);if(m)add(out[m-1],r)});
      return out;
    }
    if(reportState.view==='quarter'){
      const out=[1,2,3,4].map(q=>({key:q,label:'Q'+q,gross:0,returns:0,net:0,received:0,orders:0}));
      rows.forEach(r=>{const m=monthOf(r.order_date);if(m)add(out[Math.floor((m-1)/3)],r)});
      return out;
    }

    const years=[...new Set(rows.map(r=>yearOf(r.order_date)).filter(Boolean))].sort((a,b)=>a-b);
    return years.map(y=>{
      const b={key:y,label:String(y),gross:0,returns:0,net:0,received:0,orders:0};
      rows.filter(r=>yearOf(r.order_date)===y).forEach(r=>add(b,r));
      return b;
    });
  }
  function totals(rows){
    return rows.reduce((a,r)=>{
      a.gross+=n(r.gross_sales);a.returns+=n(r.return_value);a.net+=n(r.net_sales);a.received+=n(r.amount_received);a.orders++;
      return a;
    },{gross:0,returns:0,net:0,received:0,orders:0});
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
      if(!map.has(key))map.set(key,{name:r.sales_rep_name||'Unassigned',gross:0,returns:0,net:0,received:0,orders:0});
      const x=map.get(key);x.gross+=n(r.gross_sales);x.returns+=n(r.return_value);x.net+=n(r.net_sales);x.received+=n(r.amount_received);x.orders++;
    });
    return [...map.values()].sort((a,b)=>b.net-a.net);
  }
  function renderSalesReportBody(){
    const root=document.getElementById('salesReportRoot');if(!root)return;
    const rows=periodRows(),buckets=bucketRows(),t=totals(rows),years=reportYears(),repRows=repBreakdown();
    const max=Math.max(...buckets.map(x=>x.net),0);
    const yearSelect=reportState.view==='year'?'':`
      <select id="salesReportYear" onchange="setSalesReportYear(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
        ${years.map(y=>`<option value="${y}" ${Number(reportState.year)===y?'selected':''}>${y}</option>`).join('')}
      </select>`;

    root.innerHTML=`
      <div class="card rounded-2xl p-4 mb-4">
        <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
          <div>
            <h3 class="font-bold text-lg">Sales Report</h3>
            <p class="text-[11px] text-gray-400 mt-1">Net Sales = Gross Sales − active Return/CN value. Cancelled orders and cancelled CNs are excluded.</p>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <div class="flex gap-1 p-1 rounded-xl bg-[#f7f5f1]">${tabButton('month','By Month')}${tabButton('quarter','By Quarter')}${tabButton('year','By Year')}</div>
            ${yearSelect}
            <div class="relative">
              <button type="button" onclick="toggleSalesReportRepMenu()" class="min-w-[190px] flex items-center justify-between gap-3 border rounded-xl bg-white px-3 py-2.5 text-sm">
                <span class="truncate">${esc(selectedRepLabel())}</span><span class="text-gray-400">⌄</span>
              </button>
              ${reportRepMenu()}
            </div>
          </div>
        </div>
      </div>

      <div class="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
        ${kpiCard('Net Sales',money(t.net),'After active returns','text-[#111827]')}
        ${kpiCard('Gross Sales',money(t.gross),'Before returns')}
        ${kpiCard('Returns / CN','−'+money(t.returns),'Net returned value','text-amber-600')}
        ${kpiCard('Amount Received',money(t.received),'Customer payments','text-green-600')}
        ${kpiCard('Orders',String(t.orders),'Included sales orders')}
      </div>

      <div class="grid xl:grid-cols-[1.2fr_.8fr] gap-4">
        <div class="card rounded-2xl p-4">
          <div class="flex items-center justify-between gap-3 mb-4"><div><h4 class="font-bold">Sales by ${reportState.view==='month'?'Month':reportState.view==='quarter'?'Quarter':'Year'}</h4><div class="text-[10px] text-gray-400 mt-1">${reportState.view==='year'?'All available years':esc(String(reportState.year||''))}</div></div><div class="text-xs text-gray-400">${esc(selectedRepLabel())}</div></div>
          <div class="space-y-3">
            ${buckets.length?buckets.map(b=>{
              const width=max>0?Math.max((b.net/max)*100,b.net>0?2:0):0;
              return `<div>
                <div class="flex items-center justify-between gap-3 text-xs mb-1"><div class="font-semibold w-14">${esc(b.label)}</div><div class="flex-1 text-right"><b>${money(b.net)}</b><span class="text-gray-400 ml-2">${b.orders} order${b.orders===1?'':'s'}</span></div></div>
                <div class="ml-14 h-2 rounded-full bg-gray-100 overflow-hidden"><div class="h-full rounded-full bg-[#b3871e]" style="width:${width}%"></div></div>
              </div>`;
            }).join(''):'<div class="py-12 text-center text-sm text-gray-400">No sales data for this selection.</div>'}
          </div>
        </div>

        <div class="card rounded-2xl overflow-hidden">
          <div class="px-4 py-3 border-b"><h4 class="font-bold">Period Summary</h4></div>
          <div class="overflow-x-auto">
            <table class="w-full text-xs">
              <thead class="bg-[#faf9f6] text-gray-400 uppercase text-[9px]"><tr><th class="text-left px-3 py-2">Period</th><th class="text-right px-3 py-2">Gross</th><th class="text-right px-3 py-2">Returns</th><th class="text-right px-3 py-2">Net Sales</th><th class="text-right px-3 py-2">Orders</th></tr></thead>
              <tbody class="divide-y">${buckets.map(b=>`<tr><td class="px-3 py-2 font-semibold">${esc(b.label)}</td><td class="px-3 py-2 text-right">${money(b.gross)}</td><td class="px-3 py-2 text-right text-amber-600">−${money(b.returns)}</td><td class="px-3 py-2 text-right font-bold">${money(b.net)}</td><td class="px-3 py-2 text-right">${b.orders}</td></tr>`).join('')}</tbody>
            </table>
          </div>
        </div>
      </div>

      <div class="card rounded-2xl overflow-hidden mt-4">
        <div class="px-4 py-3 border-b flex items-center justify-between"><div><h4 class="font-bold">Sales Rep Summary</h4><div class="text-[10px] text-gray-400 mt-0.5">Based on the selected period and Sales Rep filter.</div></div><div class="text-[10px] text-gray-400">${repRows.length} rep${repRows.length===1?'':'s'}</div></div>
        <div class="overflow-x-auto">
          <table class="w-full text-xs">
            <thead class="bg-[#faf9f6] text-gray-400 uppercase text-[9px]"><tr><th class="text-left px-4 py-2">Sales Rep</th><th class="text-right px-4 py-2">Orders</th><th class="text-right px-4 py-2">Gross Sales</th><th class="text-right px-4 py-2">Returns</th><th class="text-right px-4 py-2">Net Sales</th><th class="text-right px-4 py-2">Received</th></tr></thead>
            <tbody class="divide-y">${repRows.length?repRows.map(r=>`<tr><td class="px-4 py-3 font-semibold">${esc(r.name)}</td><td class="px-4 py-3 text-right">${r.orders}</td><td class="px-4 py-3 text-right">${money(r.gross)}</td><td class="px-4 py-3 text-right text-amber-600">−${money(r.returns)}</td><td class="px-4 py-3 text-right font-bold">${money(r.net)}</td><td class="px-4 py-3 text-right text-green-600">${money(r.received)}</td></tr>`).join(''):`<tr><td colspan="6" class="px-4 py-10 text-center text-gray-400">No sales data for this selection.</td></tr>`}</tbody>
          </table>
        </div>
      </div>`;
  }

  window.renderReports=async function(){
    if(!['manager','admin','super_admin'].includes(state.profile?.role||''))throw new Error('Manager, Admin or Super Admin access required');
    document.getElementById('pageTitle').textContent='Report';
    document.getElementById('pageSubtitle').textContent='Sales by month, quarter and year';
    document.getElementById('content').innerHTML='<div id="salesReportRoot"><div class="py-20 text-center text-gray-400">Loading sales report...</div></div>';

    const {data,error}=await db.rpc('get_sales_report_rows');
    if(error)throw error;
    reportState.rows=data||[];

    const years=reportYears();
    if(!reportState.year||!years.includes(Number(reportState.year)))reportState.year=years[0]||new Date().getFullYear();
    renderSalesReportBody();
  };

  window.setSalesReportView=function(v){
    if(!['month','quarter','year'].includes(v))return;
    reportState.view=v;reportState.repMenuOpen=false;renderSalesReportBody();
  };
  window.setSalesReportYear=function(v){reportState.year=Number(v);reportState.repMenuOpen=false;renderSalesReportBody()};
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
      return (previousNavItems.apply(this,arguments)||[]).map(x=>x[0]==='reports'?['reports','Report',x[2]||'▥']:x);
    };
  }
})();