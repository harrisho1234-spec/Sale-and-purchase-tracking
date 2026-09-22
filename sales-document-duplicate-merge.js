// Duplicate TK/RK/SR guard + safe merge into an existing document.
// Loaded after sales-customer-typeahead.js so it can watch the searchable customer selector too.
(function(){
  const baseOpenNewOrder=window.openNewOrder;
  if(typeof baseOpenNewOrder!=='function') return;

  function cleanDoc(v){return String(v||'').trim().toUpperCase().replace(/\s+/g,'')}
  function currentFlow(){return document.getElementById('salesFlowType')?.value||'stock_sale'}
  function currentInvoiceType(){return document.getElementById('salesInvoiceType')?.value||'TK'}
  function normalizeDoc(flow,invoiceType,raw){
    let v=cleanDoc(raw);
    if(!v)return '';
    if(flow==='pre_order'){
      if(!v.startsWith('SR'))v='SR-'+v.replace(/^[-:]+/,'');
      return v;
    }
    if(!v.startsWith(invoiceType))v=invoiceType+v.replace(/^[-:]+/,'');
    return v;
  }
  function orderRows(){return [...document.querySelectorAll('#orderItems .order-item-row')]}
  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
  function calcEntry(){
    let subtotal=0;
    orderRows().forEach(r=>{
      const q=Number(r.querySelector('.qty')?.value||0);
      const p=Number(String(r.querySelector('.unit-price')?.value||0).replace(',','.'));
      const d=Number(r.querySelector('.line-discount')?.value||0);
      subtotal+=Math.max(q*p-d,0);
    });
    const orderDiscount=Math.max(Number(document.getElementById('orderDiscount')?.value||0),0);
    const total=Math.max(subtotal-orderDiscount,0);
    const depositMode=document.getElementById('depositMode')?.value||'amount';
    const depositValue=Math.max(Number(document.getElementById('depositValue')?.value||0),0);
    const depositAmount=depositMode==='percent'?round2(total*depositValue/100):round2(depositValue);
    return {subtotal:round2(subtotal),orderDiscount:round2(orderDiscount),total:round2(total),depositMode,depositValue:round2(depositValue),depositAmount};
  }

  function itemPayload(flow){
    return orderRows().map(r=>({
      product_id:r.querySelector('.product-id')?.value||'',
      product_code_snapshot:r.querySelector('.product-code')?.value||'',
      item_name_snapshot:r.querySelector('.product-name')?.value||'',
      image_url_snapshot:r.querySelector('.product-image')?.value||null,
      qty:Number(r.querySelector('.qty')?.value||0),
      unit_price:Number(String(r.querySelector('.unit-price')?.value||0).replace(',','.')),
      discount_amount:Number(r.querySelector('.line-discount')?.value||0),
      source_type:flow==='pre_order'?'pre_order':'stock',
      fulfillment_status:flow==='pre_order'?'pending':'ready'
    }));
  }

  function findSubmitButton(form){
    return [...form.querySelectorAll('button')].find(b=>b.type==='submit') || [...form.querySelectorAll('button')].reverse().find(b=>b.type!=='button');
  }

  function setupDuplicateGuard(){
    const form=document.getElementById('orderForm');
    const docInput=document.getElementById('salesDocumentNo');
    const customer=document.getElementById('orderCustomer');
    if(!form||!docInput||!customer||form.dataset.duplicateMergeReady==='1')return;
    form.dataset.duplicateMergeReady='1';

    const originalSubmit=form.onsubmit;
    const submitBtn=findSubmitButton(form);
    const originalSubmitText=submitBtn?.textContent||'Create Sale / Order';
    let mergeTarget=null;
    let lastDuplicate=null;
    let timer=null;
    let checkSeq=0;

    const alertBox=document.createElement('div');
    alertBox.id='salesDocumentDuplicateAlert';
    alertBox.className='hidden mt-2';
    docInput.parentElement.appendChild(alertBox);

    function selectedCustomerId(){return customer.value||''}
    function currentDoc(){return normalizeDoc(currentFlow(),currentInvoiceType(),docInput.value)}
    function resetMerge(){
      mergeTarget=null;
      if(submitBtn)submitBtn.textContent=originalSubmitText;
    }

    function renderDuplicate(row){
      lastDuplicate=row||null;
      if(!row){alertBox.classList.add('hidden');alertBox.innerHTML='';resetMerge();return}
      const cid=selectedCustomerId();
      const sameCustomer=!!cid&&row.customer_id===cid;
      const selected=mergeTarget?.order_id===row.order_id;
      const canMerge=!!row.can_merge&&sameCustomer;
      const cls=selected?'border-green-200 bg-green-50 text-green-900':canMerge?'border-amber-200 bg-amber-50 text-amber-950':'border-red-200 bg-red-50 text-red-900';
      const icon=selected?'✓':'⚠';
      let action='';
      if(selected){
        action=`<div class="mt-2 text-[11px] font-semibold">New items and any new deposit will be added to this existing document. Existing items and payments stay unchanged.</div>`;
      }else if(canMerge){
        action=`<div class="mt-3 flex flex-wrap gap-2"><button type="button" data-use-merge class="px-3 py-2 rounded-lg bg-[#211d18] text-white text-xs font-semibold">Merge With Existing</button><button type="button" data-change-number class="px-3 py-2 rounded-lg border bg-white text-xs font-semibold">Use Different Number</button></div>`;
      }else if(!cid){
        action=`<div class="mt-2 text-[11px]">Select <b>${esc(row.customer_name||'the existing customer')}</b> first to enable merge.</div>`;
      }else{
        action=`<div class="mt-2 text-[11px]">${esc(row.merge_reason||'This document cannot be merged with the selected customer.')}</div>`;
      }
      alertBox.innerHTML=`<div class="rounded-xl border p-3 ${cls}">
        <div class="flex gap-2 items-start"><div class="font-bold">${icon}</div><div class="min-w-0 flex-1">
          <div class="text-xs font-bold">${esc(row.document_no||currentDoc())} already exists</div>
          <div class="text-[11px] mt-1 opacity-80">Customer: <b>${esc(row.customer_name||'-')}</b>${row.sales_rep_name?` · Sales Rep: <b>${esc(row.sales_rep_name)}</b>`:''}</div>
          <div class="text-[11px] mt-1 opacity-80">${Number(row.item_count||0)} item line${Number(row.item_count||0)===1?'':'s'} · Total ${money(row.order_total||0)} · Paid ${money(row.amount_paid||0)} · Balance ${money(row.balance_due||0)}</div>
          ${action}
        </div></div>
      </div>`;
      alertBox.classList.remove('hidden');
      alertBox.querySelector('[data-use-merge]')?.addEventListener('click',()=>{
        mergeTarget=row;
        if(submitBtn)submitBtn.textContent=`Merge Into ${row.document_no||currentDoc()}`;
        renderDuplicate(row);
      });
      alertBox.querySelector('[data-change-number]')?.addEventListener('click',()=>{
        resetMerge();
        docInput.focus();docInput.select();
      });
    }

    async function checkDuplicate(){
      const seq=++checkSeq;
      const doc=currentDoc();
      const cid=selectedCustomerId()||null;
      if(!doc||doc.length<3){renderDuplicate(null);return null}
      const {data,error}=await db.rpc('check_sales_document_duplicate',{p_doc_no:doc,p_customer_id:cid});
      if(seq!==checkSeq)return lastDuplicate;
      if(error){console.warn('Duplicate document check failed:',error.message);return null}
      const row=Array.isArray(data)?data[0]:data;
      if(!row){renderDuplicate(null);return null}
      if(mergeTarget&&mergeTarget.order_id!==row.order_id)resetMerge();
      renderDuplicate(row);
      return row;
    }

    function queueCheck(){
      resetMerge();
      clearTimeout(timer);
      timer=setTimeout(()=>checkDuplicate(),350);
    }

    docInput.addEventListener('input',queueCheck);
    docInput.addEventListener('blur',()=>checkDuplicate());
    customer.addEventListener('change',queueCheck);
    document.getElementById('orderCustomerSearch')?.addEventListener('input',()=>{resetMerge();clearTimeout(timer);timer=setTimeout(()=>checkDuplicate(),450)});
    document.getElementById('salesInvoiceType')?.addEventListener('change',queueCheck);
    document.getElementById('salesFlowType')?.addEventListener('change',queueCheck);

    async function mergeExisting(e,row){
      const cid=selectedCustomerId();
      if(!cid)return showToast('Please select the customer first.','err');
      if(cid!==row.customer_id)return showToast(`This document belongs to ${row.customer_name||'another customer'}.`,'err');
      if(!row.can_merge)return showToast(row.merge_reason||'You cannot merge this document.','err');

      const rows=orderRows();
      if(!rows.length)return showToast('Add at least one item.','err');
      const missing=rows.find(r=>!r.querySelector('.product-id')?.value);
      if(missing){missing.querySelector('.product-search-input')?.focus();return showToast('Choose a matching product from the suggestion list.','err')}

      const flow=currentFlow();
      const c=calcEntry();
      if(c.total<=0)return showToast('The added items total must be greater than zero.','err');
      if(c.depositMode==='percent'&&c.depositValue>100)return showToast('Deposit percentage cannot be more than 100%.','err');
      const items=itemPayload(flow);
      if(items.some(i=>!i.product_id||i.qty<=0||i.unit_price<0||i.discount_amount<0))return showToast('Please check item quantity, price and discount.','err');

      const doc=currentDoc();
      const orderDate=document.getElementById('orderDate')?.value||new Date().toISOString().slice(0,10);
      const method=document.getElementById('paymentMethod')?.value?.trim()||'Deposit';
      if(submitBtn){submitBtn.disabled=true;submitBtn.textContent='Merging...'}
      try{
        const {data,error}=await db.rpc('merge_sales_order_document',{
          p_order_id:row.order_id,
          p_customer_id:cid,
          p_expected_doc_no:doc,
          p_flow_type:flow,
          p_order_discount_add:c.orderDiscount,
          p_items:items,
          p_payment_amount:c.depositAmount,
          p_payment_date:orderDate,
          p_payment_method:method,
          p_payment_note:c.depositAmount>0?`Additional deposit from merged ${doc} entry`:null
        });
        if(error)return showToast(error.message,'err');
        if(window.documentFlowState)window.documentFlowState.loaded=false;
        if(typeof managerRepActive==='function'&&managerRepActive()&&typeof recordManagerRepAction==='function'){
          await recordManagerRepAction('merge_sales_order','sales_order',row.order_id,{document_no:doc,items_added:items.length,deposit_added:c.depositAmount});
        }
        const result=Array.isArray(data)?data[0]:data;
        closeModal();
        showToast(`${doc} merged successfully — ${items.length} item line${items.length===1?'':'s'} added${c.depositAmount>0?` and ${money(c.depositAmount)} payment added`:''}.`);
        await go('sales-orders');
        return result;
      }finally{
        if(submitBtn&&!document.getElementById('orderForm'))return;
        if(submitBtn){submitBtn.disabled=false;submitBtn.textContent=mergeTarget?`Merge Into ${row.document_no||doc}`:originalSubmitText}
      }
    }

    form.onsubmit=async function(e){
      e.preventDefault();
      const row=await checkDuplicate();
      if(row){
        if(mergeTarget?.order_id===row.order_id&&row.can_merge&&selectedCustomerId()===row.customer_id){
          return mergeExisting(e,row);
        }
        showToast(`${row.document_no||currentDoc()} already exists. Choose “Merge With Existing” or enter a different number.`,'err');
        docInput.focus();
        return;
      }
      if(typeof originalSubmit==='function')return originalSubmit.call(form,e);
    };
  }

  window.openNewOrder=async function(){
    const out=await baseOpenNewOrder.apply(this,arguments);
    setupDuplicateGuard();
    return out;
  };
})();
