const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const backendSource=fs.readFileSync(path.join(__dirname,'..','google-apps-script','sales-daily-plan','Code.gs'),'utf8');
const frontendSource=fs.readFileSync(path.join(__dirname,'..','sales-todo.js'),'utf8');

function backend(){
 const api={Date,JSON,Math,Intl,Number,String,console,
  LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},
  SpreadsheetApp:{flush(){}},Utilities:{getUuid:()=>'todo-test-created'}};
 vm.createContext(api);
 vm.runInContext(backendSource,api);
 return api;
}
function makeSheet(header,rows=[]){
 const sheet={
  rows:[header,...rows.map(r=>r.slice())],
  getLastColumn(){return this.rows[0].length},
  getDataRange(){return{getDisplayValues:()=>this.rows.map(r=>r.map(x=>x==null?'':String(x)))}},
  getRange(row,col,nRows,nCols){return{setValues:values=>{
   for(let i=0;i<nRows;i++){const original=sheet.rows[row-1+i]||[];
    for(let j=0;j<nCols;j++)original[col-1+j]=values[i][j];
    sheet.rows[row-1+i]=original;}
  }}},
  appendRow(row){this.rows.push(row.slice())}
 };
 return sheet;
}
const taskHeader=['ID','Title','Description','Assignee ID','Assignee Name','Start Date','Due Date',
 'Priority','Status','Progress','Remarks','Completed At','Created By','Created At','Updated At'];
const oldHistoryHeader=['Task ID','Time','Actor ID','Actor Name','Status','Progress','Remarks',
 'Previous Status','Previous Progress'];
