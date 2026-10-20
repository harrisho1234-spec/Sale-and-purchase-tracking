-- Read-only manifest of base tables for Google Apps Script daily business-data backup.
-- Only service_role (a Supabase backend secret key) can enumerate this list.
-- The function exports metadata, never table data and never secret keys.
create or replace function public.backup_public_tables_manifest()
returns table(table_name text, order_columns text[])
language plpgsql
stable
security definer
set search_path to 'public','pg_catalog','auth','pg_temp'
as $function$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception 'Backup manifest is restricted to service_role';
  end if;
  return query
  select c.relname::text as table_name,
         (select array_agg(a.attname::text order by ord.n)
          from pg_index ix
          cross join lateral unnest(ix.indkey) with ordinality ord(attnum,n)
          join pg_attribute a on a.attrelid=c.oid and a.attnum=ord.attnum
          where ix.indrelid=c.oid and ix.indisprimary)::text[] as order_columns
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
  where n.nspname='public'
    and c.relkind in ('r','p')
    and not exists(select 1 from pg_inherits inh where inh.inhrelid=c.oid)
    and exists(select 1 from pg_index ix where ix.indrelid=c.oid and ix.indisprimary)
  order by c.relname;
end;
$function$;
revoke all on function public.backup_public_tables_manifest() from public,anon,authenticated;
grant execute on function public.backup_public_tables_manifest() to service_role;
