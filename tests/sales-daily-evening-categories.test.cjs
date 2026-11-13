const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'..','sales-daily-plan.js'),'utf8');
const expose=src.replace(/\}\)\(\);\s*$/,
 'window.__dailyCategoryTest={setReport:r=>{ui.report=r;ui.date=r.date},extra:dailyExtraSection,planned:dailyPlannedSection,editor:()=>additionalEditor(false),capture:()=>captureAdditional(),manager:groupedDailyManagerExtras};})();');
assert.notEqual(expose,src,'Test helpers must be added without modifying the production source');
function createApp(){
 const elements={};
 const content={_rows:[],querySelectorAll(sel){return sel==='.additional-daily-row'?this._rows:[]}};
 const document={
  head:{appendChild(x){elements[x.id]=x}},
  body:{appendChild(x){elements[x.id]=x}},
  createElement:tag=>({tag,style:{},innerHTML:'',addEventListener(){},remove(){delete elements[this.id]}}),
  getElementById:id=>id==='content'?content:elements[id]||null
 };
 const c={document,Date,Intl,console,sessionStorage:{getItem:()=>null,removeItem:()=>{}},
  state:{user:{id:'sales-1'},profile:{role:'sales',name:'Pay Pheara'},page:'sales-daily'},
  db:{},navItems:()=>[],hasAppPermission:()=>true,
  showToast:message=>{throw Error('Unexpected toast: '+message)}};
 c.window=c;
 vm.createContext(c);vm.runInContext(expose,c);
 return{c,content,elements};
}
function exampleReport(){
 return{id:'r-1',date:'2026-11-04',salesperson:'Pay Pheara',
  amStatus:'Submitted',pmStatus:'Submitted',reviewStatus:'Pending',
  pmSubmittedAt:'2026-11-04T11:00:00Z',
  tasks:[
   {id:'t-1',category:'Customer Follow-up',plan:'Follow up lamp quote',
    customerName:'B. Srey Pisey',result:'Awaiting deposit',status:'Pending'},
   {id:'t-2',category:'Online Inquiries',plan:'Reply to online questions',
    customerName:'Online customer',result:'Replied',status:'Completed'},
   {id:'t-3',category:'Other',todoTaskId:'todo-1',plan:'Prepare marketing content',
    result:'Done',status:'Completed'}
  ],
  additionalActivities:[
   {id:'a-online',sourceType:'online',sourceId:'online-123',
    category:'Online Inquiry',customerName:'Online visitor',result:'Product inquiry received'},
   {id:'a-showroom',sourceType:'showroom_visit',sourceId:'showroom-456',
    category:'Customer Visit',customerName:'B.Srey Seam Kim',result:'Waiting to check with her husband'},
   {id:'a-other',category:'Other',customerName:'',result:'Prepare new display samples'}
  ]};
}
test('Showroom source, online source, legacy manual categories and To-Do use four stable groups',()=>{
 const {c}=createApp(),g=c.__dailyCategoryTest;
 assert.equal(g.extra({sourceType:'showroom_visit',category:'Other'}),'visit');
 assert.equal(g.extra({sourceType:'showroom',category:'Other'}),'visit');
 assert.equal(g.extra({sourceType:'online',category:'Other'}),'online');
 assert.equal(g.extra({category:'Customer Visit'}),'visit');
 assert.equal(g.extra({category:'Showroom Work'}),'other');
 assert.equal(g.extra({category:'Showroom Work',sourceType:'showroom_visit',sourceId:'real-visit'}),'visit');
 assert.equal(g.extra({category:'Online Inquiry'}),'online');
 assert.equal(g.extra({category:'Customer Follow-up'}),'customer');
 assert.equal(g.extra({category:'Other'}),'other');
 assert.equal(g.planned({category:'Online Inquiries',customerName:'B. Name'}),'online');
 assert.equal(g.planned({todoTaskId:'t-1',category:'Customer Follow-up',customerName:'B. Name'}),'other');
});
test('compact Evening Result/print groups imports into Customer Visit and Online, never Other',()=>{
 const {c,elements}=createApp(),r=exampleReport();
 c.__dailyCategoryTest.setReport(r);
 c.openSalesDailyShare('PM','detailed');
 const html=elements.salesDailyShareOverlay.innerHTML;
 const labels=['Customer Task','Customer Visit','Online','Other Task / To Do'];
 const pos=labels.map(label=>html.indexOf('>'+label+'</th>'));
 assert.ok(pos.every(p=>p>=0));
 assert.ok(pos.every((p,i)=>i===0||p>pos[i-1]),'Four report sections must be ordered');
 const visit=html.indexOf('B.Srey Seam Kim');
 const online=html.indexOf('Online visitor');
 const other=html.indexOf('Prepare new display samples');
 assert.ok(visit>pos[1]&&visit<pos[2],'Imported showroom in Customer Visit section');
 assert.ok(online>pos[2]&&online<pos[3],'Imported online inquiry in Online section');
 assert.ok(other>pos[3],'Unplanned miscellaneous work in Other section');
 assert.equal(html.split('B.Srey Seam Kim').length-1,1,'No duplicate imported visit');
 assert.match(html,/Linked Showroom Visit/);
 assert.match(html,/Linked Online Inquiry/);
 assert.match(html,/Awaiting deposit/);
});
test('existing Morning Plan share remains a two-category view',()=>{
 const {c,elements}=createApp();c.__dailyCategoryTest.setReport(exampleReport());
 c.openSalesDailyShare('AM','detailed');
 const html=elements.salesDailyShareOverlay.innerHTML;
 assert.match(html,/>Customer Tasks<\/th>/);
 assert.match(html,/>Other Tasks \/ To-Do<\/th>/);
 assert.doesNotMatch(html,/>Customer Visit<\/th>/);
});
test('grouped editor preserves imported row identity when its display order differs from saved order',()=>{
 const {c,content}=createApp(),r=exampleReport();
 c.__dailyCategoryTest.setReport(r);
 const editor=c.__dailyCategoryTest.editor();
 assert.ok(editor.indexOf('Customer Visit ·')<editor.indexOf('Online ·'));
 assert.ok(editor.indexOf('data-draft-index="1"')<editor.indexOf('data-draft-index="0"'));
 const fieldRow=(i)=>({
  dataset:{draftIndex:String(i),sourceType:r.additionalActivities[i].sourceType||'',
           sourceId:r.additionalActivities[i].sourceId||''},
  querySelector:selector=>{
   const item=r.additionalActivities[i];
   const values={'[data-extra="category"]':item.category,
     '[data-extra="customerName"]':item.customerName,
     '[data-extra="result"]':item.result,
     '[data-extra="nextFollowup"]':item.nextFollowup||''};
   return {value:values[selector]||''};
  }
 });
 // Real DOM order: Customer Visit first, Online second, Other last.
 content._rows=[fieldRow(1),fieldRow(0),fieldRow(2)];
 const captured=c.__dailyCategoryTest.capture();
 assert.equal(captured[0].id,'a-online');
 assert.equal(captured[0].sourceId,'online-123');
 assert.equal(captured[1].id,'a-showroom');
 assert.equal(captured[1].sourceId,'showroom-456');
 assert.equal(captured[2].id,'a-other');
});
test('manager review shows matching grouped categories and retains links to original activities',()=>{
 const {c}=createApp();
 const html=c.__dailyCategoryTest.manager(exampleReport().additionalActivities);
 assert.match(html,/Customer Visit/);
 assert.match(html,/Online/);
 assert.match(html,/Other Task \/ To Do/);
 assert.match(html,/Open original activity/);
 assert.match(html,/showroom-456/);
 assert.match(html,/online-123/);
});

