'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {JSDOM}=require('jsdom');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const rules=require('../sales-tracking-display-rules.js');
const tracking=read('tracking-redesign.js');
const legacy=read('sales-tracking-legacy-balance-logic.js');
const flow=read('document-flow.js');
const flex=read('sales-item-flex-status.js');
const statusManager=read('item-status.js');
const html=read('index.html');
const fmt=n=>'$'+Number(n||0).toFixed(2);
const item=(code,line_kind,tracking,fulfillment='ordered',qty=1,amount=100)=>({
 id:code,product_code_snapshot:code,item_name_snapshot:code,
 line_kind,qty,unit_price:amount,discount_amount:0,line_total:amount*qty,
 fulfillment_status:fulfillment,item_tracking:tracking?{status:tracking}:null
});
const shell=item('DAL006/1BG','product','ready','ordered',2,3080);
const italy=item('DAL003/1BG','product','ready','ordered',1,5440);
const fee=item('DELIVERY-INSTALLATION','service','ordered','ordered',1,1700);
const invoice={
 id:'sr1',order_no:'SR-2026-010',sr_no:'SR-2026-010',customer_name:'B. Srey Sokhim',
 order_type:'pre_order',order_total:13300,amount_paid:6650,balance_due:6650,
 payment_status:'partially_paid',status:'confirmed',items:[shell,italy,fee],
 linked_documents:[{invoice_no:'RK2611-008',invoice_total:11600,status:'issued'}],
 _srFinancial:{pending:true,total:13300,received:6650,balance:6650}
};

test('confirmed stock arrivals display Arrived, never Ready or Ordered; delivery stays separate',()=>{
 assert.equal(rules.itemStatus(shell),'arrived');
 assert.equal(rules.itemStatus(italy),'arrived');
 assert.equal(rules.itemStatus(fee),null);
 assert.equal(rules.isServiceLine(fee),true);
 assert.equal(rules.itemStatus(item('DAL003/1BG','product','delivered','ordered')),'delivered');
 assert.equal(rules.itemStatus(item('DAL003/1BG','product','shipping','ordered')),'shipping');
 assert.equal(rules.isServiceLine({product_code_snapshot:'SERVICE FEE',line_kind:'service'}),true);
 assert.equal(rules.isServiceLine({line_kind:'product',item_name_snapshot:'Service-style lamp'}),false);
});

test('partial RK display retains original deposit and distinguishes issued vs uninvoiced value',()=>{
 assert.equal(rules.hasIssuedTkRk(invoice),true);
 assert.deepEqual(rules.issuedValueSplit(invoice),{issuedValue:11600,uninvoicedValue:1700});
 assert.equal(invoice.amount_paid,6650);
 assert.equal(invoice.balance_due,6650);
 assert.equal(rules.hasIssuedTkRk({...invoice,linked_documents:[],sales_invoice_no:null}),false);
});

test('Sales Tracking invoice detail renders two Arrived status badges and no fee status badge',()=>{
 const start=tracking.indexOf('  function invoiceCard(o) {');
 const end=tracking.indexOf('  function salesItemCard(i)',start);
 assert.ok(start>0&&end>start);
 const sandbox={
  ui:{salesExpanded:new Set(['sr1'])},state:{profile:{role:'sales'}},
  esc:x=>String(x??''),titleCase:x=>x?String(x).replace(/^./,x=>x.toUpperCase()):'',
  money:fmt,formatDate:x=>String(x||''),cleanStatus:x=>String(x||'').toLowerCase(),
  srTkRkLabel:()=> 'SR-2026-010 → RK2611-008',
  salesStatusBadge:()=>'',invoiceItemSummary:()=> '3 items',
  imageHtml:()=>'',returnInfo:()=>null,returnBadge:()=>'',repName:()=> 'Hout Pichbopha',
  salesInvoiceItemPrice:i=>'<div class="price">'+fmt(i.line_total)+'</div>',
  salesInvoicePriceSummary:()=>'',salesInvoiceReturnBalanceSummary:()=>'',hasOfficialDoInvoice:()=>false,
  isSuper:()=>false,isServiceLine:rules.isServiceLine,physicalStatus:rules.itemStatus
 };
 vm.runInNewContext(tracking.slice(start,end)+'\nthis.render=invoiceCard;',sandbox,{timeout:2000});
 const out=sandbox.render(invoice);
 assert.equal((out.match(/lr-fulfillment-badge/g)||[]).length,2,'only physical goods have status badges');
 assert.equal((out.match(/>Arrived<\/span>/g)||[]).length,2);
 assert.ok(out.includes('DELIVERY-INSTALLATION'),'fee still appears on invoice');
 assert.ok(out.includes('$1700.00'),'fee amount remains in pricing');
 assert.ok(!out.includes('>Ordered</span>'),'fee must not show an Ordered badge');
 assert.ok(!out.includes('>Ready</span>'),'Ready must be displayed as Arrived');
});

