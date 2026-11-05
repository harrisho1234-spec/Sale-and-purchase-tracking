const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','sales-daily-plan.js'),'utf8');
const exposed=source.replace(/\}\)\(\);\s*$/,
  'window.__shareTest={setReport:r=>{ui.report=r;ui.date=r.date;},compact:dailyCompactShareBody};})();');
assert.notEqual(exposed,source);

function report(){
 return {
  date:'2026-11-05',salesperson:'Keom Nalis',amStatus:'Submitted',pmStatus:'Submitted',
  reviewStatus:'Pending',pmSubmittedAt:'2026-11-05T11:33:00Z',
  tasks:[
   {category:'Customer Follow-up',plan:'Send more product pictures',customerName:'Tea Vannak',
    result:'កំពុងរង់ចាំការសម្រេច',status:'Pending'},
   {category:'Customer Follow-up',plan:'Follow up the discount',customerName:'B Srey Mei',
    result:'She did not reply',status:'Partially Completed'},
   {category:'Customer Follow-up',plan:'Confirm lamp selection',customerName:'B Srey Sina',
    result:'She did not reply',status:'Partially Completed'},
   {category:'Other',todoTaskId:'todo-01',plan:'Book a product photo shoot',
    result:'80% done',status:'Pending'}
  ],
  additionalActivities:[
   {category:'Customer Visit',sourceType:'showroom_visit',sourceId:'visit-01',
    customerName:'B Srey Theary',result:'Nalis continue to follow up',nextFollowup:'2026-11-05'},
   {category:'Customer Visit',sourceType:'showroom_visit',sourceId:'visit-02',
    customerName:'B Srey Kuthea',result:'Nalis continue to follow up'},
   {category:'Online Inquiry',sourceType:'online',sourceId:'online-01',
    customerName:'Nha',result:'Nalis continue to follow up'},
   {category:'Online Inquiry',sourceType:'online',sourceId:'online-02',
    customerName:'De Mythica',result:'She not reply'},
   {category:'Online Inquiry',sourceType:'online',sourceId:'online-03',
    customerName:'Pheaktra Sun',result:'She seen not reply'},
   {category:'Other',customerName:'',result:'Rearrange the display shelves'}
  ]
 };
}
function app(){
 const elements={},toasts=[],appended=[],downloaded=[],shared=[],calls=[];
 const buttons=[{textContent:'Share Image',dataset:{},disabled:false},
   {textContent:'Save PNG',dataset:{},disabled:false}];
 const document={
  fonts:{ready:Promise.resolve()},
  head:{appendChild:x=>{elements[x.id]=x}},
  body:{appendChild:x=>{appended.push(x);elements[x.id]=x}},
  createElement(tag){
   if(tag==='a')return{tag,href:'',download:'',click(){downloaded.push({filename:this.download,href:this.href})},remove(){}};
   return{tag,style:{},innerHTML:'',dataset:{},addEventListener(){},remove(){delete elements[this.id]}};
  },
  getElementById:id=>elements[id]||null,
  querySelectorAll:sel=>sel.includes('[data-share-export]')?buttons:[]
 };
 const BlobFile=class File{constructor(blobs,name,options){this.data=blobs;this.name=name;this.type=options.type}};
 const url={createObjectURL:blob=>'blob:daily-report-png',revokeObjectURL(){}};
 const ctx={
  Date,Intl,console,document,URL:url,File:BlobFile,
  navigator:{canShare:({files})=>files.length===1,share:async value=>shared.push(value)},
  state:{user:{id:'sales-1'},profile:{role:'sales',name:'Keom Nalis'},page:'sales-daily'},
  db:{},navItems:()=>[],hasAppPermission:()=>true,
  showToast:(message,type)=>toasts.push({message,type}),
  sessionStorage:{getItem:()=>null},setTimeout:()=>{},
  html2canvas:async(card,options)=>{
   calls.push({card,options});
   const clone={style:{}};
   options.onclone({getElementById:id=>id==='salesDailyShareCard'?clone:null});
   calls[calls.length-1].clone=clone;
   return {toBlob:callback=>callback({type:'image/png',size:180000})};
  }
 };
 ctx.window=ctx;
 vm.createContext(ctx);
 vm.runInContext(exposed,ctx);
 return{ctx,elements,toasts,buttons,appended,downloaded,shared,calls};
}
test('one-image view is the default and removes repeated blank morning-plan cells',()=>{
 const {ctx,elements}=app();
 ctx.__shareTest.setReport(report());
 ctx.openSalesDailyShare('PM');
 const markup=elements.salesDailyShareOverlay.innerHTML;
 assert.match(markup,/data-share-mode="compact"/);
 assert.match(markup,/One Image/);
 assert.match(markup,/Detailed/);
 assert.match(markup,/Share Image/);
 assert.match(markup,/Save PNG/);
 assert.match(markup,/data-compact-section="visit"/);
 assert.match(markup,/data-compact-section="online"/);
 assert.match(markup,/data-compact-section="other"/);
 assert.match(markup,/grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
 assert.doesNotMatch(markup,/No morning plan \(unplanned activity\)/);
 assert.equal((markup.match(/data-compact-extra/g)||[]).length,6);
 assert.equal((markup.match(/data-compact-planned/g)||[]).length,4);
 for(const phrase of ['Tea Vannak','B Srey Theary','B Srey Kuthea','Nha','De Mythica',
   'Pheaktra Sun','80% done','Rearrange the display shelves','2026-11-05'])
   assert.ok(markup.includes(phrase),'Missing result '+phrase);
 assert.match(markup,/កំពុងរង់ចាំការសម្រេច/);
 assert.equal((markup.match(/B Srey Theary/g)||[]).length,1,'Do not duplicate imports');
});
test('compact layout keeps all long notes and escapes customer-supplied HTML',()=>{
 const {ctx}=app(),r=report();
 r.additionalActivities[0].result='Unfinished <script>alert(1)</script> with follow-up details'.repeat(8);
 ctx.__shareTest.setReport(r);
 const html=ctx.__shareTest.compact(r,true);
 assert.match(html,/&lt;script&gt;/);
 assert.doesNotMatch(html,/<script>/);
 assert.match(html,/with follow-up details/);
 assert.match(html,/white-space:pre-wrap/);
 assert.match(html,/overflow-wrap:anywhere/);
 assert.doesNotMatch(html,/text-overflow:ellipsis/);
});
test('Detailed mode retains Morning Plan / Evening Result side-by-side, and AM can still share',()=>{
 const {ctx,elements}=app();
 ctx.__shareTest.setReport(report());
 ctx.openSalesDailyShare('PM','detailed');
 const pm=elements.salesDailyShareOverlay.innerHTML;
 assert.match(pm,/data-share-mode="detailed"/);
 assert.match(pm,/>Morning Plan<\/th>/);
 assert.match(pm,/>Evening Result<\/th>/);
 assert.match(pm,/Linked Showroom Visit/);
 assert.match(pm,/Linked Online Inquiry/);
 ctx.openSalesDailyShare('AM');
 const am=elements.salesDailyShareOverlay.innerHTML;
 assert.match(am,/data-share-mode="compact"/);
 assert.match(am,/Morning Plan/);
 assert.doesNotMatch(am,/data-compact-extra/);
});
test('Share Image exports whole card to one full-resolution PNG via native file sharing',async()=>{
 const a=app();a.ctx.__shareTest.setReport(report());
 const card={dataset:{shareReportType:'PM'},style:{}};
 a.elements.salesDailyShareCard=card;
 await a.ctx.exportSalesDailyReportImage(true);
 assert.equal(a.calls.length,1);
 assert.equal(a.calls[0].card,card);
 assert.equal(a.calls[0].clone.style.width,'760px');
 assert.equal(a.calls[0].clone.style.overflow,'visible');
 assert.equal(a.calls[0].options.scale,2);
 assert.equal(a.shared.length,1);
 assert.equal(a.shared[0].files[0].name,'Evening-Result-2026-11-05-Keom-Nalis.png');
 assert.equal(a.shared[0].files[0].type,'image/png');
 assert.equal(a.downloaded.length,0,'Native sharing should not also download');
 assert.ok(a.buttons.every(b=>!b.disabled),'Restore controls after image creation');
});
test('Save PNG downloads exactly one image when native sharing is unavailable',async()=>{
 const a=app();a.ctx.__shareTest.setReport(report());
 a.elements.salesDailyShareCard={dataset:{shareReportType:'PM'},style:{}};
 a.ctx.navigator={};
 await a.ctx.exportSalesDailyReportImage(false);
 assert.equal(a.calls.length,1);
 assert.equal(a.shared.length,0);
 assert.equal(a.downloaded.length,1);
 assert.equal(a.downloaded[0].filename,'Evening-Result-2026-11-05-Keom-Nalis.png');
});
