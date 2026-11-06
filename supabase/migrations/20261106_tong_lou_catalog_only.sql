-- Official Price Structure tab 'Tong Lou' contains catalog-reference codes only.
-- Source: Google Sheet 1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg,
-- tab gid=242894722. Snapshot: 320 distinct codes (2026-11-06).
-- No code, image, sales price, invoice, PO, DO, stock movement or quantity is deleted.
alter table public.product_catalog
  add column if not exists catalog_role text not null default 'stock',
  add column if not exists source_sheet text,
  add column if not exists source_spreadsheet_id text,
  add column if not exists official_stock_product_id uuid references public.product_catalog(id) on delete restrict,
  add column if not exists official_stock_link_reason text,
  add column if not exists official_stock_linked_at timestamptz,
  add column if not exists official_stock_linked_by uuid references auth.users(id) on delete set null;
do $constraints$ begin
 if not exists(select 1 from pg_constraint where conname='product_catalog_role_valid_20261106') then
  alter table public.product_catalog add constraint product_catalog_role_valid_20261106
  check (catalog_role in ('stock','catalog_only'));
 end if;
 if not exists(select 1 from pg_constraint where conname='product_catalog_official_link_valid_20261106') then
  alter table public.product_catalog add constraint product_catalog_official_link_valid_20261106
  check (catalog_role='catalog_only' or official_stock_product_id is null);
 end if;
end $constraints$;

