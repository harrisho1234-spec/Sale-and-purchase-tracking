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
 const sandbox={
  money:(n)=>'$'+Number(n||0).toFixed(2),
  esc:s=>String(s??''),Number,Math
 };
 vm.runInNewContext(tracking.slice(start,end)+'\nthis.render=salesInvoiceReturnBalanceSummary;',sandbox,{timeout:2000});
 return sandbox.render(values);
}
test('invoice with $1,000 sale, $300 deposit and $200 credit displays adjusted AR $500',()=>{
 const html=render({
  currency:'USD',order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:200,balance_due:500,return_financial:{
   recorded_return_value:200,received_return_value:200,cn_count:1,cn_numbers:'CN-DEMO'
  }
 });
 for(const line of [
  'Return / CN &amp; AR Breakdown','Original invoice amount','$1000.00',
  'Actual payments / deposits','−$300.00','Recorded return value (after discounts)','−$200.00',
  'Approved customer credit applied','Adjusted AR / Balance Due','$500.00','CN-DEMO'
 ])assert.ok(html.includes(line),line);
 assert.ok(!html.includes('$300.00</b></div><div class="border-t'),'return is not automatically deducted again');
});
test('recorded CN with NO applied credit keeps full unpaid AR and shows pending-credit guidance',()=>{
 const html=render({
  order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:0,balance_due:700,return_financial:{
   recorded_return_value:200,cn_count:1,cn_numbers:'CN-DEMO'
  }
 });
 assert.match(html,/Adjusted AR \/ Balance Due<\/span><b[^>]*>\$700.00<\/b>/);
 assert.match(html,/Return recorded, but no Customer Credit is applied to this invoice yet/);
});
test('credit from another CN is shown as allocation on this invoice, not falsely tied to return',()=>{
 const html=render({
  order_total:1000,amount_paid:300,gross_balance_due:700,
  credit_applied:50,balance_due:650,return_financial:{
   recorded_return_value:0,cn_count:0,cn_numbers:''
  }
 });
 assert.match(html,/\$650.00/);
 assert.match(html,/Only approved credit allocated to THIS invoice reduces its AR/);
});
test('missing read-only return data is not silently shown as a zero return',()=>{
 const html=render({
  order_total:1000,amount_paid:300,credit_applied:0,balance_due:700,
  return_financial:null
 });
 assert.match(html,/Recorded return value \(after discounts\)<\/span><b[^>]*>Unavailable<\/b>/);
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
 assert.match(tracking,/return_financial:financialReturns.error\?null:/);
 assert.match(tracking,/Number\(o\.credit_applied\|\|0\)/);
 assert.match(tracking,/Number\(o\.balance_due\|\|0\)/);
 assert.match(tracking,/salesInvoiceReturnBalanceSummary\(o\)/);
 assert.match(index,/sales-returns\.js\?v=20261104-exchange-pause-and-ar1/);
 assert.match(index,/tracking-redesign\.js\?v=20261104-exchange-pause-and-ar1/);
});
