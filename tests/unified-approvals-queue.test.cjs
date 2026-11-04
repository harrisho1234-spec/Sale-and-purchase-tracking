const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const approvals=read('approval-notifications.js');
const daily=read('sales-daily-plan.js');
const attention=read('database/20261104_unified_review_attention_for_cn_do_stock.sql');
const cnDate=read('database/20261104_cn_queue_requested_timestamp.sql');
const index=read('index.html');

function mock(role='admin',permissions={}){
 const calls=[],ui={innerHTML:''},modal={html:''},pages=[],visited=[];
 const blocks={
  approvalTypeFilters:{innerHTML:''},
  approvalTypeResults:{innerHTML:''},
  approvalTypeSummary:{textContent:''},
  approvalTypeHeading:{textContent:''}
 };
 const canned={
  get_visible_sales_order_edit_requests:[],
  get_visible_customer_change_requests:[],
  get_visible_sales_payment_requests:[],
  get_visible_customer_lead_stage_change_requests:[],
  get_pending_activity_sales_assignments:[],
  get_pending_sr_conversion_requests:[],
  get_stock_action_requests:[],
  get_visible_cn_case_workflows:[
   {return_id:'cn-new',cn_no:'CN-NEW',customer_name:'Customer A',action:'return_only',
    requested_by:'salesperson',approval_status:'pending',stock_complete:false,
    financial_decision:'pending',requested_at:'2026-11-04T08:00:00Z'},
   {return_id:'cn-own',cn_no:'CN-OWN',customer_name:'Manager Own',action:'return_only',
    requested_by:'reviewer',approval_status:'pending',stock_complete:false,
    financial_decision:'pending',requested_at:'2026-11-04T09:00:00Z'},
   {return_id:'cn-credit',cn_no:'CN-CREDIT',customer_name:'Customer B',action:'return_to_stock',
    requested_by:'salesperson',approval_status:'approved',stock_complete:true,
    financial_decision:'pending',requested_at:'2026-11-03T09:00:00Z',approved_at:'2026-11-04T07:00:00Z'},
   {return_id:'cn-unready',cn_no:'CN-UNREADY',customer_name:'Customer C',action:'return_to_stock',
    requested_by:'salesperson',approval_status:'approved',stock_complete:false,
    financial_decision:'pending',requested_at:'2026-11-03T09:00:00Z'},
   {return_id:'cn-closed',cn_no:'CN-CLOSED',customer_name:'Customer D',action:'return_to_stock',
    requested_by:'salesperson',approval_status:'approved',stock_complete:true,
    financial_decision:'credit_ar',closed_at:'2026-11-03',requested_at:'2026-11-03T09:00:00Z'}
  ],
  get_delivery_order_edit_requests:[
   {id:'do-edit',do_no:'DO2611-001',status:'pending',reason:'Wrong delivery address',requested_at:'2026-11-04T06:00:00Z'}
  ],
  get_stock_count_edit_requests:[
   {id:'stock-count',period_month:'2026-11-01',status:'pending',reason:'Missing stock count row',requested_at:'2026-11-04T05:00:00Z'}
  ]
 };
 const context={
  state:{user:{id:'reviewer'},profile:{role},page:'approvals'},
  document:{
   visibilityState:'visible',
   getElementById:id=>id==='content'?ui:id==='pageTitle'?{closest:()=>null}:id==='pageSubtitle'?{textContent:''}:(blocks[id]||null),
   querySelectorAll:()=>[]
  },
  db:{
   rpc:(name,args)=>{calls.push({name,args});return Promise.resolve({data:canned[name]||[],error:null})},
   from:name=>({
    select(){return this},eq(){return this},order(){return this},limit(){return this},
    then(cb,err){return Promise.resolve({data:[],error:null}).then(cb,err)}
   })
  },
  hasAppPermission:key=>permissions[key]??(
    role==='sales'?false:
    key==='inventory.approve'?['admin','super_admin'].includes(role):
    true
  ),
  navItems:()=>[['dashboard','Home','□']],
  renderNav:()=>{},
  go:async page=>{pages.push(page);context.state.page=page},
  closeModal:()=>{calls.push({name:'closeModal'})},
  openModal:(title,html)=>{modal.title=title;modal.html=html},
  showToast:(message)=>{calls.push({name:'toast',message})},
  setInterval:()=>1,
  setTimeout:()=>1,
  console:{warn:()=>{},log:()=>{}},
  money:n=>'$'+Number(n||0).toFixed(2),
  esc:s=>String(s||''),
  Date,Promise,Math,Array,String,Number
 };
 context.window=context;
 context.getSalesDailyApprovalQueue=async()=>role==='sales'?[]:[
  {kind:'edit',report_id:'daily-r',id:'daily-edit:x',date:'2026-11-04',
   salesperson:'Sales A',userId:'sales-user',section:'PM',reason:'Correct evening result',
   requested_at:'2026-11-04T06:30:00Z'}];
 context._visibleSalesReturns=[{return_id:'cn-new'}];
 context.viewSalesReturn=async id=>{visited.push({what:'cn',id})};
 context.openDeliveryOrderEditQueue=async()=>{visited.push({what:'do'})};
 context.openStockCountEditQueue=async()=>{visited.push({what:'count'})};
 context.openSalesDailyApprovalItem=async(id,date,userId)=>{visited.push({what:'daily',id,date,userId})};
 vm.runInNewContext(approvals,context,{timeout:2500});
 return {context,calls,ui,modal,canned,pages,visited,blocks};
}
test('Admin sees approval types with accurate counts and actionable grouped requests',async()=>{
 const x=mock();
 await x.context.renderApprovals();
 const html=x.ui.innerHTML+' '+x.blocks.approvalTypeFilters.innerHTML+' '+x.blocks.approvalTypeResults.innerHTML;
 for(const type of ['Return / CN Approval','CN Credit Decisions','DO Edit Requests','Stock Count Edits','Team Daily Review'])
   assert.ok(html.includes(type),type);
 for(const expected of ['CN-NEW','CN-CREDIT','DO2611-001','Stock Count','Sales A'])
   assert.ok(x.blocks.approvalTypeResults.innerHTML.includes(expected),expected);
 for(const hidden of ['CN-OWN','CN-UNREADY','CN-CLOSED'])
   assert.ok(!x.blocks.approvalTypeResults.innerHTML.includes(hidden),'should not show '+hidden);
 assert.match(x.ui.innerHTML,/Total Pending <b[^>]*>5<\/b>/);
 assert.match(x.blocks.approvalTypeSummary.textContent,/5 pending requests across 5 active approval type\(s\)/);
 const queried=x.calls.filter(c=>c.name.startsWith('get_')).map(c=>c.name);
 for(const name of ['get_visible_cn_case_workflows','get_delivery_order_edit_requests',
 'get_stock_count_edit_requests'])assert.ok(queried.includes(name),name);
});
test('CN approval and financial decisions have separate filters',async()=>{
 const x=mock();
 await x.context.openApprovalCenter('cn_approval');
 assert.match(x.modal.html,/openCNApprovalFromCenter\('cn-new'\)/);
 assert.doesNotMatch(x.modal.html,/openCNApprovalFromCenter\('cn-credit'\)/);
 await x.context.openApprovalCenter('cn_finance');
 assert.match(x.modal.html,/openCNApprovalFromCenter\('cn-credit'\)/);
 assert.doesNotMatch(x.modal.html,/openCNApprovalFromCenter\('cn-new'\)/);
});
test('each approval uses its existing permission-controlled review workflow',async()=>{
 const x=mock();
 await x.context.openCNApprovalFromCenter('cn-new');
 await x.context.openDOEditApprovalFromCenter();
 await x.context.openStockCountApprovalFromCenter();
 await x.context.openDailyApprovalFromCenter('daily-r','2026-11-04','sales-user');
 assert.equal(JSON.stringify(x.visited),JSON.stringify([
  {what:'cn',id:'cn-new'},{what:'do'},{what:'count'},
  {what:'daily',id:'daily-r',date:'2026-11-04',userId:'sales-user'}]));
 assert.ok(x.pages.includes('returns'));
});
test('Manager sees CN + Daily reviews but cannot see Admin-only DO/Stock Count types',async()=>{
 const x=mock('manager');
 await x.context.renderApprovals();
 assert.match(x.blocks.approvalTypeResults.innerHTML,/CN-NEW/);
 assert.match(x.blocks.approvalTypeResults.innerHTML,/CN-CREDIT/);
 assert.match(x.blocks.approvalTypeResults.innerHTML,/Sales A/);
 assert.doesNotMatch(x.blocks.approvalTypeResults.innerHTML,/DO2611-001/);
 assert.doesNotMatch(x.blocks.approvalTypeFilters.innerHTML,/data-approval-type="do_edit"/);
 assert.doesNotMatch(x.blocks.approvalTypeFilters.innerHTML,/data-approval-type="stock_count_edit"/);
 assert.doesNotMatch(x.blocks.approvalTypeFilters.innerHTML,/data-approval-type="stock"/);
 assert.equal(x.calls.filter(c=>c.name==='get_delivery_order_edit_requests').length,0);
 assert.equal(x.calls.filter(c=>c.name==='get_stock_count_edit_requests').length,0);
});
test('user without Return approval permission sees neither CN details nor CN type counters',async()=>{
 const x=mock('manager',{'returns.approve':false});
 await x.context.renderApprovals();
 assert.doesNotMatch(x.blocks.approvalTypeResults.innerHTML,/CN-NEW|CN-CREDIT/);
 assert.doesNotMatch(x.blocks.approvalTypeFilters.innerHTML,/data-approval-type="cn_approval"|data-approval-type="cn_finance"/);
 assert.equal(x.calls.filter(x=>x.name==='get_visible_cn_case_workflows').length,0);
});
test('Sales users never get approval queue or manager review cards',async()=>{
 const x=mock('sales');
 await assert.rejects(x.context.renderApprovals(),/Manager\/Admin/);
 await x.context.refreshApprovalNotifications();
 assert.equal(x.calls.filter(x=>x.name.startsWith('get_')).length,0);
});
test('Daily approval queue is loaded from the authenticated Google Sheets relay, not copied to Supabase',()=>{
 assert.match(daily,/window\.getSalesDailyApprovalQueue=async/);
 assert.match(daily,/api\('read',\{start:backDays\(today\(\),30\),end:today\(\),userId:null\}\)/);
 assert.match(daily,/window\.openSalesDailyApprovalItem=async/);
 assert.match(daily,/await window\.go\(R\)/);
 assert.match(daily,/window\.openDailyManagerReport/);
});
test('bell/PWA attention and CN timestamps include existing review queues',()=>{
 for(const text of ['cn_case_workflows','cn_case_stock_complete','sales_sr_conversion_requests',
  'customer_activity_assignment_requests','delivery_order_edit_requests','stock_count_edit_requests'])
  assert.ok(attention.includes(text),text);
 assert.match(attention,/Return\/CN review/);
 assert.match(attention,/cn_credit:/);
 assert.match(cnDate,/'requested_at',r\.created_at/);
});
test('browser cache versions point to newest Approvals, Daily and bell scripts',()=>{
 assert.match(index,/approval-notifications\.js\?v=20261104-type-tabs-v2/);
 assert.match(index,/sales-daily-plan\.js\?v=20261104-unified-cn-do-daily1/);
 assert.match(index,/push-notifications\.js\?v=20261104-unified-review-bell1/);
});

