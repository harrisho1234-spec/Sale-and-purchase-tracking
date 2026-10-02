-- Multi-location Customer Stock OUT.
-- Allows one Sales fulfillment release to allocate quantity across several stock locations.
-- Admin/Super Admin can post the allocation atomically; Stock Controller submits one approval request containing all location allocations.

CREATE OR REPLACE FUNCTION public.release_sales_stock_multi_location(p_sales_order_item_id uuid, p_allocations jsonb, p_delivery_date date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_customer text;
  v_released numeric:=0;
  v_cancelled numeric:=0;
  v_remaining numeric:=0;
  v_arrived numeric:=0;
  v_total numeric:=0;
  v_count integer:=0;
  v_location_qty numeric:=0;
  v_first_id uuid;
  v_move_id uuid;
  v_pending_sales uuid;
  v_pending_do uuid;
  v_review_context boolean:=coalesce(current_setting('app.stock_multi_review',true),'')='1';
  a record;
begin
  if not public.can_operate_inventory() then
    raise exception 'Stock Controller or Admin access required';
  end if;
  if public.current_app_role()='stock_controller' then
    raise exception 'Customer Stock OUT requires approval. Submit it for approval instead of releasing stock directly.';
  end if;
  if jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_allocations,'[]'::jsonb))=0 then
    raise exception 'Choose at least one stock location allocation';
  end if;

  create temporary table if not exists pg_temp.sales_release_allocations(
    location_id uuid primary key,
    qty numeric not null
  ) on commit drop;
  truncate pg_temp.sales_release_allocations;

  insert into pg_temp.sales_release_allocations(location_id,qty)
  select nullif(x->>'location_id','')::uuid, sum(nullif(x->>'qty','')::numeric)
  from jsonb_array_elements(p_allocations) x
  group by nullif(x->>'location_id','')::uuid;

  if exists(
    select 1 from pg_temp.sales_release_allocations
    where location_id is null or coalesce(qty,0)<=0 or trunc(qty)<>qty
  ) then
    raise exception 'Every stock allocation needs a valid location and positive whole-number quantity';
  end if;

  select count(*)::int,coalesce(sum(qty),0)::numeric into v_count,v_total
  from pg_temp.sales_release_allocations;
  if v_count=0 or v_total<=0 then raise exception 'Release quantity must be greater than zero'; end if;

  select * into v_item
  from public.sales_order_items
  where id=p_sales_order_item_id
  for update;
  if not found then raise exception 'Sales item not found'; end if;

  select * into v_order
  from public.sales_orders
  where id=v_item.sales_order_id;

  if coalesce(v_item.inventory_tracking_enabled,false)=false then raise exception 'Link this Sales item to Stock first'; end if;
  if coalesce(v_order.status,'')='cancelled' or coalesce(v_item.fulfillment_status,'')='cancelled' then raise exception 'Cancelled item cannot be released'; end if;
  if v_item.product_id is null then raise exception 'Sales item is not linked to a Product'; end if;
  if v_item.source_type<>'stock' then raise exception 'Only stock-source Sales items can be released from inventory'; end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-approval:sales:'||v_item.id::text,0));

  if not v_review_context then
    select r.id into v_pending_sales
    from public.stock_action_requests r
    where r.status='pending'
      and r.action_type='sales_delivery'
      and r.payload->>'sales_order_item_id'=v_item.id::text
    order by r.requested_at
    limit 1
    for update;

    if v_pending_sales is not null then
      raise exception 'A Customer Stock OUT approval is already pending for this item. Review it before posting a new Stock OUT.';
    end if;

    select r.id into v_pending_do
    from public.stock_action_requests r
    where r.status='pending'
      and r.action_type='do_delivery'
      and exists(
        select 1 from public.delivery_request_items dri
        where dri.id=nullif(r.payload->>'delivery_request_item_id','')::uuid
          and dri.sales_order_item_id=v_item.id
      )
    order by r.requested_at
    limit 1
    for update;

    if v_pending_do is not null then
      raise exception 'A DO Stock OUT approval is already pending for this Sales item. Review it before Customer Stock OUT.';
    end if;
  end if;

  perform public.sync_sales_item_status_with_stock(v_item.id);

  select coalesce(sum(qty),0) into v_released
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=v_item.id;

  v_released:=v_released+public.historical_customer_delivery_qty(v_item.id);

  select coalesce(sum(qty),0) into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=v_item.id and lower(status)='cancelled';

  select coalesce(sum(qty),0) into v_arrived
  from public.sales_item_status_quantities
  where sales_order_item_id=v_item.id and lower(status)='arrived';

  v_remaining:=greatest(v_item.qty-v_released-v_cancelled,0);
  if v_remaining<=0 then raise exception 'This Sales item is already fully delivered. No Stock OUT is needed.'; end if;
  if v_total>v_remaining then raise exception 'Delivery quantity exceeds remaining active quantity. Remaining: %',v_remaining; end if;
  if v_total>v_arrived then raise exception 'Only Arrived quantity can be delivered. Arrived and ready to release: %',v_arrived; end if;

  for a in
    select x.location_id,x.qty,l.code
    from pg_temp.sales_release_allocations x
    join public.stock_locations l on l.id=x.location_id
    order by l.code,x.location_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_item.product_id::text||':'||a.location_id::text,0));

    select coalesce(sum(delta),0) into v_location_qty
    from (
      select qty as delta
      from public.stock_movements
      where product_id=v_item.product_id and affects_balance=true and to_location_id=a.location_id
      union all
      select -qty as delta
      from public.stock_movements
      where product_id=v_item.product_id and affects_balance=true and from_location_id=a.location_id
    ) q;

    if v_location_qty<a.qty then
      raise exception 'Not enough stock at location %. Available: %, requested: %',a.code,v_location_qty,a.qty;
    end if;
  end loop;

  select c.name into v_customer
  from public.customers c
  where c.id=v_order.customer_id;

  for a in
    select x.location_id,x.qty,l.code
    from pg_temp.sales_release_allocations x
    join public.stock_locations l on l.id=x.location_id
    order by l.code,x.location_id
  loop
    insert into public.stock_movements(
      movement_date,product_id,movement_type,qty,from_location_id,
      reference_type,reference_id,reference_item_id,reference_no,counterparty,note,created_by
    )
    values(
      coalesce(p_delivery_date,current_date),v_item.product_id,'sale_delivery',a.qty,a.location_id,
      'sales_order_item',v_order.id,v_item.id,
      coalesce(nullif(v_order.sales_invoice_no,''),nullif(v_order.invoice_no,''),nullif(v_order.order_no,''),nullif(v_order.sr_no,'')),
      v_customer,
      nullif(trim(concat_ws(' · ',nullif(trim(coalesce(p_note,'')),''),'Multi-location OUT: '||a.code||' × '||a.qty::text)),''),
      auth.uid()
    )
    returning id into v_move_id;

    if v_first_id is null then v_first_id:=v_move_id; end if;
  end loop;

  perform public.sync_sales_item_status_with_stock(v_item.id);
  perform public.refresh_inventory_product_snapshot(v_item.product_id);

  return v_first_id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.review_stock_action_request(p_request_id uuid, p_approve boolean, p_reviewer_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  r public.stock_action_requests%rowtype;
  p jsonb;
  v_movement uuid;
begin
  if not public.can_admin_inventory() then
    raise exception 'Admin or Super Admin access required';
  end if;

  select * into r
  from public.stock_action_requests
  where id=p_request_id
  for update;

  if not found then raise exception 'Stock action request not found'; end if;
  if r.status<>'pending' then raise exception 'This stock action request has already been reviewed'; end if;

  if not coalesce(p_approve,false) then
    update public.stock_action_requests
    set status='rejected',
        reviewed_by=auth.uid(),
        reviewed_at=now(),
        reviewer_note=nullif(trim(coalesce(p_reviewer_note,'')),''),
        updated_at=now()
    where id=p_request_id;
    return null;
  end if;

  p:=coalesce(r.payload,'{}'::jsonb);

  if r.action_type='manual_movement' then
    v_movement:=public.create_stock_movement(
      nullif(p->>'product_id','')::uuid,
      p->>'movement_type',
      nullif(p->>'qty','')::numeric,
      nullif(p->>'from_location_id','')::uuid,
      nullif(p->>'to_location_id','')::uuid,
      coalesce(nullif(p->>'movement_date','')::date,current_date),
      nullif(p->>'reference_type',''),
      nullif(p->>'reference_id','')::uuid,
      nullif(p->>'reference_item_id','')::uuid,
      nullif(p->>'reference_no',''),
      nullif(p->>'counterparty',''),
      nullif(p->>'note','')
    );
  elsif r.action_type='sales_delivery' then
    if jsonb_typeof(p->'allocations')='array' and jsonb_array_length(p->'allocations')>0 then
      perform set_config('app.stock_multi_review','1',true);
      v_movement:=public.release_sales_stock_multi_location(
        nullif(p->>'sales_order_item_id','')::uuid,
        p->'allocations',
        coalesce(nullif(p->>'delivery_date','')::date,current_date),
        nullif(p->>'note','')
      );
      perform set_config('app.stock_multi_review','',true);
    else
      v_movement:=public.release_sales_stock(
        nullif(p->>'sales_order_item_id','')::uuid,
        nullif(p->>'qty','')::numeric,
        nullif(p->>'location_id','')::uuid,
        coalesce(nullif(p->>'delivery_date','')::date,current_date),
        nullif(p->>'note','')
      );
    end if;
  elsif r.action_type='do_delivery' then
    v_movement:=public.release_sales_stock_do(
      nullif(p->>'delivery_request_item_id','')::uuid,
      nullif(p->>'qty','')::numeric,
      nullif(p->>'location_id','')::uuid,
      coalesce(nullif(p->>'delivery_date','')::date,current_date),
      nullif(p->>'note','')
    );
  else
    raise exception 'Unsupported stock action request';
  end if;

  update public.stock_action_requests
  set status='approved',
      reviewed_by=auth.uid(),
      reviewed_at=now(),
      reviewer_note=nullif(trim(coalesce(p_reviewer_note,'')),''),
      applied_movement_id=v_movement,
      updated_at=now()
  where id=p_request_id;

  return v_movement;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.submit_sales_stock_multi_location_request(p_sales_order_item_id uuid, p_allocations jsonb, p_delivery_date date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_total numeric:=0;
  v_count integer:=0;
  v_released numeric:=0;
  v_cancelled numeric:=0;
  v_remaining numeric:=0;
  v_arrived numeric:=0;
  v_location_qty numeric:=0;
  v_pending public.stock_action_requests%rowtype;
  v_id uuid;
  v_canonical jsonb;
  a record;
begin
  if public.current_app_role()<>'stock_controller' then
    raise exception 'Stock Controller access required for stock action requests';
  end if;
  if jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array'
     or jsonb_array_length(coalesce(p_allocations,'[]'::jsonb))=0 then
    raise exception 'Choose at least one stock location allocation';
  end if;

  create temporary table if not exists pg_temp.sales_release_request_allocations(
    location_id uuid primary key,
    qty numeric not null
  ) on commit drop;
  truncate pg_temp.sales_release_request_allocations;

  insert into pg_temp.sales_release_request_allocations(location_id,qty)
  select nullif(x->>'location_id','')::uuid, sum(nullif(x->>'qty','')::numeric)
  from jsonb_array_elements(p_allocations) x
  group by nullif(x->>'location_id','')::uuid;

  if exists(
    select 1 from pg_temp.sales_release_request_allocations
    where location_id is null or coalesce(qty,0)<=0 or trunc(qty)<>qty
  ) then
    raise exception 'Every stock allocation needs a valid location and positive whole-number quantity';
  end if;

  select count(*)::int,coalesce(sum(qty),0)::numeric into v_count,v_total
  from pg_temp.sales_release_request_allocations;
  if v_count=0 or v_total<=0 then raise exception 'Release quantity must be greater than zero'; end if;

  select coalesce(
    jsonb_agg(
      jsonb_build_object('location_id',x.location_id,'code',l.code,'qty',x.qty)
      order by l.code,x.location_id
    ),
    '[]'::jsonb
  )
  into v_canonical
  from pg_temp.sales_release_request_allocations x
  join public.stock_locations l on l.id=x.location_id;

  select * into v_item
  from public.sales_order_items
  where id=p_sales_order_item_id
  for update;
  if not found then raise exception 'Valid Sales Order item is required'; end if;

  select * into v_order
  from public.sales_orders
  where id=v_item.sales_order_id;

  if coalesce(v_item.inventory_tracking_enabled,false)=false then raise exception 'Link this Sales item to Stock first'; end if;
  if coalesce(v_order.status,'')='cancelled' or coalesce(v_item.fulfillment_status,'')='cancelled' then raise exception 'Cancelled item cannot be released'; end if;
  if v_item.product_id is null then raise exception 'Sales item is not linked to a Product'; end if;
  if v_item.source_type<>'stock' then raise exception 'Only stock-source Sales items can be released from inventory'; end if;

  perform pg_advisory_xact_lock(hashtextextended('stock-approval:sales:'||v_item.id::text,0));
  perform public.sync_sales_item_status_with_stock(v_item.id);

  select coalesce(sum(qty),0) into v_released
  from public.stock_movements
  where affects_balance=true and movement_type='sale_delivery'
    and reference_type='sales_order_item' and reference_item_id=v_item.id;

  v_released:=v_released+public.historical_customer_delivery_qty(v_item.id);

  select coalesce(sum(qty),0) into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=v_item.id and lower(status)='cancelled';

  select coalesce(sum(qty),0) into v_arrived
  from public.sales_item_status_quantities
  where sales_order_item_id=v_item.id and lower(status)='arrived';

  v_remaining:=greatest(v_item.qty-v_released-v_cancelled,0);
  if v_remaining<=0 then raise exception 'This Sales item is already fully delivered. No stock approval is needed.'; end if;
  if v_total>v_remaining then raise exception 'Delivery quantity exceeds remaining active quantity. Remaining: %',v_remaining; end if;
  if v_total>v_arrived then raise exception 'Only Arrived quantity can be submitted for delivery. Arrived and ready: %',v_arrived; end if;

  for a in
    select x.location_id,x.qty,l.code
    from pg_temp.sales_release_request_allocations x
    join public.stock_locations l on l.id=x.location_id
    order by l.code,x.location_id
  loop
    perform pg_advisory_xact_lock(hashtextextended(v_item.product_id::text||':'||a.location_id::text,0));

    select coalesce(sum(delta),0) into v_location_qty
    from (
      select qty as delta from public.stock_movements
      where product_id=v_item.product_id and affects_balance=true and to_location_id=a.location_id
      union all
      select -qty as delta from public.stock_movements
      where product_id=v_item.product_id and affects_balance=true and from_location_id=a.location_id
    ) q;

    if v_location_qty<a.qty then
      raise exception 'Not enough stock at location %. Available: %, requested: %',a.code,v_location_qty,a.qty;
    end if;
  end loop;

  select r.* into v_pending
  from public.stock_action_requests r
  where r.status='pending'
    and (
      (r.action_type='sales_delivery' and r.payload->>'sales_order_item_id'=v_item.id::text)
      or
      (r.action_type='do_delivery' and exists(
        select 1 from public.delivery_request_items dri
        where dri.id=nullif(r.payload->>'delivery_request_item_id','')::uuid
          and dri.sales_order_item_id=v_item.id
      ))
    )
  order by r.requested_at
  limit 1
  for update;

  if v_pending.id is not null then
    if v_pending.action_type='sales_delivery'
       and coalesce(v_pending.payload->'allocations','[]'::jsonb)=v_canonical
       and nullif(v_pending.payload->>'qty','')::numeric=v_total then
      return v_pending.id;
    end if;
    raise exception 'This Sales item already has a Stock OUT approval waiting. Review that request instead of creating another.';
  end if;

  insert into public.stock_action_requests(action_type,payload,reason,requested_by)
  values(
    'sales_delivery',
    jsonb_build_object(
      'sales_order_item_id',v_item.id,
      'qty',v_total,
      'allocations',v_canonical,
      'multi_location',true,
      'delivery_date',coalesce(p_delivery_date,current_date),
      'note',nullif(trim(coalesce(p_note,'')),'')
    ),
    nullif(trim(coalesce(p_note,'')),''),
    auth.uid()
  )
  returning id into v_id;

  return v_id;
end
$function$
;

