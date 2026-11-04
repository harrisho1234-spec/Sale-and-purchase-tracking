const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=file=>fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const calc=require('../invoice-price-breakdown.js');
const html=read('index.html');
const tracking=read('tracking-redesign.js');
const sr=read('sr-multiple-invoices.js');
const money=v=>'$'+Number(v||0).toFixed(2);

test('line discount applies to full quantity, not each individual unit',()=>{
 const p=calc.line({qty:2,unit_price:990,discount_amount:792,line_total:1188});
 assert.deepEqual({full:p.fullTotal,discount:p.discount,pct:p.discountPercent,net:p.finalTotal,unitNet:p.finalUnit},
 {full:1980,discount:792,pct:40,net:1188,unitNet:594});
 assert.equal(calc.percent(p.discountPercent),'40%');
});
test('the screenshot case of 3 × $290 discounted to $522 is 40%',()=>{
 const p=calc.line({qty:3,unit_price:290,discount_amount:348,line_total:522});
 assert.equal(p.fullTotal,870);
 assert.equal(p.discountPercent,40);
 assert.equal(p.finalUnit,174);
 assert.equal(p.finalTotal,522);
});
test('invoice-level discount is separate from item discounts and recorded total',()=>{
 const p=calc.invoice([
  {qty:2,unit_price:990,discount_amount:792,line_total:1188},
  {qty:1,unit_price:500,discount_amount:50,line_total:450}
 ],75,1563);
 assert.equal(p.original,2480);
 assert.equal(p.itemsDiscount,842);
 assert.equal(p.afterItems,1638);
 assert.equal(p.orderDiscount,75);
 assert.equal(p.finalTotal,1563);
 assert.equal(p.adjustment,0);
});
test('zero, full and fractional percentages and unknown original prices',()=>{
 assert.equal(calc.line({qty:1,unit_price:100,discount_amount:0,line_total:100}).discountPercent,0);
 assert.equal(calc.line({qty:2,unit_price:100,discount_amount:200,line_total:0}).discountPercent,100);
 assert.equal(calc.percent(calc.line({qty:3,unit_price:100,discount_amount:100,line_total:200}).discountPercent),'33.33%');
 const missing=calc.line({qty:2,line_total:100});
 assert.equal(missing.fullTotal,null);
 assert.equal(missing.discount,null);
 assert.equal(missing.finalUnit,50);
 assert.equal(calc.invoice([{qty:2,line_total:100}],0,100).complete,false);
});
test('source net line and recorded invoice total remain authoritative',()=>{
 const p=calc.line({qty:3,unit_price:123.456,discount_amount:12.34,line_total:358.03});
 assert.equal(p.fullTotal,370.37);
 assert.equal(p.finalTotal,358.03);
 const invoice=calc.invoice([{qty:3,unit_price:123.456,discount_amount:12.34,line_total:358.03}],5,353.01);
 assert.equal(invoice.finalTotal,353.01);
 assert.equal(invoice.adjustment,-0.02);
});
test('Sales Tracking shows original, percentage and after-discount price per item',()=>{
 const start=tracking.indexOf('  function salesInvoiceItemPrice(i,currency){');
 const end=tracking.indexOf('  function invoiceCard(o) {',start);
 assert.ok(start>0&&end>start);
 const sandbox={window:{InvoicePriceBreakdown:calc},money,Number,Math};
 vm.runInNewContext(tracking.slice(start,end)+'\nthis.previewLine=salesInvoiceItemPrice;this.previewTotal=salesInvoicePriceSummary;',sandbox,{timeout:2000});
 const line=sandbox.previewLine({qty:3,unit_price:290,discount_amount:348,line_total:522},'USD');
 for(const phrase of ['Original unit:','$290.00','Full line: 3 × $290.00 = $870.00',
  'Item discount: −$348.00 (40%)','Unit after discount:','$174.00','After item discount: $522.00'])
  assert.ok(line.includes(phrase),phrase);
 const summary=sandbox.previewTotal({currency:'USD',order_discount:15,order_total:507,
  items:[{qty:3,unit_price:290,discount_amount:348,line_total:522}]});
 for(const phrase of ['Price &amp; Discount Breakdown','Full price before discounts','$870.00',
   'Item discounts','−$348.00','Additional invoice discount','−$15.00','Final recorded total','$507.00'])
  assert.ok(summary.includes(phrase),phrase);
});
test('linked SR-issued TK/RK invoice uses the same discount breakdown',()=>{
 const start=sr.indexOf(' const knownNumber=v=>');
 const end=sr.indexOf(' // Prominent DO shortcut for an SR',start);
 assert.ok(start>0&&end>start);
 const sandbox={window:{InvoicePriceBreakdown:calc},state:{profile:{role:'sales'}},moneyN:money,
  h:x=>String(x??''),safeCount:x=>Number(x||0)};
 vm.runInNewContext(sr.slice(start,end)+'\nthis.renderInvoiceList=htmlInvoices;',sandbox,{timeout:2000});
 const output=sandbox.renderInvoiceList({sr_id:'sr1',invoices:[{
  id:'inv1',invoice_no:'TK2610-004',status:'issued',total:507,order_discount:15,
  lines:[{qty:3,code:'ZX-LAMP',name:'Ceiling Lamp',unit_price:290,discount_amount:348,line_total:522}]
 }]});
 for(const phrase of ['TK2610-004','Original unit: $290.00','Full line: $870.00',
  'Item discount: −$348.00 (40%)','Unit after discount: $174.00',
  'After item discount: $522.00','Full price before discount',
  'Additional invoice discount','−$15.00','Final invoice total'])
  assert.ok(output.includes(phrase),phrase);
});
test('shared pricing code loads before both invoice renderers',()=>{
 assert.ok(html.includes('invoice-price-breakdown.js?v=20261104-invoice-pricing1'));
 assert.ok(html.indexOf('invoice-price-breakdown.js')<html.indexOf('tracking-redesign.js'));
 assert.ok(html.indexOf('invoice-price-breakdown.js')<html.indexOf('sr-multiple-invoices.js'));
 assert.match(html,/tracking-redesign\.js\?v=20261104-invoice-pricing1/);
 assert.match(html,/sr-multiple-invoices\.js\?v=20261104-invoice-pricing1/);
});