test('PWA bell combines SQL attention with authenticated recent Daily review count',async()=>{
 const push=read('push-notifications.js');
 const start=push.indexOf('  async function refreshAttention(){');
 const end=push.indexOf('  async function waitForUser(){',start);
 assert.ok(start>0&&end>start);
 const sandbox={
  P:{attention:null},window:{getSalesDailyApprovalQueue:async()=>[{id:'daily1'},{id:'daily2'}]},
  readyUser:()=>true,
  db:{rpc:async()=>({data:{count:3,target:'approvals',body:'3 Return/CN reviews'}})},
  renderButton:()=>{},applyAppBadge:async()=>{},ensureSubscription:async()=>{},
  Notification:{permission:'denied'},console:{warn:()=>{}},
  Promise,Number,Array
 };
 vm.runInNewContext(push.slice(start,end)+'\nthis.refreshAttentionTest=refreshAttention;',sandbox,{timeout:2000});
 await sandbox.refreshAttentionTest();
 assert.equal(sandbox.P.attention.count,5);
 assert.equal(sandbox.P.attention.target,'approvals');
 assert.match(sandbox.P.attention.body,/2 Team Daily Reviews/);
 assert.match(sandbox.P.attention.body,/3 Return\/CN reviews/);
});
test('notification priority opens actionable approvals before unrelated Tax alerts',()=>{
 const sql=read('database/20261104_prioritize_approval_bell_navigation.sql');
 assert.match(sql,/if v_approvals>0 or v_stock_approvals>0 then v_target:='approvals'/);
 assert.match(sql,/elsif v_tax_sales>0 then v_target:='tax-inventory'/);
});