test('manual Showroom Work is displayed as unplanned Other in editor, compact image, detailed export and manager review',()=>{
 const {c,elements}=createApp(),r=exampleReport();
 r.additionalActivities=[
  {id:'manual-visit',category:'Customer Visit',customerName:'',result:'done test 1'},
  {id:'manual-work',category:'Showroom Work',customerName:'',result:'done test 2'}
 ];
 const g=c.__dailyCategoryTest;g.setReport(r);
 const editor=g.editor();
 assert.match(editor,/Customer Visit · 1/);
 assert.match(editor,/Other Task \/ To Do · 1/);
 assert.match(editor,/onchange="reclassifyAdditionalDaily\(\)"/);
 c.openSalesDailyShare('PM');
 const compact=elements.salesDailyShareOverlay.innerHTML;
 assert.match(compact,/data-compact-section="visit"/);
 assert.match(compact,/data-compact-section="other"/);
 assert.match(compact,/1 visits/);
 assert.match(compact,/0 online/);
 assert.match(compact,/Unplanned · Showroom Work/);
 c.openSalesDailyShare('PM','detailed');
 const detailed=elements.salesDailyShareOverlay.innerHTML;
 const visitPos=detailed.indexOf('>Customer Visit</th>');
 const otherPos=detailed.indexOf('>Other Task / To Do</th>');
 const visitResult=detailed.indexOf('done test 1');
 const workResult=detailed.indexOf('done test 2');
 assert.ok(visitPos>=0&&otherPos>visitPos,'Customer Visit and Other sections exist in order');
 assert.ok(visitResult>visitPos&&visitResult<otherPos,'Manual visit stays under visits');
 assert.ok(workResult>otherPos,'Showroom Work is placed in Other');
 assert.match(detailed,/Unplanned · Showroom Work/);
 const manager=g.manager(r.additionalActivities);
 assert.match(manager,/Customer Visit · 1/);
 assert.match(manager,/Other Task \/ To Do · 1/);
 assert.match(manager,/done test 2/);
});
