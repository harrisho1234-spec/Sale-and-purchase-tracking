-- Daily Sales Plan & Result data are stored ONLY in Google Sheets.
-- Supabase holds only the Apps Script connection URL and app permissions.
create table if not exists public.sales_daily_connection(
 id boolean primary key default true check(id),
 script_url text not null default '',
 updated_at timestamptz not null default now(),
 updated_by uuid references public.app_users(user_id)
);
alter table public.sales_daily_connection enable row level security;
revoke all on public.sales_daily_connection from public,anon,authenticated;
insert into public.sales_daily_connection(id,script_url) values(true,'')
on conflict (id) do nothing;

update public.app_access_role_templates
set permissions=coalesce(permissions,'{}'::jsonb)
  || jsonb_build_object(
   'sales_daily.plan_own',
    case when role_key in ('sales','super_admin') then true else false end,
   'sales_daily.review_team',
    case when role_key in ('manager','admin','super_admin') then true else false end,
   'sales_daily.review_all',
    case when role_key in ('admin','super_admin') then true else false end
  ),
 updated_at=now()
where not(coalesce(permissions,'{}'::jsonb) ? 'sales_daily.plan_own')
   or not(coalesce(permissions,'{}'::jsonb) ? 'sales_daily.review_team')
   or not(coalesce(permissions,'{}'::jsonb) ? 'sales_daily.review_all');

create or replace function public.get_sales_daily_access()
returns jsonb language plpgsql stable security definer
set search_path='public','auth','pg_temp'
as $fn$
declare me public.app_users%rowtype;own boolean;team boolean;everyone boolean;
begin
 select * into me from public.app_users where user_id=auth.uid() and active=true;
 if not found then raise exception 'Active account required';end if;
 own:=me.role='sales' and public.current_user_has_permission('sales_daily.plan_own');
 team:=me.role in ('manager','admin','super_admin')
   and public.current_user_has_permission('sales_daily.review_team');
 everyone:=me.role in ('admin','super_admin')
   and public.current_user_has_permission('sales_daily.review_all');
 if not(own or team or everyone) then raise exception 'Daily Report access not enabled';end if;
 return jsonb_build_object(
   'user_id',me.user_id,'role',me.role,
   'display_name',coalesce(nullif(me.display_name,''),me.email),
   'can_write',own,'can_review',team or everyone,
   'scope',case when everyone then 'all_sales' when team then 'team_sales' else 'own' end,
   'sales_people',case when team or everyone then
     (select coalesce(jsonb_agg(jsonb_build_object(
       'user_id',u.user_id,'name',coalesce(nullif(u.display_name,''),u.email))
       order by u.display_name),'[]'::jsonb)
      from public.app_users u where u.active=true and u.role='sales')
      else '[]'::jsonb end
 );
end $fn$;

create or replace function public.get_sales_daily_connection()
returns jsonb language plpgsql stable security definer
set search_path='public','auth','pg_temp'
as $fn$
declare output jsonb;
begin
 perform public.get_sales_daily_access();
 select jsonb_build_object('script_url',script_url,'configured',length(script_url)>0)
 into output from public.sales_daily_connection where id=true;
 return coalesce(output,'{"configured":false,"script_url":""}'::jsonb);
end $fn$;

create or replace function public.configure_sales_daily_connection(p_script_url text)
returns jsonb language plpgsql security definer
set search_path='public','auth','pg_temp'
as $fn$
begin
 if auth.uid() is null or public.current_app_role() is distinct from 'super_admin' then
  raise exception 'Only Super Admin can configure Daily Report Google Sheets';end if;
 if p_script_url is null then p_script_url:='';end if;
 p_script_url:=btrim(p_script_url);
 if p_script_url<>'' and p_script_url !~ '^https://script[.]google[.]com/macros/s/[A-Za-z0-9_-]+/exec$' then
  raise exception 'Paste the published Google Apps Script Web App /exec URL';end if;
 update public.sales_daily_connection
 set script_url=p_script_url,updated_at=now(),updated_by=auth.uid()
 where id=true;
 return jsonb_build_object('configured',p_script_url<>'','script_url',p_script_url);
end $fn$;

revoke all on function public.get_sales_daily_access() from public,anon;
revoke all on function public.get_sales_daily_connection() from public,anon;
revoke all on function public.configure_sales_daily_connection(text) from public,anon;
grant execute on function public.get_sales_daily_access() to authenticated;
grant execute on function public.get_sales_daily_connection() to authenticated;
grant execute on function public.configure_sales_daily_connection(text) to authenticated;
