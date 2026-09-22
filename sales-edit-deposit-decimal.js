// Edit-order improvements: editable initial deposit + easy decimal typing for unit prices.
// Loaded last so it can extend the existing Sales Order edit workflow safely.
(function(){
  const depositCtx={orderId:null,oldDeposit:0,totalPaid:0,loaded:false};

  function numText(v){
    const s=String(v??'').trim().replace(/,/g,'.');
    if(!s)return 0;
    const n=Number(s);
    return Number.isFinite(n)?n:NaN;
  }
  function parseMoneyText(v){
    const s=String(v||'').replace(/,/g,'').replace(/[^0-9.-]/g,'');
    const n=Number(s);return Number.isFinite(n)?n:0;
  }
  function decimalize(root=document){
    root.querySelectorAll?.('.unit-price,.edit-unit-price').forEach(el=>{
      if(el.dataset.decimalTyping==='1')return;
      el.dataset.decimalTyping='1';
      try{el.type='text'}catch{}
      el.inputMode='decimal';
      el.autocomplete='off';
      el.setAttribute('aria-label',el.getAttribute('aria-label')||'Unit price');
      el.addEventListener('blur',()=>{
        const raw=String(el.value||'').trim().replace(/,/g,'.');
        if(raw===''||raw==='.'||raw==='-')return;
        const n=Number(raw);
        if(Number.isFinite(n)&&n>=0)el.value=String(n);
      });
    });
  }

  const modalBody=document.getElementById('modalBody');
  if(modalBody){
    new MutationObserver(()=>decimalize(modalBody)).observe(modalBody,{childList:true,subtree:true});
  }
  document.addEventListener('focusin',e=>{
    if(e.target?.matches?.('.unit-price,.edit-unit-price'))decimalize(e.target.parentElement||document);
  });

  function currentDeposit(){
    const el=document.getElementById('editInitialDeposit');
    const n=numText(el?.value||0);
    return Number.isFinite(n)?Math.max(0,n):NaN;
  }
  function applyDepositPreview(){
    if(!depositCtx.loaded)return;
    const inp=document.getElementById('editInitialDeposit');
    if(!inp)return;
    const dep=currentDeposit();
    if(!Number.isFinite(dep))return;
    const adjustedPaid=Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit+dep);
    const total=parseMoneyText(document.getElementById('editTotal')?.textContent||0);
    const paidEl=document.getElementById('editPaid'),balEl=document.getElementById('editBalance');
    if(paidEl)paidEl.textContent=money(adjustedPaid);
    if(balEl)balEl.textContent=money(Math.max(total-adjustedPaid,0));
    inp.classList.toggle('border-red-300',adjustedPaid>total+0.001);
    inp.classList.toggle('bg-red-50',adjustedPaid>total+0.001);
    const other=document.getElementById('editOtherPayments');
    if(other)other.textContent=money(Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit));
  }
  window.editInitialDepositChanged=function(){applyDepositPreview()};

  const baseRecalc=window.editOrderRecalc;
  if(typeof baseRecalc==='function'){
    window.editOrderRecalc=function(){
      const r=baseRecalc.apply(this,arguments);
      applyDepositPreview();
      return r;
    };
  }

  async function injectDepositEditor(orderId){
    const form=document.getElementById('editSalesOrderForm');
    if(!form)return;
    decimalize(form);

    const {data,error}=await db.rpc('get_sales_order_deposit_edit_info',{p_order_id:orderId});
    if(error){console.warn('Deposit edit info unavailable:',error.message);return;}
    const info=Array.isArray(data)?(data[0]||{}):(data||{});
    depositCtx.orderId=orderId;
    depositCtx.oldDeposit=Number(info.deposit_amount||0);
    depositCtx.totalPaid=Number(info.total_paid||0);
    depositCtx.loaded=true;

    const summary=document.getElementById('editSubtotal')?.closest('.grid');
    if(summary&&!document.getElementById('editInitialDeposit')){
      const block=document.createElement('div');
      block.id='editDepositEditorBlock';
      block.className='grid md:grid-cols-2 gap-4 border-t pt-4';
      block.innerHTML=`
        <div>
          <label class="text-xs font-semibold">Initial Deposit Amount</label>
          <input id="editInitialDeposit" type="text" inputmode="decimal" value="${depositCtx.oldDeposit}" oninput="editInitialDepositChanged()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 1500.50">
          <div class="text-[10px] text-gray-400 mt-1">You can correct the original deposit here. Later/additional payments are not changed.</div>
        </div>
        <div class="rounded-xl border bg-gray-50 px-4 py-3">
          <div class="text-[9px] uppercase font-bold text-gray-400">Other Payments</div>
          <div id="editOtherPayments" class="text-lg font-bold mt-1">${money(Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit))}</div>
          <div class="text-[10px] text-gray-400 mt-1">These stay in the Payments history and remain untouched.</div>
        </div>`;
      summary.parentNode.insertBefore(block,summary);
    }

    applyDepositPreview();

    const originalSubmit=form.onsubmit;
    if(typeof originalSubmit!=='function'||form.dataset.depositWrapped==='1')return;
    form.dataset.depositWrapped='1';
    form.onsubmit=async function(e){
      e.preventDefault();
      const desired=currentDeposit();
      if(!Number.isFinite(desired))return showToast('Enter a valid deposit amount, for example 1500.50.','err');
      const total=parseMoneyText(document.getElementById('editTotal')?.textContent||0);
      const adjustedPaid=Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit+desired);
      if(adjustedPaid>total+0.001){
        return showToast(`Deposit plus other payments cannot be greater than the order total (${money(total)}).`,'err');
      }
      const changed=Math.abs(desired-depositCtx.oldDeposit)>0.0001;
      const modal=document.getElementById('modal');
      await originalSubmit.call(this,e);
      const saveSucceeded=!!modal?.classList.contains('hidden');
      if(!saveSucceeded||!changed)return;

      const {error}=await db.rpc('set_sales_order_initial_deposit',{p_order_id:orderId,p_amount:desired});
      if(error){
        showToast(`Order saved, but deposit was not changed: ${error.message}`,'err');
        return;
      }
      showToast('Order and deposit updated');
      await go('sales-orders');
    };
  }

  const baseOpenEdit=window.openEditSalesOrder;
  if(typeof baseOpenEdit==='function'){
    window.openEditSalesOrder=async function(orderId){
      depositCtx.orderId=null;depositCtx.oldDeposit=0;depositCtx.totalPaid=0;depositCtx.loaded=false;
      const r=await baseOpenEdit.apply(this,arguments);
      await injectDepositEditor(orderId);
      decimalize(document.getElementById('modalBody')||document);
      return r;
    };
  }

  const baseOpenNew=window.openNewOrder;
  if(typeof baseOpenNew==='function'){
    window.openNewOrder=async function(){
      const r=await baseOpenNew.apply(this,arguments);
      decimalize(document.getElementById('modalBody')||document);
      return r;
    };
  }

  const baseAddNew=window.addOrderItemRow;
  if(typeof baseAddNew==='function'){
    window.addOrderItemRow=function(){const r=baseAddNew.apply(this,arguments);decimalize(document.getElementById('orderItems')||document);return r};
  }
  const baseAddEdit=window.addEditOrderItem;
  if(typeof baseAddEdit==='function'){
    window.addEditOrderItem=function(){const r=baseAddEdit.apply(this,arguments);decimalize(document.getElementById('editOrderItems')||document);return r};
  }
})();