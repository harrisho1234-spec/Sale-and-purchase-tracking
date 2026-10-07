-- Immutable revision history for V4 quotations.
-- The permanent quote number stays the same; Original / Rev 1 / Rev 2 snapshots
-- are stored separately while showroom_quotation_registry remains the latest/current state.

alter table public.showroom_quotation_registry
  add column if not exists current_revision integer not null default 0;

alter table public.showroom_quotation_registry
  drop constraint if exists showroom_quotation_registry_current_revision_check;
alter table public.showroom_quotation_registry
  add constraint showroom_quotation_registry_current_revision_check
  check (current_revision >= 0);

create table if not exists public.showroom_quotation_revisions (
  id uuid primary key default gen_random_uuid(),
  quotation_id uuid not null references public.showroom_quotation_registry(id) on delete cascade,
  quote_no text not null,
  revision_no integer not null check (revision_no >= 0),
  source_record_id text not null,
  source_name text,
  saved_at timestamptz not null default now(),
  source_payload jsonb not null default '{}'::jsonb,
  customer_name text,
  customer_phone text,
  salesperson text,
  amount numeric,
  created_at timestamptz not null default now(),
  constraint showroom_quotation_revisions_quote_revision_unique unique (quotation_id, revision_no)
);

create index if not exists showroom_quotation_revisions_quote_no_idx
  on public.showroom_quotation_revisions(quote_no, revision_no desc);

create index if not exists showroom_quotation_revisions_source_record_idx
  on public.showroom_quotation_revisions(source_record_id, revision_no desc);

alter table public.showroom_quotation_revisions enable row level security;

drop policy if exists showroom_quotation_revisions_select on public.showroom_quotation_revisions;
create policy showroom_quotation_revisions_select
on public.showroom_quotation_revisions
for select
to authenticated
using (
  public.current_user_has_permission('sales_orders.view')
  and exists (
    select 1
    from public.showroom_quotation_registry q
    where q.id=quotation_id
      and q.confirmed_at is not null
  )
);

grant select on public.showroom_quotation_revisions to authenticated;

insert into public.showroom_quotation_revisions(
  quotation_id,quote_no,revision_no,source_record_id,source_name,saved_at,
  source_payload,customer_name,customer_phone,salesperson,amount,created_at
)
select
  q.id,q.quote_no,
  case
    when coalesce(q.source_payload->>'quotationRevision','') ~ '^[0-9]+$'
      then (q.source_payload->>'quotationRevision')::integer
    else 0
  end,
  q.source_record_id,q.source_name,q.saved_at,q.source_payload,
  q.customer_name,q.customer_phone,q.salesperson,q.amount,
  coalesce(q.confirmed_at,q.created_at,now())
from public.showroom_quotation_registry q
where q.confirmed_at is not null
on conflict (quotation_id,revision_no) do nothing;

update public.showroom_quotation_registry q
set current_revision=case
  when coalesce(q.source_payload->>'quotationRevision','') ~ '^[0-9]+$'
    then (q.source_payload->>'quotationRevision')::integer
  else 0
end;

create or replace function public.confirm_showroom_quotation_v2(
  p_source_record_id text,
  p_quote_no text,
  p_source_payload jsonb,
  p_source_name text default null,
  p_saved_at timestamptz default null,
  p_amount numeric default null
)
returns boolean
language plpgsql
security definer
set search_path=''
as $$
declare
  v_quote public.showroom_quotation_registry%rowtype;
  v_revision integer:=0;
  v_customer text;
  v_phone text;
  v_salesperson text;
  v_saved_at timestamptz;
  v_amount numeric;
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
  if p_source_name is not null and length(p_source_name)>200 then
    raise exception 'Saved quotation name is too long';
  end if;
  if p_amount is not null and (p_amount<0 or p_amount>1000000000) then
    raise exception 'Invalid quotation amount';
  end if;

  if coalesce(p_source_payload->>'quotationRevision','') ~ '^[0-9]+$' then
    v_revision:=(p_source_payload->>'quotationRevision')::integer;
  end if;

  select *
  into v_quote
  from public.showroom_quotation_registry
  where source_record_id=btrim(p_source_record_id)
    and quote_no=btrim(p_quote_no)
  for update;

  if not found then return false; end if;

  v_customer:=nullif(btrim(coalesce(
    p_source_payload#>>'{documentFormStates,quotation,fields,quote-customer-input,value}',
    v_quote.customer_name,
    ''
  )),'');
  v_phone:=nullif(btrim(coalesce(
    p_source_payload#>>'{documentFormStates,quotation,fields,quote-tel-input,value}',
    v_quote.customer_phone,
    ''
  )),'');
  v_salesperson:=nullif(btrim(coalesce(
    p_source_payload#>>'{documentFormStates,quotation,fields,quote-sales-input,value}',
    v_quote.salesperson,
    ''
  )),'');
  v_saved_at:=coalesce(p_saved_at,now());
  v_amount:=coalesce(p_amount,v_quote.amount);

  insert into public.showroom_quotation_revisions(
    quotation_id,quote_no,revision_no,source_record_id,source_name,saved_at,
    source_payload,customer_name,customer_phone,salesperson,amount
  )
  values(
    v_quote.id,v_quote.quote_no,v_revision,v_quote.source_record_id,
    coalesce(nullif(btrim(coalesce(p_source_name,'')),''),v_quote.source_name),
    v_saved_at,p_source_payload,v_customer,v_phone,v_salesperson,v_amount
  )
  on conflict (quotation_id,revision_no) do nothing;

  if v_revision >= v_quote.current_revision then
    update public.showroom_quotation_registry
    set source_payload=p_source_payload,
        source_name=coalesce(nullif(btrim(coalesce(p_source_name,'')),''),source_name),
        saved_at=v_saved_at,
        customer_name=v_customer,
        customer_phone=v_phone,
        salesperson=v_salesperson,
        amount=v_amount,
        current_revision=v_revision,
        confirmed_at=coalesce(confirmed_at,now())
    where id=v_quote.id;
  else
    update public.showroom_quotation_registry
    set confirmed_at=coalesce(confirmed_at,now())
    where id=v_quote.id;
  end if;

  return true;
end
$$;

revoke execute on function public.confirm_showroom_quotation_v2(
  text,text,jsonb,text,timestamptz,numeric
) from public;
grant execute on function public.confirm_showroom_quotation_v2(
  text,text,jsonb,text,timestamptz,numeric
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
  return public.confirm_showroom_quotation_v2(
    p_source_record_id,p_quote_no,p_source_payload,null,null,null
  );
end
$$;

revoke execute on function public.confirm_showroom_quotation(text,text,jsonb)
  from public;
grant execute on function public.confirm_showroom_quotation(text,text,jsonb)
  to anon,authenticated;
