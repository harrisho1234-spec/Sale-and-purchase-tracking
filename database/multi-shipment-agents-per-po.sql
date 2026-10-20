
-- Multiple shipping agents and shipments per supplier PO.
-- No legacy PO/item costs, status, stock movement, or receipt logic is overwritten.
create table if not exists public.shipping_agents (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  contact_person text,
  phone text,
  email text,
  telegram text,
  origin_country text,
  notes text,
  active boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists shipping_agents_name_ci_idx
  on public.shipping_agents (lower(btrim(name)));

create table if not exists public.supplier_po_shipments (
  id uuid primary key default gen_random_uuid(),
  supplier_po_id uuid not null references public.supplier_pos(id) on delete cascade,
  shipping_agent_id uuid not null references public.shipping_agents(id) on delete restrict,
  shipping_agent_name_snapshot text not null,
  shipment_reference text,
  shipment_method text not null default 'sea' check (shipment_method in ('sea','air','land','courier','other')),
  status text not null default 'planned' check (status in ('planned','booked','in_transit','arrived','customs_cleared','delivered','cancelled')),
  tracking_number text,
  container_number text,
  bill_of_lading text,
  origin text,
  destination text,
  etd date,
  eta date,
  actual_departure date,
  actual_arrival date,
  freight_cost_usd numeric(14,2) not null default 0 check (freight_cost_usd >= 0),
  notes text,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint po_shipment_dates check (etd is null or eta is null or eta >= etd)
);
create index if not exists supplier_po_shipments_po_idx on public.supplier_po_shipments(supplier_po_id,created_at);
create index if not exists supplier_po_shipments_agent_idx on public.supplier_po_shipments(shipping_agent_id);

create table if not exists public.supplier_po_shipment_items (
  id uuid primary key default gen_random_uuid(),
  shipment_id uuid not null references public.supplier_po_shipments(id) on delete cascade,
  supplier_po_item_id uuid not null references public.supplier_po_items(id) on delete cascade,
  qty numeric(14,3) not null check (qty > 0),
  created_at timestamptz not null default now(),
  unique(shipment_id,supplier_po_item_id)
);
create index if not exists supplier_po_shipment_items_po_item_idx on public.supplier_po_shipment_items(supplier_po_item_id);

alter table public.shipping_agents enable row level security;
alter table public.supplier_po_shipments enable row level security;
alter table public.supplier_po_shipment_items enable row level security;

drop policy if exists shipping_agents_read on public.shipping_agents;
create policy shipping_agents_read on public.shipping_agents
for select to authenticated using (
  public.is_admin_or_super() or public.current_user_has_permission('procurement.view')
);
drop policy if exists shipping_agents_write on public.shipping_agents;
create policy shipping_agents_write on public.shipping_agents
for all to authenticated using (
  public.is_admin_or_super() or public.current_user_has_permission('procurement.vendor_manage')
) with check (
  public.is_admin_or_super() or public.current_user_has_permission('procurement.vendor_manage')
);

drop policy if exists po_shipments_read on public.supplier_po_shipments;
create policy po_shipments_read on public.supplier_po_shipments
for select to authenticated using (
  public.is_admin_or_super() or public.current_user_has_permission('procurement.view')
);
drop policy if exists po_shipment_items_read on public.supplier_po_shipment_items;
create policy po_shipment_items_read on public.supplier_po_shipment_items
for select to authenticated using (
  public.is_admin_or_super() or public.current_user_has_permission('procurement.view')
);

-- An atomic save makes splitting a PO into shipments safe, even on concurrent devices.
-- Direct client writes to shipment lines are deliberately disallowed by RLS.
create or replace function public.save_supplier_po_shipment(
  p_shipment jsonb,
  p_items jsonb
) returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_id uuid := nullif(p_shipment->>'id','')::uuid;
  v_po uuid := nullif(p_shipment->>'supplier_po_id','')::uuid;
  v_agent uuid := nullif(p_shipment->>'shipping_agent_id','')::uuid;
  v_agent_name text;
  v_status text := coalesce(nullif(p_shipment->>'status',''),'planned');
  v_method text := coalesce(nullif(p_shipment->>'shipment_method',''),'sea');
  v_freight numeric := coalesce(nullif(p_shipment->>'freight_cost_usd','')::numeric,0);
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_ordered numeric;
  v_existing numeric;
  v_item_ids uuid[] := array[]::uuid[];
  v_original_po uuid;
  v_old_agent uuid;
  v_historical boolean;
begin
  if not (public.is_admin_or_super() or public.current_user_has_permission('procurement.po_edit')) then
    raise exception 'No permission to edit supplier shipments';
  end if;
  if v_po is null or v_agent is null then
    raise exception 'Supplier PO and shipping agent are required';
  end if;
  if v_status not in ('planned','booked','in_transit','arrived','customs_cleared','delivered','cancelled') then
    raise exception 'Invalid shipment status';
  end if;
  if v_method not in ('sea','air','land','courier','other') then
    raise exception 'Invalid shipping method';
  end if;
  if v_freight < 0 or v_freight > 999999999999.99 then
    raise exception 'Invalid freight cost';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    raise exception 'Shipment item quantities must be an array';
  end if;

  -- Serialize all shipment changes for this PO.
  perform 1 from public.supplier_pos where id=v_po for update;
  if not found then raise exception 'Supplier PO not found'; end if;
  select exists(
    select 1 from public.supplier_po_items
    where supplier_po_id=v_po and coalesce(historical_stock_reconciled,false)
  ) into v_historical;
  if v_historical then
    raise exception 'Historical/reconciled PO items cannot be assigned to live shipments';
  end if;
  select name into v_agent_name from public.shipping_agents where id=v_agent;
  if not found then raise exception 'Shipping agent not found'; end if;

  if v_id is not null then
    select supplier_po_id, shipping_agent_id
      into v_original_po, v_old_agent
      from public.supplier_po_shipments
      where id=v_id for update;
    if not found then raise exception 'Shipment not found'; end if;
    if v_original_po <> v_po then raise exception 'Shipment PO cannot be changed'; end if;
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_item_id := nullif(v_item->>'supplier_po_item_id','')::uuid;
    v_qty := nullif(v_item->>'qty','')::numeric;
    if v_item_id is null or v_qty is null or v_qty <= 0 then
      raise exception 'Each shipment item must have a positive quantity';
    end if;
    if v_item_id = any(v_item_ids) then
      raise exception 'The same PO item appears twice in this shipment';
    end if;
    v_item_ids := array_append(v_item_ids,v_item_id);
    select pi.qty into v_ordered
      from public.supplier_po_items pi
      where pi.id=v_item_id and pi.supplier_po_id=v_po;
    if not found then raise exception 'Shipment item does not belong to this PO'; end if;
    select coalesce(sum(si.qty),0) into v_existing
      from public.supplier_po_shipment_items si
      join public.supplier_po_shipments sh on sh.id=si.shipment_id
      where si.supplier_po_item_id=v_item_id
        and sh.status <> 'cancelled'
        and (v_id is null or sh.id<>v_id);
    if v_status <> 'cancelled' and v_qty + v_existing > v_ordered then
      raise exception 'Shipment quantity exceeds PO ordered quantity (item %, remaining %)',
        v_item_id, greatest(0,v_ordered-v_existing);
    end if;
  end loop;
  if v_status <> 'cancelled' and cardinality(v_item_ids)=0 then
    raise exception 'Allocate at least one PO item to a shipment';
  end if;

  if v_id is null then
    insert into public.supplier_po_shipments (
      supplier_po_id,shipping_agent_id,shipping_agent_name_snapshot,
      shipment_reference,shipment_method,status,tracking_number,container_number,
      bill_of_lading,origin,destination,etd,eta,actual_departure,actual_arrival,
      freight_cost_usd,notes
    ) values (
      v_po,v_agent,v_agent_name,
      nullif(btrim(p_shipment->>'shipment_reference'),''),
      v_method,v_status,
      nullif(btrim(p_shipment->>'tracking_number'),''),
      nullif(btrim(p_shipment->>'container_number'),''),
      nullif(btrim(p_shipment->>'bill_of_lading'),''),
      nullif(btrim(p_shipment->>'origin'),''),
      nullif(btrim(p_shipment->>'destination'),''),
      nullif(p_shipment->>'etd','')::date,
      nullif(p_shipment->>'eta','')::date,
      nullif(p_shipment->>'actual_departure','')::date,
      nullif(p_shipment->>'actual_arrival','')::date,
      v_freight,nullif(btrim(p_shipment->>'notes'),'')
    ) returning id into v_id;
  else
    update public.supplier_po_shipments set
      shipping_agent_id=v_agent, shipping_agent_name_snapshot=v_agent_name,
      shipment_reference=nullif(btrim(p_shipment->>'shipment_reference'),''),
      shipment_method=v_method,status=v_status,
      tracking_number=nullif(btrim(p_shipment->>'tracking_number'),''),
      container_number=nullif(btrim(p_shipment->>'container_number'),''),
      bill_of_lading=nullif(btrim(p_shipment->>'bill_of_lading'),''),
      origin=nullif(btrim(p_shipment->>'origin'),''),
      destination=nullif(btrim(p_shipment->>'destination'),''),
      etd=nullif(p_shipment->>'etd','')::date,
      eta=nullif(p_shipment->>'eta','')::date,
      actual_departure=nullif(p_shipment->>'actual_departure','')::date,
      actual_arrival=nullif(p_shipment->>'actual_arrival','')::date,
      freight_cost_usd=v_freight,notes=nullif(btrim(p_shipment->>'notes'),''),
      updated_at=now()
    where id=v_id;
    delete from public.supplier_po_shipment_items where shipment_id=v_id;
  end if;
  insert into public.supplier_po_shipment_items (shipment_id,supplier_po_item_id,qty)
    select v_id,(x->>'supplier_po_item_id')::uuid,(x->>'qty')::numeric
    from jsonb_array_elements(p_items) x;
  return v_id;
end;
$$;
revoke all on function public.save_supplier_po_shipment(jsonb,jsonb) from public,anon;
grant execute on function public.save_supplier_po_shipment(jsonb,jsonb) to authenticated;
