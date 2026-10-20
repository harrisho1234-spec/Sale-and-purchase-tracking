
-- Stock & Inventory PO Receiving History — read-only reporting on actual posted PO receipts.
-- No new receipts, adjustments or inventory balance changes.
create or replace function public.get_inventory_po_receipt_history(
  p_search text default null,
  p_limit integer default 200
) returns table(
  supplier_po_id uuid,
  po_number text,
  vendor_name text,
  po_status text,
  order_date date,
  po_item_id uuid,
  product_code text,
  item_name text,
  ordered_qty numeric,
  received_qty numeric,
  remaining_qty numeric,
  historical_reconciled boolean,
  receipt_events jsonb,
  latest_receipt_date date,
  latest_recorded_at timestamptz
)
language sql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
with eligible_pos as (
  select p.id,p.po_number,p.po_pending_reference,p.vendor_name,p.status,p.order_date,
    (select max(sm.created_at)
     from public.supplier_po_items pi
     join public.stock_movements sm
       on sm.reference_item_id=pi.id
      and sm.reference_type='supplier_po_item'
      and sm.movement_type='po_receipt'
      and sm.affects_balance=true
     where pi.supplier_po_id=p.id) as last_recorded
  from public.supplier_pos p
  where public.can_view_inventory()
    and exists (
      select 1 from public.supplier_po_items pi
      join public.stock_movements sm on sm.reference_item_id=pi.id
        and sm.reference_type='supplier_po_item'
        and sm.movement_type='po_receipt'
        and sm.affects_balance=true
      where pi.supplier_po_id=p.id
    )
    and (
      nullif(btrim(coalesce(p_search,'')),'') is null
      or coalesce(p.po_number,p.po_pending_reference,'') ilike '%'||btrim(p_search)||'%'
      or p.vendor_name ilike '%'||btrim(p_search)||'%'
      or exists (
        select 1 from public.supplier_po_items ii
        where ii.supplier_po_id=p.id
          and (ii.product_code_snapshot ilike '%'||btrim(p_search)||'%'
            or ii.item_name_snapshot ilike '%'||btrim(p_search)||'%')
      )
    )
  order by last_recorded desc nulls last,p.id desc
  limit least(greatest(coalesce(p_limit,200),1),500)
)
select p.id as supplier_po_id,
       coalesce(nullif(p.po_number,''),nullif(p.po_pending_reference,''),'PO Pending')::text as po_number,
       p.vendor_name::text,
       p.status::text as po_status,
       p.order_date,
       i.id as po_item_id,
       i.product_code_snapshot::text as product_code,
       i.item_name_snapshot::text as item_name,
       i.qty as ordered_qty,
       coalesce(rec.qty,0)::numeric as received_qty,
       case when coalesce(i.historical_stock_reconciled,false)
         then null::numeric
         else greatest(0,i.qty-coalesce(rec.qty,0))::numeric
       end as remaining_qty,
       coalesce(i.historical_stock_reconciled,false) as historical_reconciled,
       coalesce(rec.details,'[]'::jsonb) as receipt_events,
       rec.last_date as latest_receipt_date,
       rec.last_recorded_at as latest_recorded_at
from eligible_pos p
join public.supplier_po_items i on i.supplier_po_id=p.id
left join lateral (
  select sum(sm.qty) as qty,
         max(sm.movement_date) as last_date,
         max(sm.created_at) as last_recorded_at,
         jsonb_agg(jsonb_build_object(
           'movement_id',sm.id,
           'receipt_date',sm.movement_date,
           'qty',sm.qty,
           'location_code',loc.code,
           'location_name',loc.name,
           'received_by',coalesce(nullif(u.display_name,''),nullif(u.email,''),'System'),
           'note',sm.note,
           'recorded_at',sm.created_at
         ) order by sm.movement_date desc,sm.created_at desc,sm.id desc) as details
  from public.stock_movements sm
  left join public.stock_locations loc on loc.id=sm.to_location_id
  left join public.app_users u on u.user_id=sm.created_by
  where sm.reference_type='supplier_po_item'
    and sm.reference_item_id=i.id
    and sm.movement_type='po_receipt'
    and sm.affects_balance=true
) rec on true
where (not coalesce(i.historical_stock_reconciled,false) or coalesce(rec.qty,0)>0)
order by p.last_recorded desc nulls last,p.id desc,coalesce(i.sort_order,999999),i.created_at,i.id;
$function$;

revoke all on function public.get_inventory_po_receipt_history(text,integer)
  from public,anon;
grant execute on function public.get_inventory_po_receipt_history(text,integer)
  to authenticated;

create index if not exists stock_movements_po_receipt_history_lookup_idx
  on public.stock_movements(reference_item_id,created_at desc)
  where reference_type='supplier_po_item' and movement_type='po_receipt' and affects_balance=true;
