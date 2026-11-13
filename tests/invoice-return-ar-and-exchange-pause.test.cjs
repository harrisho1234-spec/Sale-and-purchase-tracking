const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const read=p=>fs.readFileSync(path.join(__dirname,'..',p),'utf8');
const tracking=read('tracking-redesign.js'),returns=read('sales-returns.js');
const sql=read('database/20261104_lock_new_exchange_and_show_return_ar.sql');
const index=read('index.html');

test('Exchange is absent in creation options and item handling options',()=>{
 const beginning=returns.slice(returns.indexOf('window.openNewSalesReturn'),returns.indexOf('async function saveSalesReturn('));
 assert.doesNotMatch(beginning,/<option value="exchange"/);
 assert.match(beginning,/Return\/CN and a separate new sale/);
 assert.match(beginning,/Exchange is temporarily unavailable/);
});
test('Exchange is absent from CN editing choices and locked for historical records',()=>{
 const editing=returns.slice(returns.indexOf('window.openEditSalesReturn='),returns.indexOf('window.deleteSalesReturn='));
 assert.doesNotMatch(editing,/<option value="exchange"/);
 assert.match(editing,/h.action==='exchange'/);
 assert.match(editing,/items.some\(x=>x.disposition==='exchange'\)/);
 assert.match(editing,/Existing Exchange CNs are locked for editing/);
 assert.match(editing,/Exchange is temporarily disabled/);
});
test('New CN save rejects forged Exchange action or item handling, including old cached UI',()=>{
 const saving=returns.slice(returns.indexOf('async function saveSalesReturn('),returns.indexOf('window.viewSalesReturn='));
 assert.match(saving,/items.some\(x=>x.disposition==='exchange'\)/);
 assert.match(saving,/if\(action==='exchange'\)/);
});
test('Postgres triggers reject NEW Exchange header and line, not unrelated/historical status updates',()=>{
 assert.match(sql,/create trigger temporarily_block_exchange_cn_action[\s\S]+before insert or update of action on public\.sales_returns/);
 assert.match(sql,/create trigger temporarily_block_exchange_cn_item[\s\S]+before insert or update of disposition on public\.sales_return_items/);
 assert.match(sql,/new\.action='exchange' and \(tg_op='INSERT' or \(tg_op='UPDATE' and old\.action is distinct from new\.action\)\)/);
 assert.match(sql,/new\.disposition='exchange' and \(tg_op='INSERT' or \(tg_op='UPDATE' and old\.disposition is distinct from new\.disposition\)\)/);
 assert.doesNotMatch(sql,/\bdelete from public\.sales_returns\b/i);
});
function render(values){
 const start=tracking.indexOf('  function salesInvoiceReturnBalanceSummary(o){'),end=tracking.indexOf('  function invoiceCard(o) {',start);
 assert.ok(start>0&&end>start);
 const previewSandbox={window:{}};
 vm.runInNewContext(read('cn-ar-preview.js'),previewSandbox,{timeout:2000});
 const sandbox={
  money:(n)=>'
 vm.runInNewContext(tracking.slice(start,end)+'\nthis.render=salesInvoiceReturnBalanceSummary;',sandbox,{timeout:2000});
 return sandbox.render(values);
}
test('invoice $1,000 / $300 paid / $200 applied credit shows current AR $500 and an informational return',()=>{
 const html=render({
  currency:'USD',order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:200,balance_due:500,return_financial:{
   recorded_return_value:200,received_return_value:200,cn_count:1,cn_numbers:'CN-DEMO'
  },
  return_cn_cases:[{cn_no:'CN-DEMO',approval_status:'approved',financial_decision:'credit_ar'}]
 });
 for(const label of [
  'Return / CN &amp; AR Breakdown','Original invoice amount','$1000.00',
  'Actual payments / deposits','−$300.00','Return value (reference only)',
  '$200.00','(not deducted)','Financial decision','Customer credit approved',
  'Approved credit applied to this invoice','−$200.00','Current AR / Balance Due','$500.00','CN-DEMO'
 ])assert.ok(html.includes(label),label);
 assert.match(html,/Return value \(reference only\)<\/span><b[^>]*>\$200.00/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$500.00<\/b>/);
});
test('real-case style approved CN pending financial decision keeps AR $248, despite $280 return',()=>{
 const html=render({
  order_total:520,amount_paid:272,gross_balance_due:248,
  credit_applied:0,balance_due:248,return_financial:{
   recorded_return_value:280,cn_count:1,cn_numbers:'CN-2026-027'
  },
  return_cn_cases:[{cn_no:'CN-2026-027',approval_status:'approved',financial_decision:'pending'}]
 });
 assert.match(html,/Return value \(reference only\)<\/span><b[^>]*>\$280.00/);
 assert.match(html,/Financial decision<\/span><b[^>]*>Pending<\/b>/);
 assert.match(html,/Approved credit applied to this invoice<\/span><b[^>]*>\$0.00<\/b>/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$248.00<\/b>/);
 assert.match(html,/The CN has not completed all approval\/financial steps/);
 assert.match(html,/If this return credit is approved \(estimate only\)/);
 assert.match(html,/Invoice after return \$240.00/);
 assert.match(html,/Expected outstanding AR \$0.00/);
 assert.match(html,/Potential excess customer credit \$32.00/);
 assert.doesNotMatch(html,/Return value \(reference only\)<\/span><b[^>]*>−\$280.00/);
});
test('CN manager decides no credit: display no credit but keep actual AR unchanged',()=>{
 const html=render({
  order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:0,balance_due:700,return_financial:{
   recorded_return_value:200,cn_count:1,cn_numbers:'CN-DEMO'
  },
  return_cn_cases:[{cn_no:'CN-DEMO',approval_status:'approved',financial_decision:'no_credit'}]
 });
 assert.match(html,/Financial decision<\/span><b[^>]*>No customer credit<\/b>/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$700.00<\/b>/);
});
test('credit from another CN may reduce this invoice without a recorded CN for this invoice',()=>{
 const html=render({
  order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:50,balance_due:650,return_financial:{
   recorded_return_value:0,cn_count:0,cn_numbers:''
  }
 });
 assert.match(html,/Approved credit applied to this invoice<\/span><b[^>]*>−\$50.00<\/b>/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$650.00<\/b>/);
 assert.match(html,/Credit from a CN may be used on another outstanding invoice/);
});
test('missing read-only return data is shown as unavailable rather than a zero return',()=>{
 const html=render({
  order_total:1000,amount_paid:300,credit_applied:0,balance_due:700,
  return_financial:null
 });
 assert.match(html,/Return value \(reference only\)<\/span><b[^>]*>Unavailable/);
 assert.match(html,/Financial decision<\/span><b[^>]*>Status unavailable/);
});
test('CN status lookup access failures never falsely imply a financial decision',()=>{
 const html=render({
  order_total:520,amount_paid:272,balance_due:248,gross_balance_due:248,credit_applied:0,
  return_financial:{recorded_return_value:280,cn_count:1,cn_numbers:'CN-2026-027'},
  return_cn_cases:[]
 });
 assert.match(html,/Financial decision<\/span><b[^>]*>Status unavailable/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$248.00<\/b>/);
});
test('new report RPC respects Sales permissions and calculates net returned value after discounts',()=>{
 assert.match(sql,/public\.get_sales_tracking_return_financial_breakdown\(\)/);
 assert.match(sql,/public\.sales_order_item_net_return_value\(ri.sales_order_item_id,ri.qty\)/);
 assert.match(sql,/public\.can_view_sales_order\(i.sales_order_id\)/);
 assert.match(sql,/grant execute on function public\.get_sales_tracking_return_financial_breakdown\(\) to authenticated/);
 assert.match(sql,/not exists \([\s\S]+cn_case_workflows[\s\S]+approval_status='rejected'/);
});
test('frontend uses read-only return RPC and separately displays current approved credit and AR',()=>{
 assert.match(tracking,/db\.rpc\('get_sales_tracking_return_financial_breakdown'\)/);
 assert.match(tracking,/return_financial:finance,/);
 assert.match(tracking,/db\.rpc\('get_visible_cn_case_workflows'\)/);
 assert.match(tracking,/Number\(o\.credit_applied\|\|0\)/);
 assert.match(tracking,/Number\(o\.balance_due\|\|0\)/);
 assert.match(tracking,/salesInvoiceReturnBalanceSummary\(o\)/);
 assert.match(index,/sales-returns\.js\?v=20261104-exchange-pause-and-ar1/);
 assert.match(index,/tracking-redesign\.js\?v=20261113-approved-return-credit1/);
});
+Number(n||0).toFixed(2),
  esc:s=>String(s??''),Number,Math,window:previewSandbox.window
 };
 vm.runInNewContext(tracking.slice(start,end)+'\nthis.render=salesInvoiceReturnBalanceSummary;',sandbox,{timeout:2000});
 return sandbox.render(values);
}
test('invoice $1,000 / $300 paid / $200 applied credit shows current AR $500 and an informational return',()=>{
 const html=render({
  currency:'USD',order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:200,balance_due:500,return_financial:{
   recorded_return_value:200,received_return_value:200,cn_count:1,cn_numbers:'CN-DEMO'
  },
  return_cn_cases:[{cn_no:'CN-DEMO',approval_status:'approved',financial_decision:'credit_ar'}]
 });
 for(const label of [
  'Return / CN &amp; AR Breakdown','Original invoice amount','$1000.00',
  'Actual payments / deposits','−$300.00','Return value (reference only)',
  '$200.00','(not deducted)','Financial decision','Customer credit approved',
  'Approved credit applied to this invoice','−$200.00','Current AR / Balance Due','$500.00','CN-DEMO'
 ])assert.ok(html.includes(label),label);
 assert.match(html,/Return value \(reference only\)<\/span><b[^>]*>\$200.00/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$500.00<\/b>/);
});
test('real-case style approved CN pending financial decision keeps AR $248, despite $280 return',()=>{
 const html=render({
  order_total:520,amount_paid:272,gross_balance_due:248,
  credit_applied:0,balance_due:248,return_financial:{
   recorded_return_value:280,cn_count:1,cn_numbers:'CN-2026-027'
  },
  return_cn_cases:[{cn_no:'CN-2026-027',approval_status:'approved',financial_decision:'pending'}]
 });
 assert.match(html,/Return value \(reference only\)<\/span><b[^>]*>\$280.00/);
 assert.match(html,/Financial decision<\/span><b[^>]*>Pending<\/b>/);
 assert.match(html,/Approved credit applied to this invoice<\/span><b[^>]*>\$0.00<\/b>/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$248.00<\/b>/);
 assert.match(html,/The CN has not completed all approval\/financial steps/);
 assert.doesNotMatch(html,/Return value \(reference only\)<\/span><b[^>]*>−\$280.00/);
});
test('CN manager decides no credit: display no credit but keep actual AR unchanged',()=>{
 const html=render({
  order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:0,balance_due:700,return_financial:{
   recorded_return_value:200,cn_count:1,cn_numbers:'CN-DEMO'
  },
  return_cn_cases:[{cn_no:'CN-DEMO',approval_status:'approved',financial_decision:'no_credit'}]
 });
 assert.match(html,/Financial decision<\/span><b[^>]*>No customer credit<\/b>/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$700.00<\/b>/);
});
test('credit from another CN may reduce this invoice without a recorded CN for this invoice',()=>{
 const html=render({
  order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:50,balance_due:650,return_financial:{
   recorded_return_value:0,cn_count:0,cn_numbers:''
  }
 });
 assert.match(html,/Approved credit applied to this invoice<\/span><b[^>]*>−\$50.00<\/b>/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$650.00<\/b>/);
 assert.match(html,/Credit from a CN may be used on another outstanding invoice/);
});
test('missing read-only return data is shown as unavailable rather than a zero return',()=>{
 const html=render({
  order_total:1000,amount_paid:300,credit_applied:0,balance_due:700,
  return_financial:null
 });
 assert.match(html,/Return value \(reference only\)<\/span><b[^>]*>Unavailable/);
 assert.match(html,/Financial decision<\/span><b[^>]*>Status unavailable/);
});
test('CN status lookup access failures never falsely imply a financial decision',()=>{
 const html=render({
  order_total:520,amount_paid:272,balance_due:248,gross_balance_due:248,credit_applied:0,
  return_financial:{recorded_return_value:280,cn_count:1,cn_numbers:'CN-2026-027'},
  return_cn_cases:[]
 });
 assert.match(html,/Financial decision<\/span><b[^>]*>Status unavailable/);
 assert.match(html,/Current AR \/ Balance Due<\/span><b[^>]*>\$248.00<\/b>/);
});
test('new report RPC respects Sales permissions and calculates net returned value after discounts',()=>{
 assert.match(sql,/public\.get_sales_tracking_return_financial_breakdown\(\)/);
 assert.match(sql,/public\.sales_order_item_net_return_value\(ri.sales_order_item_id,ri.qty\)/);
 assert.match(sql,/public\.can_view_sales_order\(i.sales_order_id\)/);
 assert.match(sql,/grant execute on function public\.get_sales_tracking_return_financial_breakdown\(\) to authenticated/);
 assert.match(sql,/not exists \([\s\S]+cn_case_workflows[\s\S]+approval_status='rejected'/);
});
test('frontend uses read-only return RPC and separately displays current approved credit and AR',()=>{
 assert.match(tracking,/db\.rpc\('get_sales_tracking_return_financial_breakdown'\)/);
 assert.match(tracking,/return_financial:finance,/);
 assert.match(tracking,/db\.rpc\('get_visible_cn_case_workflows'\)/);
 assert.match(tracking,/Number\(o\.credit_applied\|\|0\)/);
 assert.match(tracking,/Number\(o\.balance_due\|\|0\)/);
 assert.match(tracking,/salesInvoiceReturnBalanceSummary\(o\)/);
 assert.match(index,/sales-returns\.js\?v=20261104-exchange-pause-and-ar1/);
 assert.match(index,/tracking-redesign\.js\?v=20261113-approved-return-credit1/);
});
