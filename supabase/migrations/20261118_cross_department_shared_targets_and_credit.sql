-- Cross-department target participants, shared goals, and approved sales-credit allocation.
-- This is an additive reporting layer. Financial/invoice data and existing 100%
-- business/rep target plans are not altered.
create table if not exists public.sales_target_staff_settings (
  person_id uuid primary key,
  source text not null check (source in ('app','target_only')),
  showroom boolean not null default false,
  project boolean not null default false,
  include_in_targets boolean not null default true,
  internal_account boolean not null default false,
  notes text,
  updated_by uuid not null,
  updated_at timestamptz not null default now(),
  check (not internal_account or not include_in_targets)
);

create table if not exists public.sales_target_shared_goals (
  id uuid primary key default gen_random_uuid(),
  year integer not null check (year between 2020 and 2100),
  label text not null check (length(btrim(label)) between 2 and 120),
  scope text not null check (scope in ('showroom','project','cross_department','shared_people')),
  mode text not null check (mode in ('pooled','split')),
  annual_target numeric(18,2) not null check (annual_target>0),
  active boolean not null default true,
  created_by uuid not null,
  updated_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sales_target_shared_goal_members (
  goal_id uuid not null references public.sales_target_shared_goals(id) on delete cascade,
  person_id uuid not null,
  percentage numeric(9,4),
  primary key (goal_id,person_id),
  check (percentage is null or percentage between 0 and 100)
);

create table if not exists public.sales_target_credit_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.sales_orders(id),
  proposed jsonb not null check (jsonb_typeof(proposed)='array'),
  reason text not null check (length(btrim(reason)) between 5 and 500),
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  decided_by uuid,
  decided_at timestamptz,
  decision_note text
);
create unique index if not exists sales_target_credit_one_pending
  on public.sales_target_credit_requests(order_id) where status='pending';

create table if not exists public.sales_target_credit_shares (
  order_id uuid not null references public.sales_orders(id),
  person_id uuid not null,
  percentage numeric(9,4) not null check (percentage>0 and percentage<=100),
  request_id uuid not null references public.sales_target_credit_requests(id),
  updated_at timestamptz not null default now(),
  primary key (order_id,person_id)
);
create index if not exists sales_target_credit_person_idx on public.sales_target_credit_shares(person_id);

create table if not exists public.sales_target_credit_audit (
  id bigint generated always as identity primary key,
  request_id uuid not null,
  action text not null check (action in ('proposed','approved','rejected')),
  actor uuid not null,
  happened_at timestamptz not null default now(),
  detail jsonb not null default '{}'::jsonb
);
create index if not exists sales_target_credit_audit_request_idx
  on public.sales_target_credit_audit(request_id,happened_at);

alter table public.sales_target_staff_settings enable row level security;
alter table public.sales_target_shared_goals enable row level security;
alter table public.sales_target_shared_goal_members enable row level security;
alter table public.sales_target_credit_requests enable row level security;
alter table public.sales_target_credit_shares enable row level security;
alter table public.sales_target_credit_audit enable row level security;

-- No direct public Data API CRUD: access goes through permission-checked RPCs.
revoke all on public.sales_target_staff_settings from public,anon,authenticated;
revoke all on public.sales_target_shared_goals from public,anon,authenticated;
revoke all on public.sales_target_shared_goal_members from public,anon,authenticated;
revoke all on public.sales_target_credit_requests from public,anon,authenticated;
revoke all on public.sales_target_credit_shares from public,anon,authenticated;
revoke all on public.sales_target_credit_audit from public,anon,authenticated;
revoke all on sequence public.sales_target_credit_audit_id_seq from public,anon,authenticated;

-- LP1 is an internal/test account. It does not receive default staff sales credit.
insert into public.sales_target_staff_settings
  (person_id,source,showroom,project,include_in_targets,internal_account,notes,updated_by)
select u.user_id,'app',false,false,false,true,'Internal/test transactions',u.user_id
from public.app_users u
where lower(regexp_replace(btrim(coalesce(u.display_name,'')),'\s+','','g'))='lp1'
on conflict (person_id) do nothing;

