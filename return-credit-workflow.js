(function(){
  function role(){return state.profile?.role||''}
  function canManageCredit(){return ['manager','admin','super_admin'].includes(role())}
  function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
  async function loadCreditSummary(){
    const r=await db.rpc('get_visible_sales_return_credit_summary');
    if(r.error)throw r.error;
    const map=new Map((r.data||[]).map(x=>[x.return_id,x]));
    if(Array.isArray(window._visibleSalesReturns)){
      window._visibleSalesReturns=window._visibleSalesReturns.map(x=>({...x,...(map.get(x.return_id)||{})}));
    }
    return map;
  }

  function getReturnIdFromRow(row){
    const b=[...row.querySelectorAll('button')].find(x=>String(x.getAttribute('onclick')||'').includes("viewSalesReturn("));
    const m=String(b?.getAttribute('onclick')||'').match(/viewSalesReturn\('([^']+)'\)/);
    return m?m[1]:null;
  }

  function button(text,cls,fn){
    const b=document.createElement('button');
    b.type='button';
    b.textContent=text;
    b.className=cls;
    b.onclick=fn;
    return b;
  }

  function decorateRows(){
    const rows=[...document.querySelectorAll('#salesReturnRows > div')];
    const data=window._visibleSalesReturns||[];
    rows.forEach(row=>{
      const id=getReturnIdFromRow(row);
      const h=data.find(x=>x.return_id===id);
      if(!h)return;
      const actions=[...row.querySelectorAll('div')].find(x=>x.classList.contains('justify-end')&&x.querySelector('button'));
      if(!actions)return;

      [...actions.querySelectorAll('[data-credit-action]')].forEach(x=>x.remove());

      if(h.financial_effect==='credit_ar'){
        const badge=document.createElement('div');
        badge.dataset.creditAction='1';
        badge.className='px-3 py-2 rounded-lg border border-blue-200 bg-blue-50 text-blue-700 text-[10px] font-bold';
        badge.textContent='Credit '+money(h.credit_amount||0)+' · Applied '+money(h.applied_amount||0);
        actions.insertBefore(badge,actions.firstChild);

        [...actions.querySelectorAll('button')].forEach(b=>{
          if(b.textContent.trim()==='Edit')b.style.display='none';
        });

        if(canManageCredit()){
          const remove=button('Remove Credit','px-3 py-2 border border-gray-200 bg-white text-gray-700 rounded-lg text-xs font-semibold',()=>setSalesReturnFinancialTreatment(id,'none'));
          remove.dataset.creditAction='1';
          actions.appendChild(remove);
        }
      }else if(canManageCredit()&&h.status==='received'){
        const apply=button('Apply Customer Credit','px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold',()=>setSalesReturnFinancialTreatment(id,'credit_ar'));
        apply.dataset.creditAction='1';
        actions.appendChild(apply);
      }
    });
  }

  window.setSalesReturnFinancialTreatment=async function(id,effect){
    if(!canManageCredit())return showToast('Manager, Admin or Super Admin access required.','err');
    const h=(window._visibleSalesReturns||[]).find(x=>x.return_id===id);
    if(!h)return showToast('Credit Note not found.','err');
    const apply=effect==='credit_ar';
    const msg=apply
      ? 'Apply '+money(h.return_value||0)+' as customer credit?\n\nThe credit will be applied to the customer\'s current collectible AR. If the original invoice is already settled, it will move to another outstanding invoice. Any unused amount remains available on the customer account.'
      : 'Remove customer credit from '+(h.cn_no||'this CN')+'?\n\nAny AR allocation created by this CN will be reversed.';
    if(!confirm(msg))return;
    const r=await db.rpc('set_sales_return_financial_treatment',{p_return_id:id,p_effect:effect});
    if(r.error)return showToast(r.error.message,'err');
    const d=r.data||{};
    closeModal();
    showToast(apply
      ? 'Customer credit approved: '+money(d.applied_amount||0)+' applied'+(n(d.available_credit)>0?', '+money(d.available_credit)+' available':'')
      : 'Customer credit removed');
    await renderReturnsPage();
  };

  const baseRender=window.renderReturnsPage;
  if(typeof baseRender==='function'){
    window.renderReturnsPage=async function(){
      await baseRender.apply(this,arguments);
      try{
        const map=await loadCreditSummary();
        const total=[...map.values()].filter(x=>x.status!=='cancelled'&&x.financial_effect==='credit_ar').reduce((a,x)=>a+n(x.credit_amount),0);
        const avail=[...map.values()].filter(x=>x.status!=='cancelled'&&x.financial_effect==='credit_ar').reduce((a,x)=>a+n(x.available_credit),0);
        const kpis=[...document.querySelectorAll('#salesReturnsRoot .grid.grid-cols-2.xl\\:grid-cols-4 > div')];
        const returnCard=kpis.find(x=>x.textContent.includes('Return Value'));
        if(returnCard){
          const sub=returnCard.querySelector('.text-gray-400:last-child')||returnCard.lastElementChild;
          if(sub)sub.innerHTML=total>0?'Approved customer credit: <b>'+money(total)+'</b>'+(avail>0?' · '+money(avail)+' available':''):'No customer credit approved';
        }
        decorateRows();
      }catch(err){console.warn('Return credit summary:',err.message)}
    };
  }

  const baseView=window.viewSalesReturn;
  if(typeof baseView==='function'){
    window.viewSalesReturn=async function(id){
      try{await loadCreditSummary()}catch(err){console.warn('Return credit summary:',err.message)}
      await baseView.apply(this,arguments);
      const h=(window._visibleSalesReturns||[]).find(x=>x.return_id===id);
      const body=document.getElementById('modalBody');
      if(!h||!body)return;

      const old=body.querySelector('[data-return-credit-panel]');
      if(old)old.remove();

      const appsResult=await db.rpc('get_visible_sales_credit_applications');
      const apps=appsResult.error?[]:(appsResult.data||[]).filter(x=>x.return_id===id);

      const panel=document.createElement('div');
      panel.dataset.returnCreditPanel='1';
      panel.className='rounded-xl border '+(h.financial_effect==='credit_ar'?'border-blue-200 bg-blue-50/50':'border-gray-200 bg-gray-50')+' p-4';
      let html='<div class="flex flex-col md:flex-row md:items-start md:justify-between gap-3"><div><div class="text-[9px] uppercase font-bold text-gray-400">Financial Treatment</div>';
      if(h.financial_effect==='credit_ar'){
        html+='<div class="font-bold text-blue-700 mt-1">Customer Credit '+money(h.credit_amount||0)+'</div>';
        html+='<div class="text-[10px] text-gray-500 mt-1">'+money(h.applied_amount||0)+' applied to AR';
        if(n(h.available_credit)>0)html+=' · '+money(h.available_credit)+' still available';
        html+='</div></div>';
        if(canManageCredit())html+='<button type="button" data-remove-credit class="px-3 py-2 border rounded-lg bg-white text-xs font-semibold">Remove Customer Credit</button>';
      }else{
        html+='<div class="font-bold text-gray-600 mt-1">No Customer Credit</div><div class="text-[10px] text-gray-500 mt-1">The CN records the physical return, but does not reduce AR until credit is approved.</div></div>';
        if(canManageCredit()&&h.status==='received')html+='<button type="button" data-apply-credit class="px-3 py-2 border border-blue-200 bg-blue-50 text-blue-700 rounded-lg text-xs font-semibold">Apply Customer Credit</button>';
      }
      html+='</div>';

      if(h.financial_effect==='credit_ar'){
        html+='<div class="mt-3 border-t pt-3"><div class="text-[9px] uppercase font-bold text-gray-400 mb-2">Credit Allocation</div>';
        if(apps.length){
          html+=apps.map(a=>'<div class="flex items-center justify-between gap-3 py-1.5 text-xs"><span>Applied to <b>'+esc(a.target_document_no||'Outstanding invoice')+'</b></span><b class="text-blue-700">'+money(a.amount)+'</b></div>').join('');
        }else{
          html+='<div class="text-xs text-gray-500">No collectible invoice is available yet. The credit remains on the customer account.</div>';
        }
        html+='</div>';
      }
      panel.innerHTML=html;

      const footer=[...body.querySelectorAll('.flex.justify-end')].pop();
      if(footer)footer.parentNode.insertBefore(panel,footer);
      else body.appendChild(panel);

      const info=[...body.querySelectorAll('.bg-blue-50')].find(x=>x.textContent.includes('records the return only')||x.textContent.includes('Customer payments and AR'));
      if(info){
        info.innerHTML=h.financial_effect==='credit_ar'
          ? 'This CN has approved <b>Customer Credit</b>. Credit reduces the target invoice AR but does not change the actual cash received.'
          : 'This CN records the physical return only. After it is <b>Received</b>, Manager/Admin can approve Customer Credit if the customer should receive a financial credit.';
      }

      if(h.financial_effect==='credit_ar'){
        [...body.querySelectorAll('button')].forEach(b=>{if(b.textContent.trim()==='Edit CN')b.style.display='none'});
      }
      const applyBtn=panel.querySelector('[data-apply-credit]');
      if(applyBtn)applyBtn.onclick=()=>setSalesReturnFinancialTreatment(id,'credit_ar');
      const removeBtn=panel.querySelector('[data-remove-credit]');
      if(removeBtn)removeBtn.onclick=()=>setSalesReturnFinancialTreatment(id,'none');
    };
  }

  const baseEdit=window.openEditSalesReturn;
  if(typeof baseEdit==='function'){
    window.openEditSalesReturn=async function(id){
      try{await loadCreditSummary()}catch(err){}
      const h=(window._visibleSalesReturns||[]).find(x=>x.return_id===id);
      if(h?.financial_effect==='credit_ar')return showToast('Remove the Customer Credit before editing this CN.','err');
      return baseEdit.apply(this,arguments);
    };
  }
})();