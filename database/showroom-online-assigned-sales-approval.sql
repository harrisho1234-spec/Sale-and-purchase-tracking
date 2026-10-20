-- Pending approval for Showroom Visit / Online reporting salesperson assignments.
-- Reporting assignment is deliberately independent of master CRM customer ownership.
create table if not exists public.customer_activity_report_assignments (
  activity_id uuid primary key references public.customer_activity(id) on delete cascade,
  assigned_sales_id uuid not null references public.app_users(user_id),
  approved_request_id uuid,
  approved_by uuid not null references auth.users(id),
  approved_at timestamptz not null default now()
);
create table if not exists public.customer_activity_assignment_requests (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references public.customer_activity(id) on delete cascade,
  from_sales_id uuid,
  to_sales_id uuid not null references public.app_users(user_id),
  requested_by uuid not null default auth.uid() references auth.users(id),
  requested_at timestamptz not null default now(),
  request_note text,
  status text not null default 'pending' check (status in ('pending','approved','rejected')),
  reviewed_by uuid references auth.users(id),
  reviewed_at timestamptz,
  review_note text
);
create unique index if not exists customer_activity_assignment_one_pending_idx
  on public.customer_activity_assignment_requests(activity_id) where status='pending';
create index if not exists customer_activity_assignment_requests_pending_idx
  on public.customer_activity_assignment_requests(status,requested_at desc);
alter table public.customer_activity_report_assignments enable row level security;
alter table public.customer_activity_assignment_requests enable row level security;
-- Only security-definer RPCs access these tables. No direct API mutations.
revoke all on public.customer_activity_report_assignments from anon,authenticated;
revoke all on public.customer_activity_assignment_requests from anon,authenticated;

create or replace function public.request_activity_sales_assignment(
  p_activity_id uuid, p_target_sales_id uuid, p_note text default null
) returns uuid language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
  v_activity public.customer_activity%rowtype;
  v_current uuid;
  v_id uuid;
begin
  if public.current_app_role() <> 'sales' then
    raise exception 'Only Sales users may request a reassignment here';
  end if;
  if p_target_sales_id is null or not public.customer_activity_pic_is_valid(p_target_sales_id) then
    raise exception 'Select an active salesperson or Sales Manager';
  end if;
  select * into v_activity from public.customer_activity where id=p_activity_id for update;
  if not found or v_activity.activity_type not in ('showroom_visit','online') then
    raise exception 'Showroom / Online entry not found';
  end if;
  select coalesce(ra.assigned_sales_id,v_activity.assigned_sales_id)
    into v_current
    from public.customer_activity a
    left join public.customer_activity_report_assignments ra on ra.activity_id=a.id
    where a.id=p_activity_id;
  if v_activity.created_by is distinct from auth.uid()
    and v_current is distinct from auth.uid()
    and v_activity.assigned_sales_id is distinct from auth.uid() then
    raise exception 'Only the salesperson who recorded or owns this entry can request an assignment';
  end if;
  if p_target_sales_id is not distinct from v_current then
    raise exception 'This salesperson is already assigned to the entry';
  end if;
  if exists(select 1 from public.customer_activity_assignment_requests
            where activity_id=p_activity_id and status='pending') then
    raise exception 'An assignment approval is already pending for this entry';
  end if;
  insert into public.customer_activity_assignment_requests(
    activity_id,from_sales_id,to_sales_id,request_note
  ) values (
    p_activity_id,v_current,p_target_sales_id,nullif(left(btrim(coalesce(p_note,'')),2000),'')
  ) returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.get_activity_sales_assignment_state(
  p_activity_type text default null
) returns table (
  activity_id uuid, approved_sales_id uuid, approved_sales_name text,
  pending_target_id uuid, pending_target_name text, pending_requested_by uuid
)
language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $$
  select a.id,ra.assigned_sales_id,
         coalesce(nullif(u.display_name,''),u.email),
         rq.to_sales_id,coalesce(nullif(t.display_name,''),t.email),
         rq.requested_by
  from public.customer_activity a
  left join public.customer_activity_report_assignments ra on ra.activity_id=a.id
  left join public.app_users u on u.user_id=ra.assigned_sales_id
  left join public.customer_activity_assignment_requests rq
    on rq.activity_id=a.id and rq.status='pending'
    and (rq.requested_by=auth.uid()
         or public.current_app_role() in ('manager','admin','super_admin'))
  left join public.app_users t on t.user_id=rq.to_sales_id
  where public.current_app_role() in ('sales','manager','admin','super_admin')
    and (p_activity_type is null or a.activity_type=p_activity_type)
