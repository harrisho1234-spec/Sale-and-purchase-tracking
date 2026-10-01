-- Stock approval idempotency / duplicate-work protection
-- Applied to live Supabase on 2026-10-01.
-- One physical stock movement should produce one approval and one inventory posting.

create unique index if not exists ux_stock_action_pending_sales_item
on public.stock_action_requests ((payload->>'sales_order_item_id'))
where status='pending' and action_type='sales_delivery';

create unique index if not exists ux_stock_action_pending_do_item
on public.stock_action_requests ((payload->>'delivery_request_item_id'))
where status='pending' and action_type='do_delivery';

create or replace function public.submit_stock_action_request(
  p_action_type text,
  p_payload jsonb,
  p_reason text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_id uuid;
  v_type text:=lower(trim(coalesce(p_action_type,'')));
  v_payload jsonb:=coalesce(p_payload,'{}'::jsonb);
  v_move_type text;
  v_qty numeric;
  v_product uuid;
  v_from uuid;
  v_to uuid;
  v_item uuid;
  v_location_qty numeric:=0;
  v_released numeric:=0;
  v_cancelled numeric:=0;
  v_arrived numeric:=0;
  v_remaining numeric:=0;
  v_do_delivered numeric:=0;
  v_do_remaining numeric:=0;
  v_sales_item public.sales_order_items%rowtype;
  v_sales_order public.sales_orders%rowtype;
  v_do_item public.delivery_request_items%rowtype;
  v_do_req public.delivery_requests%rowtype;
  v_pending public.stock_action_requests%rowtype;
begin
  if public.current_app_role()<>'stock_controller' then
    raise exception 'Stock Controller access required for stock action requests';
  end if;

  if v_type not in ('manual_movement','sales_delivery','do_delivery') then
    raise exception 'Unsupported stock approval action';
  end if;

  if v_type='manual_movement' then
    v_move_type:=lower(trim(coalesce(v_payload->>'movement_type','')));
    v_qty:=nullif(v_payload->>'qty','')::numeric;
    v_product:=nullif(v_payload->>'product_id','')::uuid;
    v_from:=nullif(v_payload->>'from_location_id','')::uuid;
    v_to:=nullif(v_payload->>'to_location_id','')::uuid;

    if v_move_type not in ('out','broken','transfer','adjustment_out') then
      raise exception 'Only stock deductions and transfers require this approval request';
    end if;
    if v_product is null or not exists(select 1 from public.product_catalog where id=v_product) then
      raise exception 'Valid product is required';
    end if;
    if coalesce(v_qty,0)<=0 or trunc(v_qty)<>v_qty then
      raise exception 'Quantity must be a positive whole number';
    end if;
    if v_from is null then
      raise exception 'Source location is required';
    end if;
    if v_move_type='transfer' and (v_to is null or v_to=v_from) then
      raise exception 'Transfer requires a different destination location';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'stock-approval:manual:'||v_product::text||':'||v_move_type||':'||
        coalesce(v_from::text,'')||':'||coalesce(v_to::text,''),
        0
      )
    );

    select r.* into v_pending
    from public.stock_action_requests r
    where r.status='pending'
      and r.action_type='manual_movement'
      and r.payload->>'product_id'=v_product::text
      and lower(coalesce(r.payload->>'movement_type',''))=v_move_type
      and coalesce(r.payload->>'from_location_id','')=coalesce(v_from::text,'')
      and coalesce(r.payload->>'to_location_id','')=coalesce(v_to::text,'')
    order by r.requested_at
    limit 1
    for update;

    if v_pending.id is not null then
      if nullif(v_pending.payload->>'qty','')::numeric=v_qty then
        return v_pending.id;
      end if;
      raise exception 'A stock approval for this item and source location is already pending. Review it before creating another.';
    end if;

    select coalesce(sum(delta),0) into v_location_qty
    from (
      select qty as delta
      from public.stock_movements
      where product_id=v_product and affects_balance=true and to_location_id=v_from
      union all
      select -qty as delta
      from public.stock_movements
      where product_id=v_product and affects_balance=true and from_location_id=v_from
    ) q;

    if v_location_qty<v_qty then
      raise exception 'Not enough stock at the selected location. Available: %',v_location_qty;
    end if;

  elsif v_type='sales_delivery' then
    v_item:=nullif(v_payload->>'sales_order_item_id','')::uuid;
    v_qty:=nullif(v_payload->>'qty','')::numeric;
    v_from:=nullif(v_payload->>'location_id','')::uuid;

    if v_item is null then raise exception 'Valid Sales Order item is required'; end if;
    if coalesce(v_qty,0)<=0 or trunc(v_qty)<>v_qty then
      raise exception 'Quantity must be a positive whole number';
    end if;
    if v_from is null then raise exception 'Source location is required'; end if;

    select * into v_sales_item
    from public.sales_order_items
    where id=v_item
    for update;
    if not found then raise exception 'Valid Sales Order item is required'; end if;

    select * into v_sales_order
    from public.sales_orders
    where id=v_sales_item.sales_order_id;

    if coalesce(v_sales_item.inventory_tracking_enabled,false)=false then
      raise exception 'Link this Sales item to Stock first';
    end if;
    if coalesce(v_sales_order.status,'')='cancelled'
       or coalesce(v_sales_item.fulfillment_status,'')='cancelled' then
      raise exception 'Cancelled item cannot be released';
    end if;
    if v_sales_item.product_id is null then raise exception 'Sales item is not linked to a Product'; end if;
    if v_sales_item.source_type<>'stock' then raise exception 'Only stock-source Sales items can be released from inventory'; end if;

    perform pg_advisory_xact_lock(hashtextextended('stock-approval:sales:'||v_item::text,0));
    perform public.sync_sales_item_status_with_stock(v_item);

    select coalesce(sum(qty),0) into v_released
    from public.stock_movements
    where affects_balance=true and movement_type='sale_delivery'
      and reference_type='sales_order_item' and reference_item_id=v_item;

    select coalesce(sum(qty),0) into v_cancelled
    from public.sales_item_status_quantities
    where sales_order_item_id=v_item and lower(status)='cancelled';

    select coalesce(sum(qty),0) into v_arrived
    from public.sales_item_status_quantities
    where sales_order_item_id=v_item and lower(status)='arrived';

    v_remaining:=greatest(v_sales_item.qty-v_released-v_cancelled,0);

    if v_remaining<=0 then
      raise exception 'This Sales item is already fully delivered. No stock approval is needed.';
    end if;
    if v_qty>v_remaining then
      raise exception 'Delivery quantity exceeds remaining active quantity. Remaining: %',v_remaining;
    end if;
    if v_qty>v_arrived then
      raise exception 'Only Arrived quantity can be submitted for delivery. Arrived and ready: %',v_arrived;
    end if;

    select r.* into v_pending
    from public.stock_action_requests r
    where r.status='pending'
      and (
        (r.action_type='sales_delivery' and r.payload->>'sales_order_item_id'=v_item::text)
        or
        (r.action_type='do_delivery' and exists(
          select 1
          from public.delivery_request_items dri
          where dri.id=nullif(r.payload->>'delivery_request_item_id','')::uuid
            and dri.sales_order_item_id=v_item
        ))
      )
    order by r.requested_at
    limit 1
    for update;

    if v_pending.id is not null then
      if v_pending.action_type='sales_delivery'
         and nullif(v_pending.payload->>'qty','')::numeric=v_qty
         and coalesce(v_pending.payload->>'location_id','')=v_from::text then
        return v_pending.id;
      end if;
      raise exception 'This Sales item already has a Stock OUT approval waiting. Review that request instead of creating another.';
    end if;

  else
    v_item:=nullif(v_payload->>'delivery_request_item_id','')::uuid;
    v_qty:=nullif(v_payload->>'qty','')::numeric;
    v_from:=nullif(v_payload->>'location_id','')::uuid;

    if v_item is null then raise exception 'Valid Delivery Order item is required'; end if;
    if coalesce(v_qty,0)<=0 or trunc(v_qty)<>v_qty then
      raise exception 'Quantity must be a positive whole number';
    end if;
    if v_from is null then raise exception 'Source location is required'; end if;

    select * into v_do_item
    from public.delivery_request_items
    where id=v_item
    for update;
    if not found then raise exception 'Valid Delivery Order item is required'; end if;

    select * into v_do_req
    from public.delivery_requests
    where id=v_do_item.delivery_request_id
    for update;
    if not found then raise exception 'Delivery Order request not found'; end if;
    if v_do_req.status='cancelled' then raise exception 'DO request is cancelled'; end if;
    if nullif(trim(coalesce(v_do_req.do_no,'')),'') is null then
      raise exception 'Assign the DO number before Stock OUT';
    end if;

    select * into v_sales_item
    from public.sales_order_items
    where id=v_do_item.sales_order_item_id
    for update;
    if not found then raise exception 'Sales item for this DO was not found'; end if;

    select * into v_sales_order
    from public.sales_orders
    where id=v_sales_item.sales_order_id;

    if coalesce(v_sales_item.inventory_tracking_enabled,false)=false then
      raise exception 'Link this Sales item to Stock first';
    end if;
    if coalesce(v_sales_order.status,'')='cancelled'
       or coalesce(v_sales_item.fulfillment_status,'')='cancelled' then
      raise exception 'Cancelled item cannot be released';
    end if;
    if v_sales_item.product_id is null then raise exception 'Sales item is not linked to a Product'; end if;
    if v_sales_item.source_type<>'stock' then raise exception 'Only stock-source Sales items can be released from inventory'; end if;

    perform pg_advisory_xact_lock(hashtextextended('stock-approval:sales:'||v_sales_item.id::text,0));
    perform public.sync_sales_item_status_with_stock(v_sales_item.id);

    select coalesce(sum(qty),0)::numeric into v_do_delivered
    from public.stock_movements
    where affects_balance=true
      and movement_type='sale_delivery'
      and delivery_request_item_id=v_do_item.id;

    v_do_remaining:=greatest(v_do_item.requested_qty-v_do_delivered,0);
    if v_do_remaining<=0 then
      raise exception 'This DO item is already fully delivered. No stock approval is needed.';
    end if;
    if v_qty>v_do_remaining then
      raise exception 'Release quantity exceeds DO remaining quantity. Remaining: %',v_do_remaining;
    end if;

    select coalesce(sum(qty),0) into v_released
    from public.stock_movements
    where affects_balance=true and movement_type='sale_delivery'
      and reference_type='sales_order_item' and reference_item_id=v_sales_item.id;

    select coalesce(sum(qty),0) into v_cancelled
    from public.sales_item_status_quantities
    where sales_order_item_id=v_sales_item.id and lower(status)='cancelled';

    select coalesce(sum(qty),0) into v_arrived
    from public.sales_item_status_quantities
    where sales_order_item_id=v_sales_item.id and lower(status)='arrived';

    v_remaining:=greatest(v_sales_item.qty-v_released-v_cancelled,0);

    if v_remaining<=0 then
      raise exception 'This Sales item is already fully delivered. No stock approval is needed.';
    end if;
    if v_qty>v_remaining then
      raise exception 'Delivery quantity exceeds remaining active quantity. Remaining: %',v_remaining;
    end if;
    if v_qty>v_arrived then
      raise exception 'Only Arrived quantity can be submitted for delivery. Arrived and ready: %',v_arrived;
    end if;

    select r.* into v_pending
    from public.stock_action_requests r
    where r.status='pending'
      and (
        (r.action_type='sales_delivery' and r.payload->>'sales_order_item_id'=v_sales_item.id::text)
        or
        (r.action_type='do_delivery' and exists(
          select 1
          from public.delivery_request_items dri
          where dri.id=nullif(r.payload->>'delivery_request_item_id','')::uuid
            and dri.sales_order_item_id=v_sales_item.id
        ))
      )
    order by r.requested_at
    limit 1
    for update;

    if v_pending.id is not null then
      if v_pending.action_type='do_delivery'
         and v_pending.payload->>'delivery_request_item_id'=v_do_item.id::text
         and nullif(v_pending.payload->>'qty','')::numeric=v_qty
         and coalesce(v_pending.payload->>'location_id','')=v_from::text then
        return v_pending.id;
      end if;
      raise exception 'This Sales / DO item already has a Stock OUT approval waiting. Review that request instead of creating another.';
    end if;
  end if;

  insert into public.stock_action_requests(action_type,payload,reason,requested_by)
  values(v_type,v_payload,nullif(trim(coalesce(p_reason,'')),''),auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.create_stock_movement(
  p_product_id uuid,
  p_movement_type text,
  p_qty numeric,
  p_from_location_id uuid default null::uuid,
  p_to_location_id uuid default null::uuid,
  p_movement_date date default current_date,
  p_reference_type text default null::text,
  p_reference_id uuid default null::uuid,
  p_reference_item_id uuid default null::uuid,
  p_reference_no text default null::text,
  p_counterparty text default null::text,
  p_note text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_id uuid;
  v_from_qty numeric;
  v_pending public.stock_action_requests%rowtype;
  v_move_type text:=lower(trim(coalesce(p_movement_type,'')));
begin
  if not public.can_operate_inventory() then raise exception 'Stock Controller or Admin access required'; end if;
  if p_product_id is null or not exists(select 1 from public.product_catalog where id=p_product_id) then raise exception 'Product is required'; end if;
  if coalesce(p_qty,0)<=0 then raise exception 'Quantity must be greater than zero'; end if;
  if v_move_type not in ('in','out','return','broken','transfer','adjustment_in','adjustment_out') then raise exception 'Unsupported manual movement type'; end if;
  if v_move_type in ('in','return','adjustment_in') and p_to_location_id is null then raise exception 'Destination location is required'; end if;
  if v_move_type in ('out','broken','adjustment_out') and p_from_location_id is null then raise exception 'Source location is required'; end if;
  if v_move_type='transfer' and (p_from_location_id is null or p_to_location_id is null or p_from_location_id=p_to_location_id) then raise exception 'Transfer requires different From and To locations'; end if;

  if v_move_type in ('out','broken','transfer','adjustment_out') then
    if public.current_app_role()='stock_controller' then
      raise exception 'This stock deduction requires approval. Submit it from Stock & Inventory instead of posting it directly.';
    end if;

    perform pg_advisory_xact_lock(
      hashtextextended(
        'stock-approval:manual:'||p_product_id::text||':'||v_move_type||':'||
        coalesce(p_from_location_id::text,'')||':'||coalesce(p_to_location_id::text,''),
        0
      )
    );

    select r.* into v_pending
    from public.stock_action_requests r
    where r.status='pending'
      and r.action_type='manual_movement'
      and r.payload->>'product_id'=p_product_id::text
      and lower(coalesce(r.payload->>'movement_type',''))=v_move_type
      and coalesce(r.payload->>'from_location_id','')=coalesce(p_from_location_id::text,'')
      and coalesce(r.payload->>'to_location_id','')=coalesce(p_to_location_id::text,'')
    order by r.requested_at
    limit 1
    for update;

    if v_pending.id is not null
       and nullif(v_pending.payload->>'qty','')::numeric<>p_qty then
      raise exception 'A pending approval already exists for this stock action. Review it before posting a different quantity.';
    end if;
  end if;

  if p_from_location_id is not null then
    perform pg_advisory_xact_lock(hashtextextended(p_product_id::text||':'||p_from_location_id::text,0));
    select coalesce(sum(delta),0) into v_from_qty from (
      select qty as delta from public.stock_movements where product_id=p_product_id and affects_balance=true and to_location_id=p_from_location_id
      union all
      select -qty as delta from public.stock_movements where product_id=p_product_id and affects_balance=true and from_location_id=p_from_location_id
    ) q;
    if v_from_qty<p_qty then raise exception 'Not enough stock at the selected location. Available: %',v_from_qty; end if;
  end if;

  insert into public.stock_movements(
    movement_date,product_id,movement_type,qty,from_location_id,to_location_id,
    reference_type,reference_id,reference_item_id,reference_no,counterparty,note,created_by
  ) values(
    coalesce(p_movement_date,current_date),p_product_id,v_move_type,p_qty,p_from_location_id,p_to_location_id,
    nullif(trim(coalesce(p_reference_type,'')),''),p_reference_id,p_reference_item_id,
    nullif(trim(coalesce(p_reference_no,'')),''),nullif(trim(coalesce(p_counterparty,'')),''),
    nullif(trim(coalesce(p_note,'')),''),auth.uid()
  ) returning id into v_id;

  perform public.refresh_inventory_product_snapshot(p_product_id);

  if v_pending.id is not null then
    update public.stock_action_requests
    set status='approved',
        reviewed_by=auth.uid(),
        reviewed_at=now(),
        reviewer_note=coalesce(reviewer_note,'Approved through direct stock action'),
        applied_movement_id=v_id,
        updated_at=now()
    where id=v_pending.id and status='pending';
  end if;

  return v_id;
end;
$function$;

create or replace function public.release_sales_stock(
  p_sales_order_item_id uuid,
  p_qty numeric,
  p_location_id uuid,
  p_delivery_date date default current_date,
  p_note text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_customer text;
  v_released numeric;
  v_cancelled numeric;
  v_remaining numeric;
  v_arrived numeric;
  v_location_qty numeric;
  v_id uuid;
  v_pending public.stock_action_requests%rowtype;
  v_pending_do uuid;
  v_do_context boolean:=coalesce(current_setting('app.stock_do_release',true),'')='1';
begin
  if not public.can_operate_inventory() then raise exception 'Stock Controller or Admin access required'; end if;
  if public.current_app_role()='stock_controller' then
    raise exception 'Customer Stock OUT requires approval. Submit it for approval instead of releasing stock directly.';
  end if;
  if coalesce(p_qty,0)<=0 then raise exception 'Quantity must be greater than zero'; end if;
  if p_location_id is null then raise exception 'Stock location is required'; end if;

  select * into v_item from public.sales_order_items where id=p_sales_order_item_id for update;
  if not found then raise exception 'Sales item not found'; end if;
  select * into v_order from public.sales_orders where id=v_item.sales_order_id;

  if coalesce(v_item.inventory_tracking_enabled,false)=false then raise exception 'Link this Sales item to Stock first'; end if;
  if coalesce(v_order.status,'')='cancelled' or coalesce(v_item.fulfillment_status,'')='cancelled' then raise exception 'Cancelled item cannot be released'; end if;
  if v_item.product_id is null then raise exception 'Sales item is not linked to a Product'; end if;
  if v_item.source_type<>'stock' then raise exception 'Only stock-source Sales items can be released from inventory'; end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-approval:sales:'||v_item.id::text,0));

  if not v_do_context then
    select r.id into v_pending_do
    from public.stock_action_requests r
    where r.status='pending'
      and r.action_type='do_delivery'
      and exists(
        select 1
        from public.delivery_request_items dri
        where dri.id=nullif(r.payload->>'delivery_request_item_id','')::uuid
          and dri.sales_order_item_id=v_item.id
      )
    order by r.requested_at
    limit 1
    for update;

    if v_pending_do is not null then
      raise exception 'A DO Stock OUT approval is already pending for this Sales item. Review it before using direct Customer Stock OUT.';
    end if;
  end if;

  select r.* into v_pending
  from public.stock_action_requests r
  where r.status='pending'
    and r.action_type='sales_delivery'
    and r.payload->>'sales_order_item_id'=v_item.id::text
  order by r.requested_at
  limit 1
  for update;

  if v_pending.id is not null then
    if nullif(v_pending.payload->>'qty','')::numeric<>p_qty
       or coalesce(v_pending.payload->>'location_id','')<>p_location_id::text then
      raise exception 'A Customer Stock OUT approval is already pending for this item. Review it before posting a different Stock OUT.';
    end if;
  end if;

  select c.name into v_customer from public.customers c where c.id=v_order.customer_id;

  perform public.sync_sales_item_status_with_stock(v_item.id);

  select coalesce(sum(qty),0) into v_released
  from public.stock_movements
  where affects_balance=true and movement_type='sale_delivery'
    and reference_type='sales_order_item' and reference_item_id=v_item.id;

  select coalesce(sum(qty),0) into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=v_item.id and lower(status)='cancelled';

  select coalesce(sum(qty),0) into v_arrived
  from public.sales_item_status_quantities
  where sales_order_item_id=v_item.id and lower(status)='arrived';

  v_remaining:=greatest(v_item.qty-v_released-v_cancelled,0);
  if v_remaining<=0 then raise exception 'This Sales item is already fully delivered. No Stock OUT is needed.'; end if;
  if p_qty>v_remaining then raise exception 'Delivery quantity exceeds remaining active quantity. Remaining: %',v_remaining; end if;
  if p_qty>v_arrived then raise exception 'Only Arrived quantity can be delivered. Arrived and ready to release: %',v_arrived; end if;

  perform pg_advisory_xact_lock(hashtextextended(v_item.product_id::text||':'||p_location_id::text,0));
  select coalesce(sum(delta),0) into v_location_qty from (
    select qty as delta from public.stock_movements where product_id=v_item.product_id and affects_balance=true and to_location_id=p_location_id
    union all
    select -qty as delta from public.stock_movements where product_id=v_item.product_id and affects_balance=true and from_location_id=p_location_id
  ) q;
  if v_location_qty<p_qty then raise exception 'Not enough stock at selected location. Available: %',v_location_qty; end if;

  insert into public.stock_movements(
    movement_date,product_id,movement_type,qty,from_location_id,reference_type,reference_id,reference_item_id,
    reference_no,counterparty,note,created_by
  ) values(
    coalesce(p_delivery_date,current_date),v_item.product_id,'sale_delivery',p_qty,p_location_id,'sales_order_item',
    v_order.id,v_item.id,coalesce(nullif(v_order.sales_invoice_no,''),nullif(v_order.invoice_no,''),nullif(v_order.order_no,''),nullif(v_order.sr_no,'')),
    v_customer,nullif(trim(coalesce(p_note,'')),''),auth.uid()
  ) returning id into v_id;

  perform public.sync_sales_item_status_with_stock(v_item.id);
  perform public.refresh_inventory_product_snapshot(v_item.product_id);

  if v_pending.id is not null then
    update public.stock_action_requests
    set status='approved',
        reviewed_by=auth.uid(),
        reviewed_at=now(),
        reviewer_note=coalesce(reviewer_note,'Approved through direct Customer Stock OUT'),
        applied_movement_id=v_id,
        updated_at=now()
    where id=v_pending.id and status='pending';
  end if;

  return v_id;
end;
$function$;

create or replace function public.release_sales_stock_do(
  p_delivery_request_item_id uuid,
  p_qty numeric,
  p_location_id uuid,
  p_delivery_date date default current_date,
  p_note text default null::text
)
returns uuid
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_req public.delivery_requests%rowtype;
  v_req_item public.delivery_request_items%rowtype;
  v_already numeric:=0;
  v_movement uuid;
  v_all_done boolean;
  v_any_done boolean;
  v_pending public.stock_action_requests%rowtype;
  v_pending_sales uuid;
begin
  if not public.can_operate_inventory() then raise exception 'Stock Controller or Admin access required'; end if;
  if public.current_app_role()='stock_controller' then
    raise exception 'DO Stock OUT requires approval. Submit it for approval instead of releasing stock directly.';
  end if;
  if coalesce(p_qty,0)<=0 then raise exception 'Quantity must be greater than zero'; end if;
  if p_location_id is null then raise exception 'Stock location is required'; end if;

  select * into v_req_item
  from public.delivery_request_items
  where id=p_delivery_request_item_id
  for update;
  if not found then raise exception 'DO request item not found'; end if;

  select * into v_req
  from public.delivery_requests
  where id=v_req_item.delivery_request_id
  for update;
  if not found then raise exception 'DO request not found'; end if;
  if v_req.status='cancelled' then raise exception 'DO request is cancelled'; end if;
  if nullif(trim(coalesce(v_req.do_no,'')),'') is null then raise exception 'Assign the DO number before Stock OUT'; end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-approval:sales:'||v_req_item.sales_order_item_id::text,0));

  select r.id into v_pending_sales
  from public.stock_action_requests r
  where r.status='pending'
    and r.action_type='sales_delivery'
    and r.payload->>'sales_order_item_id'=v_req_item.sales_order_item_id::text
  order by r.requested_at
  limit 1
  for update;

  if v_pending_sales is not null then
    raise exception 'A Customer Stock OUT approval is already pending for this Sales item. Review it before using DO Stock OUT.';
  end if;

  select r.* into v_pending
  from public.stock_action_requests r
  where r.status='pending'
    and r.action_type='do_delivery'
    and r.payload->>'delivery_request_item_id'=v_req_item.id::text
  order by r.requested_at
  limit 1
  for update;

  if v_pending.id is not null then
    if nullif(v_pending.payload->>'qty','')::numeric<>p_qty
       or coalesce(v_pending.payload->>'location_id','')<>p_location_id::text then
      raise exception 'A DO Stock OUT approval is already pending for this item. Review it before posting a different Stock OUT.';
    end if;
  end if;

  select coalesce(sum(qty),0)::numeric into v_already
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and delivery_request_item_id=p_delivery_request_item_id;

  if v_already>=v_req_item.requested_qty-0.0001 then
    raise exception 'This DO item is already fully delivered. No Stock OUT is needed.';
  end if;

  if v_already+p_qty>v_req_item.requested_qty+0.0001 then
    raise exception 'Release quantity exceeds DO remaining quantity. Remaining: %',greatest(v_req_item.requested_qty-v_already,0);
  end if;

  perform set_config('app.stock_do_release','1',true);
  v_movement:=public.release_sales_stock(
    v_req_item.sales_order_item_id,
    p_qty,
    p_location_id,
    p_delivery_date,
    p_note
  );
  perform set_config('app.stock_do_release','',true);

  update public.stock_movements
  set delivery_request_id=v_req.id,
      delivery_request_item_id=v_req_item.id,
      delivery_order_no=v_req.do_no
  where id=v_movement;

  select not exists(
    select 1
    from public.delivery_request_items x
    left join lateral (
      select coalesce(sum(m.qty),0)::numeric delivered
      from public.stock_movements m
      where m.affects_balance=true
        and m.movement_type='sale_delivery'
        and m.delivery_request_item_id=x.id
    ) d on true
    where x.delivery_request_id=v_req.id
      and d.delivered+0.0001<x.requested_qty
  ) into v_all_done;

  select exists(
    select 1 from public.stock_movements m
    where m.delivery_request_id=v_req.id
      and m.affects_balance=true
      and m.movement_type='sale_delivery'
  ) into v_any_done;

  update public.delivery_requests
  set status=case when v_all_done then 'delivered' when v_any_done then 'partially_delivered' else 'do_assigned' end,
      updated_at=now()
  where id=v_req.id;

  if v_pending.id is not null then
    update public.stock_action_requests
    set status='approved',
        reviewed_by=auth.uid(),
        reviewed_at=now(),
        reviewer_note=coalesce(reviewer_note,'Approved through direct DO Stock OUT'),
        applied_movement_id=v_movement,
        updated_at=now()
    where id=v_pending.id and status='pending';
  end if;

  return v_movement;
end;
$function$;
