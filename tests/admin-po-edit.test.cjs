const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const script=fs.readFileSync(path.join(__dirname,'../po-edit.js'),'utf8');
function setup(status='arrived',historical=false,allowed=true){
 const writes=[],workflow=[],toasts=[],uploads=[];
 const po={id:'po1',status,estimated_arrival:null,vendor_name:'Vendor',order_date:'2026-11-01',po_document_name:'original.pdf'};
 const fields={editPOForm:{},epoFile:{files:[]},epoNo:{value:'PO-1'},epoVendor:{value:'Vendor'},epoVendorId:{value:''},epoStatus:{value:status},epoEta:{value:''},epoAgent:{value:''},epoDate:{value:'2026-11-01'},epoNotes:{value:'corrected notes'}};
 const document={getElementById:id=>fields[id]||null};
 const db={from(table){let patch=null;const chain={select(){return chain},eq(){return chain},order(){return chain},update(p){patch=p;writes.push({table,patch:p});return chain},single(){return chain},then(ok,bad){return Promise.resolve({data:patch?{id:'po1'}:table==='supplier_pos'?po:[],error:null}).then(ok,bad)}};return chain},rpc:async()=>({data:[{supplier_po_id:'po1',reconciliation_state:historical?'historical_reconciled':'live'}]}),storage:{from:()=>({upload:async(...args)=>{uploads.push(args);return {error:null}}})}};
 const window={hasAppPermission:()=>allowed,poForwardStatusOptions:()=>'',confirmWholePOArrival:async(...a)=>{workflow.push(['arrived',...a]);return true},saveSupplierPOForwardStatus:async(...a)=>workflow.push(['forward',...a])};
 new Function('window','document','db','openModal','esc','titleCase','money','showToast','closeModal','go','isAdmin',script)(window,document,db,()=>{},s=>String(s||''),s=>s,()=>'',(...a)=>toasts.push(a),()=>{},async()=>{},()=>allowed);
 return {window,fields,writes,workflow,toasts,uploads,async save(){await window.openEditSupplierPO('po1');await fields.editPOForm.onsubmit({preventDefault(){}})}};
}
for(const status of ['placed','production','arrived','closed','cancelled'])test(`metadata-only ${status} PO edits never run progress actions`,async()=>{
 const h=setup(status);await h.save();assert.equal(h.workflow.length,0);assert.equal(h.writes.length,1);assert.equal(h.writes[0].patch.notes,'corrected notes');assert.ok(!('status' in h.writes[0].patch));assert.ok(!('estimated_arrival' in h.writes[0].patch));
});
test('document replacement works without arrival confirmation',async()=>{const h=setup();h.fields.epoFile.files=[{name:'updated.pdf'}];await h.save();assert.equal(h.workflow.length,0);assert.equal(h.uploads.length,1);assert.equal(h.writes[1].patch.po_document_name,'updated.pdf')});
test('ETA-only arrived edit preserves split item statuses',async()=>{const h=setup();h.fields.epoEta.value='2026-12-01';await h.save();assert.equal(h.workflow.length,0);assert.deepEqual(h.writes[0].patch,{estimated_arrival:'2026-12-01'})});
test('explicit arrival still uses confirmation workflow',async()=>{const h=setup('shipping');h.fields.epoStatus.value='arrived';await h.save();assert.equal(h.workflow[0][0],'arrived')});
test('explicit forward progress still uses existing RPC wrapper',async()=>{const h=setup('placed');h.fields.epoStatus.value='shipping';await h.save();assert.equal(h.workflow[0][0],'forward')});
test('reconciled PO allows metadata only',async()=>{const h=setup('arrived',true);h.fields.epoEta.value='2027-01-01';await h.save();assert.equal(h.workflow.length,0);assert.equal(h.writes.length,1);assert.ok(!('estimated_arrival' in h.writes[0].patch))});
test('Sales cannot open PO editor',async()=>{const h=setup('placed',false,false);await h.window.openEditSupplierPO('po1');assert.equal(h.fields.editPOForm.onsubmit,undefined);assert.equal(h.writes.length,0);assert.match(h.toasts[0][0],/permission/)});

test('cost-only legacy-code PO line edits preserve product identity',async()=>{
 const writes=[],reads=[];
 const item={id:'item1',product_id:'original-product',product_code_snapshot:'OLD-CODE',item_name_snapshot:'Item',qty:2};
 const values={'.pei-code':'OLD-CODE','.pei-name':'Item','.pei-qty':'2','.pei-cost':'3','.pei-shipping':'1'};
 const row={querySelector:s=>({value:values[s]})};
 const document={querySelector:()=>row,getElementById:()=>({dataset:{poId:'po1'}})};
 const window={openEditSupplierPO:async()=>{}};
 const db={from(table){reads.push(table);let changed=false;const chain={select(){return chain},eq(){return chain},limit(){return chain},single(){return chain},update(p){writes.push(p);changed=true;return chain},then(ok,bad){return Promise.resolve({data:changed?{id:'item1'}:table==='supplier_po_items'?item:[],error:null}).then(ok,bad)}};return chain}};
 new Function('window','document','db','CSS','showToast',fs.readFileSync(path.join(__dirname,'../po-item-edit-reorder.js'),'utf8'))(window,document,db,{escape:s=>s},()=>{});
 window.openEditSupplierPO=async()=>{};
 await window.savePOItemEdit('item1');
 assert.equal(writes[0].product_id,'original-product');assert.equal(writes[0].unit_cost,3);assert.ok(!reads.includes('product_catalog'));
});
