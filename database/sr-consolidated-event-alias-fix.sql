-- Qualify the array alias so PL/pgSQL does not confuse it with local v_source_id.
do $patch$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='submit_sr_combined_invoice_with_gifts';
 if v_sql is null then raise exception 'Consolidated invoice RPC missing';end if;
 if position('from unnest(v_sources) v_source_id where v_source_id<>p_primary_sr' in v_sql)=0
 then raise exception 'Unexpected source event loop SQL';end if;
 v_sql:=replace(v_sql,
   'select v_source_id,''invoice_conversion_requested''',
   'select eid.sr_id,''invoice_conversion_requested''');
 v_sql:=replace(v_sql,
   '''source_sr_id'',v_source_id)',
   '''source_sr_id'',eid.sr_id)');
 v_sql:=replace(v_sql,
   'from unnest(v_sources) v_source_id where v_source_id<>p_primary_sr',
   'from unnest(v_sources) as eid(sr_id) where eid.sr_id<>p_primary_sr');
 execute v_sql;
end $patch$;