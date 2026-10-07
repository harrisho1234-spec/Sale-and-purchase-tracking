-- Prevent duplicate Product Codes across every creation/update path.
-- Codes are trimmed and compared case-insensitively.
-- The database already had a unique lower(trim(code)) index; this adds a
-- friendly guard message and a lookup RPC used by the UI.

create or replace function public.normalize_and_guard_product_code()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $$
declare
  v_existing public.product_catalog%rowtype;
begin
  new.code:=btrim(coalesce(new.code,''));

  if new.code='' then
    raise exception 'Product Code is required'
      using errcode='23514';
  end if;

  select p.*
  into v_existing
  from public.product_catalog p
  where lower(btrim(p.code))=lower(new.code)
    and (new.id is null or p.id<>new.id)
  order by p.active desc,p.created_at asc
  limit 1;

  if found then
    raise exception 'Product Code "%" already exists as "%". Use the existing product instead of creating another code.',
      new.code,coalesce(nullif(v_existing.item_name,''),v_existing.code)
      using
        errcode='23505',
        constraint='product_catalog_code_lower_uidx';
  end if;

  return new;
end
$$;

drop trigger if exists trg_normalize_and_guard_product_code on public.product_catalog;
create trigger trg_normalize_and_guard_product_code
before insert or update of code on public.product_catalog
for each row
execute function public.normalize_and_guard_product_code();

create or replace function public.lookup_product_code(
  p_code text,
  p_exclude_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
  v_code text:=btrim(coalesce(p_code,''));
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required';
  end if;

  if v_code='' then return null; end if;

  select jsonb_build_object(
    'id',p.id,
    'code',p.code,
    'item_name',p.item_name,
    'brand',p.brand,
    'active',p.active,
    'source_system',p.source_system
  )
  into v_result
  from public.product_catalog p
  where lower(btrim(p.code))=lower(v_code)
    and (p_exclude_id is null or p.id<>p_exclude_id)
  order by p.active desc,p.created_at asc
  limit 1;

  return v_result;
end
$$;

revoke execute on function public.lookup_product_code(text,uuid) from public;
grant execute on function public.lookup_product_code(text,uuid) to authenticated;
