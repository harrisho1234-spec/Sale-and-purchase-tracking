/* Preview only: settled AR changes are made exclusively by the approved CN
 * financial-treatment database RPC, never by calculations in the browser. */
(function(root){
  'use strict';
  function cents(value){
    const n=Number(value);
    return Number.isFinite(n)?Math.max(0,Math.round(n*100)):0;
  }
  function dollars(value){return value/100;}
  function calculate(input){
    const invoice=cents(input?.invoiceTotal);
    const paid=cents(input?.paymentsReceived);
    const alreadyApplied=cents(input?.otherCreditApplied);
    const returned=cents(input?.netReturnValue);
    // Existing approved allocations are already reflected in actual AR.
    // Read-only estimate of applying THIS proposed credit exactly once.
    const currentAR=Math.max(0,invoice-paid-alreadyApplied);
    const appliedToSource=Math.min(returned,currentAR);
    const projectedAR=Math.max(0,currentAR-appliedToSource);
    const creditRemaining=Math.max(0,returned-appliedToSource);
    // If other CN credits already exist this is a visual estimate, not a
    // mutation of the original invoice or an accounting journal.
    const invoiceAfterReturn=Math.max(0,invoice-returned);
    return Object.freeze({
      invoiceTotal:dollars(invoice),
      paymentsReceived:dollars(paid),
      otherCreditApplied:dollars(alreadyApplied),
      netReturnValue:dollars(returned),
      currentAR:dollars(currentAR),
      invoiceAfterReturn:dollars(invoiceAfterReturn),
      appliedToSource:dollars(appliedToSource),
      projectedAR:dollars(projectedAR),
      creditRemaining:dollars(creditRemaining)
    });
  }
  root.CnArPreview=Object.freeze({calculate});
})(typeof window!=='undefined'?window:globalThis);
