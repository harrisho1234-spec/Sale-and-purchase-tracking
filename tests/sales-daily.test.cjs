const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(){
 let id=0,clock=Date.parse('2026-10-23T02:00:00Z');
 class FrozenDate extends Date{
  constructor(...args){super(...(args.length?args:[clock]))}
  static now(){return clock}
 }
 class Sheet{
  rows=[['header']];
  getDataRange(){return{getDisplayValues:()=>this.rows.map(r=>r.map(String))}}
  appendRow(r){this.rows.push([...r]);return this}
  deleteRow(n){this.rows.splice(n-1,1)}
  getRange(n,c,h,w){return{setValues:rows=>{assert.equal(rows[0].length,w);this.rows[n-1]=[...rows[0]]},setValue:value=>{this.rows[n-1][c-1]=value}}}
 }
 const sheets=Object.fromEntries(['Daily Reports','Plan Tasks','Manager Reviews','Audit Log'].map(k=>[k,new Sheet()]));
 const ss={getSheetByName:n=>sheets[n],insertSheet:n=>(sheets[n]=new Sheet()),getName:()=> 'Test'};
 const c={Date:FrozenDate,Utilities:{getUuid:()=>`id-${++id}`,formatDate:()=> '2026-10-22'},SpreadsheetApp:{flush(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
 vm.createContext(c);vm.runInContext(read('google-apps-script/sales-daily-plan/Code.gs'),c);
 const a={user_id:'sales-1',role:'sales',display_name:'=unsafe',can_write:true,can_review:false};
 const b={...a,user_id:'sales-2'};
 const m={user_id:'manager',role:'manager',display_name:'Manager',can_review:true,sales_people:[{user_id:a.user_id}]};
 const task=plan=>({plan,category:'Other'});
 const call=(actor,action,p)=>c.dispatch(ss,actor,action,p);
 return{c,sheets,ss,a,b,m,task,call,setNow:iso=>{clock=Date.parse(iso)}};
}
test('AM → PM → corrections → resubmit → review; ownership and weekly filter',()=>{
 const {a,b,m,task,call}=fixture();const date='2026-10-22';
 const r=call(a,'submit_am',{date,tasks:[task('Call'),task('Visit')]});
 assert.equal(r.salesperson,"'=unsafe");
 assert.throws(()=>call(a,'save_am',{date,tasks:[task('Replace')]}),/already/);
 assert.throws(()=>call(m,'save_am',{date,tasks:[task('No')]}),/cannot/);
 call(b,'submit_am',{date,tasks:[task('Private')]});
 assert.equal(call(a,'read',{date}).reports.length,1);
 assert.equal(call(m,'read',{date}).reports.length,1);
 const results=r.tasks.map((t,i)=>({id:t.id,status:i?'Pending':'Completed',result:'Done'}));
 call(a,'submit_pm',{date,results});
 assert.throws(()=>call(a,'save_pm',{date,results}),/already/);
 assert.throws(()=>call(a,'review',{reportId:r.id,decision:'Reviewed'}),/management/);
 call(m,'review',{reportId:r.id,decision:'Changes Requested',comment:'Please clarify'});
 call(a,'submit_pm',{date,results});
 call(m,'review',{reportId:r.id,decision:'Reviewed'});
 assert.throws(()=>call(a,'save_pm',{date,results}),/closed/);
 assert.equal(call(a,'carry_forward',{from:date,to:'2026-10-23'}).suggestions.length,1);
 assert.equal(call(m,'weekly',{start:date,end:date,userId:b.user_id}).plannedTasks,0);
 assert.equal(call(m,'weekly',{start:date,end:date,userId:a.user_id}).completed,1);
});
test('invalid PM rows leave every task unchanged; blank sheet rows keep physical addresses',()=>{
 const {a,task,call,sheets}=fixture();const date='2026-10-22';
 sheets['Daily Reports'].rows.push(Array(15).fill(''));
 sheets['Plan Tasks'].rows.push(Array(17).fill(''));
 const r=call(a,'submit_am',{date,tasks:[task('One'),task('Two')]});
 const before=JSON.stringify(sheets['Plan Tasks'].rows);
 const results=r.tasks.map((t,i)=>({id:t.id,status:i?'Rescheduled':'Completed'}));
 assert.throws(()=>call(a,'submit_pm',{date,results}),/follow-up/);
 assert.equal(JSON.stringify(sheets['Plan Tasks'].rows),before);
 results[1].nextFollowup='2026-10-23';call(a,'submit_pm',{date,results});
 assert.equal(sheets['Plan Tasks'].rows[1][0],'');
 assert.equal(sheets['Daily Reports'].rows[2][7],'Submitted');
});
test('calendar validation rejects normalized invalid dates and authentication fails closed',()=>{
 const {c}=fixture();
 for(const d of ['2026-02-30','2026-13-01','bad'])assert.throws(()=>c.iso(d),/valid date/);
 assert.equal(c.iso('2024-02-29'),'2024-02-29');
 assert.throws(()=>c.authenticate(''),/expired/);
});
test('proxy rejects malformed requests and never forwards an invalid identity',async()=>{
 let handler,calls=[];
 const c={Response,AbortController,setTimeout,clearTimeout,Deno:{env:{get:()=> 'configured'},serve:f=>handler=f},fetch:async(url)=>{calls.push(url);return new Response('{}',{status:401})}};
 vm.createContext(c);vm.runInContext(read('supabase/functions/sales-daily-google-proxy/index.ts'),c);
 const req=(body,authorization='Bearer test')=>new Request('https://proxy',{method:'POST',headers:{authorization},body});
 assert.equal((await handler(req('{}','test'))).status,401);
 assert.equal((await handler(req('null'))).status,400);
 assert.equal((await handler(req('{'))).status,400);
 assert.equal((await handler(req('{"action":"read","payload":[]}'))).status,400);
 assert.equal(calls.length,0);
 assert.equal((await handler(req('{"action":"read"}'))).status,401);
 assert.ok(calls.every(x=>!x.includes('script.google')));
});
test('UI resets drafts on date/account changes, requests scoped weekly stats and hides forbidden roles',async()=>{
 const nodes={content:{innerHTML:'',querySelectorAll:()=>[]},pageTitle:{},pageSubtitle:{},salesDailyDate:{value:'2026-10-21'}};
 let requests=[];
 const c={Intl,Date,console,document:{getElementById:id=>nodes[id]},state:{user:{id:'sales-1'},profile:{role:'sales'},page:''},showToast(){},renderNav(){},navItems:()=>[],go(){},db:{
  rpc:async()=>({data:{configured:true}}),
  from:()=>({select:()=>({eq(){return this},order(){return this},limit(){return this},then(resolve){return Promise.resolve({data:[]}).then(resolve)}})}),
  functions:{invoke:async(_,req)=>{requests.push(req.body);return{data:{ok:true,data:req.body.action==='weekly'?{plannedTasks:0}:{reports:req.body.payload.date==='2026-10-21'?[]:[{userId:c.state.user.id,tasks:[{plan:'Yesterday draft',category:'Other'}]}]}}}}}
 }};c.window=c;vm.createContext(c);vm.runInContext(read('sales-daily-plan.js'),c);
 await c.go('sales-daily');assert.match(nodes.content.innerHTML,/Yesterday draft/);
 await c.selectSalesDailyDate();assert.doesNotMatch(nodes.content.innerHTML,/Yesterday draft/);
 assert.ok(requests.some(r=>r.action==='weekly'));
 c.state.profile.role='accountant';assert.equal(c.navItems().length,0);
 c.state.profile.role='manager';await c.go('sales-daily-review');
 assert.match(nodes.content.innerHTML,/Last 7 days/);
});


test('manager review stays independent of task completion, persists its reviewer and clears pending review',()=>{
 const {a,m,task,call}=fixture(),date='2026-10-22';
 const report=call(a,'submit_am',{date,tasks:[task('Follow-up customer')]});
 call(a,'submit_pm',{date,results:[{id:report.tasks[0].id,status:'Pending',result:'No reply yet'}]});
 assert.equal(call(m,'read',{date}).reports[0].reviewStatus,'Pending');
 call(m,'review',{reportId:report.id,decision:'Reviewed',comment:'Follow up tomorrow'});
 const saved=call(m,'read',{date}).reports[0];
 assert.equal(saved.reviewStatus,'Reviewed');
 assert.equal(saved.pmStatus,'Submitted');
 assert.equal(saved.reviewedBy,'Manager');
 assert.ok(saved.reviewedAt);
 assert.equal(saved.tasks[0].status,'Pending');
 assert.equal(saved.tasks[0].result,'No reply yet');
 assert.equal(call(m,'weekly',{start:date,end:date}).reviewed,1);
 assert.throws(()=>call(m,'review',{reportId:report.id,decision:'Reviewed'}),/already reviewed/);
});

async function managerReviewUiCase(persist){
 let report={id:'r1',date:'2026-11-01',userId:'sales1',salesperson:'Pay Pheara',
  amStatus:'Submitted',pmStatus:'Submitted',reviewStatus:'Pending',reviewedBy:'',reviewedAt:'',
  tasks:[{id:'t1',plan:'Follow up',category:'Customer Follow-up',status:'Pending',result:'No reply'}],
  editRequests:[],additionalActivities:[]};
 const info={modal:'',closed:0,notices:[],actions:[]};
 const content={innerHTML:'',querySelectorAll:()=>[],querySelector:()=>null};
 const nodes={content,pageTitle:{textContent:''},pageSubtitle:{textContent:''},dailyManagerComment:{value:'Please follow up'}};
 const c={Intl,Date,console,document:{getElementById:id=>nodes[id]||null},
  state:{user:{id:'manager'},profile:{role:'manager'},page:'dashboard'},
  showToast:(message,type)=>info.notices.push({message,type}),
  openModal:(title,html)=>{info.modal=html},closeModal:()=>{info.closed++},renderNav:()=>{},
  navItems:()=>[],go:async()=>{},hasAppPermission:()=>true,
  db:{rpc:async name=>({data:name==='get_sales_daily_connection'?{configured:true}:{can_review:true}}),
   functions:{invoke:async(_,req)=>{
    const action=req.body.action;info.actions.push(action);
    if(action==='read')return {data:{ok:true,data:{reports:[JSON.parse(JSON.stringify(report))],
     salesPeople:[{user_id:'sales1',name:'Pay Pheara'}]}}};
    if(action==='weekly')return {data:{ok:true,data:{plannedTasks:1,amSubmitted:1,pmSubmitted:1,
     reviewed:report.reviewStatus==='Reviewed'?1:0}}};
    if(action==='review'){
     if(persist){report.reviewStatus=req.body.payload.decision;report.reviewedBy='Manager';
      report.reviewedAt='2026-11-04T03:00:00Z'}
     return {data:{ok:true,data:{decision:req.body.payload.decision}}};
    }
    return {data:{ok:true,data:{}}};
   }}}
 };
 c.window=c;vm.createContext(c);vm.runInContext(read('sales-daily-plan.js'),c);
 await c.go('sales-daily-review');
 assert.match(content.innerHTML,/Awaiting Manager Review/);
 c.openDailyManagerReport('r1');
 assert.match(info.modal,/Task outcome:<\/b> Pending \/ Outstanding/);
 assert.match(info.modal,/Manager review:<\/b> Awaiting Manager Review/);
 assert.equal((await c.getSalesDailyApprovalQueue()).length,1);
 await c.submitDailyManagerReview('r1','Reviewed');
 return {c,info,content,report};
}
test('manager review UI confirms saved status, shows reviewer and leaves unfinished tasks untouched',async()=>{
 const {c,info,content,report}=await managerReviewUiCase(true);
 assert.equal(info.closed,1);
 assert.match(content.innerHTML,/Manager review: Reviewed/);
 assert.equal(report.tasks[0].status,'Pending');
 assert.equal((await c.getSalesDailyApprovalQueue()).length,0);
 c.openDailyManagerReport('r1');
 assert.match(info.modal,/Reviewed by Manager/);
 assert.doesNotMatch(info.modal,/Mark Reviewed/);
 assert.ok(info.notices.some(x=>/Manager review completed/.test(x.message)&&x.type!=='err'));
});
test('unsubmitted Evening Result is Not Ready rather than a pending manager review',async()=>{
 const {c,info,content,report}=await managerReviewUiCase(false);
 report.pmStatus='Not Started';
 c.invalidateSalesDailyApprovals();
 await c.reloadDailyReport();
 assert.ok(content.innerHTML.includes('Not Ready (PM not submitted)'));
 assert.equal((await c.getSalesDailyApprovalQueue()).length,0);
 c.openDailyManagerReport('r1');
 assert.ok(info.modal.includes('Manager review:</b> Not Ready (PM not submitted)'));
 assert.doesNotMatch(info.modal,/Mark Reviewed/);
});
test('manager review UI does not falsely report success if Google Sheets still says Pending',async()=>{
 const {info,report}=await managerReviewUiCase(false);
 assert.equal(report.reviewStatus,'Pending');
 assert.equal(info.closed,0);
 assert.ok(info.notices.some(x=>/could not be confirmed/.test(x.message)&&x.type==='err'));
 assert.ok(!info.notices.some(x=>/Manager review completed/.test(x.message)));
});

test('initial Evening Result deadline is next calendar day 10 AM Phnom Penh, with authenticated late override',()=>{
 const {a,m,call,task,setNow,sheets}=fixture(),date='2026-10-22';
 const report=call(a,'submit_am',{date,tasks:[task('Follow-up')]});
 assert.equal(call(a,'read',{date}).reports[0].pmDeadline,'2026-10-23T10:00:00+07:00');
 const results=[{id:report.tasks[0].id,status:'Pending',result:'Awaiting reply'}];
 setNow('2026-10-23T03:00:01Z'); // 10:00:01 in Phnom Penh
 assert.throws(()=>call(a,'submit_pm',{date,results}),/deadline passed/);
 assert.equal(call(m,'read',{date}).reports[0].pmStatus,'Not Started');
 assert.throws(()=>call(a,'allow_late_pm',{reportId:report.id,reason:'Manager decision'}),/management/);
 assert.throws(()=>call(m,'allow_late_pm',{reportId:report.id,reason:''}),/reason/);
 const grant=call(m,'allow_late_pm',{reportId:report.id,reason:'Approved delay'});
 assert.equal(grant.allowed,true);
 assert.equal(call(m,'allow_late_pm',{reportId:report.id,reason:'Approved delay'}).alreadyAllowed,true);
 assert.equal(call(a,'read',{date}).reports[0].lateSubmissionAllowed,true);
 const pm=call(a,'submit_pm',{date,results});
 assert.equal(pm.reviewStatus,'Pending'); // fresh review is required
 assert.equal(call(m,'read',{date}).reports[0].pmStatus,'Submitted');
 assert.ok(sheets['Audit Log'].rows.some(r=>r.includes('LATE_PM_ALLOWED')));
 call(m,'review',{reportId:report.id,decision:'Reviewed'});
 assert.equal(call(m,'read',{date}).reports[0].reviewStatus,'Reviewed');
});
test('PM resubmission after manager correction requires a new review even after the deadline',()=>{
 const {a,m,call,task,setNow}=fixture(),date='2026-10-22';
 const report=call(a,'submit_am',{date,tasks:[task('Follow-up')]});
 const results=[{id:report.tasks[0].id,status:'Partially Completed',result:'Waiting'}];
 call(a,'submit_pm',{date,results});
 setNow('2026-10-23T04:00:00Z');
 call(m,'review',{reportId:report.id,decision:'Changes Requested',comment:'Need more details'});
 assert.equal(call(m,'read',{date}).reports[0].reviewStatus,'Changes Requested');
 const resubmitted=call(a,'submit_pm',{date,results:[{...results[0],result:'Called, customer still considering'}]});
 assert.equal(resubmitted.reviewStatus,'Pending');
 const saved=call(m,'read',{date}).reports[0];
 assert.equal(saved.reviewStatus,'Pending');
 assert.equal(saved.pmStatus,'Submitted');
 assert.equal(saved.reviewedBy,'');
 call(m,'review',{reportId:report.id,decision:'Reviewed'});
 assert.equal(call(m,'read',{date}).reports[0].reviewStatus,'Reviewed');
});
