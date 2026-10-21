-- Sales Activity: read-only daily timeline of actions with an authenticated actor.
-- Dates are based on the action's CREATED timestamp in Phnom Penh, not a
-- backdated business date or an assigned/PIC employee.
-- Permissions are resolved on the server via current_user_has_permission.
update public.app_access_role_templates
set permissions=coalesce(permissions,'{}'::jsonb)
  || case base_role
    when 'super_admin' then '{"sales_activity.view_own":true,"sales_activity.view_team":true,"sales_activity.view_all":true}'::jsonb
    when 'admin' then '{"sales_activity.view_own":true,"sales_activity.view_team":true,"sales_activity.view_all":true}'::jsonb
    when 'manager' then '{"sales_activity.view_own":true,"sales_activity.view_team":true,"sales_activity.view_all":false}'::jsonb
    when 'sales' then '{"sales_activity.view_own":true,"sales_activity.view_team":false,"sales_activity.view_all":false}'::jsonb
    else '{"sales_activity.view_own":false,"sales_activity.view_team":false,"sales_activity.view_all":false}'::jsonb
    end,
 updated_at=now()
where role_key in ('super_admin','admin','manager','sales');

create or replace function public.get_sales_activity_timeline(
 p_start date default null,
 p_end date default null,
 p_actor uuid default null,
 p_action text default null,
 p_limit integer default 300
) returns jsonb language plpgsql stable security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
 v_me uuid:=auth.uid();
 v_from date:=coalesce(p_start,(now() at time zone 'Asia/Phnom_Penh')::date);
 v_to date:=coalesce(p_end,(now() at time zone 'Asia/Phnom_Penh')::date);
 v_start timestamptz;
 v_end timestamptz;
 v_scope text;
 v_actor_role text;
 v_limit integer:=least(greatest(coalesce(p_limit,300),1),500);
 v_result jsonb;
