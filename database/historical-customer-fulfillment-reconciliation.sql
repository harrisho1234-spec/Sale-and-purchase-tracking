-- Historical Customer Fulfillment reconciliation
-- For Sales items delivered before the live Stock OUT workflow existed.
-- Reconciliation updates fulfillment status/reserved quantity but NEVER posts or deducts stock.

create table if not exists public.customer_fulfillment_reconciliations (
  id uuid primary key default gen_random_uuid(),
  sales_order_item_id uuid not null references public.sales_order_items(id) on delete cascade,
  qty numeric not null check (qty>0 and qty=trunc(qty)),
  delivery_date date not null,
  stock_location_id uuid null references public.stock_locations(id) on delete restrict,
  note text null check (note is null or length(note)<=2000),
  reconciled_by uuid null references public.app_users(user_id) on delete set null,
  reconciled_at timestamptz not null default now(),
  voided_at timestamptz null,
  voided_by uuid null references public.app_users(user_id) on delete set null,
  void_reason text null
);

create index if not exists idx_customer_fulfillment_recon_item
on public.customer_fulfillment_reconciliations(sales_order_item_id)
where voided_at is null;

alter table public.customer_fulfillment_reconciliations enable row level security;

drop policy if exists customer_fulfillment_reconciliations_read on public.customer_fulfillment_reconciliations;
create policy customer_fulfillment_reconciliations_read
on public.customer_fulfillment_reconciliations
for select to authenticated
using (public.can_view_inventory());


