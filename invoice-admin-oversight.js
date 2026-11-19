// Super Admin oversight for Admin/Super Admin invoice corrections and permanent deletions.
// Data stays in the existing authenticated sales_invoice_admin_audit table.
(function(){
  const superOnly=()=>state?.profile?.role==='super_admin';
  const escHtml=value=>String(value==null?'':value).replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money=v=>Number.isFinite(Number(v))?'$'+Number(v).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2}):'—';
  let current='pending',saving=false,sequence=0;

  function summarize(record){
    const order=record&&record.order||{};
    const items=Array.isArray(record?.items)?record.items:[];
    const total=order.order_total!=null?money(order.order_total):'—';
    return '<div class="grid sm:grid-cols-3 gap-2 mt-2 text-xs">'+
       '<div><span class="text-gray-500">Order total</span><b class="block">'+total+'</b></div>'+
       '<div><span class="text-gray-500">Status</span><b class="block">'+escHtml(order.status||'—')+'</b></div>'+
       '<div><span class="text-gray-500">Items</span><b class="block">'+items.length+'</b></div></div>'+
       '<div class="text-[11px] mt-2 break-words">'+
       items.slice(0,30).map(i=>'<p class="mt-1">'+escHtml(i.product_code_snapshot||i.item_name_snapshot||'Item')+
        ' · Qty '+escHtml(i.qty)+' · Unit '+money(i.unit_price)+' · Discount '+money(i.discount_amount)+'</p>').join('')+
       (items.length>30?'<p>Additional items omitted from preview</p>':'')+'</div>';
  }

  function renderEvent(e){
    const isReviewed=!!e.reviewed_at;
    const before=e.old_data||{},after=e.new_data||{};
    const by=e.actor_email||e.actor_user_id||'Unknown actor';
    return '<article class="border rounded-xl bg-white p-3">'+
      '<div class="flex flex-wrap items-start justify-between gap-2"><div>'+
        '<b class="text-sm">'+escHtml(e.invoice_no||e.order_no||e.sales_order_id||'Invoice')+'</b>'+
        '<div class="text-[11px] text-gray-500 mt-1">'+escHtml(e.action==='delete'?'Permanent deletion':'Invoice edit')+
        ' · '+escHtml(e.created_at||'')+'</div>'+
      '</div><span class="text-[10px] px-2 py-1 rounded-lg '+(isReviewed?'bg-green-50 text-green-700':'bg-amber-50 text-amber-800')+'">'+
        (isReviewed?'Reviewed':'Awaiting review')+'</span></div>'+
      '<p class="text-xs mt-2"><b>Changed by:</b> '+escHtml(by)+'</p>'+
      '<p class="text-xs mt-1"><b>Reason:</b> '+escHtml(e.reason||'(No reason supplied)')+'</p>'+
      '<details class="mt-3 border rounded-lg p-2"><summary class="text-xs font-semibold cursor-pointer">Compare original and updated invoice</summary>'+
        '<div class="grid md:grid-cols-2 gap-3 mt-2">'+
          '<div class="bg-gray-50 border rounded-lg p-3"><b class="text-xs">Before</b>'+summarize(before)+'</div>'+
          '<div class="bg-gray-50 border rounded-lg p-3"><b class="text-xs">'+(e.action==='delete'?'After deletion':'After')+'</b>'+
            (after?summarize(after):'<p class="text-xs mt-2">Invoice deleted. Original transaction snapshot remains in the audit log.</p>')+
          '</div></div>'+
        '<details class="mt-3"><summary class="text-[11px] cursor-pointer">Complete audit data</summary>'+
          '<div class="grid md:grid-cols-2 gap-2 mt-2">'+
            '<pre class="text-[10px] bg-gray-50 p-2 rounded-lg max-h-[260px] overflow-auto whitespace-pre-wrap break-all">'+escHtml(JSON.stringify(before,null,2))+'</pre>'+
            '<pre class="text-[10px] bg-gray-50 p-2 rounded-lg max-h-[260px] overflow-auto whitespace-pre-wrap break-all">'+escHtml(JSON.stringify(after,null,2))+'</pre>'+
          '</div></details>'+
      '</details>'+
      (isReviewed?'<p class="text-[11px] mt-3 text-green-700">Reviewed '+escHtml(e.reviewed_at)+' · '+escHtml(e.review_note||'')+'</p>':
      '<button type="button" class="mt-3 rounded-lg bg-[#211d18] text-white px-3 py-2 text-xs font-semibold" onclick="reviewAdminInvoiceAuditEvent(\''+escHtml(e.id)+'\')">Mark Reviewed</button>')+
      '</article>';
  }

  async function refresh(){
    if(!superOnly())return;
    const seq=++sequence;
    const target=document.getElementById('invoiceAdminReviewResults');
    if(!target)return;
    target.innerHTML='<p class="p-3 text-xs text-gray-500">Loading invoice audit events…</p>';
    try{
      let q=db.from('sales_invoice_admin_audit')
        .select('id,sales_order_id,invoice_no,order_no,action,actor_user_id,actor_email,reason,old_data,new_data,created_at,reviewed_at,reviewed_by,review_note')
        .order('created_at',{ascending:false})
        .limit(150);
      if(current==='pending')q=q.is('reviewed_at',null);
      const {data,error}=await q;
      if(error)throw error;
      if(seq!==sequence||!document.getElementById('invoiceAdminReviewResults'))return;
      document.getElementById('invoiceAdminReviewResults').innerHTML=
        '<p class="text-xs text-gray-500 mb-3">Showing '+(data||[]).length+' most recent '+(current==='pending'?'unreviewed':'')+' invoice events. Every action retains its before/after audit snapshot.</p>'+
        ((data||[]).length?'<div class="grid gap-3">'+data.map(renderEvent).join('')+'</div>':'<div class="p-6 text-center text-sm text-gray-500">No invoice changes in this view.</div>');
    }catch(err){
      if(seq===sequence&&document.getElementById('invoiceAdminReviewResults'))document.getElementById('invoiceAdminReviewResults').innerHTML=
         '<p class="p-4 text-xs text-red-600">'+escHtml(err.message||'Could not load invoice audit records')+'</p>';
    }
  }

  window.openInvoiceAdminAuditReview=function(){
    if(!superOnly())return showToast('Super Admin only','err');
    openModal('Invoice Changes — Super Admin Review',
      '<div class="max-h-[72vh] overflow-y-auto p-1">'+
        '<p class="text-xs text-gray-600 mb-3">Review the reason, original values and changes made by Admin or Super Admin. Marking reviewed never changes the invoice itself.</p>'+
        '<div class="flex gap-2 mb-3">'+
          '<button type="button" onclick="filterAdminInvoiceAuditReview(\'pending\')" class="px-3 py-2 rounded-lg text-xs bg-amber-50 border">Pending Review</button>'+
          '<button type="button" onclick="filterAdminInvoiceAuditReview(\'all\')" class="px-3 py-2 rounded-lg text-xs border">All History</button>'+
        '</div><div id="invoiceAdminReviewResults"></div></div>'
    );
    refresh();
  };
  window.filterAdminInvoiceAuditReview=function(v){
    if(!superOnly()||!['pending','all'].includes(v))return;
    current=v;refresh();
  };
  window.reviewAdminInvoiceAuditEvent=async function(id){
    if(!superOnly()||saving)return;
    const note=prompt('Super Admin review note (required):');
    if(note===null)return;
    if(!note.trim())return showToast('Please provide a review note','err');
    saving=true;
    try{
      const {data,error}=await db.rpc('super_admin_review_invoice_audit',{p_audit_id:id,p_note:note.trim()});
      if(error)throw error;
      if(!data?.ok)throw Error('Review acknowledgment was not confirmed');
      showToast('Invoice change reviewed');
      await refresh();
    }catch(err){showToast(err.message||'Review could not be saved','err')}
    finally{saving=false}
  };
})();