const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const migration=read('database/20261103_consolidate_legacy_tk_into_issued_sr.sql');
const summary=read('database/20261103_sales_order_summary_canonical_sr_view.sql');
const auditSummary=read('database/20261103_canonical_sr_audit_summary_fields.sql');
const tracking=read('tracking-redesign.js');
const customer=read('customer-sr-financials.js');
const history=read('customer-order-history.js');
const html=read('index.html');

test('reconciliation archives the source TK, not physical delivery or payment evidence',()=>{
 assert.match(migration,/create table if not exists imperial_audit\.sr_tk_consolidations/);
 assert.match(migration,/before_snapshot jsonb not null/);
 assert.match(migration,/TK2610-003/);
 assert.match(migration,/TK2610-004/);
 assert.match(migration,/duplicate_payment_id uuid not null/);
 assert.match(migration,/canonical_sr_payment_id uuid not null/);
 assert.doesNotMatch(migration,/\bdelete\s+from\s+public\.(?:sales_orders|sales_payments|delivery_requests|delivery_request_items|stock_movements)/i);
 assert.doesNotMatch(migration,/\binsert\s+into\s+public\.(?:sales_payments|stock_movements|delivery_requests)/i);
});
test('the same DO and stock OUT IDs are moved to the canonical issued SR invoice',()=>{
 assert.match(migration,/update public\.delivery_requests set sales_order_id=sr\.id,source_invoice_part_id=inv\.id/);
 assert.match(migration,/update public\.delivery_request_items set sales_order_item_id=v_sr_item/);
 assert.match(migration,/update public\.stock_movements sm set\s+reference_id=sr\.id,reference_item_id=v_sr_item/);
 assert.match(migration,/update public\.sales_item_status_quantities st set sales_order_item_id=v_sr_item/);
 assert.match(migration,/update public\.item_tracking it set status='delivered'/);
 assert.match(migration,/update public\.sales_order_items set fulfillment_status='delivered'/);
 assert.match(migration,/ti\.product_id/);
 assert.match(migration,/il\.qty=ti\.qty and il\.line_total=ti\.line_total/);
});
test('mirror receipt remains only audit evidence, and future TK payments or DO are blocked',()=>{
 assert.match(migration,/AUDIT ONLY: copied SR deposit/);
 assert.match(migration,/guard_archived_tk_payment/);
 assert.match(migration,/guard_archived_tk_delivery/);
 assert.match(migration,/imperial_audit\.sr_tk_consolidations/);
 assert.match(migration,/revoke all on schema imperial_audit from public,anon,authenticated/);
});
test('live sales_order_summary has zero financial contribution from the old standalone TK',()=>{
 for(const f of ['order_total','amount_paid','balance_due','gross_balance_due']){
  assert.match(summary,new RegExp("case when a\\.legacy_tk_order_id is not null then 0::numeric else base\\."+f));
 }
 assert.match(summary,/is_consolidated_duplicate/);
 assert.match(summary,/consolidated_sr_id/);
 assert.match(auditSummary,/legacy_original_invoice_total/);
 assert.match(auditSummary,/legacy_original_mirrored_deposit/);
});
test('original issued SR has the entire sale, actual SR deposit and issued AR, never pending',()=>{
 assert.match(customer,/consolidatedSrIds=new Set/);
 assert.match(customer,/canonicalIssued=sr&&consolidatedSrIds\.has/);
 assert.match(customer,/const pending=sr&&noInvoice\(o\)&&!fullyIssued&&!canonicalIssued/);
 assert.match(customer,/if\(fullyIssued\|\|archived\)ratio=0/);
 assert.match(customer,/counted:!fullyIssued&&!archived/);
});
test('Sales Tracking hides archived TK cards while showing SR → issued TK/RK',()=>{
 assert.match(tracking,/if\(o\.is_consolidated_duplicate\)return false/);
 assert.match(tracking,/_consolidatedIssuedTkDocs\.push/);
 assert.match(tracking,/Main SR → issued/);
 assert.match(tracking,/Fully issued SR invoices are AR/);
 assert.match(history,/Archived duplicate · linked to original SR/);
 assert.match(history,/Main SR · TK\/RK issued/);
});
test('browser cache uses updated canonical sources',()=>{
 for(const name of ['customer-sr-financials.js','sales-report-bookings.js'])
  assert.ok(html.includes(name+'?v=20261103-canonical-sr-tk-v1'),name);
 assert.ok(html.includes('tracking-redesign.js?v=20261113-approved-return-credit1'));
 assert.ok(html.includes('invoice-price-breakdown.js?v=20261104-invoice-pricing1'));
 for(const name of ['customer-order-history.js','customer-return-history.js'])
  assert.ok(html.includes(name+'?v=20261103-hide-archived-tk2'),name);
});

