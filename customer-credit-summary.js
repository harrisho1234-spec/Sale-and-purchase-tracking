(function(){
  function norm(v){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
  function isPendingPre(o){
    const pre=['pre_order','mixed'].includes(norm(o?.order_type))
      || norm(o?.sales_flow_type)==='pre_order'
      || String(o?.sr_no||'').toUpperCase().startsWith('SR');
    return pre && !o?.sales_invoice_no && !o?.invoice_issued_at;
  }
  function isCancelled(o){return norm(o?.status)==='cancelled'}

  async function decorateCustomerCredit(customerId){
    const body=document.getElementById('modalBody');
    if(!body)return;

    const [or,cr,ar]=await Promise.all([
      db.from('sales_order_summary').select('*').eq('customer_id',customerId).order('order_date',{ascending:false}),
      db.rpc('get_visible_sales_return_credit_summary'),
      db.rpc('get_visible_sales_credit_applications')
    ]);
    if(or.error)throw or.error;
    if(cr.error)throw cr.error;
    if(ar.error)throw ar.error;

    const orders=(or.data||[]).filter(o=>!isCancelled(o));
    const credits=(cr.data||[]).filter(x=>x.customer_id===customerId&&x.status!=='cancelled');
    const apps=(ar.data||[]).filter(x=>x.customer_id===customerId);

    const collectible=orders.filter(o=>!isPendingPre(o)&&n(o.gross_balance_due)>0.001);
    const pending=orders.filter(o=>isPendingPre(o)&&n(o.gross_balance_due)>0.001);

    const grossAR=collectible.reduce((a,o)=>a+n(o.gross_balance_due),0);
    const netDue=collectible.reduce((a,o)=>a+n(o.balance_due),0);
    const pendingDue=pending.reduce((a,o)=>a+n(o.gross_balance_due),0);
    const approvedCredit=credits.filter(x=>x.financial_effect==='credit_ar').reduce((a,x)=>a+n(x.credit_amount),0);
    const appliedCredit=credits.filter(x=>x.financial_effect==='credit_ar').reduce((a,x)=>a+n(x.applied_amount),0);
    const availableCredit=credits.filter(x=>x.financial_effect==='credit_ar').reduce((a,x)=>a+n(x.available_credit),0);

    const header=[...body.querySelectorAll('.rounded-2xl.border')][0];
    const summaryGrid=header?[...header.querySelectorAll('.grid')].find(g=>[...g.children].some(x=>String(x.textContent||'').includes('Active AR'))):null;
    if(summaryGrid){
      summaryGrid.classList.remove('xl:grid-cols-7');
      summaryGrid.classList.add('xl:grid-cols-5');

      const cards=[...summaryGrid.children];
      const byLabel=label=>cards.find(x=>{
        const first=x.firstElementChild;
        return first&&String(first.textContent||'').trim().toLowerCase()===label.toLowerCase();
      });
      const arCard=byLabel('Active AR / Net Amount Due')||byLabel('Active AR');
      if(arCard){
        const value=arCard.children[1];
        if(value){
          value.textContent=money(grossAR);
          value.classList.toggle('text-red-500',grossAR>0);
          value.classList.toggle('text-green-600',grossAR<=0);
        }
        let sub=arCard.querySelector('[data-credit-sub]');
        if(!sub){
          sub=document.createElement('div');
          sub.dataset.creditSub='1';
          sub.className='text-[9px] text-gray-400 mt-0.5';
          arCard.appendChild(sub);
        }
        const lab=arCard.firstElementChild;if(lab)lab.textContent='Balance Before Credit';
        sub.textContent='Invoice total less cash received';
      }

      const pendingCard=byLabel('Pending Pre-Order');
      if(pendingCard&&pendingCard.children[1])pendingCard.children[1].textContent=money(pendingDue);

      [...summaryGrid.querySelectorAll('[data-customer-credit-card]')].forEach(x=>x.remove());

      const creditCard=document.createElement('div');
      creditCard.dataset.customerCreditCard='1';
      creditCard.innerHTML='<div class="text-[9px] uppercase font-bold text-gray-400">Customer Credit Applied</div>'
        +'<div class="text-lg font-bold text-blue-600 mt-1">−'+money(appliedCredit)+'</div>'
        +'<div class="text-[9px] text-gray-400 mt-0.5">'+money(approvedCredit)+' approved'+(availableCredit>0?' · '+money(availableCredit)+' still available':'')+'</div>';

      const netCard=document.createElement('div');
      netCard.dataset.customerCreditCard='1';
      netCard.innerHTML='<div class="text-[9px] uppercase font-bold text-gray-400">Active AR / Net Amount Due</div>'
        +'<div class="text-lg font-bold '+(netDue>0?'text-red-500':'text-green-600')+' mt-1">'+money(netDue)+'</div>'
        +'<div class="text-[9px] text-gray-400 mt-0.5">Balance before credit − customer credit applied</div>';

      if(arCard){
        arCard.insertAdjacentElement('afterend',creditCard);
        creditCard.insertAdjacentElement('afterend',netCard);
      }else{
        summaryGrid.appendChild(creditCard);
        summaryGrid.appendChild(netCard);
      }

      const note=[...header.querySelectorAll('div')].find(x=>String(x.textContent||'').includes('Returns reduce')&&String(x.textContent||'').includes('Received remains'));
      if(note){
        note.innerHTML='<b>Active AR = Invoice Total − Cash Received − Approved Customer Credit Applied.</b> Received is cash only. Customer Credit is shown separately and reduces what the customer still owes.';
      }
    }

    const appByDoc=new Map();
    for(const a of apps){
      const key=a.target_document_no||'';
      if(!appByDoc.has(key))appByDoc.set(key,[]);
      appByDoc.get(key).push(a);
    }
    for(const [doc,list] of appByDoc.entries()){
      if(!doc)continue;
      const title=[...body.querySelectorAll('b')].find(x=>String(x.textContent||'').trim()===doc);
      const card=title?.closest('.rounded-xl.border');
      if(!card)continue;
      if(card.querySelector('[data-order-credit-note]'))continue;
      const amount=list.reduce((a,x)=>a+n(x.amount),0);
      const note=document.createElement('div');
      note.dataset.orderCreditNote='1';
      note.className='text-[10px] text-blue-700 mt-2';
      note.innerHTML='Customer credit applied: <b>−'+money(amount)+'</b> from '+list.map(x=>esc(x.cn_no||'CN')).join(', ');
      const left=card.querySelector('.min-w-0')||card.firstElementChild;
      if(left)left.appendChild(note);
    }

    const creditMap=new Map(credits.map(x=>[x.return_id,x]));
    const visibleReturns=window._visibleSalesReturns||[];
    visibleReturns.forEach(r=>{
      const cn=[...body.querySelectorAll('b')].find(x=>String(x.textContent||'').trim()===String(r.cn_no||''));
      const card=cn?.closest('.rounded-xl.border');
      if(!card)return;
      const cs=creditMap.get(r.return_id);
      const old=[...card.querySelectorAll('div')].find(x=>{
        const t=String(x.textContent||'');
        return t.includes('Return value counts as customer credit')||t.includes('No AR credit recorded');
      });
      if(old){
        if(cs?.financial_effect==='credit_ar'){
          old.className='text-[10px] text-blue-700 mt-2';
          old.innerHTML='Customer credit approved: <b>'+money(cs.credit_amount||0)+'</b> · '+money(cs.applied_amount||0)+' applied'+(n(cs.available_credit)>0?' · '+money(cs.available_credit)+' available':'');
        }else{
          old.className='text-[10px] text-gray-400 mt-2';
          old.textContent='No customer credit approved for this CN.';
        }
      }
    });
  }

  const base=window.openCustomerOrders;
  if(typeof base==='function'){
    window.openCustomerOrders=async function(customerId){
      await base.apply(this,arguments);
      try{await decorateCustomerCredit(customerId)}
      catch(err){console.warn('Customer credit summary:',err.message)}
    };
  }
})();