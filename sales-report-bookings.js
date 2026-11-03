// Sales Report recognition: SR is a commitment, not an issued sale.
// Actual/Issued Sales are recognized when TK/RK invoices are issued;
// receipts from SR deposits still appear in Collection on payment dates.
// This only transforms report presentation; it never writes transactions.
(function(root){
  'use strict';
  const num=v=>{const n=Number(v||0);return Number.isFinite(n)?n:0;};
  const round=v=>Math.round((num(v)+Number.EPSILON)*100)/100;
  const normalize=v=>String(v??'').trim().toUpperCase();
  const invoiceKey=r=>String(r?.customer_id||'')+'::'+normalize(r?.document_no);
  const isUnissuedSR=r=>
    !num(r?.invoice_value)&&(
      String(r?.order_type||'').toLowerCase()==='pre_order'||
      normalize(r?.document_no).startsWith('SR')||
      r?.report_event==='unissued_sr'
    );
  function normalizeReportEvents(source=[]){
    const rows=Array.isArray(source)?source:[];
    // Explicit issued-invoice events are the authority for converted SRs.
    // A second TK/RK order with the same invoice number is a mirror, not a
    // second sale. Its carried-forward SR deposit must not be collected twice.
    const issued=new Map();
    rows.forEach(r=>{
      if(r.report_event!=='issued_invoice'||num(r.invoice_value)<=0)return;
      const key=invoiceKey(r);
      if(!issued.has(key))issued.set(key,{sources:new Set(),applied:0});
      const x=issued.get(key);
      x.sources.add(String(r.order_id||''));
      x.applied+=Math.max(0,num(r.prepayment_applied));
    });
    const consumedCarryover=new Map();
    return rows.flatMap(r=>{
      const amount=Math.max(0,num(r.invoice_value));
      const isOrder=r.report_event==='order'||!r.report_event;
      const group=isOrder?issued.get(invoiceKey(r)):null;
      // Consolidated audit-only TKs have zero invoice/cash in the effective
      // summary view, but should not add blank entries to report counts.
      const mirrored=!!group&&!group.sources.has(String(r.order_id||''))
        &&(amount>0||(num(r.collection_value)===0&&num(r.prepayment_value)===0));
      if(mirrored){
        const key=invoiceKey(r);
        const available=Math.max(0,group.applied-(consumedCarryover.get(key)||0));
        const used=Math.min(available,Math.max(0,num(r.collection_value)));
        consumedCarryover.set(key,(consumedCarryover.get(key)||0)+used);
        const extraCash=round(Math.max(0,num(r.collection_value)-used));
        // Keep a genuinely additional payment on the TK if recorded, but
        // never add an invoice or a transferred deposit a second time.
        if(extraCash<=0.001)return [];
        return [{...r,report_event:'invoice_additional_payment',invoice_value:0,
          actual_sales:0,confirmed_sales:0,collection_value:extraCash,
          prepayment_value:0,prepayment_applied:0,pending_value:0,
          _convertedMirror:true}];
      }
      if(r.report_event==='issued_invoice'){
        return [{...r,actual_sales:round(amount),confirmed_sales:round(amount)}];
      }
      if(r.report_event==='return'){
        // An accepted CN/return reduces the net issued sales in its own period.
        const deduction=Math.max(0,num(r.return_value));
        return [{...r,actual_sales:round(-deduction),confirmed_sales:0}];
      }
      if(isOrder&&amount>0&&!isUnissuedSR(r)){
        const net=round(Math.max(0,amount-num(r.return_value)));
        return [{...r,actual_sales:net,confirmed_sales:round(amount)}];
      }
      // SR creation, SR deposits and still-unissued balances do not count as
      // sales. Their Collection/pending columns remain available for reports.
      return [{...r,actual_sales:0,confirmed_sales:0}];
    });
  }
  function normalizeItemRows(items=[],events=[]){
    const source=Array.isArray(events)?events:[];
    const invoices=new Set(source.filter(r=>r.report_event==='issued_invoice'&&num(r.invoice_value)>0)
      .map(invoiceKey));
    const invoiceSources=new Map();
    source.filter(r=>r.report_event==='issued_invoice'&&num(r.invoice_value)>0).forEach(r=>{
      const key=invoiceKey(r);
      if(!invoiceSources.has(key))invoiceSources.set(key,new Set());
      invoiceSources.get(key).add(String(r.order_id||''));
    });
    const normalized=normalizeReportEvents(source);
    const extraCashById=new Map(normalized.filter(r=>r._convertedMirror)
      .map(r=>[String(r.order_id),num(r.collection_value)]));
    const mirrorTotals=new Map(source.filter(r=>{
      const key=invoiceKey(r);
      return (r.report_event==='order'||!r.report_event)&&num(r.invoice_value)>0&&
        invoices.has(key)&&!invoiceSources.get(key)?.has(String(r.order_id||''));
    }).map(r=>[String(r.order_id),num(r.collection_value)]));
    return (items||[]).flatMap(row=>{
      const orderId=String(row.sales_order_id||'');
      if(mirrorTotals.has(orderId)){
        const total=mirrorTotals.get(orderId);
        const extra=extraCashById.get(orderId)||0;
        if(extra<=0.001)return [];
        return [{...row,actual_sales:0,confirmed_sales:0,invoice_value:0,prepayment_value:0,
          pending_value:0,qty:0,collection_value:round(num(row.collection_value)*(extra/Math.max(total,0.01)))}];
      }
      const invoice=Math.max(0,num(row.invoice_value));
      const refund=Math.max(0,num(row.return_value));
      const issued=round(invoice-refund);
      return [{...row,actual_sales:issued,confirmed_sales:round(invoice),
        qty:invoice>0?row.qty:0}];
    });
  }
  const api={normalizeReportEvents,normalizeItemRows};
  if(root)root.LImperialInvoiceSales=api;
  if(typeof module==='object'&&module.exports)module.exports=api;
})(typeof window==='undefined'?null:window);
