// Unified Report tabs: Sales + Showroom + Online customer activity reports.
(function(){
  const baseRenderReports=window.renderReports;
  if(typeof baseRenderReports!=='function')return;

  const activityReportState={
    section:'sales',
    type:'showroom_visit',
    rows:[],
    salesUsers:[],
    view:'month',
    year:null,
    selectedMonths:null,
    selectedQuarters:null,
    periodMenuOpen:false,
    selectedReps:null,
    repMenuOpen:false,
    business:'all',
    loaded:{showroom_visit:false,online:false},
    cache:{showroom_visit:[],online:[]}
  };

  const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const STAGES=['Contacting','Potential','Waiting Decision','Buy','Reject'];

  function role(){return state.profile?.role||''}
  function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
  function yOf(v){const y=Number(String(v||'').slice(0,4));return Number.isFinite(y)?y:null}
  function mOf(v){const m=Number(String(v||'').slice(5,7));return m>=1&&m<=12?m:null}
  function qOf(v){const m=mOf(v);return m?Math.floor((m-1)/3)+1:null}
  function todayIso(){
    const d=new Date(),off=d.getTimezoneOffset();
    return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
  }
  function normalizePhone(v){
    let s=String(v||'').replace(/\D/g,'');
    if(s.startsWith('00855'))s='0'+s.slice(5);
    else if(s.startsWith('855'))s='0'+s.slice(3);
    return s;
  }
  function identityKey(r){
    const phone=normalizePhone(r.phone);
    if(phone)return 'p:'+phone;
    if(r.linked_customer_id)return 'c:'+r.linked_customer_id;
    const name=String(r.customer_name||'').trim().toLowerCase().replace(/\s+/g,' ');
    return name?'n:'+name+'|'+String(r.business_code||''):'r:'+r.id;
  }
  function activityScopeUserId(){
    if(typeof managerRepActive==='function'&&managerRepActive())return managerRepId();
    if(typeof managerTestActive==='function'&&managerTestActive())return state.managerRepContext?.user_id||null;
    if(['sales','manager'].includes(role()))return state.user?.id||null;
    return null;
  }
  function canChooseActivityReps(){
    return !activityScopeUserId()&&['admin','super_admin'].includes(role());
  }
  function unifiedTabs(active){
    const tabs=[
      ['sales','Sales Report'],
      ['showroom','Showroom Report'],
      ['online','Online Report']
    ];
    return '<div class="card rounded-2xl p-2 mb-4"><div class="flex flex-wrap gap-2">'+tabs.map(([id,label])=>
      '<button type="button" onclick="setUnifiedReportSection(\''+id+'\')" class="px-4 py-2.5 rounded-xl text-sm font-semibold border '+(active===id?'bg-[#fff4d6] border-[#d6a532] text-[#8a6514]':'bg-white text-gray-600')+'">'+label+'</button>'
    ).join('')+'</div></div>';
  }
  function installUnifiedTabs(active){
    const content=document.getElementById('content');
    if(!content)return;
    const old=document.getElementById('unifiedReportTabs');
    if(old)old.remove();
    const wrap=document.createElement('div');
    wrap.id='unifiedReportTabs';
    wrap.innerHTML=unifiedTabs(active);
    content.insertBefore(wrap,content.firstChild);
  }

  function activityYears(){
    const rows=activityReportState.rows||[];
    const years=[...new Set(rows.map(r=>yOf(r.activity_date)).filter(Boolean))].sort((a,b)=>b-a);
    return years.length?years:[new Date().getFullYear()];
  }
  function currentActivityRepRows(){
    const map=new Map();
    (activityReportState.rows||[]).forEach(r=>{
      const id=r.assigned_sales_id||'__unassigned__';
      if(!map.has(id))map.set(id,{key:id,name:r.sales_rep_name||'Unassigned'});
    });
    (activityReportState.salesUsers||[]).forEach(u=>{
      if(!map.has(u.user_id))map.set(u.user_id,{key:u.user_id,name:u.display_name||u.email||'Sales'});
    });
    return [...map.values()].sort((a,b)=>String(a.name).localeCompare(String(b.name)));
  }
  function activityRepSelected(key){
    return activityReportState.selectedReps===null||activityReportState.selectedReps.has(key);
  }
  function activityRepLabel(){
    const scope=activityScopeUserId();
    if(scope){
      const row=(activityReportState.rows||[]).find(r=>String(r.assigned_sales_id||r.created_by||'')===String(scope));
      return row?.sales_rep_name||state.profile?.display_name||state.user?.email||'My Activity';
    }
    if(activityReportState.selectedReps===null)return 'All Sales Reps';
    const count=activityReportState.selectedReps.size;
    if(!count)return 'No Sales Reps';
    if(count===1){
      const key=[...activityReportState.selectedReps][0];
      return currentActivityRepRows().find(x=>x.key===key)?.name||'1 Sales Rep';
    }
    return count+' Sales Reps';
  }
  function periodLabel(){
    if(activityReportState.view==='month'){
      if(activityReportState.selectedMonths===null)return 'All Months';
      const vals=[...activityReportState.selectedMonths].sort((a,b)=>a-b);
      if(!vals.length)return 'No Months';
      if(vals.length<=3)return vals.map(m=>MONTHS[m-1]).join(', ');
      return vals.length+' Months';
    }
    if(activityReportState.view==='quarter'){
      if(activityReportState.selectedQuarters===null)return 'All Quarters';
      const vals=[...activityReportState.selectedQuarters].sort((a,b)=>a-b);
      if(!vals.length)return 'No Quarters';
      if(vals.length<=3)return vals.map(q=>'Q'+q).join(', ');
      return vals.length+' Quarters';
    }
    return 'All Years';
  }
  function periodMenu(){
    if(activityReportState.view==='year')return '';
    const isMonth=activityReportState.view==='month';
    const values=isMonth?MONTHS.map((label,i)=>({key:i+1,label})):[1,2,3,4].map(q=>({key:q,label:'Q'+q}));
    const selected=isMonth?activityReportState.selectedMonths:activityReportState.selectedQuarters;
    return '<div class="'+(activityReportState.periodMenuOpen?'':'hidden ')+'absolute z-[95] right-0 mt-2 w-[240px] max-h-[380px] overflow-y-auto bg-white border rounded-xl shadow-xl p-2">'
      +'<label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"><input type="checkbox" '+(selected===null?'checked':'')+' onchange="activityReportSelectAllPeriods(this.checked)"><span class="font-semibold text-sm">'+(isMonth?'All Months':'All Quarters')+'</span></label>'
      +'<div class="border-t my-1"></div>'
      +values.map(x=>'<label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"><input type="checkbox" '+(selected===null||selected.has(x.key)?'checked':'')+' onchange="activityReportTogglePeriod('+x.key+',this.checked)"><span class="text-sm">'+x.label+'</span></label>').join('')
      +'</div>';
  }
  function repMenu(){
    const reps=currentActivityRepRows();
    return '<div class="'+(activityReportState.repMenuOpen?'':'hidden ')+'absolute z-[95] right-0 mt-2 w-[300px] max-h-[360px] overflow-y-auto bg-white border rounded-xl shadow-xl p-2">'
      +'<label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"><input type="checkbox" '+(activityReportState.selectedReps===null?'checked':'')+' onchange="activityReportSelectAllReps(this.checked)"><span class="font-semibold text-sm">All Sales Reps</span></label>'
      +'<div class="border-t my-1"></div>'
      +reps.map(r=>'<label class="flex items-center gap-2 px-3 py-2 rounded-lg hover:bg-gray-50 cursor-pointer"><input type="checkbox" '+(activityRepSelected(r.key)?'checked':'')+' onchange="activityReportToggleRep(\''+esc(r.key)+'\',this.checked)"><span class="text-sm">'+esc(r.name)+'</span></label>').join('')
      +'</div>';
  }
  function activityInScope(r){
    const scope=activityScopeUserId();
    if(scope){
      const mine=String(r.assigned_sales_id||'')===String(scope)||String(r.created_by||'')===String(scope);
      if(!mine)return false;
    }
    if(canChooseActivityReps()&&activityReportState.selectedReps!==null){
      const key=r.assigned_sales_id||'__unassigned__';
      if(!activityReportState.selectedReps.has(key))return false;
    }
    if(activityReportState.business!=='all'&&r.business_code!==activityReportState.business)return false;
    if(activityReportState.view!=='year'){
      if(yOf(r.activity_date)!==Number(activityReportState.year))return false;
      if(activityReportState.view==='month'&&activityReportState.selectedMonths!==null){
        const m=mOf(r.activity_date);
        if(!m||!activityReportState.selectedMonths.has(m))return false;
      }
      if(activityReportState.view==='quarter'&&activityReportState.selectedQuarters!==null){
        const q=qOf(r.activity_date);
        if(!q||!activityReportState.selectedQuarters.has(q))return false;
      }
    }
    return true;
  }
  function filteredActivityRows(){
    return (activityReportState.rows||[]).filter(activityInScope);
  }
  function latestCustomerRows(rows){
    const map=new Map();
    rows.forEach(r=>{
      const key=identityKey(r);
      const old=map.get(key);
      const stamp=String(r.activity_date||'')+'T'+String(r.created_at||'');
      const oldStamp=old?(String(old.activity_date||'')+'T'+String(old.created_at||'')):'';
      if(!old||stamp>=oldStamp)map.set(key,r);
    });
    return [...map.values()];
  }
  function stageCounts(rows){
    const out={Contacting:0,Potential:0,'Waiting Decision':0,Buy:0,Reject:0,Other:0};
    rows.forEach(r=>{
      const s=String(r.status||'').trim();
      if(Object.prototype.hasOwnProperty.call(out,s))out[s]++;
      else out.Other++;
    });
    return out;
  }
  function periodBuckets(rows){
    const make=(key,label)=>({key,label,total:0,unique:0,rk:0,tk:0,buy:0,followup:0,contacting:0,reject:0,conversion:0});
    let buckets=[];
    if(activityReportState.view==='month'){
      buckets=MONTHS.map((label,i)=>make(i+1,label));
      if(activityReportState.selectedMonths!==null)buckets=buckets.filter(x=>activityReportState.selectedMonths.has(x.key));
    }else if(activityReportState.view==='quarter'){
      buckets=[1,2,3,4].map(q=>make(q,'Q'+q));
      if(activityReportState.selectedQuarters!==null)buckets=buckets.filter(x=>activityReportState.selectedQuarters.has(x.key));
    }else{
      buckets=[...new Set(rows.map(r=>yOf(r.activity_date)).filter(Boolean))].sort((a,b)=>a-b).map(y=>make(y,String(y)));
    }
    buckets.forEach(b=>{
      const br=rows.filter(r=>{
        if(activityReportState.view==='month')return mOf(r.activity_date)===b.key;
        if(activityReportState.view==='quarter')return qOf(r.activity_date)===b.key;
        return yOf(r.activity_date)===b.key;
      });
      const customers=latestCustomerRows(br);
      const sc=stageCounts(customers);
      b.total=br.length;
      b.unique=customers.length;
      b.rk=br.filter(r=>r.business_code==='RK').length;
      b.tk=br.filter(r=>r.business_code==='TK').length;
      b.buy=sc.Buy;
      b.followup=sc.Potential+sc['Waiting Decision'];
      b.contacting=sc.Contacting;
      b.reject=sc.Reject;
      b.conversion=b.unique?b.buy/b.unique*100:0;
    });
    return buckets;
  }
  function activitySummary(rows){
    const customers=latestCustomerRows(rows);
    const stages=stageCounts(customers);
    const today=todayIso();
    const active=customers.filter(r=>['Potential','Waiting Decision','Contacting'].includes(String(r.status||'')));
    const overdue=active.filter(r=>r.follow_up_date&&String(r.follow_up_date)<today).length;
    const scheduled=active.filter(r=>r.follow_up_date&&String(r.follow_up_date)>=today).length;
    const unassigned=rows.filter(r=>!r.assigned_sales_id).length;
    return {
      total:rows.length,
      unique:customers.length,
      buy:stages.Buy,
      followup:stages.Potential+stages['Waiting Decision'],
      contacting:stages.Contacting,
      reject:stages.Reject,
      conversion:customers.length?stages.Buy/customers.length*100:0,
      overdue,scheduled,unassigned,
      customers,stages
    };
  }
  function activityKpi(label,value,sub,cls=''){
    return '<div class="card rounded-2xl p-4"><div class="text-[10px] uppercase tracking-wide font-bold text-gray-400">'+esc(label)+'</div><div class="text-2xl font-bold mt-1 '+cls+'">'+esc(String(value))+'</div><div class="text-[10px] text-gray-400 mt-1">'+esc(sub)+'</div></div>';
  }
  function activityBarList(title,subtitle,items,total){
    const max=Math.max(...items.map(x=>x.value),0);
    return '<div class="card rounded-2xl p-4"><div class="mb-4"><h4 class="font-bold">'+esc(title)+'</h4><div class="text-[10px] text-gray-400 mt-1">'+esc(subtitle)+'</div></div><div class="space-y-3">'
      +(items.length?items.map(x=>{
        const width=max?Math.max(x.value/max*100,x.value?2:0):0;
        const share=total?x.value/total*100:0;
        return '<div><div class="flex justify-between gap-3 text-xs mb-1"><span class="font-semibold">'+esc(x.label)+'</span><span><b>'+x.value+'</b><span class="text-gray-400 ml-1">'+share.toFixed(1)+'%</span></span></div><div class="h-2 rounded-full bg-gray-100 overflow-hidden"><div class="h-full bg-[#b88a2c] rounded-full" style="width:'+width+'%"></div></div></div>';
      }).join(''):'<div class="py-10 text-center text-sm text-gray-400">No data for this selection.</div>')
      +'</div></div>';
  }
  function topInterests(rows){
    const map=new Map();
    rows.forEach(r=>{
      const raw=String(r.interest||'').trim();
      if(!raw)return;
      const key=raw.toLowerCase();
      if(!map.has(key))map.set(key,{label:raw,value:0});
      map.get(key).value++;
    });
    return [...map.values()].sort((a,b)=>b.value-a.value).slice(0,10);
  }
  function repBreakdown(rows){
    const map=new Map();
    rows.forEach(r=>{
      const key=r.assigned_sales_id||'__unassigned__';
      if(!map.has(key))map.set(key,{name:r.sales_rep_name||'Unassigned',entries:0,unique:new Set(),buy:0});
      const x=map.get(key);
      x.entries++;
      x.unique.add(identityKey(r));
    });
    const latest=latestCustomerRows(rows);
    latest.forEach(r=>{
      const key=r.assigned_sales_id||'__unassigned__';
      const x=map.get(key);
      if(x&&String(r.status||'')==='Buy')x.buy++;
    });
    return [...map.values()].map(x=>({name:x.name,entries:x.entries,unique:x.unique.size,buy:x.buy,conversion:x.unique.size?x.buy/x.unique.size*100:0})).sort((a,b)=>b.entries-a.entries);
  }
  function sourceBreakdown(rows){
    const map=new Map();
    rows.forEach(r=>{
      const label=String(r.source_channel||'Unknown').trim()||'Unknown';
      map.set(label,(map.get(label)||0)+1);
    });
    return [...map.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);
  }

  async function ensureActivityData(type){
    if(!activityReportState.salesUsers.length){
      const u=await db.rpc('get_activity_pic_options');
      if(!u.error)activityReportState.salesUsers=u.data||[];
    }
    if(activityReportState.loaded[type]){
      activityReportState.rows=activityReportState.cache[type]||[];
      return;
    }
    const res=await db.rpc('get_customer_activity_rows',{p_activity_type:type});
    if(res.error)throw res.error;
    activityReportState.cache[type]=res.data||[];
    activityReportState.loaded[type]=true;
    activityReportState.rows=activityReportState.cache[type];
  }
  function periodButtons(){
    const btn=(id,label)=>'<button type="button" onclick="setActivityReportView(\''+id+'\')" class="px-4 py-2 rounded-lg text-xs font-semibold '+(activityReportState.view===id?'bg-[#b88a2c] text-white border border-[#b88a2c]':'bg-white border text-gray-600')+'">'+label+'</button>';
    return '<div class="flex gap-1 p-1 rounded-xl bg-[#f7f5f1]">'+btn('month','By Month')+btn('quarter','By Quarter')+btn('year','By Year')+'</div>';
  }

  function renderActivityReportBody(){
    const root=document.getElementById('activityReportRoot');if(!root)return;
    const rows=filteredActivityRows();
    const summary=activitySummary(rows);
    const buckets=periodBuckets(rows);
    const reps=repBreakdown(rows);
    const interests=topInterests(rows);
    const sources=sourceBreakdown(rows);
    const years=activityYears();
    const type=activityReportState.type;
    const isShowroom=type==='showroom_visit';
    const noun=isShowroom?'Visits':'Inquiries';
    const maxBucket=Math.max(...buckets.map(x=>x.total),0);

    const funnel=[
      {label:'Contacting / Just Asking',value:summary.stages.Contacting},
      {label:'Potential',value:summary.stages.Potential},
      {label:'Waiting Decision',value:summary.stages['Waiting Decision']},
      {label:'Buy',value:summary.stages.Buy},
      {label:'Reject',value:summary.stages.Reject}
    ];

    const yearSelect=activityReportState.view==='year'?'':('<select onchange="setActivityReportYear(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">'+years.map(y=>'<option value="'+y+'" '+(Number(activityReportState.year)===y?'selected':'')+'>'+y+'</option>').join('')+'</select>');

    root.innerHTML=
      '<div class="card rounded-2xl p-4 mb-4"><div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3"><div><h3 class="font-bold text-lg">'+(isShowroom?'Showroom Report':'Online Report')+'</h3><p class="text-[11px] text-gray-400 mt-1">'+(isShowroom?'Tracks showroom traffic, unique customers, stage mix and conversion by RK/TK showroom.':'Tracks online inquiries, unique customers, stage funnel, assignment and conversion by RK/TK page.')+'</p></div><div class="flex flex-wrap items-center gap-2">'
      +periodButtons()+yearSelect
      +(activityReportState.view!=='year'?'<div class="relative"><button type="button" onclick="toggleActivityReportPeriodMenu()" class="min-w-[150px] flex items-center justify-between gap-3 border rounded-xl bg-white px-3 py-2.5 text-sm"><span class="truncate">'+esc(periodLabel())+'</span><span class="text-gray-400">⌄</span></button>'+periodMenu()+'</div>':'')
      +'<select onchange="setActivityReportBusiness(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm min-w-[160px]"><option value="all">All Business</option><option value="RK" '+(activityReportState.business==='RK'?'selected':'')+'>LP Home · RK</option><option value="TK" '+(activityReportState.business==='TK'?'selected':'')+'>L\'Imperial Luxury · TK</option></select>'
      +(canChooseActivityReps()?'<div class="relative"><button type="button" onclick="toggleActivityReportRepMenu()" class="min-w-[180px] flex items-center justify-between gap-3 border rounded-xl bg-white px-3 py-2.5 text-sm"><span class="truncate">'+esc(activityRepLabel())+'</span><span class="text-gray-400">⌄</span></button>'+repMenu()+'</div>':'<div class="min-w-[170px] border rounded-xl bg-[#faf9f6] px-3 py-2.5 text-sm font-semibold text-gray-600">'+esc(activityRepLabel())+'</div>')
      +'</div></div></div>'

      +'<div class="grid grid-cols-2 xl:grid-cols-4 gap-3 mb-3">'
      +activityKpi('Total '+noun,summary.total,isShowroom?'All showroom entries in selection':'All online inquiry entries in selection')
      +activityKpi('Unique Customers',summary.unique,'Phone/customer identity counted once')
      +activityKpi('Buy',summary.buy,'Unique customers currently at Buy','text-green-600')
      +activityKpi('Buy Conversion',summary.conversion.toFixed(1)+'%','Buy ÷ unique customers','text-[#8a6514]')
      +'</div>'

      +'<div class="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">'
      +activityKpi('Follow-up / Active',summary.followup,'Potential + Waiting Decision')
      +activityKpi('Just Asking',summary.contacting,'Contacting / early stage')
      +activityKpi('Reject',summary.reject,'Unique customers rejected','text-red-600')
      +activityKpi('Overdue Follow-up',summary.overdue,'Active customers past follow-up date','text-amber-600')
      +activityKpi(isShowroom?'Scheduled Follow-up':'Unassigned Inquiries',isShowroom?summary.scheduled:summary.unassigned,isShowroom?'Upcoming scheduled follow-ups':'Entries without Person In Charge')
      +'</div>'

      +'<div class="grid xl:grid-cols-[1.2fr_.8fr] gap-4">'
      +'<div class="card rounded-2xl p-4"><div class="flex items-center justify-between gap-3 mb-4"><div><h4 class="font-bold">'+noun+' by '+(activityReportState.view==='month'?'Month':activityReportState.view==='quarter'?'Quarter':'Year')+'</h4><div class="text-[10px] text-gray-400 mt-1">'+(activityReportState.view==='year'?'All available years':String(activityReportState.year)+' · '+periodLabel())+'</div></div><div class="text-xs text-gray-400">'+esc(activityRepLabel())+'</div></div><div class="space-y-3">'
      +(buckets.length?buckets.map(b=>{const width=maxBucket?Math.max(b.total/maxBucket*100,b.total?2:0):0;return '<div><div class="flex items-center justify-between gap-3 text-xs mb-1"><div class="font-semibold w-14">'+esc(b.label)+'</div><div class="flex-1 text-right"><b>'+b.total+' '+noun.toLowerCase()+'</b><span class="text-gray-400 ml-2">'+b.unique+' unique</span></div></div><div class="ml-14 h-2 rounded-full bg-gray-100 overflow-hidden"><div class="h-full rounded-full bg-[#b3871e]" style="width:'+width+'%"></div></div><div class="ml-14 mt-1 text-[9px] text-gray-400">RK '+b.rk+' · TK '+b.tk+' · Buy '+b.buy+' · Conversion '+b.conversion.toFixed(1)+'%</div></div>';}).join(''):'<div class="py-12 text-center text-sm text-gray-400">No '+noun.toLowerCase()+' for this selection.</div>')
      +'</div></div>'

      +'<div class="card rounded-2xl overflow-hidden"><div class="px-4 py-3 border-b"><h4 class="font-bold">Period Summary</h4></div><div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-[#faf9f6] text-gray-400 uppercase text-[9px]"><tr><th class="text-left px-3 py-2">Period</th><th class="text-right px-3 py-2">'+noun+'</th><th class="text-right px-3 py-2">Unique</th><th class="text-right px-3 py-2">RK</th><th class="text-right px-3 py-2">TK</th><th class="text-right px-3 py-2">Buy</th><th class="text-right px-3 py-2">Conv.</th></tr></thead><tbody class="divide-y">'+buckets.map(b=>'<tr><td class="px-3 py-2 font-semibold">'+esc(b.label)+'</td><td class="px-3 py-2 text-right font-bold">'+b.total+'</td><td class="px-3 py-2 text-right">'+b.unique+'</td><td class="px-3 py-2 text-right">'+b.rk+'</td><td class="px-3 py-2 text-right">'+b.tk+'</td><td class="px-3 py-2 text-right text-green-600">'+b.buy+'</td><td class="px-3 py-2 text-right">'+b.conversion.toFixed(1)+'%</td></tr>').join('')+'</tbody></table></div></div>'
      +'</div>'

      +'<div class="grid xl:grid-cols-2 gap-4 mt-4">'
      +activityBarList('Customer Stage Funnel','Unique customers classified by their latest stage in the selected period.',funnel,summary.unique)
      +activityBarList(isShowroom?'Visit Source':'Top Interests',isShowroom?'Where showroom customers came from.':'Most common product interests from online inquiries.',isShowroom?sources:interests,isShowroom?rows.length:rows.filter(r=>String(r.interest||'').trim()).length)
      +'</div>'

      +'<div class="grid xl:grid-cols-2 gap-4 mt-4">'
      +'<div class="card rounded-2xl p-4"><div class="mb-4"><h4 class="font-bold">RK / TK Summary</h4><div class="text-[10px] text-gray-400 mt-1">'+(isShowroom?'Customer traffic by showroom.':'Inquiry traffic by business page.')+'</div></div><div class="grid grid-cols-2 gap-3">'+['RK','TK'].map(code=>{const rr=rows.filter(r=>r.business_code===code);const ss=activitySummary(rr);return '<div class="rounded-xl border bg-[#faf9f6] p-4"><div class="text-[10px] uppercase font-bold text-gray-400">'+(code==='RK'?'LP Home · RK':'L\'Imperial Luxury · TK')+'</div><div class="text-2xl font-bold mt-1">'+rr.length+'</div><div class="text-[10px] text-gray-400 mt-1">'+ss.unique+' unique · '+ss.buy+' buy · '+ss.conversion.toFixed(1)+'% conversion</div></div>';}).join('')+'</div></div>'
      +activityBarList(isShowroom?'Top Interests':'Online Stage Funnel Detail',isShowroom?'Most common products customers asked about.':'Active online customers by stage.',isShowroom?interests:funnel, isShowroom?rows.filter(r=>String(r.interest||'').trim()).length:summary.unique)
      +'</div>'

      +'<div class="card rounded-2xl overflow-hidden mt-4"><div class="px-4 py-3 border-b flex items-center justify-between"><div><h4 class="font-bold">Sales Rep Activity</h4><div class="text-[10px] text-gray-400 mt-0.5">'+noun+', unique customers and buy conversion by Person In Charge.</div></div><div class="text-[10px] text-gray-400">'+reps.length+' rep'+(reps.length===1?'':'s')+'</div></div><div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-[#faf9f6] text-gray-400 uppercase text-[9px]"><tr><th class="text-left px-4 py-2">Sales Rep</th><th class="text-right px-4 py-2">'+noun+'</th><th class="text-right px-4 py-2">Unique</th><th class="text-right px-4 py-2">Buy</th><th class="text-right px-4 py-2">Conversion</th></tr></thead><tbody class="divide-y">'+(reps.length?reps.map(r=>'<tr><td class="px-4 py-3 font-semibold">'+esc(r.name)+'</td><td class="px-4 py-3 text-right">'+r.entries+'</td><td class="px-4 py-3 text-right">'+r.unique+'</td><td class="px-4 py-3 text-right text-green-600">'+r.buy+'</td><td class="px-4 py-3 text-right">'+r.conversion.toFixed(1)+'%</td></tr>').join(''):'<tr><td colspan="5" class="px-4 py-10 text-center text-gray-400">No activity data for this selection.</td></tr>')+'</tbody></table></div></div>';
  }

  async function renderActivitySection(section){
    const type=section==='showroom'?'showroom_visit':'online';
    activityReportState.section=section;
    activityReportState.type=type;
    document.getElementById('pageTitle').textContent='Report';
    document.getElementById('pageSubtitle').textContent='Sales, showroom and online performance reports';
    document.getElementById('content').innerHTML=unifiedTabs(section)+'<div id="activityReportRoot"><div class="py-20 text-center text-gray-400">Loading '+(section==='showroom'?'showroom':'online')+' report...</div></div>';
    await ensureActivityData(type);
    const years=activityYears();
    if(!activityReportState.year||!years.includes(Number(activityReportState.year)))activityReportState.year=years[0]||new Date().getFullYear();
    renderActivityReportBody();
  }

  window.renderReports=async function(){
    if(activityReportState.section==='showroom'||activityReportState.section==='online'){
      return renderActivitySection(activityReportState.section);
    }
    activityReportState.section='sales';
    await baseRenderReports();
    installUnifiedTabs('sales');
    document.getElementById('pageSubtitle').textContent='Sales, showroom and online performance reports';
  };

  window.setUnifiedReportSection=async function(section){
    if(!['sales','showroom','online'].includes(section))return;
    activityReportState.section=section;
    activityReportState.periodMenuOpen=false;
    activityReportState.repMenuOpen=false;
    if(section==='sales'){
      await baseRenderReports();
      installUnifiedTabs('sales');
      document.getElementById('pageSubtitle').textContent='Sales, showroom and online performance reports';
      return;
    }
    await renderActivitySection(section);
  };

  window.setActivityReportView=function(v){
    if(!['month','quarter','year'].includes(v))return;
    activityReportState.view=v;activityReportState.periodMenuOpen=false;activityReportState.repMenuOpen=false;renderActivityReportBody();
  };
  window.setActivityReportYear=function(v){
    activityReportState.year=Number(v);activityReportState.periodMenuOpen=false;activityReportState.repMenuOpen=false;renderActivityReportBody();
  };
  window.setActivityReportBusiness=function(v){
    activityReportState.business=['RK','TK'].includes(v)?v:'all';activityReportState.periodMenuOpen=false;activityReportState.repMenuOpen=false;renderActivityReportBody();
  };
  window.toggleActivityReportPeriodMenu=function(){
    activityReportState.periodMenuOpen=!activityReportState.periodMenuOpen;activityReportState.repMenuOpen=false;renderActivityReportBody();
  };
  window.activityReportSelectAllPeriods=function(checked){
    if(activityReportState.view==='month')activityReportState.selectedMonths=checked?null:new Set();
    else if(activityReportState.view==='quarter')activityReportState.selectedQuarters=checked?null:new Set();
    activityReportState.periodMenuOpen=true;renderActivityReportBody();
  };
  window.activityReportTogglePeriod=function(key,checked){
    if(activityReportState.view==='month'){
      let set=activityReportState.selectedMonths===null?new Set([1,2,3,4,5,6,7,8,9,10,11,12]):new Set(activityReportState.selectedMonths);
      if(checked)set.add(Number(key));else set.delete(Number(key));
      activityReportState.selectedMonths=set.size===12?null:set;
    }else if(activityReportState.view==='quarter'){
      let set=activityReportState.selectedQuarters===null?new Set([1,2,3,4]):new Set(activityReportState.selectedQuarters);
      if(checked)set.add(Number(key));else set.delete(Number(key));
      activityReportState.selectedQuarters=set.size===4?null:set;
    }
    activityReportState.periodMenuOpen=true;renderActivityReportBody();
  };
  window.toggleActivityReportRepMenu=function(){
    activityReportState.repMenuOpen=!activityReportState.repMenuOpen;activityReportState.periodMenuOpen=false;renderActivityReportBody();
  };
  window.activityReportSelectAllReps=function(checked){
    activityReportState.selectedReps=checked?null:new Set();activityReportState.repMenuOpen=true;renderActivityReportBody();
  };
  window.activityReportToggleRep=function(key,checked){
    const reps=currentActivityRepRows();
    let set=activityReportState.selectedReps===null?new Set(reps.map(r=>r.key)):new Set(activityReportState.selectedReps);
    if(checked)set.add(key);else set.delete(key);
    activityReportState.selectedReps=set.size===reps.length?null:set;
    activityReportState.repMenuOpen=true;renderActivityReportBody();
  };
})();