const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const quote=fs.readFileSync(path.join(__dirname,'..','quotation-imports.js'),'utf8');
function instance(customers=[]){
 const state={profile:{role:'manager'},user:{id:'manager'},products:[],customers};
 const sandbox={state,document:{getElementById:()=>null},location:{hash:''},console,
  money:n=>'$'+Number(n).toFixed(2),
  esc:v=>String(v??'').replace(/[&<>"']/g,x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x])),
  navItems:()=>[],go:async()=>{},closeModal:()=>{},hasAppPermission:()=>true};
 sandbox.window=sandbox;
 const exposed=quote.replace(/\}\)\(\);\s*$/,
  'window.__testQuote={quoteSummary,quotationChangeNotice,quotationBusinessSignature,candidateCustomers,normalizeCustomerPhone,quotationAnalyticsData,liveQuotationComparison,quoteComparisonPanelHtml,linkedQuoteTimeline,quotationRevisionNoticeHtml};})();');
 assert.notEqual(exposed,quote);
 vm.createContext(sandbox);vm.runInContext(exposed,sandbox);
 return sandbox;
}
function quotation(){
 const state={documentType:'quotation',quotationRevision:2,discountPctValue:10,discountFlatValue:5,
  cart:[
   {id:'row-1',quantity:2,discount:50,documentSections:{quotation:'Ground Floor'},item:{code:'CH-1',itemName:'Chandelier',actualSalesPrice:100}},
   {id:'row-2',quantity:1,discount:40,documentSections:{quotation:'Second Floor'},item:{code:'CH-1',itemName:'Chandelier',actualSalesPrice:100}}
  ],
  documentFormStates:{quotation:{initialized:true,
   fields:{'quote-no-input':{value:'S-2026-001'},'quote-customer-input':{value:'Customer A'},'quote-tel-input':{value:'+855 12 345 678'}},
   itemNotes:{'row-1':'Ceiling 3.5m','row-2':'Dimmer required'}}}
 };
 return {state,record:{source_record_id:'saved-1',source_quote_no:'S-2026-001',
  customer_name:'Customer A',customer_phone:'+855 12 345 678',source_payload:state}};
}
test('saved quote stays locked until staff explicitly updates changed Showroom revision',()=>{
 const {__testQuote:q}=instance(),{state,record}=quotation();
 const latest={state};
 assert.equal(q.quotationChangeNotice(record,latest).changed,false);
 const changed=JSON.parse(JSON.stringify(state));changed.cart[1].discount=60;changed.quotationRevision=3;
 const diff=q.quotationChangeNotice(record,{state:changed});
 assert.equal(diff.changed,true);assert.equal(diff.oldRev,2);assert.equal(diff.newerRev,3);
 const html=q.quotationRevisionNoticeHtml({id:'quote-1',status:'ready'},diff);
 assert.match(html,/Update to Latest Revision/);
 assert.match(quote,/await verifyQuotationSnapshot\(draft\)/);
 assert.match(quote,/await checkQuotedSourceBeforeSave\(activeConversionSnapshot\)/);
 assert.doesNotMatch(quote,/try\{draft=await importSavedRecord\(draft\.source_record_id\)/);
});
test('customer suggestions match Cambodian phone formats, but do not assign CRM ownership',()=>{
 const c=instance([
  {id:'existing-1',name:'Customer A',phone:'012 345 678',assigned_sales_id:'sales-1'},
  {id:'existing-2',name:'Customer A',phone:'099000111',assigned_sales_id:'sales-2'}
 ]);
 const q=c.__testQuote;const s=q.quoteSummary(quotation().record);
 const matches=q.candidateCustomers(s);
 assert.equal(matches[0].customer.id,'existing-1');
 assert.equal(matches[0].score,2);
 assert.equal(q.normalizeCustomerPhone('00855 12 345 678'),'012345678');
 assert.match(quote,/Click Link Official Customer to confirm/);
 assert.match(quote,/Sales ownership is unchanged/);
});
test('quote versus proposed order shows all item and order discount changes, without mixing duplicate product codes',()=>{
 const q=instance().__testQuote,s=q.quoteSummary(quotation().record);
 const rows=s.lines.map(l=>{
  const values={'.product-code':l.code,'.product-name':l.name,'.qty':l.qty,'.unit-price':l.unitPrice,'.line-discount':l.discountAmount,'.source-quote-item-note':l.note,'.line-kind':l.kind};
  return {dataset:{sourceQuoteKey:l.key},values,querySelector(key){return this.values[key]===undefined?null:{value:this.values[key]}}};
 });
 const form={
  querySelectorAll:selector=>selector==='#orderItems .order-item-row'?rows:[],
  querySelector:selector=>selector==='#orderDiscount'?{value:s.orderDiscount}:null
 };
 const same=q.liveQuotationComparison(s,form);assert.equal(same.changed,false);
 rows[1].values['.line-discount']=50;
 const changed=q.liveQuotationComparison(s,form);
 assert.equal(changed.changed,true);
 assert.equal(changed.changes.filter(x=>x.diff.length).length,1);
 assert.match(q.quoteComparisonPanelHtml(s,changed),/quoteDifferencesAcknowledged/);
 assert.match(quote,/event\.stopImmediatePropagation\(\)/);
 assert.match(quote,/await normalSave\.call\(form,event\)/);
});
test('SR, TK and RK conversion delegates to existing Sales Order workflow',()=>{
 assert.match(quote,/\['SR','TK','RK'\]\.includes\(chosenDocument\)/);
 assert.match(quote,/flow\.value=chosenDocument==='SR'\?'pre_order':'stock_sale'/);
 assert.match(quote,/invoice\.value=chosenDocument/);
 assert.match(quote,/await normalSave\.call\(form,event\)/);
 assert.match(quote,/form\.addEventListener\('submit',async event/);
});
test('quotation analytics count each saved quotation once and exclude unregistered imported records',()=>{
 const q=instance().__testQuote,state=quotation().state;
 const reg=[
  {id:'r1',source_record_id:'source-1',issue_date:'2026-02-01',salesperson:'Sale A',amount:150,source_payload:state},
  {id:'r2',source_record_id:'source-2',issue_date:'2026-02-02',salesperson:'Sale A',amount:200,source_payload:state},
  {id:'r3',source_record_id:'source-3',issue_date:'2025-02-01',salesperson:'Sale B',amount:300,source_payload:state}
 ];
 const imported=[{source_record_id:'source-1',status:'converted',converted_sales_order_id:'order-1'},
  {source_record_id:'source-2',status:'ready'},
  {source_record_id:'unregistered',status:'converted',converted_sales_order_id:'other-order'}];
 const stats=q.quotationAnalyticsData(reg,imported,'2026','all');
 assert.equal(stats.totals.saved,2);assert.equal(stats.totals.imported,2);
 assert.equal(stats.totals.converted,1);assert.equal(stats.totals.unconverted,1);
 assert.equal(stats.totals.quoteValue,350);
 assert.equal(stats.repStats[0].salesperson,'Sale A');
 assert.equal(q.quotationAnalyticsData(reg,imported,'2025','all').totals.saved,1);
 assert.match(quote,/Quoted value, not revenue/);
});
test('converted quote history retains linked order and source revision with access check',()=>{
 const q=instance().__testQuote,{state}=quotation();
 const html=q.linkedQuoteTimeline({status:'converted',source_payload:state,
  source_saved_at:'2026-11-01T02:00:00Z',imported_at:'2026-11-02T02:00:00Z',converted_at:'2026-11-03T02:00:00Z'},
 {id:'order-1',order_no:'SR26011-01',sales_rep_name_snapshot:'Sale A'});
 assert.match(html,/Rev 2/);assert.match(html,/SR26011-01/);
 assert.match(html,/Open Linked Sales Order/);
 assert.match(quote,/db\.from\('sales_orders'\)\.select\('id'\)\.eq\('id',id\)\.maybeSingle\(\)/);
 assert.match(quote,/Converted quotations have locked customer links/);
});
