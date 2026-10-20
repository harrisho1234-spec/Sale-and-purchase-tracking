-- Products: only an active Super Admin may archive/reactivate products.
-- "Delete" in the app is a reversible soft archive; historic references are never removed.
alter table public.product_catalog
 add column if not exists archived_at timestamptz,
 add column if not exists archived_by uuid references auth.users(id);

create table if not exists public.product_archive_audit(
 id uuid primary key default gen_random_uuid(),
 product_id uuid not null references public.product_catalog(id) on delete restrict,
 product_code text not null,
 action text not null check(action in ('archived','restored')),
 reason text,
 performed_by uuid not null references auth.users(id),
 performed_at timestamptz not null default now()
);
create index if not exists product_archive_audit_product_id_idx
 on public.product_archive_audit(product_id,performed_at desc);
alter table public.product_archive_audit enable row level security;
revoke all on public.product_archive_audit from public,anon,authenticated;
grant select on public.product_archive_audit to authenticated;
drop policy if exists product_archive_audit_superadmin_select on public.product_archive_audit;
create policy product_archive_audit_superadmin_select on public.product_archive_audit
 for select to authenticated using(public.is_super_admin());

-- Retire the legacy ALL policy: it let regular Admin DELETE catalog rows through REST.
-- Admin remains allowed to create and edit products, but not hard-delete.
drop policy if exists product_catalog_admin_write on public.product_catalog;
drop policy if exists product_catalog_admin_insert on public.product_catalog;
drop policy if exists product_catalog_admin_update on public.product_catalog;
create policy product_catalog_admin_insert on public.product_catalog
 for insert to authenticated with check(public.is_admin_or_super());
create policy product_catalog_admin_update on public.product_catalog
 for update to authenticated using(public.is_admin_or_super())
 with check(public.is_admin_or_super());
-- Intentionally NO DELETE policy. No end-user role may physically remove product records.

create or replace function public.guard_product_archive_status()
returns trigger language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
begin
 if TG_OP='DELETE' then
   raise exception 'Physical product deletion is disabled. Use Super Admin archive to preserve sales and stock history.';
 end if;
 if TG_OP='UPDATE' then
   if (
      old.active is distinct from new.active and coalesce(new.active,false)=false
      or old.archived_at is distinct from new.archived_at
      or old.archived_by is distinct from new.archived_by
      or (old.archived_at is not null and coalesce(new.active,false)=true)
   ) and not public.is_super_admin() then
     raise exception 'Only Super Admin can delete/archive or reactivate products.';
   end if;
 end if;
 return new;
end;
$function$;
drop trigger if exists trg_guard_product_archive_status on public.product_catalog;
create trigger trg_guard_product_archive_status
 before update or delete on public.product_catalog
 for each row execute function public.guard_product_archive_status();

-- Archive respects stock-on-hand and unfinished business documents.
create or replace function public.superadmin_archive_product(
 p_product_id uuid,
 p_reason text default null
) returns jsonb
language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
 v_product public.product_catalog%rowtype;
 v_stock numeric := 0;
 v_sales_refs integer := 0;
 v_po_refs integer := 0;
 v_open_sales integer := 0;
 v_open_po integer := 0;
 v_reason text:=nullif(left(btrim(coalesce(p_reason,'')),1000),'');
