const {test}=require('node:test');
const assert=require('node:assert/strict');
const f=require('../customer-sr-financials.js');
function order(id,order_no,total,paid,details={}){
 return {id,order_no,invoice_no:order_no,order_total:total,amount_paid:paid,balance_due:total-paid,
   gross_balance_due:total-paid,payment_status:paid>=total?'paid':paid?'partially_paid':'unpaid',
   order_type:'in_stock',sales_flow_type:'stock_sale',status:'confirmed',...details};
}
function sr(id,no,total,paid) {
 return order(id,no,total,paid,{sr_no:no,invoice_no:null,sales_invoice_no:null,order_type:'pre_order',sales_flow_type:'pre_order'});
}
function invoice(id,no,total,paid) {
 return order(id,no,total,paid,{sales_invoice_no:no});
}
const issued=(id,no,qty)=>({sr_id:id,issued_count:1,issued_qty:qty,total_qty:qty,pending_qty:0,issued_numbers:[{no,total:0}]});
test('B Srey Kinh fully issued SRs are history only; financial and AR totals are correct',()=>{
 const source=[
   invoice('tk12','TK2610-012',216,0),
   invoice('tk10','TK2610-010',4138,2069),
   invoice('tk3','TK2610-003',1614,807),
   invoice('tk4','TK2610-004',1416,708),
   sr('sr11','SR-2026-011',1614,807),
   sr('sr12','SR-2026-012',1416,708),
   invoice('tk5','TK2609-005',924,522),
   invoice('tk2','TK2609-002',15342,7671)
 ];
 const before=JSON.stringify(source);
 const out=f.reconcile(source,[issued('sr11','TK2610-003',1),issued('sr12','TK2610-004',11)]);
 assert.deepEqual(out.summary,{sales:23650,paid:11777,ar:11873,pending:0,grossAR:11873,pendingGross:0,orders:6,converted:2,unreconciled:0});
 assert.equal(out.rows.length,8,'all original SR records must remain visible');
 assert.equal(out.rows.find(x=>x.id==='sr11')._srFinancial.historyOnly,true);
 assert.equal(out.rows.find(x=>x.id==='sr12')._srFinancial.historyOnly,true);
 assert.equal(JSON.stringify(source),before,'do not mutate original financial data');
});
test('unconverted SR remains pending while TK invoice stays AR',()=>{
 const out=f.reconcile([sr('s1','SR-2026-020',500,100),invoice('t1','TK2611-001',1200,800)],[]);
 assert.equal(out.summary.sales,1700);
 assert.equal(out.summary.paid,900);
 assert.equal(out.summary.ar,400);
 assert.equal(out.summary.pending,400);
 assert.equal(out.summary.orders,2);
});
test('issued marker without a corresponding customer-visible TK must not hide a real balance',()=>{
 const out=f.reconcile([sr('s1','SR-2026-022',2000,1000)],[issued('s1','TK2610-099',2)]);
 assert.equal(out.summary.sales,2000);
 assert.equal(out.summary.paid,1000);
 assert.equal(out.summary.pending,1000);
});
test('partially converted SR excludes issued source item value and its proportional deposit',()=>{
 const source=sr('sr1','SR-2026-030',1300,260);
 const tk=invoice('tk1','TK2611-030',100,20);
 const link={sr_id:'sr1',issued_count:1,total_qty:5,issued_qty:1,pending_qty:0,issued_numbers:[{no:'TK2611-030'}]};
 const details={sr1:{items:[{qty:1,line_total:100,issued_qty:1},{qty:4,line_total:1200,issued_qty:0}]}};
 const x=f.reconcile([source,tk],[link],details);
 assert.equal(x.summary.sales,1300);
 assert.equal(x.summary.paid,260);
 assert.equal(x.summary.ar,80);
 assert.equal(x.summary.pending,960);
 assert.equal(x.summary.orders,2);
 assert.equal(x.rows[0]._srFinancial.historyOnly,false);
 assert.equal(x.rows[0]._srFinancial.partial,true);
});
test('one consolidated TK for multiple fully issued SRs counts once',()=>{
 const src=[sr('s1','SR-1',200,50),sr('s2','SR-2',300,75),invoice('t1','TK2611-100',500,125)];
 const x=f.reconcile(src,[issued('s1','TK2611-100',1),issued('s2','TK2611-100',2)]);
 assert.equal(x.summary.sales,500);
 assert.equal(x.summary.paid,125);
 assert.equal(x.summary.ar,375);
 assert.equal(x.summary.pending,0);
 assert.equal(x.summary.orders,1);
 assert.equal(x.summary.converted,2);
});
test('cancelled orders and fully settled historical SR balances are never re-added',()=>{
 const x=f.reconcile([
  sr('s1','SR-1',100,100),
  invoice('t1','TK2611-101',100,100),
  order('c1','TK-cancelled',70,0,{status:'cancelled'})
 ],[issued('s1','TK2611-101',1)]);
 assert.equal(x.summary.sales,100);
 assert.equal(x.summary.paid,100);
 assert.equal(x.summary.ar,0);
 assert.equal(x.summary.orders,1);
});

test('customer and tracking summaries use the same source-of-truth reconciler',()=>{
 const fs=require('node:fs'),path=require('node:path');
 const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
 const html=read('index.html');
 assert.ok(html.indexOf('customer-sr-financials.js')>=0);
 assert.ok(html.indexOf('customer-sr-financials.js')<html.indexOf('app.js'));
 for(const name of [
  'customer-edit.js','customer-order-history.js','customer-credit-summary.js',
  'app.js','tracking-redesign.js'
 ]){
  assert.match(read(name),/CustomerSrFinancials\.load\(/,name+' should load reconciled financial rows');
 }
 assert.match(read('sales-tracking-legacy-balance-logic.js'),/function financial\(o,k,raw\)/);
 assert.match(read('customer-order-history.js'),/Converted · History Only/);
});
