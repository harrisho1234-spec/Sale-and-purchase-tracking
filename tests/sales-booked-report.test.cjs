const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const booking=require('../sales-report-bookings.js');
const report=fs.readFileSync(path.join(__dirname,'..','sales-report.js'),'utf8');
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');

const baseOrder=(id,date,doc,total,extras={})=>({
 order_id:id,order_date:date,customer_id:'customer-1',
 document_no:doc,sales_rep_id:'rep-1',sales_rep_name:'Sales Person',
 business_code:doc.startsWith('SR')?'OTHER':'TK',
 sales_category:'standard',order_type:doc.startsWith('SR')?'pre_order':'stock_sale',
 gross_sales:total,...extras
});
const event=(id,date,doc,type,actual,collection,extras={})=>({
 order_id:id,order_date:date,customer_id:'customer-1',document_no:doc,
 business_code:doc.startsWith('SR')?'OTHER':'TK',
 sales_rep_id:'rep-1',sales_rep_name:'Sales Person',sales_category:'standard',
 report_event:type,actual_sales:actual,collection_value:collection,confirmed_sales:111,
 invoice_value:0,prepayment_value:0,return_value:0,pending_value:0,prepayment_applied:0,...extras
});
const byMonth=(events,month,key)=>events.filter(x=>x.order_date.slice(0,7)===month).reduce((sum,x)=>sum+Number(x[key]||0),0);

test('August SR $1,000 with $300 deposit and October invoice: one August booking, none in October',()=>{
 const orders=[
  baseOrder('sr-1','2026-08-15','SR-2026-110',1000),
  baseOrder('tk-mirror','2026-10-15','TK2610-110',1000)
 ];
 const events=[
  event('sr-1','2026-08-15','SR-2026-110','payment',300,300),
  event('sr-1','2026-10-15','TK2610-110','issued_invoice',700,0),
  event('tk-mirror','2026-10-15','TK2610-110','order',1000,300)
 ];
 const input=JSON.stringify({orders,events});
 const bookings=booking.build(orders,events);
 assert.deepEqual(bookings.map(x=>[x.order_id,x.order_date,x.booked_sales]),[['sr-1','2026-08-15',1000]]);
 const merged=booking.mergeEventRows(events,orders);
 assert.equal(byMonth(merged,'2026-08','confirmed_sales'),1000);
 assert.equal(byMonth(merged,'2026-10','confirmed_sales'),0);
 assert.equal(byMonth(merged,'2026-08','actual_sales'),300);
 assert.equal(byMonth(merged,'2026-10','actual_sales'),1700,'existing Actual Sales events are not rewritten by this change');
 assert.equal(byMonth(merged,'2026-08','collection_value'),300);
 assert.equal(byMonth(merged,'2026-10','collection_value'),300,'existing Collection event amounts remain untouched');
 assert.equal(JSON.stringify({orders,events}),input,'input rows must not be mutated');
});
test('direct TK invoice without SR is booked in its own month',()=>{
 const orders=[baseOrder('tk-1','2026-10-20','TK2610-900',750)];
 const ev=[event('tk-1','2026-10-20','TK2610-900','order',750,100)];
 const out=booking.mergeEventRows(ev,orders);
 assert.equal(byMonth(out,'2026-10','confirmed_sales'),750);
 assert.equal(byMonth(out,'2026-10','actual_sales'),750);
 assert.equal(byMonth(out,'2026-10','collection_value'),100);
});
test('partial SR conversions leave original booking in August (do not rebook October portion)',()=>{
 const orders=[
  baseOrder('sr-1','2026-08-10','SR-2026-120',1000),
  baseOrder('tk-1','2026-10-10','TK2610-120',400)
 ];
 const ev=[event('sr-1','2026-10-10','TK2610-120','issued_invoice',280,0)];
 const out=booking.build(orders,ev);
 assert.equal(out.length,1);
 assert.equal(out[0].booked_sales,1000);
 assert.equal(out[0].order_date,'2026-08-10');
});
test('two source SRs consolidated into one TK count original commitments once',()=>{
 const orders=[
  baseOrder('sr-1','2026-08-08','SR-2026-020',350),
  baseOrder('sr-2','2026-09-12','SR-2026-021',650),
  baseOrder('tk-1','2026-10-15','TK2610-020',1000)
 ];
 const events=[
  event('sr-1','2026-10-15','TK2610-020','issued_invoice',300,0),
  event('sr-2','2026-10-15','TK2610-020','issued_invoice',500,0)
 ];
 const out=booking.build(orders,events);
 assert.deepEqual(out.map(x=>[x.order_id,x.booked_sales]),[['sr-1',350],['sr-2',650]]);
 assert.equal(out.reduce((s,x)=>s+x.booked_sales,0),1000);
});
test('identical invoice number for another customer does not suppress that customer booking',()=>{
 const orders=[
  baseOrder('sr-1','2026-08-01','SR-2026-1',600),
  baseOrder('tk-1','2026-10-01','TK2610-020',600,{customer_id:'customer-2'})
 ];
 const events=[event('sr-1','2026-10-01','TK2610-020','issued_invoice',600,0)];
 assert.equal(booking.build(orders,events).length,2);
});
test('pre-order with no deposit is still booked on SR date',()=>{
 const orders=[baseOrder('sr-1','2026-08-01','SR-2026-1',600)];
 assert.deepEqual(booking.build(orders,[]).map(x=>[x.order_date,x.booked_sales]),[['2026-08-01',600]]);
});
test('report integrates bookings while keeping actual and collection source functions unchanged',()=>{
 assert.ok(index.indexOf('sales-report-bookings.js')>=0);
 assert.ok(index.indexOf('sales-report-bookings.js')<index.indexOf('sales-report.js'));
 assert.match(report,/db\.rpc\('get_sales_report_rows_v6'\)/);
 assert.match(report,/db\.rpc\('get_sales_report_rows_v5'\)/);
 assert.match(report,/LImperialBookedSales\.mergeEventRows\(/);
 assert.match(report,/r\.report_event==='booked_order'\?0:1/);
 assert.match(report,/Booked Sales/);
 assert.match(report,/reportState\.bookingsError/);
 assert.match(report,/get_sales_report_item_rows_v6/);
});
