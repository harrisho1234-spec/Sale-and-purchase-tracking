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
  const api={build};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.LImperialBookedSales=api;
})(typeof window==='undefined'?null:window);
