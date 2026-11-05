const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const src=fs.readFileSync(path.join(__dirname,'..','delivery-order-workflow.js'),'utf8');
const migration=fs.readFileSync(path.join(__dirname,'..','supabase/migrations/20261105_preorder_do_inventory_link_release.sql'),'utf8');
const exposed=src.replace(/\}\)\(\);\s*$/,
  'window.__doTest={card:requestCard,load:loadRequests,expand:id=>D.expandedRequests.add(id)};})();');
assert.notEqual(exposed,src);
function fixture(role='stock_controller'){
 const req={
  delivery_request_id:'do1',do_no:'DO2611-005',document_no:'SR:2026-001',
  customer_name:'Customer',sales_rep_name:'Sales',request_status:'do_assigned',
  total_requested_qty:1,total_delivered_qty:0,
  items:[{delivery_request_item_id:'do-line1',sales_order_item_id:'sales-line1',
   product_id:'product1',product_code:'DAL002/3BGL',item_name:'Roslinda Sofa 3 Seater',
   source_type:'pre_order',inventory_tracking_enabled:false,
   fulfillment_status:'ordered',requested_qty:1,delivered_qty:0,remaining_qty:1}]
 };
 const calls=[],toasts=[],pending=[],elements={
  doStockReleaseForm:{onsubmit:null},
  doReleaseQty:{value:'1'},doReleaseLocation:{value:'loc1'},
  doReleaseDate:{value:'2026-11-05'},doReleaseNote:{value:''},
  doReleaseSave:{disabled:false,textContent:'',isConnected:true}
 };
 const c={state:{profile:{role},user:{id:'staff'}},console,
  document:{
   querySelectorAll:()=>[],querySelector:()=>null,
   getElementById:id=>elements[id]||null
  },
  openModal:(title,html)=>{calls.push({name:'modal',title,html})},
  closeModal:()=>calls.push({name:'close'}),
  showToast:(msg,level)=>toasts.push({msg,level}),
  confirm:()=>true,
  db:{
   rpc:async(name,args)=>{
    calls.push({name,args});
    if(name==='get_inventory_do_requests')return{data:[req]};
    if(name==='get_stock_action_requests')return{data:pending};
    if(name==='get_inventory_item_status_for_stock')
     return{data:[{status:'arrived',qty:1}]};
    if(name==='enable_inventory_tracking_for_sales_item'){
     req.items[0].inventory_tracking_enabled=true;return{data:null};
    }
    if(name==='submit_stock_action_request'){
     pending.push({action_type:'do_delivery',payload:args.p_payload});
     return{data:'pending-id'};
    }
    if(name==='release_sales_stock_do'){req.items[0].remaining_qty=0;return{data:'movement-id'};}
    return{data:[]};
   },
   from:table=>{
    assert.equal(table,'inventory_product_balance');
    return{select(){return this},eq(){return this},
     async maybeSingle(){return{data:{locations:[{location_id:'loc1',qty:2,code:'WH'}]}}}};
   }
  }
 };
 c.window=c;c.window.renderStockInventory=async()=>{};
 c.window.invalidateInventoryCache=()=>{};
 c.window.refreshApprovalNotifications=async()=>{};
 vm.createContext(c);vm.runInContext(exposed,c);
 c.__doTest.expand(req.delivery_request_id);
 return{c,req,calls,toasts,pending,elements};
}
test('DO unlinked physical preorder displays Link to Stock plus disabled per-item release',()=>{
 const {c,req}=fixture();
 const html=c.__doTest.card(req);
 assert.match(html,/Link to Stock/);
 assert.match(html,/Request OUT/);
 assert.match(html,/disabled title="Link the catalog product to Stock first"/);
 assert.match(html,/DO2611-005/);
});
test('DO item with no product catalog match does not try to link a null product',()=>{
 const {c,req}=fixture();req.items[0].product_id=null;
 const html=c.__doTest.card(req);
 assert.match(html,/No catalog product match/);
 assert.doesNotMatch(html,/onclick="linkDoItemToStock/);
});
test('Link to Stock for pre-order uses existing catalog-linked Sales item ID without changing source',async()=>{
 const {c,req,calls}=fixture();
 await c.linkDoItemToStock('sales-line1');
 assert.ok(req.items[0].inventory_tracking_enabled);
 assert.equal(req.items[0].source_type,'pre_order');
 assert.ok(calls.some(x=>x.name==='enable_inventory_tracking_for_sales_item'&&
    x.args.p_sales_order_item_id==='sales-line1'));
 const html=c.__doTest.card(req);
 assert.match(html,/Status/);assert.match(html,/Request OUT/);
});
test('individual Stock Controller OUT is a pending approval, not direct inventory movement',async()=>{
 const {c,req,calls,elements,toasts,pending}=fixture();
 req.items[0].inventory_tracking_enabled=true;
 await c.openDoStockRelease('do1','do-line1');
 assert.match(calls.find(x=>x.name==='modal').html,/Request DO OUT Approval/);
 elements.doReleaseQty.value='1';
 await elements.doStockReleaseForm.onsubmit({preventDefault(){}});
 const rpc=calls.find(x=>x.name==='submit_stock_action_request');
 assert.ok(rpc);
 assert.equal(rpc.args.p_action_type,'do_delivery');
 assert.equal(rpc.args.p_payload.delivery_request_item_id,'do-line1');
 assert.equal(rpc.args.p_payload.qty,1);
 assert.equal(rpc.args.p_payload.location_id,'loc1');
 assert.ok(!calls.some(x=>x.name==='release_sales_stock_do'));
 assert.equal(req.items[0].remaining_qty,1);
 assert.ok(toasts.some(x=>/No stock was deducted/.test(x.msg)));
 await c.__doTest.load('');
 assert.match(c.__doTest.card(req),/OUT Approval Pending/);
 assert.equal(pending.length,1);
});
test('Admin releases only selected DO item quantity, through existing movement RPC',async()=>{
 const {c,req,calls,elements}=fixture('admin');
 req.items[0].inventory_tracking_enabled=true;
 await c.openDoStockRelease('do1','do-line1');
 assert.match(calls.find(x=>x.name==='modal').html,/Confirm Release OUT/);
 await elements.doStockReleaseForm.onsubmit({preventDefault(){}});
 const release=calls.find(x=>x.name==='release_sales_stock_do');
 assert.ok(release);assert.equal(release.args.p_delivery_request_item_id,'do-line1');
 assert.equal(release.args.p_qty,1);
 assert.equal(req.items[0].remaining_qty,0);
 assert.ok(!calls.some(x=>x.name==='submit_stock_action_request'));
});
test('line release refuses a quantity above available stock from selected location',async()=>{
 const {c,req,calls,elements,toasts}=fixture('admin');
 req.items[0].inventory_tracking_enabled=true;
 await c.openDoStockRelease('do1','do-line1');
 elements.doReleaseQty.value='3';
 await elements.doStockReleaseForm.onsubmit({preventDefault(){}});
 assert.ok(toasts.some(x=>/whole number from 1/.test(x.msg)));
 assert.ok(!calls.some(x=>x.name==='release_sales_stock_do'));
});
test('existing database approval and stock guards are preserved for preorder DO items',()=>{
 assert.match(migration,/enable_inventory_tracking_for_sales_item/);
 assert.match(migration,/v_item.source_type not in \('stock','pre_order'\)/);
 assert.match(migration,/submit_stock_action_request/);
 assert.match(migration,/release_sales_stock/); // the existing DO release wrapper calls this validated function
 assert.match(migration,/guard_tracked_stock_fulfillment_delivered/);
 assert.match(migration,/sync_sales_item_status_with_stock/);
 assert.match(src,/submit_stock_action_request/);
 assert.match(src,/release_sales_stock_do/);
});
