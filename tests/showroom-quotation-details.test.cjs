const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const source=read('quotation-imports.js');
function fixture(){
 const item={id:'catalog-1',code:'CH-01',itemName:'Chandelier',actualSalesPrice:100};
 const state={cart:[
  {id:'cart-a',item,quantity:2,discount:50,documentSections:{quotation:'Ground Floor'}},
  {id:'cart-b',item,quantity:1,discount:40,documentSections:{quotation:'Second Floor'}},
  {id:'cart-set',type:'set',setName:'Pendant Set',quantity:1,discount:20,
   items:[{item:{id:'LED-1',code:'LED-01',itemName:'LED Lamp',actualSalesPrice:50},quantity:1}]}
 ],documentType:'quotation',discountPctValue:10,discountFlatValue:5,
 documentFormStates:{quotation:{initialized:true,itemNotes:{
  'cart-a':'Gold finish <special>','cart-b':'Install dimmer','cart-set':'Set installation'
 }}}};
 const row={id:'row',source_record_id:'source-1',source_quote_no:'S-2026-001',
  quote_no:'S-2026-001',source_payload:state,status:'converted',
  customer_name:'Customer A',salesperson:'Sales A',current_revision:1};
 const rev={revision_no:0,source_payload:state,customer_name:'Customer A'};
 return {state,row,rev};
}
function sandbox({state:sourceState,row,rev}){
 const views=[];
 const c={
  state:{user:{id:'manager'},profile:{role:'manager'},products:[],customers:[]},
  location:{hash:''},document:{getElementById:()=>null},console,
  money:v=>'$'+Number(v).toFixed(2),
  esc:s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch])),
  openModal:(title,html)=>views.push({title,html}),closeModal:()=>{},
  showToast:message=>{throw Error('Unexpected toast: '+message)},
  navItems:()=>[],go:async()=>{},hasAppPermission:()=>true,
  db:{from:table=>({
   select(){return this},eq(){return this},
   async single(){return{data:table==='showroom_quotation_revisions'?rev:row,error:null}}
  })}
 };
 c.window=c;
 const expose=source.replace(/\}\)\(\);\s*$/, 
  'window.__testQuote={buildQuoteLines,quoteSummary,quotationSnapshotLines,quoteDiscountSummaryHtml,sourceItemNoteForOrder,quoteListDetailsHtml};})();');
 assert.notEqual(expose,source);
 vm.createContext(c);
 vm.runInContext(expose,c);
 return {q:c.__testQuote,window:c,views};
}
test('two identical catalog codes retain distinct discounts, notes and floor/room sections',()=>{
 const {state,row,rev}=fixture(),{q}=sandbox({state,row,rev});
 const s=q.quoteSummary(row);
 assert.equal(s.lines.length,3);
 assert.deepEqual(Array.from(s.lines.map(l=>l.discountPct)),[50,40,20]);
 assert.deepEqual(Array.from(s.lines.map(l=>l.note)),['Gold finish <special>','Install dimmer','Set installation']);
 assert.deepEqual(Array.from(s.lines.map(l=>l.section)),['Ground Floor','Second Floor','']);
 assert.equal(s.gross,350);
 assert.equal(s.lineDiscounts,150);
 assert.equal(s.lineNet,200);
 assert.equal(s.orderDiscount,25);
 assert.equal(s.total,175);
 const html=q.quotationSnapshotLines(s);
 assert.match(html,/Item discount:<\/b> 50%/);
 assert.match(html,/Item discount:<\/b> 40%/);
 assert.match(html,/Ground Floor/);
 assert.match(html,/Second Floor/);
 assert.match(html,/Gold finish &lt;special&gt;/);
 assert.doesNotMatch(html,/Gold finish <special>/);
 assert.match(html,/Install dimmer/);
 assert.match(q.quoteDiscountSummaryHtml(s),/Final quoted total/);
 assert.match(q.quoteListDetailsHtml(s),/item notes/);
 assert.match(q.sourceItemNoteForOrder(s.lines[0]),/Floor \/ Room \/ Section: Ground Floor/);
});
test('history revision and imported modal both render exact note and discount breakdown',async()=>{
 const input=fixture(),{window,views}=sandbox(input);
 await window.reviewQuotationRevision('row',0);
 await window.reviewImportedQuotation('row');
 assert.equal(views.length,2);
 for(const view of views){
  assert.match(view.html,/Full price before discount/);
  assert.match(view.html,/Item discounts/);
  assert.match(view.html,/Additional quotation discount/);
  assert.match(view.html,/Final quoted total/);
  assert.match(view.html,/Gold finish &lt;special&gt;/);
  assert.match(view.html,/Ground Floor/);
  assert.match(view.html,/Install dimmer/);
 }
});
test('official Sales Order conversion stores imported notes at item level without changing normal item flow',()=>{
 const entry=read('sales-entry-workflow.js');
 assert.match(source,/source-quote-item-note/);
 assert.match(source,/addImportedItemNoteField\(row,line\)/);
 assert.match(entry,/notes:r\.querySelector\('\.source-quote-item-note'\)\?\.value\.trim\(\)\|\|null/);
 assert.match(entry,/sales_order_items'\)\.insert\(items\)/);
});
