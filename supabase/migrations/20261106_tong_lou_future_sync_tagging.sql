-- Future private Price Structure pushes will classify new 'Tong Lou' codes
-- from the verified source-code registry before any stock opening balance.
-- Explicit Admin promotions remain Stock Product through later syncs.
alter table public.product_catalog
add column if not exists catalog_classification_locked boolean not null default false;

create or replace function public.tag_display_catalog_from_verified_source()
returns trigger language plpgsql
set search_path to public,pg_temp
as $fn$
declare v_sheet public.product_display_source_codes%rowtype;
begin
 if coalesce(new.source_system,'') <> 'price_structure_v3_private_push'
    or new.catalog_classification_locked=true then return new; end if;
 select * into v_sheet from public.product_display_source_codes
 where source_code_norm=lower(trim(new.code))
 and source_sheet='Tong Lou'
 and source_spreadsheet_id='1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg';
 if not found then return new; end if;
 if coalesce(new.stock_qty,0)<>0 then
   if tg_op='INSERT' then
     raise exception 'Tong Lou catalog-only item % cannot open physical stock. Verify official stock code first.',new.code;
   end if;
   return new; -- Retain legitimate existing physical stock history.
 end if;
 if tg_op='UPDATE' and exists(
  select 1 from public.stock_movements m
  where m.product_id=new.id and m.affects_balance=true
 ) then return new; end if;
 new.catalog_role:='catalog_only';
 new.source_sheet:=v_sheet.source_sheet;
 new.source_spreadsheet_id:=v_sheet.source_spreadsheet_id;
 return new;
end $fn$;

drop trigger if exists trg_tag_display_catalog_from_source_20261106 on public.product_catalog;
create trigger trg_tag_display_catalog_from_source_20261106
before insert or update of source_last_synced_at on public.product_catalog
for each row execute function public.tag_display_catalog_from_verified_source();
revoke all on function public.tag_display_catalog_from_verified_source() from public;

-- A controlled Promotion must persist even when the code remains on Tong Lou.
create or replace function public.guard_catalog_classification_write()
returns trigger language plpgsql set search_path to public,auth,pg_temp
as $fn$
begin
 if (new.catalog_role,new.official_stock_product_id,new.source_sheet,
     new.source_spreadsheet_id,new.catalog_classification_locked)
    is not distinct from
    (old.catalog_role,old.official_stock_product_id,old.source_sheet,
     old.source_spreadsheet_id,old.catalog_classification_locked)
 then return new; end if;
 if auth.uid() is not null
   and coalesce(auth.role(),'')<>'service_role'
   and coalesce(current_setting('app.catalog_classification_reviewed',true),'')<>'yes'
 then raise exception 'Catalog classification/link requires the reviewed Admin workflow'; end if;
 return new;
end $fn$;
drop trigger if exists trg_guard_catalog_classification_write_20261106 on public.product_catalog;
create trigger trg_guard_catalog_classification_write_20261106
before update of catalog_role,official_stock_product_id,source_sheet,
 source_spreadsheet_id,catalog_classification_locked
on public.product_catalog for each row
execute function public.guard_catalog_classification_write();

create or replace function public.promote_catalog_reference_to_stock(
 p_product_id uuid,p_reason text
)
returns jsonb language plpgsql security definer
set search_path to public,auth,pg_temp
as $fn$
declare v_product public.product_catalog%rowtype;
 v_reason text:=trim(coalesce(p_reason,''));
begin
 if auth.uid() is null or public.current_app_role() not in ('admin','super_admin') then
   raise exception 'Admin or Super Admin approval is required for catalog promotion';
 end if;
 if length(v_reason)<10 or length(v_reason)>1000 then
   raise exception 'Enter a promotion reason of 10 to 1,000 characters';
 end if;
 select * into v_product from public.product_catalog where id=p_product_id for update;
 if not found then raise exception 'Catalog product not found'; end if;
 if v_product.catalog_role<>'catalog_only' then
   raise exception 'This product is already an official Stock Product';
 end if;
 if v_product.official_stock_product_id is not null then
   raise exception 'Remove its linked official stock-code reference before promoting it independently';
 end if;
 if coalesce(v_product.stock_qty,0)<>0 or exists(
   select 1 from public.stock_movements m
   where m.product_id=v_product.id and m.affects_balance=true
 ) then raise exception 'Product has physical stock history: reconcile before promotion'; end if;
 perform set_config('app.catalog_classification_reviewed','yes',true);
 update public.product_catalog
 set catalog_role='stock', catalog_classification_locked=true
 where id=p_product_id;
 insert into public.catalog_reference_link_audit(
   catalog_product_id,action,reason,reviewed_by)
 values(p_product_id,'promote',v_reason,auth.uid());
 return jsonb_build_object('product_code',v_product.code,'promoted',true,
  'stock_added',false);
end $fn$;
revoke all on function public.promote_catalog_reference_to_stock(uuid,text) from public;
grant execute on function public.promote_catalog_reference_to_stock(uuid,text) to authenticated;
