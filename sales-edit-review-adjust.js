// Editable review for pending Sales order edit requests.
(function(){
  var R={req:null,returns:new Map(),refs:new Map(),paid:0};
  function role(){return state.profile&&state.profile.role||''}
  function reviewer(){return ['manager','admin','super_admin'].includes(role())}
  function n(v){var x=Number(v||0);return Number.isFinite(x)?x:0}
  function clean(v){return String(v==null?'':v).trim()}
  function isPre(r){var o=r&&r.requested_order||{};return !!o.sr_no||String(o.order_no||'').toUpperCase().startsWith('SR')}
  function same(a,b){return JSON.stringify(a==null?null:a)===JSON.stringify(b==null?null:b)}
  function customerName(id){
    var c=(state.customers||[]).find(function(x){return x.id===id});
    return c?c.name:(id||'-');
  }
  function orderDoc(o){
    o=o||{};
    return o.sales_invoice_no||o.invoice_no||o.sr_no||o.order_no||'-';
  }
  function itemName(i){
    i=i||{};
    return [i.product_code_snapshot,i.item_name_snapshot].filter(Boolean).join(' · ')||'Item';
  }
  function orderDiffs(r){
    var a=r.original_order||{},b=r.requested_order||{};
    var rows=[
      ['Document',orderDoc(a),orderDoc(b)],
      ['Customer',customerName(a.customer_id),customerName(b.customer_id)],
      ['Order Date',a.order_date||'-',b.order_date||'-'],
      ['Order Discount',money(n(a.order_discount)),money(n(b.order_discount))],
      ['Notes',a.notes||'-',b.notes||'-']
    ];
    return rows.filter(function(x){return !same(x[1],x[2])});
  }
  function itemDiffs(r){
    var oldItems=Array.isArray(r.original_items)?r.original_items:[];
    var newItems=Array.isArray(r.requested_items)?r.requested_items:[];
    var oldMap=new Map(oldItems.map(function(x){return [x.id,x]}));
    var newExisting=new Map(newItems.filter(function(x){return x.id}).map(function(x){return [x.id,x]}));
    var out=[];

    oldItems.forEach(function(old){
      var cur=newExisting.get(old.id);
      if(!cur){
        out.push({kind:'removed',title:itemName(old),lines:['Removed from order','Qty '+n(old.qty),'Unit '+money(n(old.unit_price)),'Discount '+money(n(old.discount_amount))]});
        return;
      }
      var lines=[];
      if(!same(old.product_id,cur.product_id)||!same(old.product_code_snapshot,cur.product_code_snapshot)||!same(old.item_name_snapshot,cur.item_name_snapshot)){
        lines.push('Item: '+itemName(old)+' → '+itemName(cur));
      }
      if(n(old.qty)!==n(cur.qty))lines.push('Qty: '+n(old.qty)+' → '+n(cur.qty));
      if(n(old.unit_price)!==n(cur.unit_price))lines.push('Unit Price: '+money(n(old.unit_price))+' → '+money(n(cur.unit_price)));
      if(n(old.discount_amount)!==n(cur.discount_amount))lines.push('Line Discount: '+money(n(old.discount_amount))+' → '+money(n(cur.discount_amount)));
      if(lines.length)out.push({kind:'changed',title:itemName(cur),lines:lines});
    });

    newItems.filter(function(x){return !x.id}).forEach(function(cur){
      out.push({kind:'added',title:itemName(cur),lines:['Added to order','Qty '+n(cur.qty),'Unit '+money(n(cur.unit_price)),'Discount '+money(n(cur.discount_amount))]});
    });
    return out;
  }
  function requestChangesHtml(r){
    var od=orderDiffs(r),it=itemDiffs(r),count=od.length+it.length;
    var orderHtml=od.length?od.map(function(x){
      return '<div class="grid md:grid-cols-[130px_1fr_28px_1fr] gap-2 items-center rounded-lg border bg-white px-3 py-2 text-xs"><b>'+esc(x[0])+'</b><div class="text-gray-500 break-words">'+esc(x[1])+'</div><div class="text-center text-amber-600">→</div><div class="font-semibold break-words">'+esc(x[2])+'</div></div>';
    }).join(''):'<div class="text-xs text-gray-400 rounded-lg border border-dashed p-3">No order-header changes.</div>';
    var itemHtml=it.length?it.map(function(x){
      var cls=x.kind==='added'?'bg-green-50 text-green-700 border-green-200':x.kind==='removed'?'bg-red-50 text-red-600 border-red-200':'bg-amber-50 text-amber-700 border-amber-200';
      return '<div class="rounded-lg border bg-white p-3"><div class="flex flex-wrap items-center gap-2"><span class="px-2 py-1 rounded-md border text-[9px] font-bold '+cls+'">'+x.kind.toUpperCase()+'</span><b class="text-sm">'+esc(x.title)+'</b></div><div class="mt-2 space-y-1">'+x.lines.map(function(line){return '<div class="text-xs text-gray-600">'+esc(line)+'</div>'}).join('')+'</div></div>';
    }).join(''):'<div class="text-xs text-gray-400 rounded-lg border border-dashed p-3">No item changes.</div>';

    return '<details open class="rounded-xl border border-amber-200 bg-amber-50/40 overflow-hidden">'
      +'<summary class="cursor-pointer px-4 py-3 flex items-center justify-between gap-3"><div><div class="font-bold text-sm">Sales Requested Changes</div><div class="text-[10px] text-gray-500">Original values compared with what Sales requested.</div></div><span class="min-w-[24px] h-[24px] px-2 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold inline-flex items-center justify-center">'+count+'</span></summary>'
      +'<div class="border-t border-amber-100 p-4 space-y-4"><div><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Order Changes</div><div class="grid gap-2">'+orderHtml+'</div></div><div><div class="text-[10px] uppercase font-bold text-gray-400 mb-2">Item Changes</div><div class="grid gap-2">'+itemHtml+'</div></div></div>'
      +'</details>';
  }
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
    var lineQty=n(i.qty)||1,linePrice=n(i.unit_price),lineDisc=n(i.discount_amount),lineGross=lineQty*linePrice,linePct=lineGross?Math.round((lineDisc/lineGross*100)*100)/100:0;
    if(p.returned>0)warn+='<div class="text-[10px] text-amber-800">Return/CN: '+p.returned+' already returned'+(p.cn?' · '+esc(p.cn):'')+'. Final qty cannot be below this.</div>';
    if(p.allocated>0){var pos=[...new Set(p.refs.map(function(x){return x.po_number||'PO Pending'}))].join(', ');warn+='<div class="text-[10px] text-blue-700">PO linked: '+p.allocated+' allocated'+(pos?' · '+esc(pos):'')+'. Conflicting PO allocations are unlinked automatically on approval.</div>'}
    return '<div class="review-edit-item rounded-xl border bg-white p-3" data-id="'+esc(i.id||'')+'" data-kind="'+(service?'service':'product')+'" data-discount-basis="amount">'
      +'<div class="grid md:grid-cols-12 gap-2 items-end">'
      +'<div class="md:col-span-5"><label class="text-[9px] uppercase font-bold text-gray-400">'+(service?'Service / Fee':'Product')+'</label>'
      +(service?'<input class="r-name mt-1 w-full border rounded-lg px-3 py-2" value="'+esc(i.item_name_snapshot||'Service Fee')+'"><input class="r-code" type="hidden" value="'+esc(i.product_code_snapshot||'SERVICE-FEE')+'"><input class="r-pid" type="hidden" value=""><input class="r-img" type="hidden" value=""><input class="r-class" type="hidden" value="'+esc(i.product_class_snapshot||'Service Fee')+'"><input class="r-type" type="hidden" value="Service">'
        :'<select class="r-product mt-1 w-full border rounded-lg px-2 py-2 bg-white" onchange="reviewProductSelected(this)">'+prodOptions(i.product_id||'')+'</select><input class="r-name" type="hidden" value="'+esc(i.item_name_snapshot||'')+'"><input class="r-code" type="hidden" value="'+esc(i.product_code_snapshot||'')+'"><input class="r-pid" type="hidden" value="'+esc(i.product_id||'')+'">')
      +(warn?'<div class="mt-2 rounded-lg border bg-gray-50 p-2 space-y-1">'+warn+'</div>':'')+'</div>'
      +'<div class="md:col-span-1"><label class="text-[9px] uppercase font-bold text-gray-400">Qty</label><input class="r-qty mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0.01" step="0.01" value="'+(n(i.qty)||1)+'" oninput="reviewLineValueChanged(this)"></div>'
      +'<div class="md:col-span-2"><label class="text-[9px] uppercase font-bold text-gray-400">Unit Price</label><input class="r-price mt-1 w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="'+n(i.unit_price)+'" oninput="reviewLineValueChanged(this)"></div>'
      +'<div class="md:col-span-3"><label class="text-[9px] uppercase font-bold text-gray-400">Line Discount</label><div class="grid grid-cols-2 gap-1 mt-1"><div><div class="text-[9px] text-gray-400 mb-0.5">%</div><input class="r-disc-pct w-full border rounded-lg px-2 py-2" type="number" min="0" max="100" step="0.01" value="'+linePct+'" oninput="reviewLineDiscountPercentChanged(this)"></div><div><div class="text-[9px] text-gray-400 mb-0.5">Amount</div><input class="r-disc w-full border rounded-lg px-2 py-2" type="number" min="0" step="0.01" value="'+lineDisc+'" oninput="reviewLineDiscountAmountChanged(this)"></div></div></div>'
      +'<div class="md:col-span-1"><button type="button" onclick="this.closest(\'.review-edit-item\').remove();reviewRecalc()" class="w-full h-[38px] border rounded-lg text-red-500 font-bold">×</button></div>'
      +'</div></div>';
  }
  window.reviewProductSelected=function(sel){
    var row=sel.closest('.review-edit-item'),opt=sel.selectedOptions&&sel.selectedOptions[0];if(!row||!opt)return;
    row.querySelector('.r-pid').value=sel.value||'';
    row.querySelector('.r-code').value=opt.dataset.code||'';
    row.querySelector('.r-name').value=opt.dataset.name||'';
    row.querySelector('.r-img').value=opt.dataset.image||'';
    row.querySelector('.r-class').value=opt.dataset.class||'';
    row.querySelector('.r-type').value=opt.dataset.class?(/chandelier|lamp|lighting/i.test(opt.dataset.class)?'Lighting':/carpet|rug/i.test(opt.dataset.class)?'Carpet':/accessor|mirror|decor|vase/i.test(opt.dataset.class)?'Accessories':'Furniture'):'Unclassified';
  };
  function syncReviewLineDiscount(row,basis){
    if(!row)return;
    if(basis)row.dataset.discountBasis=basis;
    var qty=Math.max(n(row.querySelector('.r-qty')&&row.querySelector('.r-qty').value),0);
    var price=Math.max(n(row.querySelector('.r-price')&&row.querySelector('.r-price').value),0);
    var gross=Math.round(qty*price*100)/100;
    var pct=row.querySelector('.r-disc-pct'),amt=row.querySelector('.r-disc');
    if(!pct||!amt)return;
    if((row.dataset.discountBasis||'amount')==='percent'){
      var p=Math.max(0,Math.min(100,n(pct.value)));
      pct.value=String(Math.round(p*100)/100);
      amt.value=String(Math.round(gross*p)/100);
    }else{
      var a=Math.max(0,Math.min(gross,n(amt.value)));
      amt.value=String(Math.round(a*100)/100);
      pct.value=String(gross?Math.round((a/gross*100)*100)/100:0);
    }
  }
  window.reviewLineDiscountPercentChanged=function(input){var row=input.closest('.review-edit-item');syncReviewLineDiscount(row,'percent');reviewRecalc()};
  window.reviewLineDiscountAmountChanged=function(input){var row=input.closest('.review-edit-item');syncReviewLineDiscount(row,'amount');reviewRecalc()};
  window.reviewLineValueChanged=function(input){var row=input.closest('.review-edit-item');syncReviewLineDiscount(row);reviewRecalc()};
  window.addReviewProduct=function(){var x=document.getElementById('reviewItems');if(x)x.insertAdjacentHTML('beforeend',itemRow({line_kind:'product',qty:1,unit_price:0,discount_amount:0}))};
  window.addReviewService=function(){var x=document.getElementById('reviewItems');if(x)x.insertAdjacentHTML('beforeend',itemRow({line_kind:'service',product_code_snapshot:'SERVICE-FEE',item_name_snapshot:'Service Fee',qty:1,unit_price:0,discount_amount:0}))};
  window.reviewRecalc=function(){
    var sub=0;document.querySelectorAll('#reviewItems .review-edit-item').forEach(function(r){syncReviewLineDiscount(r);sub+=Math.max(n(r.querySelector('.r-qty').value)*n(r.querySelector('.r-price').value)-n(r.querySelector('.r-disc').value),0)});
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
      +requestChangesHtml(r)
      +'<div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Final review draft below.</b> Sales\' requested values are prefilled. You can adjust them before approval; the live order is unchanged until you approve.</div>'
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
      return {id:el.dataset.id||null,line_kind:service?'service':'product',product_id:service?null:(el.querySelector('.r-pid').value||null),product_code_snapshot:el.querySelector('.r-code').value||'',item_name_snapshot:el.querySelector('.r-name').value||'',image_url_snapshot:service?null:(el.querySelector('.r-img')?.value||null),product_class_snapshot:el.querySelector('.r-class')?.value||null,product_type_snapshot:service?'Service':(el.querySelector('.r-type')?.value||null),qty:n(el.querySelector('.r-qty').value),unit_price:n(el.querySelector('.r-price').value),discount_amount:n(el.querySelector('.r-disc').value),source_type:orig&&orig.source_type||(pre?'pre_order':'stock'),notes:orig&&orig.notes||null};
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