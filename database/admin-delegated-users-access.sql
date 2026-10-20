-- Delegated staff User & Access management. Real authorization is checked by
-- SECURITY DEFINER RPCs and Auth Edge Functions; never trust UI checkboxes.
create or replace function public.can_administer_staff_users()
returns boolean language sql stable security definer set search_path to 'public','auth','pg_temp'
as $fn$
 select exists(
   select 1 from public.app_users
   where user_id=auth.uid() and active and role in ('admin','super_admin')
 )
$fn$;
revoke all on function public.can_administer_staff_users() from public,anon;
grant execute on function public.can_administer_staff_users() to authenticated;

-- Protected powers are locked to genuine super_admin accounts regardless
-- of grants or custom roles. users.manage works only for admin/super_admin.
create or replace function public.current_user_has_permission(p_permission text)
returns boolean language sql stable security definer set search_path to 'public','auth','pg_temp'
as $fn$
 with me as (
  select user_id,role,coalesce(access_role_key,role) access_role_key
  from public.app_users where user_id=auth.uid() and active=true
 ), resolved as (
  select me.role,rt.permissions role_permissions,uo.permissions override_permissions
  from me left join public.app_access_role_templates rt
    on rt.role_key=me.access_role_key and rt.active=true
  left join public.app_user_access_overrides uo on uo.user_id=me.user_id
 )
 select coalesce((select case
  when role='super_admin' then true
  when p_permission in ('products.delete','products.tax_manage','activity_logs.view') then false
  when p_permission='users.manage' then role='admin'
  when coalesce(override_permissions,'{}'::jsonb) ? p_permission
    then coalesce((override_permissions->>p_permission)::boolean,false)
  else coalesce((role_permissions->>p_permission)::boolean,false)
  end from resolved),false);
$fn$;

-- Do not give Admin raw table updates of every other employee's permissions;
-- write only through the vetted and audited RPCs.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname='get_access_admin_snapshot';
 if v_sql is null then raise exception 'Admin snapshot RPC missing'; end if;
 if position('if not coalesce(public.is_super_admin(),false) then' in v_sql)=0 then
  raise exception 'Admin snapshot guard differs from expected';
 end if;
 v_sql:=replace(v_sql,
  'if not coalesce(public.is_super_admin(),false) then',
  'if not public.can_administer_staff_users() then');
 v_sql:=replace(v_sql,'where r.active=true;',
  'where r.active=true and (public.is_super_admin() or r.role_key<>''super_admin'');');
 v_sql:=replace(v_sql,'from public.app_user_access_overrides o;',
  'from public.app_user_access_overrides o '||
  'join public.app_users u on u.user_id=o.user_id '||
  'where public.is_super_admin() or u.role<>''super_admin'';');
 v_sql:=replace(v_sql,'from public.app_access_audit',
  'from public.app_access_audit');
 v_sql:=replace(v_sql,'order by changed_at desc',
  'where public.is_super_admin() order by changed_at desc');
 execute v_sql;
end $block$;

-- Define grantable permissions for staff only; existing Super Admin protected
-- flags cannot be toggled from another Admin.
create or replace function public.validate_delegated_access_change(
 p_target_id uuid,p_permissions jsonb
) returns void language plpgsql stable security definer
set search_path to 'public','auth','pg_temp'
as $fn$
declare v_target public.app_users%rowtype; v_role public.app_access_role_templates%rowtype;
begin
 if not public.can_administer_staff_users() then
  raise exception 'Admin or Super Admin is required';
 end if;
 select * into v_target from public.app_users where user_id=p_target_id;
 if not found then raise exception 'Target user does not exist'; end if;
 if v_target.role='super_admin' and not public.is_super_admin() then
  raise exception 'Super Admin account and permissions are protected';
 end if;
 if not public.is_super_admin() then
  if p_target_id=auth.uid() then raise exception 'Admins cannot change their own permissions'; end if;
  if coalesce(p_permissions,'{}'::jsonb) ?| array[
     'users.manage','products.delete','products.tax_manage','activity_logs.view'
  ] then
    raise exception 'One or more requested permissions are reserved for Super Admin';
  end if;
 end if;
