-- Read-only thumbnails for PO Receiving History.
-- Receipts are the only qualifying source, so this does not expose unrelated supplier PO images.
create or replace function public.get_inventory_po_receipt_thumbnails(p_item_ids uuid[])
returns table(po_item_id uuid,image_url text)
language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $$
  select i.id as po_item_id,
    coalesce(
      nullif(btrim(i.image_url_snapshot),''),
      nullif(btrim(pc.image_url),'')
    ) as image_url
  from public.supplier_po_items i
  left join public.product_catalog pc on pc.id=i.product_id
  where public.can_view_inventory()
    and p_item_ids is not null
    and cardinality(p_item_ids) between 1 and 1000
    and i.id=any(p_item_ids)
    and exists (
      select 1 from public.stock_movements m
      where m.reference_item_id=i.id
        and m.reference_type='supplier_po_item'
        and m.movement_type='po_receipt'
        and m.affects_balance=true
    )
$$;
revoke all on function public.get_inventory_po_receipt_thumbnails(uuid[]) from public,anon;
grant execute on function public.get_inventory_po_receipt_thumbnails(uuid[]) to authenticated;