begin
 if not public.is_super_admin() then
   raise exception 'Only Super Admin can delete/archive products.';
 end if;
 if p_product_id is null then raise exception 'Choose a Product Code'; end if;
 select * into v_product from public.product_catalog where id=p_product_id for update;
 if not found then raise exception 'Product not found'; end if;
 if v_product.archived_at is not null or v_product.active=false then
   raise exception 'Product is already inactive/archived';
 end if;
 -- Check both live ledger and catalog snapshot so incomplete migrations cannot
 -- accidentally hide a product that still has quantity.
 select coalesce(sum(case when to_location_id is not null then qty else 0 end
                     -case when from_location_id is not null then qty else 0 end),0)
   into v_stock from public.stock_movements
   where product_id=p_product_id and affects_balance=true;
 if v_stock<>0 or coalesce(v_product.stock_qty,0)<>0 then
   raise exception 'Cannot delete product % while stock remains (ledger: %, catalog: %). Transfer/sell/resolve quantity first.',
     v_product.code,v_stock,v_product.stock_qty;
 end if;

 select count(*) into v_sales_refs from public.sales_order_items
  where product_id=p_product_id;
 select count(*) into v_po_refs from public.supplier_po_items
  where product_id=p_product_id;
 select count(*) into v_open_sales from public.sales_order_items soi
 join public.sales_orders so on so.id=soi.sales_order_id
 where soi.product_id=p_product_id
   and coalesce(so.status,'') not in ('cancelled','closed')
   and coalesce(soi.fulfillment_status,'') not in ('delivered','completed','cancelled','closed');
 select count(*) into v_open_po from public.supplier_po_items pi
 join public.supplier_pos sp on sp.id=pi.supplier_po_id
 where pi.product_id=p_product_id
   and coalesce(pi.historical_stock_reconciled,false)=false
   and coalesce(sp.status,'') not in ('cancelled','closed')
   and coalesce(pi.procurement_status,'') not in ('delivered','completed','cancelled','closed');
 if v_open_sales>0 or v_open_po>0 then
   raise exception 'Cannot archive %. It is linked to % unfinished Sales Order item(s) and % unfinished Supplier PO item(s). Complete or correct those transactions first.',
     v_product.code,v_open_sales,v_open_po;
 end if;

 update public.product_catalog set
   active=false,manual_override=true,archived_at=now(),archived_by=auth.uid(),updated_at=now()
 where id=p_product_id;
 -- Remove only unsent product-sheet outbox data, never financial or inventory history.
 delete from public.product_sheet_outbox where product_id=p_product_id;
 insert into public.product_archive_audit(product_id,product_code,action,reason,performed_by)
 values(p_product_id,v_product.code,'archived',v_reason,auth.uid());
 return jsonb_build_object(
   'archived',true,'product_id',p_product_id,'code',v_product.code,
   'sales_reference_count',v_sales_refs,'po_reference_count',v_po_refs,
   'message','Product archived, not physically deleted. Historical sales, PO and stock records remain.');
end;
$function$;

create or replace function public.superadmin_restore_product(
 p_product_id uuid
) returns jsonb language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare v_product public.product_catalog%rowtype;
begin
 if not public.is_super_admin() then
   raise exception 'Only Super Admin can restore products.';
 end if;
 select * into v_product from public.product_catalog
  where id=p_product_id for update;
 if not found then raise exception 'Product not found'; end if;
 if v_product.archived_at is null then
   raise exception 'Product was not archived by Super Admin';
 end if;
 update public.product_catalog
  set active=true,archived_at=null,archived_by=null,manual_override=true,updated_at=now()
  where id=p_product_id;
 insert into public.product_archive_audit(product_id,product_code,action,performed_by)
 values(p_product_id,v_product.code,'restored',auth.uid());
 return jsonb_build_object('restored',true,'product_id',p_product_id,'code',v_product.code);
end;
$function$;

-- Legacy deletion RPC now delegates to the same Super Admin-only protected archive.
create or replace function public.delete_app_product_safe(p_product_id uuid)
returns jsonb language sql security definer
set search_path to 'public','auth','pg_temp'
as $function$
  select public.superadmin_archive_product(p_product_id,null);
$function$;

revoke all on function public.superadmin_archive_product(uuid,text) from public,anon;
revoke all on function public.superadmin_restore_product(uuid) from public,anon;
revoke all on function public.delete_app_product_safe(uuid) from public,anon;
grant execute on function public.superadmin_archive_product(uuid,text) to authenticated;
grant execute on function public.superadmin_restore_product(uuid) to authenticated;
grant execute on function public.delete_app_product_safe(uuid) to authenticated;

-- User & Access: this permission is no longer grantable to Admin/custom roles.
update public.app_access_role_templates
 set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),'{products.delete}',
      case when base_role='super_admin' then 'true'::jsonb else 'false'::jsonb end,true),
     updated_at=now();
-- Remove any preexisting individualized grant for product deletion.
update public.app_user_access_overrides
 set permissions=(coalesce(permissions,'{}'::jsonb) - 'products.delete');
