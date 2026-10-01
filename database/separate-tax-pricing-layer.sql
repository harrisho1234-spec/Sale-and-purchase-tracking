-- Separate tax-only pricing layer.
-- These fields never replace normal product cost, landed cost or sales price.

alter table public.product_catalog
  add column if not exists tax_cost numeric null,
  add column if not exists tax_sale_price numeric null,
  add column if not exists tax_currency text not null default 'USD',
  add column if not exists tax_pricing_note text null;

alter table public.product_catalog
  drop constraint if exists product_catalog_tax_cost_nonnegative,
  add constraint product_catalog_tax_cost_nonnegative check (tax_cost is null or tax_cost >= 0);

alter table public.product_catalog
  drop constraint if exists product_catalog_tax_sale_price_nonnegative,
  add constraint product_catalog_tax_sale_price_nonnegative check (tax_sale_price is null or tax_sale_price >= 0);

alter table public.product_catalog
  drop constraint if exists product_catalog_tax_currency_format,
  add constraint product_catalog_tax_currency_format check (tax_currency ~ '^[A-Z]{3}$');

create or replace function public.guard_product_tax_metadata()
returns trigger
language plpgsql
set search_path to ''
as $function$
declare changed boolean;
begin
  if tg_op='INSERT' then
    changed := new.tax_item
      or new.tax_group_or_set is not null
      or new.tax_note is not null
      or new.tax_cost is not null
      or new.tax_sale_price is not null
      or new.tax_pricing_note is not null
      or upper(coalesce(new.tax_currency,'USD'))<>'USD';
  else
    changed := row(new.tax_item,new.tax_group_or_set,new.tax_note,new.tax_cost,new.tax_sale_price,new.tax_currency,new.tax_pricing_note)
      is distinct from row(old.tax_item,old.tax_group_or_set,old.tax_note,old.tax_cost,old.tax_sale_price,old.tax_currency,old.tax_pricing_note);
  end if;

  if changed then
    if auth.uid() is null or not coalesce(public.is_super_admin(),false) then
      raise exception 'Only an active Super Admin can change tax classification or tax pricing' using errcode='42501';
    end if;
    new.tax_group_or_set := nullif(btrim(new.tax_group_or_set),'');
    new.tax_note := nullif(btrim(new.tax_note),'');
    new.tax_pricing_note := nullif(btrim(new.tax_pricing_note),'');
    new.tax_currency := upper(nullif(btrim(coalesce(new.tax_currency,'USD')),''));
    if new.tax_currency is null then new.tax_currency := 'USD'; end if;
    if new.tax_currency !~ '^[A-Z]{3}$' then raise exception 'Tax currency must be a 3-letter code such as USD, EUR or CNY'; end if;
    if new.tax_cost is not null and new.tax_cost<0 then raise exception 'Tax Cost cannot be negative'; end if;
    if new.tax_sale_price is not null and new.tax_sale_price<0 then raise exception 'Tax Sale Price cannot be negative'; end if;
    if length(new.tax_group_or_set)>200 or length(new.tax_note)>2000 or length(new.tax_pricing_note)>2000 then
      raise exception 'Tax group/set must be at most 200 characters and tax notes at most 2000';
    end if;
    new.tax_updated_at := clock_timestamp();
    new.tax_updated_by := auth.uid();
  elsif tg_op='INSERT' then
    new.tax_updated_at := null;
    new.tax_updated_by := null;
    new.tax_currency := upper(coalesce(nullif(btrim(new.tax_currency),''),'USD'));
  else
    new.tax_updated_at := old.tax_updated_at;
    new.tax_updated_by := old.tax_updated_by;
  end if;
  return new;
end
$function$;

