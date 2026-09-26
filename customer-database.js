// Customer Database / lightweight CRM built from Showroom Visit + Online activity logs.
(function(){
  const leadState={
    rows:[],
    salesUsers:[],
    stageRequests:[],
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
  const STAGE_RANK={Contacting:1,Potential:2,'Waiting Decision':3,Buy:4,Reject:4};
  function stageRank(s){return STAGE_RANK[s]||0}
  function pendingStageRequest(r){
    return (leadState.stageRequests||[]).find(x=>x.status==='pending'&&String(x.lead_id)===String(r?.lead_id));
  }
  function correctionTargets(r){
    if(!r)return [];
    if(['Buy','Reject'].includes(r.stage))return STAGES.filter(s=>s!==r.stage);
    return STAGES.filter(s=>s!==r.stage&&stageRank(s)<=stageRank(r.stage));
  }

  function crmAllowed(){return ['sales','manager','admin','super_admin'].includes(state.profile?.role||'')}
  function crmScopeSalesId(){
    if(typeof managerRepActive==='function'&&managerRepActive())return managerRepId();
    if((state.profile?.role||'')==='sales')return state.user?.id||null;
    return null;
  }
  function crmEditSalesId(){
    if(typeof managerRepActive==='function'&&managerRepActive())return managerRepId();
    if(typeof managerTestActive==='function'&&managerTestActive())return state.managerRepContext?.user_id||null;
    if(['sales','manager'].includes(state.profile?.role||''))return state.user?.id||null;
    return null;
  }
  function crmCanFilterSales(){return !crmScopeSalesId()&&['manager','admin','super_admin'].includes(state.profile?.role||'')}
  function crmCanEditLead(r){
    const role=state.profile?.role||'';
    const delegated=(typeof managerRepActive==='function'&&managerRepActive())||(typeof managerTestActive==='function'&&managerTestActive());
    if(['admin','super_admin'].includes(role)&&!delegated)return true;
    const id=crmEditSalesId();
    return !!id&&String(r?.assigned_sales_id||'')===String(id);
  }
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
  function tabBaseRows(){
    const q=leadState.search.trim().toLowerCase(),today=todayIso();
    return scopeRows().filter(r=>{
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
  function counts(){
    const rows=tabBaseRows(),out={total:rows.length};
    STAGES.forEach(s=>out[s]=rows.filter(r=>r.stage===s).length);
    out.overdue=scopeRows().filter(r=>r.follow_up_overdue).length;
    out.today=scopeRows().filter(r=>r.follow_up_today).length;
    return out;
  }
  function stageTabs(c){
    const tabs=[['all','All Leads',c.total],...STAGES.map(s=>[s,s,c[s]||0])];
    return `<div class="card rounded-2xl px-3 pt-3 mb-4 overflow-x-auto">
      <div class="flex items-end gap-1 min-w-max border-b">
        ${tabs.map(([value,label,count])=>{
          const active=leadState.stage===value;
          return `<button type="button" onclick="setLeadStage('${value}')" class="px-4 py-3 text-sm font-semibold border-b-2 transition ${active?'border-[#b3871e] text-[#8a650e] bg-[#fffaf0]':'border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50'}">
            <span>${esc(label)}</span>
            <span class="ml-1.5 inline-flex min-w-[22px] h-[22px] items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${active?'bg-[#b3871e] text-white':'bg-gray-100 text-gray-500'}">${count}</span>
          </button>`;
        }).join('')}
      </div>
    </div>`;
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
  function stageControl(r){
    const pending=pendingStageRequest(r);
    if(!crmCanEditLead(r)){
      return `<div class="mt-1 flex flex-wrap items-center gap-1.5"><span class="inline-flex px-2 py-1 rounded-lg border text-[10px] font-semibold ${stageTone(r.stage)}">${esc(r.stage)}</span>${pending?'<span class="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-[9px] font-bold">CORRECTION PENDING</span>':''}</div>`;
    }
    if(pending){
      return `<div class="mt-1 flex flex-wrap items-center gap-1.5"><span class="inline-flex px-2 py-1 rounded-lg border text-[10px] font-semibold ${stageTone(r.stage)}">${esc(r.stage)}</span><button type="button" data-stop-row onclick="openLeadStageCorrection('${r.lead_id}')" class="px-2 py-1 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-[9px] font-bold">CORRECTION PENDING</button></div>`;
    }
    const forward=STAGES.filter(s=>stageRank(s)>stageRank(r.stage));
    const direct=forward.length
      ?`<select data-stop-row onchange="openLeadStageChange('${r.lead_id}',this.value);this.value='${esc(r.stage)}'" class="w-full min-w-[145px] border rounded-lg px-2 py-1.5 bg-white text-[11px] font-semibold"><option value="${esc(r.stage)}" selected>${esc(r.stage)}</option>${forward.map(s=>`<option value="${s}">${s}</option>`).join('')}</select>`
      :`<span class="inline-flex px-2 py-1 rounded-lg border text-[10px] font-semibold ${stageTone(r.stage)}">${esc(r.stage)}</span>`;
    const correction=stageRank(r.stage)>1
      ?`<button type="button" data-stop-row onclick="openLeadStageCorrection('${r.lead_id}')" class="text-[9px] font-semibold text-amber-700 hover:underline whitespace-nowrap">Request correction</button>`
      :'';
    return `<div class="mt-1 flex flex-col items-start gap-1.5">${direct}${correction}</div>`;
  }

  function rowHtml(r){
    const followClass=r.follow_up_overdue?'text-red-600 font-bold':r.follow_up_today?'text-amber-600 font-bold':'text-gray-600';
    const linkBadge=r.linked_customer_id
      ?'<span class="px-2 py-1 rounded-md border bg-green-50 text-green-700 border-green-200 text-[9px] font-bold">CUSTOMER</span>'
      :r.pending_customer_request_id
        ?'<span class="px-2 py-1 rounded-md border bg-amber-50 text-amber-700 border-amber-200 text-[9px] font-bold">APPROVAL PENDING</span>'
        :'';
    return `<div onclick="if(!event.target.closest('[data-stop-row]'))openCustomerLead('${r.lead_id}')" class="card rounded-2xl p-4 w-full text-left hover:border-[#d8c287] transition cursor-pointer">
      <div class="grid lg:grid-cols-[1.35fr_.9fr_.85fr_.9fr_.85fr_.8fr_auto] gap-3 lg:gap-4 items-center">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2"><b class="truncate">${esc(r.customer_name)}</b><span class="px-2 py-1 rounded-md border text-[9px] font-bold ${businessTone(r.business_code)}">${esc(businessText(r.business_code))}</span>${linkBadge}</div>
          <div class="text-[11px] text-gray-400 mt-1">${esc(r.phone||'No phone')} · ${esc(r.customer_category||'No category')}</div>
          ${r.interest?`<div class="text-[11px] text-gray-600 mt-1 truncate">Interest: ${esc(r.interest)}</div>`:''}
        </div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Stage</div>${stageControl(r)}</div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Last Contact</div><div class="text-xs font-semibold mt-1">${esc(fmtDate(r.last_contact_date))}</div><div class="text-[9px] text-gray-400 mt-0.5">${esc(sourceLabel(r))}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Follow Up</div><div class="text-xs mt-1 ${followClass}">${esc(fmtDate(r.next_follow_up_date))}</div>${r.follow_up_overdue?'<div class="text-[9px] text-red-500">Overdue</div>':r.follow_up_today?'<div class="text-[9px] text-amber-600">Due today</div>':''}</div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Sales</div><div class="text-xs mt-1 truncate">${esc(r.sales_rep_name||'-')}</div></div>
        <div><div class="text-[9px] uppercase font-bold text-gray-400">Activity</div><div class="text-xs font-semibold mt-1">${Number(r.activity_count||0)} logs</div><div class="text-[9px] text-gray-400 mt-0.5">${Number(r.showroom_visits||0)} showroom · ${Number(r.online_inquiries||0)} online</div></div>
        <button type="button" data-stop-row onclick="openCustomerLead('${r.lead_id}')" class="text-[#b3871e] text-xs font-semibold whitespace-nowrap px-2 py-1.5 rounded-lg hover:bg-[#fffaf0]">View →</button>
      </div>
    </div>`;
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
      ${stageTabs(c)}
      ${toolbar()}
      <div class="grid gap-3">${paged.map(rowHtml).join('')||'<div class="card rounded-2xl p-12 text-center text-sm text-gray-400">No customers match this selection.</div>'}</div>
      ${pager(rows.length)}
    `;
  }
  async function loadSalesUsers(){
    if(leadState.salesUsers.length)return;
    if(!crmCanFilterSales()&&!['manager','admin','super_admin'].includes(state.profile?.role||''))return;
    const {data,error}=await db.from('app_users').select('user_id,display_name,email,role,active').in('role',['sales','manager']).eq('active',true).order('display_name');
    if(!error)leadState.salesUsers=data||[];
  }
  async function renderCustomerDatabase(){
    if(!crmAllowed())throw new Error('Sales access required');
    document.getElementById('pageTitle').textContent='Customer Database';
    document.getElementById('pageSubtitle').textContent='All leads and customers from Showroom Visit and Online';
    document.getElementById('content').innerHTML='<div id="customerLeadRoot"><div class="py-20 text-center text-gray-400">Loading customer database...</div></div>';
    await loadSalesUsers();
    const [leadRes,requestRes]=await Promise.all([
      db.rpc('get_customer_lead_rows'),
      db.rpc('get_visible_customer_lead_stage_change_requests',{p_status:'pending'})
    ]);
    if(leadRes.error)throw leadRes.error;
    if(requestRes.error)console.warn('Stage correction requests:',requestRes.error.message);
    leadState.stageRequests=requestRes.error?[]:(requestRes.data||[]);
    let rows=leadRes.data||[];
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
  function leadForm(r,editable=true){
    const dis=editable?'':'disabled';
    return `<div class="grid md:grid-cols-2 gap-4">
      <div><label class="text-xs font-semibold">Customer Name</label><input id="leadName" value="${esc(r.customer_name||'')}"  ${dis} class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Phone</label><input id="leadPhone" value="${esc(r.phone||'')}"  ${dis} class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div><label class="text-xs font-semibold">Customer Category</label><select id="leadCategory"  ${dis} class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="">Select category</option>${CATEGORIES.map(x=>`<option value="${x}" ${r.customer_category===x?'selected':''}>${x}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">Business</label><select id="leadBusiness"  ${dis} class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white"><option value="" ${!r.business_code?'selected':''}>Unassigned</option><option value="RK" ${r.business_code==='RK'?'selected':''}>LP Home · RK</option><option value="TK" ${r.business_code==='TK'?'selected':''}>L'Imperial Luxury · TK</option></select></div>
      <div><label class="text-xs font-semibold">Current Stage</label><input id="leadStage" type="hidden" value="${esc(r.stage)}"><div class="mt-1">${stageControl(r)}</div><div class="text-[9px] text-gray-400 mt-1">Stages move forward only. Corrections require approval.</div></div>
      <div><label class="text-xs font-semibold">Next Follow-up</label><input id="leadFollowup" type="date" value="${esc(r.next_follow_up_date||'')}"  ${dis} class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Interest</label><input id="leadInterest" value="${esc(r.interest||'')}"  ${dis} class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Sofa, chandelier, bedroom set..."></div>
      <div class="md:col-span-2"><label class="text-xs font-semibold">Customer Note</label><textarea id="leadNotes" rows="3"  ${dis} class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Important customer information / next action...">${esc(r.notes||'')}</textarea></div>
    </div>`;
  }
  function leadHeader(r,editable=true){
    const customerLink=r.linked_customer_id
      ?`<button onclick="closeModal();openCustomerOrders('${r.linked_customer_id}')" class="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold">Open Customer Master</button>`
      :r.pending_customer_request_id
        ?'<span class="px-3 py-2 rounded-lg border border-amber-200 bg-amber-50 text-amber-700 text-xs font-semibold">Customer approval pending</span>'
        :editable
          ?`<button onclick="convertLeadToCustomer('${r.lead_id}')" class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Convert / Link Customer</button>`
          :'<span class="px-3 py-2 rounded-lg border bg-white text-gray-500 text-xs font-semibold">Manager View</span>';
    const activityActions=editable
      ?`<button onclick="openLeadActivity('${r.lead_id}','showroom_visit')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">+ Showroom Visit</button><button onclick="openLeadActivity('${r.lead_id}','online')" class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">+ Online</button>`
      :'';
    return `<div class="rounded-2xl border bg-[#faf9f6] p-4 mb-4">
      <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div><div class="flex flex-wrap items-center gap-2"><h3 class="text-xl font-serif font-bold">${esc(r.customer_name)}</h3><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${businessTone(r.business_code)}">${esc(businessText(r.business_code))}</span><span class="px-2 py-1 rounded-lg border text-[9px] font-bold ${stageTone(r.stage)}">${esc(r.stage)}</span></div><div class="text-xs text-gray-400 mt-1">${esc(r.phone||'No phone')} · ${esc(r.sales_rep_name||'-')}</div></div>
        <div class="flex flex-wrap gap-2">${customerLink}${activityActions}</div>
      </div>
      <div class="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 text-xs"><div><div class="text-[9px] uppercase font-bold text-gray-400">First Contact</div><b>${esc(fmtDate(r.first_contact_date))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Last Contact</div><b>${esc(fmtDate(r.last_contact_date))}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Activities</div><b>${Number(r.activity_count||0)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Showroom</div><b>${Number(r.showroom_visits||0)}</b></div><div><div class="text-[9px] uppercase font-bold text-gray-400">Online</div><b>${Number(r.online_inquiries||0)}</b></div></div>
    </div>`;
  }
  function historyHtml(rows){
    if(!rows.length)return '<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No activity logs yet.</div>';
    return '<div class="grid gap-2">'+rows.map(a=>`<div class="rounded-xl border p-3 bg-white"><div class="flex flex-wrap items-center justify-between gap-2"><div class="flex items-center gap-2"><b class="text-sm">${esc(activityLabel(a.activity_type))}</b><span class="px-2 py-0.5 rounded-md border text-[9px] font-bold ${businessTone(a.business_code)}">${esc(a.business_code)}</span>${a.status?`<span class="px-2 py-0.5 rounded-md border text-[9px] font-semibold ${stageTone(a.status==='Reject / Lost'?'Reject':a.status)}">${esc(a.status)}</span>`:''}</div><span class="text-[10px] text-gray-400">${esc(fmtDate(a.activity_date))}</span></div><div class="text-[11px] text-gray-500 mt-2">${[a.source_channel&&('Source: '+a.source_channel),a.interest&&('Interest: '+a.interest),a.remark].filter(Boolean).map(esc).join(' · ')||'No note'}</div>${a.follow_up_date?`<div class="text-[10px] text-blue-600 mt-1">Follow up: ${esc(fmtDate(a.follow_up_date))}</div>`:''}</div>`).join('')+'</div>';
  }
  window.openLeadStageChange=function(id,newStage){
    const r=leadById(id);if(!r||!crmCanEditLead(r)||!newStage||newStage===r.stage)return;
    if(pendingStageRequest(r))return showToast('Resolve the pending stage correction before moving this customer forward.','err');
    if(['Buy','Reject'].includes(r.stage)||stageRank(newStage)<=stageRank(r.stage))return openLeadStageCorrection(id);
    openModal('Move Customer Stage Forward',`<form id="leadStageChangeForm" class="space-y-4">
      <div class="rounded-xl border bg-gray-50 p-4">
        <div class="text-xs text-gray-500">${esc(r.customer_name)}</div>
        <div class="flex items-center gap-2 mt-2">
          <span class="px-2 py-1 rounded-lg border text-xs font-semibold ${stageTone(r.stage)}">${esc(r.stage)}</span>
          <span class="text-gray-400">→</span>
          <span class="px-2 py-1 rounded-lg border text-xs font-semibold ${stageTone(newStage)}">${esc(newStage)}</span>
        </div>
      </div>
      <div class="rounded-xl border border-green-100 bg-green-50 p-3 text-xs text-green-800"><b>Forward move.</b> This can be saved immediately. Once moved, returning to an earlier stage requires Manager/Admin approval.</div>
      <div><label class="text-xs font-semibold">Stage Change Note</label><textarea id="leadStageNote" required rows="3" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Why is this customer moving to ${esc(newStage)}?"></textarea></div>
      <div><label class="text-xs font-semibold">Next Follow-up</label><input id="leadStageFollowup" type="date" value="${esc((newStage==='Buy'||newStage==='Reject')?'':(r.next_follow_up_date||''))}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Forward Stage Change</button>
    </form>`);
    document.getElementById('leadStageChangeForm').onsubmit=async e=>{
      e.preventDefault();
      const note=document.getElementById('leadStageNote').value.trim();
      if(!note)return showToast('Please enter a note for the stage change.','err');
      const btn=e.target.querySelector('button');if(btn){btn.disabled=true;btn.textContent='Saving...'}
      const {error}=await db.rpc('change_customer_lead_stage',{
        p_lead_id:id,
        p_new_stage:newStage,
        p_note:note,
        p_next_follow_up_date:document.getElementById('leadStageFollowup').value||null
      });
      if(error){if(btn){btn.disabled=false;btn.textContent='Save Forward Stage Change'}return showToast(error.message,'err')}
      closeModal();
      showToast('Customer moved forward to '+newStage);
      await renderCustomerDatabase();
    };
  };

  window.openLeadStageCorrection=function(id){
    const r=leadById(id);if(!r||!crmCanEditLead(r))return;
    const pending=pendingStageRequest(r);
    if(pending){
      return openModal('Stage Correction Pending',`<div class="space-y-4">
        <div class="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"><b>This customer already has a stage correction waiting for approval.</b><div class="mt-2 flex items-center gap-2"><span class="px-2 py-1 rounded-lg border bg-white">${esc(pending.from_stage)}</span><span>→</span><span class="px-2 py-1 rounded-lg border bg-white">${esc(pending.to_stage)}</span></div></div>
        <div class="rounded-xl border p-3 text-sm"><div class="text-[10px] uppercase font-bold text-gray-400">Reason</div><div class="mt-1">${esc(pending.request_note||'-')}</div></div>
        <div class="text-xs text-gray-500">The live stage remains <b>${esc(r.stage)}</b> until Manager/Admin approves.</div>
        <button onclick="closeModal()" class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Close</button>
      </div>`);
    }
    const targets=correctionTargets(r);
    if(!targets.length)return showToast('There is no earlier stage to request for this customer.','err');
    openModal('Request Stage Correction',`<form id="leadStageCorrectionForm" class="space-y-4">
      <div class="rounded-xl border bg-gray-50 p-4">
        <div class="text-xs text-gray-500">${esc(r.customer_name)}</div>
        <div class="text-sm font-semibold mt-1">Current stage: <span class="px-2 py-1 rounded-lg border ${stageTone(r.stage)}">${esc(r.stage)}</span></div>
      </div>
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900"><b>Approval required.</b> The customer's current stage will not change until a Manager/Admin approves this correction.</div>
      <div><label class="text-xs font-semibold">Requested Stage</label><select id="leadCorrectionStage" required class="mt-1 w-full border rounded-xl px-3 py-2.5 bg-white">${targets.map(s=>`<option value="${s}">${s}</option>`).join('')}</select></div>
      <div><label class="text-xs font-semibold">Reason for Correction</label><textarea id="leadCorrectionReason" required rows="3" class="mt-1 w-full border border-amber-200 bg-amber-50 rounded-xl px-3 py-2.5" placeholder="Example: Buy was selected by mistake. Customer is still waiting for a decision."></textarea></div>
      <div><label class="text-xs font-semibold">Next Follow-up</label><input id="leadCorrectionFollowup" type="date" value="${esc(r.next_follow_up_date||'')}" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>
      <button class="w-full bg-[#211d18] text-white rounded-xl py-3 font-semibold">Submit for Manager/Admin Approval</button>
    </form>`);
    document.getElementById('leadStageCorrectionForm').onsubmit=async e=>{
      e.preventDefault();
      const target=document.getElementById('leadCorrectionStage').value;
      const reason=document.getElementById('leadCorrectionReason').value.trim();
      if(!reason)return showToast('Please explain why the stage needs correction.','err');
      const btn=e.target.querySelector('button');if(btn){btn.disabled=true;btn.textContent='Submitting...'}
      const {error}=await db.rpc('submit_customer_lead_stage_change_request',{
        p_lead_id:id,
        p_requested_stage:target,
        p_reason:reason,
        p_next_follow_up_date:document.getElementById('leadCorrectionFollowup').value||null
      });
      if(error){if(btn){btn.disabled=false;btn.textContent='Submit for Manager/Admin Approval'}return showToast(error.message,'err')}
      closeModal();
      showToast('Stage correction submitted. The current stage is unchanged until approval.');
      await renderCustomerDatabase();
      if(typeof refreshApprovalNotifications==='function')setTimeout(refreshApprovalNotifications,50);
    };
  };

  function stageHistoryHtml(rows){
    if(!rows.length)return '<div class="rounded-xl border border-dashed p-6 text-center text-xs text-gray-400">No stage changes yet.</div>';
    return '<div class="grid gap-2">'+rows.map(h=>`<div class="rounded-xl border bg-white p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          ${h.from_stage?`<span class="px-2 py-1 rounded-md border text-[9px] font-semibold ${stageTone(h.from_stage)}">${esc(h.from_stage)}</span><span class="text-gray-400">→</span>`:''}
          <span class="px-2 py-1 rounded-md border text-[9px] font-semibold ${stageTone(h.to_stage)}">${esc(h.to_stage)}</span>
        </div>
        <span class="text-[10px] text-gray-400">${new Date(h.changed_at).toLocaleString()}</span>
      </div>
      <div class="text-xs text-gray-600 mt-2">${esc(h.note||'-')}</div>
      <div class="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-400"><span>Changed by: ${esc(h.changed_by_name||'System')}</span>${h.next_follow_up_date?`<span>Follow-up: ${esc(fmtDate(h.next_follow_up_date))}</span>`:''}</div>
    </div>`).join('')+'</div>';
  }

  function stageRequestHistoryHtml(rows){
    if(!rows.length)return '<div class="rounded-xl border border-dashed p-6 text-center text-xs text-gray-400">No correction requests yet.</div>';
    function tone(s){return s==='approved'?'bg-green-50 text-green-700 border-green-200':s==='rejected'?'bg-red-50 text-red-600 border-red-200':'bg-amber-50 text-amber-700 border-amber-200'}
    return '<div class="grid gap-2">'+rows.map(h=>`<div class="rounded-xl border bg-white p-3">
      <div class="flex flex-wrap items-center justify-between gap-2">
        <div class="flex flex-wrap items-center gap-2"><span class="px-2 py-1 rounded-md border text-[9px] font-semibold ${stageTone(h.from_stage)}">${esc(h.from_stage)}</span><span class="text-gray-400">→</span><span class="px-2 py-1 rounded-md border text-[9px] font-semibold ${stageTone(h.to_stage)}">${esc(h.to_stage)}</span><span class="px-2 py-1 rounded-md border text-[9px] font-bold uppercase ${tone(h.status)}">${esc(h.status)}</span></div>
        <span class="text-[10px] text-gray-400">${new Date(h.requested_at).toLocaleString()}</span>
      </div>
      <div class="text-xs text-gray-600 mt-2"><b>Reason:</b> ${esc(h.request_note||'-')}</div>
      <div class="flex flex-wrap gap-3 mt-2 text-[10px] text-gray-400"><span>Requested by: ${esc(h.requested_by_name||'User')}</span>${h.reviewed_by_name?`<span>Reviewed by: ${esc(h.reviewed_by_name)}</span>`:''}${h.reviewed_at?`<span>${new Date(h.reviewed_at).toLocaleString()}</span>`:''}</div>
      ${h.review_note?`<div class="text-[10px] text-gray-500 mt-2"><b>Reviewer note:</b> ${esc(h.review_note)}</div>`:''}
    </div>`).join('')+'</div>';
  }

  window.openCustomerLead=async function(id){
    const r=leadById(id);if(!r)return showToast('Customer not found','err');
    const editable=crmCanEditLead(r);
    const saveArea=editable?`<div class="flex gap-2 mt-4"><button onclick="saveCustomerLead('${r.lead_id}')" class="flex-1 bg-[#211d18] text-white rounded-xl py-3 font-semibold">Save Customer</button></div>`:`<div class="mt-4 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-[11px] text-blue-700">Manager can review this Sales Rep's stage, follow-up and activity history. The Sales Rep keeps ownership of editing this customer.</div>`;
    openModal('Customer Database — '+r.customer_name,`<div id="leadDetailBody">${leadHeader(r,editable)}${leadForm(r,editable)}${saveArea}
      <div id="leadStageRequestSection" class="border-t mt-5 pt-5"><div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">Stage Correction Requests</h4><div class="text-[10px] text-gray-400">Pending, approved and rejected requests to correct an earlier stage.</div></div></div><div class="py-6 text-center text-xs text-gray-400">Loading correction requests...</div></div>
      <div id="leadStageHistorySection" class="border-t mt-5 pt-5"><div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">Stage History</h4><div class="text-[10px] text-gray-400">Approved and forward movement between CRM stages.</div></div></div><div class="py-6 text-center text-xs text-gray-400">Loading stage history...</div></div>
      <div id="leadActivityHistorySection" class="border-t mt-5 pt-5"><div class="flex items-center justify-between mb-3"><div><h4 class="font-bold">Activity History</h4><div class="text-[10px] text-gray-400">Showroom Visit and Online logs for this customer.</div></div></div><div class="py-8 text-center text-xs text-gray-400">Loading activity history...</div></div>
    </div>`);
    const [activityRes,stageRes,requestRes]=await Promise.all([
      db.rpc('get_customer_lead_activities',{p_lead_id:id}),
      db.rpc('get_customer_lead_stage_history',{p_lead_id:id}),
      db.rpc('get_customer_lead_stage_request_history',{p_lead_id:id})
    ]);
    const body=document.getElementById('leadDetailBody');
    if(!body)return;
    const requestHolder=document.getElementById('leadStageRequestSection');
    const stageHolder=document.getElementById('leadStageHistorySection');
    const activityHolder=document.getElementById('leadActivityHistorySection');
    if(requestHolder){
      const loading=requestHolder.lastElementChild;
      if(loading)loading.outerHTML=requestRes.error?`<div class="text-red-500 text-xs">${esc(requestRes.error.message)}</div>`:stageRequestHistoryHtml(requestRes.data||[]);
    }
    if(stageHolder){
      const loading=stageHolder.lastElementChild;
      if(loading)loading.outerHTML=stageRes.error?`<div class="text-red-500 text-xs">${esc(stageRes.error.message)}</div>`:stageHistoryHtml(stageRes.data||[]);
    }
    if(activityHolder){
      const loading=activityHolder.lastElementChild;
      if(loading)loading.outerHTML=activityRes.error?`<div class="text-red-500 text-xs">${esc(activityRes.error.message)}</div>`:historyHtml(activityRes.data||[]);
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
      <div><label class="text-xs font-semibold">Customer Stage</label><input id="laStage" type="hidden" value="${esc(r.stage)}"><div class="mt-1 border rounded-xl px-3 py-2.5 bg-gray-50"><span class="px-2 py-1 rounded-lg border text-[10px] font-semibold ${stageTone(r.stage)}">${esc(r.stage)}</span><div class="text-[9px] text-gray-400 mt-1">Activity logs do not move CRM stages. Use the stage control in Customer Database.</div></div></div>
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
  window.openCustomerStageChangeRequestDetail=async function(id){
    const role=state.profile?.role||'';
    if(!['manager','admin','super_admin'].includes(role))return showToast('Manager/Admin access required.','err');
    const {data,error}=await db.rpc('get_visible_customer_lead_stage_change_requests',{p_status:null});
    if(error)return showToast(error.message,'err');
    const r=(data||[]).find(x=>x.request_id===id);
    if(!r)return showToast('Stage correction request not found.','err');
    const stale=r.current_stage!==r.from_stage;
    openModal('Review CRM Stage Correction',`<div class="space-y-4">
      <div class="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <div class="text-[10px] uppercase font-bold text-amber-700">Stage Correction Request</div>
        <div class="text-xl font-bold mt-1">${esc(r.customer_name||'Customer')}</div>
        <div class="text-xs text-gray-500 mt-1">Sales: ${esc(r.sales_rep_name||'-')} · Requested by ${esc(r.requested_by_name||'User')} · ${new Date(r.requested_at).toLocaleString()}</div>
      </div>
      <div class="rounded-xl border p-4">
        <div class="text-[10px] uppercase font-bold text-gray-400">Requested Change</div>
        <div class="flex items-center gap-2 mt-2"><span class="px-2 py-1 rounded-lg border ${stageTone(r.from_stage)}">${esc(r.from_stage)}</span><span class="text-gray-400">→</span><span class="px-2 py-1 rounded-lg border ${stageTone(r.to_stage)}">${esc(r.to_stage)}</span></div>
        <div class="text-sm mt-3"><b>Reason:</b> ${esc(r.request_note||'-')}</div>
        ${r.requested_follow_up_date?`<div class="text-xs text-gray-500 mt-2">Requested follow-up: ${esc(fmtDate(r.requested_follow_up_date))}</div>`:''}
      </div>
      ${stale?`<div class="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-700"><b>Cannot safely approve:</b> the live stage is now ${esc(r.current_stage)} instead of ${esc(r.from_stage)}. Reject this request and ask for a new correction.</div>`:`<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">The live stage is still <b>${esc(r.current_stage)}</b>. It will change only if you approve.</div>`}
      <div><label class="text-xs font-semibold">Reviewer Note</label><textarea id="stageCorrectionReviewNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional for approval; required for rejection."></textarea></div>
      <div class="flex justify-end gap-2 border-t pt-4"><button type="button" onclick="reviewCustomerStageChangeRequest('${r.request_id}','reject')" class="px-4 py-2.5 border border-red-200 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Reject</button><button type="button" ${stale?'disabled':''} onclick="reviewCustomerStageChangeRequest('${r.request_id}','approve')" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold disabled:opacity-40">Approve Stage Correction</button></div>
    </div>`);
  };

  window.reviewCustomerStageChangeRequest=async function(id,action){
    const note=(document.getElementById('stageCorrectionReviewNote')?.value||'').trim();
    if(action==='reject'&&!note)return showToast('Please enter a reason for rejection.','err');
    if(!confirm(action==='approve'?'Approve this stage correction and update the live customer stage?':'Reject this stage correction request?'))return;
    const {error}=await db.rpc('review_customer_lead_stage_change_request',{
      p_request_id:id,
      p_action:action,
      p_review_note:note||null
    });
    if(error)return showToast(error.message,'err');
    closeModal();
    showToast(action==='approve'?'Stage correction approved and applied.':'Stage correction request rejected.');
    if(typeof refreshApprovalNotifications==='function')await refreshApprovalNotifications();
    await go('approvals');
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