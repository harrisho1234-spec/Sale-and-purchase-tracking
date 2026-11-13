'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const front=fs.readFileSync('marketing-management.js','utf8');
const backend=fs.readFileSync('google-apps-script/marketing-management/Code.gs','utf8');
const owner='9a5db4b1-9dbf-4d94-aa2f-89e7a5df8f89';
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const allTasks=[
 {id:uuid(1),title:'Water Festival poster',business:'LPL',post_date:'2026-11-13',category:'Artwork / Poster',
  status:'In Progress',approval_status:'Pending',progress:30,assignee_id:owner},
 {id:uuid(2),title:'LP Home video',business:'LPH',post_date:'2026-11-14',category:'Video',
  status:'Not Started',approval_status:'Not Submitted',progress:0,assignee_id:owner},
 {id:uuid(3),title:'Unplanned design support',business:'LPL',post_date:'2026-11-20',category:'Other',
  status:'In Progress',approval_status:'Not Submitted',progress:10,assignee_id:owner},
 {id:uuid(4),title:'Someone else post',business:'LPH',post_date:'2026-11-13',
  status:'In Progress',assignee_id:'another-user'}
];
const day={
 id:uuid(99),user_id:owner,user_name:'Marketing staff',work_date:'2026-11-13',
 plan_json:JSON.stringify([uuid(1),uuid(2)]),result_json:'{}',
 am_submitted_at:'2026-11-13T01:00:00.000Z',pm_submitted_at:''
};
function make(options={}){
 const elements=new Map(),modals=[],requests=[],toasts=[];
 const get=id=>{
  if(!elements.has(id))elements.set(id,{innerHTML:'',textContent:'',value:'',selectionStart:0,focus(){},setSelectionRange(){}});
  return elements.get(id);
 };
 get('mktEveningNotes').value='Overall report summary';
 const list=options.daily===false?[]:[day];
 const dom={
   getElementById:get,
   querySelectorAll:selector=>{
    if(selector==='.mkt-daily-result-row')return [uuid(1),uuid(2)].map((id,i)=>({
     dataset:{taskId:id},
     querySelector:q=>({value:q.includes('status')?i===0?'Completed':'Partially Completed':i===0?'Artwork finished':'Video editing in progress'})
    }));
    if(selector==='.mkt-daily-task:checked')return [{value:uuid(1)},{value:uuid(2)}];
    return [];
   }
 };
 const ctx={
  window:{},document:dom,
  state:{page:'',profile:{role:options.role||'marketing',display_name:'Marketing staff'},user:{id:owner}},
  db:{
    functions:{invoke:async(name,{body})=>{
      requests.push(body);
      if(body.action==='list')return {data:{ok:true,data:{tasks:allTasks,daily:list,daily_report_version:options.backendVersion??2}}};
      return {data:{ok:true,data:{}}};
    }},
    rpc:async name=>({data:name==='get_marketing_staff'?[]:{configured:true},error:null})
  },
  esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])),
  openModal:(title,body)=>modals.push({title,body}),
  closeModal:()=>{},
  renderNav:()=>{},
  showToast:(msg,type)=>toasts.push({msg,type}),
  Intl,Date,Map,Set,JSON,Promise,Number,String,Array,Math,FormData:Object,Object,console
 };
 ctx.window.navItems=()=>[];
 ctx.window.go=async()=>{};
 vm.createContext(ctx);
 vm.runInContext(front,ctx,{filename:'marketing-management.js'});
 return {ctx,get,modals,requests,toasts,html:()=>get('content').innerHTML};
}
test('Morning Plan groups assigned tasks and opens the original Content Calendar entries',async()=>{
 const m=make({daily:false});await m.ctx.window.go('marketing');
 m.ctx.window.marketingTab('Daily Plan & Result');
 m.ctx.window.marketingDate('2026-11-13');
 assert.match(m.html(),/Select from Content Calendar/);
 assert.match(m.html(),/Morning Plan/);
 assert.match(m.html(),/L&#39;Imperial Luxury|L.Imperial Luxury/);
 assert.match(m.html(),/LP Home/);
 assert.match(m.html(),/Water Festival poster/);
 m.ctx.window.openMarketingDailyCalendarSelector();
 const popup=m.modals.at(-1).body;
 assert.match(popup,/Water Festival poster/);
 assert.match(popup,/LP Home video/);
 assert.doesNotMatch(popup,/Someone else post/);
 m.ctx.window.marketingDailyAddCalendarTask(uuid(1));
 assert.match(m.html(),/value="00000000-0000-4000-8000-000000000001" checked/);
 m.ctx.window.marketingDailyOpenCalendar(uuid(1));
 assert.match(m.html(),/Content Calendar/);
 assert.match(m.modals.at(-1).title,/Scheduled Content/);
 assert.match(m.modals.at(-1).title,/Water Festival poster/);
});
test('Evening Result has a status and remark per Morning Plan task and links back to calendar',async()=>{
 const m=make();await m.ctx.window.go('marketing');m.ctx.window.marketingTab('Daily Plan & Result');m.ctx.window.marketingDate('2026-11-13');
 const x=m.html();
 assert.match(x,/Evening Result/);
 assert.match(x,/Today's Result/);
 assert.match(x,/Remark \/ Outcome/);
 assert.match(x,/Partially Completed/);
 assert.match(x,/marketingDailyOpenCalendar/);
 assert.match(x,/Additional \/ Unplanned Work/);
 assert.equal((x.match(/class="mkt-daily-result-row/g)||[]).length,2);
 m.ctx.window.openMarketingDailyUnplanned();
 assert.match(m.modals.at(-1).body,/Unplanned design support/);
 m.ctx.window.marketingDailyAttachUnplanned(uuid(3));
 assert.match(m.html(),/Unplanned design support/);
});
test('PM submission saves per-task outcome and remarks with planned task IDs, not duplicated To-Do records',async()=>{
 const m=make();await m.ctx.window.go('marketing');m.ctx.window.marketingTab('Daily Plan & Result');
 m.ctx.window.marketingDate('2026-11-13');
 await m.ctx.window.submitMarketingDaily('pm');
 const req=m.requests.filter(x=>x.action==='daily_save').at(-1);
 assert.ok(req,'daily_save was invoked');
 assert.equal(req.payload.report_version,2);
 assert.deepEqual(Array.from(req.payload.task_ids),[uuid(1),uuid(2)]);
 assert.deepEqual(Array.from(req.payload.task_results,x=>x.status),['Completed','Partially Completed']);
 assert.deepEqual(Array.from(req.payload.task_results,x=>x.note),['Artwork finished','Video editing in progress']);
 assert.equal(req.payload.note,'Overall report summary');
 assert.equal(m.requests.some(x=>x.action==='save_task'||x.action==='update_task'),false);
});
test('older Apps Script keeps legacy summary-only reports working without losing unsaved task results',async()=>{
 const m=make({backendVersion:1});await m.ctx.window.go('marketing');m.ctx.window.marketingTab('Daily Plan & Result');
 m.ctx.window.marketingDate('2026-11-13');
 assert.match(m.html(),/original summary-only format/);
 assert.match(m.html(),/Submit Summary Only/);
 assert.doesNotMatch(m.html(),/mkt-daily-result-row/);
 await m.ctx.window.submitMarketingDaily('pm');
 const req=m.requests.filter(x=>x.action==='daily_save').at(-1);
 assert.ok(req,'old backend still accepts the original summary');
 assert.equal(req.payload.note,'Overall report summary');
 assert.equal(req.payload.report_version,undefined);
 assert.equal(req.payload.task_results,undefined);
 assert.deepEqual(Array.from(req.payload.task_ids),[uuid(1),uuid(2)]);
 assert.match(m.toasts.at(-1).msg,/Summary-only Evening Result saved/);
});
test('Marketing manager team review shows planned and additional results separately',async()=>{
 const completed={...day,result_json:JSON.stringify({
  version:2,note:'All goals reviewed',task_ids:[uuid(1),uuid(2),uuid(3)],
  task_results:[
   {id:uuid(1),status:'Completed',note:'Poster approved'},
   {id:uuid(2),status:'Pending',note:'Editing blocked'},
   {id:uuid(3),status:'Partially Completed',note:'Support provided'}
  ]
 }),pm_submitted_at:'2026-11-13T10:00:00.000Z'};
 const m=make({role:'marketing_manager'});await m.ctx.window.go('marketing');
 // Replace mocked daily data after initial load through subsequent list calls.
 m.ctx.db.functions.invoke=async(name,{body})=>{
  if(body.action==='list')return {data:{ok:true,data:{tasks:allTasks,daily:[completed],daily_report_version:2}}};
  return {data:{ok:true,data:{}}};
 };
 await m.ctx.window.refreshMarketing();
 m.ctx.window.marketingTab('Daily Plan & Result');m.ctx.window.marketingDate('2026-11-13');
 m.ctx.window.marketingDailyView('Team Review');
 assert.match(m.html(),/Marketing Team Daily Review/);
 assert.match(m.html(),/Poster approved/);
 assert.match(m.html(),/Editing blocked/);
 assert.match(m.html(),/Additional \/ Unplanned Work/);
 assert.match(m.html(),/Support provided/);
});
test('Apps Script persists daily task result JSON in existing Daily sheet and rejects invalid data',()=>{
 const context={console,Date,JSON,Set,Number,String,Array,Object,Math};
 vm.createContext(context);
 vm.runInContext(backend,context,{filename:'Code.gs'});
 let saved=null;
 const rows=[{...day,_row:2}];
 context.mktSheet=name=>({name,getLastRow:()=>2});
 context.mktRows=sh=>sh.name==='Tasks'?allTasks:rows;
 context.mktWrite=(sh,r,headers,obj)=>{saved=obj;rows[0]={...obj,_row:2};};
 context.mktLog=()=>{};
 context.mktNow=()=> '2026-11-13T10:00:00.000Z';
 context.Utilities={getUuid:()=>uuid(100)};
 const payload={
  date:'2026-11-13',phase:'pm',report_version:2,task_ids:[uuid(1),uuid(2)],
  task_results:[
   {id:uuid(1),status:'Completed',note:'Poster completed'},
   {id:uuid(2),status:'Pending',note:'Awaiting revision'}
  ],
  note:'Summary'
 };
 const user={id:owner,name:'Marketing Staff'};
 const result=context.mktDailySave(payload,user);
 assert.ok(saved);
 assert.equal(JSON.parse(result.result_json).version,2);
 assert.equal(JSON.parse(result.result_json).task_results[1].note,'Awaiting revision');
 assert.equal(JSON.parse(result.plan_json)[0],uuid(1));
 assert.equal(result.pm_submitted_at,'2026-11-13T10:00:00.000Z');
 assert.throws(()=>context.mktDailySave({...payload,task_results:[payload.task_results[0]]},user),/Every reported task/);
 assert.throws(()=>context.mktDailySave({...payload,task_results:[
  {id:uuid(1),status:'Published',note:'Skip approval'},payload.task_results[1]
 ]},user),/valid result status/);
 assert.throws(()=>context.mktDailySave({...payload,task_results:[
  {id:uuid(1),status:'Completed',note:''},payload.task_results[1]
 ]},user),/valid result status/);
});
