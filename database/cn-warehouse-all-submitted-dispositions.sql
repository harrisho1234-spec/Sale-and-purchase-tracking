-- Warehouse can see EVERY submitted/active customer CN immediately.
-- Only Return-to-Stock dispositions can enter the receipt request/approval workflow.
-- Damaged, Exchange and No-Stock-Action lines remain visible for coordination,
-- without any saleable inventory movement.
create or replace function public.get_cn_stock_receipt_queue()
returns jsonb language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $fn$
select case when auth.uid() is null or not public.can_view_inventory() then null
 else coalesce((
 select jsonb_agg(jsonb_build_object(
  'return_item_id',r.id,'return_id',cn.id,'cn_no',cn.cn_no,
  'return_date',cn.return_date,'customer_name',cust.name,'return_status',cn.status,
  'awaiting_physical_return',cn.status='confirmed',
  'warehouse_stage',case
    when coalesce(pnd.qty,0)>0 then 'receipt_approval_pending'
    when r.disposition<>'return_to_stock' then 'no_stock_action'
    when greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0),0)=0 then 'stock_received'
    when cn.status='confirmed' then 'awaiting_physical_return'
    else 'ready_for_stock_receipt' end,
  'can_request_receipt',r.disposition='return_to_stock' and
    greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0)-coalesce(pnd.qty,0),0)>0,
  'item_name',r.item_name_snapshot,'product_code',r.product_code_snapshot,
  'product_id',r.product_id,'cn_qty',r.qty,
  'historical_qty',coalesce(r.historical_stock_reconciled_qty,0),
  'received_qty',coalesce(mv.received,0),'pending_approval_qty',coalesce(pnd.qty,0),
  'available_to_request',case when r.disposition='return_to_stock'
    then greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0)-coalesce(pnd.qty,0),0)
    else 0 end,
  'condition',r.condition,'disposition',r.disposition,'notes',r.notes,
  'request_id',pnd.id
 ) order by cn.return_date desc,cn.cn_no,r.created_at)
 from public.sales_return_items r
 join public.sales_returns cn on cn.id=r.sales_return_id
 left join public.customers cust on cust.id=cn.customer_id
 left join lateral (
  select coalesce(sum(m.qty),0) received from public.stock_movements m
  where m.affects_balance and m.movement_type in ('in','return')
   and m.reference_type='sales_return_item' and m.reference_item_id=r.id
 ) mv on true
 left join lateral (
  select req.id,req.requested_qty qty from public.cn_stock_receipt_requests req
  where req.sales_return_item_id=r.id and req.status='pending'
  order by req.requested_at limit 1
 ) pnd on true
 where cn.status in ('confirmed','received')
 ),'[]'::jsonb) end
$fn$;