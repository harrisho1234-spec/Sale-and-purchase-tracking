-- Managers may review Sales-role employees ONLY in More > Sales Activity.
-- Even if "View All Sales Activity" is accidentally granted to a Manager,
-- it never grants Admin/Super Admin/other Manager/Stock activities.
-- Admin and Super Admin retain their authorized broader scopes.
do $patch$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_sales_activity_timeline';
 if v_sql is null then raise exception 'Activity timeline RPC not installed'; end if;
 if position('v_actor_role text;' in v_sql)=0 or
    position('or (v_scope=''team'' and (u.role=''sales'' or e.actor_id=v_me))' in v_sql)=0
 then raise exception 'Activity timeline differs from reviewed version; stopping for safety'; end if;

 v_sql:=replace(v_sql,
   'v_actor_role text;',
   'v_actor_role text;'||E'\n'||
   ' v_app_role text;');

 v_sql:=replace(v_sql,
   'if public.is_super_admin() or public.current_user_has_permission(''sales_activity.view_all'') then',
   'select role into v_app_role from public.app_users '||
     'where user_id=v_me and active=true;'||E'\n'||
   ' if v_app_role=''manager'' then'||E'\n'||
   '   if public.current_user_has_permission(''sales_activity.view_team'') '||
     'or public.current_user_has_permission(''sales_activity.view_all'') then'||E'\n'||
   '     v_scope:=''team'';'||E'\n'||
   '   else'||E'\n'||
   '     raise exception ''View Team Sales Activity permission required'';'||E'\n'||
   '   end if;'||E'\n'||
   ' elsif public.is_super_admin() or public.current_user_has_permission(''sales_activity.view_all'') then');

 v_sql:=replace(v_sql,
   'if v_scope=''team'' and p_actor<>v_me and v_actor_role<>''sales'' then',
   'if v_scope=''team'' and v_actor_role<>''sales'' then');

 v_sql:=replace(v_sql,
   'or (v_scope=''team'' and (u.role=''sales'' or e.actor_id=v_me))',
   'or (v_scope=''team'' and u.role=''sales'')');

 v_sql:=replace(v_sql,
   'or (v_scope=''team'' and (u.role=''sales'' or u.user_id=v_me))',
   'or (v_scope=''team'' and u.role=''sales'')');

 execute v_sql;
end $patch$;