test('selecting an approval type filters requests inline and retains that type on refresh',async()=>{
 const x=mock();
 await x.context.renderApprovals();
 assert.match(x.blocks.approvalTypeFilters.innerHTML,/data-approval-type="all" aria-pressed="true"/);
 x.context.setApprovalType('cn_approval');
 assert.equal(x.blocks.approvalTypeHeading.textContent,'Return / CN Approval');
 assert.match(x.blocks.approvalTypeResults.innerHTML,/CN-NEW/);
 assert.doesNotMatch(x.blocks.approvalTypeResults.innerHTML,/CN-CREDIT|DO2611-001|Sales A/);
 assert.match(x.blocks.approvalTypeFilters.innerHTML,/data-approval-type="cn_approval" aria-pressed="true"/);
 assert.match(x.blocks.approvalTypeSummary.textContent,/1 pending request in this approval type/);
 await x.context.renderApprovals();
 assert.equal(x.blocks.approvalTypeHeading.textContent,'Return / CN Approval');
 x.context.setApprovalType('cn_finance');
 assert.match(x.blocks.approvalTypeResults.innerHTML,/CN-CREDIT/);
 assert.doesNotMatch(x.blocks.approvalTypeResults.innerHTML,/CN-NEW/);
 x.context.setApprovalType('orders');
 assert.match(x.blocks.approvalTypeResults.innerHTML,/No pending order edits requests/);
 assert.match(x.blocks.approvalTypeFilters.innerHTML,/data-approval-type="orders" aria-pressed="true"/);
 x.context.setApprovalType('all');
 assert.match(x.blocks.approvalTypeResults.innerHTML,/data-approval-group="cn_approval"/);
 assert.match(x.blocks.approvalTypeResults.innerHTML,/data-approval-group="cn_finance"/);
 assert.match(x.blocks.approvalTypeResults.innerHTML,/data-approval-group="do_edit"/);
 assert.match(x.blocks.approvalTypeResults.innerHTML,/data-approval-group="stock_count_edit"/);
 assert.doesNotMatch(x.blocks.approvalTypeResults.innerHTML,/data-approval-group="orders"/);
});
test('every type displays its actual pending count beside the label',async()=>{
 const x=mock();
 await x.context.renderApprovals();
 const chip=key=>{
  const match=x.blocks.approvalTypeFilters.innerHTML.match(new RegExp('data-approval-type="'+key+'"[^>]*>[\\s\\S]*?<\\/button>'));
  assert.ok(match,'Missing chip '+key);
  return match[0];
 };
 for(const key of ['all','cn_approval','cn_finance','daily','do_edit','stock_count_edit']){
  const number=key==='all'?5:1;
  assert.match(chip(key),new RegExp('>'+number+'<\\/span>'));
 }
 for(const key of ['orders','payments','customers','conversions']){
  assert.match(chip(key),/>0<\/span>/);
 }
});
test('Dashboard shortcuts open the same Approvals page with the selected type',async()=>{
 const x=mock();
 x.context.state.page='dashboard';
 await x.context.openApprovalType('cn_finance');
 assert.equal(x.context.state.page,'approvals');
 await x.context.renderApprovals();
 assert.match(x.blocks.approvalTypeResults.innerHTML,/CN-CREDIT/);
 assert.doesNotMatch(x.blocks.approvalTypeResults.innerHTML,/CN-NEW/);
 assert.match(approvals,/onclick="openApprovalType\(\\'cn_approval\\'\)"/);
});
