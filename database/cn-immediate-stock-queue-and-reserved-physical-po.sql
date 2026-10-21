-- CNs reach the warehouse immediately as Awaiting Physical Return.
-- Existing stock receipt approval remains the only operation posting inventory.
-- Reservation numbers include physically RECEIVED PO quantities allocated to
-- active pre-order SR lines. Historical deliveries are never reserved again.

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
    when greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0),0)=0 then 'stock_received'
    when cn.status='confirmed' then 'awaiting_physical_return'
    else 'ready_for_stock_receipt' end,
  'item_name',r.item_name_snapshot,'product_code',r.product_code_snapshot,
  'product_id',r.product_id,'cn_qty',r.qty,
  'historical_qty',coalesce(r.historical_stock_reconciled_qty,0),
  'received_qty',coalesce(mv.received,0),'pending_approval_qty',coalesce(pnd.qty,0),
  'available_to_request',greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0)-coalesce(pnd.qty,0),0),
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
 where cn.status in ('confirmed','received') and r.disposition='return_to_stock'
 ),'[]'::jsonb) end
$fn$;

-- Shared, detailed source of truth for Reserved, ensuring the stock-card
-- balance and the sales-order reservation popup cannot disagree.
create or replace function public.inventory_reservation_lines()
returns table (
 sales_order_item_id uuid, sales_order_id uuid, product_id uuid,
 document_no text,customer_name text,sales_rep_name text,
 order_status text,fulfillment_status text,
 reservation_date timestamptz,order_date date,
 product_code text,item_name text,
 ordered_qty numeric,released_qty numeric,reserved_qty numeric,
 reservation_source text
) language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $fn$
with
 released as (
  select reference_item_id sales_order_item_id,sum(qty)::numeric qty
  from public.stock_movements
  where affects_balance and movement_type='sale_delivery'
   and reference_type='sales_order_item' and reference_item_id is not null
  group by reference_item_id
 ),
 historic as (
  select sales_order_item_id,sum(qty)::numeric qty
  from public.customer_fulfillment_reconciliations
  where voided_at is null group by sales_order_item_id
 ),
 cancelled as (
  select sales_order_item_id,sum(qty)::numeric qty
  from public.sales_item_status_quantities
  where lower(status)='cancelled' group by sales_order_item_id
 ),
 lines as (
  select i.id item_id,o.id so_id,i.product_id,
   coalesce(nullif(o.sr_no,''),nullif(o.sales_invoice_no,''),nullif(o.order_no,''),'Order')::text doc,
   c.name::text customer_name,nullif(btrim(o.sales_rep_name_snapshot),'')::text rep,
   coalesce(nullif(o.status,''),'active')::text order_status,
   coalesce(nullif(i.fulfillment_status,''),'pending')::text item_status,
   coalesce(i.created_at,o.created_at) created_at,o.order_date,
   coalesce(pc.code,i.product_code_snapshot)::text code,
   coalesce(pc.item_name,i.item_name_snapshot)::text name,
   i.qty::numeric ordered,i.source_type,
   coalesce(r.qty,0)::numeric released,
   greatest(i.qty-coalesce(r.qty,0)-coalesce(h.qty,0)-coalesce(k.qty,0),0)::numeric unfulfilled
  from public.sales_order_items i
  join public.sales_orders o on o.id=i.sales_order_id
  join public.customers c on c.id=o.customer_id
  left join public.product_catalog pc on pc.id=i.product_id
  left join released r on r.sales_order_item_id=i.id
  left join historic h on h.sales_order_item_id=i.id
  left join cancelled k on k.sales_order_item_id=i.id
  where i.product_id is not null
   and i.line_kind='product'
   and coalesce(i.fulfillment_status,'') not in ('cancelled','delivered','installed')
   and coalesce(o.status,'')<>'cancelled'
 ),
 stock_order as (
  select l.*,l.unfulfilled reserved,'stock_order'::text kind
  from lines l
  join public.sales_order_items i on i.id=l.item_id
  where i.inventory_tracking_enabled=true and i.source_type='stock'
 ),
 po_received as (
  select m.reference_item_id po_item,sum(m.qty)::numeric qty
  from public.stock_movements m
  where m.affects_balance=true and m.movement_type='po_receipt'
   and m.reference_type='supplier_po_item' and m.reference_item_id is not null
  group by m.reference_item_id
 ),
 linked as (
  select l.*,f.id link_id,f.supplier_po_item_id,
   greatest(f.qty_allocated,0)::numeric allocated,
   coalesce(pr.qty,0)::numeric po_received_qty
  from lines l
  join public.sales_order_items i on i.id=l.item_id
  join public.fulfillment_links f on f.sales_order_item_id=l.item_id
  join public.supplier_po_items pi on pi.id=f.supplier_po_item_id
      and pi.product_id=l.product_id
  join public.supplier_pos po on po.id=pi.supplier_po_id
  left join po_received pr on pr.po_item=f.supplier_po_item_id
  where i.source_type='pre_order'
   and coalesce(po.status,'')<>'cancelled'
   and l.unfulfilled>0
 ),
 po_ranked as (
  select x.*,
   greatest(least(x.allocated,
      x.po_received_qty-coalesce(sum(x.allocated) over (
        partition by x.supplier_po_item_id order by x.created_at,x.link_id
        rows between unbounded preceding and 1 preceding),0)),0)::numeric physically_allocated
  from linked x
 ),
 sale_ranked as (
  select x.*,
   greatest(least(x.physically_allocated,
      x.unfulfilled-coalesce(sum(x.physically_allocated) over (
        partition by x.item_id order by x.created_at,x.link_id
        rows between unbounded preceding and 1 preceding),0)),0)::numeric reserved
  from po_ranked x
 ),
 preorder as (
  select item_id,so_id,product_id,doc,customer_name,rep,order_status,
     item_status,created_at,order_date,code,name,ordered,released,
     sum(reserved)::numeric reserved,'received_po_allocation'::text kind
  from sale_ranked
  group by item_id,so_id,product_id,doc,customer_name,rep,order_status,
     item_status,created_at,order_date,code,name,ordered,released
 )
