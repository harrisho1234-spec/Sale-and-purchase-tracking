-- Candidate lookup for linking already-posted generic Stock OUT movements to Customer Fulfillment.
-- Shows same-product Sales Order items even when already fulfilled so the UI can explain why a row is unavailable.

create or replace function public.get_stock_out_fulfillment_candidates(
  p_product_id uuid,
  p_reference_no text default null,
  p_counterparty text default null
)
returns table(
  sales_order_item_id uuid,
  sales_order_id uuid,
  document_no text,
  customer_name text,
  order_date date,
  product_id uuid,
  product_code text,
  item_name text,
  image_url text,
  ordered_qty numeric,
  released_qty numeric,
  historical_qty numeric,
  cancelled_qty numeric,
  remaining_qty numeric,
  inventory_tracking_enabled boolean,
  fulfillment_status text,
  exact_reference boolean,
  customer_match boolean
)
language sql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
  with rel as (
    select reference_item_id item_id,sum(qty)::numeric released
    from public.stock_movements
    where affects_balance=true
      and movement_type='sale_delivery'
      and reference_type='sales_order_item'
      and reference_item_id is not null
    group by reference_item_id
  ),
  hist as (
    select sales_order_item_id,sum(qty)::numeric historical
    from public.customer_fulfillment_reconciliations
    where voided_at is null
    group by sales_order_item_id
  ),
  canc as (
    select sales_order_item_id,sum(qty)::numeric cancelled
    from public.sales_item_status_quantities
    where lower(status)='cancelled'
    group by sales_order_item_id
  ),
  base as (
    select
      i.id sales_order_item_id,
      o.id sales_order_id,
      coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),'Sales Order')::text document_no,
      c.name::text customer_name,
      o.order_date,
      i.product_id,
      coalesce(pc.code,i.product_code_snapshot)::text product_code,
      coalesce(pc.item_name,i.item_name_snapshot)::text item_name,
      coalesce(pc.image_url,i.image_url_snapshot)::text image_url,
      i.qty::numeric ordered_qty,
      coalesce(rel.released,0)::numeric released_qty,
      coalesce(hist.historical,0)::numeric historical_qty,
      coalesce(canc.cancelled,0)::numeric cancelled_qty,
      greatest(i.qty-coalesce(rel.released,0)-coalesce(hist.historical,0)-coalesce(canc.cancelled,0),0)::numeric remaining_qty,
      coalesce(i.inventory_tracking_enabled,false) inventory_tracking_enabled,
      lower(coalesce(i.fulfillment_status,'ordered'))::text fulfillment_status,
      (
        nullif(trim(coalesce(p_reference_no,'')),'') is not null
        and lower(regexp_replace(coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),''),'[^a-zA-Z0-9]','','g'))
            = lower(regexp_replace(trim(p_reference_no),'[^a-zA-Z0-9]','','g'))
      ) exact_reference,
      (
        nullif(trim(coalesce(p_counterparty,'')),'') is not null
        and (
          lower(regexp_replace(c.name,'[^a-zA-Z0-9]','','g'))
            = lower(regexp_replace(trim(p_counterparty),'[^a-zA-Z0-9]','','g'))
          or lower(c.name) like '%'||lower(trim(p_counterparty))||'%'
          or lower(trim(p_counterparty)) like '%'||lower(c.name)||'%'
        )
      ) customer_match
    from public.sales_order_items i
    join public.sales_orders o on o.id=i.sales_order_id
    join public.customers c on c.id=o.customer_id
    left join public.product_catalog pc on pc.id=i.product_id
    left join rel on rel.item_id=i.id
    left join hist on hist.sales_order_item_id=i.id
    left join canc on canc.sales_order_item_id=i.id
    where public.can_view_inventory()
      and i.product_id=p_product_id
      and coalesce(i.line_kind,'product')='product'
      and i.source_type='stock'
      and coalesce(o.status,'')<>'cancelled'
      and coalesce(i.fulfillment_status,'')<>'cancelled'
  )
  select *
  from base
  order by
    exact_reference desc,
    customer_match desc,
    (remaining_qty>0) desc,
    order_date desc,
    document_no desc
  limit 250
$function$;

revoke all on function public.get_stock_out_fulfillment_candidates(uuid,text,text) from public;
grant execute on function public.get_stock_out_fulfillment_candidates(uuid,text,text) to authenticated;
