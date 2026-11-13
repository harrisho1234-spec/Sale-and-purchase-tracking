'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=p=>fs.readFileSync(p,'utf8');
const sql=read('database/20261113_cn_issued_invoice_sources.sql');
const js=read('sales-returns.js');
const html=read('index.html');

test('new CN source choices distinguish issued TK/RK, standalone invoices, and uninvoiced SR',()=>{
  assert.match(sql,/create or replace function public\.get_return_source_documents\(\)/);
  assert.match(sql,/'invoice_part'::text as source_kind/);
  assert.match(sql,/h\.status='issued'/);
  assert.match(sql,/'sr_uninvoiced'/);
  assert.match(sql,/public\.can_view_sales_order\(o\.id\)/);
  assert.match(js,/db\.rpc\('get_return_source_documents'\)/);
  assert.match(js,/o\.source_kind!=='sr_uninvoiced'/);
  assert.match(js,/Choose issued TK\/RK for invoiced items/);
});
test('return item list uses issued invoice part, not whole original SR',()=>{
  assert.match(sql,/create or replace function public\.get_return_source_items\(/);
  assert.match(sql,/l\.sales_order_item_id=i\.id|i\.id=l\.sales_order_item_id/);
  assert.match(sql,/public\.cn_source_invoice_available\(h\.id,i\.id\)>0/);
  assert.match(sql,/p_action<>'cancel_undelivered' then raise exception 'SR only allows cancellation/);
  assert.match(js,/db\.rpc\('get_return_source_items'/);
  assert.match(js,/p_source_kind:order\.source_kind,p_source_id:order\.source_id,p_action:action/);
  assert.match(js,/data-order-id="\$\{x\.source_order_id\|\|''\}"/);
});
test('server enforces TK/RK quantity and unissued SR cancellation, not just UI',()=>{
  assert.match(sql,/create trigger validate_invoice_scoped_cn_item_trg/);
  assert.match(sql,/source_scope_version set default 1/);
  assert.match(sql,/if v_cn\.source_scope_version=0 then return new/);
  assert.match(sql,/new\.source_invoice_part_id is not null/);
  assert.match(sql,/new\.qty>v_allowed/);
  assert.match(sql,/cn\.status<>'cancelled'/);
  assert.match(sql,/coalesce\(w\.approval_status,'pending'\)<>'rejected'/);
  assert.match(sql,/h\.status in \('issued','pending'\)/);
  assert.match(sql,/Select the issued TK\/RK for returns; SR may only cancel uninvoiced items/);
  assert.match(sql,/source_invoice_part_id uuid/);
  assert.match(js,/source_invoice_part_id:r\.dataset\.sourceInvoicePartId\|\|null/);
});
test('CN edit preserves exact invoice part references; older CNs remain readable',()=>{
  assert.match(sql,/create or replace function public\.get_cn_return_item_sources/);
  assert.match(sql,/source_scope_version=0 then return new/);
  assert.match(sql,/public\.cn_return_line_document_no\(ri\.id\)/);
  assert.match(sql,/having count\(distinct h2\.id\)=1/);
  assert.match(js,/db\.rpc\('get_cn_return_item_sources'/);
  assert.match(js,/sourceByItem\.get\(String\(x\.return_item_id\)\)/);
  assert.match(js,/source_invoice_part_id:r\.dataset\.sourceInvoicePartId\|\|null/);
});
test('CN financial, stock, deposit and approval logic is not replaced',()=>{
  assert.doesNotMatch(sql,/update public\.sales_payments\b|delete from public\.sales_payments\b/i);
  assert.doesNotMatch(sql,/update public\.sales_order_summary\b|delete from public\.sales_credit_applications\b/i);
  assert.doesNotMatch(sql,/update public\.stock_movements\b|delete from public\.stock_movements\b/i);
  assert.match(js,/db\.rpc\(action==='cancel_undelivered'\?'create_undelivered_cancellation':'create_sales_return_multi',args\)/);
  assert.match(js,/if\(new Set\(items\.map\(x=>x\.sales_order_item_id\)\)\.size!==items\.length\)/);
  assert.match(html,/sales-returns\.js\?v=20261113-invoice-scoped-cn1/);
});
