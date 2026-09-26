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
    return !!owner&&String(r?.assigned_sales_id||'')===String(owner);
  }
  function activityReviewerMode(){
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
  function activityTypeLabel(type){return type==='showroom_visit'?'Showroom Visit':'Online'}
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
  function dateInRange(v){
    if(activityState.dateRange==='all')return true;
    const raw=String(v||'').slice(0,10);
    const today=isoToday();
    if(activityState.dateRange==='today')return raw===today;
    if(activityState.dateRange==='month')return raw.slice(0,7)===today.slice(0,7);
    if(activityState.dateRange==='week'){
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
      if(!dateInRange(r.activity_date))return false;
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
      today:rows.filter(r=>String(r.activity_date||'').slice(0,10)===today).length,
      month:rows.filter(r=>String(r.activity_date||'').slice(0,7)===month).length,
      mine:rows.filter(r=>String(r.assigned_sales_id||'')===String(owner)).length,
      rk:rows.filter(r=>r.business_code==='RK').length,
      tk:rows.filter(r=>r.business_code==='TK').length
    };
  }
  function activityKpi(label,value,sub){
    return '<div class="card rounded-2xl p-4"><div class="text-[10px] uppercase tracking-wide font-bold text-gray-400">'+esc(label)+'</div><div class="text-2xl font-bold mt-1">'+value+'</div><div class="text-[10px] text-gray-400 mt-1">'+esc(sub)+'</div></div>';
  }
  function activitySalesFilter(){
    if(!activityCanChooseSales())return '';
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
      const canEdit=activityReviewerMode()||activityIsOwner(r);
      const canSeeStage=activityCanSeeStage(r);
      return `<div class="card rounded-2xl p-4">
        <div class="grid lg:grid-cols-[110px_1.3fr_.8fr_.85fr_.85fr_auto] gap-3 lg:gap-4 items-center">
          <div><div class="text-[10px] uppercase font-bold text-gray-400">Date</div><div class="text-sm font-semibold mt-1">${esc(fmtActivityDate(r.activity_date))}</div></div>
          <div class="min-w-0">
            <div class="flex flex-wrap items-center gap-2"><b class="truncate">${esc(r.customer_name)}</b><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${businessTone(r.business_code)}">${esc(r.business_code)}</span></div>
            <div class="text-[11px] text-gray-400 mt-1">${esc(r.phone||'No phone')} · ${esc(r.customer_type||'-')}</div>
            ${detail?`<div class="text-[11px] text-gray-600 mt-1 line-clamp-2">${esc(detail)}</div>`:''}
          </div>
          <div><div class="text-[10px] uppercase font-bold text-gray-400">Stage</div>${canSeeStage?`<span class="inline-flex mt-1 px-2 py-1 rounded-lg border text-[10px] font-semibold ${statusTone(r.status)}">${esc(r.status||'-')}</span>`:'<div class="text-[11px] text-gray-400 mt-1">Private</div>'}</div>
          <div><div class="text-[10px] uppercase font-bold text-gray-400">Sales</div><div class="text-sm mt-1">${esc(r.sales_rep_name||'-')}</div></div>
          <div><div class="text-[10px] uppercase font-bold text-gray-400">Follow Up</div><div class="text-sm mt-1">${canSeeStage?esc(r.follow_up_date?fmtActivityDate(r.follow_up_date):'-'):'Private'}</div></div>
          <div class="flex lg:justify-end">${canEdit?`<button onclick="openEditCustomerActivity('${r.id}')" class="px-3 py-2 border rounded-lg text-xs font-semibold bg-white">Edit</button>`:''}</div>
        </div>
      </div>`;
    }).join('')+'</div>';
  }
  function activityPager(total){
    const all=activityState.pageSize==='all';
    const size=all?total:Number(activityState.pageSize||20);
    const pages=all?1:Math.max(1,Math.ceil(total/size));
    const start=total?(all?1:(activityState.page-1)*size+1):0;
    const end=total?(all?total:Math.min(activityState.page*size,total)):0;
    return `<div class="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-gray-500">
      <div>Showing <b>${start}–${end}</b> of <b>${total}</b></div>
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
      ${activityPager(filtered.length)}
    `;
  }
  async function loadActivitySalesUsers(){
    if(activityState.salesUsers.length)return;
    if((state.profile?.role||'')==='sales'){
      activityState.salesUsers=[{user_id:state.user.id,display_name:state.profile?.display_name,email:state.user?.email,role:'sales'}];
      return;
    }
    const {data,error}=await db.from('app_users').select('user_id,display_name,email,role,active').in('role',['sales','manager']).eq('active',true).order('display_name');
    if(!error)activityState.salesUsers=data||[];
    if(!activityState.salesUsers.some(x=>x.user_id===state.user?.id)&&['manager','admin','super_admin'].includes(state.profile?.role||'')){
      activityState.salesUsers.unshift({user_id:state.user.id,display_name:state.profile?.display_name,email:state.user?.email,role:state.profile?.role});
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
    const {data,error}=await db.rpc('get_customer_activity_rows',{p_activity_type:type});
    if(error)throw error;
    const rows=data||[];
    activityState.rows=rows;
    if(!activityCanChooseSales())activityState.salesRep='all';
    renderActivityBody();
  }

  function salesSelectHtml(current){
    if(!activityCanChooseSales()){
      const id=activityScopeSalesId()||state.user?.id||'';
      return `<input id="activitySalesRep" type="hidden" value="${esc(id)}"><div class="mt-1 border rounded-xl px-3 py-2.5 bg-gray-50 text-sm font-semibold">${esc(currentSalesName())}</div>`;
    }
    const users=activityState.salesUsers.filter(x=>['sales','manager','admin','super_admin'].includes(x.role));
    const defaultId=current||state.user?.id||users[0]?.user_id||'';
    return `<select id="activitySalesRep" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white" required>
      ${users.map(u=>`<option value="${u.user_id}" ${u.user_id===defaultId?'selected':''}>${esc(u.display_name||u.email)} · ${esc(titleCase(u.role||''))}</option>`).join('')}
    </select>`;
  }
  function activityFormBody(row){
    const isOnline=activityState.type==='online';
    const business=row?.business_code||'RK';
    const status=row?.status||'Contacting';
    const source=row?.source_channel||(isOnline?'Facebook':'Showroom');
    return `<form id="customerActivityForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Date</label><input id="activityDate" type="date" required value="${esc(row?.activity_date||isoToday())}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Business</label><select id="activityBusiness" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="RK" ${business==='RK'?'selected':''}>LP Home · RK</option><option value="TK" ${business==='TK'?'selected':''}>L'Imperial Luxury · TK</option></select></div>
      <div><label class="text-xs font-semibold">Customer Name</label><input id="activityCustomerName" required value="${esc(row?.customer_name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Customer name"></div>
      <div><label class="text-xs font-semibold">Phone Number</label><input id="activityPhone" value="${esc(row?.phone||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Phone / Telegram / Private"></div>
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
        ?'Online records the daily message/inquiry only. Customer Category describes the relationship; Status tracks the sales journey. Sales orders, invoices and payments stay in the existing Sales system.'
        :'Showroom Visit records the visit and follow-up only. Customer Category describes the relationship; Status tracks the sales journey. Invoice/payment amounts do not need to be re-entered here.'}</div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">${row?'Save Changes':'Save '+esc(activityTypeLabel(activityState.type))}</button>
    </form>`;
  }
  window.openNewCustomerActivity=function(){
    openModal('New '+activityTypeLabel(activityState.type),activityFormBody(null));
    document.getElementById('customerActivityForm').onsubmit=e=>saveCustomerActivity(e,null);
  };
  window.openEditCustomerActivity=function(id){
    const row=activityState.rows.find(x=>x.id===id);
    if(!row)return showToast('Entry not found','err');
    openModal('Edit '+activityTypeLabel(activityState.type),activityFormBody(row));
    document.getElementById('customerActivityForm').onsubmit=e=>saveCustomerActivity(e,row);
  };
  async function saveCustomerActivity(e,row){
    e.preventDefault();
    const salesId=document.getElementById('activitySalesRep')?.value||activityScopeSalesId()||state.user?.id||null;
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
      p_assigned_sales_id:salesId
    };
    const btn=e.target.querySelector('button');if(btn){btn.disabled=true;btn.textContent='Saving...'}
    let res;
    if(row)res=await db.rpc('update_customer_activity',{p_id:row.id,...args});
    else res=await db.rpc('create_customer_activity',{p_activity_type:activityState.type,...args});
    if(res.error){if(btn){btn.disabled=false;btn.textContent=row?'Save Changes':'Save'}return showToast(res.error.message,'err')}
    closeModal();
    showToast((row?'Updated ':'Saved ')+activityTypeLabel(activityState.type));
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