create table if not exists public.product_display_source_codes (
  source_code_norm text primary key,
  source_spreadsheet_id text not null,
  source_sheet text not null,
  verified_at timestamptz not null default now()
);
alter table public.product_display_source_codes enable row level security;
-- The registry is protected from all direct API callers; only the service
-- source-sync process (or database migrations) may maintain it.
revoke all on public.product_display_source_codes from anon,authenticated;
insert into public.product_display_source_codes(source_code_norm,source_spreadsheet_id,source_sheet)
select code,'1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg','Tong Lou'
from(values ('td-1935-114 (td-1935-50+10+30+6+12+6)'),
('td-1935-12+6+8+4+4'),
('td-1935-35+7'),
('td-1935-8'),
('td-1935-204 (td-1935-75+15+50+10+30+6+12+6)'),
('td-1935-56 (td-1935-32+8+8+8)'),
('td-1935-12+6'),
('td-1935-6'),
('td-1935-10'),
('td-1935-8+4'),
('td-1945-108'),
('td-1945-60 (td-1945-40+20)'),
('td-0801-36'),
('td-0801-36 (gold)'),
('td-0801-16'),
('td-0801-24'),
('td-0801-57'),
('td-0851-10+5'),
('td-0851-6'),
('td-0851-8'),
('td-0851-10'),
('td-0819-30 (blue)'),
('td-0819-30 (black)'),
('td-0819-24 (blue)'),
('td-0819-24 (black)'),
('td-0807-15g (green)'),
('td-0807-15 (red)'),
('td-0807-40'),
('td-9935-15'),
('td-1205-16+8+8+8'),
('td-1205-14+6+6+6'),
('td-2125-8'),
('td-2118-24+6+3'),
('td-2132-1200 (td-2132-6)'),
('td-2132-4+3+4 (td-2132-6)'),
('td-2132-850 (td-2132-800)'),
('td-2132-650 (td-2132-600)'),
('td-2132-6+3'),
('td-2132-8+4'),
('td-2132-10+5'),
('td-2173-6'),
('td-2173-8'),
('td-2142-10+5'),
('td-2142-8+4'),
('td-2142-5'),
('td-1984-6'),
('td-1984-8'),
('td-2101-6'),
('td-2101-8'),
('td-2101-12+6'),
('td-0788-3 (td-03)l.1150 x w.190 x h.1100'),
('td-0788-6+2 (td-6+2)'),
('td-0788-3 (td-03)ø.400 x h.1650'),
('td-0788-1 (td-01)'),
('td-0804-16+8+23'),
('td-2156-12+6+3'),
('td-2112-8'),
('td-2128-6+3+1'),
('td-2128-8+8+4+1'),
('td-2155-10+5+4+5'),
('td-2160-6'),
('td-2160-8'),
('td-2160-10+5'),
('td-2161-8+2'),
('td-2161-10+3'),
('td-2161-40+20+3'),
('td-2161-60+20+8'),
('td-1999-40+8+4'),
('td-1999-10+5'),
('td-1999-6+3'),
('td-1999-6'),
('td-1999-8+4'),
('td-1925-60 (td-1925-40+20+5)'),
('td-1925-24+6'),
('td-1925-10+5'),
('td-2157-24+6+6 (td-1922-40)'),
('td-0773-8'),
('td-0773-6'),
('td-1917-16+8'),
('td-1917-20+6'),
('td-1917-20+10+5+3'),
('td-1096-6'),
('td-2174-15+15+5'),
('td-2174-12+6+6'),
('td-2174-8+2'),
('td-2174-6'),
('td-2174-10+5+5'),
('td-2107-9+6'),
('td-0982-8'),
('td-0982-6+6'),
('td-2143-16'),
('td-1910-8'),
('td-1915-20'),
('td-2170-6'),
('td-2170-8'),
('td-2170-8+4'),
('td-0856-3'),
('td-0840-2'),
('td-0840-3'),
('td-0840-4+1ø.400 x h.600'),
('td-0840-4+1ø.480 x h.800'),
('td-0840-6+1'),
('td-0840-8+4+1-6+3+1'),
('td-0840-10+5+5+1'),
('td-0840-12+6'),
('td-9937-6+6'),
('td-9937-12+6'),
('td-9947-12+6+3+4'),
('td-9947-12+6+3'),
('td-9940-8+2'),
('td-9948-9+2'),
('td-9948-4'),
('td-2110-8+4+4+1'),
('td-9955-12+15'),
('td-1154-8+4+4'),
('td-1154-4+4'),
('td-1948-48+8'),
('td-1928-28'),
('td-1928-43'),
('td-0876-6+3'),
('td-0876-8+4'),
('td-0876-10+5+5'),
('td-0812-10+5+3+1'),
('td-0812-8+4+1'),
('td-0812-5+3+1'),
('td-0812-5+1'),
('td-0812-4+3+1'),
('td-0812-16+8+4+4+1'),
('td-1963-20+10+25'),
('td-1912-8'),
('td-0806-5+3+1'),
('td-0806-18+6'),
('td-9954-6+3'),
('td-0887-6'),
('td-0887-8'),
('td-0887-12+6'),
('td-1135-6'),
('td-1135-8'),
('td-0880-30+15+28'),
('td-0880-20+10+26'),
('td-1916-8+16+20'),
('td-1911-6'),
('td-1911-8'),
('td-0813-6'),
('td-0813-36'),
('td-0813-60'),
('td-1019-77+13'),
('td-1921-10+5'),
('td-1921-12+6'),
('td-1913-5'),
('td-1913-6'),
('td-1913-8'),
('td-1913-10+5'),
('td-1903-8'),
('td-1901-8'),
('td-0712-168+33'),
('td-0908-8+2'),
('td-0908-10+2'),
('td-2133-8'),
('td-0802-6'),
('td-0802-8'),
('td-0802-8+4'),
('td-0948-6'),
('td-0948-8'),
('td-1964-6'),
('td-1964-8ø.500 x h.750 glass'),
('td-1964-8ø.500 x h.750'),
('td-0955-8'),
('td-0955-10'),
('td-0955-5'),
('td-0803-16+8+2'),
('td-0915-6'),
('td-0915-8'),
('td-0915-8+4'),
('td-1250-12+6'),
('td-1081-12'),
('td-0929-4 (s)ø.470 x h.700'),
('td-0929-6'),
('td-0894-8+4'),
('td-0894-8'),
('td-0894-6'),
('td-0830-10+5'),
('td-0830-8'),
('td-0830-6'),
('td-0883-6'),
('td-0864-6'),
('td-0864-8'),
('td-1145-10'),
('td-1145-8'),
('td-1145-6'),
('td-0921-10+5'),
('td-0921-8'),
('td-0921-6'),
('td-0921-6a'),
('td-0921-12+6'),
('td-0816-6'),
('td-0816-8'),
('td-0959-6+3'),
('td-0959-8+4'),
('td-0959-12+6'),
('td-0959-15+5'),
('td-2141-3'),
('td-2151-500'),
('td-2151-400'),
('td-0809-20'),
('td-2109-4'),
('td-0937-8'),
('td-0953-4'),
('td-0953-5'),
('td-0881-4'),
('td-1151-6'),
('td-1151-8'),
('td-1150-6'),
('td-1150-8'),
('td-0821-16+8+4ø.1470 x h.1300  shade'),
('td-0821-16+8+4ø.1470 x h.1300'),
('td-0808-6'),
('td-0808-12+6'),
('td-0808-18+9'),
('td-0808-8'),
('td-0808-30+20+10+5'),
('td-0821-6'),
('td-0821-8'),
('td-0821-12'),
('td-0940-6'),
('td-0940-8'),
('td-0958-5+10+5+1'),
('td-0958-3+6+3+1'),
('td-0958-8+1'),
('td-0958-6+1'),
('td-0958-5+1'),
('td-0949-6'),
('td-0949-8'),
('td-1965-8'),
('td-1965-10'),
('td-1965-12 (td-1965-8+4)'),
('td-9953-8+4'),
('td-1980-6+6+3'),
('td-1980-16+8+8+4'),
('td-0882-5'),
('td-0882-8'),
('td-1950-10'),
('td-0862-3'),
('td-0862-6+3ø.800 x h.700'),
('td-0862-6+3ø.830 x h.700'),
('td-1149-6'),
('td-1149-8'),
('td-1148-8'),
('td-1148-6'),
('td-0888-8'),
('td-0857-5'),
('td-0858-6+3'),
('td-2105-6'),
('td-2105-8'),
('td-2171-6'),
('td-2172-8'),
('td-0810-6'),
('td-0810-8'),
('td-0810-12+6+2'),
('td-0957-12+6'),
('td-9946-16+8+4'),
('td-9946-12'),
('td-9946-6'),
('td-9950-10+5'),
('td-0868-8'),
('td-1926-24+8'),
('td-0938-8'),
('td-0960-6'),
('td-0960-8'),
('td-0960-10'),
('td-0960-10+5'),
('td-1017-16'),
('td-0865-6'),
('td-0865-8'),
('td-9941-12'),
('td-9945-30'),
('td-0860-6'),
('td-0860-8'),
('td-0860-10'),
('td-0860-10+5'),
('td-1098-8'),
('td-1098-10+5'),
('td-1051-6'),
('td-1051-8'),
('td-1152-6'),
('td-1152-8'),
('td-0925-6'),
('td-0925-8'),
('td-0925-10+5'),
('td-0827-4'),
('td-0827-6+1'),
('td-0827-9+1'),
('td-1040-6+3'),
('td-1040-8'),
('td-1001-8'),
('td-1001-6'),
('td-0820-5'),
('td-0820-6'),
('td-0820-8'),
('td-0820-10'),
('td-0820-12ø.1150 x h.1000 v1'),
('td-0820-12+6'),
('td-0820-12ø.1150 x h.1000 v2'),
('td-0817-5'),
('td-0817-8'),
('td-0817-8+4'),
('td-0811-6'),
('td-0811-8'),
('td-0824-6'),
('td-0824-8'),
('td-0824-8+4ø.960 x h.1160'),
('td-0824-8+4ø.1160 x h.1160'),
('td-0824-12+6'),
('td-0831-8+3'),
('td-1959-1'),
('td-1959-6+3+2ø.420 x h.850'),
('td-1959-6+3+2ø.620 x h.950'),
('td-0852-4'),
('td-1963-6+3'),
('td-3312-14')) x(code)
on conflict(source_code_norm) do update
 set source_spreadsheet_id=excluded.source_spreadsheet_id,
 source_sheet=excluded.source_sheet,
 verified_at=now();