create or replace function public.set_product_tax_metadata(p_items jsonb)
returns integer
language plpgsql
set search_path to ''
as $function$
declare
  item jsonb;
  product public.product_catalog;
  applied integer:=0;
  v_new_tax boolean;
  v_tax_cost numeric;
  v_tax_sale_price numeric;
  v_tax_currency text;
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

    v_new_tax := (item->>'tax_item')::boolean;
    if not v_new_tax and exists(
      select 1 from public.tax_declared_set_components m where m.declared_product_id=product.id
    ) then
      raise exception 'Remove this product''s Declared Set components before unmarking it as a Tax Item';
    end if;

    if item ? 'tax_cost' then
      if jsonb_typeof(item->'tax_cost')='null' or nullif(trim(item->>'tax_cost'),'') is null then v_tax_cost:=null;
      else v_tax_cost:=(item->>'tax_cost')::numeric; end if;
    else v_tax_cost:=product.tax_cost; end if;

    if item ? 'tax_sale_price' then
      if jsonb_typeof(item->'tax_sale_price')='null' or nullif(trim(item->>'tax_sale_price'),'') is null then v_tax_sale_price:=null;
      else v_tax_sale_price:=(item->>'tax_sale_price')::numeric; end if;
    else v_tax_sale_price:=product.tax_sale_price; end if;

    if item ? 'tax_currency' then
      v_tax_currency:=upper(coalesce(nullif(trim(item->>'tax_currency'),''),'USD'));
    else v_tax_currency:=product.tax_currency; end if;

    update public.product_catalog
    set tax_item=v_new_tax,
        tax_group_or_set=case when item ? 'tax_group_or_set' then nullif(trim(item->>'tax_group_or_set'),'') else product.tax_group_or_set end,
        tax_note=case when item ? 'tax_note' then nullif(trim(item->>'tax_note'),'') else product.tax_note end,
        tax_cost=v_tax_cost,
        tax_sale_price=v_tax_sale_price,
        tax_currency=v_tax_currency,
        tax_pricing_note=case when item ? 'tax_pricing_note' then nullif(trim(item->>'tax_pricing_note'),'') else product.tax_pricing_note end
    where id=product.id;

    applied:=applied+1;
  end loop;
  return applied;
end
$function$;

create or replace view public.inventory_product_tax_balance as
select b.product_id,b.code,b.item_name,b.brand,b.class,b.image_url,b.on_hand,b.reserved,b.available,b.incoming,b.locations,
       p.tax_item,p.tax_group_or_set,p.tax_note,p.tax_updated_at,p.tax_updated_by,b.on_order,b.arrived_pending_receive,
       p.tax_cost,p.tax_sale_price,p.tax_currency,p.tax_pricing_note
from public.inventory_product_balance b
join public.product_catalog p on p.id=b.product_id;

create or replace view public.tax_inventory as
select product_id,code,item_name,brand,class,image_url,on_hand,reserved,available,incoming,locations,
       tax_item,tax_group_or_set,tax_note,tax_updated_at,tax_updated_by,
       tax_cost,tax_sale_price,tax_currency,tax_pricing_note
from public.inventory_product_tax_balance
where tax_item;

create or replace function public.get_tax_declared_set_components(p_declared_product_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'public','auth','pg_temp'
as $function$
declare v_result jsonb;
begin
  if not coalesce(public.can_view_inventory(),false) then raise exception 'Inventory access required'; end if;
  if not exists(select 1 from public.product_catalog where id=p_declared_product_id and active=true and tax_item=true) then
    raise exception 'Declared Tax Item not found';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',m.id,'declared_product_id',m.declared_product_id,'component_product_id',m.component_product_id,
    'required_qty',m.required_qty,'note',m.note,'code',p.code,'item_name',p.item_name,'brand',p.brand,'class',p.class,
    'image_url',p.image_url,'tax_item',p.tax_item,'tax_cost',p.tax_cost,'tax_sale_price',p.tax_sale_price,
    'tax_currency',p.tax_currency,'tax_pricing_note',p.tax_pricing_note,'on_hand',coalesce(b.on_hand,0),
    'reserved',coalesce(b.reserved,0),'available',coalesce(b.available,0),'incoming',coalesce(b.incoming,0),
    'locations',coalesce(b.locations,'[]'::jsonb),'updated_at',m.updated_at
  ) order by p.code,p.item_name),'[]'::jsonb)
  into v_result
  from public.tax_declared_set_components m
  join public.product_catalog p on p.id=m.component_product_id
  left join public.inventory_product_tax_balance b on b.product_id=p.id
  where m.declared_product_id=p_declared_product_id;

  return v_result;
end
$function$;

comment on column public.product_catalog.tax_cost is 'Tax-only cost; never used by normal costing, procurement, invoices or standard reports.';
comment on column public.product_catalog.tax_sale_price is 'Tax-only sale price; never replaces product_catalog.sales_price.';
comment on column public.product_catalog.tax_currency is 'Currency for the separate tax pricing layer only.';
comment on column public.product_catalog.tax_pricing_note is 'Optional note for the separate tax pricing layer.';
