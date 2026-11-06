// Tong Lou display-only catalog reference management.
// Linking is an audited relationship, never an inventory or invoice merge.
(function(){
 let chosenStockId=null;
 let currentReferenceId=null;
 function currentReference(){return (state.products||[]).find(x=>x.id===currentReferenceId)}
 function stockCandidate(id){return (state.products||[]).find(x=>x.id===id&&x.catalog_role==='stock'&&x.active!==false&&!x.archived_at)}
 function reason(){return String(document.getElementById('catalogReferenceReason')?.value||'').trim()}
 async function done(message){
   closeModal();showToast(message);
   await renderProducts();
   if(currentReferenceId)await openProductDetail(currentReferenceId);
 }
 window.openCatalogReferenceManager=function(id){
   if(!isAdmin())return showToast('Admin or Super Admin permission required.','err');
   const p=(state.products||[]).find(x=>x.id===id);
   if(!p||p.catalog_role!=='catalog_only')return showToast('Select a Catalog Only product.','err');
   currentReferenceId=id;chosenStockId=p.official_stock_product_id||null;
   const current=stockCandidate(chosenStockId);
   openModal('Verify Catalog Reference / Official Stock Code',
    '<div class="space-y-4">'+
      '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">'+
       '<b>Display/reference product:</b> '+esc(p.code)+' · '+esc(p.item_name)+
       '<div>Source: '+esc(p.source_sheet||'Price Structure')+'</div>'+
       '<p class="mt-2"><b>No stock, purchase order, invoice or delivery references will be combined or moved.</b> Verify physical dimensions, finish and model identity.</p></div>'+
      '<div class="rounded-xl border p-3 space-y-2">'+
       '<b class="text-sm">Find an official Stock Product</b>'+
       '<input id="catalogReferenceSearch" oninput="catalogReferenceCandidateSearch()" class="border rounded-lg px-3 py-2 w-full text-sm" placeholder="Search official stock code or model">'+
       '<div id="catalogReferenceChoices" class="max-h-56 overflow-auto border rounded-lg p-1 text-xs"></div>'+
       '<div id="catalogReferenceSelected" class="text-xs text-blue-800 font-semibold">'+
         (current?'Currently linked: '+esc(current.code)+' · '+esc(current.item_name):'No official stock code selected.')+'</div>'+
      '</div>'+
      '<label class="block text-xs font-semibold">Verification reason (required)'+
        '<textarea id="catalogReferenceReason" rows="2" minlength="10" maxlength="1000" class="mt-1 border rounded-lg w-full p-3" placeholder="How were model, size, finish and physical stock label verified?"></textarea></label>'+
      '<div class="grid sm:grid-cols-2 gap-2">'+
       '<button type="button" onclick="catalogReferenceSave()" class="rounded-xl bg-[#211d18] p-3 text-white text-sm font-bold">Confirm Official Stock Code Link</button>'+
       '<button type="button" onclick="catalogReferencePromote()" class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-amber-900 text-sm font-bold">Promote as Separate Stock Product</button>'+
      '</div>'+
      (p.official_stock_product_id?'<button type="button" onclick="catalogReferenceUnlink()" class="text-red-700 text-xs font-semibold underline">Remove existing reference link</button>':'')+
      '<p class="text-[11px] text-gray-500">Promotion changes classification only; it never adds stock. Physical receiving must follow the existing approval and Stock IN procedure.</p>'+
    '</div>');
   window.catalogReferenceCandidateSearch();
 };
 window.catalogReferenceCandidateSearch=function(){
   const box=document.getElementById('catalogReferenceChoices');if(!box)return;
   const q=String(document.getElementById('catalogReferenceSearch')?.value||'').toLowerCase().trim();
   const rows=q.length>=2?(state.products||[])
     .filter(p=>p.catalog_role==='stock'&&p.active!==false&&!p.archived_at)
     .filter(p=>[p.code,p.item_name,p.brand,p.description].some(x=>String(x||'').toLowerCase().includes(q)))
     .slice(0,15):[];
   box.innerHTML=rows.length?rows.map(p=>
     '<button type="button" onclick="catalogReferenceChoose(\''+p.id+'\')" class="block w-full text-left border-b rounded-lg px-3 py-2 hover:bg-amber-50">'+
      '<b>'+esc(p.code)+'</b> · '+esc(p.item_name)+
      '<div class="text-gray-500">Stock '+Number(p.stock_qty||0)+' · '+esc(p.brand||'')+'</div></button>'
   ).join(''):'<div class="px-2 py-3 text-gray-500">Enter at least two characters of an official code or model.</div>';
 };
 window.catalogReferenceChoose=function(id){
   const p=stockCandidate(id);
   if(!p)return showToast('Only an active official Stock Product may be linked.','err');
   chosenStockId=p.id;
   const el=document.getElementById('catalogReferenceSelected');
   if(el)el.textContent='Selected: '+p.code+' · '+p.item_name;
 };
 window.catalogReferenceSave=async function(){
   if(!isAdmin())return;
   const p=currentReference(),target=stockCandidate(chosenStockId),why=reason();
   if(!p||!target)return showToast('Select an active official stock product before linking.','err');
   if(why.length<10)return showToast('Provide at least 10 characters explaining verification.','err');
   if(!confirm('Confirm that '+p.code+' represents the SAME physical model as '+target.code+'? No stock or invoice records will be changed.'))return;
   const {data,error}=await db.rpc('manage_catalog_reference_link',{
     p_catalog_product_id:p.id,p_official_stock_product_id:target.id,p_reason:why
   });
   if(error)return showToast(error.message,'err');
   await done(data?.unchanged?'This stock-code relationship was already saved.':'Verified stock-code reference linked. Historical documents and physical stock unchanged.');
 };
 window.catalogReferenceUnlink=async function(){
   if(!isAdmin())return;
   const p=currentReference(),why=reason();
   if(!p||why.length<10)return showToast('Enter a reason for removing the existing link.','err');
   if(!confirm('Remove this catalog-to-stock reference? No stock will be moved.'))return;
   const {error}=await db.rpc('manage_catalog_reference_link',{
     p_catalog_product_id:p.id,p_official_stock_product_id:null,p_reason:why
   });
   if(error)return showToast(error.message,'err');
   chosenStockId=null;await done('Reference link removed. No inventory or history changed.');
 };
 window.catalogReferencePromote=async function(){
   if(!isAdmin())return;
   const p=currentReference(),why=reason();
   if(!p||why.length<10)return showToast('Enter the reason for independent stock classification.','err');
   if(p.official_stock_product_id)return showToast('Remove the existing reference link before independently promoting this code.','err');
   if(!confirm('PROMOTE '+p.code+' into the official Stock Product catalog? It will start with zero physical stock.'))return;
   const {error}=await db.rpc('promote_catalog_reference_to_stock',{
     p_product_id:p.id,p_reason:why
   });
   if(error)return showToast(error.message,'err');
   await done('Product promoted to official Stock. No stock movements or opening balance created.');
 };
})();
