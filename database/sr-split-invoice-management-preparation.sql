-- Allow Manager/Admin/Super Admin to prepare a split invoice on any SR,
-- while Sales remains restricted to their own SR. Approval always requires a different user.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='submit_sr_split_invoice';
 if v_sql is null then raise exception 'Split invoice submission function missing'; end if;
 v_sql:=replace(v_sql,
  'if public.current_app_role()<>''sales'' or not public.current_user_has_permission(''sales_orders.convert_request'') then',
  'if public.current_app_role() not in (''sales'',''manager'',''admin'',''super_admin'') or not public.current_user_has_permission(''sales_orders.convert_request'') then');
 v_sql:=replace(v_sql,
  'if v_o.sales_rep_id is distinct from auth.uid() then',
  'if public.current_app_role()=''sales'' and v_o.sales_rep_id is distinct from auth.uid() then');
 execute v_sql;
end $block$;
