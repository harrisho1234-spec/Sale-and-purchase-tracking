create or replace function public.get_sales_order_do_request_status(
  p_sales_order_id uuid
)
returns table(
  sales_order_item_id uuid,
  product_id uuid,
  product_code text,
  item_name text,
  image_url text,
  sold_qty numeric,
  requested_qty numeric,
  direct_delivered_qty numeric,
  historical_delivered_qty numeric,
  cancelled_qty numeric,
  available_do_qty numeric,
  fulfillment_status text
)
language plpgsql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=public.current_app_role();
  v_order public.sales_orders%rowtype;
begin
  if v_role not in ('sales','manager','admin','super_admin') then
    raise exception 'Sales, Manager or Admin access required';
  end if;

  select * into v_order
  from public.sales_orders
  where id=p_sales_order_id;

  if not found then raise exception 'Sales Order not found'; end if;

  if v_role='sales'
     and coalesce(v_order.sales_rep_id,v_order.created_by)<>auth.uid()
     and coalesce(v_order.created_by,v_order.sales_rep_id)<>auth.uid() then
    raise exception 'You can request delivery only for your own Sales Order';
  end if;

  return query
  with do_requested as (
    select dri.sales_order_item_id,coalesce(sum(dri.requested_qty),0)::numeric requested_qty
    from public.delivery_request_items dri
    join public.delivery_requests dr on dr.id=dri.delivery_request_id
    where dr.status<>'cancelled'
    group by dri.sales_order_item_id
  ),
  direct_delivered as (
    select sm.reference_item_id sales_order_item_id,coalesce(sum(sm.qty),0)::numeric delivered_qty
    from public.stock_movements sm
    where sm.affects_balance=true
      and sm.movement_type='sale_delivery'
      and sm.reference_type='sales_order_item'
      and sm.reference_item_id is not null
      and sm.delivery_request_item_id is null
    group by sm.reference_item_id
  ),
  cancelled as (
    select sq.sales_order_item_id,coalesce(sum(sq.qty),0)::numeric cancelled_qty
    from public.sales_item_status_quantities sq
    where lower(sq.status)='cancelled'
    group by sq.sales_order_item_id
  )
  select
    i.id,
    i.product_id,
    coalesce(pc.code,i.product_code_snapshot)::text,
    coalesce(pc.item_name,i.item_name_snapshot)::text,
    coalesce(pc.image_url,i.image_url_snapshot)::text,
    i.qty::numeric,
    coalesce(dr.requested_qty,0)::numeric,
    coalesce(dd.delivered_qty,0)::numeric,
    public.historical_customer_delivery_qty(i.id)::numeric,
    coalesce(cx.cancelled_qty,0)::numeric,
    greatest(
      i.qty
      - coalesce(dr.requested_qty,0)
      - coalesce(dd.delivered_qty,0)
      - public.historical_customer_delivery_qty(i.id)
      - coalesce(cx.cancelled_qty,0),
      0
    )::numeric,
    lower(coalesce(i.fulfillment_status,'ordered'))::text
  from public.sales_order_items i
  left join public.product_catalog pc on pc.id=i.product_id
  left join do_requested dr on dr.sales_order_item_id=i.id
  left join direct_delivered dd on dd.sales_order_item_id=i.id
  left join cancelled cx on cx.sales_order_item_id=i.id
  where i.sales_order_id=p_sales_order_id
    and coalesce(i.line_kind,'product')='product'
    and i.product_id is not null
    and coalesce(i.fulfillment_status,'')<>'cancelled'
  order by coalesce(i.line_position,999999),i.created_at,i.id;
end;
$function$;

revoke all on function public.get_sales_order_do_request_status(uuid) from public;
grant execute on function public.get_sales_order_do_request_status(uuid) to authenticated;

