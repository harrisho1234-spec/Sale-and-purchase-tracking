// SR → multiple TK/RK invoices: one SR, partial line quantities, independent approval.
(function(){
 'use strict';
 const allowPrepare=()=>['sales','manager','admin','super_admin'].includes(String(state?.profile?.role||''))&&
   (typeof window.hasAppPermission!=='function'||window.hasAppPermission('sales_orders.convert_request'));
 const canReview=()=>['manager','admin','super_admin'].includes(String(state?.profile?.role||''))&&
   (typeof window.hasAppPermission!=='function'||window.hasAppPermission('sales_orders.convert_approve'));
 const h=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const moneyN=v=>'$'+Number(v||0).toFixed(2);
 const safeCount=v=>Number(v||0);
 let shownOrder=null,listing=null;
 const knownNumber=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
 const optionalLine=(label,value)=>value===null||value===undefined||String(value).trim()===''?'':'<div class="text-[11px] text-gray-600"><b>'+h(label)+':</b> '+h(value)+'</div>';
 const lineDetail=l=>{
   const price=l.unit_price??l.price;
   const discount=l.discount_amount??l.item_discount??l.line_discount;
   const total=l.line_total??l.total;
   return '<div class="border-t py-2 text-xs flex flex-col sm:flex-row justify-between gap-2">'+
     '<div class="min-w-0"><b>'+h(l.code||l.product_code||'Item')+'</b> · '+h(l.name||l.item_name||'')+
       optionalLine('Item note',l.notes??l.note)+'</div>'+
     '<div class="sm:text-right shrink-0">Qty '+safeCount(l.qty)+
     (knownNumber(price)?' · Unit '+moneyN(price):'')+
     (knownNumber(discount)?' · Discount −'+moneyN(discount):'')+
     (knownNumber(total)?' · Net '+moneyN(total):'')+'</div></div>';
 };
 const htmlInvoices=s=>{
   const inv=Array.isArray(s?.invoices)?s.invoices:[];
   return inv.length?'<div class="space-y-2">'+inv.map(i=>{
     const lines=Array.isArray(i.lines)?i.lines:[];
     const discount=i.order_discount??i.discount_amount;
     const submitted=i.submitted_at??i.requested_at??i.created_at;
     const review=i.review_note??i.approval_note;
     const approver=i.discount_approved_by??i.discount_approver;
     return '<details class="rounded-xl border bg-white group">'+
       '<summary class="list-none cursor-pointer p-3 flex flex-wrap justify-between gap-3 items-center">'+
         '<div><div class="text-xs font-bold">'+h(i.invoice_no||'Pending invoice')+' · '+h(String(i.status||'unknown').toUpperCase())+'</div>'+
         '<div class="text-[10px] text-gray-500">'+lines.map(l=>h(l.code||l.product_code||'Item')+' × '+safeCount(l.qty)).join(' · ')+'</div></div>'+
         '<div class="text-right"><div class="text-sm font-bold">'+(knownNumber(i.total)?moneyN(i.total):'Total unavailable')+'</div><div class="text-[10px] text-blue-700">View Invoice Breakdown ▾</div></div>'+
       '</summary>'+
       '<div class="border-t px-3 py-3 space-y-2">'+
         '<div class="text-[10px] font-bold uppercase text-gray-500">Invoice items</div>'+
         (lines.length?lines.map(lineDetail).join(''):'<p class="text-xs text-gray-500">Item breakdown is not available in this invoice summary.</p>')+
         '<div class="rounded-lg border bg-gray-50 p-3 grid grid-cols-2 gap-3 text-xs">'+
           (knownNumber(i.subtotal)?'<div>Subtotal <b>'+moneyN(i.subtotal)+'</b></div>':'')+
           (knownNumber(discount)?'<div>Order discount <b>−'+moneyN(discount)+'</b></div>':'')+
           '<div>Invoice total <b>'+(knownNumber(i.total)?moneyN(i.total):'Not available')+'</b></div>'+
           (knownNumber(i.deposit_applied)?'<div>Deposit applied <b>'+moneyN(i.deposit_applied)+'</b></div>':'')+
           (knownNumber(i.balance_due)?'<div>Remaining balance <b>'+moneyN(i.balance_due)+'</b></div>':'')+
         '</div>'+
         optionalLine('Invoice note',i.notes??i.note)+
         optionalLine('Note to approver',i.request_note??i.approver_note)+
         optionalLine('Review note',review)+
         optionalLine('Discount approved by',approver)+
         optionalLine('Submitted at',submitted)+
         '<div class="text-[10px] text-gray-500">Fields not recorded in the linked invoice summary are omitted. SR deposit and discounts remain separate from invoice amounts.</div>'+
       '</div></details>';
   }).join('')+'</div>':
   '<div class="text-xs text-gray-500">No split TK/RK invoices requested yet.</div>';
 };
 window.openSrInvoiceOverview=async function(orderId){
   const r=await db.rpc('get_sr_split_invoice_summary',{p_order_id:orderId});
   if(r.error)return showToast(r.error.message,'err');
   if(!r.data)return showToast('SR not found or not accessible.','err');
   const s=r.data,items=Array.isArray(s.items)?s.items:[],invoices=Array.isArray(s.invoices)?s.invoices:[];
   const all=items.reduce((n,t)=>n+Number(t.qty||0),0),issued=items.reduce((n,t)=>n+Number(t.issued_qty||0),0);
   openModal('SR → Linked TK/RK Invoices','<div class="space-y-4">'+
     '<div class="rounded-xl border bg-blue-50 p-3 text-xs text-blue-900"><b>'+invoices.filter(x=>x.status==='issued').length+' issued</b> · '+invoices.filter(x=>x.status==='pending').length+' awaiting approval · <b>'+issued+'/'+all+' pieces invoiced</b>. Original SR and deposit remain unchanged.</div>'+
     htmlInvoices(s)+
     '<div><h4 class="font-bold mb-2">SR Line Quantities</h4><div class="divide-y border rounded-xl">'+items.map(t=>
       '<div class="p-3 flex justify-between text-xs gap-3"><div class="min-w-0"><b>'+h(t.code)+'</b> · '+h(t.name)+'</div>'+
       '<div class="shrink-0">'+safeCount(t.issued_qty)+' issued · '+safeCount(t.pending_qty)+' pending · <b>'+Math.max(0,safeCount(t.qty)-safeCount(t.issued_qty)-safeCount(t.pending_qty))+' available</b></div></div>'
     ).join('')+'</div></div>'+
     (allowPrepare()?'<button type="button" onclick="openPrepareSrConversion(\''+h(orderId)+'\')" class="bg-[#211d18] text-white rounded-xl w-full py-3 font-semibold">Prepare Next TK/RK Invoice</button>':'')+
   '</div>');
 };
 window.openPrepareSrConversion=async function(orderId){
   if(!allowPrepare())return showToast('Permission to prepare TK/RK invoice required','err');
   const [o,s]=await Promise.all([
     db.from('sales_orders').select('id,sr_no,order_no,sales_rep_id,sales_invoice_no,sales_category,sales_flow_type,status').eq('id',orderId).single(),
     db.rpc('get_sr_split_invoice_summary',{p_order_id:orderId})
   ]);
   if(o.error||s.error)return showToast(o.error?.message||s.error?.message,'err');
   if(o.data?.sales_flow_type!=='pre_order'||o.data?.status==='cancelled'||o.data?.sales_invoice_no)
     return showToast('This SR is already finalized or not eligible for split invoicing.','err');
   if(state.profile?.role==='sales'&&String(o.data.sales_rep_id)!==String(state.user?.id))
     return showToast('Only assigned Sales can prepare an invoice for their SR.','err');
   const rows=Array.isArray(s.data?.items)?s.data.items:[];
   const existing=Array.isArray(s.data?.invoices)?s.data.invoices:[];
   const choices=rows.map(t=>({
      ...t,remaining:Math.max(0,safeCount(t.qty)-safeCount(t.issued_qty)-safeCount(t.pending_qty))
   }));
   if(!choices.some(t=>t.remaining>0&&t.ready))
      return showToast('No Ready/Arrived SR item has remaining quantity for a new invoice.','err');
   if(existing.some(t=>t.status==='pending'))
      return showToast('Review the pending TK/RK invoice first. Then prepare the next invoice.','err');
   shownOrder=orderId;listing=choices;window._currentSRDiscount=Number(s.data?.order_discount||0);
   openModal('Prepare SR → TK/RK · Multiple Invoices','<form id="splitInvoiceForm" class="space-y-4">'+
    '<div class="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs"><b>SR '+h(o.data.sr_no||o.data.order_no)+'</b> · Create another TK/RK invoice for selected products or partial quantities. A different Manager/Admin must approve it before it is officially issued. <b>Do not recreate the sale or deposit.</b></div>'+
    '<div class="grid grid-cols-2 gap-3">'+
       '<label class="text-xs font-bold">Invoice Type<select id="splitType" class="mt-1 w-full rounded-lg border p-2.5 bg-white"><option value="TK">TK · Limperial Luxury</option><option value="RK">RK · LP Home</option></select></label>'+
       '<label class="text-xs font-bold">Category<select id="splitCategory" class="mt-1 w-full rounded-lg border p-2.5 bg-white"><option value="standard"'+(o.data.sales_category==='project'?'':' selected')+'>Standard</option><option value="project"'+(o.data.sales_category==='project'?' selected':'')+'>Project (PJ)</option></select></label>'+
    '</div>'+
    '<div><label class="text-xs font-bold">New Official TK/RK Number *</label><input id="splitNo" maxlength="80" required placeholder="TK2610-010 or RK2610-010" class="w-full mt-1 border rounded-lg p-3"></div>'+
    '<div><h4 class="font-bold text-sm">Select Items / Quantities to Invoice</h4>'+
      '<p class="text-xs text-gray-500 mt-1 mb-2">Only Ready/Arrived items can be invoiced. You may select fewer than the SR quantity; the remainder stays available for the next TK/RK.</p>'+
      '<div class="max-h-72 overflow-auto divide-y border rounded-xl">'+choices.map((t,i)=>
       '<div class="p-3 flex flex-col sm:flex-row sm:items-center gap-3">'+
        (t.image?'<img class="h-12 w-12 object-contain rounded-lg border bg-white" src="'+h(t.image)+'" onerror="this.style.display=\'none\'">':'')+
        '<div class="min-w-0 flex-1 text-xs"><div class="font-bold">'+h(t.code)+' · '+h(t.name)+'</div>'+
        '<div class="text-[10px] text-gray-500">SR: '+safeCount(t.qty)+' · Issued: '+safeCount(t.issued_qty)+' · Pending: '+safeCount(t.pending_qty)+
        ' · Remaining: '+t.remaining+' · '+(t.ready?'Ready':'Not Ready')+' · '+moneyN(t.unit_price)+'/pc</div></div>'+
        '<div class="w-32"><label class="text-[10px] font-bold text-gray-600">Invoice QTY</label>'+
        '<input data-split-idx="'+i+'" type="number" min="0" step="1" max="'+(t.ready?t.remaining:0)+'" value="0" '+(!t.ready||!t.remaining?'disabled':'')+
        ' class="w-full border rounded-lg p-2.5 mt-1 text-sm" oninput="updateSrSplitInvoicePreview()"></div></div>'
       ).join('')+'</div>'+
    '</div>'+
    '<div id="srFreeGiftModule" class="mb-3"></div>'+ 
    '<div id="srSplitTotal" class="p-3 rounded-lg border bg-gray-50 text-xs font-bold">Selected: 0 pcs</div>'+
    '<div><label class="text-xs font-bold">Note to Approver</label><textarea id="splitNote" maxlength="2000" rows="2" class="mt-1 w-full border rounded-lg p-3"></textarea></div>'+
    '<button id="splitSubmit" class="bg-[#211d18] text-white w-full rounded-xl py-3 font-semibold">Submit TK/RK for Approval</button>'+
   '</form>');
   if(typeof window.initSrFreeGiftUI==='function')window.initSrFreeGiftUI();
   document.getElementById('splitInvoiceForm').onsubmit=submit;
   window.updateSrSplitInvoicePreview();
 };
 window.updateSrSplitInvoicePreview=function(){
   if(!listing)return;
   let pcs=0,total=0;
   for(const inp of document.querySelectorAll('[data-split-idx]')){
     const t=listing[Number(inp.dataset.splitIdx)],qty=Number(inp.value||0);
     if(!t||qty<=0)continue;
     pcs+=qty;const gross=listing.reduce((sum,row)=>sum+Number(row.line_total||0),0);
     const discount=Number(window._currentSRDiscount||0);
     const itemGross=Number(t.line_total||0);
     total+=(itemGross-(gross>0?discount*itemGross/gross:0))*(qty/Number(t.qty||1));
   }
   const div=document.getElementById('srSplitTotal');
   if(div)div.textContent='Selected: '+pcs+' pcs · Approx. line value '+moneyN(total)+' (original SR deposit/discount remain on the SR)';
 };
 async function submit(e){
   e.preventDefault();
   const lines=[],inputs=[...document.querySelectorAll('[data-split-idx]')];
   for(const inp of inputs){
      const t=listing[Number(inp.dataset.splitIdx)],qty=Number(inp.value||0);
      if(!Number.isSafeInteger(qty)||qty<0||qty>t.remaining)
       return showToast('Invalid quantity for '+t.code+'; maximum remaining '+t.remaining,'err');
      if(qty>0){if(!t.ready)return showToast(t.code+' is not Ready yet','err');lines.push({item_id:t.id,qty});}
   }
   if(!lines.length)return showToast('Choose at least one product and a positive quantity','err');
   const freeGifts=typeof window.getSrFreeGiftPayload==='function'?window.getSrFreeGiftPayload():[];
   if(freeGifts===null)return showToast('Free Gift QTY must be a whole number from 1 to 10000.','err');
   const type=document.getElementById('splitType').value,
     no=String(document.getElementById('splitNo').value||'').trim().toUpperCase();
   if(!no.startsWith(type))return showToast('Invoice number must begin with '+type,'err');
   const btn=document.getElementById('splitSubmit');
   btn.disabled=true;btn.textContent='Submitting...';
   try{
    const r=await db.rpc('submit_sr_split_invoice_with_gifts',{ 
      p_order_id:shownOrder,p_invoice_type:type,p_invoice_no:no,
      p_sales_category:document.getElementById('splitCategory').value,
      p_lines:lines,p_gifts:freeGifts,p_note:document.getElementById('splitNote').value.trim()||null
    });
    if(r.error)throw r.error;
    closeModal();
    showToast('TK/RK '+no+' submitted for approval. Free gifts remain proposed until approved, then can be requested on a normal DO.');
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    if(typeof window.refreshApprovalNotifications==='function')await window.refreshApprovalNotifications();
    await go('sales-orders');
   }catch(err){showToast(err.message||'Could not submit split invoice','err');btn.disabled=false;btn.textContent='Submit TK/RK for Approval'}
 }
 const baseReviewOpen=window.openSrConversionApproval;
 if(typeof baseReviewOpen==='function'){
   window.openSrConversionApproval=async function(id){
     const r=await db.rpc('get_sr_split_invoice_detail',{p_id:id});
     if(r.error)return showToast(r.error.message,'err');
     await baseReviewOpen.apply(this,arguments);
     if(!r.data)return;
     const body=document.getElementById('srConversionApprovalForm');
     if(!body)return;
     const box=document.createElement('div');
     box.className='border rounded-xl p-3 bg-amber-50/50 text-xs';
     box.innerHTML='<div class="font-bold text-sm">Partial / Multiple SR Invoice · '+h(r.data.invoice_no)+'</div>'+
       '<div class="mt-1 mb-2 text-gray-500">Approve only these SR line quantities. The other quantities remain available for later invoices; the SR deposit is not duplicated.</div>'+
       '<div class="divide-y border rounded-lg bg-white">'+(r.data.lines||[]).map(l=>
       '<div class="flex justify-between gap-3 p-2"><span>'+h(l.code)+' · '+h(l.name)+' × '+safeCount(l.qty)+'</span><b>'+moneyN(l.amount)+'</b></div>'
       ).join('')+'</div><div class="mt-2 text-right font-bold">Invoice value: '+moneyN(r.data.invoice_total)+'</div>';
     const prompt=body.querySelector('.border-blue-100');
     if(prompt)prompt.after(box);else body.prepend(box);
   };
 }
 const baseReview=window.reviewSrConversion;
 if(typeof baseReview==='function'){
   window.reviewSrConversion=async function(id,action){
     const chk=await db.rpc('get_sr_split_invoice_detail',{p_id:id});
     if(chk.error)return showToast(chk.error.message||'Could not verify invoice request','err');
     if(!chk.data)return baseReview.apply(this,arguments);
     if(!canReview())return showToast('Manager/Admin approval permission required','err');
     if(!['approved','rejected'].includes(action))return;
     if(!confirm(action==='approved'?'Approve and issue '+chk.data.invoice_no+' for ONLY the selected SR quantities?':'Reject '+chk.data.invoice_no+'?'))return;
     const buttons=[...document.querySelectorAll('#srConversionApprovalForm button')];buttons.forEach(b=>b.disabled=true);
     try{
       const note=document.getElementById('srConversionReviewNote')?.value?.trim()||null;
       const r=await db.rpc('review_sr_split_invoice',{p_request_id:id,p_approve:action==='approved',p_note:note});
       if(r.error)throw r.error;
       closeModal();
       showToast(action==='approved'?'TK/RK issued. Approved free gifts can now be requested on a normal Delivery Order; stock OUT occurs on DO release.':'Invoice rejected; any proposed free gifts were not added to the SR or stock.');
       if(window.documentFlowState)window.documentFlowState.loaded=false;
       if(typeof window.refreshApprovalNotifications==='function')await window.refreshApprovalNotifications();
       if(state.page==='approvals'&&typeof renderApprovals==='function')await renderApprovals();
     }catch(err){showToast(err.message||'Review failed','err');buttons.forEach(b=>b.disabled=false)}
   };
 }
})();