function contextWithTask(){
 const b=backend();
 const previous=['task-1','Make showroom mockup','Initial display details','sale-1','Koem Nalis',
  '2026-11-04','2026-11-07','High','In Progress',50,'Working','',
  'sale-1','2026-11-04T01:25:00Z','2026-11-07T01:32:47Z'];
 const tasks=makeSheet(taskHeader,[previous]),history=makeSheet(oldHistoryHeader,[
 ['task-1','2026-11-04T01:25:00Z','sale-1','Koem Nalis','In Progress',0,'','',''],
 ['task-1','2026-11-04T10:29:10Z','sale-1','Koem Nalis','In Progress',15,'','In Progress',0],
 ['task-1','2026-11-05T01:24:32Z','sale-1','Koem Nalis','In Progress',15,'','In Progress',15],
 ['task-1','2026-11-06T01:35:42Z','sale-1','Koem Nalis','In Progress',30,'','In Progress',15],
 ['task-1','2026-11-06T10:28:29Z','sale-1','Koem Nalis','In Progress',50,'','In Progress',30],
 ['task-1','2026-11-07T01:32:47Z','sale-1','Koem Nalis','In Progress',50,'','In Progress',50]
 ]);
 const sheetMap={'Sales To-Do':tasks,'Sales To-Do History':history,
  'Audit Log':makeSheet(['ID','Time','Actor ID','Report ID','Task ID','Action','Before','After'])};
 const ss={getSheetByName:name=>sheetMap[name],insertSheet:name=>{
  const sh=makeSheet([]);sheetMap[name]=sh;return sh;
 }};
 const actor={role:'sales',user_id:'sale-1',display_name:'Koem Nalis',can_write:true,
  can_review:false,sales_people:[{user_id:'sale-1',name:'Koem Nalis'}]};
 b.audit=()=>{};
 return{b,ss,actor,tasks,history,previous};
}
test('historic six entries show three increases and two unverifiable unchanged percentages',()=>{
 const {b,ss,actor}=contextWithTask();
 const result=b.todoHistory(ss,actor,{id:'task-1'});
 assert.equal(result.summary.total,6);
 assert.equal(result.summary.created,1);
 assert.equal(result.summary.updates,5);
 assert.equal(result.summary.progressIncreases,3);
 assert.equal(result.summary.progressDecreases,0);
 assert.equal(result.summary.noChangeSaves,0);
 assert.equal(result.summary.legacyUnverified,2);
 assert.equal(result.summary.deadlineRevisions,0);
 assert.equal(result.events[0].fieldsComplete,false);
 assert.equal(result.events[0].progress,50);
});
test('existing history header expands without deleting or rewriting old rows',()=>{
 const {b,ss,history}=contextWithTask();
 b.todoHistorySheet(ss);
 assert.equal(history.rows[0].length,14);
 assert.equal(history.rows.length,7);
 assert.equal(history.rows[0][9],'History Version');
 assert.equal(history.rows[1][5],0);
});
test('deadline and description changes require reason before any mutation',()=>{
 const {b,ss,actor,tasks,history}=contextWithTask();
 const before=tasks.rows[1].slice();
 assert.throws(()=>b.todoSave(ss,actor,{id:'task-1',dueDate:'2026-11-10',progress:50}),/reason/i);
 assert.throws(()=>b.todoSave(ss,actor,{id:'task-1',description:'Edited details',progress:50}),/reason/i);
 assert.deepEqual(tasks.rows[1],before);
 assert.equal(history.rows.length,7);
});
test('reasoned edits preserve before→after deadline, description, note, actor and original values',()=>{
 const {b,ss,actor,history,tasks}=contextWithTask();
 b.todoSave(ss,actor,{id:'task-1',dueDate:'2026-11-10',
  description:'New display concept with lighting',progress:65,remarks:'Work reviewed',
  revisionReason:'Awaiting new mockup options',expectedUpdatedAt:'2026-11-07T01:32:47Z'});
 const row=history.rows.at(-1),changed=JSON.parse(row[10]);
 assert.equal(row.length,14);assert.equal(row[9],'v2');
 assert.equal(row[11],'Awaiting new mockup options');
 assert.equal(row[3],'Koem Nalis');
 const due=changed.find(x=>x.field==='dueDate');
 assert.equal(due.before,'2026-11-07');assert.equal(due.after,'2026-11-10');
 const desc=changed.find(x=>x.field==='description');
 assert.equal(desc.before,'Initial display details');
 assert.equal(desc.after,'New display concept with lighting');
 assert.equal(tasks.rows[1][6],'2026-11-10');
 assert.equal(JSON.parse(row[12]).dueDate,'2026-11-07');
 assert.equal(JSON.parse(row[13]).progress,65);
 const h=b.todoHistory(ss,actor,{id:'task-1'});
 assert.equal(h.summary.deadlineRevisions,1);
 assert.equal(h.summary.descriptionRevisions,1);
 assert.equal(h.summary.progressIncreases,4);
 assert.equal(h.events[0].fieldsComplete,true);
});
test('exact no-change saves are not counted as progress increases',()=>{
 const {b,ss,actor}=contextWithTask();
 b.todoSave(ss,actor,{id:'task-1',status:'In Progress',progress:50});
 const history=b.todoHistory(ss,actor,{id:'task-1'});
 assert.equal(history.summary.progressIncreases,3);
 assert.equal(history.summary.noChangeSaves,1);
});
test('stale saves are rejected and cannot overwrite another revision',()=>{
 const {b,ss,actor,tasks,history}=contextWithTask();
 assert.throws(()=>b.todoSave(ss,actor,{id:'task-1',progress:60,
  expectedUpdatedAt:'2026-11-01T00:00:00Z'}),/changed since you opened/i);
 assert.equal(tasks.rows[1][9],50);
 assert.equal(history.rows.length,7);
});
test('task history access remains restricted to assigned salesperson or authorized management',()=>{
 const {b,ss,actor}=contextWithTask();
 const stranger={...actor,user_id:'sale-2'};
 assert.throws(()=>b.todoHistory(ss,stranger,{id:'task-1'}),/access denied/i);
 const manager={...actor,role:'manager',can_review:true,can_write:false,
  user_id:'manager-1',sales_people:[{user_id:'sale-2',name:'Other'}]};
 assert.throws(()=>b.todoHistory(ss,manager,{id:'task-1'}),/not authorized/i);
});
test('frontend uses Cambodia time, supports legacy rows and guards unsynced deadline edits',()=>{
 assert.match(frontendSource,/timeZone:'Asia\/Phnom_Penh'/);
 assert.match(frontendSource,/Older entries only saved status and percentage/);
 assert.match(frontendSource,/No tracked task fields changed/);
 assert.match(frontendSource,/todoAuditVersion==='field-revisions-20261107'/);
 assert.match(frontendSource,/!todoAuditReady/);
 assert.match(frontendSource,/todo_revisionReason/);
 assert.match(frontendSource,/updateTodoRevisionHint/);
 assert.match(frontendSource,/expectedUpdatedAt/);
 assert.match(backendSource,/todoAuditVersion:'field-revisions-20261107'/);
});
