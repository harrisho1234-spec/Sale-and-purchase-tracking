const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const reportCode=fs.readFileSync(path.join(__dirname,'..','sales-report.js'),'utf8');
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const {normalizeReportEvents,normalizeItemRows}=require('../sales-report-bookings.js');
const n=value=>Number(value||0);
const monthTotal=(rows,date,key)=>rows.filter(row=>row.order_date?.slice(0,7)===date)
  .reduce((sum,row)=>sum+n(row[key]),0);
const event=(type,date,document,extras={})=>({
 order_id:'sr1',customer_id:'c1',sales_rep_id:'u1',sales_rep_name:'Sales A',
 order_date:date,document_no:document,report_event:type,
 business_code:document.startsWith('SR')?'OTHER':'TK',
 order_type:document.startsWith('SR')?'pre_order':'stock_sale',
 invoice_value:0,prepayment_value:0,prepayment_applied:0,
 return_value:0,actual_sales:0,confirmed_sales:0,collection_value:0,
 ...extras
});
test('August SR deposit $300 is COLLECTION only; October issued TK $1,000 is SALES once',()=>{
 const rows=[
  event('payment','2026-08-13','SR-2026-001',
   {prepayment_value:300,actual_sales:300,confirmed_sales:300,collection_value:300}),
  event('issued_invoice','2026-10-20','TK2610-001',
   {invoice_value:1000,prepayment_applied:300,actual_sales:700,confirmed_sales:700}),
  event('order','2026-10-20','TK2610-001',
   {order_id:'tkmirror1',invoice_value:1000,actual_sales:1000,confirmed_sales:1000,collection_value:300})
 ];
 const untouched=JSON.stringify(rows);
 const actual=normalizeReportEvents(rows);
 assert.equal(monthTotal(actual,'2026-08','actual_sales'),0);
 assert.equal(monthTotal(actual,'2026-08','confirmed_sales'),0);
 assert.equal(monthTotal(actual,'2026-08','collection_value'),300);
 assert.equal(monthTotal(actual,'2026-10','actual_sales'),1000);
 assert.equal(monthTotal(actual,'2026-10','confirmed_sales'),1000);
 assert.equal(monthTotal(actual,'2026-10','collection_value'),0);
 assert.equal(monthTotal(actual,'2026-10','invoice_value'),1000);
 assert.equal(actual.length,2,'converted TK mirror is excluded instead of counted twice');
 assert.equal(JSON.stringify(rows),untouched,'raw report input is never mutated');
});
test('SR with no issued TK/RK is never sales, whether paid or unpaid',()=>{
 const input=[event('order','2026-08-15','SR-2026-020',{
  invoice_value:0,prepayment_value:300,pending_value:700,
  actual_sales:300,confirmed_sales:1000,collection_value:300,order_type:'pre_order'
 })];
 const out=normalizeReportEvents(input);
 assert.equal(out[0].actual_sales,0);
 assert.equal(out[0].confirmed_sales,0);
 assert.equal(out[0].collection_value,300);
 assert.equal(out[0].pending_value,700);
});
test('partial conversion counts only quantity/value actually invoiced in each issue month',()=>{
 const rows=[
  event('payment','2026-08-10','SR-1',{collection_value:300,prepayment_value:300,actual_sales:300}),
  event('issued_invoice','2026-10-10','TK2610-100',{invoice_value:400,prepayment_applied:300,actual_sales:100}),
  event('unissued_sr','2026-08-10','SR-1',{pending_value:600,confirmed_sales:600}),
  event('issued_invoice','2026-12-02','TK2612-100',{invoice_value:600,actual_sales:600})
 ];
 const x=normalizeReportEvents(rows);
 assert.equal(monthTotal(x,'2026-08','actual_sales'),0);
 assert.equal(monthTotal(x,'2026-10','actual_sales'),400);
 assert.equal(monthTotal(x,'2026-12','actual_sales'),600);
 assert.equal(monthTotal(x,'2026-08','collection_value'),300);
 assert.equal(x.reduce((sum,r)=>sum+n(r.confirmed_sales),0),1000);
});
test('one TK/RK invoice consolidating multiple SRs is counted once at issuance',()=>{
 const rows=[
  event('payment','2026-08-01','SR-A',{order_id:'srA',collection_value:100,prepayment_value:100}),
  event('payment','2026-09-01','SR-B',{order_id:'srB',collection_value:200,prepayment_value:200}),
  event('issued_invoice','2026-10-15','TK2610-099',{order_id:'srA',invoice_value:400,prepayment_applied:100}),
  event('issued_invoice','2026-10-15','TK2610-099',{order_id:'srB',invoice_value:600,prepayment_applied:200}),
  event('order','2026-10-15','TK2610-099',{order_id:'tk99',invoice_value:1000,collection_value:300})
 ];
 const x=normalizeReportEvents(rows);
 assert.equal(monthTotal(x,'2026-10','actual_sales'),1000);
 assert.equal(monthTotal(x,'2026-10','collection_value'),0);
 assert.equal(monthTotal(x,'2026-08','collection_value'),100);
 assert.equal(monthTotal(x,'2026-09','collection_value'),200);
});
test('TK/RK deposit transfer is excluded, but an additional payment on invoice remains collection',()=>{
 const rows=[
  event('payment','2026-08-01','SR-X',{prepayment_value:300,collection_value:300}),
  event('issued_invoice','2026-10-20','TK2610-200',{invoice_value:1000,prepayment_applied:300}),
  event('order','2026-10-20','TK2610-200',{order_id:'tk-mirror',invoice_value:1000,collection_value:1000})
 ];
 const x=normalizeReportEvents(rows);
 assert.equal(monthTotal(x,'2026-10','actual_sales'),1000);
 assert.equal(monthTotal(x,'2026-10','collection_value'),700);
 assert.ok(x.some(row=>row.report_event==='invoice_additional_payment'));
});
test('regular TK/RK sales with no source SR count on invoice/order date',()=>{
 const input=[event('order','2026-10-20','RK2610-101',{
  order_id:'rk1',invoice_value:750,actual_sales:750,confirmed_sales:750,collection_value:200
 })];
 const out=normalizeReportEvents(input);
 assert.equal(monthTotal(out,'2026-10','actual_sales'),750);
 assert.equal(monthTotal(out,'2026-10','confirmed_sales'),750);
 assert.equal(monthTotal(out,'2026-10','collection_value'),200);
});
test('accepted CN reduces net Actual Sales on return date but does not erase issued invoice history',()=>{
 const rows=[
  event('issued_invoice','2026-10-01','TK2610-111',{invoice_value:1000}),
  event('return','2026-11-02','TK2610-111',{return_value:200,actual_sales:-200})
 ];
 const x=normalizeReportEvents(rows);
 assert.equal(monthTotal(x,'2026-10','actual_sales'),1000);
 assert.equal(monthTotal(x,'2026-11','actual_sales'),-200);
 assert.equal(monthTotal(x,'2026-11','confirmed_sales'),0);
 assert.equal(x.reduce((s,r)=>s+n(r.actual_sales),0),800);
 assert.equal(x.reduce((s,r)=>s+n(r.confirmed_sales),0),1000);
});
test('a different customers matching invoice number is not treated as a conversion mirror',()=>{
 const rows=[
  event('issued_invoice','2026-10-20','TK2610-120',{customer_id:'c1',invoice_value:1000}),
  event('order','2026-10-20','TK2610-120',{order_id:'other',customer_id:'c2',invoice_value:500})
 ];
 assert.equal(normalizeReportEvents(rows).reduce((s,r)=>s+n(r.actual_sales),0),1500);
});
test('product and brand sales exclude SR values and separate TK mirrors',()=>{
 const events=[
  event('payment','2026-08-01','SR-002',{prepayment_value:300,collection_value:300}),
  event('issued_invoice','2026-10-20','TK2610-222',{invoice_value:1000,prepayment_applied:300}),
  event('order','2026-10-20','TK2610-222',{order_id:'tk-1',invoice_value:1000,collection_value:300})
 ];
 const items=[
  {sales_order_id:'sr1',order_date:'2026-08-01',document_no:'SR-002',prepayment_value:300,invoice_value:0,collection_value:300,actual_sales:300,confirmed_sales:1000,qty:2,return_value:0},
  {sales_order_id:'sr1',order_date:'2026-10-20',document_no:'TK2610-222',invoice_value:1000,actual_sales:700,confirmed_sales:700,collection_value:0,qty:2,return_value:0},
  {sales_order_id:'tk-1',order_date:'2026-10-20',document_no:'TK2610-222',invoice_value:1000,actual_sales:1000,confirmed_sales:1000,collection_value:300,qty:2,return_value:0}
 ];
 const result=normalizeItemRows(items,events);
 assert.equal(monthTotal(result,'2026-08','actual_sales'),0);
 assert.equal(monthTotal(result,'2026-10','actual_sales'),1000);
 assert.equal(monthTotal(result,'2026-10','collection_value'),0);
 assert.equal(result.find(x=>x.order_date==='2026-08-01').qty,0);
 assert.equal(result.length,2);
});
test('source report integration uses invoice events without the original-date Booked Sales RPC',()=>{
 assert.ok(index.indexOf('sales-report-bookings.js')>=0);
 assert.ok(index.indexOf('sales-report-bookings.js')<index.indexOf('sales-report.js'));
 assert.match(reportCode,/LImperialInvoiceSales\.normalizeReportEvents/);
 assert.match(reportCode,/LImperialInvoiceSales\.normalizeItemRows/);
 assert.match(reportCode,/db\.rpc\('get_sales_report_rows_v6'\)/);
 assert.doesNotMatch(reportCode,/db\.rpc\('get_sales_report_rows_v5'\)/);
 assert.match(reportCode,/Issued Invoices/);
 assert.doesNotMatch(reportCode,/Booked Sales/);
 assert.match(reportCode,/TK\/RK invoices/);
});
