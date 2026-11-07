const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','sales-todo.js'),'utf8');

function harness({auditReady=true,deferHistory=false,historyEvents=null,historySummary=null}={}){
 const content={innerHTML:''},fields={},modals=[],messages=[],calls=[];
 const items=[{
  id:'todo-1',title:'Mockup showroom display',description:'Initial showroom display proposal',
  assigneeId:'sale-1',assignee:'Koem Nalis',startDate:'2026-11-04',dueDate:'2026-11-07',
  priority:'High',status:'In Progress',progress:50,remarks:'Waiting for new option',
  updatedAt:'2026-11-07T01:32:47Z'
 }];
 const events=[
 {timestamp:'2026-11-07T01:32:47.769Z',actor:'Koem Nalis',status:'In Progress',
  progress:50,remarks:'',previousStatus:'In Progress',previousProgress:50,
  historyVersion:'legacy',type:'updated',changes:[],fieldsComplete:false},
 {timestamp:'2026-11-06T10:28:29.634Z',actor:'Koem Nalis',status:'In Progress',
  progress:50,previousStatus:'In Progress',previousProgress:30,
  historyVersion:'legacy',type:'updated',
  changes:[{field:'progress',before:30,after:50}],fieldsComplete:false}
 ];
 const state={page:'sales-todo',user:{id:'sale-1'},profile:{role:'sales',name:'Koem Nalis'}};
 const document={
  activeElement:{id:''},
  getElementById:id=>id==='content'?content:fields[id]||null,
  querySelectorAll:()=>[]
 };
 const data={auditVersion: auditReady?'field-revisions-20261107':undefined};
 let finishHistory=null;
 const db={functions:{invoke:async (name,body)=>{
  calls.push(body.body);
  const action=body.body.action;
  if(action==='todo_list')return{data:{ok:true,data:{items,people:[],today:'2026-11-07',
    todoAuditVersion:data.auditVersion}}};
  if(action==='todo_history'){
   const reply={data:{ok:true,data:{events:historyEvents||events,
    auditRecoveredCount:historyEvents?historyEvents.length:0,
    summary:historySummary||{total:2,created:0,updates:2,progressIncreases:1,progressDecreases:0,
     startDateRevisions:0,deadlineRevisions:0,descriptionRevisions:0,otherDetailEdits:0,
     statusChanges:0,noChangeSaves:0,legacyUnverified:1}}}};
   if(deferHistory)return await new Promise(resolve=>{finishHistory=()=>resolve(reply)});
   return reply;
  }
  if(action==='todo_save')return{data:{ok:true,data:{saved:true}}};
  throw Error('Unexpected action '+action);
 }}};
 const win={navItems:()=>[],go:async()=>{}};
 const ctx={window:win,state,document,db,
  openModal:(title,html)=>modals.push({title,html}),
  closeModal:()=>{},showToast:(text)=>messages.push(text),
  sessionStorage:{getItem:()=>null,setItem(){},removeItem(){}},
  renderNav:()=>{},crypto:{randomUUID:()=> 'todo-uuid'},
  setTimeout:()=>1,clearTimeout:()=>{},Date,Intl,console};
 vm.createContext(ctx);vm.runInContext(script,ctx);
 return{win,state,fields,content,modals,messages,calls,items,finishHistory:()=>finishHistory?.()};
}
test('timeline renders Cambodia local time, truthful legacy warning and progress comparison',async()=>{
 const h=harness();
 await h.win.openSalesTodoHistory('todo-1');
 const html=h.modals.at(-1).html;
 assert.match(h.modals.at(-1).title,/Task Revision/);
 assert.match(html,/Cambodia/);
 assert.match(html,/8:32/);
 assert.match(html,/30%/);assert.match(html,/50%/);
 assert.match(html,/Older entries only saved status and percentage/);
 assert.match(html,/Older entries not fully verifiable/);
 assert.match(html,/Progress increases/);
 assert.match(html,/Progress and status did not change/);
});
test('edit form requires explanation when deadline or description changes',async()=>{
 const h=harness();
 await h.win.loadSalesTodo(true);
 h.win.openSalesTodo('todo-1');
 assert.match(h.modals.at(-1).html,/todoRevisionReasonPanel/);
 assert.match(h.modals.at(-1).html,/updateTodoRevisionHint/);
 for(const [key,val] of Object.entries({
  title:'Mockup showroom display',startDate:'2026-11-04',dueDate:'2026-11-08',
  assigneeId:'sale-1',priority:'High',status:'In Progress',progress:'50',
  description:'Initial showroom display proposal',remarks:'Waiting for new option',
  revisionReason:''
 }))h.fields['todo_'+key]={value:val};
 await h.win.saveSalesTodo('todo-1');
 assert.ok(h.messages.some(x=>/Explain why you revised/.test(x)));
 assert.equal(h.calls.filter(x=>x.action==='todo_save').length,0);
 h.fields.todo_revisionReason.value='Need another supplier sample';
 await h.win.saveSalesTodo('todo-1');
 const saved=h.calls.find(x=>x.action==='todo_save');
 assert.equal(saved.payload.revisionReason,'Need another supplier sample');
 assert.equal(saved.payload.expectedUpdatedAt,'2026-11-07T01:32:47Z');
});
test('stale Apps Script deployment blocks unaudited deadline edits but keeps progress updates available',async()=>{
 const h=harness({auditReady:false});
 await h.win.loadSalesTodo(true);
 h.win.openSalesTodo('todo-1');
 for(const [key,val] of Object.entries({
  title:'Mockup showroom display',startDate:'2026-11-04',dueDate:'2026-11-09',
  assigneeId:'sale-1',priority:'High',status:'In Progress',progress:'50',
  description:'Initial showroom display proposal',remarks:'Waiting',
  revisionReason:'Confirmed revised deadline'
 }))h.fields['todo_'+key]={value:val};
 await h.win.saveSalesTodo('todo-1');
 assert.ok(h.messages.some(x=>/Redeploy the updated Google Apps Script/.test(x)));
 assert.equal(h.calls.filter(x=>x.action==='todo_save').length,0);
 assert.match(h.content.innerHTML,/Advanced To-Do revision history requires/);
});


