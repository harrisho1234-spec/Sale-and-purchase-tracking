-- Follow-up security migration for the separate tax-pricing layer.
-- Tax pricing is Super-Admin-only and is intentionally kept out of product_catalog,
-- because product_catalog is readable by normal application users.

create table if not exists public.product_tax_pricing (
  product_id uuid primary key references public.product_catalog(id) on delete cascade,
  tax_cost numeric null check (tax_cost is null or tax_cost >= 0),
  tax_sale_price numeric null check (tax_sale_price is null or tax_sale_price >= 0),
  tax_currency text not null default 'USD' check (tax_currency ~ '^[A-Z]{3}$'),
  tax_pricing_note text null check (tax_pricing_note is null or length(tax_pricing_note) <= 2000),
  updated_at timestamptz not null default now(),
  updated_by uuid null
);

alter table public.product_tax_pricing enable row level security;

drop policy if exists product_tax_pricing_superadmin_select on public.product_tax_pricing;
create policy product_tax_pricing_superadmin_select
on public.product_tax_pricing for select to authenticated
using (coalesce(public.is_super_admin(),false));

drop policy if exists product_tax_pricing_superadmin_write on public.product_tax_pricing;
create policy product_tax_pricing_superadmin_write
on public.product_tax_pricing for all to authenticated
using (coalesce(public.is_super_admin(),false))
with check (coalesce(public.is_super_admin(),false));

insert into public.product_tax_pricing(product_id,tax_cost,tax_sale_price,tax_currency,tax_pricing_note,updated_at,updated_by)
select id,tax_cost,tax_sale_price,coalesce(tax_currency,'USD'),tax_pricing_note,coalesce(tax_updated_at,now()),tax_updated_by
from public.product_catalog
where tax_cost is not null or tax_sale_price is not null or tax_pricing_note is not null
on conflict (product_id) do update
set tax_cost=excluded.tax_cost,
    tax_sale_price=excluded.tax_sale_price,
    tax_currency=excluded.tax_currency,
    tax_pricing_note=excluded.tax_pricing_note,
    updated_at=excluded.updated_at,
    updated_by=excluded.updated_by;

create or replace function public.guard_product_tax_metadata()
returns trigger language plpgsql set search_path to ''
as $function$
declare changed boolean;
begin
  if tg_op='INSERT' then
    changed := new.tax_item or new.tax_group_or_set is not null or new.tax_note is not null;
  else
    changed := row(new.tax_item,new.tax_group_or_set,new.tax_note)
      is distinct from row(old.tax_item,old.tax_group_or_set,old.tax_note);
  end if;
  if changed then
    if auth.uid() is null or not coalesce(public.is_super_admin(),false) then
      raise exception 'Only an active Super Admin can change tax classification' using errcode='42501';
    end if;
    new.tax_group_or_set:=nullif(btrim(new.tax_group_or_set),'');
    new.tax_note:=nullif(btrim(new.tax_note),'');
    if length(new.tax_group_or_set)>200 or length(new.tax_note)>2000 then
      raise exception 'Tax group/set must be at most 200 characters and note at most 2000';
    end if;
    new.tax_updated_at:=clock_timestamp();
    new.tax_updated_by:=auth.uid();
  elsif tg_op='INSERT' then
    new.tax_updated_at:=null; new.tax_updated_by:=null;
  else
    new.tax_updated_at:=old.tax_updated_at; new.tax_updated_by:=old.tax_updated_by;
  end if;
  return new;
end
$function$;

create or replace function public.set_product_tax_metadata(p_items jsonb)
returns integer language plpgsql set search_path to ''
as $function$
declare
  item jsonb;
  product public.product_catalog;
  applied integer:=0;
  v_new_tax boolean;
  v_has_pricing boolean;
  v_tax_cost numeric;
  v_tax_sale_price numeric;
  v_tax_currency text;
  v_tax_pricing_note text;
  existing_pricing public.product_tax_pricing;
