const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','delivery-order-workflow.js'),'utf8');

function harness({role='stock_controller',sourceType='pre_order',catalog=true,arrived=0,onHand=0,pending=false}={}){
 const item={
  delivery_request_item_id:'di-1',sales_order_item_id:'si-1',
  product_id:catalog?'catalog-1':null,product_code:'DAL002/3BGL',
  item_name:'Roslinda Sofa',source_type:sourceType,inventory_tracking_enabled:false,
  remaining_qty:1,requested_qty:1,delivered_qty:0,fulfillment_status:'ordered'
 };
 const request={delivery_request_id:'do-1',do_no:'DO2611-005',
  document_no:'SR:2026-001',customer_name:'Customer',
  items:[item]};
 const calls=[],notices=[],elements={},modals=[];
 const make=(id,value='')=>elements[id]={id,value,textContent:'',disabled:false,isConnected:true,onsubmit:null};
 const document={
  getElementById:id=>elements[id]||null,
  querySelectorAll:()=>[],querySelector:()=>null
 };
 const state={profile:{role}};
 const db={
  rpc:async(name,args)=>{
   calls.push({name,args});
   switch(name){
    case 'get_inventory_do_requests':return{data:[JSON.parse(JSON.stringify(request))]};
    case 'get_stock_action_requests':return{data:pending?[{
      action_type:'do_delivery',payload:{delivery_request_item_id:'di-1'}}]:[]};
    case 'get_delivery_order_edit_requests':return{data:[]};
    case 'enable_inventory_tracking_for_sales_item':
      item.inventory_tracking_enabled=true;return{data:null,error:null};
    case 'get_inventory_item_status_for_stock':
      return{data:[{status:arrived>0?'arrived':'ordered',qty:arrived}],error:null};
    case 'submit_stock_action_request':
      return{data:{id:'pending-approval-1'},error:null};
    case 'release_sales_stock_do':
      return{data:'movement-1',error:null};
    default:throw Error('Unexpected RPC '+name);
   }
  },
  from:table=>{
   assert.equal(table,'inventory_product_balance');
   return{select(){return this},eq(){return this},
    async maybeSingle(){return{data:{locations:onHand>0?[{
      location_id:'loc-1',code:'Main Warehouse',qty:onHand}]:[]},error:null}}};
  }
 };
 const host={
  renderStockInventory:async()=>{calls.push({name:'renderStockInventory'})},
  invalidateInventoryCache:()=>{},
  refreshApprovalNotifications:()=>{},
  confirm:()=>true
 };
 const openModal=(title,html)=>{
  modals.push({title,html});
  if(html.includes('id="linkDoStockForm"')){
   make('linkDoStockForm');make('linkDoStockSave');
  }
  if(html.includes('id="doStockReleaseForm"')){
   make('doStockReleaseForm');make('doReleaseSave');
   make('doReleaseQty','1');
   make('doReleaseLocation','loc-1');
   make('doReleaseDate','2026-11-05');
   make('doReleaseNote','');
  }
 };
 const context={window:host,state,db,document,openModal,
  closeModal:()=>calls.push({name:'closeModal'}),
  showToast:(message,type)=>notices.push({message,type}),
  console,Date,Intl,setTimeout};
 vm.createContext(context);vm.runInContext(source,context);
 return{host,state,item,request,calls,notices,elements,modals};
}
function rpc(h,name){return h.calls.filter(c=>c.name===name)}

