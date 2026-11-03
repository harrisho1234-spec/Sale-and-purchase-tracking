const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const source=fs.readFileSync(path.join(__dirname,'..','sales-access-management.js'),'utf8');
const index=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
const {statusOf,expiryError,alreadyAssigned}=require('../sales-access-management.js');

test('active, expired and revoked statuses remain distinct',()=>{
 const now=Date.parse('2026-11-03T10:00:00Z');
 assert.equal(statusOf({active:true,expires_at:'2026-11-03T11:00:00Z'},now),'Active');
 assert.equal(statusOf({active:true,expires_at:'2026-11-02T10:00:00Z'},now),'Expired');
 assert.equal(statusOf({active:false,expires_at:'2026-11-02T10:00:00Z'},now),'Revoked');
 assert.equal(statusOf({active:true,expires_at:null},now),'Active');
});

test('past expires are rejected, but expired-grant notes can be edited without renewal',()=>{
 const now=Date.parse('2026-11-03T10:00:00Z');
 assert.match(expiryError('2026-11-02T14:30','', 'create',now),/future/);
 assert.match(expiryError('2026-11-03T09:59','', 'renew',now),/future/);
 assert.match(expiryError('', '', 'renew',now),/future/);
 assert.equal(expiryError('', '', 'create',now),'');
 assert.equal(expiryError('2026-11-03T10:20','', 'create',now),'');
 assert.equal(expiryError('2026-11-02T14:30','2026-11-02T14:30:00Z','edit',now),'');
 assert.match(expiryError('2026-11-01T14:30','2026-11-02T14:30:00Z','edit',now),/future/);
});
test('ownership check prevents redundant access only for assigned customer',()=>{
 const customers=[{id:'c1',assigned_sales_id:'u1'},{id:'c2',assigned_sales_id:'u2'}];
 assert.equal(alreadyAssigned(customers,'c1','u1'),true);
 assert.equal(alreadyAssigned(customers,'c1','u2'),false);
 assert.equal(alreadyAssigned(customers,'c2','u1'),false);
});
function harness(options={}){
 const alerts=[],updates=[],inserts=[],confirms=[];
 const id='4e5217cc-eeda-4710-bd7e-c82586cfc0bb';
 const inputs={
   grantSalesUser:{value:'u1'},grantScope:{value:'customer'},grantTarget:{value:'c2'},
   grantLevel:{value:'edit'},grantReason:{value:'Coverage'},grantExpires:{
     value:'',removeAttribute(){},set min(v){this._min=v;},
     get min(){return this._min;},focus(){}
   }
 };
 const document={
   getElementById:k=>inputs[k]||null,
   querySelectorAll:()=>[]
 };
 const db={
   from(table){
     assert.equal(table,'sales_access_grants');
     return {
       update(payload){
         updates.push(payload);
         return {eq(){return this;},select(){return this;},
           async maybeSingle(){return {data:{id},error:null};}};
       },
       insert(payload){inserts.push(payload);return Promise.resolve({error:null});},
       select(){return {eq(){return this;},is(){return this;},limit(){return this;},
         async maybeSingle(){return {data:null,error:null};}};}
     };
   }
 };
 const grants=options.grants||[];
 const win={
   document,_salesAccessData:{
     grants,customers:[{id:'c1',assigned_sales_id:'u1'},{id:'c2',assigned_sales_id:'u2'}],
     users:[{user_id:'u1',display_name:'Sales One'}]
   },
   renderSalesAccess:async()=>{},
   canManageSalesAccess:()=>options.manager!==false,
   refreshGrantTargets:()=>{},
   showToast:(msg,type)=>alerts.push({msg,type}),
   confirm:message=>{confirms.push(message);return options.confirm!==false;}
 };
 const sandbox={window:win,db,state:{user:{id:'manager-id'}},module:{exports:{}},document};
 vm.runInNewContext(source,sandbox,{timeout:2000});
 // Rendering/decorating is integration-specific; the action tests assert DB writes.
 win.renderSalesAccess=async()=>{};
 return {win,inputs,alerts,updates,inserts,confirms,id};
}
test('saving new access with an expired date never reaches the database',async()=>{
 const h=harness();
 h.inputs.grantExpires.value='2026-11-02T14:30';
 await h.win.saveSalesAccessGrant({preventDefault(){}});
 assert.equal(h.inserts.length,0);
 assert.equal(h.updates.length,0);
 assert.match(h.alerts[0].msg,/future/);
});
test('already-assigned customer cannot receive a redundant grant',async()=>{
 const h=harness();
 h.inputs.grantTarget.value='c1';
 await h.win.saveSalesAccessGrant({preventDefault(){}});
 assert.equal(h.inserts.length,0);
 assert.match(h.alerts[0].msg,/Already Assigned/);
});
test('new extra-customer access preserves ownership and avoids permanent auto-renewal',async()=>{
 const h=harness();
 await h.win.saveSalesAccessGrant({preventDefault(){}});
 assert.equal(h.inserts.length,1);
 assert.equal(h.inserts[0].sales_user_id,'u1');
 assert.equal(h.inserts[0].customer_id,'c2');
 assert.equal(h.inserts[0].expires_at,null);
 assert.equal(h.inserts[0].granted_by,'manager-id');
 assert.ok(!Object.hasOwn(h.inserts[0],'assigned_sales_id'));
});
test('manager can explicitly revoke an expired active flag without deleting history',async()=>{
 const h=harness({grants:[{id:'4e5217cc-eeda-4710-bd7e-c82586cfc0bb',active:true,
   customer_id:'c2',sales_user_id:'u1',expires_at:'2026-11-02T07:30:00Z'}]});
 await h.win.revokeSalesAccess(h.id);
 assert.deepEqual(JSON.parse(JSON.stringify(h.updates)),[{active:false}]);
 assert.equal(h.confirms.length,1);
});
test('renewal requires future expiry, confirmation, and reactivates revoked access',async()=>{
 const g={id:'4e5217cc-eeda-4710-bd7e-c82586cfc0bb',active:false,
   customer_id:'c2',sales_user_id:'u1',access_level:'edit',reason:'Old access',expires_at:'2026-11-02T07:30:00Z'};
 const h=harness({grants:[g]});
 h.win.renewSalesAccessGrant(h.id);
 assert.equal(h.inputs.grantExpires.value,'');
 await h.win.saveSalesAccessGrant({preventDefault(){}});
 assert.equal(h.updates.length,0);
 assert.match(h.alerts[0].msg,/future/);
 const future=new Date(Date.now()+86400000);
 const pad=n=>String(n).padStart(2,'0');
 h.inputs.grantExpires.value=future.getFullYear()+'-'+pad(future.getMonth()+1)+'-'+pad(future.getDate())+'T'+pad(future.getHours())+':'+pad(future.getMinutes());
 await h.win.saveSalesAccessGrant({preventDefault(){}});
 assert.equal(h.updates.length,1);
 assert.equal(h.updates[0].active,true);
 assert.equal(h.confirms.length,1);
});
test('editing a revoked grant leaves it revoked, even with a future expiration',async()=>{
 const g={id:'4e5217cc-eeda-4710-bd7e-c82586cfc0bb',active:false,
   customer_id:'c2',sales_user_id:'u1',access_level:'view',reason:'Old',expires_at:'2026-11-02T07:30:00Z'};
 const h=harness({grants:[g]});
 h.win.editSalesAccessGrant(h.id);
 h.inputs.grantReason.value='Updated note';
 await h.win.saveSalesAccessGrant({preventDefault(){}});
 assert.equal(h.updates.length,1);
 assert.equal(h.updates[0].reason,'Updated note');
 assert.ok(!Object.hasOwn(h.updates[0],'active'),'editing must never activate a revoked grant');
});
test('management controls load only after role checks and existing form',()=>{
 assert.ok(index.indexOf('roles-access.js')<index.indexOf('sales-access-management.js'));
 assert.match(source,/if\(!can\(\)\)return notify\('Sales Access management permission required/);
 assert.match(source,/newButton\('Edit'/);
 assert.match(source,/newButton\('Renew'/);
 assert.match(source,/newButton\('Revoke'/);
 assert.match(source,/Access Grants and customer ownership are separate/);
});
