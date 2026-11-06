-- Explicit management-only verification of reference-product relationships.
-- Merely linking product codes never transfers quantities, reservations,
-- invoice lines, POs, movement history or stock location.
create table if not exists public.catalog_reference_link_audit(
 id uuid primary key default gen_random_uuid(),
 catalog_product_id uuid not null references public.product_catalog(id) on delete restrict,
 prior_stock_product_id uuid references public.product_catalog(id) on delete restrict,
 linked_stock_product_id uuid references public.product_catalog(id) on delete restrict,
 action text not null check (action in ('link','unlink','promote')),
 reason text not null,
 reviewed_by uuid references auth.users(id) on delete set null,
 reviewed_at timestamptz not null default now()
);
alter table public.catalog_reference_link_audit enable row level security;
revoke all on public.catalog_reference_link_audit from anon,authenticated;
grant select on public.catalog_reference_link_audit to authenticated;
drop policy if exists "catalog_links_management_review" on public.catalog_reference_link_audit;
create policy "catalog_links_management_review" on public.catalog_reference_link_audit
for select to authenticated using(public.current_app_role() in ('admin','super_admin'));

create or replace function public.manage_catalog_reference_link(
 p_catalog_product_id uuid,
 p_official_stock_product_id uuid,
 p_reason text
)
returns jsonb
language plpgsql security definer
set search_path to public,auth,pg_temp
as $fn$
declare
 v_reference public.product_catalog%rowtype;
 v_stock public.product_catalog%rowtype;
 v_reason text:=trim(coalesce(p_reason,''));
 v_action text;
begin
 if auth.uid() is null or public.current_app_role() not in ('admin','super_admin') then
  raise exception 'Admin or Super Admin approval is required to link display-only products';
 end if;
 if length(v_reason)<10 or length(v_reason)>1000 then
  raise exception 'Enter a verification reason of 10 to 1,000 characters';
 end if;
 select * into v_reference from public.product_catalog
 where id=p_catalog_product_id for update;
 if not found then raise exception 'Catalog reference not found'; end if;
 if v_reference.catalog_role<>'catalog_only' then
  raise exception 'Only Catalog Only products may be linked as reference codes';
 end if;
 if p_catalog_product_id=p_official_stock_product_id then
  raise exception 'Cannot link a catalog reference to itself';
 end if;
 if p_official_stock_product_id is not null then
  select * into v_stock from public.product_catalog
  where id=p_official_stock_product_id for update;
  if not found or v_stock.catalog_role<>'stock' or v_stock.active is not true
     or v_stock.archived_at is not null then
   raise exception 'Select a current official Stock Product, not a second catalog-only code';
  end if;
 end if;
 if v_reference.official_stock_product_id is not distinct from p_official_stock_product_id then
  return jsonb_build_object('unchanged',true,'catalog_code',v_reference.code);
 end if;
 v_action:=case when p_official_stock_product_id is null then 'unlink' else 'link' end;
 perform set_config('app.catalog_classification_reviewed','yes',true);
 update public.product_catalog
 set official_stock_product_id=p_official_stock_product_id,
     official_stock_link_reason=v_reason,
     official_stock_linked_by=auth.uid(),
     official_stock_linked_at=now()
 where id=v_reference.id;
 insert into public.catalog_reference_link_audit(
 catalog_product_id,prior_stock_product_id,linked_stock_product_id,action,reason,reviewed_by)
 values(v_reference.id,v_reference.official_stock_product_id,p_official_stock_product_id,v_action,v_reason,auth.uid());
 return jsonb_build_object('catalog_code',v_reference.code,
   'official_stock_code',v_stock.code,'linked',p_official_stock_product_id is not null,
   'no_stock_transferred',true);
end $fn$;

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
   raise exception 'Remove the existing official stock-code link before promoting this independent product';
 end if;
 if coalesce(v_product.stock_qty,0)<>0 or exists(
   select 1 from public.stock_movements m
   where m.product_id=v_product.id and m.affects_balance=true
 ) then raise exception 'Product has physical stock history: reconcile before promotion'; end if;
 perform set_config('app.catalog_classification_reviewed','yes',true);
 update public.product_catalog set catalog_role='stock'
 where id=p_product_id;
 insert into public.catalog_reference_link_audit(
   catalog_product_id,action,reason,reviewed_by)
 values(p_product_id,'promote',v_reason,auth.uid());
 return jsonb_build_object('product_code',v_product.code,'promoted',true,
  'stock_added',false);
end $fn$;

revoke all on function public.manage_catalog_reference_link(uuid,uuid,text) from public;
revoke all on function public.promote_catalog_reference_to_stock(uuid,text) from public;
grant execute on function public.manage_catalog_reference_link(uuid,uuid,text) to authenticated;
grant execute on function public.promote_catalog_reference_to_stock(uuid,text) to authenticated;

-- Prevent editing classification/link through a raw product update. Authorised
-- functions above are allowed; source push via service role is also allowed.
create or replace function public.guard_catalog_classification_write()
returns trigger language plpgsql set search_path to public,auth,pg_temp
as $fn$
begin
 if (new.catalog_role,new.official_stock_product_id,new.source_sheet,new.source_spreadsheet_id)
    is not distinct from
    (old.catalog_role,old.official_stock_product_id,old.source_sheet,old.source_spreadsheet_id)
 then return new; end if;
 if auth.uid() is not null
   and coalesce(auth.role(),'')<>'service_role'
   and coalesce(current_setting('app.catalog_classification_reviewed',true),'')<>'yes'
 then raise exception 'Catalog classification/link requires the reviewed Admin workflow'; end if;
 return new;
end $fn$;

-- Enable controlled change within the reviewed RPCs; direct product edits
-- continue to be rejected by the guard.

drop trigger if exists trg_guard_catalog_classification_write_20261106 on public.product_catalog;
create trigger trg_guard_catalog_classification_write_20261106
before update of catalog_role,official_stock_product_id,source_sheet,source_spreadsheet_id
on public.product_catalog for each row
execute function public.guard_catalog_classification_write();
revoke all on function public.guard_catalog_classification_write() from public;
