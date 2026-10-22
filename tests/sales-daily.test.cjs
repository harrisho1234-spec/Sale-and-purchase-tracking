const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
function fixture(){
 let id=0;
 class Sheet{
  rows=[['header']];
  getDataRange(){return{getDisplayValues:()=>this.rows.map(r=>r.map(String))}}
  appendRow(r){this.rows.push([...r])}
  deleteRow(n){this.rows.splice(n-1,1)}
  getRange(n,c,h,w){return{setValues:rows=>{assert.equal(rows[0].length,w);this.rows[n-1]=[...rows[0]]}}}
 }
 const sheets=Object.fromEntries(['Daily Reports','Plan Tasks','Manager Reviews','Audit Log'].map(k=>[k,new Sheet()]));
 const ss={getSheetByName:n=>sheets[n],getName:()=> 'Test'};
 const c={Utilities:{getUuid:()=>`id-${++id}`,formatDate:()=> '2026-10-22'},SpreadsheetApp:{flush(){}},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})}};
 vm.createContext(c);vm.runInContext(read('google-apps-script/sales-daily-plan/Code.gs'),c);
 const a={user_id:'sales-1',role:'sales',display_name:'=unsafe',can_write:true,can_review:false};
 const b={...a,user_id:'sales-2'};
 const m={user_id:'manager',role:'manager',display_name:'Manager',can_review:true,sales_people:[{user_id:a.user_id}]};
 const task=plan=>({plan,category:'Other'});
 const call=(actor,action,p)=>c.dispatch(ss,actor,action,p);
 return{c,sheets,ss,a,b,m,task,call};
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

