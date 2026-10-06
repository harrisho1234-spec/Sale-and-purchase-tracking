-- Staging area for quotations handed off from limperial-showroom.
-- Applied to Supabase on 2026-10-06.

create table if not exists public.showroom_quotation_imports (
  id uuid primary key default gen_random_uuid(),
  source_system text not null default 'limperial-showroom',
  source_record_id text not null,
  source_name text,
  source_saved_at timestamptz,
  source_document_type text,
  source_quote_no text,
  source_salesperson text,
  source_payload jsonb not null default '{}'::jsonb,
  customer_name text,
  customer_phone text,
  customer_address text,
  customer_id uuid references public.customers(id) on delete set null,
  status text not null default 'imported_draft'
    check (status in ('imported_draft','ready','converted')),
  imported_by uuid not null references public.app_users(user_id),
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  converted_sales_order_id uuid references public.sales_orders(id) on delete set null,
  converted_at timestamptz,
  constraint showroom_quotation_imports_source_unique unique (source_system, source_record_id),
  constraint showroom_quotation_imports_payload_object check (jsonb_typeof(source_payload)='object')
);

create index if not exists showroom_quotation_imports_imported_by_idx
  on public.showroom_quotation_imports(imported_by, imported_at desc);
create index if not exists showroom_quotation_imports_status_idx
  on public.showroom_quotation_imports(status, imported_at desc);
create index if not exists showroom_quotation_imports_customer_idx
  on public.showroom_quotation_imports(customer_id);
create index if not exists showroom_quotation_imports_converted_order_idx
  on public.showroom_quotation_imports(converted_sales_order_id);

alter table public.showroom_quotation_imports enable row level security;
revoke all on table public.showroom_quotation_imports from anon;
grant select, insert, update, delete on table public.showroom_quotation_imports to authenticated;

drop policy if exists showroom_quotation_imports_select on public.showroom_quotation_imports;
create policy showroom_quotation_imports_select on public.showroom_quotation_imports
for select to authenticated
using (
  public.current_user_has_permission('sales_orders.view')
  and (imported_by = auth.uid() or public.can_view_all_sales())
);

drop policy if exists showroom_quotation_imports_insert on public.showroom_quotation_imports;
create policy showroom_quotation_imports_insert on public.showroom_quotation_imports
for insert to authenticated
with check (
  public.current_user_has_permission('sales_orders.create')
  and imported_by = auth.uid()
  and (customer_id is null or public.can_view_customer(customer_id))
  and converted_sales_order_id is null
);

drop policy if exists showroom_quotation_imports_update on public.showroom_quotation_imports;
create policy showroom_quotation_imports_update on public.showroom_quotation_imports
for update to authenticated
using (
  public.current_user_has_permission('sales_orders.create')
  and (imported_by = auth.uid() or public.can_view_all_sales())
)
with check (
  public.current_user_has_permission('sales_orders.create')
  and (imported_by = auth.uid() or public.can_view_all_sales())
  and (customer_id is null or public.can_view_customer(customer_id))
  and (converted_sales_order_id is null or public.can_view_sales_order(converted_sales_order_id))
);

drop policy if exists showroom_quotation_imports_delete on public.showroom_quotation_imports;
create policy showroom_quotation_imports_delete on public.showroom_quotation_imports
for delete to authenticated
using (public.is_admin_or_super());
