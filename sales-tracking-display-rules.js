// Read-only display rules for physical goods, service fees and SR-issued invoices.
// Do not update inventory, payment allocations, fulfillment status or posted accounting.
(function(root){
  'use strict';
  const norm=v=>String(v||'').trim().toLowerCase().replace(/[\\s-]+/g,'_');
  const num=v=>{const n=Number(v);return Number.isFinite(n)?n:0;};
  const money=v=>Math.round((num(v)+Number.EPSILON)*100)/100;
  function isServiceLine(item){
    const kind=norm(item?.line_kind);
    if(kind==='service'||kind==='fee')return true;
    if(kind==='product')return false;
    if(['service','service_fee','fee','installation'].includes(norm(item?.source_type)))return true;
    // Legacy manually entered fees can predate the line_kind field.
    const code=norm(item?.product_code_snapshot);
    return ['delivery_installation','delivery_fee','installation_fee','service_fee','shipping_fee'].includes(code);
  }
  function canonicalStatus(v){
    const s=norm(v);
    if(s==='ready'||s==='completed')return 'arrived';
    if(s==='installed')return 'delivered';
    if(s==='pending'||s==='reserved')return 'ordered';
    if(s==='in_production')return 'production';
    if(s==='shipped'||s==='in_transit'||s==='transit')return 'shipping';
    return s;
  }
  function itemStatus(item){
    if(isServiceLine(item))return null;
    const tracking=Array.isArray(item?.item_tracking)?item.item_tracking[0]:item?.item_tracking;
    const candidates=[tracking?.status,item?.fulfillment_status].map(canonicalStatus).filter(Boolean);
    if(!candidates.length)return 'ordered';
    const rank={ordered:0,production:1,shipping:2,arrived:3,delivered:4};
    return candidates.reduce((best,s)=>{
      if(!(s in rank))return best||s;
      return !(best in rank)||rank[s]>=rank[best]?s:best;
    },'');
  }
  function hasIssuedTkRk(o){
    return !!(o?.sales_invoice_no||o?.invoice_issued_at||
      (Array.isArray(o?.linked_documents)&&o.linked_documents.some(d=>norm(d.status)==='issued'&&d.invoice_no)));
  }
  // Values only: do not infer how SR deposits were allocated between invoices.
  function issuedValueSplit(o){
    if(!hasIssuedTkRk(o))return null;
    const total=money(o?.order_total);
    const docs=Array.isArray(o?.linked_documents)?o.linked_documents:[];
    const seen=new Set();
    const issued=docs.reduce((sum,doc)=>{
      const key=String(doc?.invoice_no||'').trim().toUpperCase();
      if(!key||seen.has(key)||norm(doc?.status)!=='issued')return sum;
      seen.add(key);
      return sum+Math.max(0,num(doc.invoice_total));
    },0);
    if(issued<=0||total<0||issued>total+0.01)return null;
    return {issuedValue:money(issued),uninvoicedValue:money(Math.max(0,total-issued))};
  }
  const rules=Object.freeze({isServiceLine,canonicalStatus,itemStatus,hasIssuedTkRk,issuedValueSplit});
  root.SalesTrackingDisplayRules=rules;
  if(typeof module==='object'&&module.exports)module.exports=rules;
})(typeof window!=='undefined'?window:globalThis);