CREATE OR REPLACE FUNCTION public.historical_customer_delivery_qty(p_sales_order_item_id uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  select coalesce(sum(qty),0)::numeric
  from public.customer_fulfillment_reconciliations
  where sales_order_item_id=p_sales_order_item_id
    and voided_at is null
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_historical_customer_delivery(p_sales_order_item_id uuid, p_qty numeric, p_delivery_date date DEFAULT CURRENT_DATE, p_stock_location_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text:=coalesce(public.current_app_role(),'');
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_actual numeric:=0;
  v_hist numeric:=0;
  v_cancelled numeric:=0;
  v_remaining numeric:=0;
  v_id uuid;
  v_ordered numeric:=0;
  v_production numeric:=0;
  v_shipping numeric:=0;
  v_arrived numeric:=0;
  v_delivered numeric:=0;
  v_active numeric:=0;
  v_nonterm numeric:=0;
  v_excess numeric:=0;
  v_deficit numeric:=0;
  v_take numeric:=0;
  v_count integer:=0;
  v_fallback text;
  v_aggregate text;
begin
  if v_role not in ('admin','super_admin') then
    raise exception 'Admin or Super Admin access required';
  end if;
  if p_qty is null or p_qty<=0 or p_qty<>trunc(p_qty) then
    raise exception 'Historical delivery quantity must be a positive whole number';
  end if;
  if coalesce(p_delivery_date,current_date)>current_date then
    raise exception 'Historical delivery date cannot be in the future';
  end if;
  if length(nullif(trim(coalesce(p_note,'')),''))>2000 then
    raise exception 'Historical reconciliation note must be at most 2000 characters';
  end if;
  if p_stock_location_id is not null and not exists(select 1 from public.stock_locations where id=p_stock_location_id) then
    raise exception 'Selected stock location was not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('historical-fulfillment:'||p_sales_order_item_id::text,0));

  select * into v_item from public.sales_order_items where id=p_sales_order_item_id for update;
  if not found then raise exception 'Sales item not found'; end if;
  select * into v_order from public.sales_orders where id=v_item.sales_order_id;

  if v_item.product_id is null or coalesce(v_item.line_kind,'product')<>'product' or v_item.source_type<>'stock' then
    raise exception 'Historical reconciliation is available only for stock product lines';
  end if;
  if coalesce(v_order.status,'')='cancelled' or coalesce(v_item.fulfillment_status,'')='cancelled' then
    raise exception 'Cancelled items cannot be reconciled as historical delivery';
  end if;

  select coalesce(sum(qty),0)::numeric into v_actual
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=p_sales_order_item_id;

  select public.historical_customer_delivery_qty(p_sales_order_item_id) into v_hist;

  select coalesce(sum(qty),0)::numeric into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id and lower(status)='cancelled';

  v_cancelled:=least(greatest(v_cancelled,0),v_item.qty);
  v_remaining:=greatest(v_item.qty-v_actual-v_hist-v_cancelled,0);

  if v_remaining<=0 then raise exception 'This item is already fully delivered / reconciled'; end if;
  if p_qty>v_remaining then raise exception 'Historical quantity exceeds remaining quantity. Remaining: %',v_remaining; end if;

  insert into public.customer_fulfillment_reconciliations(
    sales_order_item_id,qty,delivery_date,stock_location_id,note,reconciled_by,reconciled_at
  )
  values(
    p_sales_order_item_id,p_qty,coalesce(p_delivery_date,current_date),p_stock_location_id,
    nullif(trim(coalesce(p_note,'')),''),auth.uid(),now()
  )
  returning id into v_id;

  select
    count(*)::int,
    coalesce(sum(qty) filter (where lower(status) in ('ordered','pending','reserved')),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='production'),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='shipping'),0)::numeric,
    coalesce(sum(qty) filter (where lower(status) in ('arrived','ready')),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='cancelled'),0)::numeric
  into v_count,v_ordered,v_production,v_shipping,v_arrived,v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id;

  v_fallback:=case lower(coalesce(v_item.fulfillment_status,'ordered'))
    when 'pending' then 'ordered'
    when 'reserved' then 'ordered'
    when 'ready' then 'arrived'
    when 'installed' then 'delivered'
    else lower(coalesce(v_item.fulfillment_status,'ordered'))
  end;

  if v_count=0 then
    v_ordered:=0;v_production:=0;v_shipping:=0;v_arrived:=0;v_cancelled:=0;
    if v_fallback='ordered' then v_ordered:=v_item.qty;
    elsif v_fallback='production' then v_production:=v_item.qty;
    elsif v_fallback='shipping' then v_shipping:=v_item.qty;
    elsif v_fallback='arrived' then v_arrived:=v_item.qty;
    end if;
  end if;

  v_cancelled:=least(greatest(v_cancelled,0),v_item.qty);
  v_hist:=v_hist+p_qty;
  v_delivered:=least(greatest(v_actual+v_hist,0),greatest(v_item.qty-v_cancelled,0));
  v_active:=greatest(v_item.qty-v_cancelled-v_delivered,0);
  v_nonterm:=greatest(v_ordered,0)+greatest(v_production,0)+greatest(v_shipping,0)+greatest(v_arrived,0);

  if v_nonterm>v_active then
    v_excess:=v_nonterm-v_active;
    v_take:=least(v_arrived,v_excess);v_arrived:=v_arrived-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_shipping,v_excess);v_shipping:=v_shipping-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_production,v_excess);v_production:=v_production-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_ordered,v_excess);v_ordered:=v_ordered-v_take;v_excess:=v_excess-v_take;
  elsif v_nonterm<v_active then
    v_deficit:=v_active-v_nonterm;
    if v_fallback='ordered' then v_ordered:=v_ordered+v_deficit;
    elsif v_fallback='production' then v_production:=v_production+v_deficit;
    elsif v_fallback='shipping' then v_shipping:=v_shipping+v_deficit;
    else v_arrived:=v_arrived+v_deficit;
    end if;
  end if;

  delete from public.sales_item_status_quantities where sales_order_item_id=p_sales_order_item_id;

  insert into public.sales_item_status_quantities(sales_order_item_id,status,qty,updated_by,updated_at)
  select p_sales_order_item_id,s.status,s.qty,auth.uid(),now()
  from (values
    ('ordered'::text,v_ordered),
    ('production'::text,v_production),
    ('shipping'::text,v_shipping),
    ('arrived'::text,v_arrived),
    ('delivered'::text,v_delivered),
    ('cancelled'::text,v_cancelled)
  ) s(status,qty)
  where s.qty>0;

  v_aggregate:=case
    when v_ordered>0 then 'ordered'
    when v_production>0 then 'production'
    when v_shipping>0 then 'shipping'
    when v_arrived>0 then 'arrived'
    when v_delivered>0 then 'delivered'
    else 'cancelled'
  end;

  update public.sales_order_items set fulfillment_status=v_aggregate,updated_at=now()
  where id=p_sales_order_item_id;

  insert into public.item_tracking(sales_order_item_id,status,updated_by,updated_at,delivered_at)
  values(
    p_sales_order_item_id,v_aggregate,auth.uid(),now(),
    case when v_aggregate='delivered' then coalesce(p_delivery_date,current_date)::timestamp else null end
  )
  on conflict (sales_order_item_id) do update
  set status=excluded.status,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at,
      delivered_at=case
        when excluded.status='delivered' then coalesce(public.item_tracking.delivered_at,excluded.delivered_at)
        else null
      end;

  perform public.refresh_inventory_product_snapshot(v_item.product_id);
  return v_id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_historical_customer_delivery_history(p_search text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare v_result jsonb;
begin
  if coalesce(public.current_app_role(),'') not in ('admin','super_admin') then
    raise exception 'Admin or Super Admin access required';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,
    'sales_order_item_id',r.sales_order_item_id,
    'qty',r.qty,
    'delivery_date',r.delivery_date,
    'note',r.note,
    'reconciled_at',r.reconciled_at,
    'document_no',coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),'Sales Order'),
    'customer_name',c.name,
    'product_code',coalesce(pc.code,i.product_code_snapshot),
    'item_name',coalesce(pc.item_name,i.item_name_snapshot),
    'image_url',coalesce(pc.image_url,i.image_url_snapshot),
    'location_code',l.code,
    'reconciled_by_name',coalesce(nullif(au.display_name,''),au.email)
  ) order by r.reconciled_at desc),'[]'::jsonb)
  into v_result
  from public.customer_fulfillment_reconciliations r
  join public.sales_order_items i on i.id=r.sales_order_item_id
  join public.sales_orders o on o.id=i.sales_order_id
  join public.customers c on c.id=o.customer_id
  left join public.product_catalog pc on pc.id=i.product_id
  left join public.stock_locations l on l.id=r.stock_location_id
  left join public.app_users au on au.user_id=r.reconciled_by
  where r.voided_at is null
    and (
      nullif(trim(coalesce(p_search,'')),'') is null
      or lower(c.name) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(o.sales_invoice_no,o.invoice_no,o.order_no,o.sr_no,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(pc.code,i.product_code_snapshot,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(pc.item_name,i.item_name_snapshot,'')) like '%'||lower(trim(p_search))||'%'
    );

  return v_result;
end
$function$
;

CREATE OR REPLACE FUNCTION public.sync_sales_item_status_with_stock(p_sales_order_item_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_item public.sales_order_items%rowtype;
  v_released numeric:=0;
  v_ordered numeric:=0;
  v_production numeric:=0;
  v_shipping numeric:=0;
  v_arrived numeric:=0;
  v_cancelled numeric:=0;
  v_delivered numeric:=0;
  v_active numeric:=0;
  v_nonterm numeric:=0;
  v_excess numeric:=0;
  v_deficit numeric:=0;
  v_take numeric:=0;
  v_count integer:=0;
  v_fallback text;
  v_aggregate text;
begin
  select * into v_item
  from public.sales_order_items
  where id=p_sales_order_item_id
  for update;

  if not found or coalesce(v_item.inventory_tracking_enabled,false)=false or v_item.source_type<>'stock' then
    return;
  end if;

  select coalesce(sum(qty),0)::numeric into v_released
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=p_sales_order_item_id;

  v_released:=v_released+public.historical_customer_delivery_qty(p_sales_order_item_id);

  select
    count(*)::int,
    coalesce(sum(qty) filter (where lower(status) in ('ordered','pending','reserved')),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='production'),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='shipping'),0)::numeric,
    coalesce(sum(qty) filter (where lower(status) in ('arrived','ready')),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='cancelled'),0)::numeric
  into v_count,v_ordered,v_production,v_shipping,v_arrived,v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id;

  v_fallback:=case lower(coalesce(v_item.fulfillment_status,'ordered'))
    when 'pending' then 'ordered'
    when 'reserved' then 'ordered'
    when 'ready' then 'arrived'
    when 'installed' then 'delivered'
    else lower(coalesce(v_item.fulfillment_status,'ordered'))
  end;

  if v_count=0 then
    v_ordered:=0;v_production:=0;v_shipping:=0;v_arrived:=0;v_cancelled:=0;
    if v_fallback='cancelled' then v_cancelled:=v_item.qty;
    elsif v_fallback='ordered' then v_ordered:=v_item.qty;
    elsif v_fallback='production' then v_production:=v_item.qty;
    elsif v_fallback='shipping' then v_shipping:=v_item.qty;
    else v_arrived:=v_item.qty;
    end if;
  end if;

  v_cancelled:=least(greatest(v_cancelled,0),v_item.qty);
  v_delivered:=least(greatest(v_released,0),greatest(v_item.qty-v_cancelled,0));
  v_active:=greatest(v_item.qty-v_cancelled-v_delivered,0);
  v_nonterm:=greatest(v_ordered,0)+greatest(v_production,0)+greatest(v_shipping,0)+greatest(v_arrived,0);

  if v_nonterm>v_active then
    v_excess:=v_nonterm-v_active;
    v_take:=least(v_arrived,v_excess);v_arrived:=v_arrived-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_shipping,v_excess);v_shipping:=v_shipping-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_production,v_excess);v_production:=v_production-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_ordered,v_excess);v_ordered:=v_ordered-v_take;v_excess:=v_excess-v_take;
  elsif v_nonterm<v_active then
    v_deficit:=v_active-v_nonterm;
    if v_fallback='ordered' then v_ordered:=v_ordered+v_deficit;
    elsif v_fallback='production' then v_production:=v_production+v_deficit;
    elsif v_fallback='shipping' then v_shipping:=v_shipping+v_deficit;
    else v_arrived:=v_arrived+v_deficit;
    end if;
  end if;

  delete from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id;

  insert into public.sales_item_status_quantities(sales_order_item_id,status,qty,updated_by,updated_at)
  select p_sales_order_item_id,s.status,s.qty,auth.uid(),now()
  from (values
    ('ordered'::text,v_ordered),
    ('production'::text,v_production),
    ('shipping'::text,v_shipping),
    ('arrived'::text,v_arrived),
    ('delivered'::text,v_delivered),
    ('cancelled'::text,v_cancelled)
  ) s(status,qty)
  where s.qty>0;

  v_aggregate:=case
    when v_ordered>0 then 'ordered'
    when v_production>0 then 'production'
    when v_shipping>0 then 'shipping'
    when v_arrived>0 then 'arrived'
    when v_delivered>0 then 'delivered'
    else 'cancelled'
  end;

  update public.sales_order_items
  set fulfillment_status=v_aggregate,updated_at=now()
  where id=p_sales_order_item_id;

  insert into public.item_tracking(sales_order_item_id,status,updated_by,updated_at,delivered_at)
  values(
    p_sales_order_item_id,v_aggregate,auth.uid(),now(),
    case when v_aggregate='delivered' then now() else null end
  )
  on conflict (sales_order_item_id) do update
  set status=excluded.status,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at,
      delivered_at=case
        when excluded.status='delivered' then coalesce(public.item_tracking.delivered_at,excluded.delivered_at)
        else null
      end;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.save_inventory_item_status_quantities(p_sales_order_item_id uuid, p_allocations jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_alloc jsonb;
  v_status text;
  v_qty numeric;
  v_total numeric:=0;
  v_released numeric:=0;
  v_cancelled numeric:=0;
  v_delivered numeric:=0;
  v_required numeric:=0;
  v_aggregate text;
begin
  if not public.can_operate_inventory() then
    raise exception 'Stock Controller or Admin access required';
  end if;

  select * into v_item from public.sales_order_items where id=p_sales_order_item_id for update;
  if not found then raise exception 'Sales item not found'; end if;
  select * into v_order from public.sales_orders where id=v_item.sales_order_id;

  if coalesce(v_item.inventory_tracking_enabled,false)=false then
    raise exception 'Link this Sales item to Stock first';
  end if;
  if v_item.product_id is null or v_item.source_type<>'stock' or coalesce(v_item.line_kind,'product')<>'product' then
    raise exception 'This is not a tracked stock product line';
  end if;
  if coalesce(v_order.status,'')='cancelled' or coalesce(v_item.fulfillment_status,'')='cancelled' then
    raise exception 'Cancelled items cannot be updated from Stock';
  end if;
  if jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' then
    raise exception 'Invalid status payload';
  end if;

  select coalesce(sum(qty),0)::numeric into v_released
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=p_sales_order_item_id;

  v_released:=v_released+public.historical_customer_delivery_qty(p_sales_order_item_id);

  select coalesce(sum(qty),0)::numeric into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id
    and lower(status)='cancelled';

  v_cancelled:=least(greatest(v_cancelled,0),v_item.qty);
  v_delivered:=least(greatest(v_released,0),greatest(v_item.qty-v_cancelled,0));
  v_required:=greatest(v_item.qty-v_cancelled-v_delivered,0);

  for v_alloc in select value from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb))
  loop
    v_status:=case lower(trim(coalesce(v_alloc->>'status','')))
      when 'pending' then 'ordered'
      when 'reserved' then 'ordered'
      when 'ready' then 'arrived'
      else lower(trim(coalesce(v_alloc->>'status','')))
    end;
    v_qty:=nullif(v_alloc->>'qty','')::numeric;
    if v_status not in ('ordered','production','shipping','arrived') then
      raise exception 'Stock can update only Ordered, Production, Shipping or Arrived. Delivered is controlled by Stock OUT.';
    end if;
    if v_qty is null or v_qty<0 then raise exception 'Status quantity cannot be negative'; end if;
    v_total:=v_total+v_qty;
  end loop;

  if abs(v_total-v_required)>0.0001 then
    raise exception 'Status quantities (%) must equal the undelivered active quantity (%)',v_total,v_required;
  end if;

  delete from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id;

  if v_cancelled>0 then
    insert into public.sales_item_status_quantities(sales_order_item_id,status,qty,updated_by,updated_at)
    values(p_sales_order_item_id,'cancelled',v_cancelled,auth.uid(),now());
  end if;

  if v_delivered>0 then
    insert into public.sales_item_status_quantities(sales_order_item_id,status,qty,updated_by,updated_at)
    values(p_sales_order_item_id,'delivered',v_delivered,auth.uid(),now());
  end if;

  insert into public.sales_item_status_quantities(sales_order_item_id,status,qty,updated_by,updated_at)
  select p_sales_order_item_id,
         case lower(trim(a.value->>'status'))
           when 'pending' then 'ordered'
           when 'reserved' then 'ordered'
           when 'ready' then 'arrived'
           else lower(trim(a.value->>'status'))
         end,
         sum((a.value->>'qty')::numeric),
         auth.uid(),now()
  from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) a
  where coalesce((a.value->>'qty')::numeric,0)>0
  group by 2;

  select s.status into v_aggregate
  from public.sales_item_status_quantities s
  where s.sales_order_item_id=p_sales_order_item_id
    and s.qty>0
    and s.status<>'cancelled'
  order by case s.status
    when 'ordered' then 1
    when 'production' then 2
    when 'shipping' then 3
    when 'arrived' then 4
    when 'delivered' then 5
    else 99 end
  limit 1;

  if v_aggregate is null then v_aggregate:='cancelled'; end if;

  update public.sales_order_items
  set fulfillment_status=v_aggregate,updated_at=now()
  where id=p_sales_order_item_id;

  insert into public.item_tracking(sales_order_item_id,status,updated_by,updated_at,delivered_at)
  values(
    p_sales_order_item_id,v_aggregate,auth.uid(),now(),
    case when v_aggregate='delivered' then now() else null end
  )
  on conflict (sales_order_item_id) do update
  set status=excluded.status,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at,
      delivered_at=case
        when excluded.status='delivered' then coalesce(public.item_tracking.delivered_at,excluded.delivered_at)
        else null
      end;

  perform public.refresh_inventory_product_snapshot(v_item.product_id);
