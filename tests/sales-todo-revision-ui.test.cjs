const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const script=fs.readFileSync(path.join(__dirname,'..','sales-todo.js'),'utf8');

function harness({auditReady=true}={}){
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
 const db={functions:{invoke:async (name,body)=>{
  calls.push(body.body);
  const action=body.body.action;
  if(action==='todo_list')return{data:{ok:true,data:{items,people:[],today:'2026-11-07',
    todoAuditVersion:data.auditVersion}}};
  if(action==='todo_history')return{data:{ok:true,data:{events,
   summary:{total:2,created:0,updates:2,progressIncreases:1,progressDecreases:0,
    deadlineRevisions:0,descriptionRevisions:0,otherDetailEdits:0,
    statusChanges:0,noChangeSaves:0,legacyUnverified:1}}}};
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
 return{win,state,fields,content,modals,messages,calls,items};
}
test('timeline renders Cambodia local time, truthful legacy warning and progress comparison',async()=>{
 const h=harness();
 await h.win.openSalesTodoHistory('todo-1');
 const html=h.modals.at(-1).html;
 assert.match(html,/Task Revision/);
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