end $fn$;
revoke all on function public.validate_delegated_access_change(uuid,jsonb) from public,anon;
grant execute on function public.validate_delegated_access_change(uuid,jsonb) to authenticated;

do $block$
declare v_sql text;
begin
 -- User-specific role overrides
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname='save_user_access_override';
 if v_sql is null or position('if not coalesce(public.is_super_admin(),false) then' in v_sql)=0
 then raise exception 'Cannot safely extend save_user_access_override'; end if;
 v_sql:=replace(v_sql,'if not coalesce(public.is_super_admin(),false) then',
  'perform public.validate_delegated_access_change(p_user_id,p_permissions);'||E'\n  '||
  'if not public.can_administer_staff_users() then');
 execute v_sql;

 -- Reset to role defaults
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname='clear_user_access_override';
 if v_sql is null or position('if not coalesce(public.is_super_admin(),false) then' in v_sql)=0
 then raise exception 'Cannot safely extend clear_user_access_override'; end if;
 v_sql:=replace(v_sql,'if not coalesce(public.is_super_admin(),false) then',
  'perform public.validate_delegated_access_change(p_user_id,''{}''::jsonb);'||E'\n  '||
  'if not public.can_administer_staff_users() then');
 execute v_sql;

 -- Assign staff role templates (not super_admin or privileged admin base templates).
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname='assign_access_role_to_user';
 if v_sql is null or position('if not coalesce(public.is_super_admin(),false) then' in v_sql)=0
 then raise exception 'Cannot safely extend assign_access_role_to_user'; end if;
 v_sql:=replace(v_sql,'if not coalesce(public.is_super_admin(),false) then',
  'perform public.validate_delegated_access_change(p_user_id,''{}''::jsonb);'||E'\n  '||
  'if not public.can_administer_staff_users() then');
 v_sql:=replace(v_sql,'if not found then' || E'\n' || '    raise exception ''Role template not found'';',
  'if not found then'||E'\n'||
  '    raise exception ''Role template not found'';'||E'\n'||
  '  end if;'||E'\n'||
  '  if not public.is_super_admin() and ('||
  'v_role.role_key=''super_admin'' or v_role.base_role=''super_admin'') then'||
  E'\n    raise exception ''Only Super Admin can assign Super Admin role'';');
 execute v_sql;

 -- Role template editor: Admin can edit lower-privilege roles, never admin/
 -- super_admin template itself or protected permission keys.
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and proname='save_access_role_template';
 if v_sql is null or position('if not coalesce(public.is_super_admin(),false) then' in v_sql)=0
 then raise exception 'Cannot safely extend save_access_role_template'; end if;
 v_sql:=replace(v_sql,'if not coalesce(public.is_super_admin(),false) then',
  'if not public.can_administer_staff_users() then');
 v_sql:=replace(v_sql,'if p_role_key=''super_admin'' then',
  'if not public.is_super_admin() and ('||
  'p_role_key in (''super_admin'',''admin'') or '||
  'exists(select 1 from public.app_access_role_templates '||
  'where role_key=p_role_key and base_role in (''admin'',''super_admin''))'||
  ') then raise exception ''Admins cannot edit Admin or Super Admin role templates''; end if;'||
  E'\n  '||
  'if not public.is_super_admin() and ('||
  'coalesce(p_permissions,''{}''::jsonb) ?| array['||
  '''users.manage'',''products.delete'',''products.tax_manage'',''activity_logs.view'']) then '||
  'raise exception ''Admins cannot grant reserved Super Admin permissions''; end if;'||
  E'\n  if p_role_key=''super_admin'' then');
 execute v_sql;
end $block$;
