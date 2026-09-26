// Customer Database / lightweight CRM built from Showroom Visit + Online activity logs.
(function(){
  const leadState={
    rows:[],
    salesUsers:[],
    search:'',
    stage:'all',
    business:'all',
    followup:'all',
    salesRep:'all',
    page:1,
    pageSize:20
  };
  const STAGES=['Contacting','Potential','Waiting Decision','Buy','Reject'];
  const CATEGORIES=['New Customer','Existing Customer','Referral','Project / Company','Other'];

  function crmAllowed(){return ['sales','manager','admin','super_admin'].includes(state.profile?.role||'')}
  function crmScopeSalesId(){
    if(typeof managerRepActive==='function'&&managerRepActive())return managerRepId();
    if(typeof managerTestActive==='function'&&managerTestActive())return state.managerRepContext?.user_id||null;
    if(['sales','manager'].includes(state.profile?.role||''))return state.user?.id||null;
    return null;
  }
  function crmCanFilterSales(){return !crmScopeSalesId()&&['admin','super_admin'].includes(state.profile?.role||'')}
  function todayIso(){
    const d=new Date(),off=d.getTimezoneOffset();
    return new Date(d.getTime()-off*60000).toISOString().slice(0,10);
  }
  function fmtDate(v){
    if(!v)return '-';
    const d=new Date(String(v).slice(0,10)+'T00:00:00');
    return Number.isNaN(d.getTime())?String(v):d.toLocaleDateString(undefined,{year:'numeric',month:'short',day:'numeric'});
  }
  function stageTone(s){
    if(s==='Buy')return 'bg-green-50 text-green-700 border-green-200';
    if(s==='Potential')return 'bg-amber-50 text-amber-700 border-amber-200';
    if(s==='Waiting Decision')return 'bg-purple-50 text-purple-700 border-purple-200';
    if(s==='Reject')return 'bg-red-50 text-red-600 border-red-200';
    return 'bg-blue-50 text-blue-700 border-blue-200';
  }
  function businessTone(code){
    if(code==='RK')return 'bg-[#fff8e7] text-[#8a650e] border-[#ead69b]';
    if(code==='TK')return 'bg-[#f5f1ff] text-[#6741a5] border-[#d8c9f4]';
    return 'bg-gray-50 text-gray-600 border-gray-200';
  }
  function businessText(code){return code==='RK'?'RK':code==='TK'?'TK':'Unassigned'}
  function activityLabel(type){return type==='online'?'Online':'Showroom Visit'}
  function sourceLabel(r){
    if(r.last_activity_type==='online')return 'Online';
    return r.last_source||'Showroom Visit';
  }
  function scopeRows(){
    const scope=crmScopeSalesId();
    let rows=(leadState.rows||[]);
    if(scope)rows=rows.filter(r=>String(r.assigned_sales_id||'')===String(scope));
    return rows;
  }
  function filteredRows(){
    const q=leadState.search.trim().toLowerCase(),today=todayIso();
    return scopeRows().filter(r=>{
      if(leadState.stage!=='all'&&r.stage!==leadState.stage)return false;
      if(leadState.business==='UNASSIGNED'&&r.business_code)return false;
      if(!['all','UNASSIGNED'].includes(leadState.business)&&r.business_code!==leadState.business)return false;
      if(leadState.salesRep!=='all'&&String(r.assigned_sales_id||'')!==leadState.salesRep)return false;
      if(leadState.followup==='overdue'&&!r.follow_up_overdue)return false;
      if(leadState.followup==='today'&&!r.follow_up_today)return false;
      if(leadState.followup==='upcoming'){
        const d=String(r.next_follow_up_date||'');
        if(!d)return false;
        const end=new Date(today+'T00:00:00');end.setDate(end.getDate()+7);
        if(new Date(d+'T00:00:00')<new Date(today+'T00:00:00')||new Date(d+'T00:00:00')>end)return false;
      }
      if(leadState.followup==='none'&&r.next_follow_up_date)return false;
      if(!q)return true;
      return [
        r.customer_name,r.phone,r.customer_category,r.stage,r.interest,r.notes,
        r.latest_remark,r.sales_rep_name,r.business_name,r.first_source,r.last_source
      ].some(v=>String(v||'').toLowerCase().includes(q));
    });
  }
  function pageRows(rows){
    if(leadState.pageSize==='all')return rows;
    const size=Number(leadState.pageSize||20),pages=Math.max(1,Math.ceil(rows.length/size));
    leadState.page=Math.max(1,Math.min(pages,leadState.page));
    return rows.slice((leadState.page-1)*size,leadState.page*size);
  }
  function counts(){
    const rows=scopeRows(),out={total:rows.length};
    STAGES.forEach(s=>out[s]=rows.filter(r=>r.stage===s).length);
    out.overdue=rows.filter(r=>r.follow_up_overdue).length;
    out.today=rows.filter(r=>r.follow_up_today).length;
    return out;
  }
  function kpi(label,value,sub,tone=''){
    return `<button type="button" onclick="${label==='Total Customers'?"setLeadStage('all')":STAGES.includes(label)?`setLeadStage('${label}')`:'void(0)'}" class="card rounded-2xl p-4 text-left">
      <div class="text-[10px] uppercase tracking-wide font-bold text-gray-400">${esc(label)}</div>
      <div class="text-2xl font-bold mt-1 ${tone}">${value}</div>
      <div class="text-[10px] text-gray-400 mt-1">${esc(sub)}</div>
    </button>`;
  }
  function salesFilter(){
    if(!crmCanFilterSales())return '';
    const users=leadState.salesUsers.filter(x=>['sales','manager'].includes(x.role));
    return `<select onchange="setLeadSalesRep(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm min-w-[170px]"><option value="all">All Sales</option>${users.map(u=>`<option value="${u.user_id}" ${leadState.salesRep===u.user_id?'selected':''}>${esc(u.display_name||u.email)}</option>`).join('')}</select>`;
  }
  function toolbar(){
    return `<div class="card rounded-2xl p-4 mb-4">
      <div class="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
        <div class="flex flex-col sm:flex-row flex-wrap gap-2 flex-1">
          <input value="${esc(leadState.search)}" oninput="setLeadSearch(this.value)" class="border rounded-xl px-4 py-2.5 bg-white w-full sm:max-w-[320px]" placeholder="Search customer, phone, interest, note...">
          <select onchange="setLeadStage(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
            <option value="all">All Stages</option>${STAGES.map(s=>`<option value="${s}" ${leadState.stage===s?'selected':''}>${s}</option>`).join('')}
          </select>
          <select onchange="setLeadBusiness(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
            <option value="all">All Business</option><option value="RK" ${leadState.business==='RK'?'selected':''}>LP Home · RK</option><option value="TK" ${leadState.business==='TK'?'selected':''}>L'Imperial Luxury · TK</option><option value="UNASSIGNED" ${leadState.business==='UNASSIGNED'?'selected':''}>Unassigned</option>
          </select>
          <select onchange="setLeadFollowup(this.value)" class="border rounded-xl bg-white px-3 py-2.5 text-sm">
            <option value="all">All Follow Ups</option>
            <option value="overdue" ${leadState.followup==='overdue'?'selected':''}>Overdue</option>
            <option value="today" ${leadState.followup==='today'?'selected':''}>Due Today</option>
            <option value="upcoming" ${leadState.followup==='upcoming'?'selected':''}>Next 7 Days</option>
            <option value="none" ${leadState.followup==='none'?'selected':''}>No Follow-up Date</option>
          </select>
          ${salesFilter()}
        </div>
        <button type="button" onclick="openNewCustomerLead()" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-sm font-semibold whitespace-nowrap">+ New Customer</button>
      </div>
    </div>`;
  }
  function rowHtml(r){
    const followClass=r.follow_up_overdue?'text-red-600 font-bold':r.follow_up_today?'text-amber-600 font-bold':'text-gray-600';
    const linkBadge=r.linked_customer_id
      ?'<span class="px-2 py-1 rounded-md border bg-green-50 text-green-700 border-green-200 text-[9px] font-bold">CUSTOMER</span>'
      :r.pending_customer_request_id
        ?'<span class="px-2 py-1 rounded-md border bg-amber-50 text-amber-700 border-amber-200 text-[9px] font-bold">APPROVAL PENDING</span>'
        :'';
    return `<button type="button" onclick="openCustomerLead('${r.lead_id}')" class="card rounded-2xl p-4 w-full text-left hover:border-[#d8c287] transition">
      <div class="grid lg:grid-cols-[1.35fr_.75fr_.85fr_.9fr_.85fr_.8fr_auto] gap-3 lg:gap-4 items-center">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2"><b class="truncate">${esc(r.customer_name)}</b><span class="px-2 py-1 rounded-md border text-[9px] font-bold ${businessTone(r.business_code)}">${esc(businessText(r.business_code))}</span>${linkBadge}</div>
          <div class="text-[11px] text-gray-400 mt-1">${esc(r.phone||'No phone')} · ${esc(r.customer_category||'No category')}</div>
          ${r.interest?`<div class="text-[11px] text-gray-600 mt-1 truncate">Interest: ${esc(r.interest)}</div>`:''}
        </div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Stage</div><span class="inline-flex mt-1 px-2 py-1 rounded-lg border text-[10px] font-semibold ${stageTone(r.stage)}">${esc(r.stage)}</span></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Last Contact</div><div class="text-xs font-semibold mt-1">${esc(fmtDate(r.last_contact_date))}</div><div class="text-[9px] text-gray-400 mt-0.5">${esc(sourceLabel(r))}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Follow Up</div><div class="text-xs mt-1 ${followClass}">${esc(fmtDate(r.next_follow_up_date))}</div>${r.follow_up_overdue?'<div class="text-[9px] text-red-500">Overdue</div>':r.follow_up_today?'<div class="text-[9px] text-amber-600">Due today</div>':''}</div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Sales</div><div class="text-xs mt-1 truncate">${esc(r.sales_rep_name||'-')}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Activity</div><div class="text-xs font-semibold mt-1">${Number(r.activity_count||0)} logs</div><div class="text-[9px] text-gray-400 mt-0.5">${Number(r.showroom_visits||0)} showroom · ${Number(r.online_inquiries||0)} online</div></div>
        <div class="text-[#b3871e] text-xs font-semibold whitespace-nowrap">View →</div>
      </div>
    </button>`;
  }
  function pager(total){
    const all=leadState.pageSize==='all',size=all?total:Number(leadState.pageSize||20),pages=all?1:Math.max(1,Math.ceil(total/size));
    const start=total?(all?1:(leadState.page-1)*size+1):0,end=total?(all?total:Math.min(leadState.page*size,total)):0;
    return `<div class="mt-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs text-gray-500">
      <div>Showing <b>${start}–${end}</b> of <b>${total}</b></div>
      <div class="flex items-center gap-2"><select onchange="setLeadPageSize(this.value)" class="border rounded-lg bg-white px-2.5 py-2"><option value="20" ${leadState.pageSize===20?'selected':''}>20 / page</option><option value="40" ${leadState.pageSize===40?'selected':''}>40 / page</option><option value="all" ${leadState.pageSize==='all'?'selected':''}>Show all</option></select>
      ${all?'':`<button onclick="changeLeadPage(-1)" ${leadState.page<=1?'disabled':''} class="px-3 py-2 border rounded-lg bg-white disabled:opacity-40">Prev</button><span>Page <b>${leadState.page}</b> / ${pages}</span><button onclick="changeLeadPage(1)" ${leadState.page>=pages?'disabled':''} class="px-3 py-2 border rounded-lg bg-white disabled:opacity-40">Next</button>`}</div>
    </div>`;
  }
  function renderLeadBody(){
    const root=document.getElementById('customerLeadRoot');if(!root)return;
    const c=counts(),rows=filteredRows(),paged=pageRows(rows);
    const alerts=[];
    if(c.overdue)alerts.push(`<button onclick="setLeadFollowup('overdue')" class="px-3 py-2 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs font-semibold">${c.overdue} overdue follow-up${c.overdue===1?'':'s'}</button>`);
    if(c.today)alerts.push(`<button onclick="setLeadFollowup('today')" class="px-3 py-2 rounded-xl border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold">${c.today} due today</button>`);
    root.innerHTML=`
      ${typeof managerRepActive==='function'&&managerRepActive()?managerRepBanner():''}
      <div class="flex flex-wrap justify-end gap-2 mb-3">${alerts.join('')}</div>
      <div class="grid grid-cols-2 xl:grid-cols-6 gap-3 mb-4">
        ${kpi('Total Customers',c.total,'All leads + buyers')}
        ${kpi('Contacting',c.Contacting,'Initial contact','text-blue-600')}
        ${kpi('Potential',c.Potential,'Qualified interest','text-amber-600')}
        ${kpi('Waiting Decision',c['Waiting Decision'],'Decision pending','text-purple-600')}
        ${kpi('Buy',c.Buy,'Converted / purchased','text-green-600')}
        ${kpi('Reject',c.Reject,'Lost / rejected','text-red-500')}
      </div>
      ${toolbar()}
      <div class="grid gap-3">${paged.map(rowHtml).join('')||'<div class="card rounded-2xl p-12 text-center text-sm text-gray-400">No customers match this selection.</div>'}</div>
      ${pager(rows.length)}
    `;
  }
  async function loadSalesUsers(){
    if(leadState.salesUsers.length)return;
    if(!crmCanFilterSales()&&!['admin','super_admin'].includes(state.profile?.role||''))return;
    const {data,error}=await db.from('app_users').select('user_id,display_name,email,role,active').in('role',['sales','manager']).eq('active',true).order('display_name');
    if(!error)leadState.salesUsers=data||[];
  }
  async function renderCustomerDatabase(){
    if(!crmAllowed())throw new Error('Sales access required');
    document.getElementById('pageTitle').textContent='Customer Database';
    document.getElementById('pageSubtitle').textContent='All leads and customers from Showroom Visit and Online';
    document.getElementById('content').innerHTML='<div id="customerLeadRoot"><div class="py-20 text-center text-gray-400">Loading customer database...</div></div>';
    await loadSalesUsers();
    const {data,error}=await db.rpc('get_customer_lead_rows');
    if(error)throw error;
    let rows=data||[];
    const scope=crmScopeSalesId();
    if(scope)rows=rows.filter(r=>String(r.assigned_sales_id||'')===String(scope));
    leadState.rows=rows;
    renderLeadBody();
  }
  function newLeadSalesField(){
    const scopeId=crmScopeSalesId();
    if(scopeId){
      const u=leadState.salesUsers.find(x=>x.user_id===scopeId);
      const label=u?.display_name||u?.email||state.managerRepContext?.display_name||state.profile?.display_name||state.user?.email||'Current Sales';
      return `<input id="newLeadSalesRep" type="hidden" value="${esc(scopeId)}"><div class="mt-1 border rounded-xl px-3 py-2.5 bg-gray-50 text-sm font-semibold">${esc(label)}</div>`;
    }
    if(['sales','manager'].includes(state.profile?.role||'')){
      const id=state.user?.id||'';
      const label=state.profile?.display_name||state.user?.email||'Current Sales';
      return `<input id="newLeadSalesRep" type="hidden" value="${esc(id)}"><div class="mt-1 border rounded-xl px-3 py-2.5 bg-gray-50 text-sm font-semibold">${esc(label)}</div>`;
    }
    const users=leadState.salesUsers.filter(x=>['sales','manager'].includes(x.role));
    return `<select id="newLeadSalesRep" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">
      <option value="">Assign to myself</option>
      ${users.map(u=>`<option value="${u.user_id}">${esc(u.display_name||u.email)} · ${esc(titleCase(u.role||''))}</option>`).join('')}
    </select>`;
  }

  window.openNewCustomerLead=function(){
    openModal('New Customer — Customer Database',`<form id="newCustomerLeadForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Customer Name</label><input id="newLeadName" required class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Customer name"></div>
      <div><label class="text-xs font-semibold">Phone</label><input id="newLeadPhone" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Phone / Telegram"></div>
      <div><label class="text-xs font-semibold">Customer Category</label><select id="newLeadCategory" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Select category</option>${CATEGORIES.map(x=>`<option value="${x}">${x}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">Business</label><select id="newLeadBusiness" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Unassigned</option><option value="RK">LP Home · RK</option><option value="TK">L'Imperial Luxury · TK</option></select></div>
      <div><label class="text-xs font-semibold">Current Stage</label><select id="newLeadStage" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${STAGES.map(x=>`<option value="${x}" ${x==='Contacting'?'selected':''}>${x}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">Assigned Sales</label>${newLeadSalesField()}</div>
      <div><label class="text-xs font-semibold">Next Follow-up</label><input id="newLeadFollowup" type="date" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Interest</label><input id="newLeadInterest" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Sofa, chandelier, bedroom set..."></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="newLeadNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="What the customer needs / next action..."></textarea></div>
      <div class="md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700">This adds the person directly to Customer Database. You can add Showroom Visit or Online activity later from the customer profile.</div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Add Customer</button>
    </form>`);
    document.getElementById('newCustomerLeadForm').onsubmit=saveNewCustomerLead;
  };

  async function saveNewCustomerLead(e){
    e.preventDefault();
    const btn=e.target.querySelector('button');if(btn){btn.disabled=true;btn.textContent='Adding Customer...'}
    const scopeId=crmScopeSalesId();
    const assigned=document.getElementById('newLeadSalesRep')?.value||scopeId||null;
    const {data,error}=await db.rpc('create_customer_lead_manual',{
      p_customer_name:document.getElementById('newLeadName').value.trim(),
      p_phone:document.getElementById('newLeadPhone').value.trim()||null,
      p_customer_category:document.getElementById('newLeadCategory').value||null,
      p_business_code:document.getElementById('newLeadBusiness').value||null,
      p_stage:document.getElementById('newLeadStage').value,
      p_interest:document.getElementById('newLeadInterest').value.trim()||null,
      p_next_follow_up_date:document.getElementById('newLeadFollowup').value||null,
      p_notes:document.getElementById('newLeadNotes').value.trim()||null,
      p_assigned_sales_id:assigned
    });
    if(error){if(btn){btn.disabled=false;btn.textContent='Add Customer'}return showToast(error.message,'err')}
    const out=data||{};
    closeModal();
    await renderCustomerDatabase();
    if(out.action==='existing'){
      showToast('This customer already exists in Customer Database. Opening the existing profile.');
      setTimeout(()=>openCustomerLead(out.lead_id),80);
    }else{
      showToast('Customer added to Customer Database.');
      if(out.lead_id)setTimeout(()=>openCustomerLead(out.lead_id),80);
    }
  }

  function leadById(id){return (leadState.rows||[]).find(x=>x.lead_id===id)}
  function leadForm(r){
    return `<div class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Customer Name</label><input id="leadName" value="${esc(r.customer_name||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Phone</label><input id="leadPhone" value="${esc(r.phone||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Customer Category</label><select id="leadCategory" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Select category</option>${CATEGORIES.map(x=>`<option value="${x}" ${r.customer_category===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">Business</label><select id="leadBusiness" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="" ${!r.business_code?'selected':''}>Unassigned</option><option value="RK" ${r.business_code==='RK'?'selected':''}>LP Home · RK</option><option value="TK" ${r.business_code==='TK'?'selected':''}>L'Imperial Luxury · TK</option></select></div>
      <div><label class="text-xs font-semibold">Current Stage</label><select id="leadStage" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${STAGES.map(x=>`<option value="${x}" ${r.stage===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">Next Follow-up</label><input id="leadFollowup" type="date" value="${esc(r.next_follow_up_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Interest</label><input id="leadInterest" value="${esc(r.interest||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Sofa, chandelier, bedroom set..."></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="leadNotes" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Important customer information / next action...">${esc(r.notes||'')}</textarea></div>
    </div>`;
  }
  function leadHeader(r){
    const customerLink=r.linked_customer_id
      ?`<button onclick="closeModal();openCustomerOrders('${r.linked_customer_id}')" class="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold">Open Customer Master</button>`
      :r.pending_customer_request_id
        ?'<span class="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold">Customer approval pending</span>'
        :`<button onclick="convertLeadToCustomer('${r.lead_id}')" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Convert / Link Customer</button>`;
    return `<div class="rounded-2xl border bg-[#faf9f6] p-4 mb-4">
      <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div><div class="flex flex-wrap items-center gap-2"><h3 class="text-xl font-serif font-bold">${esc(r.customer_name)}</h3><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${businessTone(r.business_code)}">${esc(businessText(r.business_code))}</span><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${stageTone(r.stage)}">${esc(r.stage)}</span></div><div class="text-xs text-gray-400 mt-1">${esc(r.phone||'No phone')} · ${esc(r.sales_rep_name||'-')}</div></div>
        <div class="flex flex-wrap gap-2">${customerLink}<button onclick="openLeadActivity('${r.lead_id}','showroom_visit')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">+ Showroom Visit</button><button onclick="openLeadActivity('${r.lead_id}','online')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">+ Online</button></div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 text-xs"><div><div class="text-[9px] uppercase font-bold text-gray-400">First Contact</div><b>${esc(fmtDate(r.first_contact_date))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Last Contact</div><b>${esc(fmtDate(r.last_contact_date))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Activities</div><b>${Number(r.activity_count||0)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Showroom</div><b>${Number(r.showroom_visits||0)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Online</div><b>${Number(r.online_inquiries||0)}</b></div></div>
    </div>`;
  }
  function historyHtml(rows){
    if(!rows.length)return '<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No activity logs yet.</div>';
    return '<div class="grid gap-2">'+rows.map(a=>`<div class="rounded-xl border p-3 bg-white"><div class="flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-2"><b class="text-sm">${esc(activityLabel(a.activity_type))}</b><span class="px-2 py-0.5 rounded-md border text-[9px] font-bold ${businessTone(a.business_code)}">${esc(a.business_code)}</span>${a.status?`<span class="px-2 py-0.5 rounded-md border text-[9px] font-semibold ${stageTone(a.status==='Reject / Lost'?'Reject':a.status)}">${esc(a.status)}</span>`:''}</div><span class="text-[10px] text-gray-400">${esc(fmtDate(a.activity_date))}</span></div><div class="text-[11px] text-gray-500 mt-2">${[a.source_channel&&('Source: '+a.source_channel),a.interest&&('Interest: '+a.interest),a.remark].filter(Boolean).map(esc).join(' · ')||'No note'}</div>${a.follow_up_date?`<div class="text-[10px] text-blue-600 mt-1">Follow up: ${esc(fmtDate(a.follow_up_date))}</div>`:''}</div>`).join('')+'</div>';
  }
  window.openCustomerLead=async function(id){
    const r=leadById(id);if(!r)return showToast('Customer not found','err');
    openModal('Customer Database — '+r.customer_name,`<div id="leadDetailBody">${leadHeader(r)}${leadForm(r)}<div class="flex gap-2 mt-4"><button onclick="saveCustomerLead('${r.lead_id}')" class="flex-1 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer</button></div><div class="border-t mt-5 pt-5"><div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">Activity History</h4><div class="text-[10px] text-gray-400">Showroom Visit and Online logs for this customer.</div></div></div><div class="py-8 text-center text-xs text-gray-400">Loading history...</div></div></div>`);
    const {data,error}=await db.rpc('get_customer_lead_activities',{p_lead_id:id});
    const body=document.getElementById('leadDetailBody');
    if(!body)return;
    const holder=body.querySelector('.border-t.mt-5.pt-5');
    if(holder){
      const loading=holder.lastElementChild;
      if(loading)loading.outerHTML=error?`<div class="text-red-500 text-xs">${esc(error.message)}</div>`:historyHtml(data||[]);
    }
  };
  window.saveCustomerLead=async function(id){
    const args={
      p_lead_id:id,
      p_stage:document.getElementById('leadStage').value,
      p_customer_name:document.getElementById('leadName').value.trim(),
      p_phone:document.getElementById('leadPhone').value.trim()||null,
      p_customer_category:document.getElementById('leadCategory').value||null,
      p_business_code:document.getElementById('leadBusiness').value||null,
      p_interest:document.getElementById('leadInterest').value.trim()||null,
      p_next_follow_up_date:document.getElementById('leadFollowup').value||null,
      p_notes:document.getElementById('leadNotes').value.trim()||null
    };
    const {error}=await db.rpc('update_customer_lead',args);
    if(error)return showToast(error.message,'err');
    closeModal();showToast('Customer updated');await renderCustomerDatabase();
  };
  window.openLeadActivity=function(id,type){
    const r=leadById(id);if(!r)return showToast('Customer not found','err');
    const typeName=activityLabel(type);
    openModal('Add '+typeName+' — '+r.customer_name,`<form id="leadActivityForm" class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Date</label><input id="laDate" type="date" value="${todayIso()}" required class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Business</label><select id="laBusiness" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="RK" ${r.business_code==='RK'?'selected':''}>LP Home · RK</option><option value="TK" ${r.business_code==='TK'?'selected':''}>L'Imperial Luxury · TK</option></select></div>
      <div><label class="text-xs font-semibold">Customer</label><input value="${esc(r.customer_name)}" disabled class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-gray-50"></div>
      <div><label class="text-xs font-semibold">Phone</label><input value="${esc(r.phone||'')}" disabled class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-gray-50"></div>
      <div><label class="text-xs font-semibold">Customer Stage</label><select id="laStage" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${STAGES.map(s=>`<option value="${s}" ${s===r.stage?'selected':''}>${s}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">Next Follow-up</label><input id="laFollowup" type="date" value="${esc(r.next_follow_up_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Interest</label><input id="laInterest" value="${esc(r.interest||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      ${type==='showroom_visit'?'<div class="md:col-span-2"><label class="text-xs font-semibold">Source</label><select id="laSource" class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option>Showroom</option><option>Friend or Family</option><option>Site Location</option><option>Other</option></select></div>':''}
      <div class="md:col-span-2"><label class="text-xs font-semibold">Remark</label><textarea id="laRemark" rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="What happened / next action..."></textarea></div>
      <button class="md:col-span-2 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save ${esc(typeName)}</button>
    </form>`);
    document.getElementById('leadActivityForm').onsubmit=async e=>{
      e.preventDefault();
      const {error}=await db.rpc('create_customer_activity',{
        p_activity_type:type,p_activity_date:document.getElementById('laDate').value,p_business_code:document.getElementById('laBusiness').value,
        p_customer_name:r.customer_name,p_phone:r.phone||null,p_customer_type:r.customer_category||null,
        p_source_channel:type==='online'?'Online':(document.getElementById('laSource')?.value||'Showroom'),
        p_status:document.getElementById('laStage').value,p_interest:document.getElementById('laInterest').value.trim()||null,
        p_remark:document.getElementById('laRemark').value.trim()||null,p_follow_up_date:document.getElementById('laFollowup').value||null,
        p_assigned_sales_id:r.assigned_sales_id
      });
      if(error)return showToast(error.message,'err');
      closeModal();showToast(typeName+' added');await renderCustomerDatabase();setTimeout(()=>openCustomerLead(id),60);
    };
  };
  window.convertLeadToCustomer=async function(id){
    const r=leadById(id);if(!r)return;
    const {data,error}=await db.rpc('convert_customer_lead',{p_lead_id:id});
    if(error)return showToast(error.message,'err');
    const out=data||{};
    closeModal();
    if(out.action==='pending')showToast('Customer creation submitted for Manager/Admin approval.');
    else if(out.action==='linked')showToast('Linked to the existing Customer Master record.');
    else showToast('Customer created and linked to Customer Master.');
    await renderCustomerDatabase();
  };
  window.findExistingCustomerForLead=async function(id){ // available for future/custom use
    const r=leadById(id);if(!r)return;
    const q=r.phone||r.customer_name;
    const {data,error}=await db.rpc('search_customer_directory',{p_query:q});
    if(error)return showToast(error.message,'err');
    const rows=data||[];
    openModal('Link Existing Customer',`<div class="space-y-2">${rows.map(x=>`<button onclick="linkLeadToCustomer('${id}','${x.customer_id}')" class="w-full text-left border rounded-xl p-3 hover:bg-gray-50"><b>${esc(x.customer_name)}</b><div class="text-[10px] text-gray-400 mt-1">${esc((x.contacts||[]).map(c=>c.value).join(' · ')||'No contact')} · ${esc(x.handled_by_name||'Unassigned')}</div></button>`).join('')||'<div class="p-8 text-center text-sm text-gray-400">No matching Customer Master records found.</div>'}</div>`);
  };
  window.linkLeadToCustomer=async function(leadId,customerId){
    const {error}=await db.rpc('link_customer_lead',{p_lead_id:leadId,p_customer_id:customerId});
    if(error)return showToast(error.message,'err');
    closeModal();showToast('Customer linked');await renderCustomerDatabase();
  };

  window.setLeadSearch=function(v){leadState.search=v;leadState.page=1;renderLeadBody()};
  window.setLeadStage=function(v){leadState.stage=v;leadState.page=1;renderLeadBody()};
  window.setLeadBusiness=function(v){leadState.business=v;leadState.page=1;renderLeadBody()};
  window.setLeadFollowup=function(v){leadState.followup=v;leadState.page=1;renderLeadBody()};
  window.setLeadSalesRep=function(v){leadState.salesRep=v;leadState.page=1;renderLeadBody()};
  window.setLeadPageSize=function(v){leadState.pageSize=v==='all'?'all':([20,40].includes(Number(v))?Number(v):20);leadState.page=1;renderLeadBody()};
  window.changeLeadPage=function(delta){
    if(leadState.pageSize==='all')return;
    const total=filteredRows().length,pages=Math.max(1,Math.ceil(total/Number(leadState.pageSize||20)));
    leadState.page=Math.max(1,Math.min(pages,leadState.page+Number(delta||0)));renderLeadBody();
    document.getElementById('customerLeadRoot')?.scrollIntoView({behavior:'smooth',block:'start'});
  };

  const prevNavItems=window.navItems;
  window.navItems=function(){
    const items=(prevNavItems.apply(this,arguments)||[]).slice();
    if(!crmAllowed())return items;
    if(!items.some(x=>x[0]==='customer-database')){
      const idx=items.findIndex(x=>x[0]==='customers');
      items.splice(idx>=0?idx+1:1,0,['customer-database','Customer Database','◎']);
    }
    return items;
  };
  const prevGo=window.go;
  window.go=async function(page){
    if(page==='customer-database'){
      state.page=page;renderNav();
      document.getElementById('content').innerHTML='<div class="py-20 text-center text-gray-400">Loading customer database...</div>';
      try{await renderCustomerDatabase()}catch(err){document.getElementById('content').innerHTML=`<div class="card rounded-xl p-5 text-red-600">Error: ${esc(err.message)}</div>`}
      return;
    }
    return prevGo(page);
  };
})();