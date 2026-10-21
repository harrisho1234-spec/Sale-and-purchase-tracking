-- Give existing custom access-role templates a sensible Sales Activity default
-- only where the new key is missing; never replace explicit existing settings.
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
where role_key<>base_role
 and not (coalesce(permissions,'{}'::jsonb) ?| array[
   'sales_activity.view_own','sales_activity.view_team','sales_activity.view_all'
 ]);
-- For partially configured custom templates, fill each missing permission only.
update public.app_access_role_templates
set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),
 '{sales_activity.view_own}',case when base_role in ('sales','manager','admin','super_admin') then 'true'::jsonb else 'false'::jsonb end,true),updated_at=now()
where not(coalesce(permissions,'{}'::jsonb) ? 'sales_activity.view_own');
update public.app_access_role_templates
set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),
 '{sales_activity.view_team}',case when base_role in ('manager','admin','super_admin') then 'true'::jsonb else 'false'::jsonb end,true),updated_at=now()
where not(coalesce(permissions,'{}'::jsonb) ? 'sales_activity.view_team');
update public.app_access_role_templates
set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),
 '{sales_activity.view_all}',case when base_role in ('admin','super_admin') then 'true'::jsonb else 'false'::jsonb end,true),updated_at=now()
where not(coalesce(permissions,'{}'::jsonb) ? 'sales_activity.view_all');