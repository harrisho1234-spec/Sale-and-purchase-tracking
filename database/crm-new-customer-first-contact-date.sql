-- Adds a date picker to manual CRM Customer Database entries without modifying created_at.
-- Existing RPC stays intact for older app versions.
create or replace function public.create_customer_lead_manual_dated(
 p_customer_name text,
 p_phone text,
 p_customer_category text,
 p_business_code text,
 p_stage text,
 p_interest text,
 p_next_follow_up_date date,
 p_notes text,
 p_assigned_sales_id uuid,
 p_first_contact_date date
) returns jsonb language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $fn$
declare r jsonb;v_id uuid;
begin
 if p_first_contact_date is null then
   raise exception 'Please choose a First Contact Date';end if;
 if p_first_contact_date>(now() at time zone 'Asia/Phnom_Penh')::date then
   raise exception 'First Contact Date cannot be in the future';end if;
 if p_first_contact_date<date '1900-01-01' then
   raise exception 'First Contact Date is outside the supported range';end if;
 r:=public.create_customer_lead_manual(
  p_customer_name,p_phone,p_customer_category,p_business_code,p_stage,
  p_interest,p_next_follow_up_date,p_notes,p_assigned_sales_id);
 if r->>'action'='created' then
  v_id:=(r->>'lead_id')::uuid;
  update public.customer_leads
  set first_contact_date=p_first_contact_date,last_contact_date=p_first_contact_date
  where id=v_id and created_by=auth.uid();
 end if;
 return r;
end $fn$;
revoke all on function public.create_customer_lead_manual_dated(text,text,text,text,text,text,date,text,uuid,date) from public,anon;
grant execute on function public.create_customer_lead_manual_dated(text,text,text,text,text,text,date,text,uuid,date) to authenticated;