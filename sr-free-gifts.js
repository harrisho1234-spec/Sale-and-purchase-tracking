// Add Catalog-based complimentary items to SR -> TK/RK preparation.
// Submitted gifts remain proposals until approval; they enter the ordinary
// Sales Order -> Delivery Order -> Stock Release process after approval.
(function(){
 'use strict';
 const escGift=v=>String(v??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
 let gifts=[],candidates=[],seq=0,timer=null;
 const qty=g=>Number(g.qty||0);
 function redraw(){
   const root=document.getElementById('srGiftItems');
   if(!root)return;
   root.innerHTML=gifts.length?gifts.map(g=>
     '<div class="flex flex-wrap items-center gap-3 border rounded-xl p-2.5 bg-white">'+
     (g.image_url?'<img src="'+escGift(g.image_url)+'" loading="lazy" class="h-11 w-11 object-contain rounded border" onerror="this.style.display=\'none\'">':'')+
     '<div class="min-w-0 flex-1"><b class="text-xs">'+escGift(g.code)+'</b><div class="text-[10px] truncate text-gray-600">'+escGift(g.item_name)+'</div><div class="text-[10px] text-green-700">Free Gift · $0.00</div></div>'+
     '<label class="text-[10px] font-bold text-gray-600">Qty <input data-freegift-qty="'+escGift(g.id)+'" type="number" min="1" max="10000" step="1" value="'+g.qty+'" class="w-20 mt-1 block border rounded-lg px-2 py-2 text-sm"></label>'+
     '<button type="button" data-freegift-delete="'+escGift(g.id)+'" class="text-xs text-red-600 border border-red-200 px-3 py-2 rounded-lg">Remove</button></div>'
   ).join(''):'<div class="p-3 border border-dashed rounded-lg text-xs text-gray-500">No free gifts added.</div>';
   root.querySelectorAll('[data-freegift-qty]').forEach(input=>input.addEventListener('input',()=>{
     const g=gifts.find(p=>p.id===input.dataset.freegiftQty);
     if(g)g.qty=Number(input.value||0);
   }));
   root.querySelectorAll('[data-freegift-delete]').forEach(btn=>btn.addEventListener('click',()=>{
     gifts=gifts.filter(p=>p.id!==btn.dataset.freegiftDelete);redraw();
   }));
 }
 window.initSrFreeGiftUI=function(){
   gifts=[];candidates=[];seq++;
   const root=document.getElementById('srFreeGiftModule');
   if(!root)return;
   root.innerHTML='<div class="rounded-xl border border-green-200 p-3 bg-green-50/20 space-y-3">'+
     '<div><b class="text-sm">+ Add Extra Items · Free Gift ($0)</b><p class="text-[11px] text-gray-600 mt-1">Search an existing Product Code, such as LED bulbs. The gift appears on TK/RK after approval and requires a normal Delivery Order before stock is deducted.</p></div>'+
     '<input id="srGiftSearch" type="search" autocomplete="off" class="w-full border p-3 rounded-xl bg-white text-sm" placeholder="Search LED, Product Code or Product Name…">'+
     '<div id="srGiftMatches" class="max-h-44 overflow-auto rounded-lg"></div>'+
     '<div id="srGiftItems" class="grid gap-2"></div>'+
     '<p class="text-[10px] text-green-700">No charge to customer · original SR deposit unchanged · physical stock OUT only when DO is released</p></div>';
   redraw();
   root.querySelector('#srGiftSearch').addEventListener('input',ev=>{
     clearTimeout(timer);
     const term=String(ev.target.value||'').trim().replace(/[%_]/g,' ').slice(0,90);
     const results=root.querySelector('#srGiftMatches');
     const current=++seq;
     if(term.length<2){results.innerHTML='';return}
     results.innerHTML='<div class="text-xs p-3 text-gray-500">Searching products...</div>';
     timer=setTimeout(async()=>{
       try{
         const pattern='%'+term+'%';
         const [code,byName]=await Promise.all([
           db.from('product_catalog').select('id,code,item_name,image_url').eq('active',true).ilike('code',pattern).limit(15),
           db.from('product_catalog').select('id,code,item_name,image_url').eq('active',true).ilike('item_name',pattern).limit(15)
         ]);
         if(code.error||byName.error)throw code.error||byName.error;
         if(current!==seq||!results.isConnected)return;
         candidates=[...new Map([...(code.data||[]),...(byName.data||[])].map(p=>[p.id,p])).values()].slice(0,20);
         results.innerHTML=candidates.length?candidates.map(p=>
           '<button type="button" data-freegift-pick="'+escGift(p.id)+'" class="w-full flex items-center gap-2 border-b px-2 py-2 bg-white hover:bg-green-50 text-left">'+
           (p.image_url?'<img src="'+escGift(p.image_url)+'" class="h-9 w-9 object-contain rounded border" loading="lazy" onerror="this.style.display=\'none\'">':'')+
           '<span class="flex-1 min-w-0"><b class="text-xs">'+escGift(p.code)+'</b><span class="text-[10px] text-gray-600 block truncate">'+escGift(p.item_name)+'</span></span>'+
           '<span class="font-bold text-green-700 text-xs">+ Add</span></button>'
         ).join(''):'<div class="p-3 text-xs text-gray-500">No matching active Product Code. Add it in Products first.</div>';
         results.querySelectorAll('[data-freegift-pick]').forEach(btn=>btn.addEventListener('click',()=>{
           const item=candidates.find(x=>x.id===btn.dataset.freegiftPick);
           if(!item)return;
           if(gifts.some(g=>g.id===item.id))return showToast('Free gift already added; adjust its quantity instead.');
           if(gifts.length>=40)return showToast('Maximum 40 free gift product types per invoice.','err');
           gifts.push({...item,qty:1});redraw();results.innerHTML='';
           const input=root.querySelector('#srGiftSearch');input.value='';input.focus();
         }));
       }catch(err){
         if(current===seq&&results.isConnected)
           results.innerHTML='<div class="p-3 text-xs text-red-700">'+escGift(err.message||'Could not search products')+'</div>';
       }
     },180);
   });
 };
 window.getSrFreeGiftPayload=function(){
   if(gifts.some(g=>!Number.isSafeInteger(qty(g))||qty(g)<1||qty(g)>10000))return null;
   return gifts.map(g=>({product_id:g.id,qty:g.qty}));
 };
 const previousApproval=window.openSrConversionApproval;
 if(typeof previousApproval==='function'){
   window.openSrConversionApproval=async function(id){
     await previousApproval.apply(this,arguments);
     const r=await db.rpc('get_sr_split_invoice_detail',{p_id:id});
     if(r.error||!r.data||!Array.isArray(r.data.free_gifts)||!r.data.free_gifts.length)return;
     const form=document.getElementById('srConversionApprovalForm');
     if(!form)return;
     const section=document.createElement('section');
     section.className='border border-green-200 bg-green-50/40 rounded-xl p-3 text-xs';
     section.innerHTML='<div class="font-bold mb-2">Additional Free Gift Items · $0</div>'+
       '<div class="space-y-1">'+r.data.free_gifts.map(g=>
         '<div class="flex justify-between gap-2"><span>'+escGift(g.code)+' · '+escGift(g.name)+'</span>'+
         '<b>'+Number(g.qty||0)+' pcs · $0</b></div>'
       ).join('')+'</div>'+
       '<div class="text-[10px] text-green-800 mt-2">If approved, each free gift becomes a DO-eligible stock item. No stock is deducted now.</div>';
     const controls=form.querySelector('.grid.grid-cols-2.gap-3');
     if(controls)controls.before(section);else form.append(section);
   };
 }
})();
