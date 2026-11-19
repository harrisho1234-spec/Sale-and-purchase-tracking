const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const source=fs.readFileSync(path.join(__dirname,'../company-daily-legacy.js'),'utf8');
function fixture(role='super_admin',userId='admin'){
 const calls=[],storage={},state={profile:{role},user:{id:userId}};
 const win={go:async page=>{win.lastPage=page}};
 const db={functions:{invoke:async(name,{body})=>{
  calls.push(name+':'+body.action);
  if(body.action==='todo_list')return{data:{ok:true,data:{items:[{id:'sales-task',title:'Customer follow-up',assigneeId:'sales',status:'In Progress'}]}}};
  if(body.action==='read')return{data:{ok:true,data:{reports:[{id:'daily-sales',date:'2026-11-19',userId:'sales',salesperson:'Sales Rep',amStatus:'Submitted',pmStatus:'Submitted',tasks:[{id:'task1',plan:'Customer follow-up',status:'Completed'}]}],salesPeople:[]}}};
  if(body.action==='list')return{data:{ok:true,data:{tasks:[{id:'mkt-task',title:'Poster',assignee_id:'marketing',status:'In Progress'}],daily:[{id:'mkt-day',work_date:'2026-11-19',user_id:'marketing',plan_json:'["mkt-task"]',am_submitted_at:'2026-11-19T08:00:00Z',pm_submitted_at:''}]}}};
  throw Error('Unknown action');
 }},rpc:async()=>({data:[],error:null})};
 const context={window:win,state,db,sessionStorage:{setItem:(k,v)=>storage[k]=v},alert:()=>{},Date};
 vm.createContext(context);vm.runInContext(source,context);
 return{bridge:win.LICompanyDailyLegacy,calls,win,storage};
}
test('admin reads original Sales and Marketing without creating company tasks',async()=>{
 const {bridge,calls}=fixture();
 await bridge.load('2026-11-19');
 assert.equal(bridge.S.salesReports.length,1);
 assert.equal(bridge.S.marketingReports.length,1);
 assert.match(bridge.daily('2026-11-19'),/Customer follow-up/);
 assert.match(bridge.tasksPanel(),/Poster/);
 assert.equal(calls.some(c=>c.includes('company_save')),false);
});
test('Sales staff cannot read Marketing data and links a To-Do draft',async()=>{
 const x=fixture('sales','sales');
 await x.bridge.load('2026-11-19');
 assert.equal(x.calls.some(c=>c.includes('marketing-google-proxy')),false);
 await x.win.companyDailyLegacyUse('sales','sales-task');
 assert.equal(x.win.lastPage,'sales-daily');
 assert.match(x.storage.salesDailyTodoDraft,/sales-task/);
});
test('quarter reporting handles December without invalid month 13',async()=>{
 const x=fixture();await x.bridge.load('2026-11-19');
 const result=await x.bridge.loadPeriod({year:'2026',quarter:'4',month:'All'});
 assert.equal(result.loaded,3);
 assert.equal(x.bridge.S.salesCoverage.some(r=>r[0]==='2026-12-01'&&r[1]==='2026-12-31'),true);
});
