-- Adds separate Showroom (S) and Project (P) quotation sequences,
-- requires customer/project name + salesperson for new permanent quotations,
-- and exposes a safe active salesperson list for Limperial V4.
-- Applied to Supabase on 2026-10-07.

alter table private.showroom_quote_sequences
  add column if not exists quote_prefix text;

update private.showroom_quote_sequences
set quote_prefix='S'
where quote_prefix is null or btrim(quote_prefix)='';

alter table private.showroom_quote_sequences
  alter column quote_prefix set default 'S',
  alter column quote_prefix set not null;

alter table private.showroom_quote_sequences
  drop constraint if exists showroom_quote_sequences_quote_prefix_check;
alter table private.showroom_quote_sequences
  add constraint showroom_quote_sequences_quote_prefix_check
  check (quote_prefix in ('S','P'));

alter table private.showroom_quote_sequences
  drop constraint if exists showroom_quote_sequences_pkey;
alter table private.showroom_quote_sequences
  add primary key (quote_prefix, quote_month);

alter table public.showroom_quotation_registry
  add column if not exists quote_prefix text;

update public.showroom_quotation_registry
set quote_prefix=case when quote_no like 'P-%' then 'P' else 'S' end
where quote_prefix is null or btrim(quote_prefix)='';

alter table public.showroom_quotation_registry
  alter column quote_prefix set default 'S',
  alter column quote_prefix set not null;

alter table public.showroom_quotation_registry
  drop constraint if exists showroom_quotation_registry_quote_prefix_check;
alter table public.showroom_quotation_registry
  add constraint showroom_quotation_registry_quote_prefix_check
  check (quote_prefix in ('S','P'));

alter table public.showroom_quotation_registry
  drop constraint if exists showroom_quotation_registry_month_sequence_unique;
alter table public.showroom_quotation_registry
  drop constraint if exists showroom_quotation_registry_prefix_month_sequence_unique;
alter table public.showroom_quotation_registry
  add constraint showroom_quotation_registry_prefix_month_sequence_unique
  unique (quote_prefix,quote_month,sequence_no);

create or replace function public.register_showroom_quotation_v2(
  p_source_record_id text,
  p_source_name text,
  p_issue_date date,
  p_saved_at timestamptz,
  p_source_payload jsonb,
  p_customer_name text default null,
  p_customer_phone text default null,
  p_salesperson text default null,
  p_amount numeric default null,
  p_quote_prefix text default 'S'
)
returns table(id uuid,quote_no text)
language plpgsql
security definer
set search_path=''
as $$
declare
  v_existing public.showroom_quotation_registry%rowtype;
  v_prefix text;
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
  if p_customer_name is null or btrim(p_customer_name)='' then
    raise exception 'Customer / Project Name is required';
  end if;
  if p_customer_name is not null and length(p_customer_name)>200 then
    raise exception 'Customer / Project Name is too long';
  end if;
  if p_salesperson is null or btrim(p_salesperson)='' then
    raise exception 'Salesperson is required';
  end if;
  if p_salesperson is not null and length(p_salesperson)>160 then
    raise exception 'Salesperson is too long';
  end if;
  if p_customer_phone is not null and length(p_customer_phone)>80 then
    raise exception 'Customer phone is too long';
  end if;
  if p_amount is not null and (p_amount<0 or p_amount>1000000000) then
    raise exception 'Invalid quotation amount';
  end if;

  v_prefix:=upper(btrim(coalesce(p_quote_prefix,'S')));
  if v_prefix not in ('S','P') then
    raise exception 'Quotation type must be Showroom (S) or Project (P)';
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

  insert into private.showroom_quote_sequences(quote_prefix,quote_month,last_value,updated_at)
  values(v_prefix,v_month,1,now())
  on conflict(quote_prefix,quote_month) do update
  set last_value=private.showroom_quote_sequences.last_value+1,
      updated_at=now()
  returning last_value into v_seq;

  v_quote_no:=v_prefix||'-'||v_month||'-'||lpad(v_seq::text,2,'0');
  v_id:=gen_random_uuid();

  insert into public.showroom_quotation_registry(
    id,quote_no,quote_prefix,quote_month,sequence_no,source_record_id,source_name,
    issue_date,saved_at,source_payload,customer_name,customer_phone,
    salesperson,amount
  ) values(
    v_id,v_quote_no,v_prefix,v_month,v_seq,btrim(p_source_record_id),
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

revoke execute on function public.register_showroom_quotation_v2(
  text,text,date,timestamptz,jsonb,text,text,text,numeric,text
) from public;
grant execute on function public.register_showroom_quotation_v2(
  text,text,date,timestamptz,jsonb,text,text,text,numeric,text
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
  if p_quote_no is null or p_quote_no !~ '^[SP]-[0-9]{4}-[0-9]{2,}$' then
    raise exception 'Invalid quotation number';
  end if;
  if p_source_payload is null
     or jsonb_typeof(p_source_payload)<>'object'
     or octet_length(p_source_payload::text)>1500000 then
    raise exception 'Invalid quotation payload';
  end if;

  update public.showroom_quotation_registry
  set source_payload=p_source_payload,
      customer_name=nullif(btrim(coalesce(
        p_source_payload#>>'{documentFormStates,quotation,fields,quote-customer-input,value}',
        customer_name,
        ''
      )),''),
      salesperson=nullif(btrim(coalesce(
        p_source_payload#>>'{documentFormStates,quotation,fields,quote-sales-input,value}',
        salesperson,
        ''
      )),''),
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

create or replace function public.list_showroom_salespeople()
returns table(display_name text, role text)
language sql
stable
security definer
set search_path=''
as $
  select x.display_name, 'sales'::text as role
  from (
    values
      (1, 'Ouk Nary'),
      (2, 'Hout Pichbopha'),
      (3, 'Koem Nalis'),
      (4, 'Pay Pheara'),
      (5, 'Rithy Sotheary')
  ) as x(sort_order, display_name)
  where exists (
    select 1
    from public.app_users u
    where u.active is true
      and (
        btrim(u.display_name)=x.display_name
      )
  )
  order by x.sort_order;
$;

revoke execute on function public.list_showroom_salespeople() from public;
grant execute on function public.list_showroom_salespeople() to anon,authenticated;
