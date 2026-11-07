const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const todoSource=fs.readFileSync(path.join(__dirname,'..','sales-todo.js'),'utf8');
const pushSource=fs.readFileSync(path.join(__dirname,'..','push-notifications.js'),'utf8');
class TestDate extends Date {
 constructor(...args){super(...(args.length?args:['2026-11-07T02:00:00Z']))}
 static now(){return Date.parse('2026-11-07T02:00:00Z')}
}

function makeTodo(override={}){
 const list=[
  {id:'t1',title:'Old showroom task',assignee:'Sales One',dueDate:'2026-11-05',status:'Pending',progress:10},
  {id:'t2',title:'Customer follow-up',assignee:'Sales Two',dueDate:'2026-11-06',status:'In Progress',progress:50},
  {id:'t3',title:'Due today',assignee:'Sales One',dueDate:'2026-11-07',status:'Pending',progress:0},
  {id:'t4',title:'Finished item',assignee:'Sales Two',dueDate:'2026-11-01',status:'Completed',progress:100},
  {id:'t5',title:'Cancelled item',assignee:'Sales One',dueDate:'2026-11-02',status:'Cancelled',progress:0},
  {id:'t6',title:'Undated task',assignee:'Sales One',dueDate:'',status:'Pending',progress:0}
 ];
 const state={page:'dashboard',user:{id:'u1'},profile:{role:'manager'}};
 const calls=[],content={innerHTML:''},pageTitle={textContent:''},pageSubtitle={textContent:''};
 const document={
  activeElement:{id:''},
  getElementById:id=>({content,pageTitle,pageSubtitle}[id]||null),
  querySelectorAll:()=>[]
 };
 const db={functions:{invoke:async(_name,arg)=>{
  calls.push({account:state.user.id,action:arg.body.action});
  if(arg.body.action!=='todo_list')throw Error('Unexpected operation');
  return{data:{ok:true,data:{items:state.user.id==='u1'?list:[],people:[],todoAuditVersion:'field-revisions-20261107'}}};
 }}};
 const window={state,db,navItems:()=>[],go:async page=>{state.page=page}};
 const ctx={window,state,db,document,console,Date:TestDate,Intl,Math,Number,String,JSON,
  crypto:{randomUUID:()=> 'uuid'},renderNav:()=>{},showToast:()=>{},
  sessionStorage:{getItem:()=>null,removeItem(){},setItem(){}},setTimeout,clearTimeout};
 vm.createContext(ctx);vm.runInContext(todoSource,ctx);
 return {window,state,calls,content,list};
}

test('counts overdue pending and in-progress tasks only, with Cambodia-local due dates',async()=>{
 const h=makeTodo();
 const r=await h.window.getSalesTodoAttention();
 assert.equal(r.count,2);
 assert.equal(r.overdueCount,2);
 assert.deepEqual(Array.from(r.items.map(x=>x.id)),['t1','t2']);
 assert.equal(r.items[0].daysOverdue,2);
 assert.equal(r.items[1].daysOverdue,1);
 assert.equal(h.calls.length,1);
 const again=await h.window.getSalesTodoAttention();
 assert.equal(again.count,2);
 assert.equal(h.calls.length,1,'same-account bell polls should reuse recently fetched data');
});

test('overdue bell opens the Overdue filter without showing completed tasks',async()=>{
 const h=makeTodo();
 await h.window.openSalesTodoOverdue();
 assert.equal(h.state.page,'sales-todo');
 assert.match(h.content.innerHTML,/<option selected>Overdue<\/option>/);
 assert.match(h.content.innerHTML,/2 overdue Sales To-Do tasks/);
 assert.match(h.content.innerHTML,/View overdue tasks/);
 assert.equal(h.content.innerHTML.includes('Finished item'),false);
});

test('changing logged-in identity invalidates the cached overdue count',async()=>{
 const h=makeTodo();
 assert.equal((await h.window.getSalesTodoAttention()).count,2);
 h.state.user.id='u2';
 assert.equal((await h.window.getSalesTodoAttention()).count,0);
 assert.equal(h.calls.length,2);
});

test('unauthorized roles do not query sales tasks or receive their counts',async()=>{
 const h=makeTodo();
 h.state.profile.role='accountant';
 assert.equal((await h.window.getSalesTodoAttention()).count,0);
 assert.equal(h.calls.length,0);
});

function makeNotifications({base=1,daily=1,overdue=2}={}){
 const state={user:{id:'u1'},profile:{role:'sales'}},modals=[],routes=[];
 const db={rpc:async()=>({data:{count:base,target:'dashboard',body:'Other items'},error:null})};
 const window={state,db,
  getSalesDailyApprovalQueue:async()=>[],
  getSalesDailyAttention:async()=>({count:daily,missingCount:0,unfinishedCount:daily,target:'sales-daily'}),
  getSalesTodoAttention:async()=>({count:overdue,overdueCount:overdue,target:'sales-todo',items:overdue?[{
   id:'t1',title:'Task <unsafe>',assignee:'Koem Nalis',dueDate:'2026-11-05',daysOverdue:2
  }]:[]}),
  openSalesTodoOverdue:async()=>{routes.push('overdue')},
  addEventListener:()=>{}
 };
 const badge={innerHTML:'',title:'',classList:{toggle(){}}};
 const document={getElementById:id=>id==='appNotificationBtn'?badge:null,querySelector:()=>null,addEventListener:()=>{}};
 const navigator={};
 const ctx={window,state,db,document,navigator,console,setTimeout:()=>0,clearTimeout:()=>{},
  setInterval:()=>0,clearInterval:()=>{},openModal:(title,html)=>modals.push({title,html}),
  closeModal:()=>routes.push('close'),showToast:()=>{},location:{search:''}};
 vm.createContext(ctx);vm.runInContext(pushSource,ctx);
 return{window,modals,routes,badge};
}

test('in-app notification center includes overdue To-Do and keeps other actions accessible',async()=>{
 const h=makeNotifications();
 await h.window.refreshAppNotifications();
 await h.window.openAppNotifications();
 assert.equal(h.modals.at(-1).title,'Notifications');
 const html=h.modals.at(-1).html;
 assert.match(html,/Overdue Sales To-Do/);
 assert.match(html,/Unfinished Daily Plan tasks/);
 assert.match(html,/Other app action items/);
 assert.doesNotMatch(html,/<unsafe>/,'task names from Sheets must be HTML-escaped');
 await h.window.openAppNotificationSection(0);
 assert.ok(h.routes.includes('overdue'));
});

test('when overdue is the only category, bell opens overdue list directly',async()=>{
 const h=makeNotifications({base:0,daily:0,overdue:1});
 await h.window.openAppNotifications();
 assert.ok(h.routes.includes('overdue'));
 assert.equal(h.modals.length,0);
});


test('notification bell badge includes overdue counts alongside existing categories',async()=>{
 const h=makeNotifications({base:1,daily:1,overdue:2});
 await h.window.refreshAppNotifications();
 assert.match(h.badge.innerHTML,/>4<\/span>/);
 assert.match(h.badge.title,/2 overdue Sales To-Do tasks/);
 assert.match(h.badge.title,/1 unfinished sales task/);
});
