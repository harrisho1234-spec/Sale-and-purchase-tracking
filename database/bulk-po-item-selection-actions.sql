-- Bulk PO Item selection actions for Procurement > PO Items.

create or replace function public.set_supplier_po_items_historical_reconciled(
  p_supplier_po_item_ids uuid[],
  p_reconciled boolean,
  p_note text default null
)
returns integer
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=coalesce(public.current_app_role(),'');
  v_count integer:=0;
begin
  if v_role not in ('admin','super_admin') then
    raise exception 'Admin or Super Admin access required';
  end if;
  if p_supplier_po_item_ids is null or cardinality(p_supplier_po_item_ids)=0 then
    raise exception 'Select at least one PO item';
  end if;
  if cardinality(p_supplier_po_item_ids)>500 then
    raise exception 'Select no more than 500 PO items at once';
  end if;
  if (select count(distinct x) from unnest(p_supplier_po_item_ids) x)
     <> cardinality(p_supplier_po_item_ids) then
    raise exception 'Duplicate PO item IDs are not allowed';
  end if;

  if coalesce(p_reconciled,false) then
    update public.supplier_po_items i
    set historical_stock_reconciled=true,
        historical_stock_reconciled_at=now(),
        historical_stock_reconciled_by=auth.uid(),
        historical_stock_reconciliation_note=coalesce(nullif(trim(coalesce(p_note,'')),''),'Already reflected in opening/current stock'),
        updated_at=now()
    where i.id=any(p_supplier_po_item_ids)
      and i.historical_stock_reconciled=false
      and i.inventory_tracking_enabled=true
      and i.product_id is not null
      and exists(
        select 1 from public.supplier_pos p
        where p.id=i.supplier_po_id and coalesce(p.status,'')<>'cancelled'
      )
      and greatest(
        i.qty-coalesce((
          select sum(m.qty)
          from public.stock_movements m
          where m.affects_balance=true
            and m.movement_type='po_receipt'
            and m.reference_type='supplier_po_item'
            and m.reference_item_id=i.id
        ),0),0
      )>0;
  else
    update public.supplier_po_items i
    set historical_stock_reconciled=false,
        historical_stock_reconciled_at=null,
        historical_stock_reconciled_by=null,
        historical_stock_reconciliation_note=null,
        updated_at=now()
    where i.id=any(p_supplier_po_item_ids)
      and i.historical_stock_reconciled=true;
  end if;

  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

revoke all on function public.set_supplier_po_items_historical_reconciled(uuid[],boolean,text) from public;
revoke all on function public.set_supplier_po_items_historical_reconciled(uuid[],boolean,text) from anon;
grant execute on function public.set_supplier_po_items_historical_reconciled(uuid[],boolean,text) to authenticated;

create or replace function public.set_supplier_po_items_status_bulk(
  p_supplier_po_item_ids uuid[],
  p_status text
)
returns integer
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=coalesce(public.current_app_role(),'');
  v_status text:=lower(trim(coalesce(p_status,'')));
  v_count integer:=0;
begin
  if v_role not in ('admin','super_admin') then
    raise exception 'Admin or Super Admin access required';
  end if;
  if p_supplier_po_item_ids is null or cardinality(p_supplier_po_item_ids)=0 then
    raise exception 'Select at least one PO item';
  end if;
  if cardinality(p_supplier_po_item_ids)>500 then
    raise exception 'Select no more than 500 PO items at once';
  end if;
  if (select count(distinct x) from unnest(p_supplier_po_item_ids) x)
     <> cardinality(p_supplier_po_item_ids) then
    raise exception 'Duplicate PO item IDs are not allowed';
  end if;
  if v_status not in ('placed','production','ready','shipping','arrived','closed','cancelled') then
    raise exception 'Invalid PO item status';
  end if;

  update public.supplier_po_items
  set procurement_status=v_status,
      updated_at=now()
  where id=any(p_supplier_po_item_ids)
    and historical_stock_reconciled=false;

  get diagnostics v_count=row_count;
  return v_count;
end
$function$;

revoke all on function public.set_supplier_po_items_status_bulk(uuid[],text) from public;
revoke all on function public.set_supplier_po_items_status_bulk(uuid[],text) from anon;
grant execute on function public.set_supplier_po_items_status_bulk(uuid[],text) to authenticated;
