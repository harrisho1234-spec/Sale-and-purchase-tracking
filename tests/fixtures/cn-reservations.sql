-- Actual reservation calculation, with minimal supporting tables for isolated fixtures.
create table product_catalog(id uuid primary key,code text,item_name text);
alter table sales_orders add column sales_rep_name_snapshot text;
create table supplier_pos(id uuid primary key,status text);
create table supplier_po_items(id uuid primary key,supplier_po_id uuid,product_id uuid);
create table fulfillment_links(id uuid primary key,sales_order_item_id uuid,supplier_po_item_id uuid,qty_allocated numeric);
CREATE OR REPLACE FUNCTION public.inventory_reservation_lines()
 RETURNS TABLE(sales_order_item_id uuid, sales_order_id uuid, product_id uuid, document_no text, customer_name text, sales_rep_name text, order_status text, fulfillment_status text, reservation_date timestamp with time zone, order_date date, product_code text, item_name text, ordered_qty numeric, released_qty numeric, reserved_qty numeric, reservation_source text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
$function$;
