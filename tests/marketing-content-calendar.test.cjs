'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const front=fs.readFileSync('marketing-management.js','utf8');
const backend=fs.readFileSync('google-apps-script/marketing-management/Code.gs','utf8');
const uuid=n=>'00000000-0000-4000-8000-'+String(n).padStart(12,'0');
const tasks=[
 {id:uuid(1),title:'Luxury chandelier launch',business:'LPL',brand:'Asfour',post_date:'2026-11-13',status:'In Progress',approval_status:'Pending',assignee_id:'owner',description:'Luxury campaign',platforms:'Instagram',campaign:'Holiday Collection'},
 {id:uuid(2),title:'Home sofa sale',business:'LPH',brand:'Furniture',post_date:'2026-11-13',status:'Approved',approval_status:'Approved',assignee_id:'owner',platforms:'Facebook'},
 {id:uuid(3),title:'Shared holiday announcement',business:'BOTH',post_date:'2026-11-20',status:'Not Started',approval_status:'Not Submitted',assignee_id:'owner'},
 {id:uuid(4),title:'Unassigned legacy post',business:'',post_date:'2026-11-21',status:'Not Started',assignee_id:'owner'},
 {id:uuid(5),title:'LP Home December content',business:'LPH',post_date:'2026-12-02',status:'Not Started',assignee_id:'owner'}
];
function make(role='marketing_manager'){
 const els=new Map(),modals=[];
 const get=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',value:''});return els.get(id);};
 const ctx={
  window:{},document:{getElementById:get,querySelectorAll:()=>[]},
  state:{profile:{role},user:{id:'owner'}},
  db:{functions:{invoke:async()=>({data:{ok:true,data:{tasks,daily:[]}}})},
      rpc:async name=>({data:name==='get_marketing_staff'?[]:{configured:true},error:null})},
  esc:s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])),
  showToast:()=>{},renderNav:()=>{},openModal:(title,body)=>modals.push({title,body}),closeModal:()=>{},
  Intl,Date,Map,Set,JSON,Promise,Number,String,Array,Math,FormData:Object,Object,console
 };
 ctx.window.navItems=()=>[];
 ctx.window.go=async()=>{};
 vm.createContext(ctx);
 vm.runInContext(front,ctx,{filename:'marketing-management.js'});
 return {ctx,els,modals,html:()=>get('content').innerHTML};
}
test('existing Google Sheet schema stores business already; no new tab, column, or save API needed',()=>{
 assert.match(backend,/MKT_TASK_HEADERS=\['id'.*'business','brand'/);
 assert.match(backend,/business:mktStr\(input\.business!==undefined\?input\.business:base\.business,20\)/);
 assert.match(backend,/if\(\['LPH','LPL','BOTH','OTHER',''\]\.indexOf\(v\.business\)<0\)/);
 assert.match(front,/api\('save_task',\{task:t\}\)/);
});
test('Luxury and LP Home tabs use independent filtered views of the same task data',async()=>{
 const m=make();await m.ctx.window.go('marketing');
 m.ctx.window.marketingTab('Content Calendar');m.ctx.window.marketingMonth('2026-11');
 let page=m.html();
 assert.match(page,/L&#39;Imperial Luxury|L.Imperial Luxury/);
 assert.match(page,/LP Home/);
 assert.match(page,/Luxury chandelier launch/);
 assert.match(page,/Shared holiday announcement/);
 assert.doesNotMatch(page,/Home sofa sale/);
 assert.doesNotMatch(page,/Unassigned legacy post<\/b>/);
 assert.match(page,/1 scheduled task\(s\) do not yet have a business assigned/);
 m.ctx.window.marketingCalendarBrand('LPH');
 page=m.html();
 assert.match(page,/Home sofa sale/);
 assert.match(page,/Shared holiday announcement/);
 assert.doesNotMatch(page,/Luxury chandelier launch/);
 assert.match(page,/List View/);
 assert.match(page,/Calendar View/);
});
test('calendar grid navigates months; content entries and dates are interactive',async()=>{
 const m=make();await m.ctx.window.go('marketing');
 m.ctx.window.marketingTab('Content Calendar');m.ctx.window.marketingMonth('2026-11');
 m.ctx.window.marketingCalendarBrand('LPH');
 m.ctx.window.marketingCalendarView('calendar');
 let page=m.html();
 assert.match(page,/November 2026/);
 assert.match(page,/grid grid-cols-7 gap-1/);
 assert.match(page,/marketingCalendarDay\(&#39;|marketingCalendarDay\('/);
 assert.match(page,/Home sofa sale/);
 assert.match(page,/Shared holiday announcement/);
 assert.doesNotMatch(page,/Luxury chandelier launch/);
 m.ctx.window.marketingCalendarDay('2026-11-20');
 assert.match(m.modals.at(-1).body,/Shared holiday announcement/);
 assert.doesNotMatch(m.modals.at(-1).body,/Luxury chandelier launch/);
 m.ctx.window.openMarketingCalendarItem(uuid(2));
 assert.match(m.modals.at(-1).body,/Home sofa sale|Facebook/);
 assert.match(m.modals.at(-1).body,/History|Edit Content/);
 m.ctx.window.marketingCalendarShift(1);
 assert.match(m.html(),/December 2026/);
 assert.match(m.html(),/LP Home December content/);
 m.ctx.window.marketingCalendarShift(-1);
 assert.match(m.html(),/November 2026/);
});
test('scheduling from selected brand and calendar day prefills business and date',async()=>{
 const m=make();await m.ctx.window.go('marketing');
 m.ctx.window.marketingTab('Content Calendar');m.ctx.window.marketingCalendarBrand('LPH');
 m.ctx.window.marketingCalendarSchedule('2026-11-20');
 const form=m.modals.at(-1).body;
 assert.match(form,/name="business"/);
 assert.match(form,/<option value="LPH" selected>/);
 assert.match(form,/name="post_date" type="date" required value="2026-11-20"/);
 assert.match(form,/name="brand"/);
 assert.match(form,/name="campaign"/);
 assert.match(form,/saveMarketingTask\(event\)/);
});
test('employee permission and approval actions remain in place',async()=>{
 const employee=make('marketing');
 await employee.ctx.window.go('marketing');
 employee.ctx.window.marketingTab('Content Calendar');
 assert.doesNotMatch(employee.html(),/Assign a business<\/button>/);
 const wrong=make('sales');await wrong.ctx.window.go('marketing');
 assert.doesNotMatch(wrong.html(),/Content Calendar/);
 assert.match(front,/if\(t&&!manager\(\)\)return note\('Use Progress to update your assigned task'/);
 assert.match(front,/api\('review_task'/);
 assert.match(front,/api\('publish_task'/);
});