begin
  if auth.uid() is null or not coalesce(public.is_super_admin(),false) then
    raise exception 'Only an active Super Admin can change tax classification or tax pricing' using errcode='42501';
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
    select * into product from public.product_catalog
    where id=(item->>'product_id')::uuid for update;
    if not found then raise exception 'Product no longer available. Preview again.'; end if;
    if product.tax_updated_at is distinct from (item->>'expected_tax_updated_at')::timestamptz
       or product.code is distinct from item->>'code' then
      raise exception 'Product changed since preview. Preview again.' using errcode='40001';
    end if;

    v_new_tax:=(item->>'tax_item')::boolean;
    if not v_new_tax and exists(select 1 from public.tax_declared_set_components where declared_product_id=product.id) then
      raise exception 'Remove this product''s Declared Set components before unmarking it as a Tax Item';
    end if;

    update public.product_catalog
    set tax_item=v_new_tax,
        tax_group_or_set=case when item ? 'tax_group_or_set' then nullif(trim(item->>'tax_group_or_set'),'') else product.tax_group_or_set end,
        tax_note=case when item ? 'tax_note' then nullif(trim(item->>'tax_note'),'') else product.tax_note end
    where id=product.id;

    v_has_pricing := item ? 'tax_cost' or item ? 'tax_sale_price' or item ? 'tax_currency' or item ? 'tax_pricing_note';
    if v_has_pricing then
      select * into existing_pricing from public.product_tax_pricing where product_id=product.id for update;

      if item ? 'tax_cost' then
        if jsonb_typeof(item->'tax_cost')='null' or nullif(trim(item->>'tax_cost'),'') is null then v_tax_cost:=null;
        else v_tax_cost:=(item->>'tax_cost')::numeric; end if;
      else v_tax_cost:=existing_pricing.tax_cost; end if;

      if item ? 'tax_sale_price' then
        if jsonb_typeof(item->'tax_sale_price')='null' or nullif(trim(item->>'tax_sale_price'),'') is null then v_tax_sale_price:=null;
        else v_tax_sale_price:=(item->>'tax_sale_price')::numeric; end if;
      else v_tax_sale_price:=existing_pricing.tax_sale_price; end if;

      if item ? 'tax_currency' then v_tax_currency:=upper(coalesce(nullif(trim(item->>'tax_currency'),''),'USD'));
      else v_tax_currency:=coalesce(existing_pricing.tax_currency,'USD'); end if;

      if item ? 'tax_pricing_note' then v_tax_pricing_note:=nullif(trim(item->>'tax_pricing_note'),'');
      else v_tax_pricing_note:=existing_pricing.tax_pricing_note; end if;

      insert into public.product_tax_pricing(product_id,tax_cost,tax_sale_price,tax_currency,tax_pricing_note,updated_at,updated_by)
      values(product.id,v_tax_cost,v_tax_sale_price,v_tax_currency,v_tax_pricing_note,now(),auth.uid())
      on conflict (product_id) do update
      set tax_cost=excluded.tax_cost,tax_sale_price=excluded.tax_sale_price,tax_currency=excluded.tax_currency,
          tax_pricing_note=excluded.tax_pricing_note,updated_at=excluded.updated_at,updated_by=excluded.updated_by;
    end if;
    applied:=applied+1;
  end loop;
  return applied;
end
$function$;

drop view if exists public.tax_inventory;
drop view if exists public.inventory_product_tax_balance;

create view public.inventory_product_tax_balance as
select b.product_id,b.code,b.item_name,b.brand,b.class,b.image_url,b.on_hand,b.reserved,b.available,b.incoming,b.locations,
       p.tax_item,p.tax_group_or_set,p.tax_note,p.tax_updated_at,p.tax_updated_by,b.on_order,b.arrived_pending_receive
from public.inventory_product_balance b
join public.product_catalog p on p.id=b.product_id;

create view public.tax_inventory as
select product_id,code,item_name,brand,class,image_url,on_hand,reserved,available,incoming,locations,
       tax_item,tax_group_or_set,tax_note,tax_updated_at,tax_updated_by
from public.inventory_product_tax_balance
where tax_item;

grant select on public.inventory_product_tax_balance to authenticated;
grant select on public.tax_inventory to authenticated;

alter table public.product_catalog
  drop column if exists tax_cost,
  drop column if exists tax_sale_price,
  drop column if exists tax_currency,
  drop column if exists tax_pricing_note;

comment on table public.product_tax_pricing is
'Super-Admin-only tax pricing. Separate from normal product pricing, procurement costing and standard reports.';
