'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=p=>fs.readFileSync(require('node:path').join(__dirname,'..',p),'utf8');

const helper=read('cn-ar-preview.js');
const creditUI=read('return-credit-workflow.js');
const caseUI=read('cn-case-workflow.js');
const tracking=read('tracking-redesign.js');
const page=read('index.html');
const context={window:{}};
vm.runInNewContext(helper,context,{filename:'cn-ar-preview.js'});
const calc=context.window.CnArPreview.calculate;

test('same CN-2026-027 numbers: $520 - $280 returned - $272 paid = $0 AR and $32 excess',()=>{
  const x=calc({invoiceTotal:520,paymentsReceived:272,netReturnValue:280,otherCreditApplied:0});
  assert.equal(x.currentAR,248);
  assert.equal(x.invoiceAfterReturn,240);
  assert.equal(x.appliedToSource,248);
  assert.equal(x.projectedAR,0);
  assert.equal(x.creditRemaining,32);
});

test('smaller returns still leave outstanding AR',()=>{
  assert.equal(calc({invoiceTotal:520,paymentsReceived:272,netReturnValue:100}).projectedAR,148);
  assert.equal(calc({invoiceTotal:520,paymentsReceived:272,netReturnValue:200}).projectedAR,48);
  assert.equal(calc({invoiceTotal:520,paymentsReceived:272,netReturnValue:280}).projectedAR,0);
});

test('cent-precision arithmetic, no negative AR, credit never applied twice',()=>{
  const x=calc({invoiceTotal:520.01,paymentsReceived:272.01,otherCreditApplied:48,netReturnValue:200.02});
  assert.equal(x.currentAR,200);
  assert.equal(x.appliedToSource,200);
  assert.equal(x.projectedAR,0);
  assert.equal(x.creditRemaining,0.02);
  const noAR=calc({invoiceTotal:50,paymentsReceived:75,netReturnValue:20});
  assert.equal(noAR.currentAR,0);
  assert.equal(noAR.projectedAR,0);
  assert.equal(noAR.creditRemaining,20);
});

test('money received is never overwritten by return approval',()=>{
  const x=calc({invoiceTotal:650,paymentsReceived:272,netReturnValue:280});
  assert.equal(x.paymentsReceived,272);
  assert.equal(x.invoiceAfterReturn,370);
  assert.equal(x.projectedAR,98);
});

test('refund/credit is not applied until user authorizes financial decision',()=>{
  assert.match(creditUI,/confirm\(msg\)/);
  assert.match(creditUI,/financialActionPending\.add\(id\)/);
  assert.match(creditUI,/db\.rpc\('set_sales_return_financial_treatment'/);
  assert.match(creditUI,/db\.from\('sales_order_summary'\)/);
  assert.match(creditUI,/get_visible_sales_credit_applications/);
  assert.match(creditUI,/Expected remaining AR/);
  assert.match(caseUI,/c\.approval_status==='approved'&&c\.stock_complete&&c\.financial_decision==='pending'&&canApprove\(\)/);
  assert.match(caseUI,/Approve Credit & Update AR/);
  assert.match(creditUI,/returns\.approve/);
});

test('approved and unapproved CNs are not mixed in source accounting',()=>{
  assert.match(tracking,/const projectedCredit=\(cnCount===1&&pending&&applied<=0&&Number\(returnValue\)>0\)/);
  assert.match(tracking,/If this return credit is approved \(estimate only\)/);
  assert.match(tracking,/Current AR \/ Balance Due/);
  assert.match(tracking,/Return value \(reference only\)/);
});

test('preview module loads before tracking and credit forms; JS assets refresh',()=>{
  const helperAt=page.indexOf('cn-ar-preview.js?v=20261113-approved-return-credit1');
  const trackingAt=page.indexOf('tracking-redesign.js?v=20261113-arrival-and-service-fees1');
  const creditAt=page.indexOf('return-credit-workflow.js?v=20261113-approved-return-credit1');
  const caseAt=page.indexOf('cn-case-workflow.js?v=20261113-approved-return-credit1');
  assert.ok(helperAt>0 && helperAt<trackingAt && trackingAt<creditAt && creditAt<caseAt);
});
