-- New CN credits must follow the same access rule as CN approval.
-- Preserve historical CN financial corrections.
do $fix$
declare s text;
begin
 select pg_get_functiondef(p.oid) into s
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='mark_cn_credit_decision';
 if position('if w.approval_status<>''approved'' then' in s)=0
 then raise exception 'CN financial guard shape changed';end if;
 s:=replace(s,'if w.approval_status<>''approved'' then',
    'if public.current_app_role() not in (''manager'',''admin'',''super_admin'') '||
    'or not public.current_user_has_permission(''returns.approve'') then '||
     'raise exception ''Manager/Admin CN financial approval permission required'';end if;'||E'\n'||
     'if w.approval_status<>''approved'' then');
 execute s;
end $fix$;