// Daily customer-entry workflow: Showroom Visit + Online.
(function(){
  const activityState={
    type:'showroom_visit',
    rows:[],
    salesUsers:[],
    search:'',
    business:'all',
    status:'all',
    dateRange:'today',
    salesRep:'all',
    page:1,
    pageSize:20
  };

  let activityCustomerSearchTimer=null;
  let activityCustomerCandidates=[];
  let activitySelectedIdentity=null;

  const CUSTOMER_TYPES=[
    'New Customer','Existing Customer','Referral','Project / Company','Other'
  ];
  const SOURCES=['Showroom','Facebook','Telegram','Friend or Family','Site Location','Other'];
  const STATUSES=[
    'Contacting','Potential','Waiting Decision','Buy','Reject'
  ];

  function activityAllowed(){
    return ['sales','manager','admin','super_admin'].includes(state.profile?.role||'');
  }
  function activityScopeSalesId(){
    if(typeof managerRepActive==='function'&&managerRepActive())return managerRepId();
    if(typeof managerTestActive==='function'&&managerTestActive())return state.managerRepContext?.user_id||null;
    if(['sales','manager'].includes(state.profile?.role||''))return state.user?.id||null;
    return null;
  }
  function activityIsOwner(r){
    const owner=activityScopeSalesId();
    if(owner&&String(r?.assigned_sales_id||'')===String(owner))return true;
    return !!state.user?.id&&String(r?.created_by||'')===String(state.user.id);
  }
  function activityReviewerMode(){
    if((state.profile?.role||'')==='manager')return true;
    return ['admin','super_admin'].includes(state.profile?.role||'')
      && !(typeof managerRepActive==='function'&&managerRepActive())
      && !(typeof managerTestActive==='function'&&managerTestActive());
  }
  function activityCanSeeStage(r){
    return activityReviewerMode()||activityIsOwner(r);
  }
  function activityCanChooseSales(){
    return ['admin','super_admin'].includes(state.profile?.role||'')
      && !(typeof managerRepActive==='function'&&managerRepActive())
      && !(typeof managerTestActive==='function'&&managerTestActive());
  }
  function activityCanFilterSales(){
    if((state.profile?.role||'')==='manager')return true;
    return activityCanChooseSales();
  }
  function activityTypeLabel(type){return type==='showroom_visit'?'Showroom Visit':'Online'}
  function entryWeight(r){return Math.max(1,Number(r?.entry_count||1)||1)}
  function weightedCount(rows){return (rows||[]).reduce((s,r)=>s+entryWeight(r),0)}
  function businessLabel(code){return code==='RK'?'LP Home · RK':"L'Imperial Luxury · TK"}
  function fmtActivityDate(v){
    if(!v)return '-';
    const d=new Date(String(v).slice(0,10)+'T00:00:00');
    return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  }
  function isoToday(){
    const d=new Date(),off=d.getTimezoneOffset();
    return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
  }
  function dateInRange(v,row){
    if(activityState.dateRange==='all')return true;
    const raw=String(v||'').slice(0,10);
    const today=isoToday();
    if(activityState.dateRange==='today'){
      if(row?.is_history)return false;
      return raw===today;
    }
    if(activityState.dateRange==='month')return raw.slice(0,7)===today.slice(0,7);
    if(activityState.dateRange==='week'){
      if(row?.is_history)return false;
      const now=new Date(today+'T00:00:00');
      const day=(now.getDay()+6)%7;
      const start=new Date(now);start.setDate(now.getDate()-day);
      const end=new Date(start);end.setDate(start.getDate()+6);
      const d=new Date(raw+'T00:00:00');
      return d>=start&&d<=end;
    }
    return true;
  }
  function statusTone(status){
    const s=String(status||'').toLowerCase();
    if(s.includes('buy'))return 'bg-green-50 text-green-700 border-green-200';
    if(s.includes('potential'))return 'bg-amber-50 text-amber-700 border-amber-200';
    if(s.includes('waiting'))return 'bg-purple-50 text-purple-700 border-purple-200';
    if(s.includes('reject'))return 'bg-red-50 text-red-700 border-red-200';
    if(s.includes('contact'))return 'bg-blue-50 text-blue-700 border-blue-200';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  }
  function businessTone(code){
    return code==='RK'
      ?'bg-[#fff8e7] text-[#8a650e] border-[#ead69b]'
      :'bg-[#f5f1ff] text-[#6741a5] border-[#d8c9f4]';
  }
  function selectOptions(values,current,placeholder='Select'){
    const cur=String(current||'').trim();
    const legacy=cur&&!values.includes(cur)
      ?'<option value="'+esc(cur)+'" selected>'+esc(cur)+' (Legacy)</option>'
      :'';
    return '<option value="">'+esc(placeholder)+'</option>'+legacy+values.map(v=>'<option value="'+esc(v)+'" '+(cur===v?'selected':'')+'>'+esc(v)+'</option>').join('');
  }
  function currentSalesName(){
    const id=activityScopeSalesId()||state.user?.id;
    return activityState.salesUsers.find(x=>x.user_id===id)?.display_name
      ||activityState.salesUsers.find(x=>x.user_id===id)?.email
      ||state.profile?.display_name||state.user?.email||'';
  }
  function filteredActivityRows(){
    const q=activityState.search.trim().toLowerCase();
    return (activityState.rows||[]).filter(r=>{
      if(activityState.business!=='all'&&r.business_code!==activityState.business)return false;
      if(activityState.status!=='all'&&String(r.status||'')!==activityState.status)return false;
      if(activityState.salesRep!=='all'&&String(r.assigned_sales_id||'')!==activityState.salesRep)return false;
      if(!dateInRange(r.activity_date,r))return false;
      if(!q)return true;
      return [
        r.customer_name,r.phone,r.customer_type,r.source_channel,r.status,
        r.interest,r.remark,r.sales_rep_name,r.business_name
      ].some(v=>String(v||'').toLowerCase().includes(q));
    });
  }
  function activityPageRows(rows){
    if(activityState.pageSize==='all')return rows;
    const size=Number(activityState.pageSize||20);
    const pages=Math.max(1,Math.ceil(rows.length/size));
    if(activityState.page>pages)activityState.page=pages;
    if(activityState.page<1)activityState.page=1;
    return rows.slice((activityState.page-1)*size,activityState.page*size);
  }
  function activitySummary(rows){
    const today=isoToday(),month=today.slice(0,7),owner=activityScopeSalesId()||state.user?.id||'';
    return {
      today:weightedCount(rows.filter(r=>!r.is_history&&String(r.activity_date||'').slice(0,10)===today)),
      month:weightedCount(rows.filter(r=>String(r.activity_date||'').slice(0,7)===month)),
      mine:weightedCount(rows.filter(r=>String(r.assigned_sales_id||'')===String(owner))),
      rk:weightedCount(rows.filter(r=>r.business_code==='RK')),
      tk:weightedCount(rows.filter(r=>r.business_code==='TK'))
    };
  }
  function activityKpi(label,value,sub){
    return '<div class="card rounded-2xl p-4"><div class="text-[10px] uppercase tracking-wide font-bold text-gray-400">'+esc(label)+'</div><div class="text-2xl font-bold mt-1">'+value+'</div><div class="text-[10px] text-gray-400 mt-1">'+esc(sub)+'</div></div>';
  }
  function activitySalesFilter(){
    if(!activityCanFilterSales())return '';
    const users=activityState.salesUsers.filter(x=>['sales','manager'].includes(x.role));
    return `<select onchange="setActivitySalesRep(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm min-w-[170px]">
      <option value="all">All Sales</option>
      ${users.map(u=>`<option value="${u.user_id}" ${activityState.salesRep===u.user_id?'selected':''}>${esc(u.display_name||u.email)}</option>`).join('')}
    </select>`;
  }
  function activityToolbar(){
    return `<div class="card rounded-2xl p-4 mb-4">
      <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div class="flex flex-col sm:flex-row gap-2 flex-1">
          <input value="${esc(activityState.search)}" oninput="setActivitySearch(this.value)" class="border rounded-xl px-4 py-2.5 bg-white w-full sm:max-w-[340px]" placeholder="Search customer, phone, interest, remark...">
          <select onchange="setActivityBusiness(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
            <option value="all">All Business</option>
            <option value="RK" ${activityState.business==='RK'?'selected':''}>LP Home · RK</option>
            <option value="TK" ${activityState.business==='TK'?'selected':''}>L'Imperial Luxury · TK</option>
          </select>
          <select onchange="setActivityDateRange(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
            <option value="today" ${activityState.dateRange==='today'?'selected':''}>Today</option>
            <option value="week" ${activityState.dateRange==='week'?'selected':''}>This Week</option>
            <option value="month" ${activityState.dateRange==='month'?'selected':''}>This Month</option>
            <option value="all" ${activityState.dateRange==='all'?'selected':''}>All Dates</option>
          </select>
${activityReviewerMode()?`          <select onchange="setActivityStatus(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
            <option value="all">All Stages</option>
            ${STATUSES.map(s=>`<option value="${esc(s)}" ${activityState.status===s?'selected':''}>${esc(s)}</option>`).join('')}
          </select>`:''}
          ${activitySalesFilter()}
        </div>
        <button onclick="openNewCustomerActivity()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold whitespace-nowrap">+ New ${esc(activityTypeLabel(activityState.type))}</button>
      </div>
    </div>`;
  }
  function activityRowsHtml(rows){
    if(!rows.length)return '<div class="card rounded-2xl p-12 text-center text-sm text-gray-400">No '+esc(activityTypeLabel(activityState.type))+' entries for this selection.</div>';
    return '<div class="grid gap-3">'+rows.map(r=>{
      const detail=activityState.type==='online'
        ?[r.interest&&('Interest: '+r.interest),r.remark].filter(Boolean).join(' · ')
        :[r.source_channel&&('Source: '+r.source_channel),r.interest&&('Interest: '+r.interest),r.remark].filter(Boolean).join(' · ');
      const canEdit=!r.is_history&&(activityReviewerMode()||activityIsOwner(r));
      const canSeeStage=activityCanSeeStage(r);
      const historyBadge=r.is_history?`<span class="px-2 py-1 rounded-lg border border-[#ead69b] bg-[#fffaf0] text-[9px] font-bold text-[#8a6514]">Google History · ${entryWeight(r)} ${activityState.type==='online'?'inquir'+(entryWeight(r)===1?'y':'ies'):'visit'+(entryWeight(r)===1?'':'s')}</span>`:'';
      return `<div class="card rounded-2xl p-4 ${r.is_history?'cursor-pointer hover:border-[#d8c287] transition':''}" ${r.is_history?`onclick="openCustomerHistoryGroup('${r.id}')"`:''}>
        <div class="grid lg:grid-cols-[110px_1.3fr_.8fr_.85fr_.85fr_auto] gap-3 lg:gap-4 items-center">
          <div><div class="text-[10px] uppercase font-bold text-gray-400">${r.is_history?'Latest Date':'Date'}</div><div class="text-sm font-semibold mt-1">${esc(fmtActivityDate(r.activity_date))}</div>${r.is_history?`<div class="text-[9px] text-gray-400 mt-1">Monthly archive</div>`:''}</div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2"><b class="truncate">${esc(r.customer_name)}</b><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${businessTone(r.business_code)}">${esc(r.business_code)}</span>${historyBadge}</div>
            <div class="text-[11px] text-gray-400 mt-1">${esc(r.phone||'No phone')} · ${esc(r.customer_type||'-')}</div>
            ${detail?`<div class="text-[11px] text-gray-600 mt-1 line-clamp-2">${esc(detail)}</div>`:''}
          </div>
          <div><div class="text-[10px] uppercase font-bold text-gray-400">Stage</div>${canSeeStage?`<span class="inline-flex mt-1 px-2 py-1 rounded-lg border text-[10px] font-semibold ${statusTone(r.status)}">${esc(r.status||'-')}</span>`:'<div class="text-[11px] text-gray-400 mt-1">Private</div>'}</div>
          <div><div class="text-[10px] uppercase font-bold text-gray-400">Sales</div><div class="text-sm mt-1">${esc(r.sales_rep_name||'-')}</div></div>
          <div><div class="text-[10px] uppercase font-bold text-gray-400">Follow Up</div><div class="text-sm mt-1">${canSeeStage?esc(r.follow_up_date?fmtActivityDate(r.follow_up_date):'-'):'Private'}</div></div>
          <div class="flex lg:justify-end">${canEdit?`<button onclick="event.stopPropagation();openEditCustomerActivity('${r.id}')" class="px-3 py-2 border rounded-lg text-xs font-semibold bg-white">Edit</button>`:r.is_history?'<span class="text-[10px] font-semibold text-[#9a6b12]">View history →</span>':''}</div>
        </div>
      </div>`;
    }).join('')+'</div>';
  }
  function activityPager(rows){
    const total=rows.length;
    const represented=weightedCount(rows);
    const all=activityState.pageSize==='all';
    const size=all?total:Number(activityState.pageSize||20);
    const pages=all?1:Math.max(1,Math.ceil(total/size));
    const start=total?(all?1:(activityState.page-1)*size+1):0;
    const end=total?(all?total:Math.min(activityState.page*size,total)):0;
    return `<div class="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-gray-500">
      <div>Showing <b>${start}–${end}</b> of <b>${total}</b> record groups${represented!==total?` · representing <b>${represented}</b> entries`:''}</div>
      <div class="flex items-center gap-2">
        <select onchange="setActivityPageSize(this.value)" class="border rounded-lg bg-white px-2.5 py-2">
          <option value="20" ${activityState.pageSize===20?'selected':''}>20 / page</option>
          <option value="40" ${activityState.pageSize===40?'selected':''}>40 / page</option>
          <option value="all" ${activityState.pageSize==='all'?'selected':''}>Show all</option>
        </select>
        ${all?'':`<button onclick="changeActivityPage(-1)" ${activityState.page<=1?'disabled':''} class="px-3 py-2 border rounded-lg bg-white disabled:opacity-40">Prev</button><span>Page <b>${activityState.page}</b> / ${pages}</span><button onclick="changeActivityPage(1)" ${activityState.page>=pages?'disabled':''} class="px-3 py-2 border rounded-lg bg-white disabled:opacity-40">Next</button>`}
      </div>
    </div>`;
  }
  function renderActivityBody(){
    const root=document.getElementById('customerActivityRoot');if(!root)return;
    const scoped=(activityState.rows||[]);
    const summary=activitySummary(scoped);
    const filtered=filteredActivityRows();
    const pageRows=activityPageRows(filtered);
    root.innerHTML=`
      ${typeof managerRepActive==='function'&&managerRepActive()?managerRepBanner():''}
      <div class="grid grid-cols-2 xl:grid-cols-5 gap-3 mb-4">
        ${activityKpi('Today',summary.today,activityTypeLabel(activityState.type))}
        ${activityKpi('This Month',summary.month,'Current month entries')}
        ${activityKpi('My Entries',summary.mine,'Your own records')}
        ${activityKpi('LP Home · RK',summary.rk,'Total loaded entries')}
        ${activityKpi("L'Imperial Luxury · TK",summary.tk,'Total loaded entries')}
      </div>
      ${activityToolbar()}
      ${activityRowsHtml(pageRows)}
      ${activityPager(filtered)}
    `;
  }
  async function loadActivitySalesUsers(){
    if(activityState.salesUsers.length)return;
    const {data,error}=await db.rpc('get_activity_pic_options');
    if(!error)activityState.salesUsers=data||[];
    else{
      console.warn('Person In Charge options:',error.message);
      activityState.salesUsers=[{
        user_id:state.user?.id,
        display_name:state.profile?.display_name,
        email:state.user?.email,
        role:state.profile?.role
      }].filter(x=>x.user_id);
    }
  }
  async function renderCustomerActivity(type){
    if(!activityAllowed())throw new Error('Sales access required');
    activityState.type=type;
    activityState.page=1;
    document.getElementById('pageTitle').textContent=activityTypeLabel(type);
    document.getElementById('pageSubtitle').textContent=type==='showroom_visit'
      ?'Shared daily showroom customer visits · RK / TK'
      :'Shared daily social media customer inquiries · RK / TK';
    document.getElementById('content').innerHTML='<div id="customerActivityRoot"><div class="py-20 text-center text-gray-400">Loading...</div></div>';

    await loadActivitySalesUsers();
    const [liveRes,historyRes]=await Promise.all([
      db.rpc('get_customer_activity_rows',{p_activity_type:type}),
      db.rpc('get_customer_history_index',{p_activity_type:type})
    ]);
    if(liveRes.error)throw liveRes.error;
    if(historyRes.error)throw historyRes.error;

    const live=(liveRes.data||[]).map(r=>({...r,entry_count:1,is_history:false}));
    const history=(historyRes.data||[]).map(r=>({
      id:'history-'+r.id,
      activity_date:r.activity_date,
      activity_type:r.activity_type,
      business_code:r.business_code,
      business_name:r.business_code==='RK'?'LP Home':r.business_code==='TK'?"L'Imperial Luxury":'Other',
      customer_name:r.customer_name,
      phone:r.normalized_phone,
      customer_type:r.customer_type,
      source_channel:r.source_channel,
      status:r.status,
      interest:r.interest,
      remark:r.source_sheet?('Archived in '+r.source_sheet):'Google Sheet history',
      follow_up_date:r.follow_up_date,
      assigned_sales_id:r.assigned_sales_id,
      sales_rep_name:r.sales_rep_name,
      linked_customer_id:null,
      created_by:null,
      created_at:(r.activity_date||r.period_month)+'T00:00:00Z',
      updated_at:(r.activity_date||r.period_month)+'T00:00:00Z',
      entry_count:r.entry_count||1,
      is_history:true,
      source_sheet:r.source_sheet
    }));

    activityState.rows=[...live,...history].sort((a,b)=>String(b.activity_date||'').localeCompare(String(a.activity_date||'')));
    if(!activityCanFilterSales())activityState.salesRep='all';
    if(activityState.dateRange==='today'&&live.length===0&&history.length>0)activityState.dateRange='all';
    renderActivityBody();
  }

  function activitySelectableSalesUsers(){
    const users=activityState.salesUsers.filter(x=>['sales','manager'].includes(x.role));
    const role=state.profile?.role||'';
    if(role==='sales')return users.filter(x=>String(x.user_id)===String(state.user?.id||''));
    if(typeof managerRepActive==='function'&&managerRepActive())return users.filter(x=>String(x.user_id)===String(managerRepId()||''));
    if(typeof managerTestActive==='function'&&managerTestActive())return users.filter(x=>String(x.user_id)===String(state.managerRepContext?.user_id||''));
    return users;
  }
  function salesSelectHtml(current){
    const users=activitySelectableSalesUsers();
    const selected=current||'';
    const meOnly=(state.profile?.role||'')==='sales';
    return `<select id="activitySalesRep" onchange="activitySalesAssignmentChanged()" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">
      <option value="" ${!selected?'selected':''}>Unassigned</option>
      ${users.map(u=>`<option value="${u.user_id}" ${u.user_id===selected?'selected':''}>${meOnly?'Claim for me · ':''}${esc(u.display_name||u.email)} · ${esc(titleCase(u.role||''))}</option>`).join('')}
    </select>
    <div id="activitySalesAssignmentHint" class="text-[9px] text-gray-400 mt-1">A valid phone number is required before an unassigned customer can be claimed.</div>`;
  }
  function activityFormBody(row){
    const isOnline=activityState.type==='online';
    const business=row?.business_code||'RK';
    const status=row?.status||'Contacting';
    const source=row?.source_channel||(isOnline?'Facebook':'Showroom');
    return `<form id="customerActivityForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Date</label><input id="activityDate" type="date" required value="${esc(row?.activity_date||isoToday())}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Business</label><select id="activityBusiness" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="RK" ${business==='RK'?'selected':''}>LP Home · RK</option><option value="TK" ${business==='TK'?'selected':''}>L'Imperial Luxury · TK</option></select></div>
      <div class="relative">
        <label class="text-xs font-semibold">Customer Name</label>
        <input id="activityCustomerName" required autocomplete="off" value="${esc(row?.customer_name||'')}" oninput="activityCustomerNameChanged()" onfocus="activityCustomerNameChanged(true)" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Type name to search existing customers">
        <div id="activityCustomerSuggestions" class="hidden absolute z-[110] left-0 right-0 mt-1 max-h-[300px] overflow-y-auto rounded-xl border bg-white shadow-xl"></div>
        <div id="activityIdentityLock" class="hidden mt-1.5 text-[10px] rounded-lg border px-2.5 py-2"></div>
      </div>
      <div><label class="text-xs font-semibold">Phone Number <span class="text-gray-400 font-normal">· required to claim</span></label><input id="activityPhone" value="${esc(row?.phone||'')}" onblur="matchActivityCustomerPhone()" oninput="clearActivityCustomerMatch();activitySalesAssignmentChanged()" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Example: 012 345 678"><div id="activityCustomerMatch" class="hidden mt-1.5 text-[10px] rounded-lg border px-2.5 py-2"></div></div>
      <div><label class="text-xs font-semibold">Customer Category</label><select id="activityCustomerType" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${selectOptions(CUSTOMER_TYPES,row?.customer_type,'Select customer category')}</select></div>
      ${isOnline
        ?`<div><label class="text-xs font-semibold">Page</label><div class="mt-1 border rounded-xl px-3 py-2.5 bg-gray-50 text-sm text-gray-600">RK = Home Page · TK = Luxury Page</div></div>`
        :`<div><label class="text-xs font-semibold">Source From</label><select id="activitySource" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${selectOptions(SOURCES,source,'Select source')}</select></div>`}
      <div><label class="text-xs font-semibold">Customer Stage</label><select id="activityStatusInput" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${selectOptions(STATUSES,status,'Select customer stage')}</select></div>
      <div><label class="text-xs font-semibold">Person In Charge</label>${salesSelectHtml(row?.assigned_sales_id)}</div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Interest</label><input id="activityInterest" value="${esc(row?.interest||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="${isOnline?'Example: Sofa set, chandelier, bedroom set':'Example: Modern sofa, chandelier, dining table'}"></div>
      <div><label class="text-xs font-semibold">Follow-up Date</label><input id="activityFollowUp" type="date" value="${esc(row?.follow_up_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Remark</label><textarea id="activityRemark" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Customer request / follow-up note...">${esc(row?.remark||'')}</textarea></div>
      <div class="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700">${isOnline
        ?'Type the customer name to search existing registered customers/CRM leads. Existing ownership is locked. An unassigned lead can be claimed only with a valid phone number that is not already owned by another Sales Rep.'
        :'Type the customer name to search existing registered customers/CRM leads. Existing ownership is locked. An unassigned visitor can be claimed only with a valid phone number that is not already owned by another Sales Rep.'}</div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">${row?'Save Changes':'Save '+esc(activityTypeLabel(activityState.type))}</button>
    </form>`;
  }
  window.openNewCustomerActivity=function(){
    activitySelectedIdentity=null;
    activityCustomerCandidates=[];
    openModal('New '+activityTypeLabel(activityState.type),activityFormBody(null));
    document.getElementById('customerActivityForm').onsubmit=e=>saveCustomerActivity(e,null);
    activitySalesAssignmentChanged();
  };
  window.clearActivityCustomerMatch=function(){
    const box=document.getElementById('activityCustomerMatch');
    if(!box)return;
    box.className='hidden mt-1.5 text-[10px] rounded-lg border px-2.5 py-2';
    box.textContent='';
  };
  function activityHideCustomerSuggestions(){
    const box=document.getElementById('activityCustomerSuggestions');
    if(box){box.classList.add('hidden');box.innerHTML=''}
  }
  function activityEnsureOwnerOption(ownerId,ownerName){
    const sel=document.getElementById('activitySalesRep');
    if(!sel||!ownerId)return;
    let opt=[...sel.options].find(o=>String(o.value)===String(ownerId));
    if(!opt){
      opt=document.createElement('option');
      opt.value=ownerId;
      opt.textContent=(ownerName||'Assigned Sales')+' · Existing Owner';
      opt.dataset.injectedOwner='1';
      sel.appendChild(opt);
    }
    sel.value=ownerId;
  }
  function activityUnlockIdentity(clearFields=false){
    activitySelectedIdentity=null;
    const name=document.getElementById('activityCustomerName');
    const phone=document.getElementById('activityPhone');
    const lock=document.getElementById('activityIdentityLock');
    const sel=document.getElementById('activitySalesRep');
    if(name){name.readOnly=false;name.classList.remove('bg-gray-50');if(clearFields)name.value=''}
    if(phone){phone.readOnly=false;phone.classList.remove('bg-gray-50');if(clearFields)phone.value=''}
    if(lock){lock.className='hidden mt-1.5 text-[10px] rounded-lg border px-2.5 py-2';lock.innerHTML=''}
    if(sel){
      sel.disabled=false;
      [...sel.options].filter(o=>o.dataset.injectedOwner==='1').forEach(o=>o.remove());
      sel.value='';
    }
    clearActivityCustomerMatch();
    activityHideCustomerSuggestions();
    activitySalesAssignmentChanged();
    if(clearFields)name?.focus();
  }
  window.changeActivityCustomerSelection=function(){activityUnlockIdentity(true)};

  function applyActivityCustomerIdentity(data){
    if(!data?.matched)return;
    activitySelectedIdentity={
      source:data.source||data.source_type||null,
      customer_id:data.customer_id||null,
      lead_id:data.lead_id||null,
      customer_name:data.customer_name||'',
      phone:data.phone||'',
      assigned_sales_id:data.assigned_sales_id||null,
      assigned_sales_name:data.assigned_sales_name||'',
      is_buyer:!!data.is_buyer,
      order_count:Number(data.order_count||0),
      claimable:!!data.claimable
    };
    const name=document.getElementById('activityCustomerName');
    const phone=document.getElementById('activityPhone');
    const lock=document.getElementById('activityIdentityLock');
    const sel=document.getElementById('activitySalesRep');
    if(name&&data.customer_name){name.value=data.customer_name;name.readOnly=true;name.classList.add('bg-gray-50')}
    if(phone&&data.phone){
      phone.value=data.phone;
      if((String(data.phone).match(/\d/g)||[]).length){phone.readOnly=true;phone.classList.add('bg-gray-50')}
    }
    activityHideCustomerSuggestions();

    const registered=(data.source||data.source_type)==='customer_master';
    const label=registered?(data.is_buyer?'Registered Buyer':'Registered Customer'):'Existing CRM Customer';
    const owner=data.assigned_sales_name||'Unassigned';
    if(lock){
      lock.className='mt-1.5 text-[10px] rounded-lg border border-[#ead69b] bg-[#fffaf0] px-2.5 py-2 text-[#7a5a14]';
      lock.innerHTML='<div class="flex items-start justify-between gap-2"><div><b>'+esc(label)+':</b> '+esc(data.customer_name||'Customer')
        +(data.order_count?(' · '+Number(data.order_count)+' order'+(Number(data.order_count)===1?'':'s')):'')
        +' · Owner: '+esc(owner)+'</div><button type="button" onclick="changeActivityCustomerSelection()" class="underline whitespace-nowrap">Change</button></div>';
    }

    if(sel&&data.assigned_sales_id){
      activityEnsureOwnerOption(data.assigned_sales_id,data.assigned_sales_name);
      sel.disabled=true;
      sel.dataset.ownerLocked='1';
    }else if(sel){
      sel.disabled=false;
      delete sel.dataset.ownerLocked;
    }
    activitySalesAssignmentChanged();
  }
  window.selectActivityCustomerCandidate=function(index){
    const x=activityCustomerCandidates[Number(index)];
    if(!x)return;
    applyActivityCustomerIdentity({
      matched:true,
      source:x.source_type,
      customer_id:x.customer_id,
      lead_id:x.lead_id,
      customer_name:x.customer_name,
      phone:x.phone,
      customer_code:x.customer_code,
      assigned_sales_id:x.assigned_sales_id,
      assigned_sales_name:x.assigned_sales_name,
      is_buyer:x.is_buyer,
      order_count:x.order_count,
      claimable:x.claimable
    });
  };
  function renderActivityCustomerSuggestions(rows){
    const box=document.getElementById('activityCustomerSuggestions');
    if(!box)return;
    activityCustomerCandidates=rows||[];
    if(!activityCustomerCandidates.length){activityHideCustomerSuggestions();return}
    box.classList.remove('hidden');
    box.innerHTML=activityCustomerCandidates.map((x,i)=>{
      const type=x.source_type==='customer_master'?(x.is_buyer?'Registered Buyer':'Registered Customer'):'CRM Customer';
      const owner=x.assigned_sales_name||'Unassigned';
      return '<button type="button" onclick="selectActivityCustomerCandidate('+i+')" class="w-full text-left px-3 py-2.5 border-b last:border-b-0 hover:bg-[#fffaf0]">'
        +'<div class="flex items-center justify-between gap-2"><b class="text-sm">'+esc(x.customer_name||'Customer')+'</b><span class="text-[9px] font-bold text-[#9a6b12]">'+esc(type)+'</span></div>'
        +'<div class="text-[10px] text-gray-500 mt-1">'+esc(x.phone||'No phone')+' · '+esc(owner)+(x.order_count?' · '+Number(x.order_count)+' order'+(Number(x.order_count)===1?'':'s'):'')+'</div>'
        +'</button>';
    }).join('');
  }
  window.activityCustomerNameChanged=function(force=false){
    if(activitySelectedIdentity)return;
    const q=document.getElementById('activityCustomerName')?.value.trim()||'';
    clearTimeout(activityCustomerSearchTimer);
    if(q.length<2){activityHideCustomerSuggestions();return}
    activityCustomerSearchTimer=setTimeout(async()=>{
      const {data,error}=await db.rpc('search_activity_customer_candidates',{p_query:q});
      if(error){console.warn('Customer suggestion search:',error.message);activityHideCustomerSuggestions();return}
      renderActivityCustomerSuggestions(data||[]);
    },force?0:180);
  };

  window.matchActivityCustomerPhone=async function(){
    const phone=document.getElementById('activityPhone')?.value.trim()||'';
    const box=document.getElementById('activityCustomerMatch');
    if(!box)return null;
    if(!phone){clearActivityCustomerMatch();return null}
    box.className='mt-1.5 text-[10px] rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-gray-500';
    box.textContent='Checking existing customers...';
    const {data,error}=await db.rpc('find_customer_identity_by_phone',{p_phone:phone});
    if(error){
      box.className='mt-1.5 text-[10px] rounded-lg border border-red-200 bg-red-50 px-2.5 py-2 text-red-600';
      box.textContent=error.message;
      return null;
    }
    if(!data||!data.matched){
      box.className='hidden mt-1.5 text-[10px] rounded-lg border px-2.5 py-2';
      box.textContent='';
      return null;
    }
    applyActivityCustomerIdentity(data);
    const owner=data.assigned_sales_name?(' · Owner: '+data.assigned_sales_name):' · Owner: Unassigned';
    box.className='mt-1.5 text-[10px] rounded-lg border border-green-200 bg-green-50 px-2.5 py-2 text-green-700';
    box.innerHTML='<b>Phone matched:</b> '+esc(data.customer_name||'Customer')+esc(owner)
      +(data.is_buyer?'<br><b>Registered buyer:</b> identity and ownership are locked to the existing customer.':'');
    return data;
  };
  window.openCustomerHistoryGroup=async function(id){
    const indexId=Number(String(id||'').replace('history-',''));
    if(!Number.isFinite(indexId)||indexId<=0)return showToast('History record not found','err');
    openModal('Customer Visit History','<div id="customerHistoryGroupBody" class="py-10 text-center text-sm text-gray-400">Loading history...</div>');
    const {data,error}=await db.rpc('get_customer_history_detail_by_index',{p_id:indexId});
    const root=document.getElementById('customerHistoryGroupBody');if(!root)return;
    if(error){
      root.className='text-left text-sm text-gray-800';
      root.innerHTML='<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-red-600">'+esc(error.message)+'</div>';
      return;
    }
    const rows=data||[];
    if(!rows.length){
      root.className='text-left text-sm text-gray-800';
      root.innerHTML='<div class="rounded-xl border border-dashed p-8 text-center text-gray-400">No additional history found.</div>';
      return;
    }
    root.className='text-left text-sm text-gray-800';
    const sorted=rows.slice().sort((a,b)=>String(b.latest_activity_date||'').localeCompare(String(a.latest_activity_date||'')));
    const latest=sorted[0]||rows[0];
    const oldest=rows.slice().sort((a,b)=>String(a.latest_activity_date||'').localeCompare(String(b.latest_activity_date||'')))[0]||rows[0];
    const sum=code=>rows.filter(r=>!code||r.business_code===code).reduce((s,r)=>s+Number(r.entry_count||0),0);
    const total=sum(),rk=sum('RK'),tk=sum('TK');
    const customerName=latest.customer_name||rows.find(r=>r.customer_name)?.customer_name||'Customer';
    const phone=latest.normalized_phone||rows.find(r=>r.normalized_phone)?.normalized_phone||'-';
    const customerType=latest.customer_type||rows.find(r=>r.customer_type)?.customer_type||'-';
    const latestStage=latest.latest_stage||'-';
    const latestSales=latest.assigned_sales_name||'Unassigned';
    const latestSource=latest.source_channel||'-';
    document.getElementById('modalTitle').textContent=(activityState.type==='online'?'Customer Online History — ':'Customer Visit History — ')+customerName;
    root.innerHTML=`
      <div class="rounded-2xl border bg-[#fffaf0] p-4 mb-4">
        <div class="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-4">
          <div class="min-w-0">
            <div class="text-[10px] uppercase tracking-wide font-bold text-[#9a6b12]">Customer</div>
            <div class="text-xl font-bold mt-1">${esc(customerName)}</div>
            <div class="text-xs text-gray-500 mt-1">${esc(phone)} · ${esc(customerType)}</div>
          </div>
          <div class="grid grid-cols-2 md:grid-cols-4 gap-3 flex-1 lg:max-w-[620px]">
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Latest Stage</div><div class="font-semibold mt-1">${esc(latestStage)}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Assigned Sales</div><div class="font-semibold mt-1">${esc(latestSales)}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">First Seen</div><div class="font-semibold mt-1">${esc(fmtActivityDate(oldest.latest_activity_date))}</div></div>
            <div><div class="text-[9px] uppercase font-bold text-gray-400">Latest Seen</div><div class="font-semibold mt-1">${esc(fmtActivityDate(latest.latest_activity_date))}</div></div>
          </div>
        </div>
        <div class="mt-3 pt-3 border-t border-[#ead69b] grid md:grid-cols-2 gap-3 text-xs">
          <div><span class="text-gray-400">Latest Source:</span> <b>${esc(latestSource)}</b></div>
          <div><span class="text-gray-400">Latest Interest:</span> <b>${esc(latest.latest_interest||'-')}</b></div>
        </div>
      </div>

      <div class="grid grid-cols-3 gap-3 mb-4 text-left">
        <div class="rounded-xl border bg-[#fffaf0] p-4"><div class="text-[9px] uppercase font-bold text-gray-400">Total ${activityState.type==='online'?'Inquiries':'Visits'}</div><div class="text-2xl font-bold mt-1">${total}</div></div>
        <div class="rounded-xl border p-4"><div class="text-[9px] uppercase font-bold text-gray-400">LP Home · RK</div><div class="text-2xl font-bold mt-1">${rk}</div></div>
        <div class="rounded-xl border p-4"><div class="text-[9px] uppercase font-bold text-gray-400">L'Imperial Luxury · TK</div><div class="text-2xl font-bold mt-1">${tk}</div></div>
      </div>
      <div class="rounded-xl border overflow-hidden text-left">
        <div class="px-4 py-3 border-b bg-[#faf9f6]"><b>Monthly History</b><div class="text-[10px] text-gray-400 mt-0.5">Shows how many times this customer appeared in each showroom/page and month.</div></div>
        <div class="overflow-x-auto"><table class="w-full text-xs">
          <thead class="bg-white text-gray-400 uppercase text-[9px]"><tr><th class="text-left px-3 py-2">Month</th><th class="text-left px-3 py-2">Showroom / Page</th><th class="text-right px-3 py-2">Count</th><th class="text-left px-3 py-2">Latest Stage</th><th class="text-left px-3 py-2">Latest Date</th><th class="text-left px-3 py-2">Sales</th><th class="text-left px-3 py-2">Latest Interest</th></tr></thead>
          <tbody class="divide-y">${rows.map(r=>`<tr><td class="px-3 py-3 font-semibold">${esc(String(r.period_month||'').slice(0,7))}</td><td class="px-3 py-3">${esc(r.business_code==='RK'?'LP Home · RK':r.business_code==='TK'?"L'Imperial Luxury · TK":r.business_code||'-')}</td><td class="px-3 py-3 text-right font-bold">${Number(r.entry_count||0)}</td><td class="px-3 py-3">${esc(r.latest_stage||'-')}</td><td class="px-3 py-3">${esc(fmtActivityDate(r.latest_activity_date))}</td><td class="px-3 py-3">${esc(r.assigned_sales_name||'Unassigned')}</td><td class="px-3 py-3">${esc(r.latest_interest||'-')}</td></tr>`).join('')}</tbody>
        </table></div>
      </div>
    `;
  };

  window.openEditCustomerActivity=async function(id){
    const row=activityState.rows.find(x=>x.id===id);
    if(!row)return showToast('Entry not found','err');
    if(row.is_history)return showToast('Google Sheet history is read-only in the app. Edit the History sheet and sync again.','err');
    activitySelectedIdentity=null;
    activityCustomerCandidates=[];
    openModal('Edit '+activityTypeLabel(activityState.type),activityFormBody(row));
    document.getElementById('customerActivityForm').onsubmit=e=>saveCustomerActivity(e,row);
    activitySalesAssignmentChanged();
    if(row.linked_customer_id||row.lead_id||row.phone){
      const {data,error}=await db.rpc('resolve_customer_activity_identity',{
        p_phone:row.phone||null,
        p_selected_customer_id:row.linked_customer_id||null,
        p_selected_lead_id:row.lead_id||null
      });
      if(!error&&data?.matched)applyActivityCustomerIdentity(data);
    }
  };
  function activityHasContactNumber(){
    return (document.getElementById('activityPhone')?.value||'').replace(/[^0-9]/g,'').length>0;
  }
  window.activitySalesAssignmentChanged=function(){
    const sel=document.getElementById('activitySalesRep');
    const salesId=sel?.value||'';
    const hint=document.getElementById('activitySalesAssignmentHint');
    if(!hint)return;
    if(sel?.dataset.ownerLocked==='1'){
      hint.className='text-[9px] text-amber-700 mt-1 font-semibold';
      hint.textContent='Existing ownership is locked. Showroom/Online cannot transfer this customer to another Sales Rep.';
    }else if(salesId&&!activityHasContactNumber()){
      hint.className='text-[9px] text-red-600 mt-1 font-semibold';
      hint.textContent='Enter a valid contact phone number before claiming this customer.';
    }else if(salesId){
      hint.className='text-[9px] text-green-700 mt-1';
      hint.textContent=(state.profile?.role||'')==='sales'
        ?'If this phone is unassigned, saving will claim the CRM customer for you. A phone already owned by another Sales Rep will be blocked.'
        :"If this phone is unassigned, saving will route the CRM customer to the selected Sales Rep. Existing ownership cannot be overridden here.";
    }else{
      hint.className='text-[9px] text-gray-400 mt-1';
      hint.textContent='Unassigned is allowed. A valid phone lets the system identify the customer and prevent duplicate ownership.';
    }
  };
  async function saveCustomerActivity(e,row){
    e.preventDefault();

    // Exact phone identity is authoritative even if the user never left the phone field.
    if(activityHasContactNumber()&&!activitySelectedIdentity){
      await matchActivityCustomerPhone();
    }

    const salesId=document.getElementById('activitySalesRep')?.value||null;
    if(salesId&&!activityHasContactNumber()&&!activitySelectedIdentity?.assigned_sales_id){
      activitySalesAssignmentChanged();
      return showToast('Enter a valid contact phone number before claiming this customer.','err');
    }

    const args={
      p_activity_date:document.getElementById('activityDate').value,
      p_business_code:document.getElementById('activityBusiness').value,
      p_customer_name:document.getElementById('activityCustomerName').value.trim(),
      p_phone:document.getElementById('activityPhone').value.trim()||null,
      p_customer_type:document.getElementById('activityCustomerType').value||null,
      p_source_channel:activityState.type==='online'?'Facebook':(document.getElementById('activitySource')?.value||null),
      p_status:document.getElementById('activityStatusInput').value||null,
      p_interest:document.getElementById('activityInterest').value.trim()||null,
      p_remark:document.getElementById('activityRemark').value.trim()||null,
      p_follow_up_date:document.getElementById('activityFollowUp').value||null,
      p_assigned_sales_id:salesId,
      p_selected_customer_id:activitySelectedIdentity?.customer_id||null,
      p_selected_lead_id:activitySelectedIdentity?.lead_id||null
    };
    const btn=e.target.querySelector('button');if(btn){btn.disabled=true;btn.textContent='Saving...'}
    let res;
    if(row)res=await db.rpc('update_customer_activity_v3',{p_id:row.id,...args});
    else res=await db.rpc('create_customer_activity_v3',{p_activity_type:activityState.type,...args});
    if(res.error){
      if(btn){btn.disabled=false;btn.textContent=row?'Save Changes':'Save'}
      return showToast(res.error.message,'err');
    }
    const assignedUser=salesId?activityState.salesUsers.find(x=>String(x.user_id)===String(salesId)):null;
    const lockedOwner=activitySelectedIdentity?.assigned_sales_name||'';
    closeModal();
    showToast(
      salesId
        ?(row?'Updated ':'Saved ')+activityTypeLabel(activityState.type)+' · '+(lockedOwner?'linked to '+lockedOwner:'assigned to '+(assignedUser?.display_name||assignedUser?.email||'selected Sales Rep'))
        :(row?'Updated ':'Saved ')+activityTypeLabel(activityState.type)
    );
    await renderCustomerActivity(activityState.type);
  }

  window.setActivitySearch=function(v){activityState.search=v;activityState.page=1;renderActivityBody()};
  window.setActivityBusiness=function(v){activityState.business=v;activityState.page=1;renderActivityBody()};
  window.setActivityStatus=function(v){activityState.status=v;activityState.page=1;renderActivityBody()};
  window.setActivityDateRange=function(v){activityState.dateRange=v;activityState.page=1;renderActivityBody()};
  window.setActivitySalesRep=function(v){activityState.salesRep=v;activityState.page=1;renderActivityBody()};
  window.setActivityPageSize=function(v){activityState.pageSize=v==='all'?'all':([20,40].includes(Number(v))?Number(v):20);activityState.page=1;renderActivityBody()};
  window.changeActivityPage=function(delta){
    const total=filteredActivityRows().length;
    if(activityState.pageSize==='all')return;
    const pages=Math.max(1,Math.ceil(total/Number(activityState.pageSize||20)));
    activityState.page=Math.max(1,Math.min(pages,activityState.page+Number(delta||0)));
    renderActivityBody();
    document.getElementById('customerActivityRoot')?.scrollIntoView({behavior:'smooth',block:'start'});
  };

  const previousNavItems=window.navItems;
  window.navItems=function(){
    const items=(previousNavItems.apply(this,arguments)||[]).slice();
    if(!activityAllowed())return items;
    const add=[
      ['showroom-visit','Showroom Visit','⌂'],
      ['online','Online','◉']
    ];
    let idx=items.findIndex(x=>x[0]==='customers');
    if(idx<0)idx=0;
    add.forEach((item,offset)=>{
      if(!items.some(x=>x[0]===item[0]))items.splice(idx+1+offset,0,item);
    });
    return items;
  };

  const previousGo=window.go;
  window.go=async function(page){
    if(page==='showroom-visit'){
      state.page=page;renderNav();
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
      try{await renderCustomerActivity('showroom_visit')}catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
      return;
    }
    if(page==='online'){
      state.page=page;renderNav();
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading...</div>';
      try{await renderCustomerActivity('online')}catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
      return;
    }
    return previousGo(page);
  };
})();