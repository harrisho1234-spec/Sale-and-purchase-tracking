// Sales payment/deposit approval workflow.
(function(){
  function role(){return state.profile&&state.profile.role||''}
  function isSales(){return role()==='sales'}
  function reviewer(){return ['manager','admin','super_admin'].indexOf(role())>=0}
  function clean(v){return String(v==null?'':v).trim()}
  function n(v){var x=Number(v||0);return Number.isFinite(x)?x:0}

  async function submitRequest(orderId,amount,date,method,reference,notes){
    var r=await db.rpc('submit_sales_payment_request',{
      p_order_id:orderId,
      p_amount:amount,
      p_payment_date:date,
      p_method:method||null,
      p_reference_no:reference||null,
      p_notes:notes||null
    });
    if(r.error)throw r.error;
    return r.data;
  }
  window.submitSalesPaymentRequest=submitRequest;

  var oldSaveCP=window.saveCP;
  window.saveCP=async function(e){
    if(!isSales())return oldSaveCP.apply(this,arguments);
    e.preventDefault();
    var list=window._cp||[];
    var order=list.find(function(x){return x.id===cpOrder.value});
    var amount=n(cpAmount.value);
    if(!order||amount<=0)return showToast('Enter a payment amount.','err');
    if(amount>n(order.balance_due)+0.001)return showToast('Payment cannot be more than balance.','err');
    try{
      await submitRequest(order.id,amount,cpDate.value,clean(cpMethod.value),clean(cpRef.value),clean(cpNote.value)||'Additional customer payment');
    }catch(err){return showToast(err.message,'err')}
    closeModal();
    showToast('Payment request submitted for Manager/Admin approval. AR is unchanged until approval.');
    if(typeof refreshApprovalNotifications==='function')refreshApprovalNotifications();
    await go('payments');
  };

  var oldOpenAdd=window.openAddCustomerPayment;
  if(typeof oldOpenAdd==='function'){
    window.openAddCustomerPayment=async function(){
      var out=await oldOpenAdd.apply(this,arguments);
      if(!isSales())return out;
      var form=document.getElementById('cpForm');
      if(!form)return out;
      var banner=document.createElement('div');
      banner.className='md:col-span-2 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800';
      banner.innerHTML='<b>Approval required.</b> This payment will remain pending until Manager/Admin approves it. Received and AR will not change yet.';
      form.insertBefore(banner,form.firstChild);
      var btn=form.querySelector('button:not([type="button"])');
      if(btn)btn.textContent='Submit Payment Request';
      return out;
    };
  }

  var oldQuick=window.openSalesQuickPayment;
  if(typeof oldQuick==='function'){
    window.openSalesQuickPayment=async function(orderId){
      var out=await oldQuick.apply(this,arguments);
      if(!isSales())return out;
      var form=document.getElementById('quickPaymentForm');
      if(!form)return out;
      var balance=n(document.getElementById('quickPayAmount')&&document.getElementById('quickPayAmount').max);
      var noteBox=form.querySelector('.bg-amber-50');
      if(noteBox)noteBox.innerHTML='<b>Approval required.</b> This payment request will not update Paid or AR until Manager/Admin approves it.';
      var btn=form.querySelector('button:not([type="button"])');
      if(btn)btn.textContent='Submit Payment Request';
      form.onsubmit=async function(e){
        e.preventDefault();
        var amount=n(document.getElementById('quickPayAmount').value);
        if(amount<=0)return showToast('Enter a payment amount.','err');
        if(balance>0&&amount>balance+0.001)return showToast('Payment cannot be more than the balance.','err');
        try{
          await submitRequest(
            orderId,
            amount,
            document.getElementById('quickPayDate').value,
            clean(document.getElementById('quickPayMethod').value),
            clean(document.getElementById('quickPayRef').value),
            clean(document.getElementById('quickPayNote').value)||'Additional deposit / payment'
          );
        }catch(err){return showToast(err.message,'err')}
        closeModal();
        showToast('Payment request submitted for Manager/Admin approval. AR is unchanged until approval.');
        if(typeof refreshApprovalNotifications==='function')refreshApprovalNotifications();
        await go('sales-orders');
      };
      return out;
    };
  }

  async function visibleRequests(status){
    var r=await db.rpc('get_visible_sales_payment_requests',{p_status:status==null?null:status});
    if(r.error)throw r.error;
    return r.data||[];
  }
  window.loadVisibleSalesPaymentRequests=visibleRequests;

  var oldPayments=window.renderPayments;
  if(typeof oldPayments==='function'){
    window.renderPayments=async function(){
      var out=await oldPayments.apply(this,arguments);
      if(!isSales())return out;
      var pending=[];
      try{pending=await visibleRequests('pending')}catch(err){console.warn('Payment requests:',err.message)}
      var addBtn=[].slice.call(document.querySelectorAll('#content button')).find(function(b){return b.getAttribute('onclick')==='openAddCustomerPayment()'});
      if(addBtn)addBtn.textContent='+ Submit Payment Request';
      var root=document.getElementById('content');
      if(root){
        var box=document.createElement('div');
        box.className='mb-4 card rounded-2xl overflow-hidden';
        var rows=pending.length?pending.map(function(x){
          return '<div class="p-4 grid md:grid-cols-[1fr_120px_120px_1fr] gap-3 items-center"><div><b>'+esc(x.document_no||'Order')+'</b><div class="text-[10px] text-gray-400">'+esc(x.customer_name||'')+'</div></div><div class="text-sm">'+esc(x.payment_date||'')+'</div><div class="font-bold text-amber-700">'+money(x.amount,x.currency||'USD')+'</div><div class="text-xs text-gray-500">'+esc(x.method||'-')+(x.reference_no?' · '+esc(x.reference_no):'')+'</div></div>';
        }).join(''):'<div class="p-5 text-center text-sm text-gray-400">No pending payment requests.</div>';
        box.innerHTML='<div class="p-4 border-b bg-amber-50 flex items-center justify-between gap-3"><div><h3 class="font-bold">My Pending Payment Requests</h3><p class="text-[10px] text-gray-500">These do not affect Received / AR until approved.</p></div><span class="px-2 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-bold">'+pending.length+'</span></div><div class="divide-y">'+rows+'</div>';
        root.insertBefore(box,root.firstChild);
      }
      return out;
    };
  }

  window.openSalesPaymentRequestDetail=async function(id){
    if(!reviewer())return showToast('Manager/Admin access required.','err');
    var list;
    try{list=await visibleRequests(null)}catch(err){return showToast(err.message,'err')}
    var r=list.find(function(x){return x.request_id===id});
    if(!r)return showToast('Payment request not found.','err');

    var html=''
      +'<form id="paymentRequestReviewForm" class="space-y-4">'
      +'<div class="rounded-xl border border-amber-200 bg-amber-50 p-4"><div class="text-[10px] uppercase font-bold text-amber-700">Pending Payment</div><div class="text-xl font-bold mt-1">'+esc(r.document_no||'Order')+'</div><div class="text-xs text-gray-500 mt-1">'+esc(r.customer_name||'Customer')+' · '+esc(r.sales_rep_name||'Sales Rep')+'</div><div class="text-[10px] text-gray-400 mt-1">Requested by '+esc(r.requested_by_name||'Sales')+' · '+esc(new Date(r.requested_at).toLocaleString())+'</div></div>'
      +'<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Review and adjust before posting.</b> Current live balance: '+money(r.current_balance,r.currency||'USD')+'.</div>'
      +'<div class="grid md:grid-cols-2 gap-3">'
      +'<div><label class="text-xs font-semibold">Payment Amount</label><input id="prAmount" type="number" min="0.01" max="'+n(r.current_balance)+'" step="0.01" value="'+n(r.amount)+'" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>'
      +'<div><label class="text-xs font-semibold">Payment Date</label><input id="prDate" type="date" value="'+esc(r.payment_date||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>'
      +'<div><label class="text-xs font-semibold">Method</label><input id="prMethod" value="'+esc(r.method||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Cash, ABA, Bank Transfer"></div>'
      +'<div><label class="text-xs font-semibold">Reference</label><input id="prRef" value="'+esc(r.reference_no||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2.5"></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Payment Note</label><textarea id="prNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5">'+esc(r.notes||'')+'</textarea></div>'
      +'<div class="md:col-span-2"><label class="text-xs font-semibold">Reviewer Note</label><textarea id="prReviewNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2.5" placeholder="Optional for approval; required for rejection."></textarea></div>'
      +'</div>'
      +'<div class="flex justify-end gap-2 border-t pt-4"><button type="button" onclick="reviewSalesPaymentRequest(\''+r.request_id+'\',\'reject\')" class="px-4 py-2.5 border border-red-200 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Reject</button><button type="button" onclick="reviewSalesPaymentRequest(\''+r.request_id+'\',\'approve\')" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Approve & Post Payment</button></div>'
      +'</form>';
    openModal('Review Payment Request',html);
  };

  window.reviewSalesPaymentRequest=async function(id,action){
    if(!reviewer())return showToast('Manager/Admin access required.','err');
    var note=clean(document.getElementById('prReviewNote')&&document.getElementById('prReviewNote').value);
    if(action==='reject'&&!note)return showToast('Enter a rejection reason.','err');

    var amount=null,date=null,method=null,ref=null,paymentNote=null;
    if(action==='approve'){
      amount=n(document.getElementById('prAmount').value);
      date=document.getElementById('prDate').value;
      method=clean(document.getElementById('prMethod').value)||null;
      ref=clean(document.getElementById('prRef').value)||null;
      paymentNote=clean(document.getElementById('prNote').value)||null;
      if(amount<=0)return showToast('Payment amount must be greater than zero.','err');
      if(!date)return showToast('Payment date is required.','err');
    }

    if(!confirm(action==='approve'?'Approve and post this payment to the live order?':'Reject this payment request?'))return;

    var x=await db.rpc('review_sales_payment_request',{
      p_request_id:id,
      p_action:action,
      p_review_note:note||null,
      p_final_amount:amount,
      p_final_payment_date:date,
      p_final_method:method,
      p_final_reference_no:ref,
      p_final_notes:paymentNote
    });
    if(x.error)return showToast(x.error.message,'err');
    closeModal();
    showToast(action==='approve'?'Payment approved and posted':'Payment request rejected');
    if(typeof refreshApprovalNotifications==='function')await refreshApprovalNotifications();
    await go('approvals');
  };
})();