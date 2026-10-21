// Multiple SRs -> one TK/RK, restricted by server to the same customer/currency.
// Existing SR lines and approved DO stock releases stay tied to their original SR.
(function(){
 'use strict';
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const money=v=>'$'+Number(v||0).toFixed(2);
 const int=v=>Number.isSafeInteger(Number(v))&&Number(v)>=0;
 const remaining=t=>Math.max(0,Number(t.qty||0)-Number(t.issued_qty||0)-Number(t.pending_qty||0));
 const candidateName=t=>t.sr_no||t.order_no||'SR';
 let current=null;
 const prevOpen=window.openPrepareSrConversion;
 if(typeof prevOpen!=='function')return;

 function eligibleLines(c){
   return (c.lines||[]).filter(t=>t.ready&&remaining(t)>0);
 }
 function selectedRows(){
   if(!current)return [];
   const lines=[];
   for(const [id] of current.selected){
     const source=current.candidates.find(x=>x.id===id);
     if(!source)continue;
     for(const t of source.lines||[]){
       const input=current.slot?.querySelector('[data-consolidated-line="'+t.id+'"]');
       const q=Number(input?.value??current.quantities.get(t.id)??0);
       if(q>0)lines.push({...t,sr_id:source.id,sr_no:candidateName(source),selected_qty:q});
     }
   }
   return lines;
 }
 function getBaseSelection(){
   if(!current)return [];
   const result=[];
   const inputs=[...document.querySelectorAll('#splitInvoiceForm [data-split-idx]')];
   for(const input of inputs){
     const line=(current.primary?.items||[])[Number(input.dataset.splitIdx)];
     if(!line)continue;
     const qty=Number(input.value||0);
     if(qty>0)result.push({...line,sr_id:current.orderId,sr_no:current.primaryNo,selected_qty:qty});
   }
   return result;
 }
 function proratedAmount(line,source){
   const q=Number(line.selected_qty||0);
   if(!q||!line.qty)return 0;
   const all=source?.lines||source?.items||[];
   const gross=all.reduce((total,i)=>total+Number(i.line_total||0),0);
   const original=Number(line.line_total||0);
   return (original-(gross>0?Number(source.order_discount||0)*original/gross:0))*q/Number(line.qty||1);
 }
 function renderTotal(){
   if(!current)return;
   const extra=selectedRows();
   const primary=getBaseSelection();
   const own=primary.reduce((n,t)=>n+proratedAmount(t,current.primary),0);
   const other=extra.reduce((n,t)=>n+proratedAmount(t,current.candidates.find(c=>c.id===t.sr_id)),0);
   const label=document.getElementById('combinedSRTotal');
   if(label)label.innerHTML='<b>'+ (1+current.selected.size) +' linked SRs</b> · '+
     (primary.reduce((s,x)=>s+x.selected_qty,0)+extra.reduce((s,x)=>s+x.selected_qty,0))+
     ' selected pieces · Approx. combined TK/RK value: <b>'+money(own+other)+'</b>'+
     '<div class="text-[10px] text-gray-500 mt-1">Free gifts are $0. Original SR discounts are included. Deposits/payments remain on each SR and are not duplicated or automatically reassigned.</div>';
 }
 function drawSelected(){
   if(!current||!current.slot?.isConnected)return;
   current.slot.querySelectorAll('[data-consolidated-line]').forEach(x=>current.quantities.set(x.dataset.consolidatedLine,Number(x.value||0)));
   const content=current.slot.querySelector('#combinedSRSelected');
   if(!content)return;
   content.innerHTML=current.selected.size?[...current.selected.keys()].map(id=>{
     const c=current.candidates.find(x=>x.id===id);
     if(!c)return '';
     return '<div class="border border-blue-100 rounded-xl bg-white p-3">'+
        '<div class="flex flex-wrap items-center justify-between gap-2 mb-2">'+
          '<div><b class="text-sm">'+esc(candidateName(c))+'</b><span class="text-[10px] ml-2 text-gray-500">Original SR remains separate</span></div>'+
          '<button type="button" data-combined-remove="'+esc(id)+'" class="text-xs font-bold text-red-600 border rounded-lg px-3 py-1.5">Remove SR</button></div>'+
        '<div class="divide-y">'+(c.lines||[]).map(t=>{
          const max=t.ready?remaining(t):0;
          return '<div class="py-2 flex items-center gap-3">'+
            (t.image?'<img src="'+esc(t.image)+'" class="w-10 h-10 rounded border object-contain" loading="lazy" onerror="this.style.display=\'none\'">':'')+
            '<div class="flex-1 min-w-0"><b class="text-xs">'+esc(t.code)+'</b>'+
              '<div class="text-[10px] text-gray-600 truncate">'+esc(t.name)+'</div>'+
              '<div class="text-[10px] text-gray-500">Remaining '+max+' / '+Number(t.qty||0)+' · '+(t.ready?'Ready':'Not Ready')+'</div></div>'+
            '<label class="shrink-0 text-[10px] font-bold">Invoice QTY'+
              '<input type="number" data-consolidated-line="'+esc(t.id)+'" min="0" max="'+max+'" step="1" value="'+(current.quantities.get(t.id)||0)+'" '+
              (max?'':'disabled')+' class="block mt-1 w-24 border rounded-lg p-2.5 text-sm"></label>'+
            '</div>';
        }).join('')+'</div></div>';
   }).join(''):'<p class="text-xs text-gray-500 p-3 border border-dashed rounded-lg">No additional SR selected. The current invoice will use the starting SR only.</p>';
   content.querySelectorAll('[data-combined-remove]').forEach(button=>{
      button.addEventListener('click',()=>{current.selected.delete(button.dataset.combinedRemove);drawSelected()});
   });
   content.querySelectorAll('[data-consolidated-line]').forEach(input=>input.addEventListener('input',()=>{current.quantities.set(input.dataset.consolidatedLine,Number(input.value||0));renderTotal()}));
   const opts=current.slot.querySelector('#combinedSRSelect');
   if(opts){
      opts.innerHTML='<option value="">Select another SR for this customer</option>'+
       current.candidates.filter(x=>!current.selected.has(x.id)&&eligibleLines(x).length)
        .map(x=>'<option value="'+esc(x.id)+'">'+esc(candidateName(x))+' · '+eligibleLines(x).length+' ready product line(s)</option>').join('');
   }
   renderTotal();
 }
 async function submitCombined(e,originalSubmit){
   if(!current?.selected.size)return originalSubmit.call(e.currentTarget,e);
   e.preventDefault();
   const primaryInputs=[...document.querySelectorAll('#splitInvoiceForm [data-split-idx]')];
   const primaryItems=current.primary?.items||[];
   const lines=[];
   for(const input of primaryInputs){
      const item=primaryItems[Number(input.dataset.splitIdx)];
      if(!item)continue;
      const quantity=Number(input.value||0);
      if(!int(quantity)||quantity>remaining(item))return showToast('Invalid QTY for '+item.code,'err');
      if(quantity>0){
        if(!item.ready)return showToast(item.code+' is not Ready/Arrived','err');
        lines.push({item_id:item.id,qty:quantity});
      }
   }
   if(!lines.length)return showToast('Select at least one quantity from the starting SR.','err');
   const extras=selectedRows(),selected=new Set();
   for(const item of extras){
     if(!int(item.selected_qty)||item.selected_qty<1||item.selected_qty>remaining(item)||!item.ready)
       return showToast('Invalid remaining quantity for '+item.code,'err');
     lines.push({item_id:item.id,qty:item.selected_qty});
     selected.add(item.sr_id);
   }
   if(selected.size!==current.selected.size)
     return showToast('Select at least one available quantity for each additional SR, or remove it.','err');
   if(lines.length>100)return showToast('Maximum 100 product lines per invoice.','err');
   const gifts=typeof window.getSrFreeGiftPayload==='function'?window.getSrFreeGiftPayload():[];
   if(gifts===null)return showToast('Free Gift quantities must be positive whole numbers.','err');
   const invoiceType=document.getElementById('splitType').value;
   const invoiceNo=String(document.getElementById('splitNo').value||'').trim().toUpperCase();
   if(!invoiceNo.startsWith(invoiceType))return showToast('Invoice number must begin with '+invoiceType,'err');
   const btn=document.getElementById('splitSubmit');
   if(!btn)return;
   btn.disabled=true;btn.textContent='Submitting consolidated TK/RK…';
   try{
      const r=await db.rpc('submit_sr_combined_invoice_with_gifts',{
        p_primary_sr:current.orderId,p_invoice_type:invoiceType,
        p_invoice_no:invoiceNo,
        p_sales_category:document.getElementById('splitCategory').value,
        p_lines:lines,p_gifts:gifts,p_note:document.getElementById('splitNote').value.trim()||null
      });
      if(r.error)throw r.error;
      closeModal();
      showToast(invoiceNo+' requested for '+(1+selected.size)+' SRs. Pending separate Manager/Admin approval.');
      if(window.documentFlowState)window.documentFlowState.loaded=false;
      if(typeof window.refreshApprovalNotifications==='function')await window.refreshApprovalNotifications();
      await go('sales-orders');
   }catch(err){
      showToast(err.message||'Could not request consolidated invoice','err');
      btn.disabled=false;btn.textContent='Submit TK/RK for Approval';
   }
 }
 window.openPrepareSrConversion=async function(orderId){
   current=null;
   await prevOpen.apply(this,arguments);
   const form=document.getElementById('splitInvoiceForm');
   if(!form||!form.isConnected)return;
   const root=document.createElement('section');
   root.className='mb-3';
   root.innerHTML='<div class="rounded-xl border border-blue-200 bg-blue-50/40 p-3 space-y-3">'+
     '<div><h4 class="font-bold text-sm">+ Add Another SR · Same Customer</h4>'+
     '<p class="text-[11px] text-gray-600 mt-1">Combine available quantities from other SRs under one TK/RK invoice. Each SR keeps its own DO, stock history, payments and deposit.</p></div>'+
     '<div id="combinedSRCustomer" class="text-xs text-gray-600">Finding eligible SRs…</div>'+
     '<div class="flex flex-wrap gap-2">'+
       '<select id="combinedSRSelect" class="flex-1 min-w-[190px] bg-white border rounded-xl p-2.5 text-sm" disabled><option value="">Loading eligible SRs…</option></select>'+
       '<button id="combinedSRAddBtn" type="button" class="px-3 py-2 border border-blue-300 bg-white text-blue-800 rounded-xl text-sm font-semibold" disabled>+ Add SR</button>'+
     '</div>'+
     '<div id="combinedSRSelected" class="space-y-2"></div>'+
     '<div id="combinedSRTotal" class="text-xs text-blue-900 bg-white/70 rounded-xl p-3"></div>'+
   '</div>';
   const gift=document.getElementById('srFreeGiftModule');
   if(gift)gift.before(root);else form.append(root);
   const originalSubmit=form.onsubmit;
   const originalPreview=window.updateSrSplitInvoicePreview;
   form.onsubmit=function(e){return submitCombined(e,originalSubmit)};
   try{
     const [found,primary]=await Promise.all([
       db.rpc('get_sr_combination_candidates',{p_primary_sr:orderId}),
       db.rpc('get_sr_split_invoice_summary',{p_order_id:orderId})
     ]);
     if(found.error||primary.error)throw found.error||primary.error;
     if(!root.isConnected)return;
     const info=found.data||{};
     current={
        orderId,primary:primary.data||{items:[]},
        primaryNo:'Starting SR',candidates:Array.isArray(info.candidates)?info.candidates:[],
        selected:new Map(),quantities:new Map(),slot:root
     };
     current.primary.order_discount=Number(current.primary.order_discount||0);
     root.querySelector('#combinedSRCustomer').innerHTML='Customer: <b>'+esc(info.customer_name||'Customer')+
       '</b> · '+esc(info.currency||'USD')+' · <b>Same Customer Database ID required</b>';
     root.querySelector('#combinedSRSelect').disabled=false;
     root.querySelector('#combinedSRAddBtn').disabled=false;
     root.querySelector('#combinedSRAddBtn').onclick=()=>{
       const id=root.querySelector('#combinedSRSelect').value;
       if(!id)return showToast('Select an eligible SR first.');
       if(current.selected.size>=19)return showToast('Maximum 20 SRs per invoice.','err');
       const item=current.candidates.find(x=>x.id===id);
       if(!item)return showToast('SR no longer eligible. Refresh and try again.','err');
       current.selected.set(id,true);drawSelected();
     };
     const inputs=form.querySelectorAll('[data-split-idx]');
     inputs.forEach(input=>input.addEventListener('input',renderTotal));
     if(typeof originalPreview==='function'){
       window.updateSrSplitInvoicePreview=function(){
         originalPreview.apply(this,arguments);
         renderTotal();
       };
     }
     drawSelected();
   }catch(err){
     if(root.isConnected)root.querySelector('#combinedSRCustomer').innerHTML='<span class="text-red-700">'+
        esc(err.message||'Unable to find SRs')+' · You may still prepare one SR normally.</span>';
   }
 };

 const prevApprove=window.openSrConversionApproval;
 if(typeof prevApprove==='function'){
   window.openSrConversionApproval=async function(id){
      await prevApprove.apply(this,arguments);
      const detail=await db.rpc('get_sr_split_invoice_detail',{p_id:id});
      if(detail.error||!detail.data)return;
      const sources=detail.data.source_srs||[];
      if(sources.length<2)return;
      const form=document.getElementById('srConversionApprovalForm');
      if(!form)return;
      const panel=document.createElement('div');
      panel.className='p-3 mb-3 rounded-xl border border-blue-200 bg-blue-50 text-xs';
      panel.innerHTML='<b>Combined TK/RK · '+sources.length+' Source SRs</b>'+
        '<p class="text-gray-600 mt-1 mb-2">Same customer · Each SR retains its original deposits and delivery records. Review the selected quantities from every source.</p>'+
        '<div class="divide-y border rounded-lg bg-white">'+sources.map(src=>
          '<div class="flex justify-between p-2 gap-3"><span class="font-bold">'+esc(src.no)+'</span>'+
          '<span>Invoice '+money(src.amount)+' · SR recorded payments '+money(src.payments_recorded)+'</span></div>'
        ).join('')+'</div>'+
        '<div class="mt-2 text-[11px] text-amber-800">Existing payments are not reassigned or deducted a second time from this consolidated invoice.</div>';
      form.prepend(panel);
   };
 }
 const prevOverview=window.openSrInvoiceOverview;
 if(typeof prevOverview==='function'){
   window.openSrInvoiceOverview=async function(orderId){
     await prevOverview.apply(this,arguments);
     const r=await db.rpc('get_sr_split_invoice_summary',{p_order_id:orderId});
     if(r.error||!r.data)return;
     const multi=(r.data.invoices||[]).filter(x=>(x.source_srs||[]).length>1);
     const content=document.getElementById('modalBody');
     if(!multi.length||!content)return;
     const box=document.createElement('div');
     box.className='rounded-xl border border-blue-200 bg-blue-50/40 p-3 mb-3 text-xs';
     box.innerHTML='<b>Consolidated TK/RK Invoice(s)</b>'+
      multi.map(inv=>'<div class="mt-2"><b>'+esc(inv.invoice_no)+'</b> · '+
       (inv.source_srs||[]).map(x=>esc(x.no)+' ('+money(x.amount)+')').join(' + ')+
       ' = '+money(inv.total)+'</div>').join('')+
       '<p class="text-[10px] text-gray-500 mt-2">Individual SR deposits and DOs stay on their original SRs.</p>';
     content.prepend(box);
   };
 }
})();
