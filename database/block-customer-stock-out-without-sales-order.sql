-- Prevent customer stock from leaving inventory as a generic manual OUT.
-- Customer deliveries must always originate from an existing Sales Order / Customer Fulfillment item.

create or replace function public.stock_out_customer_conflict(
  p_reference_type text,
  p_reference_no text,
  p_counterparty text
)
returns text
language plpgsql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_ref_type text:=lower(trim(coalesce(p_reference_type,'')));
  v_ref text:=trim(coalesce(p_reference_no,''));
  v_party text:=trim(coalesce(p_counterparty,''));
  v_party_norm text;
begin
  if v_ref_type='sales_order' then
    return 'The selected reference is a Sales Order / customer document.';
  end if;

  if v_ref ~* '^\s*(RK|TK|SR)[0-9]' then
    return 'RK / TK / SR customer references cannot be used for a generic Stock OUT.';
  end if;

  if v_party<>'' then
    v_party_norm:=lower(regexp_replace(v_party,'[^a-zA-Z0-9]','','g'));
    if v_party_norm<>'' and exists(
      select 1
      from public.customers c
      where lower(regexp_replace(coalesce(c.name,''),'[^a-zA-Z0-9]','','g'))=v_party_norm
    ) then
      return 'The destination / counterparty matches an existing customer.';
    end if;
  end if;

  return null;
end;
$function$;

grant execute on function public.stock_out_customer_conflict(text,text,text) to authenticated;

create or replace function public.guard_manual_stock_out_movement()
returns trigger
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_conflict text;
begin
  if lower(coalesce(new.movement_type,''))<>'out' then
    return new;
  end if;

  if coalesce(new.note,'') not ilike 'Stock OUT Destination / Purpose:%' then
    raise exception 'Every generic Stock OUT requires a non-customer destination / purpose. Customer deliveries must use Customer Fulfillment.';
  end if;

  v_conflict:=public.stock_out_customer_conflict(new.reference_type,new.reference_no,new.counterparty);
  if v_conflict is not null then
    raise exception '% Sales must create the Sales Order first, then Stock must release it from Customer Fulfillment.',v_conflict;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_manual_stock_out_movement on public.stock_movements;
create trigger trg_guard_manual_stock_out_movement
before insert on public.stock_movements
for each row execute function public.guard_manual_stock_out_movement();

create or replace function public.guard_manual_stock_out_request()
returns trigger
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_conflict text;
begin
  if lower(coalesce(new.action_type,''))<>'manual_movement'
     or lower(coalesce(new.payload->>'movement_type',''))<>'out' then
    return new;
  end if;

  if coalesce(new.payload->>'note','') not ilike 'Stock OUT Destination / Purpose:%' then
    raise exception 'Every generic Stock OUT requires a non-customer destination / purpose. Customer deliveries must use Customer Fulfillment.';
  end if;

  v_conflict:=public.stock_out_customer_conflict(
    new.payload->>'reference_type',
    new.payload->>'reference_no',
    new.payload->>'counterparty'
  );

  if v_conflict is not null then
    raise exception '% Sales must create the Sales Order first, then Stock must release it from Customer Fulfillment.',v_conflict;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_guard_manual_stock_out_request on public.stock_action_requests;
create trigger trg_guard_manual_stock_out_request
before insert on public.stock_action_requests
for each row execute function public.guard_manual_stock_out_request();