select item_id,so_id,product_id,doc,customer_name,rep,
 order_status,item_status,created_at,order_date,code,name,
 ordered,released,reserved,kind
from stock_order where reserved>0
union all
select item_id,so_id,product_id,doc,customer_name,rep,
 order_status,item_status,created_at,order_date,code,name,
 ordered,released,reserved,kind
from preorder where reserved>0
$fn$;

create or replace function public.inventory_reserved_totals()
returns table(product_id uuid,reserved numeric)
language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $fn$
select l.product_id,sum(l.reserved_qty)::numeric
from public.inventory_reservation_lines() l
where public.can_view_inventory()
group by l.product_id
$fn$;

create or replace function public.get_inventory_reserved_details(p_product_id uuid)
returns table (
 sales_order_item_id uuid,sales_order_id uuid,document_no text,
 customer_name text,sales_rep_name text,order_status text,
 fulfillment_status text,reservation_date timestamptz,order_date date,
 product_id uuid,product_code text,item_name text,
 ordered_qty numeric,released_qty numeric,reserved_qty numeric
) language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $fn$
select l.sales_order_item_id,l.sales_order_id,l.document_no,l.customer_name,
 l.sales_rep_name,l.order_status,l.fulfillment_status,l.reservation_date,
 l.order_date,l.product_id,l.product_code,l.item_name,
 l.ordered_qty,l.released_qty,l.reserved_qty
from public.inventory_reservation_lines() l
where public.can_view_inventory() and l.product_id=p_product_id
order by l.reservation_date desc,l.order_date desc
$fn$;

revoke all on function public.inventory_reservation_lines() from public,anon,authenticated;
revoke all on function public.inventory_reserved_totals() from public,anon;
revoke all on function public.get_inventory_reserved_details(uuid) from public,anon;
revoke all on function public.get_cn_stock_receipt_queue() from public,anon;
grant execute on function public.inventory_reserved_totals() to authenticated;
grant execute on function public.get_inventory_reserved_details(uuid) to authenticated;
grant execute on function public.get_cn_stock_receipt_queue() to authenticated;
