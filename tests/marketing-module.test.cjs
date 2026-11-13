const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const front=fs.readFileSync('marketing-management.js','utf8');
const backend=fs.readFileSync('google-apps-script/marketing-management/Code.gs','utf8');
new vm.Script(front,{filename:'marketing-management.js'});
new vm.Script(backend,{filename:'Code.gs'});
function make(role){
 const els=new Map();
 const el=id=>{if(!els.has(id))els.set(id,{innerHTML:'',textContent:'',value:''});return els.get(id);};
 const ctx={console,window:{},document:{getElementById:el,querySelectorAll:()=>[]},
 state:{profile:{role,display_name:'Tester'},user:{id:'9a5db4b1-9dbf-4d94-aa2f-89e7a5df8f89'}},
 esc:x=>String(x||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;','\'':'&#39;'}[c])),
 showToast:()=>{},renderNav:()=>{},openModal:()=>{},closeModal:()=>{},
 oldCalls:[],Intl,Date,Map,Set,JSON,Promise,Number,String,Array,Math,FormData:Object, Object
 };
 ctx.window.navItems=()=>[['dashboard','Dashboard'],['sales-orders','Sales Orders'],['stock-inventory','Stock']];
 ctx.window.go=async page=>{ctx.oldCalls.push(page);};
 ctx.db={functions:{invoke:async()=>({data:{ok:true,data:{tasks:[],daily:[]}}})},
 rpc:async name=>({data:name==='get_marketing_staff'?[]:{configured:false},error:null})};
 ctx.window.state=ctx.state;
 ctx.window.document=ctx.document;
 vm.createContext(ctx);
 vm.runInContext(front,ctx,{filename:'marketing-management.js'});
 return {ctx,els};
}
(async()=>{
 const mkt=make('marketing');
 assert.deepEqual(Array.from(mkt.ctx.window.navItems()).map(x=>x[0]),['marketing']);
 await mkt.ctx.window.go('dashboard');
 assert.equal(mkt.ctx.state.page,'marketing');
 assert.equal(mkt.ctx.oldCalls.length,0);
 assert.match(mkt.els.get('content').innerHTML,/Marketing Overview|Marketing Management/);
 mkt.ctx.window.marketingTab('My To-Do');
 assert.match(mkt.els.get('content').innerHTML,/Marketing To-Do List/);
 assert.match(mkt.els.get('content').innerHTML,/Status filter/);
 assert.match(mkt.els.get('content').innerHTML,/Priority filter/);
 assert.match(mkt.els.get('content').innerHTML,/Recently Updated/);
 mkt.ctx.window.marketingTab('Daily Plan & Result');
 assert.match(mkt.els.get('content').innerHTML,/Morning Plan/);
 assert.match(mkt.els.get('content').innerHTML,/Evening Result/);
 assert.match(mkt.els.get('content').innerHTML,/Last 7 Days/);
 mkt.ctx.window.marketingDailyView('Team Review');
 assert.doesNotMatch(mkt.els.get('content').innerHTML,/Marketing Team Daily Review/);

 const manager=make('marketing_manager');
 assert.deepEqual(Array.from(manager.ctx.window.navItems()).map(x=>x[0]),['marketing']);
 await manager.ctx.window.go('marketing');
 manager.ctx.window.marketingDailyView('Team Review');
 assert.match(manager.els.get('content').innerHTML,/Marketing Team Daily Review/);

 const sales=make('sales');
 assert.equal(sales.ctx.window.navItems().some(x=>x[0]==='marketing'),false);
 await sales.ctx.window.go('marketing');
 assert.equal(sales.ctx.oldCalls.length,0);
 const stock=make('stock_controller');
 assert.equal(stock.ctx.window.navItems().some(x=>x[0]==='marketing'),false);
 const admin=make('admin');
 assert.equal(admin.ctx.window.navItems().some(x=>x[0]==='sales-orders'),true);
 assert.equal(admin.ctx.window.navItems().some(x=>x[0]==='marketing'),true);
 assert.match(backend,/get_my_effective_access/);
 assert.match(backend,/mktOwned/);
 assert.match(backend,/LockService/);
 console.log('Marketing role separation and syntax verified');
})().catch(e=>{console.error(e);process.exit(1);});
