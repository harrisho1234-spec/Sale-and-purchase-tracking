// Annual company sales target (one 100% goal, two independent 100% allocations).
// Reuses get_sales_report_rows_v5 actual_sales instead of recalculating invoices.
(function(){
  'use strict';
  const T={plans:new Map(),loading:new Set(),reps:null,report:null,userId:null,yearOverview:null,yearOverviewLoading:false,yearOverviewError:null,editYear:null};
  const businessNames={RK:'LP Home (RK)',TK:"L’Imperial Luxury (TK)",PJ:'Project (PJ)'};
  const monthLabels=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  // Exactly 25% per quarter (and 100% per year), while staying within 0.0001% input steps.
  const defaults=[8.3333,8.3333,8.3334,8.3333,8.3333,8.3334,8.3333,8.3333,8.3334,8.3333,8.3333,8.3334];
  const h=v=>String(v==null?'':v).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const n=v=>{const x=Number(v);return Number.isFinite(x)?x:0};
  const moneyLocal=v=>'$'+n(v).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});
  const pct=(part,target)=>target>0?(part/target*100).toFixed(1)+'%':'—';
  const appRole=()=>String(state?.profile?.role||'');
  const isSales=()=>appRole()==='sales';
  function scopedRep(){
    if(typeof managerRepActive==='function'&&managerRepActive()&&typeof managerRepId==='function')return managerRepId();
    return isSales()?state.user?.id||null:null;
  }
  function kind(r){
    if(String(r.sales_category||'').toLowerCase()==='project')return 'PJ';
    const code=String(r.business_code||'').toUpperCase();
    return code==='RK'||code==='TK'?code:'OTHER';
  }
  function monthsInView(S){
    if(S.view==='quarter'){
      const qs=S.selectedQuarters===null?[1,2,3,4]:[...S.selectedQuarters].sort((a,b)=>a-b);
      return qs.map(q=>({label:'Q'+q,months:[q*3-2,q*3-1,q*3]}));
    }
    if(S.view==='year')return [{label:String(S.year),months:Array.from({length:12},(_,i)=>i+1)}];
    const ms=S.selectedMonths===null?Array.from({length:12},(_,i)=>i+1):[...S.selectedMonths].sort((a,b)=>a-b);
    return ms.map(m=>({label:monthLabels[m-1],months:[m]}));
  }
  function matchingRep(r,S){
    const id=scopedRep();
    if(id&&String(r.sales_rep_id)!==String(id))return false;
    if(!id&&S.selectedReps!==null&&!S.selectedReps.has(String(r.sales_rep_id||'__unassigned__')))return false;
    return true;
  }
  function businessFilter(category,which){
    if(which==='all')return true;
    if(which==='RKTK')return category==='RK'||category==='TK';
    return category===which;
  }
  function restrictedRows(S,includeBusiness){
    return (S.rows||[]).filter(r=>{
      if(String(r.order_date||'').slice(0,4)!==String(S.year))return false;
      if(!matchingRep(r,S))return false;
      return !includeBusiness||businessFilter(kind(r),S.business);
    });
  }
  function visibleReportMonths(periods){return new Set(periods.flatMap(x=>x.months))}
  function sumActual(rows,allowedMonths){return rows.reduce((sum,r)=>{
    const mo=Number(String(r.order_date||'').slice(5,7));
    return allowedMonths.has(mo) && kind(r)!=='OTHER'?sum+n(r.actual_sales):sum;
  },0)}
  function targetShares(plan,S){
    const roleId=scopedRep();
    const limitedReps=roleId?[String(roleId)]:S.selectedReps===null?null:[...S.selectedReps];
    const business=S.business;
    const businessSubset=business!=='all';
    if(businessSubset&&limitedReps!==null)
      return {missing:'Targets are allocated by business and by salesperson independently. No cross-category × salesperson target has been assigned.'};
    if(businessSubset){
      if(!plan.can_business&&!plan.can_company&&!plan.can_manage)return {missing:'Business targets are not permitted for this account.'};
      if(!plan.business)return {missing:'Business allocation unavailable.'};
      const share=business==='RKTK'?n(plan.business.RK)+n(plan.business.TK):n(plan.business[business]);
      if(business==='OTHER')return {missing:'Other / unclassified sales have no allocated target. Assign RK, TK or PJ for target reporting.'};
      return {annual:n(plan.annual_target)*share/100,label:business==='RKTK'?'RK + TK':businessNames[business]};
    }
    if(limitedReps!==null){
      const list=(plan.reps||[]).filter(r=>limitedReps.includes(String(r.id)));
      if(!list.length)return {missing:'No allocated target for the selected Sales Rep(s).'};
      return {annual:list.reduce((sum,r)=>sum+n(r.annual_target),0),label:limitedReps.length===1?list[0].name:limitedReps.length+' Sales Reps'};
    }
    if(plan.can_company||plan.can_manage)return {annual:n(plan.annual_target),label:'Company'};
    if(plan.can_team){
      return {annual:(plan.reps||[]).reduce((sum,r)=>sum+n(r.annual_target),0),label:'Allocated Sales Team'};
    }
    return {missing:'Choose your own sales account or request company target permission.'};
  }
  function statusLine(label,actual,target){
    return '<div class="rounded-xl border bg-white px-3 py-3">'+
       '<div class="text-[10px] uppercase font-bold text-gray-500">'+h(label)+'</div>'+
       '<div class="text-lg font-bold mt-1">'+moneyLocal(actual)+'</div>'+
       '<div class="text-[11px] text-gray-600">Target '+moneyLocal(target)+' · <b>'+pct(actual,target)+'</b> achieved</div>'+
       '<div class="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-2"><div class="bg-[#b58a36] h-full rounded-full" style="width:'+Math.min(100,target>0?actual/target*100:0)+'%"></div></div></div>';
  }
  async function loadPlan(year){
    if(T.plans.has(year)||T.loading.has(year))return;
    T.loading.add(year);
    try{
      const r=await db.rpc('get_sales_target_plan',{p_year:year});
      if(r.error)throw r.error;
      T.plans.set(year,r.data||{configured:false,allowed:false});
    }catch(err){T.plans.set(year,{loadError:err.message||'Cannot load targets',allowed:true})}
    finally{
      T.loading.delete(year);
      if(T.report?.year===year&&document.getElementById('salesTargetsPanel'))paint();
    }
  }
  // Target management is independent of the Report's period/year filter.
  // The compact overview only discloses annual amounts to users with
  // targets.manage, enforced again by the database RPC.
  async function loadYearOverview(){
    if(T.yearOverview!==null||T.yearOverviewLoading)return;
    T.yearOverviewLoading=true;
    const uid=T.userId;
    try{
      const res=await db.rpc('get_sales_target_year_overview');
      if(res.error)throw res.error;
      if(T.userId===uid){
        T.yearOverview=Array.isArray(res.data)?res.data:[];
        T.yearOverviewError=null;
      }
    }catch(err){
      if(T.userId===uid)T.yearOverviewError=err.message||'Could not load target years';
    }finally{
      if(T.userId===uid){
        T.yearOverviewLoading=false;
        if(document.getElementById('salesTargetsPanel'))paint();
      }
    }
  }
  window.retrySalesTargetYears=function(){
    T.yearOverviewError=null;
    T.yearOverview=null;
    loadYearOverview();
    paint();
  };
  function targetYearManager(plan){
    if(!plan.can_manage)return '';
    const current=new Date().getFullYear();
    const configured=Array.isArray(T.yearOverview)?T.yearOverview:[];
    const byYear=new Map(configured.map(x=>[Number(x.year),x]));
    const reportYear=Number(T.report?.year);
    const years=[...new Set([
      ...Array.from({length:11},(_,i)=>current+i).filter(y=>y<=2100),
      ...configured.map(x=>Number(x.year)),
      ...(reportYear>=2020&&reportYear<=2100?[reportYear]:[])
    ])].filter(y=>Number.isInteger(y)&&y>=2020&&y<=2100)
      .sort((a,b)=>a>=current&&b>=current?a-b:a>=current?-1:b>=current?1:b-a);
    let cards='';
    if(T.yearOverview===null){
      cards=T.yearOverviewError
        ?'<div class="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700">Target year status unavailable: '+h(T.yearOverviewError)+
         ' <button type="button" onclick="retrySalesTargetYears()" class="underline font-bold ml-2">Retry</button></div>'
        :'<p class="text-xs text-gray-500 py-3">Loading available target years…</p>';
      if(!T.yearOverviewLoading&&!T.yearOverviewError)loadYearOverview();
    }else{
      cards='<div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">'+years.map(y=>{
        const saved=byYear.get(y),isReport=y===reportYear;
        return '<button type="button" onclick="openSalesTargetEditorForYear('+y+')" '+
          'aria-label="'+(saved?'Edit':'Set')+' sales target for '+y+'" '+
          'class="text-left rounded-xl border px-3 py-2.5 transition hover:border-amber-400 hover:bg-amber-50 '+
            (isReport?'border-amber-300 bg-amber-50/40':'border-gray-200 bg-white')+'">'+
          '<div class="flex flex-wrap justify-between gap-1 items-center"><b class="text-sm text-gray-900">'+y+'</b>'+
            '<span class="text-[10px] font-bold '+(saved?'text-emerald-700':'text-amber-800')+'">'+(saved?'Edit':'Set')+' <span aria-hidden="true">↗</span></span></div>'+
          '<div class="text-[11px] mt-1 '+(saved?'font-semibold text-gray-800':'text-gray-500')+'">'+
            (saved?moneyLocal(saved.annual_target):'Not set yet')+'</div></button>';
      }).join('')+'</div>';
    }
    return '<section class="card rounded-2xl p-4 mb-3 border border-amber-100" aria-label="Manage annual targets by year">'+
      '<div class="flex flex-wrap justify-between items-start gap-2 mb-3">'+
        '<div><h3 class="font-bold text-sm">Manage Annual Sales Targets · All Years</h3>'+
        '<p class="text-[11px] text-gray-600 mt-1">Choose a year here to <b>Set or Edit</b> its target. You do not need to change the Report year above. Each year is saved separately.</p></div>'+
        '<span class="text-[10px] rounded-lg border border-gray-200 bg-gray-50 px-2 py-1 text-gray-600">Report displays '+h(reportYear)+'</span>'+
      '</div>'+cards+
      '<form class="flex flex-wrap gap-2 items-center mt-3 pt-3 border-t border-gray-100" onsubmit="event.preventDefault();openSalesTargetCustomYear()">'+
        '<label for="targetYearCustom" class="text-xs font-semibold text-gray-700">Other year</label>'+
        '<input id="targetYearCustom" type="number" min="2020" max="2100" step="1" placeholder="e.g. 2038" class="w-28 border rounded-lg px-3 py-2 text-xs bg-white">'+
        '<button type="submit" class="px-3 py-2 rounded-lg border border-amber-300 text-xs font-semibold text-amber-900 hover:bg-amber-50">Set / Edit Year</button>'+
        '<span class="text-[10px] text-gray-500">2020–2100</span></form>'+
      '</section>';
  }
  window.openSalesTargetCustomYear=function(){
    const field=document.getElementById('targetYearCustom');
    const val=Number(field?.value);
    if(!field?.value||!Number.isInteger(val)||val<2020||val>2100){
      showToast('Enter a whole year between 2020 and 2100.','err');field?.focus();return;
    }
    window.openSalesTargetEditorForYear(val);
  };
  window.openSalesTargetEditorForYear=function(value){
    const year=Number(value);
    if(!Number.isInteger(year)||year<2020||year>2100)return showToast('Choose a year between 2020 and 2100.','err');
    window.openSalesTargetEditor(year);
  };
  function paint(){
    const root=document.getElementById('salesTargetsPanel'),S=T.report;if(!root||!S)return;
    const year=Number(S.year)||new Date().getFullYear();
    const plan=T.plans.get(year);
    if(!plan){root.innerHTML='<div class="card rounded-2xl p-4 text-xs text-gray-500">Loading sales targets…</div>';loadPlan(year);return}
    if(plan.allowed===false){root.innerHTML='';return}
    if(plan.loadError){root.innerHTML='<div class="card rounded-2xl p-4 text-xs text-red-600">Sales target information unavailable: '+h(plan.loadError)+'</div>';return}
    const manager=targetYearManager(plan);
    if(!plan.configured){
      root.innerHTML=manager+'<div class="card rounded-2xl p-4 mb-4 flex flex-wrap items-center justify-between gap-3">'+
       '<div><b>Annual Sales Target Performance · '+year+'</b><p class="text-xs text-gray-600 mt-1">No target set for the Report year '+year+'. '+(plan.can_manage?'Select any year above to set or edit its target.':'Target achievement will appear once a plan is configured.')+'</p></div>'+
       (plan.can_manage?'<button type="button" class="px-4 py-2 bg-[#211d18] text-white text-xs rounded-lg font-bold" onclick="openSalesTargetEditorForYear('+year+')">Set '+year+' Target</button>':'')+'</div>';
      return;
    }
    const periods=monthsInView(S),months=visibleReportMonths(periods),filtered=restrictedRows(S,true),scope=targetShares(plan,S);
    const weights=Array.isArray(plan.months)&&plan.months.length===12?plan.months:defaults;
    const weight=period=>period.months.reduce((total,m)=>total+n(weights[m-1]),0)/100;
    const scopedAnnual=n(scope.annual);
    const hasScope=!scope.missing, target=hasScope?periods.reduce((sum,p)=>sum+scopedAnnual*weight(p),0):0;
    const actual=sumActual(filtered,months);
    const periodData=periods.map(p=>({period:p.label,actual:sumActual(filtered,new Set(p.months)),target:hasScope?scopedAnnual*weight(p):null}));
    window._visibleSalesTargetExport={year,scope:scope.label||'',periodData};
    const progress=hasScope?pct(actual,target):'—';
    const cards=hasScope?
      '<div class="grid grid-cols-2 lg:grid-cols-4 gap-3 my-4">'+
       [['Target · Selected Period',moneyLocal(target)],['Actual · RK/TK/PJ',moneyLocal(actual)],['Achievement',progress],['Remaining',moneyLocal(Math.max(0,target-actual))]]
       .map(x=>'<div class="bg-[#faf9f6] border rounded-xl p-3"><div class="text-[10px] text-gray-500 uppercase font-bold">'+h(x[0])+'</div><div class="text-lg font-bold mt-1">'+h(x[1])+'</div></div>').join('')+'</div>'
      :'<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 mt-3">'+h(scope.missing)+'</div>';
    const categoryAllowed=(plan.can_company||plan.can_business||plan.can_manage) && !!plan.business && S.business==='all' && scopedRep()===null && S.selectedReps===null;
    const repAllowed=(plan.can_company||plan.can_team||plan.can_manage||plan.can_own)&&S.business==='all';
    const yrRows=restrictedRows(S,false);
    const bottom=[];
    if(categoryAllowed)bottom.push('<div class="card rounded-2xl p-4"><h4 class="font-bold mb-3">Business Allocation · 100%</h4>'+
       '<div class="grid sm:grid-cols-3 gap-2">'+['RK','TK','PJ'].map(code=>{
         const a=sumActual(yrRows.filter(r=>kind(r)===code),months);
         return statusLine(businessNames[code]+' · '+n(plan.business[code])+'%',a,n(plan.annual_target)*n(plan.business[code])/100*periods.reduce((sum,p)=>sum+weight(p),0));
       }).join('')+'</div></div>');
    if(repAllowed&&plan.reps?.length)bottom.push(
       '<div class="card rounded-2xl p-4"><h4 class="font-bold mb-2">Sales Rep Allocation · 100% of Company</h4>'+
       '<p class="text-[11px] text-gray-500 mb-3">Each salesperson percentage applies to the full company target across RK + TK + PJ, not a showroom percentage.</p>'+
       '<div class="overflow-x-auto"><table class="w-full text-xs"><thead><tr class="bg-[#faf9f6] text-gray-600">'+
       '<th class="text-left px-3 py-2">Sales Rep</th><th class="text-right px-3 py-2">Share</th><th class="text-right px-3 py-2">Target</th><th class="text-right px-3 py-2">Actual</th><th class="text-right px-3 py-2">Reached</th></tr></thead><tbody>'+
       plan.reps.filter(r=>!scopedRep()||String(r.id)===String(scopedRep())).filter(r=>S.selectedReps===null||S.selectedReps.has(String(r.id))).map(rep=>{
         const t=n(rep.annual_target)*periods.reduce((sum,p)=>sum+weight(p),0);
         const a=sumActual(yrRows.filter(r=>String(r.sales_rep_id)===String(rep.id)),months);
         return '<tr class="border-t"><td class="px-3 py-2 font-medium">'+h(rep.name)+'</td><td class="px-3 py-2 text-right">'+n(rep.percentage)+'%</td>'+
           '<td class="px-3 py-2 text-right">'+moneyLocal(t)+'</td><td class="px-3 py-2 text-right">'+moneyLocal(a)+'</td>'+
           '<td class="px-3 py-2 text-right font-bold">'+pct(a,t)+'</td></tr>';
       }).join('')+'</tbody></table></div></div>');
    root.innerHTML=manager+'<div class="card rounded-2xl p-4 mb-4">'+
      '<div class="flex flex-wrap items-center justify-between gap-3">'+
      '<div><h3 class="text-lg font-bold">Annual Sales Target · '+year+'</h3>'+
      '<p class="text-xs font-semibold text-[#8a6514] mt-1">Target scope: '+h(scope.label||'Selected filters')+'</p>'+
      '<p class="text-[11px] text-gray-600 mt-1">Based on the existing Actual Sales formula. RK / TK / PJ and sales rep allocations are two independent views of the same 100% goal.</p></div>'+
      '<div class="flex gap-2 flex-wrap">'+(plan.can_export?'<button type="button" onclick="exportSalesTargetPerformance()" class="border rounded-lg px-3 py-2 text-xs font-semibold">Export CSV</button>':'')+
      (plan.can_manage?'<button type="button" onclick="openSalesTargetEditor()" class="bg-[#211d18] text-white rounded-lg px-3 py-2 text-xs font-semibold">Manage Targets</button>':'')+'</div></div>'+
      cards+
      '<div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-[#faf9f6] text-gray-600"><tr>'+
      '<th class="px-3 py-2 text-left">Period</th><th class="px-3 py-2 text-right">Target</th><th class="px-3 py-2 text-right">Actual Sales</th><th class="px-3 py-2 text-right">Achieved</th></tr></thead><tbody>'+
      periodData.map(p=>'<tr class="border-t"><td class="px-3 py-2 font-semibold">'+h(p.period)+'</td>'+
       '<td class="px-3 py-2 text-right">'+(p.target===null?'—':moneyLocal(p.target))+'</td>'+
       '<td class="px-3 py-2 text-right">'+moneyLocal(p.actual)+'</td>'+
       '<td class="px-3 py-2 text-right font-bold">'+(p.target===null?'—':pct(p.actual,p.target))+'</td></tr>').join('')+
      '</tbody></table></div><p class="text-[10px] text-gray-500 mt-3">Actual uses Invoice + Pre-payment − active Returns. Uncategorized “OTHER” sales remain in the main Sales Report but are excluded from target achievement until classified RK, TK, or PJ. Combined Sales Rep × Business targets are not estimated.</p>'+
      '</div><div class="grid gap-4 mb-4">'+bottom.join('')+'</div>';
  }
  window.renderSalesTargetsPanel=function(S){
    // Avoid leaking a previous logged-in account's target cache when accounts switch.
    const uid=String(state?.user?.id||'');
    if(T.userId!==uid){
      T.userId=uid;T.plans.clear();T.loading.clear();T.reps=null;
      T.yearOverview=null;T.yearOverviewError=null;T.yearOverviewLoading=false;T.editYear=null;
    }
    T.report=S;paint();
  };
  window.exportSalesTargetPerformance=function(){
    const year=Number(T.report?.year),plan=T.plans.get(year);
    if(!plan?.can_export)return showToast('Target export permission required.','err');
    const src=window._visibleSalesTargetExport;if(!src)return;
    const rows=[['Year','Scope','Period','Target USD','Actual USD','Achievement %']];
    for(const p of src.periodData)rows.push([year,src.scope,p.period,p.target===null?'':p.target.toFixed(2),p.actual.toFixed(2),p.target>0?(p.actual/p.target*100).toFixed(2):'']);
    const csv=rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
    const link=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8;'}));
    link.href=url;link.download='LImperial_Sales_Target_'+year+'.csv';document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);
  };
  async function loadRepOptions(){
    if(T.reps)return T.reps;
    const r=await db.rpc('get_sales_target_reps');
    if(r.error)throw r.error;
    T.reps=Array.isArray(r.data)?r.data:[];
    return T.reps;
  }
  function validateTotal(values){return values.reduce((sum,v)=>sum+n(v),0)}
  function itemInput(id,val,step='0.01'){
    return '<input type="number" min="0" max="100" step="'+step+'" id="'+id+'" value="'+h(val)+'" class="target-percent w-24 max-w-full px-2 py-2 rounded-lg border bg-white text-sm text-right" oninput="updateSalesTargetTotals()" aria-label="'+h(id)+' percentage">';
  }
  window.openSalesTargetEditor=async function(requestedYear){
    const year=requestedYear===undefined?(Number(T.report?.year)||new Date().getFullYear()):Number(requestedYear);
    if(!Number.isInteger(year)||year<2020||year>2100)return showToast('Choose a year between 2020 and 2100.','err');
    if(!T.plans.has(year))await loadPlan(year);
    const plan=T.plans.get(year);
    if(!plan?.can_manage)return showToast('Target management permission required.','err');
    try{
      const list=await loadRepOptions();
      T.editYear=year;
      const saved=new Map((plan.reps||[]).map(r=>[String(r.id),n(r.percentage)]));
      const business=plan.business||{RK:40,TK:40,PJ:20};
      const months=plan.months||defaults;
      const content='<form id="salesTargetForm" class="space-y-4">'+
        '<div class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900">Setting the <b>'+year+'</b> annual target only. Each year (2026, 2027, 2028 and beyond) has its own saved plan. One company target = 100%. Business RK/TK/PJ totals 100%; sales reps independently total 100%. Neither allocation multiplies the other.</div>'+
        '<label class="block text-xs font-semibold">Company Annual Target (USD) *<input id="targetAnnualUSD" type="number" min="0.01" step="0.01" required value="'+(plan.configured?n(plan.annual_target):'')+'" placeholder="Enter annual USD amount" class="block mt-1 w-full border rounded-xl px-3 py-2.5 text-sm"></label>'+
        '<section class="border rounded-xl p-3"><h4 class="text-sm font-bold mb-2">Business allocations · must total 100%</h4>'+
          '<div class="grid sm:grid-cols-3 gap-2">'+['RK','TK','PJ'].map(code=>'<label class="flex items-center justify-between gap-2 text-xs">'+h(businessNames[code])+itemInput('targetBiz_'+code,n(business[code]))+'</label>').join('')+
          '</div><p id="targetBusinessTotal" class="text-xs mt-2"></p></section>'+
        '<section class="border rounded-xl p-3"><h4 class="text-sm font-bold mb-2">Sales rep allocations · must independently total 100%</h4>'+
          '<p class="text-[11px] text-gray-500 mb-2">Assign a percentage of the TOTAL company target to each salesperson. Set 0% for anyone not allocated.</p>'+
          (list.length?'<div class="max-h-64 overflow-y-auto grid sm:grid-cols-2 gap-2">'+list.map(rep=>'<label class="flex justify-between items-center gap-3 text-xs border-b py-2"><span class="min-w-0">'+h(rep.name)+(rep.active===false?' (Inactive)':'')+'</span>'+itemInput('targetRep_'+rep.id,saved.get(String(rep.id))||0)+'</label>').join('')+'</div>':
          '<div class="p-3 text-sm text-red-700">No Sales Reps found. Set up salesperson accounts first.</div>')+
          '<p id="targetRepsTotal" class="text-xs mt-2"></p></section>'+
        '<section class="border rounded-xl p-3"><h4 class="text-sm font-bold mb-1">Monthly target weighting · must total 100%</h4>'+
        '<p class="text-[11px] text-gray-500 mb-2">Default is equal months. Increase seasonal months and reduce others as needed. Quarterly targets are the sum of their three months.</p>'+
        '<div class="grid grid-cols-3 sm:grid-cols-4 gap-3">'+monthLabels.map((label,i)=>'<label class="text-xs">'+label+' (%)'+itemInput('targetMonth_'+(i+1),n(months[i]),'0.0001')+'</label>').join('')+'</div>'+
        '<p id="targetMonthsTotal" class="text-xs mt-2"></p></section>'+
        '<div class="flex justify-end gap-2"><button type="button" onclick="closeModal()" class="px-4 py-2 rounded-lg border text-xs font-semibold">Cancel</button>'+
        '<button type="submit" id="targetSave" class="px-4 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Save Annual Targets</button></div></form>';
      openModal('Annual Sales Targets · '+year,content);
      document.getElementById('salesTargetForm').onsubmit=window.saveSalesTargetPlan;
      updateSalesTargetTotals();
    }catch(err){showToast(err.message||'Cannot load target editor.','err')}
  };
  window.updateSalesTargetTotals=function(){
    function print(id,sum){const el=document.getElementById(id);if(!el)return;const valid=Math.abs(sum-100)<0.011;
      el.textContent='Allocated: '+sum.toFixed(4).replace(/0+$/,'').replace(/\.$/,'')+'% · '+(valid?'Balanced':'Must equal 100%');
      el.className='text-xs font-semibold mt-2 '+(valid?'text-green-700':'text-red-700');
    }
    print('targetBusinessTotal',validateTotal(['RK','TK','PJ'].map(c=>document.getElementById('targetBiz_'+c)?.value)));
    print('targetRepsTotal',validateTotal((T.reps||[]).map(r=>document.getElementById('targetRep_'+r.id)?.value)));
    print('targetMonthsTotal',validateTotal(monthLabels.map((_,i)=>document.getElementById('targetMonth_'+(i+1))?.value)));
  };
  window.saveSalesTargetPlan=async function(event){
    event?.preventDefault?.();
    const year=Number(T.editYear),existing=T.plans.get(year);
    if(!existing?.can_manage)return showToast('Target management permission required.','err');
    const annual=n(document.getElementById('targetAnnualUSD')?.value);
    const biz=Object.fromEntries(['RK','TK','PJ'].map(c=>[c,n(document.getElementById('targetBiz_'+c)?.value)]));
    const reps=(T.reps||[]).map(r=>({id:r.id,percentage:n(document.getElementById('targetRep_'+r.id)?.value)})).filter(r=>r.percentage>0);
    const months=monthLabels.map((_,i)=>n(document.getElementById('targetMonth_'+(i+1))?.value));
    const checks=[validateTotal(Object.values(biz)),validateTotal(reps.map(x=>x.percentage)),validateTotal(months)];
    if(annual<=0||checks.some(x=>Math.abs(x-100)>0.011)||!reps.length)
      return showToast('Enter a positive annual target and make Business, Sales Rep and Monthly allocations each total 100%.','err');
    const button=document.getElementById('targetSave');if(button){button.disabled=true;button.textContent='Saving…'}
    try{
      const r=await db.rpc('save_sales_target_plan',{p_year:year,p_annual_target:annual,p_business:biz,p_reps:reps,p_months:months});
      if(r.error)throw r.error;
      T.plans.delete(year);
      T.yearOverview=null;
      T.yearOverviewError=null;
      T.editYear=null;
      closeModal();
      showToast('Annual sales targets saved for '+year+'.');
      await Promise.all([loadPlan(year),loadYearOverview()]);
      paint();
    }catch(err){showToast(err.message||'Could not save annual targets.','err')}
    finally{if(button?.isConnected){button.disabled=false;button.textContent='Save Annual Targets'}}
  };
})();