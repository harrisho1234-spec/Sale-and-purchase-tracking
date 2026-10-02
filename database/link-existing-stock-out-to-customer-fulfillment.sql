-- Safer Customer Stock OUT reconciliation.
-- Converts an already-posted generic Stock OUT into a Customer Delivery link
-- without deducting stock a second time.

create or replace function public.link_existing_stock_out_to_fulfillment(
  p_movement_id uuid,
  p_sales_order_item_id uuid,
  p_delivery_request_item_id uuid default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_move public.stock_movements%rowtype;
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_customer text;
  v_released numeric:=0;
  v_historical numeric:=0;
  v_cancelled numeric:=0;
  v_remaining numeric:=0;
  v_req_item public.delivery_request_items%rowtype;
  v_req public.delivery_requests%rowtype;
  v_do_delivered numeric:=0;
  v_do_remaining numeric:=0;
  v_all_done boolean:=false;
  v_any_done boolean:=false;
  v_doc_no text;
  v_audit_note text;
begin
  if not public.current_user_has_permission('inventory.reconcile') then
    raise exception 'Inventory reconciliation permission required';
  end if;

  if p_movement_id is null or p_sales_order_item_id is null then
    raise exception 'Stock movement and Sales Order item are required';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('link-stock-out:'||p_movement_id::text,0));
  perform pg_advisory_xact_lock(hashtextextended('stock-approval:sales:'||p_sales_order_item_id::text,0));

  select * into v_move
  from public.stock_movements
  where id=p_movement_id
  for update;

  if not found then raise exception 'Stock movement not found'; end if;
  if coalesce(v_move.affects_balance,false)=false then
    raise exception 'Only a posted stock movement can be linked';
  end if;
  if v_move.movement_type<>'out' then
    raise exception 'Only a generic Stock OUT can be linked to Customer Fulfillment';
  end if;
  if v_move.reference_item_id is not null or v_move.delivery_request_item_id is not null then
    raise exception 'This Stock OUT is already linked to a fulfillment record';
  end if;
  if coalesce(v_move.qty,0)<=0 then
    raise exception 'Stock OUT quantity is invalid';
  end if;

  select * into v_item
  from public.sales_order_items
  where id=p_sales_order_item_id
  for update;

  if not found then raise exception 'Sales Order item not found'; end if;

  select * into v_order
  from public.sales_orders
  where id=v_item.sales_order_id
  for update;

  if not found then raise exception 'Sales Order not found'; end if;
  if coalesce(v_order.status,'')='cancelled' or coalesce(v_item.fulfillment_status,'')='cancelled' then
    raise exception 'Cancelled Sales items cannot be linked';
  end if;
  if v_item.product_id is null or v_item.product_id<>v_move.product_id then
    raise exception 'The Stock OUT product does not match the selected Sales Order item';
  end if;
  if coalesce(v_item.line_kind,'product')<>'product' or v_item.source_type<>'stock' then
    raise exception 'Only stock product lines can be linked to a Stock OUT';
  end if;

  select coalesce(sum(qty),0)::numeric into v_released
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=v_item.id;

  select public.historical_customer_delivery_qty(v_item.id) into v_historical;

  select coalesce(sum(qty),0)::numeric into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=v_item.id
    and lower(status)='cancelled';

  v_remaining:=greatest(v_item.qty-v_released-v_historical-v_cancelled,0);

  if v_remaining<=0 then
    raise exception 'This Sales item is already fully delivered / reconciled';
  end if;
  if v_move.qty>v_remaining then
    raise exception 'Stock OUT quantity (%) exceeds the remaining Customer Fulfillment quantity (%)',v_move.qty,v_remaining;
  end if;

  if p_delivery_request_item_id is not null then
    select * into v_req_item
    from public.delivery_request_items
    where id=p_delivery_request_item_id
    for update;

    if not found then raise exception 'Delivery Order request item not found'; end if;
    if v_req_item.sales_order_item_id<>v_item.id then
      raise exception 'Selected Delivery Order item does not belong to the selected Sales Order item';
    end if;

    select * into v_req
    from public.delivery_requests
    where id=v_req_item.delivery_request_id
    for update;

    if not found then raise exception 'Delivery Order request not found'; end if;
    if v_req.status='cancelled' then raise exception 'Delivery Order request is cancelled'; end if;
    if nullif(trim(coalesce(v_req.do_no,'')),'') is null then
      raise exception 'Assign the official DO number before linking this Stock OUT';
    end if;

    select coalesce(sum(qty),0)::numeric into v_do_delivered
    from public.stock_movements
    where affects_balance=true
      and movement_type='sale_delivery'
      and delivery_request_item_id=v_req_item.id;

    v_do_remaining:=greatest(v_req_item.requested_qty-v_do_delivered,0);
    if v_move.qty>v_do_remaining then
      raise exception 'Stock OUT quantity (%) exceeds the remaining DO quantity (%)',v_move.qty,v_do_remaining;
    end if;
  end if;

  select c.name into v_customer
  from public.customers c
  where c.id=v_order.customer_id;

  v_doc_no:=coalesce(
    nullif(v_order.sales_invoice_no,''),
    nullif(v_order.invoice_no,''),
    nullif(v_order.order_no,''),
    nullif(v_order.sr_no,''),
    'Sales Order'
  );

  v_audit_note:=nullif(trim(concat_ws(
    ' · ',
    nullif(trim(coalesce(v_move.note,'')),''),
    'Linked from existing Stock OUT to Customer Fulfillment; no second stock deduction',
    case when nullif(trim(coalesce(v_move.reference_no,'')),'') is not null
      then 'Former reference: '||trim(v_move.reference_no) end,
    nullif(trim(coalesce(p_note,'')),'')
  )),'');

  update public.sales_order_items
  set inventory_tracking_enabled=true,
      updated_at=now()
  where id=v_item.id;

  update public.stock_movements
  set movement_type='sale_delivery',
      reference_type='sales_order_item',
      reference_id=v_order.id,
      reference_item_id=v_item.id,
      reference_no=v_doc_no,
      counterparty=v_customer,
      note=v_audit_note,
      delivery_request_id=case when p_delivery_request_item_id is not null then v_req.id else null end,
      delivery_request_item_id=p_delivery_request_item_id,
      delivery_order_no=case when p_delivery_request_item_id is not null then v_req.do_no else null end
  where id=v_move.id;

  perform public.sync_sales_item_status_with_stock(v_item.id);
  perform public.refresh_inventory_product_snapshot(v_item.product_id);

  if p_delivery_request_item_id is not null then
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
      select 1
      from public.stock_movements m
      where m.delivery_request_id=v_req.id
        and m.affects_balance=true
        and m.movement_type='sale_delivery'
    ) into v_any_done;

    update public.delivery_requests
    set status=case
        when v_all_done then 'delivered'
        when v_any_done then 'partially_delivered'
        when nullif(trim(coalesce(do_no,'')),'') is not null then 'do_assigned'
        else status
      end,
      updated_at=now()
    where id=v_req.id;
  end if;

  return v_move.id;
end;
$function$;

grant execute on function public.link_existing_stock_out_to_fulfillment(uuid,uuid,uuid,text) to authenticated;
