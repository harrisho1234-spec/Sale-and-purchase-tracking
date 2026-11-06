const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const read=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');

const app=read('app.js');
const admin=read('product-admin.js');
const manager=read('catalog-reference-manager.js');
const inventory=read('stock-inventory.js');
const index=read('index.html');
const initial=read('supabase/migrations/20261106_tong_lou_catalog_only.sql');
const linking=read('supabase/migrations/20261106_catalog_reference_link_review.sql');
const tagging=read('supabase/migrations/20261106_tong_lou_future_sync_tagging.sql');
const sales=read('supabase/migrations/20261106_catalog_only_sales_stock_protection.sql');
const edge=read('supabase/functions/sync-price-structure/index.ts');

test('Tong Lou classification comes from exact spreadsheet source codes, not quantity or prefix',()=>{
 assert.match(initial,/source_sheet='Tong Lou'/);
 assert.match(initial,/source_spreadsheet_id='1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg'/);
 assert.match(initial,/if v_count<>320 or v_unsafe<>0 then/);
 assert.match(initial,/coalesce\(p\.stock_qty,0\)<>0/);
 assert.doesNotMatch(initial,/delete from public\.product_catalog/i);
 assert.match(tagging,/new\.catalog_classification_locked=true then return new/);
 assert.match(tagging,/new\.catalog_role:='catalog_only'/);
 assert.match(tagging,/from public\.product_display_source_codes/);
});
test('live source connector code verifies exact Tong Lou tab and leaves past codes intact',()=>{
 assert.match(edge,/const DISPLAY_ONLY_TAB = "Tong Lou"/);
 assert.match(edge,/const DISPLAY_ONLY_RANGE = "'Tong Lou'!B3:B"/);
 assert.match(edge,/getVerifiedDisplayOnlyCodes\(req\)/);
 assert.match(edge,/sheets\.googleapis\.com\/v4\/spreadsheets/);
 assert.match(edge,/\.upsert\(records,\{onConflict:"source_code_norm"\}\)/);
 assert.match(edge,/Price Structure push paused: Tong Lou display codes could not be verified/);
 assert.match(edge,/verified_display_source_codes:displayOnlySourceCount/);
});
test('Catalog Only never generates physical movement or automatic sales-stock tracking',()=>{
 assert.match(initial,/reject_catalog_only_stock_movement/);
 assert.match(initial,/new\.affects_balance is not true then return new/);
 assert.match(initial,/guard_catalog_only_stock_snapshot/);
 assert.match(sales,/new\.inventory_tracking_enabled:=not exists/);
 assert.match(sales,/p\.catalog_role='catalog_only'/);
 assert.match(sales,/Cannot link to physical Stock: this is a Tong Lou Catalog Only reference code/);
});
test('management link is permission-checked, audited, and never changes existing invoice/PO quantities',()=>{
 assert.match(linking,/public\.current_app_role\(\) not in \('admin','super_admin'\)/);
 assert.match(linking,/catalog_reference_link_audit/);
 assert.match(linking,/stock product/i);
 assert.match(linking,/No stock|no_stock_transferred|stock_added/);
 assert.match(linking,/auth\.uid\(\) is null/);
 assert.match(linking,/revoke all on function public\.manage_catalog_reference_link/);
 assert.match(linking,/grant execute on function public\.manage_catalog_reference_link.*to authenticated/);
 assert.match(linking,/catalog_role<>'catalog_only'/);
 assert.doesNotMatch(linking,/update public\.sales_order_items/i);
 assert.doesNotMatch(linking,/update public\.stock_movements/i);
});
test('UI distinguishes catalog-only, permits quotation browsing, blocks direct stock adjustments and filters physical stock',()=>{
 assert.match(app,/Catalog Only \/ Display/);
 assert.match(app,/p\.catalog_role==='catalog_only'/);
 assert.match(app,/function setProductCatalogRoleFilter/);
 assert.match(admin,/Catalog \/ Display Only/);
 assert.match(admin,/openCatalogReferenceManager/);
 assert.match(inventory,/excludedReferenceIds/);
 assert.match(inventory,/\.eq\('catalog_role','stock'\)/);
 for(const s of ['catalog-reference-manager.js?v=20261106-managed-stock-code-link1',
     'product-admin.js?v=20261106-tong-lou-catalog1',
     'app.js?v=20261106-catalog-only-products1',
     'stock-inventory.js?v=20261106-catalog-only-stock1'])
   assert.ok(index.includes(s),'Missing script: '+s);
});
function mockManager(isAdminValue=true){
 const products=[
  {id:'display-id',catalog_role:'catalog_only',code:'TD-0807-40',
   item_name:'TD-0807-40',stock_qty:0,source_sheet:'Tong Lou',active:true},
  {id:'stock-id',catalog_role:'stock',code:'CHL0499',item_name:'TD-0807-40',
   stock_qty:1,active:true,brand:'Tong Luo'}
 ];
 const nodes={
  catalogReferenceReason:{value:'Confirmed exact model after physical inspection'},
  catalogReferenceSearch:{value:'CHL0499'},
  catalogReferenceChoices:{innerHTML:''},
  catalogReferenceSelected:{textContent:''}
 };
 const calls=[],messages=[],modals=[];
 const ctx={
  state:{products},isAdmin:()=>isAdminValue,
  document:{getElementById:id=>nodes[id]||null},
  esc:v=>String(v),openModal:(title,html)=>modals.push({title,html}),
  closeModal:()=>{},confirm:()=>true,
  showToast:(msg,level)=>messages.push({msg,level}),
  renderProducts:async()=>{},openProductDetail:async()=>{},
  db:{rpc:async(name,args)=>{calls.push({name,args});return {data:{official_stock_code:'CHL0499'},error:null}}}
 };
 ctx.window=ctx;
 new Function(...Object.keys(ctx),manager)(...Object.values(ctx));
 return{ctx,modals,calls,messages,nodes,products};
}
test('management must explicitly choose and confirm a stock target; link does not touch quantity',async()=>{
 const h=mockManager();
 h.ctx.openCatalogReferenceManager('display-id');
 assert.equal(h.modals.length,1);
 assert.match(h.modals[0].html,/No stock, purchase order, invoice or delivery references/);
 h.ctx.catalogReferenceCandidateSearch();
 assert.match(h.nodes.catalogReferenceChoices.innerHTML,/CHL0499/);
 h.ctx.catalogReferenceChoose('stock-id');
 await h.ctx.catalogReferenceSave();
 assert.equal(h.calls.length,1);
 assert.equal(h.calls[0].name,'manage_catalog_reference_link');
 assert.equal(h.calls[0].args.p_catalog_product_id,'display-id');
 assert.equal(h.calls[0].args.p_official_stock_product_id,'stock-id');
 assert.equal(h.products[0].stock_qty,0);
 assert.equal(h.products[1].stock_qty,1);
});
test('unprivileged staff cannot request catalog link or promotion',()=>{
 const h=mockManager(false);
 h.ctx.openCatalogReferenceManager('display-id');
 assert.equal(h.modals.length,0);
 assert.equal(h.calls.length,0);
 assert.ok(h.messages.some(x=>x.level==='err'));
});
