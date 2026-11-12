-- The code-normalization trigger is SECURITY INVOKER. It needs to read
-- reserved historical codes, but browser clients must never write aliases.
alter table public.product_code_aliases enable row level security;
grant select on public.product_code_aliases to authenticated;
create policy product_code_aliases_admin_read on public.product_code_aliases
for select to authenticated using (public.is_admin_or_super());

-- Do not let restoring product creation open a manual stock-creation path.
-- Trusted inventory functions run as their owner; direct browser writes run
-- as authenticated. No client-set flag can bypass this guard.
create or replace function public.guard_direct_product_stock_quantity()
returns trigger language plpgsql security invoker
set search_path to public,pg_temp
as $$
begin
  if current_user='authenticated' and not public.is_super_admin() then
    if (tg_op='INSERT' and coalesce(new.stock_qty,0)<>0)
       or (tg_op='UPDATE' and new.stock_qty is distinct from old.stock_qty) then
      raise exception 'Only Super Admin may set initial or manually change product quantity. Use PO receiving for incoming stock.' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
revoke all on function public.guard_direct_product_stock_quantity() from public,anon,authenticated;
create trigger a_guard_direct_product_stock_quantity
before insert or update of stock_qty on public.product_catalog
for each row execute function public.guard_direct_product_stock_quantity();

-- Keep received and reconciled history and SR allocations attached to the
-- original line. Cost and sort-order edits are still permitted.
create or replace function public.guard_received_po_item_identity_change()
returns trigger language plpgsql security invoker
set search_path to public,pg_temp
as $$
begin
 if tg_op='DELETE' or old.product_id is distinct from new.product_id
    or old.supplier_po_id is distinct from new.supplier_po_id
    or old.product_code_snapshot is distinct from new.product_code_snapshot
    or old.item_name_snapshot is distinct from new.item_name_snapshot
    or old.qty is distinct from new.qty then
   if old.historical_stock_reconciled then
     raise exception 'Historical / Reconciled PO item identity and quantity are locked. Undo reconciliation first.';
   end if;
   if exists(select 1 from public.fulfillment_links where supplier_po_item_id=old.id) then
     raise exception 'This PO item is linked to an SR. Unlink it through SR Allocations before changing identity, quantity or deleting it.';
   end if;
   if exists(select 1 from public.stock_movements sm
     where sm.movement_type='po_receipt'
       and sm.reference_type='supplier_po_item'
       and sm.reference_item_id=old.id) then
     raise exception 'This PO item has posted stock receipts. Correct the physical stock movements with Stock & Inventory before changing product identity or ordered quantity. PO cost, ETA and notes may still be edited.';
   end if;
 end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end $$;
drop trigger trg_guard_received_po_item_identity_change on public.supplier_po_items;
create trigger trg_guard_received_po_item_identity_change
before delete or update of supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,qty
on public.supplier_po_items for each row
execute function public.guard_received_po_item_identity_change();
