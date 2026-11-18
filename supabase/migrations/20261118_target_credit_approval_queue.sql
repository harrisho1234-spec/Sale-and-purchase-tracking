-- Permission-scoped queue for the central Approvals screen.
-- Reuses the previously installed audited credit-decision RPC.
create or replace function public.get_pending_sales_target_credit_requests()
returns jsonb language sql stable security definer
set search_path=public,auth,pg_temp as $body$
 select case when auth.uid() is not null
  and public.current_app_role() in ('admin','super_admin')
  and public.can_access_sales_targets('targets.manage')
 then coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',q.id,'order_id',q.order_id,'reason',q.reason,
     'requested_at',q.requested_at,'requested_by',q.requested_by,
     'shares',coalesce((
       select jsonb_agg(jsonb_build_object(
         'id',split.value->>'id',
         'name',coalesce(nullif(a.display_name,''),nullif(p.full_name,''),'Staff'),
         'percentage',(split.value->>'percentage')::numeric
       ) order by coalesce(a.display_name,p.full_name,'Staff'))
       from jsonb_array_elements(q.proposed) split
       left join public.app_users a on a.user_id=(split.value->>'id')::uuid
       left join public.sales_target_people p on p.id=(split.value->>'id')::uuid
     ),'[]'::jsonb)
   ) order by q.requested_at desc)
   from (
     select r.* from public.sales_target_credit_requests r
     where r.status='pending' and r.requested_by<>auth.uid()
     order by r.requested_at desc limit 100
   ) q
 ),'[]'::jsonb)
 else '[]'::jsonb end;
$body$;
revoke all on function public.get_pending_sales_target_credit_requests() from public,anon;
grant execute on function public.get_pending_sales_target_credit_requests() to authenticated;