create or replace function public.get_sales_target_sharing_workspace(p_year integer)
returns jsonb language plpgsql stable security definer
set search_path=public,auth,pg_temp as $body$
declare v_people jsonb; v_goals jsonb; v_credit jsonb; v_requests jsonb;
begin
 if p_year<2020 or p_year>2100 then raise exception 'Invalid target year'; end if;
 if not (public.can_access_sales_targets('targets.manage')
      or public.can_access_sales_targets('targets.view_team')
      or public.can_access_sales_targets('targets.view_company')) then
   raise exception 'Target workspace access required';
 end if;

 with available as (
   select u.user_id id,coalesce(nullif(u.display_name,''),nullif(u.email,''),u.user_id::text)::text name,
     'app'::text source,u.active,(u.role='sales')::boolean is_sales
   from public.app_users u
   where u.role='sales'
     or exists(select 1 from public.sales_orders o where o.sales_rep_id=u.user_id)
     or exists(select 1 from public.sales_target_staff_settings st where st.person_id=u.user_id and st.source='app')
     or exists(select 1 from public.sales_target_shared_goal_members gm where gm.person_id=u.user_id)
   union all
   select p.id,p.full_name,'target_only',p.status='active',true
   from public.sales_target_people p
 )
 select coalesce(jsonb_agg(jsonb_build_object(
   'id',a.id,'name',a.name,'source',a.source,'active',a.active,
   'showroom',coalesce(st.showroom,a.source='app' and a.is_sales),
   'project',coalesce(st.project,false),
   'internal',coalesce(st.internal_account,
      a.source='app' and lower(regexp_replace(btrim(a.name),'\s+','','g'))='lp1'),
   'eligible',coalesce(st.include_in_targets,
      not (a.source='app' and lower(regexp_replace(btrim(a.name),'\s+','','g'))='lp1'))
 ) order by a.name),'[]'::jsonb) into v_people
 from available a left join public.sales_target_staff_settings st
   on st.person_id=a.id and st.source=a.source;

 select coalesce(jsonb_agg(jsonb_build_object(
   'id',g.id,'year',g.year,'label',g.label,'scope',g.scope,'mode',g.mode,
   'annual_target',g.annual_target,'active',g.active,'members',
     coalesce((select jsonb_agg(jsonb_build_object('id',m.person_id,'percentage',m.percentage)
       order by m.person_id) from public.sales_target_shared_goal_members m where m.goal_id=g.id),'[]'::jsonb)
 ) order by g.label),'[]'::jsonb) into v_goals
 from public.sales_target_shared_goals g where g.year=p_year;

 -- Only shares for source orders visible through the existing Sales Report
 -- in this target year; events may come from previous-year sales orders.
 with visible_orders as (
   select distinct r.order_id from public.get_sales_report_rows_v6() r
   where extract(year from r.order_date)=p_year
 )
 select coalesce(jsonb_agg(jsonb_build_object(
    'order_id',s.order_id,'id',s.person_id,'percentage',s.percentage
 ) order by s.order_id,s.person_id),'[]'::jsonb) into v_credit
 from public.sales_target_credit_shares s join visible_orders o on o.order_id=s.order_id;

 select coalesce(jsonb_agg(jsonb_build_object(
    'id',r.id,'order_id',r.order_id,'reason',r.reason,'proposed',r.proposed,
    'requested_at',r.requested_at,'requested_by',r.requested_by,
    'status',r.status,'decision_note',r.decision_note
 ) order by r.requested_at desc),'[]'::jsonb) into v_requests
 from public.sales_target_credit_requests r
 where r.status='pending'
   and public.can_view_sales_order(r.order_id);

 return jsonb_build_object('people',v_people,'goals',v_goals,
                           'credits',v_credit,'requests',v_requests);
end $body$;

create or replace function public.save_sales_target_staff_settings(
  p_person_id uuid,p_source text,p_showroom boolean,p_project boolean,
  p_internal boolean,p_eligible boolean,p_notes text default null
) returns boolean language plpgsql security definer
set search_path=public,auth,pg_temp as $body$
begin
 if not public.can_access_sales_targets('targets.manage') then
   raise exception 'Target management permission required'; end if;
 if p_source not in ('app','target_only')
    or (p_source='app' and not exists(select 1 from public.app_users where user_id=p_person_id))
    or (p_source='target_only' and not exists(select 1 from public.sales_target_people where id=p_person_id))
 then raise exception 'Staff profile not found'; end if;
 if p_internal and p_eligible then raise exception 'Internal accounts cannot be included in default targets'; end if;
 insert into public.sales_target_staff_settings
  (person_id,source,showroom,project,include_in_targets,internal_account,notes,updated_by,updated_at)
 values (p_person_id,p_source,coalesce(p_showroom,false),coalesce(p_project,false),
         coalesce(p_eligible,false),coalesce(p_internal,false),left(nullif(btrim(coalesce(p_notes,'')),''),500),auth.uid(),now())
 on conflict (person_id) do update set
   source=excluded.source,showroom=excluded.showroom,project=excluded.project,
   include_in_targets=excluded.include_in_targets,internal_account=excluded.internal_account,
   notes=excluded.notes,updated_by=excluded.updated_by,updated_at=now();
 return true;