test('history modal opens immediately, then reused result avoids another slow network call',async()=>{
 const h=harness({deferHistory:true});
 const loading=h.win.openSalesTodoHistory('todo-1');
 assert.match(h.modals.at(-1).html,/Loading verified task history/);
 assert.equal(h.calls.filter(c=>c.action==='todo_history').length,1);
 h.finishHistory();
 await loading;
 assert.match(h.modals.at(-1).html,/Progress increases/);
 await h.win.openSalesTodoHistory('todo-1');
 assert.equal(h.calls.filter(c=>c.action==='todo_history').length,1);
});

test('audit-recovered legacy history shows original dates and both schedule revisions',async()=>{
 const events=[
  {type:'updated',historyVersion:'audit-recovered',fieldsComplete:true,actor:'Koem Nalis',
   timestamp:'2026-11-07T01:32:47Z',changes:[{field:'dueDate',before:'2026-11-06',after:'2026-11-07'}]},
  {type:'updated',historyVersion:'audit-recovered',fieldsComplete:true,actor:'Koem Nalis',
   timestamp:'2026-11-05T01:24:32Z',changes:[{field:'startDate',before:'2026-11-04',after:'2026-11-06'}]},
  {type:'created',historyVersion:'audit-recovered',fieldsComplete:true,actor:'Koem Nalis',
   timestamp:'2026-11-04T01:25:18Z',status:'In Progress',progress:0,changes:[],
   after:{startDate:'2026-11-04',dueDate:'2026-11-06'}}
 ];
 const h=harness({historyEvents:events,historySummary:{
  total:3,created:1,updates:2,progressIncreases:0,progressDecreases:0,startDateRevisions:1,
  deadlineRevisions:1,descriptionRevisions:0,otherDetailEdits:1,statusChanges:0,
  noChangeSaves:0,legacyUnverified:0
 }});
 await h.win.openSalesTodoHistory('todo-1');
 const html=h.modals.at(-1).html;
 assert.match(html,/Original start date/);
 assert.match(html,/4 Nov 2026/);
 assert.match(html,/Start date revised/);
 assert.match(html,/6 Nov 2026/);
 assert.match(html,/Deadline revised/);
 assert.match(html,/7 Nov 2026/);
 assert.match(html,/Earlier date and task changes verified/);
 assert.doesNotMatch(html,/Historical limitation:/);
});
