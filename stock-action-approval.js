// Approval gate for stock deductions and transfers.
// Stock Controller submits OUT / Broken / Transfer / Adjustment- / Customer Delivery / DO Delivery.
// Admin or Super Admin approval creates the real stock movement; pending requests do not affect stock balance.
(function(){
  const A={rows:[],loading:false,expanded:new Set(),details:new Map()};
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

  function detailTile(label,value,sub){
    if(value==null||String(value).trim()==='')return '';
    return '<div class="rounded-xl border bg-white p-3 min-w-0">'+
      '<div class="text-[9px] uppercase tracking-wide font-bold text-gray-400">'+esc(label)+'</div>'+
      '<div class="mt-1 text-xs font-semibold text-gray-800 break-words">'+esc(value)+'</div>'+
      (sub?'<div class="text-[9px] text-gray-400 mt-1 break-words">'+esc(sub)+'</div>':'')+
    '</div>';
  }

  function actionDetailHtml(d,r){
    d=d||{};
    const image=d.image_url||'';
    const route=d.from_location?(d.from_location+(d.to_location?' → '+d.to_location:'')):(d.to_location||'');
    const reference=d.do_no?('DO '+d.do_no):(d.document_no||d.reference_no||'');
    const customer=d.customer_name||'';
    const customerSub=[d.customer_phone,d.customer_address].filter(Boolean).join(' · ');
    const orderRef=[d.invoice_no,d.sr_no,d.order_no].filter(Boolean).filter(function(v,i,a){return a.indexOf(v)===i}).join(' · ');
    const dateLabel=d.delivery_date?'Delivery Date':d.movement_date?'Movement Date':'';
    const dateValue=d.delivery_date||d.movement_date||'';
    const note=d.note||d.reason||d.delivery_request_note||'';
    const requesterSub=d.requested_at?dateTime(d.requested_at):'';
    const reviewed=d.reviewed_by_name?d.reviewed_by_name+(d.reviewed_at?' · '+dateTime(d.reviewed_at):''):'';
    const productMeta=[d.brand,d.product_class].filter(Boolean).join(' · ');

    return '<div class="rounded-xl border border-gray-200 bg-[#faf9f6] p-4">'+
      '<div class="grid md:grid-cols-[116px_1fr] gap-4">'+
        '<div class="w-[116px] h-[116px] rounded-xl overflow-hidden border bg-white">'+
          (image
            ?'<img src="'+esc(image)+'" loading="lazy" class="w-full h-full object-cover" onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'"><div style="display:none" class="w-full h-full items-center justify-center text-[10px] text-gray-400 bg-gray-100">No Photo</div>'
            :'<div class="w-full h-full flex items-center justify-center text-[10px] text-gray-400 bg-gray-100">No Photo</div>')+
        '</div>'+
        '<div class="min-w-0">'+
          '<div class="flex flex-wrap items-start justify-between gap-3">'+
            '<div class="min-w-0"><div class="text-[10px] font-extrabold text-[#a77d1a]">'+esc(d.product_code||r.product_code||'Stock Item')+'</div><div class="text-base font-bold mt-1">'+esc(d.item_name||r.item_name||'Stock Item')+'</div>'+(productMeta?'<div class="text-[10px] text-gray-400 mt-1">'+esc(productMeta)+'</div>':'')+'</div>'+
            '<span class="px-2 py-1 rounded-lg border text-[9px] font-bold '+statusClass(d.request_status||r.request_status)+'">'+esc(title(d.request_status||r.request_status))+'</span>'+
          '</div>'+
          '<div class="grid sm:grid-cols-2 xl:grid-cols-4 gap-2 mt-4">'+
            detailTile('Requested Qty',qty(d.qty!=null?d.qty:r.qty))+
            detailTile('Location',route)+
            detailTile('Reference',reference,orderRef&&orderRef!==reference?orderRef:'')+
            detailTile(dateLabel,dateValue)+
            detailTile('Customer',customer,customerSub)+
            detailTile('Sales Rep',d.sales_rep_name)+
            detailTile('Requested By',d.requested_by_name||r.requested_by_name,requesterSub)+
            detailTile('Counterparty',d.counterparty)+
            detailTile('Reference Type',d.reference_type?title(d.reference_type):'')+
            detailTile('Movement Type',d.movement_type?title(d.movement_type):'')+
            detailTile('Reviewed By',reviewed)+
          '</div>'+
          (d.delivery_address?'<div class="mt-3 rounded-xl border bg-white p-3 text-xs"><div class="text-[9px] uppercase font-bold text-gray-400">Delivery Address</div><div class="mt-1">'+esc(d.delivery_address)+'</div></div>':'')+
          (note?'<div class="mt-3 rounded-xl border bg-white p-3 text-xs"><div class="text-[9px] uppercase font-bold text-gray-400">Note / Reason</div><div class="mt-1 whitespace-pre-wrap">'+esc(note)+'</div></div>':'')+
          (d.reviewer_note?'<div class="mt-3 rounded-xl border border-blue-100 bg-blue-50 p-3 text-xs text-blue-800"><b>Reviewer note:</b> '+esc(d.reviewer_note)+'</div>':'')+
        '</div>'+
      '</div>'+
    '</div>';
  }

  window.toggleStockActionRequestDetails=async function(id,event){
    if(event&&typeof event.stopPropagation==='function')event.stopPropagation();
    id=String(id||'');
    const detail=document.getElementById('stockActionDetail_'+id);
    const arrow=document.getElementById('stockActionArrow_'+id);
    if(!detail)return;

    if(A.expanded.has(id)){
      A.expanded.delete(id);
      detail.classList.add('hidden');
      if(arrow)arrow.textContent='⌄';
      return;
    }

    A.expanded.add(id);
    detail.classList.remove('hidden');
    if(arrow)arrow.textContent='⌃';

    const row=A.rows.find(function(x){return String(x.request_id)===id})||{};
    if(A.details.has(id)){
      detail.innerHTML=actionDetailHtml(A.details.get(id),row);
      return;
    }

    detail.innerHTML='<div class="rounded-xl border bg-gray-50 p-6 text-center text-xs text-gray-400">Loading request details and product photo...</div>';
    const res=await db.rpc('get_stock_action_request_detail',{p_request_id:id});
    if(res.error){
      detail.innerHTML='<div class="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-600">Could not load request details: '+esc(res.error.message||'Unknown error')+'</div>';
      return;
    }
    if(!res.data){
      detail.innerHTML='<div class="rounded-xl border p-4 text-xs text-gray-400">Request details are unavailable.</div>';
      return;
    }
    A.details.set(id,res.data);
    detail.innerHTML=actionDetailHtml(res.data,row);
  };

  function actionRequestCard(r){
    const pending=String(r.request_status||'')==='pending';
    const ref=r.do_no?('DO '+r.do_no):(r.document_no||r.reference_no||'');
    const route=r.from_location?(r.from_location+(r.to_location?' → '+r.to_location:'')):(r.to_location||'');
    const id=String(r.request_id||'');
    const expanded=A.expanded.has(id);
    const cached=A.details.get(id);
    return '<div class="inv-card border-l-4 '+(pending?'border-l-amber-400':r.request_status==='approved'?'border-l-green-500':'border-l-red-400')+'">'+
      '<div onclick="toggleStockActionRequestDetails(\''+id+'\',event)" class="cursor-pointer group">'+
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
            '<div class="mt-2 text-[10px] font-semibold text-[#a77d1a] group-hover:underline">Click to '+(expanded?'hide':'view')+' details & product photo <span id="stockActionArrow_'+id+'">'+(expanded?'⌃':'⌄')+'</span></div>'+
          '</div>'+
          (canApprove()&&pending?'<div class="flex gap-2 shrink-0"><button onclick="event.stopPropagation();reviewStockActionRequest(\''+id+'\',true)" class="px-3 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold">Approve</button><button onclick="event.stopPropagation();reviewStockActionRequest(\''+id+'\',false)" class="px-3 py-2 rounded-lg border border-red-200 text-red-600 text-xs font-semibold">Reject</button></div>':'')+
        '</div>'+
      '</div>'+
      '<div id="stockActionDetail_'+id+'" class="'+(expanded?'':'hidden ')+'mt-4 pt-4 border-t">'+(expanded?(cached?actionDetailHtml(cached,r):'<div class="rounded-xl border bg-gray-50 p-6 text-center text-xs text-gray-400">Click again if details do not load automatically.</div>'):'')+'</div>'+
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