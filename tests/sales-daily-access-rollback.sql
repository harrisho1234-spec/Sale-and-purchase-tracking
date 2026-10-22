-- Run as a database administrator. All test customer rows are rolled back.
begin;
do $test$
declare u record; a jsonb; result jsonb; expected_date date; lead public.customer_leads%rowtype;
begin
 for u in select user_id,role,active from public.app_users loop
  perform set_config('request.jwt.claim.sub',u.user_id::text,true);
  begin
   a:=public.get_sales_daily_access();
   if not u.active or u.role not in ('sales','manager','admin','super_admin') then
    raise exception 'TEST: forbidden account gained daily access';end if;
   if (a->>'can_write')::boolean and u.role<>'sales' then raise exception 'TEST: non-sales write';end if;
   if (a->>'can_review')::boolean and u.role not in ('manager','admin','super_admin') then raise exception 'TEST: non-management review';end if;
  exception when others then
   if sqlerrm like 'TEST:%' then raise;end if;
   if sqlerrm not in ('Active account required','Daily Report access not enabled') then raise;end if;
  end;
  if not u.active or u.role<>'super_admin' then
   begin
    perform public.configure_sales_daily_connection('');
    raise exception 'TEST: forbidden account configured connection';
   exception when others then
    if sqlerrm<>'Only Super Admin can configure Daily Report Google Sheets' then raise;end if;
   end;
  end if;
 end loop;
 perform set_config('request.jwt.claim.sub','',true);
 begin
  perform public.configure_sales_daily_connection('');
  raise exception 'TEST: null identity configured connection';
 exception when others then
  if sqlerrm<>'Only Super Admin can configure Daily Report Google Sheets' then raise;end if;
 end;
 select user_id into u from public.app_users where active and role='sales' limit 1;
 if not found then raise exception 'TEST: a Sales account is required';end if;
 perform set_config('request.jwt.claim.sub',u.user_id::text,true);
 expected_date:=(now() at time zone 'Asia/Phnom_Penh')::date-7;
 result:=public.create_customer_lead_manual_dated('Rollback test '||gen_random_uuid(),null,null,null,'Contacting',null,null,null,null,expected_date);
 select * into lead from public.customer_leads where id=(result->>'lead_id')::uuid;
 if lead.first_contact_date is distinct from expected_date or lead.last_contact_date is distinct from expected_date then
  raise exception 'TEST: selected customer date not saved';end if;
 if lead.created_at::date=expected_date then raise exception 'TEST: audit timestamp was backdated';end if;
 begin
  perform public.create_customer_lead_manual_dated('Invalid date test',null,null,null,'Contacting',null,null,null,null,expected_date+8);
  raise exception 'TEST: future contact date accepted';
 exception when others then
  if sqlerrm<>'First Contact Date cannot be in the future' then raise;end if;
 end;
end $test$;
rollback;
