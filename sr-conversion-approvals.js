// Manager/Admin review of Sales-prepared SR → TK/RK invoice conversion.
(function(){
  function allowed(){
    return ['manager','admin','super_admin'].includes(state.profile?.role||'')
      && (typeof window.hasAppPermission==='function'
         ? window.hasAppPermission('sales_orders.convert_approve') : false);
  }
  function txt(s){return esc(s==null?'':String(s))}
  window.openSrConversionApproval=async function(id){
    if(!allowed())return showToast('TK/RK conversion approval permission is required','err');
    const r=await db.rpc('get_pending_sr_conversion_requests');
    if(r.error)return showToast(r.error.message,'err');
    const item=(r.data||[]).find(x=>String(x.request_id)===String(id));
    if(!item)return showToast('This conversion request is no longer pending','err');
    openModal('Review SR → TK/RK Conversion',`<form id="srConversionApprovalForm" class="space-y-4">
      <div class="rounded-xl border bg-[#faf9f6] p-4">
        <div class="text-[10px] uppercase font-bold text-gray-500">Original Sales Request</div>
        <div class="text-lg font-bold">${txt(item.sr_no)}</div>
        <div class="text-sm text-gray-600 mt-1">Customer: ${txt(item.customer_name||'Customer')}</div>
        <div class="text-xs text-gray-500 mt-1">Salesperson: ${txt(item.sales_rep_name||'Sales')}</div>
        <div class="mt-3 border rounded-lg bg-white p-3">
          <div class="text-[10px] uppercase font-bold text-gray-500">Proposed Final Invoice (not yet issued)</div>
          <div class="font-bold text-base mt-1">${txt(item.invoice_no)}</div>
          <div class="text-xs mt-1">${txt(item.invoice_type==='TK'?'Limperial Luxury (TK)':'LP Home (RK)')} · ${txt(item.sales_category==='project'?'Project (PJ)':'Standard')}</div>
        </div>
        <div class="text-xs text-gray-600 mt-3">Requested by: ${txt(item.requested_by_name)} · ${txt(item.requested_at?new Date(item.requested_at).toLocaleString():'')}</div>
        <div class="text-xs text-gray-600 mt-1">Note: ${txt(item.request_note||'None')}</div>
      </div>
      <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">
        Approval issues this final TK/RK immediately, while preserving the original SR.
        The server rechecks item readiness and invoice number uniqueness. No inventory or payment data changes.
      </div>
      ${String(item.requested_by)===String(state.user?.id||'')?'<div class="text-red-600 text-xs font-bold">You cannot approve your own request.</div>':''}
      <div><label class="text-xs font-semibold">Approval / rejection note (optional)</label>
        <textarea id="srConversionReviewNote" rows="3" maxlength="2000" class="mt-1 w-full rounded-xl border p-3 text-sm"></textarea></div>
      <div class="grid grid-cols-2 gap-3">
        <button type="button" class="border rounded-xl py-3 text-red-700 font-semibold" onclick="reviewSrConversion('${txt(item.request_id)}','rejected')">Reject</button>
        <button type="button" class="rounded-xl py-3 bg-[#211d18] text-white font-semibold" onclick="reviewSrConversion('${txt(item.request_id)}','approved')">Approve &amp; Issue TK/RK</button>
      </div>
    </form>`);
  };

  window.reviewSrConversion=async function(id,action){
    if(!allowed())return showToast('Manager/Admin approval permission required','err');
    if(!['approved','rejected'].includes(action))return;
    if(!window.confirm(action==='approved'
      ?'Approve and officially issue this TK/RK invoice now?'
      :'Reject this SR to TK/RK conversion request?'))return;
    const buttons=[...document.querySelectorAll('#srConversionApprovalForm button')];
    buttons.forEach(b=>b.disabled=true);
    try{
      const note=document.getElementById('srConversionReviewNote')?.value?.trim()||null;
      const r=await db.rpc('review_sr_conversion_request',{
        p_request_id:id,p_action:action,p_note:note
      });
      if(r.error)throw r.error;
      closeModal();
      showToast(action==='approved'
        ?'Final TK/RK invoice approved and officially issued. Original SR preserved.'
        :'TK/RK conversion rejected; Sales can prepare another request.');
      if(window.documentFlowState)window.documentFlowState.loaded=false;
      if(typeof refreshApprovalNotifications==='function')await refreshApprovalNotifications();
      if(state.page==='approvals' && typeof renderApprovals==='function')await renderApprovals();
    }catch(err){showToast(err.message||'Review failed','err');buttons.forEach(b=>b.disabled=false)}
  };
})();