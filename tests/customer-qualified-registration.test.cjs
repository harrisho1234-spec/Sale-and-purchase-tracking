const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=f=>fs.readFileSync(path.join(__dirname,'..',f),'utf8');
const workflow=read('customer-approval-workflow.js');
const crm=read('customer-database.js');
const activity=read('customer-activity.js');
const migration=read('supabase/migrations/20261105_qualified_new_customer_registration.sql');
function mockRequestForm(){
 const sent=[],toasts=[],nodes={};
 const node=(value='')=>({value,innerHTML:'',className:'',classList:{toggle(){},add(){},remove(){}},
  addEventListener(){},focus(){},after(){},appendChild(){}});
 for(const [id,value] of Object.entries({
  mcName:'First Time Buyer',mcAddress:'',mcNotes:'',customerCreateRequestNote:'',
  customerCreateSourceType:'manual',customerCreatePurchaseStatus:'',
  customerCreateSourceSearch:'',customerCreateSourceSelected:'',
  customerCreateSourceResults:'',customerCreateSourcePicker:''
 }))nodes[id]=node(value);
 const btn=node();
 const form={lastElementChild:node(),onsubmit:null,prepend(){},insertBefore(){},
  querySelector(sel){return sel==='button:not([type="button"])'?btn:null},
  querySelectorAll(sel){
   if(sel!=='.customer-contact-row')return [];
   return[{querySelector(s){return {
    '.cc-type':{value:'phone'},'.cc-label':{value:'Main'},'.cc-value':{value:'012345678'}
   }[s]}}]
  }};
 const ctx={state:{user:{id:'sales-1'},profile:{role:'sales'}},
  window:null,document:{getElementById:id=>id==='multiCustomerForm'?form:nodes[id]||null,
   createElement:()=>node()},openModal(){},closeModal(){},go:async()=>{},
  confirm:()=>true,esc:x=>String(x),titleCase:x=>x,showToast:m=>toasts.push(m),
  db:{rpc:async(name,args)=>{
   sent.push({name,args});
   if(name==='find_customer_identity_by_phone')return{data:{matched:false}};
   if(name==='get_customer_lead_rows')return{data:[{
    lead_id:'crm-lead-id',customer_name:'Existing Prospect',phone:'012345678'}]};
   if(name==='submit_qualified_manual_customer_request')return{data:'request-id'};
   if(name==='request_qualified_customer_registration')return{data:{action:'pending',request_id:'request-id'}};
   return{data:[]};
  }}};
 ctx.window=ctx;ctx.openNewCustomer=async()=>{};
 const inputs=['mcName','mcAddress','mcNotes','customerCreateRequestNote'];
 const factory=new Function(...Object.keys(ctx),workflow);
 factory(...Object.values(ctx));
 return {ctx,form,nodes,sent,toasts,inputs};
}
test('new manual first-time buyer requires answer, but needs no visit, source ID or existing invoice',async()=>{
 const e=mockRequestForm();await e.ctx.openNewCustomer();
 assert.match(workflow,/New Walk-in \/ Direct Buyer \(no previous records\)/);
 assert.match(workflow,/link invoice after approval/i);
 await e.form.onsubmit({preventDefault(){}});
 assert.equal(e.sent.some(x=>x.name==='submit_qualified_manual_customer_request'),false);
 e.nodes.customerCreatePurchaseStatus.value='purchased_pending_invoice';
 await e.form.onsubmit({preventDefault(){}});
 const rpc=e.sent.find(x=>x.name==='submit_qualified_manual_customer_request');
 assert.ok(rpc);
 assert.equal(rpc.args.p_purchase_status,'purchased_pending_invoice');
 assert.equal(rpc.args.p_customer.name,'First Time Buyer');
 assert.equal(rpc.args.p_customer.assigned_sales_id,'sales-1');
 assert.equal(rpc.args.p_contacts[0].contact_value,'012345678');
 assert.equal(rpc.args.p_customer._source_activity_id,undefined);
});
test('unbought prospects cannot request official customer approval',async()=>{
 const e=mockRequestForm();await e.ctx.openNewCustomer();
 e.nodes.customerCreatePurchaseStatus.value='not_purchased';
 await e.form.onsubmit({preventDefault(){}});
 assert.equal(e.sent.some(x=>x.name==='submit_qualified_manual_customer_request'),false);
 assert.ok(e.toasts.some(x=>/prospect/i.test(x)));
});
test('existing CRM lead populates editable official name and uses ownership-safe source RPC',async()=>{
 const e=mockRequestForm();await e.ctx.openNewCustomer();
 e.nodes.customerCreateSourceType.value='crm';
 await e.ctx.customerRegistrationSourceChanged();
 e.ctx.useCustomerRegistrationSource(0);
 assert.equal(e.nodes.mcName.value,'Existing Prospect');
 e.nodes.mcName.value='Corrected Official Name';
 e.nodes.customerCreatePurchaseStatus.value='deal_confirmed';
 await e.form.onsubmit({preventDefault(){}});
 const rpc=e.sent.find(x=>x.name==='request_qualified_customer_registration');
 assert.ok(rpc);
 assert.equal(rpc.args.p_source,'crm');
 assert.equal(rpc.args.p_source_id,'crm-lead-id');
 assert.equal(rpc.args.p_official_name,'Corrected Official Name');
 assert.equal(rpc.args.p_purchase_status,'deal_confirmed');
 assert.equal(e.sent.some(x=>x.name==='submit_qualified_manual_customer_request'),false);
});
test('Showroom/Online request entry requires purchase declaration; CRM conversion requires same for Sales',()=>{
 assert.match(activity,/id="activityOfficialPurchaseStatus"/);
 assert.match(activity,/id="activityOfficialCustomerName"/);
 assert.match(activity,/p_source:activityState.type,p_source_id:id,p_purchase_status:purchaseStatus/);
 assert.match(crm,/id="crmConversionPurchaseStatus"/);
 assert.match(crm,/p_source:'crm',p_source_id:id,p_purchase_status:qualification/);
});
test('review only requires qualification acknowledgment for NEW qualified requests; legacy stays untouched',()=>{
 assert.match(workflow,/if\(r.request_type==='create'&&\(r.requested_customer\|\|\{\}\)\._qualification_version\)/);
 assert.match(workflow,/reviewCustomerPurchaseAcknowledged/);
 assert.match(workflow,/if\(r.request_type!=='create'\|\|!v\)return ''/);
 assert.match(workflow,/Invoice linkage:/);
 assert.match(workflow,/Buyer status remains invoice-derived/);
});
test('secure database functions validate new requests but preserve previous requests and existing ownership',()=>{
 assert.match(migration,/request_qualified_customer_registration/);
 assert.match(migration,/submit_qualified_manual_customer_request/);
 assert.match(migration,/v_before timestamptz := transaction_timestamp\(\)/);
 assert.match(migration,/if v_request.requested_at < v_before then/);
 assert.match(migration,/public\.request_activity_customer_master/);
 assert.match(migration,/public\.convert_customer_lead/);
 assert.match(migration,/v_status not in \('purchased_pending_invoice','purchased_invoiced','deal_confirmed'\)/);
 assert.match(migration,/public\.submit_customer_change_request/);
 assert.match(migration,/grant execute on function public\.request_qualified_customer_registration/);
 assert.match(migration,/grant execute on function public\.submit_qualified_manual_customer_request/);
});
