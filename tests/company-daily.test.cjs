const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const code=fs.readFileSync(require('node:path').join(__dirname,'../google-apps-script/sales-daily-plan/CompanyDaily.gs'),'utf8');
function setup(){
 let uid=0;const map=new Map();
 class Sheet{
  constructor(){this.rows=[]}
  appendRow(row){this.rows.push([...row]);return this}
  getDataRange(){return {getDisplayValues:()=>this.rows.map(r=>r.map(v=>String(v??'')))}}
  getRange(n,c,h,w){return {setValues:data=>{for(let i=0;i<h;i++){const row=this.rows[n-1+i];for(let j=0;j<w;j++)row[c-1+j]=data[i][j]}}}}
 }
 const ctx={Utilities:{getUuid:()=>String(++uid)},LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},SpreadsheetApp:{flush(){}},Date,JSON};
 vm.createContext(ctx);vm.runInContext(code,ctx);
 const ss={getSheetByName:n=>map.get(n)||null,insertSheet:n=>{const sh=new Sheet();map.set(n,sh);return sh}};
 const staff=[{id:'sales',name:'Salesperson',department:'Sales'},{id:'project',name:'Designer',department:'Project'},{id:'pm',name:'Project Manager',department:'Project'}];
 const actor=(id,department,can_review=false)=>({user_id:id,name:id,department,can_review,all_departments:false,staff});
 return {call:(a,action,p)=>ctx.companyDispatch(ss,a,action,p),staff,sales:actor('sales','Sales'),project:actor('project','Project'),pm:actor('pm','Project',true)};
}
test('cross-department request requires receiving manager approval',()=>{
 const x=setup();
 const task=x.call(x.sales,'company_save_task',{title:'Villa mock-up',assigneeId:'project',category:'Mock-up'});
 assert.equal(task.requestStatus,'Pending Approval');
 assert.equal(x.call(x.project,'company_list',{}).tasks.length,0);
 assert.throws(()=>x.call(x.sales,'company_decide_request',{id:task.id,decision:'Approve'}),/approval required/);
 x.call(x.pm,'company_decide_request',{id:task.id,decision:'Approve'});
 assert.equal(x.call(x.project,'company_list',{}).tasks.length,1);
});
test('morning, evening, task completion, manager review',()=>{
 const x=setup();
 const task=x.call(x.project,'company_save_task',{title:'Proposal',assigneeId:'project',category:'Proposal'});
 const am=x.call(x.project,'company_submit_am',{date:'2026-11-19',taskIds:[task.id]});
 assert.equal(am.amStatus,'Submitted');
 const pm=x.call(x.project,'company_submit_pm',{date:'2026-11-19',results:[{id:task.id,status:'Completed',result:'Proposal delivered'}]});
 assert.equal(pm.pmStatus,'Submitted');
 assert.equal(x.call(x.project,'company_list',{}).tasks[0].status,'Completed');
 const review=x.call(x.pm,'company_review',{id:am.id,status:'Reviewed',comment:'Approved'});
 assert.equal(review.reviewStatus,'Reviewed');
 assert.throws(()=>x.call(x.project,'company_review',{id:am.id,status:'Reviewed'}),/review denied/i);
});
