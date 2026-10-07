-- Permanent showroom quotation registry and atomic S-YYMM-## numbering.
-- Historical sequence seeds were read from "Showroom Quotation Tracking" on 2026-10-07.
-- New October 2026 quotations therefore begin at S-2610-01.

create schema if not exists private;

create table if not exists private.showroom_quote_sequences (
  quote_month text primary key check (quote_month ~ '^[0-9]{4}$'),
  last_value integer not null check (last_value >= 0),
  updated_at timestamptz not null default now()
);

insert into private.showroom_quote_sequences (quote_month,last_value)
values
('2509',2),('2510',9),('2511',12),('2512',4),
('2601',9),('2602',6),('2603',6),('2604',12),('2605',7),('2606',3),
('2607',6),('2608',6),('2609',14)
on conflict (quote_month) do update
set last_value=greatest(private.showroom_quote_sequences.last_value,excluded.last_value),
    updated_at=now();

create table if not exists public.showroom_quotation_registry (
  id uuid primary key default gen_random_uuid(),
  quote_no text not null unique,
  quote_month text not null check (quote_month ~ '^[0-9]{4}$'),
  sequence_no integer not null check (sequence_no > 0),
  source_record_id text not null unique,
  source_name text,
  issue_date date not null,
  saved_at timestamptz not null default now(),
  source_payload jsonb not null default '{}'::jsonb
    check (jsonb_typeof(source_payload)='object'),
  customer_name text,
  customer_phone text,
  salesperson text,
  amount numeric(14,2),
  created_at timestamptz not null default now(),
  confirmed_at timestamptz,
  constraint showroom_quotation_registry_month_sequence_unique
    unique (quote_month,sequence_no)
);

create index if not exists showroom_quotation_registry_saved_at_idx
  on public.showroom_quotation_registry(saved_at desc);
create index if not exists showroom_quotation_registry_customer_idx
  on public.showroom_quotation_registry(customer_name);
create index if not exists showroom_quotation_registry_salesperson_idx
  on public.showroom_quotation_registry(salesperson);

alter table public.showroom_quotation_registry enable row level security;
revoke all on table public.showroom_quotation_registry from anon;
revoke all on table public.showroom_quotation_registry from authenticated;
grant select,delete on table public.showroom_quotation_registry to authenticated;

drop policy if exists showroom_quotation_registry_select
  on public.showroom_quotation_registry;
create policy showroom_quotation_registry_select
on public.showroom_quotation_registry
for select to authenticated
using (
  confirmed_at is not null
  and public.current_user_has_permission('sales_orders.view')
);

drop policy if exists showroom_quotation_registry_delete
  on public.showroom_quotation_registry;
create policy showroom_quotation_registry_delete
on public.showroom_quotation_registry
for delete to authenticated
using (
  (select public.current_app_role())
  = any(array['super_admin'::text,'admin'::text,'manager'::text])
);

create or replace function public.register_showroom_quotation(
  p_source_record_id text,
  p_source_name text,
  p_issue_date date,
  p_saved_at timestamptz,
  p_source_payload jsonb,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_salesperson text default null,
  p_amount numeric default null
)
returns table(id uuid,quote_no text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing public.showroom_quotation_registry%rowtype;
  v_month text;
  v_seq integer;
  v_quote_no text;
  v_id uuid;
  v_issue date;
begin
  if p_source_record_id is null
     or length(btrim(p_source_record_id)) not between 4 and 160 then
    raise exception 'Invalid source record ID';
  end if;
  if p_source_name is not null and length(p_source_name)>200 then
    raise exception 'Saved quotation name is too long';
  end if;
  if p_source_payload is null
     or jsonb_typeof(p_source_payload)<>'object'
     or octet_length(p_source_payload::text)>1500000 then
    raise exception 'Invalid quotation payload';
  end if;
  if p_customer_name is not null and length(p_customer_name)>200 then
    raise exception 'Customer name is too long';
  end if;
  if p_customer_phone is not null and length(p_customer_phone)>80 then
    raise exception 'Customer phone is too long';
  end if;
  if p_salesperson is not null and length(p_salesperson)>160 then
    raise exception 'Salesperson is too long';
  end if;
  if p_amount is not null and (p_amount<0 or p_amount>1000000000) then
    raise exception 'Invalid quotation amount';
  end if;

  select * into v_existing
  from public.showroom_quotation_registry
  where source_record_id=btrim(p_source_record_id);

  if found then
    return query select v_existing.id,v_existing.quote_no;
    return;
  end if;

  v_issue:=coalesce(p_issue_date,(timezone('Asia/Phnom_Penh',now()))::date);
  if v_issue<date '2020-01-01'
     or v_issue>((timezone('Asia/Phnom_Penh',now()))::date+interval '370 days')::date then
    raise exception 'Invalid quotation issue date';
  end if;

  v_month:=to_char(v_issue,'YYMM');

  insert into private.showroom_quote_sequences(quote_month,last_value,updated_at)
  values(v_month,1,now())
  on conflict(quote_month) do update
  set last_value=private.showroom_quote_sequences.last_value+1,
      updated_at=now()
  returning last_value into v_seq;

  v_quote_no:='S-'||v_month||'-'||lpad(v_seq::text,2,'0');
  v_id:=gen_random_uuid();

  insert into public.showroom_quotation_registry(
    id,quote_no,quote_month,sequence_no,source_record_id,source_name,
    issue_date,saved_at,source_payload,customer_name,customer_phone,
    salesperson,amount
  ) values(
    v_id,v_quote_no,v_month,v_seq,btrim(p_source_record_id),
    nullif(btrim(coalesce(p_source_name,'')),''),
    v_issue,coalesce(p_saved_at,now()),p_source_payload,
    nullif(btrim(coalesce(p_customer_name,'')),''),
    nullif(btrim(coalesce(p_customer_phone,'')),''),
    nullif(btrim(coalesce(p_salesperson,'')),''),
    p_amount
  );

  return query select v_id,v_quote_no;
end
$$;

revoke execute on function public.register_showroom_quotation(
  text,text,date,timestamptz,jsonb,text,text,text,numeric
) from public;
grant execute on function public.register_showroom_quotation(
  text,text,date,timestamptz,jsonb,text,text,text,numeric
) to anon,authenticated;

create or replace function public.confirm_showroom_quotation(
  p_source_record_id text,
  p_quote_no text,
  p_source_payload jsonb
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
begin
  if p_source_record_id is null
     or length(btrim(p_source_record_id)) not between 4 and 160 then
    raise exception 'Invalid source record ID';
  end if;
  if p_quote_no is null or p_quote_no !~ '^S-[0-9]{4}-[0-9]{2,}$' then
    raise exception 'Invalid quotation number';
  end if;
  if p_source_payload is null
     or jsonb_typeof(p_source_payload)<>'object'
     or octet_length(p_source_payload::text)>1500000 then
    raise exception 'Invalid quotation payload';
  end if;

  update public.showroom_quotation_registry
  set source_payload=p_source_payload,
      confirmed_at=coalesce(confirmed_at,now())
  where source_record_id=btrim(p_source_record_id)
    and quote_no=btrim(p_quote_no);

  return found;
end
$$;

revoke execute on function public.confirm_showroom_quotation(text,text,jsonb)
  from public;
grant execute on function public.confirm_showroom_quotation(text,text,jsonb)
  to anon,authenticated;
