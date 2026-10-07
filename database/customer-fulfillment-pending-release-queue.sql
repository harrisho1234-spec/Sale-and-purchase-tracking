-- Customer Fulfillment should show only actionable rows.
-- A Sales/DO line with a pending Stock OUT approval is temporarily removed from
-- the fulfillment queue and count. Rejected requests automatically reappear
-- because only status='pending' is excluded. Approved partial releases reappear
-- if a remaining quantity still exists.

create or replace function public.get_inventory_fulfillment_queue(p_search text default null::text)
returns table(
  sales_order_item_id uuid,
  sales_order_id uuid,
  document_no text,
  customer_name text,
  sales_rep_name text,
  order_date date,
  product_id uuid,
  product_code text,
  item_name text,
  image_url text,
  ordered_qty numeric,
  released_qty numeric,
  historical_qty numeric,
  delivered_qty numeric,
  remaining_qty numeric,
  inventory_tracking_enabled boolean,
  item_status text,
  status_breakdown jsonb
)
language sql
stable security definer
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
  st as (
    select q.sales_order_item_id,
      coalesce(sum(q.qty) filter (where lower(q.status)='cancelled'),0)::numeric cancelled_qty,
      jsonb_agg(jsonb_build_object(
        'status',
        case lower(q.status)
          when 'pending' then 'ordered'
          when 'reserved' then 'ordered'
          when 'ready' then 'arrived'
          when 'installed' then 'delivered'
          else lower(q.status)
        end,
        'qty',q.qty
      ) order by case lower(q.status)
        when 'ordered' then 1 when 'pending' then 1 when 'reserved' then 1
        when 'production' then 2 when 'shipping' then 3
        when 'arrived' then 4 when 'ready' then 4
        when 'delivered' then 5 when 'installed' then 5 else 9 end
      ) as breakdown
    from public.sales_item_status_quantities q
    group by q.sales_order_item_id
  ),
  pending_items as (
    select distinct (r.payload->>'sales_order_item_id')::uuid as sales_order_item_id
    from public.stock_action_requests r
    where r.status='pending'
      and r.action_type='sales_delivery'
      and coalesce(r.payload->>'sales_order_item_id','')<>''
    union
    select distinct dri.sales_order_item_id
    from public.stock_action_requests r
    join public.delivery_request_items dri
      on dri.id::text=r.payload->>'delivery_request_item_id'
    where r.status='pending'
      and r.action_type='do_delivery'
      and coalesce(r.payload->>'delivery_request_item_id','')<>''
  )
  select
    i.id,
    o.id,
    coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),'Sales Order')::text,
    c.name::text,
    nullif(trim(coalesce(o.sales_rep_name_snapshot,'')),'')::text,
    o.order_date,
    i.product_id,
    coalesce(pc.code,i.product_code_snapshot)::text,
    coalesce(pc.item_name,i.item_name_snapshot)::text,
    coalesce(pc.image_url,i.image_url_snapshot)::text,
    i.qty::numeric,
    coalesce(r.released,0)::numeric,
    coalesce(h.historical,0)::numeric,
    (coalesce(r.released,0)+coalesce(h.historical,0))::numeric,
    greatest(i.qty-coalesce(r.released,0)-coalesce(h.historical,0)-coalesce(st.cancelled_qty,0),0)::numeric,
    coalesce(i.inventory_tracking_enabled,false),
    case lower(coalesce(i.fulfillment_status,'ordered'))
      when 'pending' then 'ordered'
      when 'reserved' then 'ordered'
      when 'ready' then 'arrived'
      when 'installed' then 'delivered'
      else lower(coalesce(i.fulfillment_status,'ordered'))
    end::text,
    coalesce(
      st.breakdown,
      jsonb_build_array(jsonb_build_object(
        'status',case lower(coalesce(i.fulfillment_status,'ordered'))
          when 'pending' then 'ordered'
          when 'reserved' then 'ordered'
          when 'ready' then 'arrived'
          when 'installed' then 'delivered'
          else lower(coalesce(i.fulfillment_status,'ordered'))
        end,
        'qty',i.qty
      ))
    )
  from public.sales_order_items i
  join public.sales_orders o on o.id=i.sales_order_id
  join public.customers c on c.id=o.customer_id
  left join public.product_catalog pc on pc.id=i.product_id
  left join rel r on r.item_id=i.id
  left join hist h on h.sales_order_item_id=i.id
  left join st on st.sales_order_item_id=i.id
  left join pending_items pi on pi.sales_order_item_id=i.id
  where public.can_view_inventory()
    and i.product_id is not null
    and coalesce(i.line_kind,'product')='product'
    and i.source_type='stock'
    and coalesce(i.fulfillment_status,'')<>'cancelled'
    and coalesce(o.status,'')<>'cancelled'
    and lower(coalesce(i.fulfillment_status,'')) not in ('delivered','installed')
    and greatest(i.qty-coalesce(r.released,0)-coalesce(h.historical,0)-coalesce(st.cancelled_qty,0),0)>0
    and pi.sales_order_item_id is null
    and (
      nullif(trim(coalesce(p_search,'')),'') is null
      or lower(c.name) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(o.sales_invoice_no,o.invoice_no,o.order_no,o.sr_no,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(pc.code,i.product_code_snapshot,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(pc.item_name,i.item_name_snapshot,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(i.fulfillment_status,'')) like '%'||lower(trim(p_search))||'%'
    )
  order by coalesce(i.inventory_tracking_enabled,false) desc,o.order_date desc,o.created_at desc,i.line_position nulls last,i.created_at;
$function$;
