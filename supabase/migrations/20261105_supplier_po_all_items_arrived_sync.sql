-- Advance the parent Supplier PO when the last active item reaches Arrived.
-- Partial/split shipments remain mixed and the overall PO is not pushed back.
-- No stock receipts or inventory movements are created by this trigger.
create or replace function public.maybe_advance_supplier_po_from_items()
returns trigger language plpgsql security definer
set search_path to public,pg_temp
as $fn$
declare
  v_po public.supplier_pos%rowtype;
  v_open_count integer;
  v_early_count integer;
begin
  if new.procurement_status is not distinct from old.procurement_status then return new; end if;
  if coalesce(new.historical_stock_reconciled,false) then return new; end if;
  if public.po_procurement_stage_rank(new.procurement_status)<4 then return new; end if;

  select count(*) filter (where coalesce(i.historical_stock_reconciled,false)=false
       and coalesce(i.procurement_status,'placed')<>'cancelled'),
     count(*) filter (where coalesce(i.historical_stock_reconciled,false)=false
       and coalesce(i.procurement_status,'placed')<>'cancelled'
       and public.po_procurement_stage_rank(i.procurement_status)<4)
  into v_open_count,v_early_count
  from public.supplier_po_items i
  where i.supplier_po_id=new.supplier_po_id;

  if coalesce(v_open_count,0)=0 or coalesce(v_early_count,0)>0 then return new; end if;
  update public.supplier_pos p
     set status='arrived',
         actual_arrival=coalesce(p.actual_arrival,current_date),
         updated_at=now()
   where p.id=new.supplier_po_id
     and p.status in ('placed','production','ready','shipping');
  return new;
end
$fn$;

create trigger trg_auto_supplier_po_arrived_from_item_status_20261105
after update of procurement_status on public.supplier_po_items
for each row execute function public.maybe_advance_supplier_po_from_items();

revoke all on function public.maybe_advance_supplier_po_from_items() from public;
