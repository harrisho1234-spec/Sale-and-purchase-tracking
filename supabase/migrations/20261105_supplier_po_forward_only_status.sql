-- PO progress is one-way once a stage is recorded; stock receipts are the
-- authoritative physical-arrival evidence. Existing PO and item records are
-- untouched by this migration. No inventory movements are created or removed.

create or replace function public.po_procurement_stage_rank(p_status text)
returns integer language sql immutable parallel safe
set search_path to public,pg_temp
as $fn$
  select case lower(coalesce(nullif(trim(p_status),''),'placed'))
    when 'placed' then 0 when 'ordered' then 0
    when 'production' then 1 when 'ready' then 2
    when 'shipping' then 3 when 'arrived' then 4
    when 'closed' then 5 when 'delivered' then 5
    when 'complete' then 5 when 'completed' then 5
    when 'cancelled' then -1 else null end
$fn$;

create or replace function public.guard_supplier_po_forward_only()
returns trigger language plpgsql security definer
set search_path to public,pg_temp
as $fn$
declare
  v_old integer := public.po_procurement_stage_rank(old.status);
  v_new integer := public.po_procurement_stage_rank(new.status);
  v_has_receipt boolean;
begin
  if new.status is not distinct from old.status then return new; end if;
  if v_old is null or v_new is null then
    raise exception 'Unknown PO status. Contact Admin to correct the workflow definition.';
  end if;
  if v_old=-1 then
    raise exception 'Cancelled Supplier POs cannot be reopened by editing status.';
  end if;
  if v_new>=0 and v_new<v_old then
    raise exception 'PO status cannot move backward from % to %. Use a reviewed correction workflow for exceptional mistakes.',old.status,new.status;
  end if;
  -- Includes receipts for individual PO lines; permits a PO to remain
  -- Shipping while other split-shipment lines have already arrived.
  select exists(
    select 1 from public.stock_movements m
    where m.affects_balance=true and m.movement_type='po_receipt'
      and m.reference_type='supplier_po_item'
      and m.reference_item_id in
        (select i.id from public.supplier_po_items i where i.supplier_po_id=old.id)
  ) into v_has_receipt;
  if v_has_receipt and v_new<4 then
    raise exception 'Stock has already been received for this PO. It cannot be moved back to Production or Shipping.';
  end if;
  if v_new=-1 and (v_old>=4 or v_has_receipt) then
    raise exception 'Arrived or received POs cannot be cancelled by changing their status.';
  end if;
  return new;
end
$fn$;

create or replace function public.guard_supplier_po_item_forward_only()
returns trigger language plpgsql security definer
set search_path to public,pg_temp
as $fn$
declare
  v_old integer := public.po_procurement_stage_rank(old.procurement_status);
  v_new integer := public.po_procurement_stage_rank(new.procurement_status);
  v_has_receipt boolean;
begin
  if new.procurement_status is not distinct from old.procurement_status then return new; end if;
  if v_old is null or v_new is null then
    raise exception 'Unknown PO item status. Contact Admin to correct the workflow definition.';
  end if;
  if v_old=-1 then
    raise exception 'Cancelled PO items cannot be reopened by editing status.';
  end if;
  if v_new>=0 and v_new<v_old then
    raise exception 'PO item cannot move backward from % to %. Already-arrived lines stay Arrived.',old.procurement_status,new.procurement_status;
  end if;
  select exists(
    select 1 from public.stock_movements m
    where m.affects_balance=true and m.movement_type='po_receipt'
      and m.reference_type='supplier_po_item'
      and m.reference_item_id=old.id
  ) into v_has_receipt;
  if v_has_receipt and v_new<4 then
    raise exception 'This PO item has already been received into Stock. Shipping / Production status is no longer allowed.';
  end if;
  if v_new=-1 and (v_old>=4 or v_has_receipt) then
    raise exception 'Arrived or received PO items cannot be cancelled by changing their status.';
  end if;
  return new;
end
$fn$;

create trigger trg_supplier_po_forward_only_20261105
before update of status on public.supplier_pos
for each row execute function public.guard_supplier_po_forward_only();

create trigger trg_supplier_po_item_forward_only_20261105
before update of procurement_status on public.supplier_po_items
for each row execute function public.guard_supplier_po_item_forward_only();

-- Atomic whole-PO progress for forward changes and ETA-only updates.
-- Advanced item rows stay advanced; historical, cancelled and closed rows
-- are never overwritten. Arrival keeps its separate confirmed bulk RPC.
create or replace function public.set_supplier_po_forward_status(
  p_po_id uuid, p_status text, p_eta date default null
)
returns jsonb language plpgsql security definer
set search_path to public,auth,pg_temp
as $fn$
declare
 v_po public.supplier_pos%rowtype;
 v_target text := lower(trim(coalesce(p_status,'')));
 v_rank integer;
 v_affected integer := 0;
 v_received_incomplete integer;
