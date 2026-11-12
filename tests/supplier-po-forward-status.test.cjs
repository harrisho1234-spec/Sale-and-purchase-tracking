const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const file=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const shared=file('po-arrival-sync.js');
const workspace=file('procurement-workspace.js');
const edit=file('po-edit.js');
const item=file('procurement-item-status.js');
const migration=file('supabase/migrations/20261105_supplier_po_forward_only_status.sql');
const arrival=file('supabase/migrations/20261105_supplier_po_all_items_arrived_sync.sql');
const html=file('index.html');

function sharedInstance(){
 const calls=[],notices=[];
 const host={documentFlowState:{loaded:true},invalidateInventoryCache:()=>{},invalidateInventoryTasks:()=>{},confirm:()=>true};
 const db={rpc:async (name,args)=>{calls.push({name,args});return {data:{status:args.p_status||'arrived',updated_item_lines:2},error:null}}};
 new Function('window','db','showToast',shared)(host,db,(...args)=>notices.push(args));
 return {host,calls,notices};
}

test('Order → Production → Shipping → Arrived is forward only',()=>{
 const {host}=sharedInstance();
 assert.equal(host.poWorkflowRank('placed'),0);
 assert.equal(host.poWorkflowRank('production'),1);
 assert.equal(host.poWorkflowRank('ready'),2);
 assert.equal(host.poWorkflowRank('shipping'),3);
 assert.equal(host.poWorkflowRank('arrived'),4);
 assert.equal(host.poWorkflowRank('closed'),5);
 assert.equal(host.poCanAdvanceStatus('placed','shipping'),true);
 assert.equal(host.poCanAdvanceStatus('shipping','arrived'),true);
 assert.equal(host.poCanAdvanceStatus('arrived','shipping'),false);
 assert.equal(host.poCanAdvanceStatus('closed','arrived'),false);
 assert.equal(host.poCanAdvanceStatus('cancelled','production'),false);
});
test('previous stages are visible but disabled in PO dropdowns',()=>{
 const {host}=sharedInstance();
 const html=host.poForwardStatusOptions('arrived',[
  ['placed','Ordered'],['production','Production'],['shipping','Shipping'],
  ['arrived','Arrived'],['delivered','Delivered']]);
 assert.match(html,/<option value="shipping"[^>]*disabled/);
 assert.match(html,/<option value="arrived"[^>]*selected/);
 assert.doesNotMatch(html,/<option value="delivered"[^>]*disabled/);
});
test('whole-PO forward writes happen through one server RPC',async()=>{
 const {host,calls}=sharedInstance();
 const result=await host.saveSupplierPOForwardStatus('po-1','shipping','2026-11-16');
 assert.equal(calls.length,1);
 assert.equal(calls[0].name,'set_supplier_po_forward_status');
 assert.equal(calls[0].args.p_po_id,'po-1');
 assert.equal(calls[0].args.p_status,'shipping');
 assert.equal(calls[0].args.p_eta,'2026-11-16');
 assert.equal(result.updated_item_lines,2);
});
test('Manage PO and Shipping/ETA use server-side atomic progress without manual split updates',()=>{
 assert.match(workspace,/window\.saveSupplierPOForwardStatus\(id,status,eta\)/);
 assert.match(workspace,/window\.poForwardStatusOptions\(p\.status/);
 assert.doesNotMatch(workspace,/db\.from\('supplier_po_items'\)\s*\.update\(\{procurement_status:status/);
 assert.match(workspace,/confirmWholePOArrival\(id,eta\)/);
 assert.match(workspace,/after arrival, Shipping cannot be selected again/);
});
test('Edit Supplier PO saves status through workflow and not via metadata patch',()=>{
 assert.match(edit,/window\.saveSupplierPOForwardStatus\(poId,targetStatus,eta\)/);
 assert.match(edit,/window\.confirmWholePOArrival\(poId,eta\)/);
 assert.match(edit,/delete patch\.status/);
 assert.match(edit,/delete patch\.estimated_arrival/);
 assert.match(edit,/window\.poForwardStatusOptions\(p\.status/);
});
test('PO Items disable backward choices and bulk updates skip advanced/received lines',()=>{
 assert.match(item,/blocked=.*poCanAdvanceStatus|!window\.poCanAdvanceStatus\(current,s\)/);
 assert.match(item,/forwardOnlyPOItemIds/);
 assert.match(item,/canAdvance\(x\.procurement_status,status\)/);
 assert.match(item,/set_supplier_po_items_status_bulk/);
 assert.match(item,/later-stage\/unchanged line\(s\) preserved/);
});
test('database guards protect arrived/received PO and item statuses independently of UI',()=>{
 assert.match(migration,/trg_supplier_po_forward_only_20261105/);
 assert.match(migration,/trg_supplier_po_item_forward_only_20261105/);
 assert.match(migration,/movement_type='po_receipt'/);
 assert.match(migration,/if v_new>=0 and v_new<v_old then/);
 assert.match(migration,/Stock has already been received for this PO/);
 assert.match(migration,/already been received into Stock/);
 assert.match(migration,/current_user_has_permission\('procurement\.po_edit'\)/);
 assert.match(migration,/v_rank=5 then 'closed'/);
 assert.match(migration,/public\.sync_linked_item_tracking_from_po/);
 assert.match(migration,/lower\(coalesce\(it\.status,''\)\) in \('delivered','installed','cancelled'\)/);
});
test('last Arrived item advances parent PO, partial shipments do not',()=>{
 assert.match(arrival,/trg_auto_supplier_po_arrived_from_item_status_20261105/);
 assert.match(arrival,/if coalesce\(v_open_count,0\)=0 or coalesce\(v_early_count,0\)>0 then return new/);
 assert.match(arrival,/p\.status in \('placed','production','ready','shipping'\)/);
 assert.doesNotMatch(arrival,/insert into public\.stock_movements/i);
});
test('new scripts have explicit cache versions',()=>{
 assert.match(html,/po-arrival-sync\.js\?v=20261112-admin-po-edit1/);
 assert.match(html,/po-edit\.js\?v=20261112-admin-po-edit1/);
 assert.match(html,/procurement-workspace\.js\?v=20261105-forward-only-po1/);
 assert.match(html,/procurement-item-status\.js\?v=20261105-forward-only-items1/);
});
