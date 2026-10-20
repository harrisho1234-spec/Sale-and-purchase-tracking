// Review Showroom/Online assigned Sales changes without changing CRM customer ownership.
(function(){
  const allowed=()=>['manager','admin','super_admin'].includes(state.profile?.role||'');
  const safe=v=>esc(v==null?'':String(v));
  const fmt=v=>v?new Date(v).toLocaleString():'';
  window.openActivitySalesAssignmentApproval=async function(requestId){
    if(!allowed())return showToast('Sales Manager / Admin approval required','err');
    try{
      const r=await db.rpc('get_pending_activity_sales_assignments');
      if(r.error)throw r.error;
      const item=(r.data||[]).find(x=>String(x.request_id)===String(requestId));
      if(!item)throw new Error('This request has already been reviewed or is no longer available.');
      openModal('Review Assigned Sales',`<form id="reviewActivityAssignmentForm" class="space-y-4">
        <div class="rounded-xl bg-[#faf9f6] border p-4">
          <div class="text-[10px] uppercase font-bold text-gray-400">Customer</div>
          <b class="text-base">${safe(item.customer_name||'Customer')}</b>
          <div class="text-xs text-gray-500 mt-1">${safe(item.activity_type==='online'?'Online Inquiry':'Showroom Visit')} · ${safe(item.business_code||'')}</div>
          <div class="mt-4 rounded-lg bg-white border p-3 text-sm">
            <span class="text-gray-500">Current assignment:</span> <b>${safe(item.from_sales_name||'Unassigned')}</b>
            <div class="mt-2 text-amber-800"><span class="font-medium">Requested assignment:</span> <b>${safe(item.to_sales_name||'Sales Rep')}</b></div>
          </div>
          <div class="mt-3 text-xs text-gray-500">Requested by ${safe(item.requested_by_name||'Sales')} · ${safe(fmt(item.requested_at))}</div>
          <div class="mt-2 text-xs text-gray-700">Reason: ${safe(item.request_note||'No reason provided')}</div>
        </div>
        <div class="rounded-xl bg-blue-50 border border-blue-100 p-3 text-xs text-blue-800">
          Approving updates Showroom/Online reporting assignment only; customer master and sales order ownership stay unchanged.
        </div>
        <div><label class="text-xs font-semibold">Review note (optional)</label>
          <textarea id="activityAssignmentReviewNote" maxlength="2000" class="mt-1 w-full border rounded-xl p-3 text-sm" rows="3" placeholder="Reason for approval or rejection"></textarea>
        </div>
        <div class="grid grid-cols-2 gap-3">
          <button type="button" onclick="reviewActivitySalesAssignment('${safe(item.request_id)}','rejected')" class="rounded-xl border border-red-200 bg-red-50 text-red-700 font-bold py-3 text-sm">Reject</button>
          <button type="button" onclick="reviewActivitySalesAssignment('${safe(item.request_id)}','approved')" class="rounded-xl bg-[#211d18] text-white font-bold py-3 text-sm">Approve</button>
        </div>
      </form>`);
    }catch(err){showToast(err.message,'err')}
  };

  window.reviewActivitySalesAssignment=async function(id,decision){
    if(!allowed())return showToast('Sales Manager / Admin approval required','err');
    if(!['approved','rejected'].includes(decision))return;
    if(!window.confirm(decision==='approved'?'Approve this Showroom/Online salesperson assignment?':'Reject this salesperson assignment request?'))return;
    const buttons=[...document.querySelectorAll('#reviewActivityAssignmentForm button')];
    buttons.forEach(b=>b.disabled=true);
    try{
      const r=await db.rpc('review_activity_sales_assignment',{
        p_request_id:id,p_action:decision,
        p_review_note:document.getElementById('activityAssignmentReviewNote')?.value?.trim()||null
      });
      if(r.error)throw r.error;
      closeModal();
      showToast(decision==='approved'?'Sales assignment approved; reports now use the new rep':'Sales assignment request rejected');
      if(typeof refreshApprovalNotifications==='function')await refreshApprovalNotifications();
      if(state.page==='approvals' && typeof renderApprovals==='function')await renderApprovals();
    }catch(err){
      showToast(err.message,'err');
      buttons.forEach(b=>b.disabled=false);
    }
  };
})();