begin
 if not public.current_user_has_permission('procurement.po_edit') then
   raise exception 'Supplier PO edit permission required';
 end if;
 if p_po_id is null then raise exception 'Select a Supplier PO'; end if;
 if v_target not in ('placed','production','ready','shipping','arrived','delivered','closed') then
   raise exception 'Invalid Supplier PO progress status';
 end if;
 select * into v_po from public.supplier_pos where id=p_po_id for update;
 if not found then raise exception 'Supplier PO not found'; end if;
 if exists(
   select 1 from public.supplier_po_items i where i.supplier_po_id=p_po_id
   group by i.supplier_po_id
   having count(*)>0 and bool_and(coalesce(i.historical_stock_reconciled,false))
 ) then raise exception 'Historical / Reconciled PO is locked. Undo reconciliation first.'; end if;
 if v_target='arrived' then
   raise exception 'Use Confirm All Arrived, which synchronizes active PO items and does not receive stock automatically.';
 end if;
 v_rank:=public.po_procurement_stage_rank(v_target);
 if v_rank<public.po_procurement_stage_rank(v_po.status) then
   raise exception 'PO % is already %. Backward changes to % are not allowed.',
     coalesce(v_po.po_number,v_po.po_pending_reference,'PO'),v_po.status,v_target;
 end if;
 if v_target in ('delivered','closed') then
   if public.po_procurement_stage_rank(v_po.status)<4 then
     raise exception 'Mark the Supplier PO Arrived before closing it.';
   end if;
   select count(*) into v_received_incomplete
   from public.supplier_po_items i
   where i.supplier_po_id=p_po_id and i.inventory_tracking_enabled=true
     and i.product_id is not null and coalesce(i.historical_stock_reconciled,false)=false
     and coalesce(i.procurement_status,'placed')<>'cancelled'
     and coalesce((
       select sum(m.qty) from public.stock_movements m
       where m.affects_balance=true and m.movement_type='po_receipt'
         and m.reference_type='supplier_po_item' and m.reference_item_id=i.id
     ),0)+0.0001<i.qty;
   if v_received_incomplete>0 then
     raise exception 'Cannot close this PO: % tracked item line(s) still have quantity not received into Stock.',
       v_received_incomplete;
   end if;
 end if;
 if v_target<>coalesce(v_po.status,'placed') then
   update public.supplier_pos set status=v_target,estimated_arrival=p_eta,updated_at=now()
     where id=p_po_id;
   update public.supplier_po_items i
   set procurement_status=case when v_rank=5 then 'closed' else v_target end,
       updated_at=now()
   where i.supplier_po_id=p_po_id
     and coalesce(i.historical_stock_reconciled,false)=false
     and coalesce(i.procurement_status,'placed') not in ('cancelled','closed','delivered','complete','completed')
     and public.po_procurement_stage_rank(i.procurement_status)<v_rank;
   get diagnostics v_affected=row_count;
 else
   update public.supplier_pos set estimated_arrival=p_eta,updated_at=now()
   where id=p_po_id and estimated_arrival is distinct from p_eta;
 end if;
 return jsonb_build_object('status',v_target,'updated_item_lines',v_affected,
     'stock_received_automatically',false);
end
$fn$;

revoke all on function public.guard_supplier_po_forward_only() from public;
revoke all on function public.guard_supplier_po_item_forward_only() from public;
revoke all on function public.set_supplier_po_forward_status(uuid,text,date) from public;
grant execute on function public.set_supplier_po_forward_status(uuid,text,date) to authenticated;

-- Supplier order-level ETA changes must never turn a delivered or already
-- ready Sales tracking line backward to ordered/production/shipping.
create or replace function public.sync_linked_item_tracking_from_po()
returns trigger language plpgsql security definer
set search_path to public,pg_temp
as $fn$
declare
  v_stage text := public.map_po_status_to_item_status(new.status);
begin
  update public.item_tracking it
  set status=case
        when lower(coalesce(it.status,'')) in ('delivered','installed','cancelled') then it.status
        when v_stage='cancelled' then 'cancelled'
        when (case v_stage when 'ordered' then 0 when 'production' then 1
                when 'shipping' then 2 when 'ready' then 3 else 0 end)
             >(case lower(coalesce(it.status,'ordered'))
                when 'ordered' then 0 when 'production' then 1
                when 'shipping' then 2 when 'ready' then 3 else 0 end) then v_stage
        else it.status end,
      estimated_arrival=coalesce(new.estimated_arrival,it.estimated_arrival),
      updated_at=now()
  from public.fulfillment_links fl
  join public.supplier_po_items spi on spi.id=fl.supplier_po_item_id
  where spi.supplier_po_id=new.id
    and it.sales_order_item_id=fl.sales_order_item_id;
  return new;
end
$fn$;
