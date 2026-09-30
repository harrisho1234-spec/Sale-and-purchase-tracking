-- Product tax classification only. Quantities remain in the existing inventory ledger.
alter table public.product_catalog
  add column tax_item boolean not null default false,
  add column tax_group_or_set text,
  add column tax_note text,
  add column tax_updated_at timestamptz,
  add column tax_updated_by uuid;

create function public.guard_product_tax_metadata()
returns trigger language plpgsql security invoker set search_path = '' as $$
declare changed boolean;
begin
  if tg_op = 'INSERT' then
    changed := new.tax_item or new.tax_group_or_set is not null or new.tax_note is not null;
  else
    changed := row(new.tax_item,new.tax_group_or_set,new.tax_note)
      is distinct from row(old.tax_item,old.tax_group_or_set,old.tax_note);
  end if;
  if changed then
    if auth.uid() is null or not coalesce(public.is_super_admin(),false) then
      raise exception 'Only an active Super Admin can change tax classification' using errcode='42501';
    end if;
    new.tax_group_or_set := nullif(btrim(new.tax_group_or_set),'');
    new.tax_note := nullif(btrim(new.tax_note),'');
    if length(new.tax_group_or_set)>200 or length(new.tax_note)>2000 then
      raise exception 'Tax group/set must be at most 200 characters and note at most 2000';
    end if;
    new.tax_updated_at := clock_timestamp();
    new.tax_updated_by := auth.uid();
  elsif tg_op = 'INSERT' then
    new.tax_updated_at := null;
    new.tax_updated_by := null;
  else
    new.tax_updated_at := old.tax_updated_at;
    new.tax_updated_by := old.tax_updated_by;
  end if;
  return new;
end $$;
revoke all on function public.guard_product_tax_metadata() from public,anon,authenticated;
create trigger guard_product_tax_metadata before insert or update on public.product_catalog
for each row execute function public.guard_product_tax_metadata();

-- Keep the existing view and all its calculations unchanged.
create view public.inventory_product_tax_balance with (security_invoker=true) as
select b.*,p.tax_item,p.tax_group_or_set,p.tax_note,p.tax_updated_at,p.tax_updated_by
from public.inventory_product_balance b join public.product_catalog p on p.id=b.product_id;
create view public.tax_inventory with (security_invoker=true) as
select * from public.inventory_product_tax_balance where tax_item;
revoke all on public.inventory_product_tax_balance,public.tax_inventory from anon;
grant select on public.inventory_product_tax_balance,public.tax_inventory to authenticated;

-- All selected rows commit together; a stale preview or missing product aborts the batch.
create function public.set_product_tax_metadata(p_items jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare item jsonb; product public.product_catalog; applied integer:=0;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(),false) then
    raise exception 'Only an active Super Admin can change tax classification' using errcode='42501';
  end if;
  if jsonb_typeof(p_items) is distinct from 'array' then raise exception 'Expected an array'; end if;
  if jsonb_array_length(p_items) not between 1 and 500 then raise exception 'Select 1 to 500 products per batch'; end if;
  if (select count(distinct x->>'product_id') from jsonb_array_elements(p_items) x) <> jsonb_array_length(p_items) then
    raise exception 'Duplicate or missing product IDs';
  end if;
  for item in select value from jsonb_array_elements(p_items) order by value->>'product_id' loop
    if jsonb_typeof(item->'tax_item') is distinct from 'boolean' or not (item ? 'expected_tax_updated_at') then
      raise exception 'Tax flag and preview version are required';
    end if;
    select * into product from public.product_catalog where id=(item->>'product_id')::uuid for update;
    if not found then raise exception 'Product no longer available. Preview again.'; end if;
    if product.tax_updated_at is distinct from (item->>'expected_tax_updated_at')::timestamptz
      or product.code is distinct from item->>'code' then
      raise exception 'Product changed since preview. Preview again.' using errcode='40001';
    end if;
    update public.product_catalog set
      tax_item=(item->>'tax_item')::boolean,
      tax_group_or_set=case when item ? 'tax_group_or_set' then item->>'tax_group_or_set' else product.tax_group_or_set end,
      tax_note=case when item ? 'tax_note' then item->>'tax_note' else product.tax_note end
    where id=product.id;
    applied:=applied+1;
  end loop;
  return applied;
end $$;
revoke all on function public.set_product_tax_metadata(jsonb) from public,anon;
grant execute on function public.set_product_tax_metadata(jsonb) to authenticated;
notify pgrst,'reload schema';
