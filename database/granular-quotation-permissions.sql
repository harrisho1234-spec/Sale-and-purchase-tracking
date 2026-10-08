-- Adds granular quotation permissions and applies them to quotation RLS.
-- Defaults preserve existing access: View follows Sales Orders View,
-- Create follows Sales Orders Create. Delete defaults to Admin/Super Admin but can be granted to any role/user.

update public.app_access_role_templates
set permissions = coalesce(permissions,'{}'::jsonb) || jsonb_build_object(
  'quotations.view',
    coalesce((permissions->>'sales_orders.view')::boolean,false),
  'quotations.create',
    coalesce((permissions->>'sales_orders.create')::boolean,false),
  'quotations.delete',
    role_key in ('admin','super_admin')
)
where active=true;

drop policy if exists showroom_quotation_registry_select on public.showroom_quotation_registry;
create policy showroom_quotation_registry_select
on public.showroom_quotation_registry
for select to authenticated
using (
  confirmed_at is not null
  and public.current_user_has_permission('quotations.view')
);

drop policy if exists showroom_quotation_registry_delete on public.showroom_quotation_registry;
create policy showroom_quotation_registry_delete
on public.showroom_quotation_registry
for delete to authenticated
using (
  public.current_user_has_permission('quotations.delete')
);

drop policy if exists showroom_quotation_revisions_select on public.showroom_quotation_revisions;
create policy showroom_quotation_revisions_select
on public.showroom_quotation_revisions
for select to authenticated
using (
  public.current_user_has_permission('quotations.view')
  and exists (
    select 1 from public.showroom_quotation_registry q
    where q.id=quotation_id and q.confirmed_at is not null
  )
);

drop policy if exists showroom_quotation_imports_select on public.showroom_quotation_imports;
create policy showroom_quotation_imports_select
on public.showroom_quotation_imports
for select to authenticated
using (
  public.current_user_has_permission('quotations.view')
  and (
    imported_by=auth.uid()
    or public.can_view_all_sales()
    or public.current_app_role() in ('super_admin','admin','manager')
  )
);

drop policy if exists showroom_quotation_imports_insert on public.showroom_quotation_imports;
create policy showroom_quotation_imports_insert
on public.showroom_quotation_imports
for insert to authenticated
with check (
  public.current_user_has_permission('quotations.create')
  and imported_by=auth.uid()
  and (customer_id is null or public.can_view_customer(customer_id))
  and converted_sales_order_id is null
);

drop policy if exists showroom_quotation_imports_update on public.showroom_quotation_imports;
create policy showroom_quotation_imports_update
on public.showroom_quotation_imports
for update to authenticated
using (
  public.current_user_has_permission('quotations.create')
  and (imported_by=auth.uid() or public.can_view_all_sales())
)
with check (
  public.current_user_has_permission('quotations.create')
  and (imported_by=auth.uid() or public.can_view_all_sales())
  and (customer_id is null or public.can_view_customer(customer_id))
  and (converted_sales_order_id is null or public.can_view_sales_order(converted_sales_order_id))
);

drop policy if exists showroom_quotation_imports_delete on public.showroom_quotation_imports;
create policy showroom_quotation_imports_delete
on public.showroom_quotation_imports
for delete to authenticated
using (
  public.current_user_has_permission('quotations.delete')
);