test('customer popup excludes archived duplicate TK cards and counts only real orders',async()=>{
 const vm=require('node:vm');
 const popup=read('customer-return-history.js');
 const body={innerHTML:''};
 const summary=[
  {id:'sr11',order_no:'SR-2026-011',sr_no:'SR-2026-011',sales_flow_type:'pre_order',
   order_type:'pre_order',order_date:'2026-09-05',order_total:1614,amount_paid:807,balance_due:807,gross_balance_due:807,
   credit_applied:0,status:'confirmed',customer_id:'c1',is_consolidated_duplicate:false},
  {id:'tk3',order_no:'TK2610-003',sales_flow_type:'stock_sale',
   order_type:'in_stock',order_date:'2026-10-20',order_total:0,amount_paid:0,balance_due:0,gross_balance_due:0,
   credit_applied:0,status:'confirmed',customer_id:'c1',is_consolidated_duplicate:true},
  {id:'sr12',order_no:'SR-2026-012',sr_no:'SR-2026-012',sales_flow_type:'pre_order',
   order_type:'pre_order',order_date:'2026-09-08',order_total:1416,amount_paid:708,balance_due:708,gross_balance_due:708,
   credit_applied:0,status:'confirmed',customer_id:'c1',is_consolidated_duplicate:false},
  {id:'tk4',order_no:'TK2610-004',sales_flow_type:'stock_sale',
   order_type:'in_stock',order_date:'2026-10-20',order_total:0,amount_paid:0,balance_due:0,gross_balance_due:0,
   credit_applied:0,status:'confirmed',customer_id:'c1',is_consolidated_duplicate:true}
 ];
 const sourceReturn={sales_order_id:'tk4',return_id:'cn1',status:'confirmed',
   return_value:20,cn_no:'CN-TEST',item_count:1,action:'return_only',return_date:'2026-10-22'};
 const dbData={
  sales_order_summary:summary,
  sales_orders:[],
  sales_returns:[],
  get_visible_sales_returns:[sourceReturn],
  get_visible_sr_split_invoice_list:[
   {sr_id:'sr11',total_qty:1,issued_qty:1,pending_qty:0,issued_numbers:[{no:'TK2610-003'}]},
   {sr_id:'sr12',total_qty:11,issued_qty:11,pending_qty:0,issued_numbers:[{no:'TK2610-004'}]}
  ]
 };
 const query=items=>({
  select(){return this;},eq(){return this;},order(){return this;},
  then(resolve,reject){return Promise.resolve({data:items,error:null}).then(resolve,reject);}
 });
 const sandbox={
  window:{},
  state:{customers:[{id:'c1',name:'Sample Customer',phone:'012'}]},
  db:{
   from:table=>query(dbData[table]||[]),
   rpc:name=>Promise.resolve({data:dbData[name]||[],error:null})
  },
  document:{getElementById:id=>id==='modalBody'?body:null},
  openModal(){},
  showToast(msg){throw new Error(msg)},
  money:n=>'$'+Number(n||0).toFixed(2),
  esc:value=>String(value??'').replaceAll('<','&lt;').replaceAll('>','&gt;'),
  titleCase:value=>String(value||'')
 };
 vm.runInNewContext(popup,sandbox,{timeout:3000});
 await sandbox.window.openCustomerOrders('c1');
 const markup=body.innerHTML;
 const orderArea=markup.split('Order History</h4>')[1]?.split('Return / Credit Note History</h4>')[0]||'';
 assert.match(orderArea,/SR-2026-011/);
 assert.match(orderArea,/SR-2026-012/);
 assert.doesNotMatch(orderArea,/<b>TK2610-003<\/b>/);
 assert.doesNotMatch(orderArea,/<b>TK2610-004<\/b>/);
 assert.match(markup,/Orders<\/div><div class="text-lg font-bold mt-1">2<\/div>/);
 assert.match(markup,/Gross Sales<\/div><div class="text-lg font-bold mt-1">\$3030\.00<\/div>/);
 assert.match(markup,/Received<\/div><div class="text-lg font-bold text-green-600 mt-1">\$1515\.00<\/div>/);
 assert.match(markup,/CN-TEST/,'historic return/CN remains visible even when its standalone TK is archived');
});
