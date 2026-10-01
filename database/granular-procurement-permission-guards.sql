-- Granular Procurement permission guards used by PO Items and historical reconciliation.

CREATE OR REPLACE FUNCTION public.get_historical_po_reconciliation_candidates()
 RETURNS TABLE(supplier_po_id uuid, po_number text, vendor_name text, order_date date, total_items bigint, outstanding_items bigint, outstanding_qty numeric, reconciled_items bigint, reconciled_qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  with permission_check as (
    select public.current_user_has_permission('procurement.historical_reconcile') as allowed
  ),
  received as (
    select reference_item_id as item_id,sum(qty)::numeric as received_qty
    from public.stock_movements
    where affects_balance=true
      and movement_type='po_receipt'
      and reference_type='supplier_po_item'
      and reference_item_id is not null
    group by reference_item_id
  ),
  line as (
    select
      i.supplier_po_id,
      i.id,
      greatest(i.qty-coalesce(r.received_qty,0),0)::numeric as remaining_qty,
      coalesce(i.historical_stock_reconciled,false) as reconciled
    from public.supplier_po_items i
    left join received r on r.item_id=i.id
    where i.inventory_tracking_enabled=true
      and i.product_id is not null
  )
  select
    p.id,
    coalesce(p.po_number,p.po_pending_reference,'PO'),
    p.vendor_name,
    p.order_date,
    count(l.id)::bigint,
    count(l.id) filter (where l.remaining_qty>0)::bigint,
    coalesce(sum(l.remaining_qty) filter (where l.remaining_qty>0),0)::numeric,
    count(l.id) filter (where l.reconciled and l.remaining_qty>0)::bigint,
    coalesce(sum(l.remaining_qty) filter (where l.reconciled and l.remaining_qty>0),0)::numeric
  from public.supplier_pos p
  join line l on l.supplier_po_id=p.id
  where exists(select 1 from permission_check where allowed)
  group by p.id,p.po_number,p.po_pending_reference,p.vendor_name,p.order_date
  having count(l.id) filter (where l.remaining_qty>0)>0
      or count(l.id) filter (where l.reconciled)>0
  order by p.order_date desc,p.created_at desc;
$function$
;

CREATE OR REPLACE FUNCTION public.set_supplier_po_historical_reconciled(p_supplier_po_ids uuid[], p_reconciled boolean, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_count integer:=0;
begin
  if not public.current_user_has_permission('procurement.historical_reconcile') then
    raise exception 'PO historical reconciliation permission required';
  end if;

  if p_supplier_po_ids is null or cardinality(p_supplier_po_ids)=0 then
    raise exception 'Select at least one Supplier PO';
  end if;
  if cardinality(p_supplier_po_ids)>100 then
    raise exception 'Select no more than 100 Supplier POs at once';
  end if;

  if coalesce(p_reconciled,false) then
    update public.supplier_po_items i
    set historical_stock_reconciled=true,
        historical_stock_reconciled_at=now(),
        historical_stock_reconciled_by=auth.uid(),
        historical_stock_reconciliation_note=coalesce(nullif(trim(coalesce(p_note,'')),''),'Already reflected in opening/current stock'),
        updated_at=now()
    where i.supplier_po_id=any(p_supplier_po_ids)
      and i.inventory_tracking_enabled=true
      and i.product_id is not null
      and exists(
        select 1
        from public.supplier_pos p
        where p.id=i.supplier_po_id
          and coalesce(p.status,'')<>'cancelled'
      )
      and greatest(
        i.qty-coalesce((
          select sum(m.qty)
          from public.stock_movements m
          where m.affects_balance=true
            and m.movement_type='po_receipt'
            and m.reference_type='supplier_po_item'
            and m.reference_item_id=i.id
        ),0),
        0
      )>0;
  else
    update public.supplier_po_items i
    set historical_stock_reconciled=false,
        historical_stock_reconciled_at=null,
        historical_stock_reconciled_by=null,
        historical_stock_reconciliation_note=null,
        updated_at=now()
    where i.supplier_po_id=any(p_supplier_po_ids)
      and i.historical_stock_reconciled=true;
  end if;

  get diagnostics v_count=row_count;
  return v_count;
end
$function$
;

CREATE OR REPLACE FUNCTION public.set_supplier_po_items_historical_reconciled(p_supplier_po_item_ids uuid[], p_reconciled boolean, p_note text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_count integer:=0;
begin
  if not public.current_user_has_permission('procurement.historical_reconcile') then
    raise exception 'PO historical reconciliation permission required';
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
        historical_stock_reconciliation_note=coalesce(
          nullif(trim(coalesce(p_note,'')),''),
          'Already reflected in opening/current stock'
        ),
        updated_at=now()
    where i.id=any(p_supplier_po_item_ids)
      and i.historical_stock_reconciled=false
      and i.inventory_tracking_enabled=true
      and i.product_id is not null
      and exists(
        select 1
        from public.supplier_pos p
        where p.id=i.supplier_po_id
          and coalesce(p.status,'')<>'cancelled'
      )
      and greatest(
        i.qty-coalesce((
          select sum(m.qty)
          from public.stock_movements m
          where m.affects_balance=true
            and m.movement_type='po_receipt'
            and m.reference_type='supplier_po_item'
            and m.reference_item_id=i.id
        ),0),
        0
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
$function$
;

CREATE OR REPLACE FUNCTION public.set_supplier_po_items_status_bulk(p_supplier_po_item_ids uuid[], p_status text)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_status text:=lower(trim(coalesce(p_status,'')));
  v_count integer:=0;
begin
  if not public.current_user_has_permission('procurement.po_edit') then
    raise exception 'Supplier PO edit permission required';
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
$function$
;