test('unlinked DO line offers its own OUT button and routes through checked link first',()=>{
 assert.match(source,/if\(hasDo\)actions\+=' <button type="button" onclick="openDoStockRelease/);
 assert.match(source,/if\(!item\.inventory_tracking_enabled\)return window\.linkDoItemToStock\(requestId,requestItemId,true\)/);
 assert.match(source,/function doLinkEligibility\(item\)/);
});
test('link is a separate step; valid pre-order can link without any physical stock or Stock OUT',async()=>{
 const h=harness({arrived:0,onHand:0});
 await h.host.linkDoItemToStock('do-1','di-1');
 assert.equal(h.modals.length,1);
 assert.match(h.modals[0].html,/Linking is allowed even with zero available stock/);
 assert.equal(rpc(h,'enable_inventory_tracking_for_sales_item').length,0);
 await h.elements.linkDoStockForm.onsubmit({preventDefault(){}});
 assert.equal(h.item.inventory_tracking_enabled,true);
 assert.equal(rpc(h,'enable_inventory_tracking_for_sales_item').length,1);
 assert.equal(rpc(h,'submit_stock_action_request').length,0);
 assert.equal(rpc(h,'release_sales_stock_do').length,0);
 assert.ok(h.notices.some(n=>/No stock was released/.test(n.message)));
});
test('individual Stock Controller OUT guides through link and then sends an approval request, never deducts stock',async()=>{
 const h=harness({arrived:1,onHand:2});
 await h.host.openDoStockRelease('do-1','di-1');
 assert.ok(h.elements.linkDoStockForm);
 assert.equal(rpc(h,'release_sales_stock_do').length,0);
 await h.elements.linkDoStockForm.onsubmit({preventDefault(){}});
 assert.ok(h.elements.doStockReleaseForm);
 assert.equal(rpc(h,'submit_stock_action_request').length,0);
 await h.elements.doStockReleaseForm.onsubmit({preventDefault(){}});
 assert.equal(rpc(h,'submit_stock_action_request').length,1);
 assert.equal(rpc(h,'release_sales_stock_do').length,0);
 assert.equal(rpc(h,'submit_stock_action_request')[0].args.p_payload.delivery_request_item_id,'di-1');
});
test('Admin individual OUT still requires separate form confirmation and uses official DO release RPC',async()=>{
 const h=harness({role:'admin',arrived:1,onHand:2});
 await h.host.openDoStockRelease('do-1','di-1');
 await h.elements.linkDoStockForm.onsubmit({preventDefault(){}});
 assert.ok(h.elements.doStockReleaseForm);
 assert.equal(rpc(h,'release_sales_stock_do').length,0);
 await h.elements.doStockReleaseForm.onsubmit({preventDefault(){}});
 assert.equal(rpc(h,'release_sales_stock_do').length,1);
 assert.equal(rpc(h,'release_sales_stock_do')[0].args.p_delivery_request_item_id,'di-1');
 assert.equal(rpc(h,'release_sales_stock_do')[0].args.p_qty,1);
});
test('unmatched catalog product and invalid source type cannot be enabled or released',async()=>{
 for(const option of [{catalog:false},{sourceType:'manual'}]){
  const h=harness(option);
  await h.host.linkDoItemToStock('do-1','di-1');
  assert.equal(h.modals.length,0);
  assert.equal(rpc(h,'enable_inventory_tracking_for_sales_item').length,0);
  assert.equal(rpc(h,'release_sales_stock_do').length,0);
  assert.ok(h.notices.some(n=>n.type==='err'));
 }
});
test('a change in the original catalog product while modal is open prevents an unsafe link',async()=>{
 const h=harness();
 await h.host.linkDoItemToStock('do-1','di-1');
 h.item.product_id='different-product';
 await h.elements.linkDoStockForm.onsubmit({preventDefault(){}});
 assert.equal(rpc(h,'enable_inventory_tracking_for_sales_item').length,0);
 assert.ok(h.notices.some(n=>/changed since the confirmation/.test(n.message)));
});
test('Stock OUT respects pending approval, arrived status, physical location and existing bulk checks',async()=>{
 const h=harness({pending:true,arrived:1,onHand:2});
 h.item.inventory_tracking_enabled=true;
 await h.host.openDoStockRelease('do-1','di-1');
 assert.equal(h.modals.length,0);
 assert.ok(h.notices.some(n=>/waiting for approval/.test(n.message)));
 const unavailable=harness({arrived:0,onHand:0});
 unavailable.item.inventory_tracking_enabled=true;
 await unavailable.host.openDoStockRelease('do-1','di-1');
 assert.ok(unavailable.notices.some(n=>/Arrived before releasing/.test(n.message)));
 assert.equal(rpc(unavailable,'release_sales_stock_do').length,0);
 assert.match(source,/window\.openDoReleaseAll=async function/);
 assert.match(source,/items\.some\(x=>!x\.inventory_tracking_enabled\)/);
});
