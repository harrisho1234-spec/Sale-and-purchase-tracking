// Approval gate for stock deductions and transfers.
// Stock Controller submits OUT / Broken / Transfer / Adjustment- / Customer Delivery / DO Delivery.
// Admin or Super Admin approval creates the real stock movement; pending requests do not affect stock balance.
(function(){
  const A={rows:[],loading:false};
  const negativeTypes=['out','broken','transfer','adjustment_out'];

  function role(){return String((typeof state!=='undefined'&&state&&state.profile&&state.profile.role)||'')}
  function isStockController(){return role()==='stock_controller'}
  function canApprove(){return ['admin','super_admin'].includes(role())}
  function esc(v){
    return String(v==null?'':v).replace(/[&<>"']/g,function(ch){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];
    });
  }
  function qty(v){
    const x=Number(v||0);
    return Number.isFinite(x)?(Number.isInteger(x)?x.toLocaleString():x.toLocaleString(undefined,{maximumFractionDigits:2})):'0';
  }
  function dateTime(v){
    if(!v)return '';
    const d=new Date(v);
    return isNaN(d.getTime())?String(v):d.toLocaleString();
  }
  function title(v){
    return String(v||'').replace(/[_-]+/g,' ').replace(/\b\w/g,function(m){return m.toUpperCase()});
  }
  function activeRequestsTab(){
    const btn=[].slice.call(document.querySelectorAll('.inv-tab')).find(function(b){
      return String(b.getAttribute('onclick')||'').includes("setInventoryTab('requests')");
    });
    return !!(btn&&btn.classList.contains('active'));
  }
  function wholeNumber(id,label){
    const el=document.getElementById(id);
    const raw=String(el&&el.value!=null?el.value:'').trim();
    const n=Number(raw);
    if(raw===''||!Number.isInteger(n)||n<=0){
      showToast((label||'Quantity')+' must be a positive whole number.','err');
      if(el)el.focus();
      return null;
    }
    return n;
  }
  async function submit(actionType,payload,reason){
    const r=await db.rpc('submit_stock_action_request',{
      p_action_type:actionType,
      p_payload:payload,
      p_reason:reason||null
    });
    if(r.error)throw r.error;
    return r.data;
  }
  async function refreshInventoryAfterApproval(){
    if(typeof window.invalidateInventoryCache==='function')window.invalidateInventoryCache();
    if(typeof window.renderStockInventory==='function')await window.renderStockInventory();
  }

  function approvalNotice(form,kind){
    if(!form||form.querySelector('[data-stock-approval-notice]'))return;
    const box=document.createElement('div');
    box.setAttribute('data-stock-approval-notice','1');
    box.className='rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900';
    box.innerHTML='<b>Approval required.</b> '+esc(kind||'This stock action')+' will be submitted first. <b>Stock quantity will not change until Admin/Super Admin approves it.</b>';
    form.insertBefore(box,form.firstElementChild);
  }

  function patchManualMovementForm(){
    if(!isStockController())return;
    const form=document.getElementById('stockMovementForm');
    if(!form||form.dataset.approvalPatched==='1')return;
    form.dataset.approvalPatched='1';
    const original=form.onsubmit;
    const typeEl=document.getElementById('smType');
    const save=document.getElementById('smSave');

    function update(){
      const t=String(typeEl&&typeEl.value||'');
      const needs=negativeTypes.includes(t);
      if(needs){
        approvalNotice(form,title(t));
        if(save)save.textContent='Submit for Approval';
      }else{
        const notice=form.querySelector('[data-stock-approval-notice]');
        if(notice)notice.remove();
        if(save)save.textContent='Save Stock Movement';
      }
    }
    if(typeEl)typeEl.addEventListener('change',function(){setTimeout(update,0)});
    update();

    form.onsubmit=async function(e){
      const type=String(document.getElementById('smType')&&document.getElementById('smType').value||'');
      if(!negativeTypes.includes(type)){
        if(typeof original==='function')return original.call(form,e);
        return;
      }
      e.preventDefault();
      const productId=String(document.getElementById('smProductId')&&document.getElementById('smProductId').value||'').trim();
      if(!productId)return showToast('Choose a Product / SKU from the suggestion list.','err');
      const q=wholeNumber('smQty','Quantity');if(q==null)return;
      const from=String(document.getElementById('smFrom')&&document.getElementById('smFrom').value||'').trim();
      const to=String(document.getElementById('smTo')&&document.getElementById('smTo').value||'').trim();
      if(!from)return showToast('Source location is required.','err');
      if(type==='transfer'&&(!to||to===from))return showToast('Transfer requires a different destination location.','err');

      const payload={
        product_id:productId,
        movement_type:type,
        qty:q,
        from_location_id:from||null,
        to_location_id:to||null,
        movement_date:(document.getElementById('smDate')&&document.getElementById('smDate').value)||null,
        reference_type:(document.getElementById('smReferenceType')&&document.getElementById('smReferenceType').value)||'manual',
        reference_id:(document.getElementById('smReferenceId')&&document.getElementById('smReferenceId').value)||null,
        reference_item_id:null,
        reference_no:String(document.getElementById('smRef')&&document.getElementById('smRef').value||'').trim()||null,
        counterparty:String(document.getElementById('smParty')&&document.getElementById('smParty').value||'').trim()||null,
        note:String(document.getElementById('smNote')&&document.getElementById('smNote').value||'').trim()||null
      };
      const btn=document.getElementById('smSave');
      if(btn){btn.disabled=true;btn.textContent='Submitting...'}
      try{
        await submit('manual_movement',payload,payload.note);
        closeModal();
        showToast('Stock action submitted for approval. Quantity has not changed yet.');
        if(typeof window.setInventoryTab==='function')window.setInventoryTab('requests');
      }catch(err){
        if(btn){btn.disabled=false;btn.textContent='Submit for Approval'}
        showToast(err.message||'Could not submit stock approval request.','err');
      }
    };
  }

  function patchSalesReleaseForm(itemId,formId,ids){
    if(!isStockController())return;
    const form=document.getElementById(formId);
    if(!form||form.dataset.approvalPatched==='1')return;
    form.dataset.approvalPatched='1';
    approvalNotice(form,'Customer Stock OUT');
    const btn=document.getElementById(ids.save);
    if(btn)btn.textContent='Submit Stock OUT for Approval';
    form.onsubmit=async function(e){
      e.preventDefault();
      const q=wholeNumber(ids.qty,'Release Qty');if(q==null)return;
      const loc=String(document.getElementById(ids.location)&&document.getElementById(ids.location).value||'').trim();
      if(!loc)return showToast('Select a stock location.','err');
      const payload={
        sales_order_item_id:itemId,
        qty:q,
        location_id:loc,
        delivery_date:(document.getElementById(ids.date)&&document.getElementById(ids.date).value)||null,
        note:String(document.getElementById(ids.note)&&document.getElementById(ids.note).value||'').trim()||null
      };
      if(btn){btn.disabled=true;btn.textContent='Submitting...'}
      try{
        await submit('sales_delivery',payload,payload.note);
        closeModal();
        showToast('Stock OUT submitted for approval. Stock has not been deducted yet.');
        if(typeof window.setInventoryTab==='function')window.setInventoryTab('requests');
      }catch(err){
        if(btn){btn.disabled=false;btn.textContent='Submit Stock OUT for Approval'}
        showToast(err.message||'Could not submit Stock OUT approval request.','err');
      }
    };
  }

  function patchDoReleaseForm(requestItemId){
    if(!isStockController())return;
    const form=document.getElementById('doStockReleaseForm');
    if(!form||form.dataset.approvalPatched==='1')return;
    form.dataset.approvalPatched='1';
    approvalNotice(form,'Delivery Order Stock OUT');
    const btn=document.getElementById('doReleaseSave');
    if(btn)btn.textContent='Submit DO OUT for Approval';
    form.onsubmit=async function(e){
      e.preventDefault();
      const q=wholeNumber('doReleaseQty','Release Qty');if(q==null)return;
      const loc=String(document.getElementById('doReleaseLocation')&&document.getElementById('doReleaseLocation').value||'').trim();
      if(!loc)return showToast('Select a stock location.','err');
      const payload={
        delivery_request_item_id:requestItemId,
        qty:q,
        location_id:loc,
        delivery_date:(document.getElementById('doReleaseDate')&&document.getElementById('doReleaseDate').value)||null,
        note:String(document.getElementById('doReleaseNote')&&document.getElementById('doReleaseNote').value||'').trim()||null
      };
      if(btn){btn.disabled=true;btn.textContent='Submitting...'}
      try{
        await submit('do_delivery',payload,payload.note);
        closeModal();
        showToast('DO Stock OUT submitted for approval. Stock has not been deducted yet.');
        if(typeof window.setInventoryTab==='function')window.setInventoryTab('requests');
      }catch(err){
        if(btn){btn.disabled=false;btn.textContent='Submit DO OUT for Approval'}
        showToast(err.message||'Could not submit DO approval request.','err');
      }
    };
  }

  const baseOpenMovement=window.openStockMovement;
  if(typeof baseOpenMovement==='function'){
    window.openStockMovement=async function(){
      const out=await baseOpenMovement.apply(this,arguments);
      patchManualMovementForm();
      return out;
    };
  }

  const baseReleaseSales=window.openReleaseSalesStock;
  if(typeof baseReleaseSales==='function'){
    window.openReleaseSalesStock=async function(itemId){
      const out=await baseReleaseSales.apply(this,arguments);
      patchSalesReleaseForm(itemId,'releaseStockForm',{
        qty:'rsQty',location:'rsLocation',date:'rsDate',note:'rsNote',save:'rsSave'
      });
      return out;
    };
  }

  const baseFulfillmentRelease=window.openStockFulfillmentRelease;
  if(typeof baseFulfillmentRelease==='function'){
    window.openStockFulfillmentRelease=async function(itemId){
      const out=await baseFulfillmentRelease.apply(this,arguments);
      patchSalesReleaseForm(itemId,'stockFulfillmentReleaseForm',{
        qty:'sfReleaseQty',location:'sfReleaseLocation',date:'sfReleaseDate',note:'sfReleaseNote',save:'sfReleaseSave'
      });
      return out;
    };
  }

  const baseDoRelease=window.openDoStockRelease;
  if(typeof baseDoRelease==='function'){
    window.openDoStockRelease=async function(requestId,requestItemId){
      const out=await baseDoRelease.apply(this,arguments);
      patchDoReleaseForm(requestItemId);
      return out;
    };
  }

  function actionLabel(r){
    if(r.action_type==='do_delivery')return 'DO Delivery OUT';
    if(r.action_type==='sales_delivery')return 'Customer Delivery OUT';
    return title(r.movement_type||'Stock Action');
  }
  function statusClass(s){
    s=String(s||'pending').toLowerCase();
    if(s==='approved')return 'bg-green-50 border-green-200 text-green-700';
    if(s==='rejected')return 'bg-red-50 border-red-200 text-red-700';
    return 'bg-amber-50 border-amber-200 text-amber-800';
  }

  async function loadActionRequests(){
    const r=await db.rpc('get_stock_action_requests',{p_status:null});
    if(r.error)throw r.error;
    A.rows=r.data||[];
    return A.rows;
  }

  function actionRequestCard(r){
    const pending=String(r.request_status||'')==='pending';
    const ref=r.do_no?('DO '+r.do_no):(r.document_no||r.reference_no||'');
    const route=r.from_location?(r.from_location+(r.to_location?' → '+r.to_location:'')):(r.to_location||'');
    return '<div class="inv-card border-l-4 '+(pending?'border-l-amber-400':r.request_status==='approved'?'border-l-green-500':'border-l-red-400')+'">'+
      '<div class="flex flex-col xl:flex-row xl:items-start xl:justify-between gap-4">'+
        '<div class="min-w-0 flex-1">'+
          '<div class="flex flex-wrap items-center gap-2">'+
            '<span class="px-2 py-1 rounded-lg border text-[9px] font-bold '+statusClass(r.request_status)+'">'+esc(title(r.request_status))+'</span>'+
            '<b>'+esc(actionLabel(r))+'</b>'+
            (ref?'<span class="text-[10px] text-gray-500">'+esc(ref)+'</span>':'')+
          '</div>'+
          '<div class="mt-2 text-sm font-semibold">'+esc(r.product_code||'Stock Item')+(r.item_name?' · '+esc(r.item_name):'')+'</div>'+
          '<div class="mt-1 flex flex-wrap gap-3 text-xs text-gray-600"><span>Qty <b>'+qty(r.qty)+'</b></span>'+(route?'<span>'+esc(route)+'</span>':'')+'</div>'+
          '<div class="text-[10px] text-gray-400 mt-2">Requested by '+esc(r.requested_by_name||'Stock Controller')+' · '+esc(dateTime(r.requested_at))+'</div>'+
          (r.reason?'<div class="mt-2 rounded-lg bg-gray-50 border p-2 text-xs"><b>Remark:</b> '+esc(r.reason)+'</div>':'')+
          (pending?'<div class="mt-2 text-[10px] font-semibold text-amber-700">Pending only — stock balance is unchanged.</div>':'')+
          (r.reviewer_note?'<div class="mt-2 text-[10px] text-gray-500"><b>Reviewer note:</b> '+esc(r.reviewer_note)+'</div>':'')+
        '</div>'+
        (canApprove()&&pending?'<div class="flex gap-2 shrink-0"><button onclick="reviewStockActionRequest(\''+r.request_id+'\',true)" class="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold">Approve</button><button onclick="reviewStockActionRequest(\''+r.request_id+'\',false)" class="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-semibold">Reject</button></div>':'')+
      '</div>'+
    '</div>';
  }

  async function renderActionRequestsPanel(){
    if(!activeRequestsTab())return;
    const root=document.getElementById('inventoryBody');if(!root)return;
    let holder=document.getElementById('stockActionApprovalPanel');
    if(!holder){
      holder=document.createElement('div');
      holder.id='stockActionApprovalPanel';
      holder.className='mb-5';
      root.insertBefore(holder,root.firstChild);
    }
    holder.innerHTML='<div class="inv-card py-8 text-center text-sm text-gray-400">Loading stock action approvals...</div>';
    try{
      const rows=await loadActionRequests();
      const pending=rows.filter(function(x){return x.request_status==='pending'}).length;
      let cards='';
      rows.forEach(function(r){cards+=actionRequestCard(r)});
      holder.innerHTML=
        '<div class="rounded-xl border border-amber-200 bg-amber-50 p-3 mb-3 flex flex-col md:flex-row md:items-center md:justify-between gap-2">'+
          '<div><b class="text-sm">'+(canApprove()?'Stock Quantity Approvals':'My Stock Approval Requests')+'</b><div class="text-[10px] text-amber-900 mt-1">OUT, Broken, Transfer, Adjustment − and Customer/DO delivery do not change stock until approved.</div></div>'+
          '<span class="px-2 py-1 rounded-full bg-white border text-[10px] font-bold">'+pending+' Pending</span>'+
        '</div>'+
        '<div class="grid gap-3">'+(cards||'<div class="inv-card py-10 text-center text-sm text-gray-400">No stock quantity approval requests yet.</div>')+'</div>';
      patchRequestBadge();
    }catch(err){
      holder.innerHTML='<div class="inv-card text-red-600">Error loading stock approvals: '+esc(err.message||'Unknown error')+'</div>';
    }
  }

  async function patchRequestBadge(){
    try{
      const rows=A.rows.length?A.rows:await loadActionRequests();
      const actionPending=rows.filter(function(x){return x.request_status==='pending'}).length;
      let editPending=0;
      try{
        let q=db.from('stock_change_requests').select('id,status').eq('status','pending').limit(500);
        const er=await q;
        if(!er.error)editPending=(er.data||[]).length;
      }catch(_){}
      const total=actionPending+editPending;
      const btn=[].slice.call(document.querySelectorAll('.inv-tab')).find(function(b){
        return String(b.getAttribute('onclick')||'').includes("setInventoryTab('requests')");
      });
      if(btn){
        let badge=btn.querySelector('.inv-tab-badge');
        if(!badge&&total){
          badge=document.createElement('span');
          badge.className='inv-tab-badge';
          btn.appendChild(badge);
        }
        if(badge){
          badge.textContent=String(total);
          badge.style.display=total?'inline-flex':'none';
        }
      }
    }catch(_){}
  }

  window.reviewStockActionRequest=async function(id,approve){
    if(!canApprove())return;
    const note=prompt(approve?'Optional approval note:':'Optional rejection note:')||'';
    const r=await db.rpc('review_stock_action_request',{
      p_request_id:id,
      p_approve:!!approve,
      p_reviewer_note:note||null
    });
    if(r.error)return showToast(r.error.message,'err');
    showToast(approve?'Approved. Stock quantity is now updated.':'Rejected. Stock quantity remains unchanged.');
    await refreshInventoryAfterApproval();
  };

  const baseBody=window.renderStockInventoryBody;
  if(typeof baseBody==='function'){
    window.renderStockInventoryBody=async function(){
      const out=await baseBody.apply(this,arguments);
      if(activeRequestsTab())await renderActionRequestsPanel();
      else patchRequestBadge();
      return out;
    };
  }

  setTimeout(function(){patchRequestBadge()},300);
})();