end;
$function$
;

CREATE OR REPLACE FUNCTION public.release_sales_stock(p_sales_order_item_id uuid, p_qty numeric, p_location_id uuid, p_delivery_date date DEFAULT CURRENT_DATE, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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

  v_released:=v_released+public.historical_customer_delivery_qty(v_item.id);

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
$function$
;

CREATE OR REPLACE FUNCTION public.submit_stock_action_request(p_action_type text, p_payload jsonb, p_reason text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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

    v_released:=v_released+public.historical_customer_delivery_qty(v_item);

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

    v_released:=v_released+public.historical_customer_delivery_qty(v_sales_item.id);

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
$function$
;

CREATE OR REPLACE FUNCTION public.inventory_reserved_totals()
 RETURNS TABLE(product_id uuid, reserved numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  with released as (
    select reference_item_id sales_order_item_id,sum(qty)::numeric qty
    from public.stock_movements
    where affects_balance=true
      and movement_type='sale_delivery'
      and reference_type='sales_order_item'
      and reference_item_id is not null
    group by reference_item_id
  ),
  cancelled as (
    select sales_order_item_id,sum(qty)::numeric qty
    from public.sales_item_status_quantities
    where lower(status)='cancelled'
    group by sales_order_item_id
  ),
  historical as (
    select sales_order_item_id,sum(qty)::numeric qty
    from public.customer_fulfillment_reconciliations
    where voided_at is null
    group by sales_order_item_id
  )
  select
    i.product_id,
    sum(greatest(i.qty-coalesce(r.qty,0)-coalesce(h.qty,0)-coalesce(c.qty,0),0))::numeric
  from public.sales_order_items i
  join public.sales_orders o on o.id=i.sales_order_id
  left join released r on r.sales_order_item_id=i.id
  left join cancelled c on c.sales_order_item_id=i.id
  left join historical h on h.sales_order_item_id=i.id
  where public.can_view_inventory()
    and i.inventory_tracking_enabled=true
    and i.product_id is not null
    and i.line_kind='product'
    and i.source_type='stock'
    and coalesce(i.fulfillment_status,'')<>'cancelled'
    and coalesce(o.status,'')<>'cancelled'
  group by i.product_id;
$function$
;

drop function if exists public.get_inventory_fulfillment_queue(text);

CREATE OR REPLACE FUNCTION public.get_inventory_fulfillment_queue(p_search text DEFAULT NULL::text)
 RETURNS TABLE(sales_order_item_id uuid, sales_order_id uuid, document_no text, customer_name text, sales_rep_name text, order_date date, product_id uuid, product_code text, item_name text, image_url text, ordered_qty numeric, released_qty numeric, historical_qty numeric, delivered_qty numeric, remaining_qty numeric, inventory_tracking_enabled boolean, item_status text, status_breakdown jsonb)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
  where public.can_view_inventory()
    and i.product_id is not null
    and coalesce(i.line_kind,'product')='product'
    and i.source_type='stock'
    and coalesce(i.fulfillment_status,'')<>'cancelled'
    and coalesce(o.status,'')<>'cancelled'
    and lower(coalesce(i.fulfillment_status,'')) not in ('delivered','installed')
    and greatest(i.qty-coalesce(r.released,0)-coalesce(h.historical,0)-coalesce(st.cancelled_qty,0),0)>0
    and (
      nullif(trim(coalesce(p_search,'')),'') is null
      or lower(c.name) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(o.sales_invoice_no,o.invoice_no,o.order_no,o.sr_no,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(pc.code,i.product_code_snapshot,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(pc.item_name,i.item_name_snapshot,'')) like '%'||lower(trim(p_search))||'%'
      or lower(coalesce(i.fulfillment_status,'')) like '%'||lower(trim(p_search))||'%'
    )
  order by coalesce(i.inventory_tracking_enabled,false) desc,o.order_date desc,o.created_at desc,i.line_position nulls last,i.created_at;
$function$
;