end $body$;

create or replace function public.save_sales_target_shared_goal(
 p_goal_id uuid,p_year integer,p_label text,p_scope text,p_mode text,
 p_annual_target numeric,p_members jsonb,p_active boolean default true
) returns uuid language plpgsql security definer
set search_path=public,auth,pg_temp as $body$
declare v_id uuid; v_item jsonb; v_person uuid; v_pct numeric; v_sum numeric:=0;
        v_seen uuid[]:='{}'::uuid[];
begin
 if not public.can_access_sales_targets('targets.manage') then
   raise exception 'Target management permission required'; end if;
 if p_year not between 2020 and 2100 or length(btrim(coalesce(p_label,''))) not between 2 and 120
   or p_scope not in ('showroom','project','cross_department','shared_people')
   or p_mode not in ('pooled','split') or p_annual_target<=0 then
   raise exception 'Invalid shared target'; end if;
 if jsonb_typeof(p_members)<>'array' or jsonb_array_length(p_members)<1 or jsonb_array_length(p_members)>30 then
   raise exception 'Choose 1–30 participating staff'; end if;
 for v_item in select value from jsonb_array_elements(p_members) loop
   v_person:=(v_item->>'id')::uuid;
   if v_person=any(v_seen) then raise exception 'Duplicate staff in shared target'; end if;
   v_seen:=array_append(v_seen,v_person);
   if not (exists(select 1 from public.app_users where user_id=v_person)
        or exists(select 1 from public.sales_target_people where id=v_person)) then
     raise exception 'Target participant not found'; end if;
   if exists(select 1 from public.sales_target_staff_settings st
      where st.person_id=v_person and (st.internal_account or not st.include_in_targets)) then
     raise exception 'Excluded/internal staff cannot join a shared target'; end if;
   if p_mode='split' then
     v_pct:=(v_item->>'percentage')::numeric;
     if v_pct<=0 or v_pct>100 then raise exception 'Member percentages must be greater than zero'; end if;
     v_sum:=v_sum+v_pct;
   end if;
 end loop;
 if p_mode='split' and abs(v_sum-100)>0.0001 then raise exception 'Member percentages must total exactly 100'; end if;
 if p_goal_id is null then
   insert into public.sales_target_shared_goals(year,label,scope,mode,annual_target,active,created_by,updated_by)
   values(p_year,btrim(p_label),p_scope,p_mode,p_annual_target,coalesce(p_active,true),auth.uid(),auth.uid())
   returning id into v_id;
 else
   update public.sales_target_shared_goals set label=btrim(p_label),scope=p_scope,mode=p_mode,
       annual_target=p_annual_target,active=coalesce(p_active,true),updated_by=auth.uid(),updated_at=now()
   where id=p_goal_id and year=p_year returning id into v_id;
   if v_id is null then raise exception 'Shared target not found for this year'; end if;
   delete from public.sales_target_shared_goal_members where goal_id=v_id;
 end if;
 insert into public.sales_target_shared_goal_members(goal_id,person_id,percentage)
 select v_id,(x.value->>'id')::uuid,
   case when p_mode='split' then (x.value->>'percentage')::numeric else null::numeric end
 from jsonb_array_elements(p_members) x;
 return v_id;
end $body$;

