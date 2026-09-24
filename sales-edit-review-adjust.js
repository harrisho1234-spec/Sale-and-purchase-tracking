// Editable review for pending Sales order edit requests.
(function(){
  var R={req:null,returns:new Map(),refs:new Map(),paid:0};
  function role(){return state.profile&&state.profile.role||''}
  function reviewer(){return ['manager','admin','super_admin'].includes(role())}
  function n(v){var x=Number(v||0);return Number.isFinite(x)?x:0}
  function clean(v){return String(v==null?'':v).trim()}
  function isPre(r){var o=r&&r.requested_order||{};return !!o.sr_no||String(o.order_no||'').toUpperCase().startsWith('SR')}
  function prodOptions(selected){
    var out='<option value="">-- Select Product --</option>';
    (state.products||[]).forEach(function(p){
      out+='<option value="'+esc(p.id)+'" data-code="'+esc(p.code||'')+'" data-name="'+esc(p.item_name||'')+'" data-image="'+esc(p.image_url||'')+'" data-class="'+esc(p.class||'')+'" '+(p.id===selected?'selected':'')+'>'+esc((p.code||'')+' · '+(p.item_name||''))+'</option>';
    });
    return out;
  }
  function prot(i){
    var r=R.returns.get(i.id),refs=R.refs.get(i.id)||[];
    return {returned:n(r&&r.qty_returned),cn:r&&r.cn_numbers||'',refs:refs,allocated:refs.reduce(function(a,x){return a+n(x.qty_allocated)},0)};
  }
  function itemRow(i){
    i=i||{};var service=i.line_kind==='service',p=prot(i),warn='';
    if(p.returned>0)warn+='<div class="text-[10px] text-amber-800">Return/CN: '+p.returned+' already returned'+(p.cn?' · '+esc(p.cn):'')+'. Final qty cannot be below this.</div>';
    if(p.allocated>0){var pos=[...new Set(p.refs.map(function(x){return x.po_number||'PO Pending'}))].join(', ');warn+='<div class="text-[10px] text-blue-700">PO linked: '+p.allocated+' allocated'+(pos?' · '+esc(pos):'')+'. Conflicting PO allocations are unlinked automatically on approval.</div>'}
    return '<div class="review-edit-item rounded-xl border bg-white p-3" data-id="'+esc(i.id||'')+'" data-kind="'+(service?'service':'product')+'">'
      +'<div class="grid md:grid-cols-12 gap-2 items-end">'
      +'<div class="md:col-span-5"><label class="text-[9px] uppercase font-bold text-gray-400">'+(service?'Service / Fee':'Product')+'</label>'
      +(service?'<input class="r-name mt-1 w-full border rounded-lg px-3 py-2" value="'+esc(i.item_name_snapshot||'Service Fee')+'"><input class="r-code" type="hidden" value="'+esc(i.product_code_snapshot||'SERVICE-FEE')+'"><input class="r-pid" type="hidden" value="">'
        :'<select class="r-product mt-1 w-full border rounded-lg px-2 py-2 bg-white" onchange="reviewProductSelected(this)">'+prodOptions(i.product_id||'')+'</select><input class="r-name" type="hidden" value="'+esc(i.item_name_snapshot||'')+'"><input class="r-code" type="hidden" value="'+esc(i.product_code_snapshot||'')+'"><input class="r-pid" type="hidden" value="'+esc(i.product_id||'')+'">')
      +(warn?'<div class="mt-2 rounded-lg border bg-gray-50 p-2 space-y-1">'+warn+'</div>':'')+'</div>'
      +'<div class="md:col-span-2"><label class="text-[9px] uppercase font-bold text-gray-400">Qty</label><input class="r-qty mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0.01" step="0.01" value="'+(n(i.qty)||1)+'" oninput="reviewRecalc()"></div>'
      +'<div class="md:col-span-2"><label class="text-[9px] uppercase font-bold text-gray-400">Unit Price</label><input class="r-price mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="'+n(i.unit_price)+'" oninput="reviewRecalc()"></div>'
      +'<div class="md:col-span-2"><label class="text-[9px] uppercase font-bold text-gray-400">Discount</label><input class="r-disc mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="'+n(i.discount_amount)+'" oninput="reviewRecalc()"></div>'
      +'<div class="md:col-span-1"><button type="button" onclick="this.closest(\'.review-edit-item\').remove();reviewRecalc()" class="w-full h-[38px] border rounded-lg text-red-500 font-bold">×</button></div>'
      +'</div></div>';
  }
  window.reviewProductSelected=function(sel){
    var row=sel.closest('.review-edit-item'),opt=sel.selectedOptions&&sel.selectedOptions[0];if(!row||!opt)return;
    row.querySelector('.r-pid').value=sel.value||'';
    row.querySelector('.r-code').value=opt.dataset.code||'';
    row.querySelector('.r-name').value=opt.dataset.name||'';
  };
  window.addReviewProduct=function(){var x=document.getElementById('reviewItems');if(x)x.insertAdjacentHTML('beforeend',itemRow({line_kind:'product',qty:1,unit_price:0,discount_amount:0}))};
  window.addReviewService=function(){var x=document.getElementById('reviewItems');if(x)x.insertAdjacentHTML('beforeend',itemRow({line_kind:'service',product_code_snapshot:'SERVICE-FEE',item_name_snapshot:'Service Fee',qty:1,unit_price:0,discount_amount:0}))};
  window.reviewRecalc=function(){
    var sub=0;document.querySelectorAll('#reviewItems .review-edit-item').forEach(function(r){sub+=Math.max(n(r.querySelector('.r-qty').value)*n(r.querySelector('.r-price').value)-n(r.querySelector('.r-disc').value),0)});
    var d=Math.max(0,Math.min(sub,n(document.getElementById('reviewDiscount')&&document.getElementById('reviewDiscount').value))),total=Math.max(sub-d,0),bal=Math.max(total-R.paid,0);
    [['reviewSub',sub],['reviewDisc',d],['reviewTotal',total],['reviewPaid',R.paid],['reviewBal',bal]].forEach(function(x){var e=document.getElementById(x[0]);if(e)e.textContent=money(x[1])});
  };
  async function load(id){
    if(typeof ensureOrderFormData==='function')await ensureOrderFormData();
    var a=await Promise.all([db.rpc('get_visible_sales_order_edit_requests',{p_status:null}),db.rpc('get_sales_tracking_return_summary'),db.rpc('get_visible_sales_procurement_refs')]);
    if(a[0].error)throw a[0].error;if(a[1].error)throw a[1].error;if(a[2].error)throw a[2].error;
    var r=(a[0].data||[]).find(function(x){return x.request_id===id});if(!r)throw new Error('Edit request not found');
    R.returns=new Map((a[1].data||[]).filter(function(x){return x.sales_order_id===r.sales_order_id}).map(function(x){return [x.sales_order_item_id,x]}));
    R.refs=new Map();(a[2].data||[]).filter(function(x){return x.sales_order_id===r.sales_order_id}).forEach(function(x){if(!R.refs.has(x.sales_order_item_id))R.refs.set(x.sales_order_item_id,[]);R.refs.get(x.sales_order_item_id).push(x)});
    var s=await db.from('sales_order_summary').select('amount_paid').eq('id',r.sales_order_id).single();if(s.error)throw s.error;
    R.req=r;R.paid=n(s.data&&s.data.amount_paid);return r;
  }
  window.openSalesEditRequestDetail=async function(id){
    if(!reviewer())return typeof window.openSalesEditRequests==='function'?window.openSalesEditRequests():undefined;
    var r;try{r=await load(id)}catch(e){return showToast(e.message,'err')}
    var o=r.requested_order||{},items=Array.isArray(r.requested_items)?r.requested_items:[],pre=isPre(r);
    var customers=(state.customers||[]).map(function(c){return '<option value="'+c.id+'" '+(c.id===o.customer_id?'selected':'')+'>'+esc(c.name)+'</option>'}).join('');
    var html='<form id="reviewSalesEditForm" class="space-y-5">'
      +'<div class="rounded-xl border border-amber-200 bg-amber-50 p-4"><div class="text-[10px] uppercase font-bold text-amber-700">Pending Sales Edit</div><div class="text-xl font-bold mt-1">'+esc(r.customer_name||'Customer')+'</div><div class="text-[10px] text-gray-500 mt-1">Requested by '+esc(r.requested_by_name||'Sales')+' · '+new Date(r.requested_at).toLocaleString()+'</div>'+(r.request_note?'<div class="border-t border-amber-200 mt-3 pt-3 text-xs"><b>Sales reason:</b> '+esc(r.request_note)+'</div>':'')+'</div>'
      +'<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Adjust the final version here.</b> Nothing changes on the live order until you approve.</div>'
      +'<div class="grid md:grid-cols-2 gap-3"><div><label class="text-xs font-semibold">Customer</label><select id="reviewCustomer" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white">'+customers+'</select></div><div><label class="text-xs font-semibold">Order Date</label><input id="reviewDate" type="date" value="'+esc(o.order_date||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2"></div>'
      +(pre?'':'<div><label class="text-xs font-semibold">Invoice Type</label><select id="reviewType" class="mt-1 w-full border rounded-xl px-3 py-2 bg-white"><option value="TK" '+((o.sales_invoice_type||'TK')==='TK'?'selected':'')+'>TK</option><option value="RK" '+(o.sales_invoice_type==='RK'?'selected':'')+'>RK</option></select></div>')
      +'<div><label class="text-xs font-semibold">'+(pre?'SR Number':'TK / RK Invoice Number')+'</label><input id="reviewDoc" value="'+esc(o.order_no||o.sr_no||o.sales_invoice_no||'')+'" class="mt-1 w-full border rounded-xl px-3 py-2"></div></div>'
      +'<div><div class="flex items-center justify-between gap-2 mb-2"><div><h4 class="font-bold">Final Items</h4><div class="text-[10px] text-gray-400">Sales request is prefilled; adjust it before approval if needed.</div></div><div class="flex gap-2"><button type="button" onclick="addReviewProduct()" class="px-3 py-2 border rounded-lg text-xs">+ Product</button><button type="button" onclick="addReviewService()" class="px-3 py-2 border border-amber-200 bg-amber-50 rounded-lg text-xs">+ Service</button></div></div><div id="reviewItems" class="space-y-2">'+items.map(itemRow).join('')+'</div></div>'
      +'<div class="grid md:grid-cols-2 gap-3 border-t pt-4"><div><label class="text-xs font-semibold">Order Discount</label><input id="reviewDiscount" type="number" min="0" step="0.01" value="'+n(o.order_discount)+'" oninput="reviewRecalc()" class="mt-1 w-full border rounded-xl px-3 py-2"></div><div><label class="text-xs font-semibold">Notes</label><textarea id="reviewNotes" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2">'+esc(o.notes||'')+'</textarea></div></div>'
      +'<div class="grid grid-cols-2 md:grid-cols-5 gap-2 rounded-xl border bg-[#faf9f6] p-3"><div><div class="text-[9px] text-gray-400">SUBTOTAL</div><div id="reviewSub" class="font-bold"></div></div><div><div class="text-[9px] text-gray-400">DISCOUNT</div><div id="reviewDisc" class="font-bold"></div></div><div><div class="text-[9px] text-gray-400">FINAL TOTAL</div><div id="reviewTotal" class="font-bold"></div></div><div><div class="text-[9px] text-gray-400">PAID</div><div id="reviewPaid" class="font-bold text-green-600"></div></div><div><div class="text-[9px] text-gray-400">BALANCE</div><div id="reviewBal" class="font-bold text-red-500"></div></div></div>'
      +'<div><label class="text-xs font-semibold">Reviewer Note</label><textarea id="salesEditReviewNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Optional for approval; required for rejection."></textarea></div>'
      +'<div class="flex justify-end gap-2 border-t pt-4"><button type="button" onclick="reviewSalesEditRequest(\''+r.request_id+'\',\'reject\')" class="px-4 py-2.5 border border-red-200 bg-red-50 text-red-600 rounded-xl text-xs font-semibold">Reject</button><button type="button" onclick="reviewSalesEditRequest(\''+r.request_id+'\',\'approve\')" class="px-4 py-2.5 bg-[#211d18] text-white rounded-xl text-xs font-semibold">Approve Adjusted Version</button></div></form>';
    openModal('Review Edit Request · '+(r.document_no||'Order'),html);reviewRecalc();
  };
  function collect(){
    var r=R.req,pre=isPre(r);
    var items=[].slice.call(document.querySelectorAll('#reviewItems .review-edit-item')).map(function(el){
      var service=el.dataset.kind==='service',orig=(r.requested_items||[]).find(function(x){return String(x.id||'')===String(el.dataset.id||'')});
      return {id:el.dataset.id||null,line_kind:service?'service':'product',product_id:service?null:(el.querySelector('.r-pid').value||null),product_code_snapshot:el.querySelector('.r-code').value||'',item_name_snapshot:el.querySelector('.r-name').value||'',image_url_snapshot:orig&&orig.image_url_snapshot||null,product_class_snapshot:orig&&orig.product_class_snapshot||null,product_type_snapshot:service?'Service':(orig&&orig.product_type_snapshot||null),qty:n(el.querySelector('.r-qty').value),unit_price:n(el.querySelector('.r-price').value),discount_amount:n(el.querySelector('.r-disc').value),source_type:orig&&orig.source_type||(pre?'pre_order':'stock'),notes:orig&&orig.notes||null};
    });
    var type=pre?null:(document.getElementById('reviewType').value||'TK'),doc=clean(document.getElementById('reviewDoc').value).toUpperCase().replace(/\s+/g,'');
    doc=pre?(doc.startsWith('SR')?doc:'SR-'+doc.replace(/^[-:]+/,'')):(doc.startsWith(type)?doc:type+doc.replace(/^[-:]+/,''));
    var order=Object.assign({},r.requested_order||{},{customer_id:document.getElementById('reviewCustomer').value,order_date:document.getElementById('reviewDate').value,order_discount:n(document.getElementById('reviewDiscount').value),notes:clean(document.getElementById('reviewNotes').value)||null,order_no:doc});
    if(pre)order.sr_no=doc;else{order.invoice_no=doc;order.sales_invoice_no=doc;order.sales_invoice_type=type}
    return {order:order,items:items};
  }
  window.reviewSalesEditRequest=async function(id,action){
    if(!reviewer())return showToast('Manager/Admin access required.','err');
    var note=clean(document.getElementById('salesEditReviewNote')&&document.getElementById('salesEditReviewNote').value);
    if(action==='reject'&&!note)return showToast('Enter a rejection reason.','err');
    var finalOrder=null,finalItems=null;
    if(action==='approve'){var c=collect();finalOrder=c.order;finalItems=c.items;if(!finalItems.length)return showToast('Order must contain at least one item.','err');if(finalItems.some(function(i){return (i.line_kind!=='service'&&!i.product_id)||!i.product_code_snapshot||!i.item_name_snapshot||i.qty<=0||i.unit_price<0||i.discount_amount<0}))return showToast('Check item/service details, qty, price and discount.','err')}
    if(!confirm(action==='approve'?'Approve and publish this adjusted version to the live order?':'Reject this Sales edit request?'))return;
    var x=await db.rpc('review_sales_order_edit_request',{p_request_id:id,p_action:action,p_review_note:note||null,p_final_order:finalOrder,p_final_items:finalItems});
    if(x.error)return showToast(x.error.message,'err');
    closeModal();if(window.documentFlowState)window.documentFlowState.loaded=false;
    var removed=n(x.data&&x.data.po_links_removed);showToast(action==='approve'?'Edit approved and applied'+(removed?' · '+removed+' PO allocation'+(removed===1?'':'s')+' unlinked':''):'Edit request rejected');await go('sales-orders');
  };
})();