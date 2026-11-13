const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const repo=name=>fs.readFileSync(path.join(__dirname,'..',name),'utf8');
const initial=repo('database/20261103_cross_sr_tkrk_and_delivery_guards.sql');
const stronger=repo('database/20261103_existing_invoice_merge_and_delivery_hardening.sql');
const guard=repo('sales-document-duplicate-merge.js');
const invoices=repo('sr-multiple-invoices.js');
const tracking=repo('tracking-redesign.js');
const financial=repo('sales-report-bookings.js');
const html=repo('index.html');

test('DB blocks a second TK/RK number that SR conversion already reserved or issued',()=>{
  assert.match(initial,/create trigger guard_cross_source_tkrk_sales_orders[\s\S]+before insert or update of order_no,invoice_no,sales_invoice_no/i);
  assert.match(initial,/create trigger guard_cross_source_tkrk_sr_invoice_parts[\s\S]+before insert or update of invoice_no,status/i);
  assert.match(initial,/h.status in \('pending','issued'\)/i);
  assert.match(initial,/pg_advisory_xact_lock/);
  assert.match(initial,/errcode='23505'/);
  assert.match(initial,/already reserved or issued through an SR conversion/);
});
test('existing historical TK invoices are not rewritten by the database migrations',()=>{
  // The replacement MERGE RPC preserves its old item/payment update logic,
  // so assert the NEW triggers do not issue any historical DML outside it.
  const ddl=[initial.split('-- Extend the existing duplicate-check RPC')[0],
    stronger.split('CREATE OR REPLACE FUNCTION public.merge_sales_order_document')[0]];
  for(const statement of ddl){
    assert.doesNotMatch(statement,/\b(?:delete|truncate)\s+from\s+public\.(?:sales_orders|sales_payments|delivery_requests|stock_movements)/i);
    assert.doesNotMatch(statement,/\bupdate\s+public\.(?:sales_orders|sales_payments|delivery_requests|stock_movements)\s+set/i);
  }
  assert.match(initial,/tg_op='UPDATE'/i);
  assert.match(initial,/new\.order_no is not distinct from old\.order_no/i);
});
test('duplicate check prioritizes linked issued SR invoice over mergeable ordinary TK',()=>{
  const first=initial.indexOf('Cross-namespace duplicate: official SR');
  const ordinary=initial.indexOf('from public.sales_orders so',first);
  const src=initial.indexOf('from public.sales_sr_invoice_parts h',first);
  assert.ok(first>0&&src>first&&ordinary>src);
  assert.match(initial,/false::boolean,[\s\S]+Do NOT create a new Sales Order or merge into this invoice/);
  assert.match(initial,/if found then return; end if;/);
  assert.match(stronger,/Merging normal TK\/RK copies into an already issued SR invoice/);
});
test('new DO cannot double-ship existing historical TK delivery',()=>{
  assert.match(initial,/create trigger guard_issued_sr_invoice_legacy_do[\s\S]+before insert on public.delivery_requests/);
  assert.match(stronger,/select coalesce\(dr\.do_no,'Existing DO/);
  assert.match(stronger,/dr\.status<>'cancelled'/);
  assert.match(stronger,/security definer/i);
  assert.match(stronger,/do not request or release another DO/i);
});
test('form stops merge for issued SR invoices and points Sales back to existing SR',()=>{
  assert.match(guard,/issuedFromSr=row\.sales_flow_type==='pre_order'/);
  assert.match(guard,/const canMerge=!issuedFromSr/);
  assert.match(guard,/Open Original SR \/ Issued Invoice/);
  assert.match(guard,/openSrInvoiceOverview\(row\.order_id\)/);
  assert.match(guard,/Existing deposits must not be entered again/);
});
test('UI checks for existing historical DO before offering or submitting another',()=>{
  assert.match(invoices,/issued_sr_invoice_legacy_do_conflict/);
  assert.match(invoices,/const priorDo=await legacyIssuedDo\(invoicePartId\)/);
  assert.match(invoices,/Delivery already recorded:/);
  assert.match(invoices,/legacy_do_no/);
  assert.match(invoices,/Do not request a second DO/);
});
test('historical TK duplicates stay visible with payment audit context',()=>{
  assert.match(tracking,/linkedInvoiceOwners=new Map/);
  assert.match(tracking,/o\._legacySrInvoiceMirror/);
  assert.match(tracking,/Historical duplicate TK/);
  assert.match(tracking,/verify cash evidence before treating them as separate receipts/);
  assert.match(tracking,/Do not delete or release stock again/);
});
test('report deduplicates converted invoices while leaving payment documents untouched',()=>{
  assert.match(financial,/const mirrored=!!group/);
  assert.match(financial,/if\(extraCash<=0\.001\)return \[\]/);
  assert.match(financial,/report_event:'invoice_additional_payment'/);
});
test('HTML cache versions use updated safe invoice and DO scripts',()=>{
  assert.match(html,/sales-document-duplicate-merge\.js\?v=20261103-cross-invoice-guard1/);
  assert.match(html,/sr-multiple-invoices\.js\?v=20261104-invoice-pricing1/);
  assert.match(html,/tracking-redesign\.js\?v=20261113-arrival-and-service-fees1/);
});
