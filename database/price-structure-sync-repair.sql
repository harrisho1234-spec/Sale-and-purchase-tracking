-- Price Structure -> App sync normalization.
-- Source-sheet rows are authoritative and should be active/non-manual when the sheet push claims them.
create or replace function public.normalize_price_structure_product_sync()
returns trigger
language plpgsql
set search_path to 'public','pg_temp'
as $function$
begin
  if coalesce(new.source_system,'')='price_structure_v3_private_push'
     or coalesce(new.source_row_key,'') like 'price:%' then
    new.active:=true;
    new.manual_override:=false;
    if nullif(trim(coalesce(new.source_row_key,'')),'') is null then
      new.source_row_key:='price:'||lower(trim(new.code));
    end if;
    if nullif(trim(coalesce(new.source_system,'')),'') is null then
      new.source_system:='price_structure_v3_private_push';
    end if;
  end if;
  return new;
end
$function$;

drop trigger if exists trg_normalize_price_structure_product_sync on public.product_catalog;
create trigger trg_normalize_price_structure_product_sync
before insert or update of source_system,source_row_key,active,manual_override
on public.product_catalog
for each row execute function public.normalize_price_structure_product_sync();

-- The three known sheet-owned Codes were reactivated and linked back to the Price Structure source
-- in the live migration. Future sheet pushes now keep those rows under sheet control.
