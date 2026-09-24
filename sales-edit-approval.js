// Sales order edit approval review UI.
// Loaded last so it decorates the final Sales Tracking renderer.
(function(){
  const approvalState={requests:[]};

  function appRole(){return state.profile?.role||''}
  function isReviewer(){return ['manager','admin','super_admin'].includes(appRole())}
  function isSales(){return appRole()==='sales'}
  function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
  function fmt(v){
    if(!v)return '-';
    const d=new Date(v);
    return Number.isNaN(d.getTime())?String(v):d.toLocaleString();
  }
  function customerName(id){
    const c=(state.customers||[]).find(x=>x.id===id);
    return c?.name||id||'-';
  }
  function orderDoc(o){
    return o?.sales_invoice_no||o?.invoice_no||o?.sr_no||o?.order_no||'-';
  }
  function itemName(i){
    return [i?.product_code_snapshot,i?.item_name_snapshot].filter(Boolean).join(' · ')||'Item';
  }
  function same(a,b){return JSON.stringify(a??null)===JSON.stringify(b??null)}

  async function loadRequests(){
    const {data,error}=await db.rpc('get_visible_sales_order_edit_requests',{p_status:null});
    if(error)throw error;
    approvalState.requests=data||[];
    return approvalState.requests;
  }

  function pendingRequests(){
    return approvalState.requests.filter(r=>r.status==='pending');
  }

  function addCardBadges(){
    const pend=pendingRequests();
    for(const r of pend){
      const trigger=document.querySelector(`button[onclick="toggleSalesInvoice('${r.sales_order_id}')"]`);
      const card=trigger?.closest('.lr-order-card');
      if(!card)continue;
      const head=card.querySelector('.lr-order-main .flex.flex-wrap.items-center.gap-2');
      if(!head||head.querySelector('.sales-edit-pending-badge'))continue;
      const badge=document.createElement('span');
      badge.className='sales-edit-pending-badge lr-badge lr-badge-amber';
      badge.textContent=isSales()?'✎ Edit Pending':'✎ Edit Review Pending';
      head.appendChild(badge);
    }
  }

  function addTopButton(){
    if(!isReviewer()&&!isSales())return;
    const newOrder=document.querySelector('#salesTrackingRoot button[onclick="openNewOrder()"]');
    const actions=newOrder?.parentElement;
    if(!actions)return;
    let btn=actions.querySelector('.sales-edit-review-btn');
    if(!btn){
      btn=document.createElement('button');
      btn.type='button';
      btn.className='sales-edit-review-btn px-3 py-2 border border-amber-200 bg-amber-50 text-amber-800 rounded-lg text-[10px] font-bold';
      btn.onclick=()=>openSalesEditRequests();
      actions.insertBefore(btn,newOrder);
    }
    const count=pendingRequests().length;
    btn.textContent=isReviewer()?`PENDING EDITS (${count})`:`MY EDIT REQUESTS${count?` (${count} pending)`:''}`;
  }

  async function refreshUI(){
    if(!document.getElementById('salesTrackingRoot'))return;
    try{
      await loadRequests();
      addTopButton();
      addCardBadges();
    }catch(err){
      console.warn('Sales edit approval UI:',err.message);
    }
  }

  function orderChanges(r){
    const a=r.original_order||{},b=r.requested_order||{};
    const fields=[
      ['Document',orderDoc(a),orderDoc(b)],
      ['Customer',customerName(a.customer_id),customerName(b.customer_id)],
      ['Order Date',a.order_date||'-',b.order_date||'-'],
      ['Order Discount',money(n(a.order_discount)),money(n(b.order_discount))],
      ['Notes',a.notes||'-',b.notes||'-']
    ];
    return fields.filter(x=>!same(x[1],x[2]));
  }

  function itemChanges(r){
    const oldItems=Array.isArray(r.original_items)?r.original_items:[];
    const newItems=Array.isArray(r.requested_items)?r.requested_items:[];
    const oldMap=new Map(oldItems.map(x=>[x.id,x]));
    const newExisting=new Map(newItems.filter(x=>x.id).map(x=>[x.id,x]));
    const changes=[];

    for(const old of oldItems){
      const cur=newExisting.get(old.id);
      if(!cur){
        changes.push({kind:'removed',title:itemName(old),detail:`Qty ${n(old.qty)} · ${money(n(old.unit_price))}`});
        continue;
      }
      const bits=[];
      if(!same(old.product_id,cur.product_id)||!same(old.product_code_snapshot,cur.product_code_snapshot)||!same(old.item_name_snapshot,cur.item_name_snapshot)){
        bits.push(`Item: ${itemName(old)} → ${itemName(cur)}`);
      }
      if(n(old.qty)!==n(cur.qty))bits.push(`Qty: ${n(old.qty)} → ${n(cur.qty)}`);
      if(n(old.unit_price)!==n(cur.unit_price))bits.push(`Price: ${money(n(old.unit_price))} → ${money(n(cur.unit_price))}`);
      if(n(old.discount_amount)!==n(cur.discount_amount))bits.push(`Discount: ${money(n(old.discount_amount))} → ${money(n(cur.discount_amount))}`);
      if(bits.length)changes.push({kind:'changed',title:itemName(cur),detail:bits.join(' · ')});
    }

    for(const cur of newItems.filter(x=>!x.id)){
      changes.push({kind:'added',title:itemName(cur),detail:`Qty ${n(cur.qty)} · ${money(n(cur.unit_price))} · Discount ${money(n(cur.discount_amount))}`});
    }
    return changes;
  }

  function statusBadge(status){
    const s=String(status||'').toLowerCase();
    const cls=s==='approved'?'bg-green-50 text-green-700 border-green-200':s==='rejected'?'bg-red-50 text-red-600 border-red-200':'bg-amber-50 text-amber-700 border-amber-200';
    return `<span class="inline-flex px-2 py-1 rounded-lg border text-[9px] font-bold uppercase ${cls}">${esc(status||'pending')}</span>`;
  }

  window.openSalesEditRequests=async function(){
    try{await loadRequests()}catch(err){return showToast(err.message,'err')}
    const rows=isReviewer()?approvalState.requests.filter(r=>r.status==='pending'):approvalState.requests.slice(0,30);
    openModal(isReviewer()?'Pending Order Edit Requests':'My Order Edit Requests',`<div class="space-y-4">
      <div class="rounded-xl border ${isReviewer()?'border-amber-200 bg-amber-50 text-amber-900':'bg-gray-50 text-gray-600'} p-3 text-xs">
        ${isReviewer()?'Sales-requested edits do not change live orders until you approve them. Review the differences before applying.':'Your live order stays unchanged while an edit request is pending.'}
      </div>
      <div class="grid gap-2 max-h-[60vh] overflow-y-auto pr-1">
        ${rows.length?rows.map(r=>`<button type="button" onclick="openSalesEditRequestDetail('${r.request_id}')" class="w-full text-left rounded-xl border bg-white p-4 hover:bg-amber-50/30">
          <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2"><b>${esc(r.document_no||'Order')}</b>${statusBadge(r.status)}</div>
              <div class="text-sm font-semibold mt-1">${esc(r.customer_name||'Customer')}</div>
              <div class="text-[10px] text-gray-400 mt-1">Requested by ${esc(r.requested_by_name||'Sales')} · ${esc(fmt(r.requested_at))}</div>
              ${r.request_note?`<div class="text-xs text-gray-600 mt-2 line-clamp-2">${esc(r.request_note)}</div>`:''}
            </div>
            <div class="text-right text-[10px] text-gray-400">Sales Rep<br><b class="text-gray-600">${esc(r.sales_rep_name||'-')}</b></div>
          </div>
        </button>`).join(''):'<div class="rounded-xl border border-dashed p-8 text-center text-sm text-gray-400">No edit requests.</div>'}
      </div>
    </div>`);
  };

  window.openSalesEditRequestDetail=async function(id){
    let r=approvalState.requests.find(x=>x.request_id===id);
    if(!r){
      try{await loadRequests();r=approvalState.requests.find(x=>x.request_id===id)}catch(err){return showToast(err.message,'err')}
    }
    if(!r)return showToast('Edit request not found.','err');

    const orderDiff=orderChanges(r);
    const itemDiff=itemChanges(r);
    const pending=r.status==='pending';

    openModal(`Edit Request · ${r.document_no||'Order'}`,`<div class="space-y-5">
      <div class="rounded-xl border bg-[#faf9f6] p-4">
        <div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
          <div>
            <div class="text-xl font-bold">${esc(r.customer_name||'Customer')}</div>
            <div class="text-xs text-gray-500 mt-1">${esc(r.document_no||'Order')} · Sales Rep: ${esc(r.sales_rep_name||'-')}</div>
            <div class="text-[10px] text-gray-400 mt-1">Requested by ${esc(r.requested_by_name||'Sales')} · ${esc(fmt(r.requested_at))}</div>
          </div>
          ${statusBadge(r.status)}
        </div>
        ${r.request_note?`<div class="mt-3 pt-3 border-t"><div class="text-[9px] uppercase font-bold text-gray-400">Sales Reason</div><div class="text-sm mt-1">${esc(r.request_note)}</div></div>`:''}
      </div>

      <div>
        <h4 class="font-bold mb-2">Order Changes</h4>
        <div class="grid gap-2">
          ${orderDiff.length?orderDiff.map(x=>`<div class="rounded-xl border p-3 grid md:grid-cols-[150px_1fr_30px_1fr] gap-2 items-center text-xs"><b>${esc(x[0])}</b><div class="text-gray-500 break-words">${esc(x[1])}</div><div class="text-center text-amber-600">→</div><div class="font-semibold break-words">${esc(x[2])}</div></div>`).join(''):'<div class="rounded-xl border border-dashed p-4 text-xs text-gray-400">No header-level changes.</div>'}
        </div>
      </div>

      <div>
        <h4 class="font-bold mb-2">Item Changes</h4>
        <div class="grid gap-2">
          ${itemDiff.length?itemDiff.map(x=>`<div class="rounded-xl border p-3"><div class="flex items-center gap-2"><span class="px-2 py-1 rounded-md text-[9px] font-bold ${x.kind==='added'?'bg-green-50 text-green-700':x.kind==='removed'?'bg-red-50 text-red-600':'bg-amber-50 text-amber-700'}">${esc(x.kind.toUpperCase())}</span><b class="text-sm">${esc(x.title)}</b></div><div class="text-xs text-gray-600 mt-2">${esc(x.detail)}</div></div>`).join(''):'<div class="rounded-xl border border-dashed p-4 text-xs text-gray-400">No line-item changes.</div>'}
        </div>
      </div>

      <div class="rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800">Payments, Return/CN records, fulfillment status and supplier-PO links are preserved. Protected returned/PO-linked item rules are checked again when approval is applied.</div>

      ${isReviewer()&&pending?`
        <div><label class="text-xs font-semibold">Review Note</label><textarea id="salesEditReviewNote" rows="2" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Optional for approval; required for rejection."></textarea></div>
        <div class="flex flex-col sm:flex-row gap-2 justify-end">
          <button onclick="reviewSalesEditRequest('${r.request_id}','reject')" class="px-4 py-2.5 rounded-xl border border-red-200 bg-red-50 text-red-600 text-xs font-semibold">Reject</button>
          <button onclick="reviewSalesEditRequest('${r.request_id}','approve')" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Approve & Apply</button>
        </div>`
        :`<div class="flex justify-end"><button onclick="closeModal()" class="px-4 py-2.5 rounded-xl bg-[#211d18] text-white text-xs font-semibold">Close</button></div>`}
    </div>`);
  };

  window.reviewSalesEditRequest=async function(id,action){
    if(!isReviewer())return showToast('Manager/Admin access required.','err');
    const note=String(document.getElementById('salesEditReviewNote')?.value||'').trim();
    if(action==='reject'&&!note)return showToast('Enter a rejection reason.','err');
    const confirmText=action==='approve'
      ?'Approve and apply these changes to the live order?'
      :'Reject this Sales edit request?';
    if(!confirm(confirmText))return;
    const {data,error}=await db.rpc('review_sales_order_edit_request',{
      p_request_id:id,
      p_action:action,
      p_review_note:note||null,
      p_final_order:null,
      p_final_items:null
    });
    if(error)return showToast(error.message,'err');
    closeModal();
    showToast(action==='approve'?'Edit approved and applied to the order':'Edit request rejected');
    if(window.documentFlowState)window.documentFlowState.loaded=false;
    await go('sales-orders');
  };

  const baseBody=window.renderSalesTrackingBody;
  if(typeof baseBody==='function'){
    window.renderSalesTrackingBody=function(){
      const out=baseBody.apply(this,arguments);
      setTimeout(()=>refreshUI(),20);
      return out;
    };
  }

  const basePage=window.renderSalesOrders;
  if(typeof basePage==='function'){
    window.renderSalesOrders=async function(){
      const out=await basePage.apply(this,arguments);
      setTimeout(()=>refreshUI(),20);
      return out;
    };
  }
})();