// Edit-order improvements: editable initial deposit by amount/% + easy decimal typing for unit prices.
// Loaded last so it can extend the existing Sales Order edit workflow safely.
(function(){
  const depositCtx={orderId:null,oldDeposit:0,totalPaid:0,loaded:false,basis:'amount'};

  function round2(v){return Math.round((Number(v||0)+Number.EPSILON)*100)/100}
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
  function fmtPct(v){return Number(v||0).toFixed(2)}

  // Number inputs can be awkward when entering a decimal point manually in some browsers.
  // Use decimal text entry for unit prices so values such as 1.5 / 205.50 can be typed directly.
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

  function orderTotal(){return parseMoneyText(document.getElementById('editTotal')?.textContent||0)}
  function amountInput(){return document.getElementById('editInitialDepositAmount')}
  function percentInput(){return document.getElementById('editInitialDepositPercent')}

  function currentDepositAmount(){
    const total=orderTotal();
    if(depositCtx.basis==='percent'){
      const pct=numText(percentInput()?.value||0);
      if(!Number.isFinite(pct))return NaN;
      return round2(total*Math.max(0,pct)/100);
    }
    const amt=numText(amountInput()?.value||0);
    return Number.isFinite(amt)?Math.max(0,amt):NaN;
  }

  function syncDepositFields(source){
    if(!depositCtx.loaded)return;
    const total=orderTotal();
    const a=amountInput(),p=percentInput();
    if(!a||!p)return;

    if(source==='percent')depositCtx.basis='percent';
    if(source==='amount')depositCtx.basis='amount';

    if(depositCtx.basis==='percent'){
      const pct=numText(p.value||0);
      if(Number.isFinite(pct))a.value=String(round2(total*Math.max(0,pct)/100));
    }else{
      const amt=numText(a.value||0);
      if(Number.isFinite(amt))p.value=fmtPct(total>0?Math.max(0,amt)/total*100:0);
    }
  }

  function applyDepositPreview(source){
    if(!depositCtx.loaded)return;
    syncDepositFields(source);
    const a=amountInput(),p=percentInput();
    if(!a||!p)return;

    const dep=currentDepositAmount();
    const pct=numText(p.value||0);
    if(!Number.isFinite(dep)||!Number.isFinite(pct))return;

    const total=orderTotal();
    const adjustedPaid=Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit+dep);
    const paidEl=document.getElementById('editPaid'),balEl=document.getElementById('editBalance');
    if(paidEl)paidEl.textContent=money(adjustedPaid);
    if(balEl)balEl.textContent=money(Math.max(total-adjustedPaid,0));

    const bad=adjustedPaid>total+0.001||pct>100.0001;
    [a,p].forEach(inp=>{
      inp.classList.toggle('border-red-300',bad);
      inp.classList.toggle('bg-red-50',bad);
    });

    const other=document.getElementById('editOtherPayments');
    if(other)other.textContent=money(Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit));
    const basis=document.getElementById('editDepositBasisHint');
    if(basis)basis.textContent=depositCtx.basis==='percent'?'Percentage is the active basis. Amount changes automatically with the order total.':'Amount is the active basis. Percentage is calculated automatically.';
  }

  window.editInitialDepositPercentChanged=function(){applyDepositPreview('percent')};
  window.editInitialDepositAmountChanged=function(){applyDepositPreview('amount')};

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

    const {data,error}=await db.rpc('get_sales_order_deposit_edit_info_v2',{p_order_id:orderId});
    if(error){console.warn('Deposit edit info unavailable:',error.message);return;}
    const info=Array.isArray(data)?(data[0]||{}):(data||{});
    depositCtx.orderId=orderId;
    depositCtx.oldDeposit=Number(info.deposit_amount||0);
    depositCtx.totalPaid=Number(info.total_paid||0);
    depositCtx.basis=info.deposit_input_type==='percent'?'percent':'amount';
    depositCtx.loaded=true;

    const total=orderTotal();
    const savedValue=Number(info.deposit_input_value||0);
    const initialPct=depositCtx.basis==='percent'
      ? savedValue
      : (total>0?depositCtx.oldDeposit/total*100:0);
    const initialAmount=depositCtx.oldDeposit;

    const summary=document.getElementById('editSubtotal')?.closest('.grid');
    if(summary&&!document.getElementById('editInitialDepositAmount')){
      const block=document.createElement('div');
      block.id='editDepositEditorBlock';
      block.className='grid md:grid-cols-3 gap-4 border-t pt-4';
      block.innerHTML=`
        <div>
          <label class="text-xs font-semibold">Initial Deposit %</label>
          <div class="relative mt-1">
            <input id="editInitialDepositPercent" type="text" inputmode="decimal" value="${fmtPct(initialPct)}" oninput="editInitialDepositPercentChanged()" class="w-full border rounded-xl px-3 py-2 pr-9" placeholder="00.00">
            <span class="absolute right-3 top-2 text-gray-400 text-sm">%</span>
          </div>
          <div class="text-[10px] text-gray-400 mt-1">Type a percentage such as 30 or 30.50.</div>
        </div>
        <div>
          <label class="text-xs font-semibold">Initial Deposit Amount</label>
          <input id="editInitialDepositAmount" type="text" inputmode="decimal" value="${initialAmount}" oninput="editInitialDepositAmountChanged()" class="mt-1 w-full border rounded-xl px-3 py-2" placeholder="Example: 1500.50">
          <div id="editDepositBasisHint" class="text-[10px] text-gray-400 mt-1"></div>
        </div>
        <div class="rounded-xl border bg-gray-50 px-4 py-3">
          <div class="text-[9px] uppercase font-bold text-gray-400">Other Payments</div>
          <div id="editOtherPayments" class="text-lg font-bold mt-1">${money(Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit))}</div>
          <div class="text-[10px] text-gray-400 mt-1">Later/additional payments stay unchanged.</div>
        </div>`;
      summary.parentNode.insertBefore(block,summary);
    }

    applyDepositPreview();

    const originalSubmit=form.onsubmit;
    if(typeof originalSubmit!=='function'||form.dataset.depositWrapped==='1')return;
    form.dataset.depositWrapped='1';
    form.onsubmit=async function(e){
      e.preventDefault();
      const total=orderTotal();
      const pct=numText(percentInput()?.value||0);
      const amount=numText(amountInput()?.value||0);
      if(!Number.isFinite(pct)||!Number.isFinite(amount))return showToast('Enter a valid deposit percentage/amount.','err');
      if(pct<0||pct>100)return showToast('Deposit percentage must be between 0% and 100%.','err');

      const inputType=depositCtx.basis;
      const inputValue=inputType==='percent'?pct:amount;
      const desired=inputType==='percent'?round2(total*pct/100):Math.max(0,amount);
      const adjustedPaid=Math.max(0,depositCtx.totalPaid-depositCtx.oldDeposit+desired);
      if(adjustedPaid>total+0.001){
        return showToast(`Deposit plus other payments cannot be greater than the order total (${money(total)}).`,'err');
      }

      const oldStoredType=info.deposit_input_type==='percent'?'percent':'amount';
      const oldStoredValue=Number(info.deposit_input_value??depositCtx.oldDeposit);
      const changed=inputType!==oldStoredType||Math.abs(inputValue-oldStoredValue)>0.0001||Math.abs(desired-depositCtx.oldDeposit)>0.0001;
      const modal=document.getElementById('modal');

      await originalSubmit.call(this,e);
      const saveSucceeded=!!modal?.classList.contains('hidden');
      if(!saveSucceeded||!changed)return;

      const {error:saveErr}=await db.rpc('set_sales_order_initial_deposit_input',{
        p_order_id:orderId,
        p_input_type:inputType,
        p_input_value:inputValue
      });
      if(saveErr){
        showToast(`Order saved, but deposit was not changed: ${saveErr.message}`,'err');
        return;
      }
      showToast('Order and deposit updated');
      await go('sales-orders');
    };
  }

  const baseOpenEdit=window.openEditSalesOrder;
  if(typeof baseOpenEdit==='function'){
    window.openEditSalesOrder=async function(orderId){
      depositCtx.orderId=null;depositCtx.oldDeposit=0;depositCtx.totalPaid=0;depositCtx.loaded=false;depositCtx.basis='amount';
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