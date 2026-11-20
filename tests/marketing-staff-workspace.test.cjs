'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const source=fs.readFileSync(path.join(__dirname,'../marketing-management.js'),'utf8');
const staffId='9a5db4b1-9dbf-4d94-aa2f-89e7a5df8f89';
const taskId=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const date='2026-11-20';

function fixture({role='admin',connected=false}={}){
 const tasks=Array.from({length:48},(_,i)=>({
  id:taskId(i+1),title:'Marketing Task '+(i+1),business:i%2?'LPL':'LPH',
  status:'Not Started',priority:'Medium',progress:0,created_by:'different-user',
  start_date:'',due_date:'',post_date:i<5?date:'',
  assignee_id:connected&&i<3?staffId:'',
  assignee_name:connected&&i<3?'Marketing Staff':''
 }));
 const people=connected?[{id:staffId,name:'Marketing Staff',role:'marketing',active:true}]:[];
 const daily=connected?[{
  id:'report-1',user_id:staffId,user_name:'Marketing Staff',work_date:date,
  plan_json:JSON.stringify([taskId(1)]),
  result_json:JSON.stringify({
   version:2,note:'Finished the design',task_ids:[taskId(1)],
   task_results:[{id:taskId(1),status:'Completed',note:'Poster approved'}]
  }),
  am_submitted_at:date+'T01:00:00Z',pm_submitted_at:date+'T09:00:00Z'
 }]:[];
 const els=new Map(),element=id=>{
  if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',value:''});
  return els.get(id);
 };
 const state={page:'home',profile:{role},user:{id:staffId}};
 const calls=[];
 const ctx={window:{},document:{getElementById:element,querySelectorAll:()=>[]},state,
  db:{
   functions:{invoke:async(name,{body})=>{
    calls.push(body.action);
    return {data:{ok:true,data:{tasks,daily,daily_report_version:2}}};
   }},
   rpc:async name=>({data:name==='get_marketing_staff'?people:{configured:true},error:null})
  },
  renderNav:()=>{},showToast:()=>{},openModal:()=>{},closeModal:()=>{},
  esc:x=>String(x||''),Intl,Date,Map,Set,JSON,Promise,Number,String,Array,Math,FormData:Object,Object,console};
 ctx.window.navItems=()=>[['dashboard','Dashboard']];
 ctx.window.go=async()=>{};
 vm.createContext(ctx);
 vm.runInContext(source,ctx,{filename:'marketing-management.js'});
 return {
  window:ctx.window,
  calls,
  html:()=>element('content').innerHTML
 };
}

test('marketing workspace separates staff activity, planning backlog and publishing calendar with no accounts',async()=>{
 const app=fixture();
 await app.window.go('marketing');
 app.window.marketingDate(date);
 assert.match(app.html(),/Marketing Team Daily Review/);
 assert.match(app.html(),/Marketing accounts are not connected yet/);
 for(const tab of ['Daily Plan & Result','Staff To-Do','Schedule','Content Calendar','Reports','Reviews']){
  assert.ok(app.html().includes(tab),tab+' tab visible');
 }
 app.window.marketingTab('Staff To-Do');
 assert.match(app.html(),/48 tasks are in the Marketing planning backlog/);
 assert.match(app.html(),/Unassigned Planning/);
 assert.match(app.html(),/Overdue assigned<\/p><b class="block text-2xl mt-1">0<\/b>/);
 assert.match(app.html(),/48 matching task\(s\)/);
 app.window.marketingTab('Schedule');
 assert.match(app.html(),/Marketing Work Schedule/);
 assert.match(app.html(),/No Work Dates/);
 assert.match(app.html(),/48 tasks/);
 app.window.marketingTab('Content Calendar');
 assert.match(app.html(),/Content publishing month/);
 app.window.marketingTab('Reports');
 assert.match(app.html(),/Marketing Team Reports/);
 assert.match(app.html(),/Staff setup pending/);
 assert.equal(app.calls.filter(x=>x!=='list').length,0,'read-only navigation must not modify Google Sheet records');
});

test('manager reviews actual submitted staff daily outcomes and accurate separate To-Do ownership',async()=>{
 const app=fixture({connected:true});
 await app.window.go('marketing');
 app.window.marketingDate(date);
 const daily=app.html();
 assert.match(daily,/Marketing Team Daily Review/);
 assert.match(daily,/AM Submitted/);
 assert.match(daily,/PM Submitted/);
 assert.match(daily,/Poster approved/);
 assert.match(daily,/Finished the design/);
 app.window.marketingTab('Staff To-Do');
 assert.match(app.html(),/45 tasks are in the Marketing planning backlog/);
 assert.match(app.html(),/3 matching task\(s\)/);
 app.window.marketingTodoOwner('unassigned');
 assert.match(app.html(),/45 matching task\(s\)/);
 app.window.marketingTab('Reports');
 app.window.marketingReportFilter('year','2026');
 app.window.marketingReportFilter('month','11');
 assert.match(app.html(),/Marketing Team Reports/);
 assert.match(app.html(),/Completed daily outcomes/);
 assert.match(app.html(),/Completed Daily Results/);
 app.window.marketingReportOpenDay(date,staffId);
 assert.match(app.html(),/Marketing Team Daily Review/);
 assert.match(app.html(),/Poster approved/);
});

test('marketing staff can still submit personal reports, but cannot access manager reports',async()=>{
 const app=fixture({role:'marketing',connected:true});
 await app.window.go('marketing');
 app.window.marketingDate(date);
 assert.match(app.html(),/Daily Plan & Evening Result/);
 assert.doesNotMatch(app.html(),/marketingTab\('Reports'\)/);
 app.window.marketingTab('My To-Do'); // backward-compatible link from older pages
 assert.match(app.html(),/Marketing To-Do List/);
 assert.match(app.html(),/Marketing Task 1/);
 app.window.marketingTab('Schedule');
 assert.match(app.html(),/Marketing Work Schedule/);
});