begin
 if v_me is null or not exists(select 1 from public.app_users where user_id=v_me and active=true) then
  raise exception 'An active signed-in account is required';
 end if;
 if public.is_super_admin() or public.current_user_has_permission('sales_activity.view_all') then
  v_scope:='all';
 elsif public.current_user_has_permission('sales_activity.view_team') then
  v_scope:='team';
 elsif public.current_user_has_permission('sales_activity.view_own') then
  v_scope:='own';
 else
  raise exception 'View Sales Activity permission required';
 end if;
 if v_to<v_from or v_to-v_from>30 then
   raise exception 'Select up to 31 consecutive calendar days';
 end if;
 if p_action is not null and length(p_action)>60 then
   raise exception 'Invalid activity filter';
 end if;
 v_start:=v_from::timestamp at time zone 'Asia/Phnom_Penh';
 v_end:=(v_to+1)::timestamp at time zone 'Asia/Phnom_Penh';

 if p_actor is not null then
  select role into v_actor_role from public.app_users where user_id=p_actor;
  if not found then raise exception 'Salesperson not found'; end if;
  if v_scope='own' and p_actor<>v_me then
    raise exception 'You may only view your own activity';
  end if;
  if v_scope='team' and p_actor<>v_me and v_actor_role<>'sales' then
    raise exception 'Team scope includes only Sales role accounts';
  end if;
 end if;

 with raw_events as (
  select a.id, a.created_at as happened_at,a.created_by as actor_id,
   case when lower(a.activity_type)='showroom' then 'showroom_visit'
        when lower(a.activity_type)='online' then 'online_inquiry'
        else 'customer_activity' end as activity,
   coalesce(nullif(a.customer_name,''),'Customer') as subject,
   coalesce(nullif(a.activity_type,''),'Customer activity') as details,
   null::text as document_no,
   case when a.legacy_row_key is not null then 'imported' else 'recorded' end as provenance
  from public.customer_activity a
  where a.created_by is not null and a.created_at>=v_start and a.created_at<v_end
  union all
  select f.id,f.created_at,f.created_by,'customer_followup',
   coalesce(nullif(l.customer_name,''),'Customer follow-up'),
   coalesce(nullif(f.contact_method,''),'Follow-up'),
   null::text,'recorded'
  from public.customer_lead_followups f
  left join public.customer_leads l on l.id=f.lead_id
  where f.created_by is not null and f.created_at>=v_start and f.created_at<v_end
  union all
  select o.id,o.created_at,o.created_by,'sales_order',
    coalesce(nullif(c.name,''),'Customer'),
    case when o.sales_flow_type='pre_order' then 'New SR / Pre-order' else 'New Sales Order' end,
    coalesce(nullif(o.sr_no,''),nullif(o.order_no,'')),'recorded'
  from public.sales_orders o
  left join public.customers c on c.id=o.customer_id
  where o.created_by is not null and o.created_at>=v_start and o.created_at<v_end
  union all
  select e.id,e.created_at,e.actor_user_id,
    case when e.event_type ilike '%invoice%' or e.event_type ilike '%conversion%' then 'tk_rk'
         when e.event_type ilike '%delivery%' or e.event_type ilike '%do_%' then 'delivery'
         else 'order_event' end,
    coalesce(nullif(c.name,''),'Sales document'),
    replace(coalesce(e.event_type,'document activity'),'_',' '),
    coalesce(nullif(e.document_no,''),nullif(o.sr_no,''),nullif(o.order_no,'')),'recorded'
  from public.sales_document_events e
  left join public.sales_orders o on o.id=e.sales_order_id
  left join public.customers c on c.id=o.customer_id
  where e.actor_user_id is not null and e.created_at>=v_start and e.created_at<v_end
  union all
  select d.id,d.requested_at,d.requested_by,'delivery',
    coalesce(nullif(c.name,''),'Customer'),
    'Delivery Order requested',
    coalesce(nullif(d.do_no,''),nullif(o.sr_no,''),nullif(o.order_no,'')),'recorded'
  from public.delivery_requests d
  left join public.sales_orders o on o.id=d.sales_order_id
  left join public.customers c on c.id=o.customer_id
  where d.requested_by is not null and d.requested_at>=v_start and d.requested_at<v_end
  union all
  select p.id,p.created_at,p.received_by,'payment',
    coalesce(nullif(c.name,''),'Customer'),
    'Payment recorded',coalesce(nullif(o.sr_no,''),nullif(o.order_no,'')),'recorded'
  from public.sales_payments p
  left join public.sales_orders o on o.id=p.sales_order_id
  left join public.customers c on c.id=o.customer_id
  where p.received_by is not null and p.created_at>=v_start and p.created_at<v_end
  union all
  select p.id,p.requested_at,p.requested_by,'payment',
    coalesce(nullif(c.name,''),'Customer'),
    'Payment approval requested',coalesce(nullif(o.sr_no,''),nullif(o.order_no,'')),'recorded'
  from public.sales_payment_requests p
  left join public.sales_orders o on o.id=p.sales_order_id
  left join public.customers c on c.id=o.customer_id
  where p.requested_by is not null and p.requested_at>=v_start and p.requested_at<v_end
  union all
  select r.id,r.created_at,r.created_by,'credit_note',
    coalesce(nullif(c.name,''),'Customer'),
    'Customer return / Credit Note',nullif(r.cn_no,''),'recorded'
  from public.sales_returns r
  left join public.customers c on c.id=r.customer_id
  where r.created_by is not null and r.created_at>=v_start and r.created_at<v_end
  union all
  select qi.id,qi.imported_at,qi.imported_by,'quotation',
    coalesce(nullif(qi.customer_name,''),'Customer'),
    'Quotation imported into Sales & Order Management',
    qi.source_quote_no,'recorded'
  from public.showroom_quotation_imports qi
  where qi.imported_by is not null and qi.imported_at>=v_start and qi.imported_at<v_end
 ), permitted as (
  select e.*,u.display_name as actor_name,u.role as actor_role
  from raw_events e
  join public.app_users u on u.user_id=e.actor_id
  where (v_scope='all'
       or (v_scope='team' and (u.role='sales' or e.actor_id=v_me))
       or (v_scope='own' and e.actor_id=v_me))
    and (p_actor is null or e.actor_id=p_actor)
    and (p_action is null or p_action='' or e.activity=p_action)
 ), recent as (
  select * from permitted
  order by happened_at desc,id desc
  limit (v_limit+1)
 ), entries as (
  select * from recent order by happened_at desc,id desc limit v_limit
 )
 select jsonb_build_object(
   'scope',v_scope,
   'start_date',v_from,
   'end_date',v_to,
   'timezone','Asia/Phnom_Penh',
   'truncated',(select count(*)>v_limit from recent),
   'activities',coalesce((
     select jsonb_agg(jsonb_build_object(
       'id',e.id,'timestamp',e.happened_at,
       'date',(e.happened_at at time zone 'Asia/Phnom_Penh')::date,
       'actor_id',e.actor_id,'actor_name',coalesce(nullif(e.actor_name,''),'Staff'),
       'type',e.activity,'subject',e.subject,'details',e.details,
       'document_no',e.document_no,'provenance',e.provenance
     ) order by e.happened_at desc,e.id desc)
     from entries e
    ),'[]'::jsonb),
   'staff',coalesce((
      select jsonb_agg(jsonb_build_object(
       'id',u.user_id,'name',coalesce(nullif(u.display_name,''),'Staff'),
       'role',u.role,'active',u.active
      ) order by u.display_name)
      from public.app_users u
      where (v_scope='all'
       or (v_scope='team' and (u.role='sales' or u.user_id=v_me))
       or (v_scope='own' and u.user_id=v_me))
       and (u.role in ('sales','manager','admin','super_admin') or u.user_id=v_me)
   ),'[]'::jsonb)
 ) into v_result;
 return v_result;
end;
$function$;

revoke all on function public.get_sales_activity_timeline(date,date,uuid,text,integer)
 from public,anon;
grant execute on function public.get_sales_activity_timeline(date,date,uuid,text,integer) to authenticated;
