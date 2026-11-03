// Booked Sales are attributed to the ORIGINAL customer commitment date.
// This never changes the existing Actual Sales or Collection event streams.
// When an issued TK/RK invoice also exists as a separate order row, exclude
// that mirror from bookings; its source SR already holds the commitment.
(function(root){
  'use strict';
  const text=value=>String(value??'').trim();
  const code=value=>text(value).toUpperCase();
  const numeric=value=>{const n=Number(value||0);return Number.isFinite(n)?n:0;};
  const key=(customer,invoice)=>text(customer)+'::'+code(invoice);
  const isPreOrder=row=>text(row?.order_type).toLowerCase()==='pre_order'||
      code(row?.document_no).startsWith('SR');
  function build(bookedSource=[],invoiceEvents=[]){
    const issuedByDocument=new Map();
    for(const row of invoiceEvents||[]){
      if(text(row?.report_event)!=='issued_invoice'||!text(row?.document_no))continue;
      const k=key(row.customer_id,row.document_no);
      if(!issuedByDocument.has(k))issuedByDocument.set(k,new Set());
      issuedByDocument.get(k).add(text(row.order_id));
    }
    const result=[],seenOrders=new Set();
    for(const row of bookedSource||[]){
      const id=text(row.order_id);
      if(!id||seenOrders.has(id))continue;
      seenOrders.add(id);
      const sources=issuedByDocument.get(key(row.customer_id,row.document_no));
      // A conversion's source SR owns the historical commitment, while its
      // separately-created TK/RK order is an accounting/fulfillment document.
      const isConvertedCopy=!isPreOrder(row)&&sources&&sources.size>0&&!sources.has(id);
      if(isConvertedCopy)continue;
      const value=numeric(row.gross_sales);
      if(value<=0)continue;
      result.push({
        order_id:id,
        order_date:text(row.order_date).slice(0,10),
        customer_id:row.customer_id||null,
        document_no:text(row.document_no),
        sales_rep_id:row.sales_rep_id||null,
        sales_rep_name:text(row.sales_rep_name)||'Unassigned',
        business_code:code(row.business_code)||'OTHER',
        sales_category:text(row.sales_category)||'standard',
        booked_sales:Math.round((value+Number.EPSILON)*100)/100,
        // Always use the source SR's original date and business category,
        // even if its invoice is issued in a later month.
        booking_source:isPreOrder(row)?'SR':'invoice'
      });
    }
    return result;
  }
  function mergeEventRows(financialEvents=[],sourceOrders=[]){
    const bookings=build(sourceOrders,financialEvents);
    const financial=(financialEvents||[]).map(r=>({...r,confirmed_sales:0}));
    const booked=bookings.map(b=>({
      order_id:b.order_id,order_date:b.order_date,customer_id:b.customer_id,
      document_no:b.document_no,sales_rep_id:b.sales_rep_id,sales_rep_name:b.sales_rep_name,
      business_code:b.business_code,sales_category:b.sales_category,
      report_event:'booked_order',order_type:b.booking_source==='SR'?'pre_order':'stock_sale',
      gross_sales:0,return_value:0,net_sales:0,amount_received:0,balance_due:0,
      invoice_value:0,prepayment_value:0,pending_value:0,actual_sales:0,
      collection_value:0,prepayment_applied:0,confirmed_sales:b.booked_sales
    }));
    return financial.concat(booked);
  }
  const api={build,mergeEventRows};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LImperialBookedSales=api;
})(typeof window==='undefined'?null:window);
