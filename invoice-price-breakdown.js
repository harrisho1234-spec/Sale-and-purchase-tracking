// Display-only invoice price calculations. Invoice, item and payment records
// are never changed. Item discount_amount is the discount for the whole line.
(function(root){
  'use strict';
  function hasNumber(v){return v!==null&&v!==undefined&&String(v).trim()!==''&&Number.isFinite(Number(v));}
  function n(v){return hasNumber(v)?Number(v):0;}
  function moneyRound(v){return Math.round((Number(v)||0)*100)/100;}
  function line(item){
    const qty=n(item?.qty);
    const rawPrice=item?.unit_price??item?.price;
    const rawNet=item?.line_total??item?.total;
    const rawDiscount=item?.discount_amount??item?.item_discount??item?.line_discount;
    const hasUnit=hasNumber(rawPrice);
    const hasNet=hasNumber(rawNet)||hasUnit;
    const fullUnit=hasUnit?n(rawPrice):null;
    const fullTotal=hasUnit?moneyRound(qty*n(rawPrice)):null;
    const storedNet=hasNumber(rawNet)?n(rawNet):null;
    // Infer a line discount only if the original full price AND final
    // line price exist. Never infer it from the overall order discount.
    const discount=hasNumber(rawDiscount)?moneyRound(n(rawDiscount)):
      (fullTotal!==null&&storedNet!==null?moneyRound(Math.max(0,fullTotal-storedNet)):null);
    const finalTotal=storedNet!==null?moneyRound(storedNet):
      (fullTotal!==null?moneyRound(Math.max(0,fullTotal-n(discount))):null);
    const finalUnit=finalTotal!==null&&qty>0?finalTotal/qty:null;
    const discountPercent=fullTotal>0&&discount!==null?100*discount/fullTotal:null;
    return {qty,fullUnit,fullTotal,discount,discountPercent,finalUnit,finalTotal,
      hasUnit,hasNet,discountKnown:discount!==null};
  }
  function invoice(items,orderDiscount,recordedTotal){
    const lines=(Array.isArray(items)?items:[]).map(line);
    const complete=lines.length>0&&lines.every(l=>l.fullTotal!==null&&l.finalTotal!==null);
    const original=complete?moneyRound(lines.reduce((sum,l)=>sum+l.fullTotal,0)):null;
    const itemsDiscount=complete?moneyRound(lines.reduce((sum,l)=>sum+n(l.discount),0)):null;
    const afterItems=complete?moneyRound(lines.reduce((sum,l)=>sum+l.finalTotal,0)):null;
    const orderDiscountValue=hasNumber(orderDiscount)?moneyRound(n(orderDiscount)):0;
    const finalTotal=hasNumber(recordedTotal)?moneyRound(n(recordedTotal)):
      (afterItems!==null?moneyRound(Math.max(0,afterItems-orderDiscountValue)):null);
    const expected=afterItems===null?null:moneyRound(Math.max(0,afterItems-orderDiscountValue));
    const adjustment=expected!==null&&finalTotal!==null?moneyRound(finalTotal-expected):null;
    return {lines,complete,original,itemsDiscount,afterItems,
      orderDiscount:orderDiscountValue,finalTotal,adjustment};
  }
  function percent(value){
    if(value===null||!Number.isFinite(Number(value)))return '';
    return String(Math.round(Number(value)*100)/100).replace(/\.0+$/,'')+'%';
  }
  const api={line,invoice,percent};
  if(typeof module==='object'&&module.exports)module.exports=api;
  if(root)root.InvoicePriceBreakdown=api;
})(typeof window==='undefined'?null:window);
