// Read-only customer portfolio reconciliation for SR → issued TK/RK conversion.
// Original SR history remains visible; financial values are recognized once.
(function(root){
  'use strict';
  const n=value=>{const x=Number(value||0);return Number.isFinite(x)?x:0;};
  const cents=value=>Math.round((n(value)+Number.EPSILON)*100)/100;
  const norm=value=>String(value||'').trim().toUpperCase();
  const status=value=>String(value||'').trim().toLowerCase().replace(/[\s-]+/g,'_');
  const isSR=o=>['pre_order','mixed'].includes(status(o?.order_type))||
    status(o?.sales_flow_type)==='pre_order'||norm(o?.sr_no).startsWith('SR');
  const settled=o=>status(o?.payment_status)==='paid'||n(o?.balance_due)<=0.001;
  const isCancelled=o=>status(o?.status)==='cancelled';
  const invoiceNumber=o=>norm(o?.sales_invoice_no||o?.invoice_no||o?.order_no);
  const noInvoice=o=>!o?.sales_invoice_no&&!o?.invoice_issued_at;
  function remainingRatio(detail,source) {
    const items=Array.isArray(detail?.items)?detail.items:[];
    if(!items.length)return null;
    let base=0,remaining=0;
    for(const item of items) {
      const qty=n(item.qty),line=n(item.line_total);
      if(qty<=0||line<0)return null;
      base+=line;
      remaining+=line*Math.max(0,qty-n(item.issued_qty))/qty;
    }
    if(base<=0)return null;
    return Math.max(0,Math.min(1,remaining/base));
  }
  function reconcile(orders,links=[],details={}) {
    const rows=Array.isArray(orders)?orders:[];
    const visible=rows.filter(o=>!isCancelled(o));
    const invoiceNumbers=new Set(visible.filter(o=>!isSR(o)).map(invoiceNumber).filter(Boolean));
    const splitMap=new Map((Array.isArray(links)?links:[]).map(x=>[String(x.sr_id),x]));
    // An archived standalone TK is audit evidence only. The fully issued
    // original SR becomes the authoritative customer financial transaction.
    const consolidatedSrIds=new Set(visible.filter(x=>x.is_consolidated_duplicate&&x.consolidated_sr_id)
      .map(x=>String(x.consolidated_sr_id)));
    const result=rows.map(original=>{
      const o={...original},sr=isSR(o),split=splitMap.get(String(o.id));
      const issued=(split?.issued_numbers||[]).filter(x=>x.no);
      // Only suppress SR financials if the corresponding invoice is also visible.
      const posted=issued.length>0&&issued.every(x=>invoiceNumbers.has(norm(x.no)));
      const totalQty=n(split?.total_qty),issuedQty=n(split?.issued_qty);
      const archived=!!o.is_consolidated_duplicate;
      const canonicalIssued=sr&&consolidatedSrIds.has(String(o.id))&&issued.length>0
        &&totalQty>0&&issuedQty>=totalQty-0.0001&&n(split?.pending_qty)<=0.0001;
      const fullyIssued=sr&&!canonicalIssued&&posted&&totalQty>0&&issuedQty>=totalQty-0.0001&&n(split?.pending_qty)<=0.0001;
      const partial=sr&&!canonicalIssued&&posted&&issuedQty>0&&totalQty>issuedQty+0.0001;
      const detail=details?.[String(o.id)]||null;
      let ratio=1;
      if(fullyIssued||archived)ratio=0;
      else if(partial) {
        // Exact source-item value (rather than quantity fraction) preserves
        // differing unit prices and line discounts in partial conversions.
        const r=remainingRatio(detail,o);
        if(r!==null)ratio=r;
      }
      const total=cents(n(o.order_total)*ratio);
      const received=cents(n(o.amount_paid)*ratio);
      const balance=cents(n(o.balance_due)*ratio);
      const gross=cents(n(o.gross_balance_due??o.balance_due)*ratio);
      const pending=sr&&noInvoice(o)&&!fullyIssued&&!canonicalIssued&&balance>0.001;
      const financial={
        total,received,balance,gross,pending,historyOnly:fullyIssued||archived,
        canonicalIssued,archivedDuplicate:archived,
        partial:partial&&ratio<1,unreconciledPartial:partial&&ratio===1&&!detail,
        issuedInvoiceNumbers:(posted||canonicalIssued)?issued.map(x=>String(x.no)):[],
        originalTotal:n(o.order_total),originalPaid:n(o.amount_paid),originalBalance:n(o.balance_due),
        counted:!fullyIssued&&!archived&&!isCancelled(o)
      };
      o._srFinancial=financial;
      return o;
    });
    const active=result.filter(o=>!isCancelled(o));
    const summary=active.reduce((a,o)=>{
      const f=o._srFinancial;
      a.sales+=f.total;a.paid+=f.received;a.orders+=Number(f.counted);
      if(!f.pending)a.ar+=f.balance,a.grossAR+=f.gross;
      else a.pending+=f.balance,a.pendingGross+=f.gross;
      if(f.historyOnly)a.converted+=1;
      if(f.unreconciledPartial)a.unreconciled+=1;
      return a;
    },{sales:0,paid:0,ar:0,pending:0,grossAR:0,pendingGross:0,orders:0,converted:0,unreconciled:0});
    for(const k of ['sales','paid','ar','pending','grossAR','pendingGross'])summary[k]=cents(summary[k]);
    return {rows:result,summary};
  }
  async function load(db,orders,preloadedLinks) {
    let links=Array.isArray(preloadedLinks)?preloadedLinks:null;
    if(!links) {
      const response=await db.rpc('get_visible_sr_split_invoice_list');
      if(response.error)throw response.error;
      links=Array.isArray(response.data)?response.data:[];
    }
    const rowMap=new Map((orders||[]).map(o=>[String(o.id),o]));
    const visibleNums=new Set((orders||[]).filter(o=>!isCancelled(o)&&!isSR(o)).map(invoiceNumber));
    const partial=links.filter(x=>{
      const sr=rowMap.get(String(x.sr_id));
      const numbers=(x.issued_numbers||[]).filter(v=>v.no);
      return sr&&isSR(sr)&&numbers.length&&numbers.every(v=>visibleNums.has(norm(v.no)))&&
        n(x.issued_qty)>0&&n(x.total_qty)>n(x.issued_qty)+0.0001;
    });
    const details={};
    await Promise.all(partial.map(async x=>{
      try{
        const response=await db.rpc('get_sr_split_invoice_summary',{p_order_id:x.sr_id});
        if(response.error)throw response.error;
        if(response.data&&Array.isArray(response.data.items))details[String(x.sr_id)]=response.data;
        else console.warn('SR financial allocations unavailable for',x.sr_id);
      }catch(error){console.warn('SR financial allocations not loaded:',error?.message||error);}
    }));
    return reconcile(orders,links,details);
  }
  root.CustomerSrFinancials={reconcile,load,isSR,remainingRatio};
  if(typeof module==='object'&&module.exports)module.exports=root.CustomerSrFinancials;
})(typeof window!=='undefined'?window:globalThis);
