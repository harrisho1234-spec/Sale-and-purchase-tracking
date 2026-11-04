const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const source=fs.readFileSync(path.join(__dirname,'..','sales-daily-plan.js'),'utf8');
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const start=source.indexOf('window.openSalesDailyShare=section=>{');
const end=source.indexOf('\nfunction renderSalesHome(){',start);
assert.ok(start>=0&&end>start,'Shared report renderer exists');
const renderer=source.slice(start,end);

function render(section, report){
  let overlay=null;
  const doc={
    createElement:tag=>({tag,style:{},innerHTML:'',addEventListener:()=>{}}),
    getElementById:id=>id==='salesDailySharePrintStyle'?{}:null,
    body:{appendChild:node=>{overlay=node;}}
  };
  const sandbox={
    window:{closeSalesDailyShare:()=>{}},
    ui:{report},
    state:{profile:{full_name:'Sales Person'}},
    document:doc,
    ensureDailyKhmerFont:()=>{},
    toast:()=>{throw new Error('Unexpected submit restriction')},
    h:value=>String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;'),
    formatDailySubmittedAt:()=> '02 Nov 2026, 4:21 pm (Phnom Penh)'
  };
  vm.runInNewContext(renderer,sandbox,{timeout:3000});
  sandbox.window.openSalesDailyShare(section);
  assert.ok(overlay,'Share report overlay mounted');
  return overlay.innerHTML;
}
function rowsInBody(html,which){
  const bodies=[...html.matchAll(/<tbody>([\s\S]*?)<\/tbody>/g)].map(x=>x[1]);
  assert.ok(bodies.length>=2&&bodies.length<=4,'Core sections plus optional Showroom / Online');
  return [...bodies[which].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(x=>x[1]);
}
const report={
  date:'2026-11-02',salesperson:'Hout Pichbopha',
  amStatus:'Submitted',pmStatus:'Submitted',
  reviewStatus:'Pending',pmSubmittedAt:'2026-11-02T09:21:00Z',
  tasks:[
    {id:'a',plan:'Long morning plan អតិថិជន with several lines that wrap across the cell',customerName:'B Srey Seam Kim',category:'Customer Follow-up',status:'Completed',result:'First result'},
    {id:'b',plan:'Send more modern sofas',customerName:'B Bros Samhan',category:'Customer Follow-up',status:'Pending',result:'Second result ដែលមានអក្សរខ្មែរវែងច្រើន'},
    {id:'c',plan:'Send more chandeliers',customerName:'B.Bros Police',category:'Customer Follow-up',status:'Completed',result:'Third result'},
    {id:'d',plan:'Check B Bros heng',customerName:'B Bros heng',category:'Customer Follow-up',status:'Rescheduled',result:'Fourth result'},
    {id:'e',plan:'Check Project stock',todoTaskId:'todo-1',category:'Other',status:'Completed',result:'Fifth result'}
  ],
  additionalActivities:[
    {category:'Customer Visit',sourceType:'showroom',sourceId:'source-showroom',customerName:'Walk-in',result:'Visited showroom'},
    {category:'Online Inquiry',sourceType:'online',sourceId:'source-online',customerName:'Online prospect',result:'Replied to inquiry'},
    {category:'Other',result:'Organized samples'}
  ]
};
test('one evening table row pairs each plan and its exact result regardless of text length',()=>{
  const html=render('PM',report);
  const customer=rowsInBody(html,0);
  const showroom=rowsInBody(html,1);
  const online=rowsInBody(html,2);
  const other=rowsInBody(html,3);
  assert.equal(customer.length,4,'all planned customer tasks stay in Customer Tasks');
  assert.equal(showroom.length,1,'imported Showroom entry has its own row');
  assert.equal(online.length,1,'imported Online entry has its own row');
  assert.equal(other.length,2,'To-Do and other extra activity');
  for(const [i,plan,result] of [
    [0,'Long morning plan','First result'],
    [1,'Send more modern sofas','Second result'],
    [2,'Send more chandeliers','Third result'],
    [3,'Check B Bros heng','Fourth result']
  ]){
    assert.ok(customer[i].includes(plan));
    assert.ok(customer[i].includes(result));
    assert.equal((customer[i].match(/>#\d+<\/span>/g)||[]).length,2,'same task number in both cells');
  }
  assert.ok(other[0].includes('Check Project stock')&&other[0].includes('Fifth result'));
  assert.match(customer[0],/rowgroup" rowspan="4"/);
  assert.match(html,/scope="rowgroup" rowspan="1"[^>]*>Showroom<\/th>/);
  assert.match(html,/scope="rowgroup" rowspan="1"[^>]*>Online<\/th>/);
  assert.match(html,/break-inside:avoid;page-break-inside:avoid/);
});
test('unplanned results are never placed beside a different planned task',()=>{
  const html=render('PM',report);
  const customer=rowsInBody(html,0),showroom=rowsInBody(html,1),online=rowsInBody(html,2),other=rowsInBody(html,3);
  assert.match(showroom[0],/No morning plan \(unplanned activity\)/);
  assert.match(showroom[0],/Visited showroom/);
  assert.match(online[0],/No morning plan \(unplanned activity\)/);
  assert.match(online[0],/Replied to inquiry/);
  assert.doesNotMatch(customer[0],/Visited showroom/);
  assert.doesNotMatch(customer[0],/Replied to inquiry/);
  assert.match(other[1],/No morning plan \(unplanned activity\)/);
  assert.match(other[1],/Organized samples/);
});
test('compact morning share has plan rows without evening result column',()=>{
  const html=render('AM',report);
  assert.match(html,/<th[^>]*>Morning Plan<\/th>/);
  assert.doesNotMatch(html,/<th[^>]*>Evening Result<\/th>/);
  assert.equal(rowsInBody(html,0).length,4);
  assert.equal(rowsInBody(html,1).length,1);
  assert.doesNotMatch(html,/Visited showroom/);
  assert.doesNotMatch(html,/>Showroom<\/th>/);
  assert.doesNotMatch(html,/>Online<\/th>/);
});
test('share report escapes user-supplied text and uses cache-busted script',()=>{
  const adjusted={...report,tasks:[{...report.tasks[0],plan:'<script>alert(1)</script>'}]};
  const html=render('PM',adjusted);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(index,/sales-daily-plan\.js\?v=20261103-hide-master-link-for-sales1/);
});

test('Google Sheets master shortcut is hidden for Sales and other non-management roles',()=>{
  const start=source.indexOf('function header(title,sub){');
  const end=source.indexOf('\nasync function showSetup(){',start);
  assert.ok(start>=0&&end>start,'Daily report header is available');
  const headerSource=source.slice(start,end);
  const makeHeader=role=>vm.runInNewContext(
    headerSource+'\nheader("Daily Plan & Result","Morning Plan and Evening Result")',
    {
      state:{profile:{role}},
      WORKBOOK:'https://docs.google.com/spreadsheets/d/test/edit',
      lightButton:'btn-test',
      h:value=>String(value)
    },
    {timeout:1000}
  );
  for(const role of ['sales','accountant','stock_controller',null]){
    const output=makeHeader(role);
    assert.doesNotMatch(output,/Google Sheets master/,'no master shortcut for '+role);
    assert.doesNotMatch(output,/docs\.google\.com\/spreadsheets/,'no master URL for '+role);
    assert.match(output,/Daily Plan & Result/);
  }
  for(const role of ['manager','admin','super_admin']){
    const output=makeHeader(role);
    assert.match(output,/Google Sheets master/,'master button remains available for '+role);
    assert.match(output,/docs\.google\.com\/spreadsheets/);
  }
});

test('source type wins over category, and legacy category-only imports are grouped',()=>{
  const changed={
    ...report,
    additionalActivities:[
      {category:'Customer Visit',sourceType:'online',customerName:'Online A',result:'From online source'},
      {category:'Online Inquiry',sourceType:'showroom',customerName:'Showroom B',result:'From showroom source'},
      {category:'Customer Visit',customerName:'Legacy showroom',result:'Legacy walk-in'},
      {category:'Online Inquiry',customerName:'Legacy online',result:'Legacy online visit'},
      {category:'Customer Follow-up',customerName:'Follow-up customer',result:'Called today'},
      {category:'Other',result:'Back office'}
    ]
  };
  const html=render('PM',changed);
  const customer=rowsInBody(html,0),showroom=rowsInBody(html,1),online=rowsInBody(html,2),other=rowsInBody(html,3);
  assert.equal(customer.length,5,'planned customer items and customer follow-up extra');
  assert.equal(showroom.length,2,'showroom source and legacy Customer Visit category');
  assert.equal(online.length,2,'online source and legacy Online Inquiry category');
  assert.equal(other.length,2,'planned To-Do and other');
  assert.match(showroom.join(' '),/From showroom source/);
  assert.doesNotMatch(showroom.join(' '),/From online source/);
  assert.match(online.join(' '),/From online source/);
  assert.doesNotMatch(online.join(' '),/From showroom source/);
});
test('when no Showroom/Online is imported, do not show empty category sections',()=>{
  const changed={...report,additionalActivities:[{category:'Other',result:'Back office'}]};
  const html=render('PM',changed);
  assert.equal([...html.matchAll(/<tbody>/g)].length,2);
  assert.doesNotMatch(html,/>Showroom<\/th>/);
  assert.doesNotMatch(html,/>Online<\/th>/);
  assert.equal(rowsInBody(html,0).length,4);
  assert.equal(rowsInBody(html,1).length,2);
});