create or replace function public.submit_sales_delivery_request(
  p_sales_order_id uuid,
  p_requested_delivery_date date,
  p_delivery_address text,
  p_request_note text,
  p_items jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=public.current_app_role();
  v_order public.sales_orders%rowtype;
  v_request_id uuid;
  v_entry jsonb;
  v_item public.sales_order_items%rowtype;
  v_item_id uuid;
  v_qty numeric;
  v_prior numeric;
  v_direct_delivered numeric;
  v_historical numeric;
  v_cancelled numeric;
  v_available numeric;
  v_count integer:=0;
begin
  if v_role not in ('sales','manager','admin','super_admin') then
    raise exception 'Sales, Manager or Admin access required';
  end if;

  select * into v_order from public.sales_orders where id=p_sales_order_id for update;
  if not found then raise exception 'Sales Order not found'; end if;
  if coalesce(v_order.status,'')='cancelled' then raise exception 'Cancelled Sales Order cannot request delivery'; end if;

  if v_role='sales'
     and coalesce(v_order.sales_rep_id,v_order.created_by)<>auth.uid()
     and coalesce(v_order.created_by,v_order.sales_rep_id)<>auth.uid() then
    raise exception 'You can request delivery only for your own Sales Order';
  end if;

  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then
    raise exception 'Select at least one product for DO request';
  end if;

  insert into public.delivery_requests(
    sales_order_id,requested_delivery_date,delivery_address,request_note,requested_by
  ) values(
    p_sales_order_id,p_requested_delivery_date,
    nullif(trim(coalesce(p_delivery_address,'')),''),
    nullif(trim(coalesce(p_request_note,'')),''),
    auth.uid()
  ) returning id into v_request_id;

  for v_entry in select value from jsonb_array_elements(p_items)
  loop
    v_item_id:=nullif(v_entry->>'sales_order_item_id','')::uuid;
    v_qty:=nullif(v_entry->>'qty','')::numeric;

    if v_item_id is null or v_qty is null or v_qty<=0 then
      raise exception 'Each DO item needs a valid quantity';
    end if;

    select * into v_item
    from public.sales_order_items
    where id=v_item_id and sales_order_id=p_sales_order_id
    for update;

    if not found then raise exception 'DO item does not belong to this Sales Order'; end if;
    if coalesce(v_item.line_kind,'product')<>'product' or v_item.product_id is null then
      raise exception 'Service / fee lines cannot be requested for DO';
    end if;
    if coalesce(v_item.fulfillment_status,'')='cancelled' then
      raise exception 'Cancelled Sales item cannot be requested for DO';
    end if;

    select coalesce(sum(dri.requested_qty),0)::numeric into v_prior
    from public.delivery_request_items dri
    join public.delivery_requests dr on dr.id=dri.delivery_request_id
    where dri.sales_order_item_id=v_item_id and dr.status<>'cancelled';

    select coalesce(sum(sm.qty),0)::numeric into v_direct_delivered
    from public.stock_movements sm
    where sm.affects_balance=true
      and sm.movement_type='sale_delivery'
      and sm.reference_type='sales_order_item'
      and sm.reference_item_id=v_item_id
      and sm.delivery_request_item_id is null;

    v_historical:=public.historical_customer_delivery_qty(v_item_id);

    select coalesce(sum(sq.qty),0)::numeric into v_cancelled
    from public.sales_item_status_quantities sq
    where sq.sales_order_item_id=v_item_id and lower(sq.status)='cancelled';

    v_available:=greatest(
      v_item.qty
      - coalesce(v_prior,0)
      - coalesce(v_direct_delivered,0)
      - coalesce(v_historical,0)
      - coalesce(v_cancelled,0),
      0
    );

    if v_available<=0 then
      raise exception 'No remaining quantity is available for a new DO request for %',
        coalesce(v_item.product_code_snapshot,v_item.item_name_snapshot);
    end if;

    if v_qty>v_available+0.0001 then
      raise exception 'DO quantity exceeds remaining requestable quantity for %. Available: %',
        coalesce(v_item.product_code_snapshot,v_item.item_name_snapshot),v_available;
    end if;

    insert into public.delivery_request_items(delivery_request_id,sales_order_item_id,requested_qty)
    values(v_request_id,v_item_id,v_qty);

    v_count:=v_count+1;
  end loop;

  if v_count=0 then raise exception 'Select at least one product for DO request'; end if;
  return v_request_id;

exception when others then
  if v_request_id is not null then delete from public.delivery_requests where id=v_request_id; end if;
  raise;
end;
$function$;

grant execute on function public.submit_sales_delivery_request(uuid,date,text,text,jsonb) to authenticated;
