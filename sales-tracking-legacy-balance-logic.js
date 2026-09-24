// Restore the financial tracking logic used by the previous L'Imperial sales template.
// Active AR = collectible non-pending-preorder balances.
// Pending = remaining SR/pre-order balance before a final TK/RK is issued.
(function(){
  const ui=window.trackingRedesign;
  if(!ui||typeof window.renderSalesTrackingBody!=='function')return;

  const baseRender=window.renderSalesTrackingBody;
  const baseExport=window.exportSalesTrackingCsv;

  function norm(v=''){return String(v||'').trim().toLowerCase().replace(/[\s-]+/g,'_')}
  function n(v){const x=Number(v||0);return Number.isFinite(x)?x:0}
  function repName(o){return o?.sales_rep_name_snapshot||o?.rep_name||''}
  function isCancelled(o){return norm(o?.status)==='cancelled'}
  function isSettled(o){return norm(o?.payment_status)==='paid'||n(o?.balance_due)<=0.001}
  function isPre(o){
    return ['pre_order','mixed'].includes(norm(o?.order_type))||norm(o?.sales_flow_type)==='pre_order'||String(o?.sr_no||'').toUpperCase().startsWith('SR');
  }
  // A pre-order becomes collectible AR only after the final TK/RK has been issued.
  function isPendingPre(o){return isPre(o)&&!o?.sales_invoice_no&&!o?.invoice_issued_at}
  function isOpen(o){return !isCancelled(o)&&!isSettled(o)&&n(o?.balance_due)>0.001}

  function withinDate(dateStr,filter){
    if(filter==='all'||!dateStr)return true;
    const d=new Date(String(dateStr).slice(0,10)+'T00:00:00');
    const now=new Date();
    const startMonth=new Date(now.getFullYear(),now.getMonth(),1);
    const startLast=new Date(now.getFullYear(),now.getMonth()-1,1);
    const endLast=new Date(now.getFullYear(),now.getMonth(),0,23,59,59);
    if(filter==='this_month')return d>=startMonth;
    if(filter==='last_month')return d>=startLast&&d<=endLast;
    if(filter==='30'){const x=new Date(now);x.setDate(x.getDate()-30);return d>=x}
    if(filter==='90'){const x=new Date(now);x.setDate(x.getDate()-90);return d>=x}
    if(filter==='year')return d.getFullYear()===now.getFullYear();
    return true;
  }

  function statusMatch(o){
    const s=ui.salesStatus;
    const items=o.items||[];
    if(s==='active')return isOpen(o);
    if(s==='uncleared')return isOpen(o)&&!isPendingPre(o);
    if(s==='preorder')return isOpen(o)&&isPendingPre(o);
    if(s==='not_taken')return !isCancelled(o)&&items.some(i=>norm(i.fulfillment_status)==='ready');
    if(s==='taken_unpaid')return isOpen(o)&&!isPendingPre(o)&&items.some(i=>['delivered','installed'].includes(norm(i.fulfillment_status)));
    if(s==='settled')return !isCancelled(o)&&isSettled(o);
    return true;
  }

  function currentFilteredOriginal(){
    const q=String(ui.salesSearch||'').toLowerCase().trim();
    let list=(ui.salesOrders||[]).filter(o=>{
      if(!withinDate(o.order_date,ui.salesDate))return false;
      if(ui.salesRep!=='all'&&repName(o)!==ui.salesRep)return false;
      if(ui.salesCustomer!=='all'&&o.customer_id!==ui.salesCustomer)return false;
      if(ui.salesClass!=='all'&&!(o.items||[]).some(i=>i.product_catalog?.class===ui.salesClass))return false;
      if(!statusMatch(o))return false;
      if(q){
        const hay=[o.order_no,o.invoice_no,o.sr_no,o.sales_invoice_no,o.customer_name,o.customer_code,repName(o),o.status,o.order_type,
          ...(o.items||[]).flatMap(i=>[i.product_code_snapshot,i.item_name_snapshot,i.product_catalog?.brand,i.product_catalog?.class])
        ].filter(Boolean).join(' ').toLowerCase();
        if(!hay.includes(q))return false;
      }
      return true;
    });
    list.sort((a,b)=>{
      if(ui.salesSort==='oldest')return String(a.order_date||'').localeCompare(String(b.order_date||''));
      if(ui.salesSort==='balance')return n(b.balance_due)-n(a.balance_due);
      if(ui.salesSort==='total')return n(b.order_total)-n(a.order_total);
      return String(b.order_date||'').localeCompare(String(a.order_date||''));
    });
    return list;
  }

  function transformedForBase(o){
    const x={...o};
    const s=ui.salesStatus;
    if(s==='active'&&isSettled(o))x.status='cancelled';
    if(s==='uncleared'&&isPendingPre(o))x.balance_due=0;
    if(s==='preorder'&&(!isPendingPre(o)||isSettled(o)))x.order_type='in_stock';
    if(s==='taken_unpaid'&&isPendingPre(o))x.balance_due=0;
    return x;
  }

  function stats(rows){
    const total=rows.reduce((a,o)=>a+n(o.order_total),0);
    const paid=rows.reduce((a,o)=>a+n(o.amount_paid),0);
    const activeBalance=rows.reduce((a,o)=>a+(!isPendingPre(o)?n(o.balance_due):0),0);
    const pendingBalance=rows.reduce((a,o)=>a+(isPendingPre(o)?n(o.balance_due):0),0);
    const activeUncleared=rows.filter(o=>n(o.balance_due)>0.001&&!isPendingPre(o)).length;
    const pre=rows.filter(isPendingPre);
    const prePaid=pre.reduce((a,o)=>a+n(o.amount_paid),0);
    const preQty=pre.reduce((a,o)=>a+(o.items||[]).reduce((x,i)=>x+n(i.qty),0),0);
    const readyItems=rows.flatMap(o=>(o.items||[]).filter(i=>norm(i.fulfillment_status)==='ready'));
    const readyQty=readyItems.reduce((a,i)=>a+n(i.qty),0);
    const readyValue=readyItems.reduce((a,i)=>a+n(i.line_total),0);
    return {total,paid,activeBalance,pendingBalance,activeUncleared,prePaid,preQty,readyQty,readyValue};
  }

  function setMoneyText(el,value,cls){
    if(!el)return;
    el.textContent=money(value);
    if(cls){el.classList.remove('text-red-500','text-red-600','text-green-600','text-blue-600','text-gray-400','text-gray-500');el.classList.add(cls)}
  }

  function patchSummary(rows){
    const root=document.getElementById('salesTrackingRoot');
    if(!root)return;
    const k=stats(rows);

    const summary=[...root.querySelectorAll('.lr-summary .lr-summary-item')];
    if(summary[0])summary[0].querySelector('.lr-summary-value').textContent=String(rows.length);
    if(summary[1])setMoneyText(summary[1].querySelector('.lr-summary-value'),k.total);
    if(summary[2]){
      const lab=summary[2].querySelector('.lr-summary-label');if(lab)lab.textContent='Deposit Paid';
      setMoneyText(summary[2].querySelector('.lr-summary-value'),k.paid,'text-green-600');
    }
    if(summary[3]){
      const lab=summary[3].querySelector('.lr-summary-label');if(lab)lab.textContent='Active Balance Due';
      const val=summary[3].querySelector('.lr-summary-value');
      if(val){
        val.innerHTML=`<span class="text-red-500">${money(k.activeBalance)}</span>${k.pendingBalance>0.001?` <span class="text-[10px] font-normal text-gray-400">(+ ${money(k.pendingBalance)} pending)</span>`:''}`;
      }
    }

    const kpis=[...root.querySelectorAll('.lr-kpi')];
    if(kpis[0]){
      const lab=kpis[0].querySelector('.lr-kpi-label');if(lab)lab.textContent='Active Balance Due (AR)';
      setMoneyText(kpis[0].querySelector('.lr-kpi-value'),k.activeBalance,'text-red-600');
      const sub=kpis[0].querySelector('.lr-kpi-sub');if(sub)sub.innerHTML=k.pendingBalance>0.001?`Pending pre-orders: <b class="text-gray-600">${money(k.pendingBalance)}</b>`:`Total visible sales: <b class="text-gray-600">${money(k.total)}</b>`;
    }
    if(kpis[1]){
      const lab=kpis[1].querySelector('.lr-kpi-label');if(lab)lab.textContent='Uncleared';
      const val=kpis[1].querySelector('.lr-kpi-value');if(val)val.textContent=String(k.activeUncleared);
      const sub=kpis[1].querySelector('.lr-kpi-sub');if(sub)sub.textContent='Current collectible invoices';
    }
    if(kpis[2]){
      const val=kpis[2].querySelector('.lr-kpi-value');if(val)val.textContent=k.readyQty.toLocaleString();
      const sub=kpis[2].querySelector('.lr-kpi-sub');if(sub)sub.innerHTML=`Ready value: <b class="text-gray-600">${money(k.readyValue)}</b>`;
    }
    if(kpis[3]){
      const lab=kpis[3].querySelector('.lr-kpi-label');if(lab)lab.textContent='Pre-Order Deposits';
      setMoneyText(kpis[3].querySelector('.lr-kpi-value'),k.prePaid,'text-blue-600');
      const sub=kpis[3].querySelector('.lr-kpi-sub');if(sub)sub.innerHTML=`${k.preQty.toLocaleString()} qty · <b>${money(k.pendingBalance)}</b> pending`;
    }
  }

  function patchCards(rows){
    for(const o of rows){
      const trigger=document.querySelector(`#salesTrackingRoot button[onclick="toggleSalesInvoice('${o.id}')"]`);
      const card=trigger?.closest('.lr-order-card');
      if(!card)continue;
      const moneyBlocks=[...card.querySelectorAll('.lr-order-main > div:last-child > div')];
      if(moneyBlocks[0]){
        const lab=moneyBlocks[0].querySelector('.lr-money-label');
        const val=moneyBlocks[0].querySelector('.lr-money');
        if(lab)lab.textContent=isPendingPre(o)?'Pre-Order Deposit':'Amount Received';
        if(val){val.textContent=money(o.amount_paid,o.currency);val.classList.remove('text-green-600','text-blue-600');val.classList.add(isPendingPre(o)?'text-blue-600':'text-green-600')}
      }
      if(moneyBlocks[1]){
        const lab=moneyBlocks[1].querySelector('.lr-money-label');
        const val=moneyBlocks[1].querySelector('.lr-money');
        if(lab)lab.textContent=isPendingPre(o)?'Est. Balance':(isSettled(o)?'Balance':'Active Balance');
        if(val){
          val.textContent=money(o.balance_due,o.currency);
          val.classList.remove('text-red-500','text-green-600','text-gray-400','text-gray-500');
          val.classList.add(isPendingPre(o)?'text-gray-400':(n(o.balance_due)>0.001?'text-red-500':'text-green-600'));
        }
        let creditNote=moneyBlocks[1].querySelector('[data-credit-applied]');
        if(n(o.credit_applied)>0.001){
          if(!creditNote){creditNote=document.createElement('div');creditNote.dataset.creditApplied='1';creditNote.className='text-[9px] text-blue-600 mt-0.5';moneyBlocks[1].appendChild(creditNote)}
          creditNote.textContent='− '+money(o.credit_applied,o.currency)+' customer credit';
        }else if(creditNote){creditNote.remove()}
      }
      if(isPendingPre(o)&&n(o.balance_due)>0.001){
        const badges=[...card.querySelectorAll('.lr-order-main .lr-badge')];
        const first=badges[0];
        if(first){first.textContent='Balance Due';first.className='lr-badge lr-badge-red'}
      }
    }
  }

  window.renderSalesTrackingBody=function(){
    const originals=ui.salesOrders||[];
    const originalItems=ui.salesItems||[];
    const rows=currentFilteredOriginal();
    ui.salesOrders=originals.map(transformedForBase);
    ui.salesItems=ui.salesOrders.flatMap(o=>(o.items||[]).map(i=>({...i,order:o})));
    let out;
    try{out=baseRender.apply(this,arguments)}finally{ui.salesOrders=originals;ui.salesItems=originalItems}
    patchSummary(rows);
    patchCards(rows);
    return out;
  };

  if(typeof baseExport==='function'){
    window.exportSalesTrackingCsv=function(){
      const originals=ui.salesOrders||[];
      const originalItems=ui.salesItems||[];
      ui.salesOrders=originals.map(transformedForBase);
      ui.salesItems=ui.salesOrders.flatMap(o=>(o.items||[]).map(i=>({...i,order:o})));
      try{return baseExport.apply(this,arguments)}finally{ui.salesOrders=originals;ui.salesItems=originalItems}
    };
  }
})();