create or replace function public.propose_sales_target_credit(
 p_order_id uuid,p_shares jsonb,p_reason text
) returns uuid language plpgsql security definer
set search_path=public,auth,pg_temp as $body$
declare v_id uuid; v_item jsonb;v_person uuid;v_pct numeric;v_total numeric:=0;v_seen uuid[]:='{}'::uuid[];
begin
 if auth.uid() is null or public.current_app_role() not in ('manager','admin','super_admin')
   or not (public.can_access_sales_targets('targets.view_team')
        or public.can_access_sales_targets('targets.manage')) then
   raise exception 'Management permission required to propose sales credit'; end if;
 if not exists(select 1 from public.sales_orders where id=p_order_id)
   or not public.can_view_sales_order(p_order_id) then raise exception 'Sales order not available'; end if;
 if jsonb_typeof(p_shares)<>'array' or jsonb_array_length(p_shares) not between 1 and 15
   or length(btrim(coalesce(p_reason,''))) not between 5 and 500 then
   raise exception 'Provide 1–15 people and a reason of 5–500 characters'; end if;
 for v_item in select value from jsonb_array_elements(p_shares) loop
   v_person:=(v_item->>'id')::uuid;v_pct:=(v_item->>'percentage')::numeric;
   if v_person=any(v_seen) then raise exception 'Duplicate credit participant'; end if;
   v_seen:=array_append(v_seen,v_person);
   if v_pct<=0 or v_pct>100 then raise exception 'Each credit share must be above 0%%'; end if;
   if not (exists(select 1 from public.app_users where user_id=v_person)
        or exists(select 1 from public.sales_target_people where id=v_person)) then
      raise exception 'Unknown target participant'; end if;
   if exists(select 1 from public.sales_target_staff_settings st where st.person_id=v_person
       and (st.internal_account or not st.include_in_targets)) then
      raise exception 'Excluded/internal account cannot receive credit'; end if;
   v_total:=v_total+v_pct;
 end loop;
 if abs(v_total-100)>0.0001 then raise exception 'Sales credit must total exactly 100%%'; end if;
 insert into public.sales_target_credit_requests(order_id,proposed,reason,requested_by)
 values(p_order_id,p_shares,btrim(p_reason),auth.uid()) returning id into v_id;
 insert into public.sales_target_credit_audit(request_id,action,actor,detail)
 values(v_id,'proposed',auth.uid(),jsonb_build_object('shares',p_shares,'reason',btrim(p_reason)));
 return v_id;
end $body$;

create or replace function public.decide_sales_target_credit(
 p_request_id uuid,p_approve boolean,p_note text default null
) returns boolean language plpgsql security definer
set search_path=public,auth,pg_temp as $body$
declare r public.sales_target_credit_requests%rowtype;
begin
 if auth.uid() is null or public.current_app_role() not in ('admin','super_admin')
   or not public.can_access_sales_targets('targets.manage') then
   raise exception 'Admin target-approval permission required'; end if;
 select * into r from public.sales_target_credit_requests where id=p_request_id for update;
 if not found or r.status<>'pending' then raise exception 'Pending request not found'; end if;
 if r.requested_by=auth.uid() then raise exception 'Requester cannot approve their own credit proposal'; end if;
 if p_approve then
   delete from public.sales_target_credit_shares where order_id=r.order_id;
   insert into public.sales_target_credit_shares(order_id,person_id,percentage,request_id)
   select r.order_id,(x.value->>'id')::uuid,(x.value->>'percentage')::numeric,r.id
   from jsonb_array_elements(r.proposed) x;
 end if;
 update public.sales_target_credit_requests set
   status=case when p_approve then 'approved' else 'rejected' end,
   decided_by=auth.uid(),decided_at=now(),decision_note=left(coalesce(p_note,''),500)
 where id=r.id;
 insert into public.sales_target_credit_audit(request_id,action,actor,detail)
 values(r.id,case when p_approve then 'approved' else 'rejected' end,auth.uid(),
   jsonb_build_object('note',left(coalesce(p_note,''),500),'order_id',r.order_id));
 return true;
end $body$;

-- No anonymous/default execution on privileged RPCs.
revoke all on function public.get_sales_target_sharing_workspace(integer) from public,anon;
revoke all on function public.save_sales_target_staff_settings(uuid,text,boolean,boolean,boolean,boolean,text) from public,anon;
revoke all on function public.save_sales_target_shared_goal(uuid,integer,text,text,text,numeric,jsonb,boolean) from public,anon;
revoke all on function public.propose_sales_target_credit(uuid,jsonb,text) from public,anon;
revoke all on function public.decide_sales_target_credit(uuid,boolean,text) from public,anon;
grant execute on function public.get_sales_target_sharing_workspace(integer) to authenticated;
grant execute on function public.save_sales_target_staff_settings(uuid,text,boolean,boolean,boolean,boolean,text) to authenticated;
grant execute on function public.save_sales_target_shared_goal(uuid,integer,text,text,text,numeric,jsonb,boolean) to authenticated;
grant execute on function public.propose_sales_target_credit(uuid,jsonb,text) to authenticated;
grant execute on function public.decide_sales_target_credit(uuid,boolean,text) to authenticated;