test('partial RK card uses Amount Received / Active Balance even if legacy pending flag is true',()=>{
 const dom=new JSDOM('<div id="salesTrackingRoot"><div class="lr-order-card"><div class="lr-order-main">'+
  '<div><button onclick="toggleSalesInvoice('+"'sr1'"+')"></button></div>'+
  '<div><div><div class="lr-money-label">Pre-Order Deposit</div><div class="lr-money"></div></div>'+
  '<div><div class="lr-money-label">Est. Balance</div><div class="lr-money"></div></div></div>'+
  '</div></div></div>');
 const start=legacy.indexOf('  function patchCards(rows){');
 const end=legacy.indexOf('\n  window.renderSalesTrackingBody=',start);
 assert.ok(start>0&&end>start);
 const sandbox={
  document:dom.window.document,
  hasIssuedTkRk:rules.hasIssuedTkRk,
  rules,isPendingPre:o=>!!o._srFinancial?.pending,
  isSettled:()=>false,n:x=>Number(x||0),money:fmt,
  financial:(o,k,raw)=>o._srFinancial?o._srFinancial[k]:o[raw]
 };
 vm.runInNewContext(legacy.slice(start,end)+'\nthis.patch=patchCards;',sandbox,{timeout:2000});
 sandbox.patch([invoice]);
 const root=dom.window.document;
 assert.equal(root.querySelector('.lr-order-main .lr-money-label').textContent,'Amount Received');
 const blocks=root.querySelectorAll('.lr-order-main .lr-money');
 assert.equal(blocks[0].textContent,'$6650.00');
 assert.equal(blocks[1].textContent,'$6650.00');
 assert.equal(root.querySelectorAll('.lr-order-main .lr-money-label')[1].textContent,'Active Balance');
 const split=root.querySelector('[data-sr-invoice-split]');
 assert.match(split.textContent,/Issued TK\/RK value \$11600\.00/);
 assert.match(split.textContent,/Not yet invoiced \$1700\.00/);
 assert.match(split.textContent,/Balance shown is for the entire SR/);
 assert.equal(invoice._srFinancial.pending,true,'no accounting classification or cash mutation');
 dom.window.close();
});

test('service fee is excluded from all Sales Tracking status editors and arrival progress',()=>{
 assert.match(tracking,/item_tracking\(status,estimated_arrival,actual_arrival,delivered_at\)/);
 assert.match(tracking,/line_kind,fulfillment_status/);
 assert.match(tracking,/!isServiceLine\(i\)\?/);
 assert.match(flex,/filter\(i=>!isServiceLine\(i\)\)/);
 assert.match(statusManager,/filter\(i=>!isServiceLine\(i\)\)/);
 assert.match(flow,/function physicalItems\(o\)/);
 assert.match(flow,/const items=physicalItems\(o\);if\(!items.length\)return false/);
 assert.match(flow,/!isServiceLine\(i\)\?/);
 assert.match(tracking,/invoiceAdminItemEditor/);
});

test('service fee and arrival presentation uses fresh assets before tracking render',()=>{
 const helper=html.indexOf('sales-tracking-display-rules.js?v=20261113-arrival-and-service-fees1');
 const trackingAt=html.indexOf('tracking-redesign.js?v=20261113-arrival-and-service-fees1');
 const flowAt=html.indexOf('document-flow.js?v=20261113-arrival-and-service-fees1');
 const flexAt=html.indexOf('sales-item-flex-status.js?v=20261113-arrival-and-service-fees1');
 const labelsAt=html.indexOf('sales-tracking-legacy-balance-logic.js?v=20261113-arrival-and-service-fees1');
 assert.ok(helper>=0&&helper<trackingAt&&trackingAt<flowAt&&flowAt<flexAt&&flexAt<labelsAt);
});