-- The 320 exact source codes must all exist and be safe to classify.
-- Abort if an unexpected code has physical stock or physical ledger history.
do $preflight$
declare
 v_count integer;
 v_unsafe integer;
begin
 select count(*),count(*) filter(where p.id is null or coalesce(p.stock_qty,0)<>0
  or p.source_system is distinct from 'price_structure_v3_private_push'
  or exists(select 1 from public.stock_movements sm
    where sm.product_id=p.id and sm.affects_balance=true))
 into v_count,v_unsafe
 from public.product_display_source_codes x
 left join public.product_catalog p on lower(trim(p.code))=x.source_code_norm
 where x.source_sheet='Tong Lou';
 if v_count<>320 or v_unsafe<>0 then
  raise exception 'Tong Lou classification preflight failed: % codes and % unsafe/missing records. No classification applied.',v_count,v_unsafe;
 end if;
end $preflight$;

update public.product_catalog p
set catalog_role='catalog_only',
    source_sheet='Tong Lou',
    source_spreadsheet_id='1maKk_lPYMYval44vnorm3_awwrIh5IYPKLovn_gWYtg'
from public.product_display_source_codes x
where lower(trim(p.code))=x.source_code_norm
  and x.source_sheet='Tong Lou'
  and p.source_system='price_structure_v3_private_push'
  and p.catalog_role is distinct from 'catalog_only';

-- Enforce that a display-only code cannot be used to record physical Stock
-- IN, receipt, correction, return, transfer or OUT. Historical rows remain.
create or replace function public.reject_catalog_only_stock_movement()
returns trigger language plpgsql
set search_path to public,pg_temp
as $fn$
declare v_code text; v_role text;
begin
 if new.affects_balance is not true then return new; end if;
 select code,catalog_role into v_code,v_role
 from public.product_catalog where id=new.product_id;
 if v_role='catalog_only' then
   raise exception 'Product % is Catalog Only (Tong Lou display reference). Link or promote an official stock product before receiving or releasing physical inventory.',v_code;
 end if;
 return new;
end $fn$;

drop trigger if exists trg_reject_catalog_only_stock_movement_20261106 on public.stock_movements;
create trigger trg_reject_catalog_only_stock_movement_20261106
before insert or update of product_id,affects_balance on public.stock_movements
for each row execute function public.reject_catalog_only_stock_movement();
revoke all on function public.reject_catalog_only_stock_movement() from public;

-- Avoid inventing physical balances via a new catalog-only product insert.
create or replace function public.guard_catalog_only_stock_snapshot()
returns trigger language plpgsql set search_path to public,pg_temp
as $fn$
begin
 if new.catalog_role='catalog_only' and coalesce(new.stock_qty,0)<>0 then
   raise exception 'Catalog Only product cannot have physical opening stock. Promote to Stock Product before receiving inventory.';
 end if;
 return new;
end $fn$;
drop trigger if exists trg_guard_catalog_only_stock_snapshot_20261106 on public.product_catalog;
create trigger trg_guard_catalog_only_stock_snapshot_20261106
before insert or update of catalog_role,stock_qty on public.product_catalog
for each row execute function public.guard_catalog_only_stock_snapshot();
revoke all on function public.guard_catalog_only_stock_snapshot() from public;
