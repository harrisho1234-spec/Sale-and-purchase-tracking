/* Management dashboard: reuses official Sales Report and target-plan RPCs.
 * Role- and RLS-aware; read-only; does not write business data.
 */
(function(){
'use strict';
const ROLE=new Set(['admin','super_admin','manager']);
const MONTHS=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','"':'&quot;',"'":'&#39;'}[c]));
const num=x=>Number.isFinite(Number(x))?Number(x):0;
const cash=x=>'$'+num(x).toLocaleString('en-US',{maximumFractionDigits:0});
const percent=(x,y)=>y>0?(100*x/y).toFixed(1)+'%':'—';
let year=new Date().getFullYear(),quarter=Math.floor(new Date().getMonth()/3)+1,uid='',nonce=0;
const role=()=>String(state?.profile?.role||'');
const canRender=()=>ROLE.has(role())&&
  (typeof window.hasAppPermission!=='function' ||
   ['targets.view_company','targets.view_team','targets.manage','targets.view_business'].some(p=>window.hasAppPermission(p)));
const category=r=>String(r.sales_category||'').toLowerCase()==='project'?'PJ':
  ['RK','TK'].includes(String(r.business_code||'').toUpperCase())?String(r.business_code).toUpperCase():'OTHER';
const month=r=>Number(String(r.order_date||'').slice(5,7));
const scopedLabel=p=>p.can_company||p.can_manage?'Company':p.can_team?'Visible team':'Permitted sales';
function quarterMonths(q){return [q*3-2,q*3-1,q*3];}
function scopeRows(rows,plan){
  if(plan.can_company||plan.can_manage||plan.can_business)return rows;
  if(plan.can_team){
    const ids=new Set((plan.reps||[]).map(x=>String(x.id)));
    return rows.filter(r=>ids.has(String(r.sales_rep_id)));
  }
  return [];
}
function targetForQuarter(plan,q){
  const weights=Array.isArray(plan.months)&&plan.months.length===12?plan.months:Array(12).fill(100/12);
  return quarterMonths(q).reduce((s,m)=>s+num(weights[m-1]),0)/100*num(plan.annual_target);
}
function metric(label,value,subtitle){
  return '<div class="rounded-xl border border-[#e8e4dc] bg-white p-3 sm:p-4 min-w-0">'+
    '<div class="text-[10px] sm:text-xs font-semibold text-gray-500">'+esc(label)+'</div>'+
    '<div class="text-xl sm:text-2xl font-bold mt-1 tracking-tight">'+esc(value)+'</div>'+
    '<div class="text-[11px] text-gray-500 mt-1">'+esc(subtitle)+'</div></div>';
}
function bar(value,target){
  const ratio=target>0?Math.min(100,Math.max(0,value/target*100)):0;
  const color=ratio>=100?'#268461':ratio>=75?'#b68b35':'#cd735b';
  return '<div class="h-2 rounded-full bg-gray-100 overflow-hidden"><div class="h-full rounded-full" style="width:'+ratio+'%;background:'+color+'"></div></div>';
}
function renderTeam(rows,plan,months,qTarget){
  if(!plan.can_team&&!plan.can_company&&!plan.can_manage)return '';
  const roster=Array.isArray(plan.reps)?plan.reps:[];
  if(!roster.length)return '<p class="text-sm text-gray-500">No salesperson allocations have been configured for this year.</p>';
  const grouped=new Map();
  rows.forEach(r=>{
    const k=String(r.sales_rep_id||'');
    if(!k)return;
    const g=grouped.get(k)||{sum:0,month:[0,0,0]};
    const m=month(r),idx=months.indexOf(m);
    if(idx>=0){g.sum+=num(r.actual_sales);g.month[idx]+=num(r.actual_sales);}
    grouped.set(k,g);
  });
  const weightedQ=targetForQuarter(plan,quarter)/Math.max(1,num(plan.annual_target));
  return '<div class="overflow-x-auto"><table class="w-full text-xs sm:text-sm text-left"><thead class="border-b text-[11px] uppercase tracking-wide text-gray-500"><tr>'+
    '<th class="py-2 pr-3">Salesperson</th>'+
    months.map(m=>'<th class="py-2 px-2 text-right">'+MONTHS[m-1]+'</th>').join('')+
    '<th class="py-2 px-2 text-right">Q total</th><th class="py-2 px-2 min-w-[140px]">Quarter target / achievement</th></tr></thead><tbody>'+
    roster.map(rep=>{
      const g=grouped.get(String(rep.id))||{sum:0,month:[0,0,0]};
      const target=num(rep.annual_target)*weightedQ;
      return '<tr class="border-b last:border-0"><td class="py-3 pr-3 font-semibold whitespace-nowrap">'+esc(rep.name||'Salesperson')+
        (rep.status==='resigned'?'<div class="text-[10px] text-gray-400">Inactive · historical</div>':'')+'</td>'+
        g.month.map(v=>'<td class="px-2 py-3 text-right whitespace-nowrap">'+cash(v)+'</td>').join('')+
        '<td class="px-2 py-3 text-right font-bold">'+cash(g.sum)+'</td>'+
        '<td class="px-2 py-3"><div class="flex justify-between gap-2 mb-1"><span>'+cash(target)+'</span><b>'+percent(g.sum,target)+'</b></div>'+bar(g.sum,target)+'</td></tr>';
    }).join('')+'</tbody></table></div>'+
    '<p class="text-[11px] text-amber-800 mt-3">Individual actuals above show official invoice attribution. Approved shared target credits may differ; review Target Sharing before using this table for individual incentives. Company revenue is never summed from shared credits.</p>';
}
function compactApprovals(node){
  const raw=node?.querySelector('[data-approval-dashboard]');
  if(!raw)return '';
  const title=raw.querySelector('h3'),countLabel=title?.nextElementSibling;
  const count=Number((countLabel?.textContent||'').trim())||0;
  raw.remove();
  return '<div class="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5">'+
    '<div class="flex items-center gap-2 min-w-0"><span class="text-amber-800 font-bold text-sm">Pending Approvals</span>'+
    '<span class="inline-flex items-center justify-center rounded-full bg-amber-700 text-white min-w-[23px] h-[23px] px-1.5 text-xs font-bold">'+count+'</span></div>'+
    '<button type="button" onclick="go(\'approvals\')" class="text-xs font-bold text-amber-900 hover:underline whitespace-nowrap">Review requests →</button></div>';
}
async function render(){
  const page=state?.page;
  if(page!=='dashboard'||!canRender())return;
  const root=document.getElementById('content');
  if(!root)return;
  if(uid!==String(state?.user?.id||'')){uid=String(state?.user?.id||'');year=new Date().getFullYear();quarter=Math.floor(new Date().getMonth()/3)+1;}
  const generation=++nonce;
  const approvals=compactApprovals(root),oldHTML=root.innerHTML;
  root.innerHTML='<div class="rounded-2xl bg-white border p-5 mb-4 text-sm text-gray-500">Loading management performance from the official Sales Report and saved targets…</div>';
  try{
    const [rr,pr]=await Promise.all([
      db.rpc('get_sales_report_rows_v6'),
      db.rpc('get_sales_target_plan',{p_year:year})
    ]);
    if(rr.error)throw rr.error;if(pr.error)throw pr.error;
    if(generation!==nonce||state?.page!=='dashboard')return;
    const plan=pr.data||{};
    if(!plan.allowed)throw new Error('Target permissions are not available for this account.');
    const all=Array.isArray(rr.data)?rr.data:[];
    const allowed=scopeRows(all,plan);
    const months=quarterMonths(quarter);
    const scoped=allowed.filter(r=>String(r.order_date||'').slice(0,4)===String(year)&&months.includes(month(r))&&category(r)!=='OTHER');
    const actual=scoped.reduce((a,r)=>a+num(r.actual_sales),0);
    const target=plan.configured?targetForQuarter(plan,quarter):0;
    const now=new Date(),current=year===now.getFullYear()&&quarter===Math.floor(now.getMonth()/3)+1;
    const currentQuarter=Math.floor(now.getMonth()/3)+1;
    const isPastQuarter=year<now.getFullYear()||(year===now.getFullYear()&&quarter<currentQuarter);
    const startOfQuarter=new Date(year,months[0]-1,1),endOfQuarter=new Date(year,months[2],1);
    const elapsed=current?(now-startOfQuarter)/(endOfQuarter-startOfQuarter):(isPastQuarter?1:0);
    const expected=target*Math.max(0,Math.min(1,elapsed));
    const pace=target>0?(actual>=expected?'On / ahead of pace':'Behind pace'):'Target not set';
    const remaining=Math.max(0,target-actual);
    const group={RK:0,TK:0,PJ:0};
    scoped.forEach(r=>{group[category(r)]+=num(r.actual_sales)});
    const oldSection='<details class="rounded-xl border bg-white mt-5"><summary class="cursor-pointer p-4 font-semibold text-sm">Operational details · AR, awaiting delivery, pre-orders and recent orders</summary><div class="p-3 border-t">'+oldHTML+'</div></details>';
    root.innerHTML='<div class="space-y-4" data-management-dashboard>'+
      '<div class="flex flex-wrap justify-between items-center gap-3"><div><h2 class="text-xl font-bold text-[#211d18]">Management Performance</h2><p class="text-xs text-gray-500">Official sales results · '+esc(scopedLabel(plan))+' scope</p></div>'+
      '<div class="flex flex-wrap gap-2"><label class="text-xs font-semibold text-gray-500">Year <select id="mgmtYear" class="border rounded-lg p-2 text-sm bg-white">'+
      [year-1,year,year+1].filter((x,i,a)=>a.indexOf(x)===i&&x>=2020).map(y=>'<option value="'+y+'"'+(year===y?' selected':'')+'>'+y+'</option>').join('')+'</select></label>'+
      '<label class="text-xs font-semibold text-gray-500">Quarter <select id="mgmtQuarter" class="border rounded-lg p-2 text-sm bg-white">'+[1,2,3,4].map(q=>'<option value="'+q+'"'+(q===quarter?' selected':'')+'>Q'+q+'</option>').join('')+'</select></label></div></div>'+
      '<div class="grid grid-cols-2 xl:grid-cols-4 gap-3">'+
      metric('Quarter actual',cash(actual),'Official actual sales')+
      metric('Quarter target',plan.configured?cash(target):'Not set',plan.configured?percent(actual,target)+' achieved':'Open Reports → Targets')+
      metric('Remaining to goal',plan.configured?cash(remaining):'—','Outstanding quarter goal')+
      metric('Target pacing',pace,current?'Expected by today '+cash(expected):'Selected quarter')+'</div>'+
      approvals+
      '<div class="grid xl:grid-cols-3 gap-4">'+
      '<section class="xl:col-span-2 rounded-2xl border bg-white p-4"><h3 class="font-bold">Monthly actual vs allocated target</h3><p class="text-xs text-gray-500 mb-4">Quarter distribution follows saved monthly target weights</p>'+
      months.map(m=>{const value=scoped.filter(r=>month(r)===m).reduce((a,r)=>a+num(r.actual_sales),0);
        const weights=Array.isArray(plan.months)&&plan.months.length===12?plan.months:Array(12).fill(100/12);
        const sumWeights=months.reduce((sum,k)=>sum+num(weights[k-1]),0);
        const moTarget=plan.configured&&sumWeights>0?target*num(weights[m-1])/sumWeights:0;
        return '<div class="mb-4"><div class="flex justify-between text-xs gap-2 mb-1"><b>'+MONTHS[m-1]+'</b><span>'+cash(value)+' / '+(plan.configured?cash(moTarget):'Target not set')+'</span></div>'+bar(value,moTarget)+'</div>';
      }).join('')+'</section>'+
      '<section class="rounded-2xl border bg-white p-4"><h3 class="font-bold mb-3">Business categories</h3>'+
      ['RK','TK','PJ'].map(k=>'<div class="flex justify-between py-2 border-b last:border-0 text-sm"><span>'+esc(k)+'</span><b>'+cash(group[k])+'</b></div>').join('')+
      '<p class="text-xs text-gray-500 mt-3">Revenue is counted once using official report rows. RK/TK/PJ are not multiplied by salesperson allocation.</p></section></div>'+
      '<section class="rounded-2xl border bg-white p-4"><div class="flex flex-wrap justify-between items-center gap-2 mb-3"><h3 class="font-bold">Salesperson monthly performance</h3><button type="button" onclick="go(\'reports\')" class="text-xs text-amber-800 font-semibold underline">Open detailed Reports</button></div>'+
      renderTeam(scoped,plan,months,target)+'</section>'+
      oldSection+'</div>';
    root.querySelector('#mgmtYear')?.addEventListener('change',e=>{year=Number(e.target.value);render();});
    root.querySelector('#mgmtQuarter')?.addEventListener('change',e=>{quarter=Number(e.target.value);render();});
  }catch(err){
    if(generation!==nonce||state?.page!=='dashboard')return;
    root.innerHTML='<div class="rounded-xl border border-amber-200 bg-amber-50 p-4"><b>Management performance unavailable</b><p class="text-sm mt-1">'+esc(err.message||'Unable to load management data')+'</p><button class="text-xs underline mt-2" type="button" onclick="renderDashboard()">Retry</button></div>'+approvals+oldHTML;
  }
}
const previous=window.renderDashboard;
if(typeof previous==='function'){
  window.renderDashboard=async function(){
    const result=await previous.apply(this,arguments);
    await render();
    return result;
  };
}
})();