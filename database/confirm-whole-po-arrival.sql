-- Confirmed whole-PO arrival: update PO header and active item statuses atomically.
-- Stock receipts are never created here; Stock & Inventory → Receive PO remains a separate action.
create or replace function public.mark_supplier_po_all_items_arrived(
  p_po_id uuid,
  p_eta date default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_po public.supplier_pos%rowtype;
  v_live integer;
  v_changed integer := 0;
  v_historical integer;
  v_cancelled integer;
  v_closed integer;
begin
  if not public.current_user_has_permission('procurement.po_edit') then
    raise exception 'Supplier PO edit permission required';
  end if;
  if p_po_id is null then
    raise exception 'Supplier PO ID is required';
  end if;

  -- Serialize whole-PO arrival with concurrent PO updates.
  select * into v_po
    from public.supplier_pos
    where id=p_po_id
    for update;
  if not found then
    raise exception 'Supplier PO not found';
  end if;
  if v_po.status='cancelled' then
    raise exception 'Cancelled Supplier PO cannot be marked Arrived';
  end if;

  -- Keep historical/reconciled and intentionally cancelled/completed item lines untouched.
  select
    count(*) filter(where coalesce(historical_stock_reconciled,false)=false
                       and coalesce(procurement_status,'placed') not in ('cancelled','closed')),
    count(*) filter(where coalesce(historical_stock_reconciled,false)=true),
    count(*) filter(where coalesce(historical_stock_reconciled,false)=false and procurement_status='cancelled'),
    count(*) filter(where coalesce(historical_stock_reconciled,false)=false and procurement_status='closed')
  into v_live,v_historical,v_cancelled,v_closed
  from public.supplier_po_items
  where supplier_po_id=p_po_id;

  if coalesce(v_live,0)=0 then
    raise exception 'No live PO items can be marked Arrived. Historical, cancelled and closed items are protected';
  end if;

  -- This is PO progress only: NO INSERT into stock_movements or change in inventory balance.
  update public.supplier_po_items
     set procurement_status='arrived', updated_at=now()
   where supplier_po_id=p_po_id
     and coalesce(historical_stock_reconciled,false)=false
     and coalesce(procurement_status,'placed') not in ('arrived','closed','cancelled');
  get diagnostics v_changed = row_count;

  update public.supplier_pos
     set status='arrived',
         estimated_arrival=p_eta,
         actual_arrival=coalesce(actual_arrival, current_date),
         updated_at=now()
   where id=p_po_id;

  return jsonb_build_object(
    'supplier_po_id',p_po_id,
    'status','arrived',
    'live_lines',v_live,
    'updated_item_lines',v_changed,
    'historical_lines_preserved',v_historical,
    'cancelled_lines_preserved',v_cancelled,
    'closed_lines_preserved',v_closed,
    'inventory_received',false
  );
end;
$function$;

revoke all on function public.mark_supplier_po_all_items_arrived(uuid,date) from public, anon;
grant execute on function public.mark_supplier_po_all_items_arrived(uuid,date) to authenticated;