$$;

create or replace function public.get_pending_activity_sales_assignments()
returns table(
  request_id uuid,activity_id uuid,activity_type text,customer_name text,
  business_code text,from_sales_name text,to_sales_name text,
  requested_by_name text,requested_at timestamptz,request_note text
)
language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $$
  select r.id,a.id,a.activity_type,a.customer_name,a.business_code,
    coalesce(nullif(f.display_name,''),f.email,'Unassigned'),
    coalesce(nullif(t.display_name,''),t.email,'Unknown'),
    coalesce(nullif(u.display_name,''),u.email,'Sales'),
    r.requested_at,r.request_note
  from public.customer_activity_assignment_requests r
  join public.customer_activity a on a.id=r.activity_id
  left join public.app_users f on f.user_id=r.from_sales_id
  join public.app_users t on t.user_id=r.to_sales_id
  join public.app_users u on u.user_id=r.requested_by
  where public.current_app_role() in ('manager','admin','super_admin')
    and r.status='pending'
  order by r.requested_at desc
$$;

create or replace function public.review_activity_sales_assignment(
  p_request_id uuid,p_action text,p_review_note text default null
) returns text language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
 v_req public.customer_activity_assignment_requests%rowtype;
 v_activity public.customer_activity%rowtype;
 v_effective uuid;
begin
 if public.current_app_role() not in ('manager','admin','super_admin') then
   raise exception 'Sales Manager or Admin approval is required';
 end if;
 if p_action not in ('approved','rejected') then
   raise exception 'Action must be approved or rejected';
 end if;
 select * into v_req from public.customer_activity_assignment_requests
  where id=p_request_id for update;
 if not found or v_req.status<>'pending' then
   raise exception 'This request is no longer pending';
 end if;
 if v_req.requested_by=auth.uid() then
   raise exception 'You cannot approve your own assignment request';
 end if;
 select * into v_activity from public.customer_activity
    where id=v_req.activity_id for update;
 if not found then raise exception 'Activity entry not found'; end if;
 select coalesce(ra.assigned_sales_id,v_activity.assigned_sales_id)
   into v_effective
   from public.customer_activity a
   left join public.customer_activity_report_assignments ra on ra.activity_id=a.id
   where a.id=v_req.activity_id;
 if p_action='approved' then
   if v_effective is distinct from v_req.from_sales_id then
     raise exception 'Sales assignment has changed since this request. Review again';
   end if;
   if not public.customer_activity_pic_is_valid(v_req.to_sales_id) then
     raise exception 'The requested salesperson is no longer active';
   end if;
   insert into public.customer_activity_report_assignments(
     activity_id,assigned_sales_id,approved_request_id,approved_by,approved_at
   ) values (v_req.activity_id,v_req.to_sales_id,v_req.id,auth.uid(),now())
   on conflict(activity_id) do update set
     assigned_sales_id=excluded.assigned_sales_id,
     approved_request_id=excluded.approved_request_id,
     approved_by=excluded.approved_by,approved_at=excluded.approved_at;
 end if;
 update public.customer_activity_assignment_requests set
    status=p_action,reviewed_by=auth.uid(),reviewed_at=now(),
    review_note=nullif(left(btrim(coalesce(p_review_note,'')),2000),'')
   where id=v_req.id;
 return p_action;
end;
$$;

revoke all on function public.request_activity_sales_assignment(uuid,uuid,text) from public,anon;
revoke all on function public.get_activity_sales_assignment_state(text) from public,anon;
revoke all on function public.get_pending_activity_sales_assignments() from public,anon;
revoke all on function public.review_activity_sales_assignment(uuid,text,text) from public,anon;
grant execute on function public.request_activity_sales_assignment(uuid,uuid,text) to authenticated;
grant execute on function public.get_activity_sales_assignment_state(text) to authenticated;
grant execute on function public.get_pending_activity_sales_assignments() to authenticated;
grant execute on function public.review_activity_sales_assignment(uuid,text,text) to authenticated;
