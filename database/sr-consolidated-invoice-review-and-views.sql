-- Make all existing SR/TK/RK views, legacy guards, and approval checks
-- understand that a single invoice may cover several original SRs.
-- Preserve existing signatures to avoid breaking legacy UI or financial reports.

create or replace function public.protect_consolidated_sr_identity()
returns trigger language plpgsql security definer set search_path to 'public','auth','pg_temp'
as $fn$
begin
 if (new.customer_id is distinct from old.customer_id or
     new.currency is distinct from old.currency) and exists (
   select 1 from public.sales_sr_invoice_sources src
   join public.sales_sr_invoice_parts h on h.id=src.invoice_part_id
   where src.sales_order_id=old.id and h.status in ('pending','issued')
     and (select count(*) from public.sales_sr_invoice_sources s2
          where s2.invoice_part_id=h.id)>1
 ) then
    raise exception 'Cannot change customer or currency on a source SR linked to a combined TK/RK';
 end if;
 return new;
end $fn$;
drop trigger if exists protect_consolidated_sr_identity_trg on public.sales_orders;
create trigger protect_consolidated_sr_identity_trg
 before update of customer_id,currency on public.sales_orders
 for each row execute function public.protect_consolidated_sr_identity();

do $patch$
declare v_sql text;
begin
 -- Core consolidated submission loop correction.
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='submit_sr_combined_invoice_with_gifts';
 if v_sql is null then raise exception 'Consolidated submission RPC missing';end if;
 if position('select unnest(v_sources) where unnest<>p_primary_sr' in v_sql)>0 then
  v_sql:=replace(v_sql,
    'select unnest(v_sources) where unnest<>p_primary_sr order by 1',
    'select src from unnest(v_sources) src where src<>p_primary_sr order by src');
  execute v_sql;
 end if;

 -- All linked SRs must pass the original legacy-conversion guard.
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='guard_sr_legacy_invoice_after_split';
 if position('where h.sales_order_id=new.id' in v_sql)=0 then
  raise exception 'Unexpected legacy invoice guard';
 end if;
 v_sql:=replace(v_sql,'where h.sales_order_id=new.id',
   'where exists(select 1 from public.sales_sr_invoice_sources src '||
   'where src.invoice_part_id=h.id and src.sales_order_id=new.id)');
 execute v_sql;

 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='guard_sr_legacy_request_after_split';
 if position('where h.sales_order_id=new.sales_order_id' in v_sql)=0 then
  raise exception 'Unexpected legacy SR conversion guard';
 end if;
 v_sql:=replace(v_sql,'where h.sales_order_id=new.sales_order_id',
  'where exists(select 1 from public.sales_sr_invoice_sources src '||
  'where src.invoice_part_id=h.id and src.sales_order_id=new.sales_order_id)');
 execute v_sql;

 -- Approval checks membership in the set of SRs, not only the primary SR.
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='review_sr_split_invoice';
 if position('i.sales_order_id is distinct from v_h.sales_order_id' in v_sql)=0
 then raise exception 'Unexpected SR invoice approval validator';end if;
 v_sql:=replace(v_sql,'i.sales_order_id is distinct from v_h.sales_order_id',
 'not exists(select 1 from public.sales_sr_invoice_sources src '||
 'where src.invoice_part_id=v_h.id and src.sales_order_id=i.sales_order_id)');
 -- Revalidate same-customer and currency before issuing (in addition to insertion guards).
 v_sql:=replace(v_sql,
  'if p_approve then',
  'if exists(select 1 from public.sales_sr_invoice_sources src '||
    'join public.sales_orders linked on linked.id=src.sales_order_id '||
    'where src.invoice_part_id=v_h.id '||
    'and (linked.customer_id is distinct from v_o.customer_id '||
      'or linked.currency is distinct from v_o.currency '||
      'or linked.status=''cancelled'' '||
      'or linked.sales_invoice_no is not null)) then '||
    'raise exception ''Linked SRs must stay active with the same customer and currency''; end if;'||
    E'\n if p_approve then');
 -- Make invoice-issue history visible on every original SR.
 v_sql:=replace(v_sql,
  'return case when p_approve then ''issued'' else ''rejected'' end;',
  'if p_approve then'||E'\n'||
  ' insert into public.sales_document_events(sales_order_id,event_type,document_no,note,actor_user_id,metadata)'||E'\n'||
  ' select src.sales_order_id,''invoice_issued'',v_h.invoice_no,p_note,auth.uid(),'||
   'jsonb_build_object(''split_invoice_id'',v_h.id,''consolidated'',true,''primary_sr_id'',v_h.sales_order_id)'||E'\n'||
  ' from public.sales_sr_invoice_sources src '||
  'where src.invoice_part_id=v_h.id and src.sales_order_id<>v_h.sales_order_id;'||E'\n'||
  ' end if;'||E'\n'||
  'return case when p_approve then ''issued'' else ''rejected'' end;');
 execute v_sql;

 -- SR view must include invoice header references even when that SR is a
 -- secondary source. Distinct invoice line allocations already use item IDs.
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_sr_split_invoice_summary';
 if position('from public.sales_sr_invoice_parts h where h.sales_order_id=p_order_id' in v_sql)=0 then
  raise exception 'Unexpected SR invoice summary';
 end if;
 v_sql:=replace(v_sql,
  'from public.sales_sr_invoice_parts h where h.sales_order_id=p_order_id',
  'from public.sales_sr_invoice_parts h '||
  'where exists(select 1 from public.sales_sr_invoice_sources src '||
    'where src.invoice_part_id=h.id and src.sales_order_id=p_order_id)');
 v_sql:=replace(v_sql,
   '''total'',h.invoice_total,',
   '''total'',h.invoice_total,'||
    '''source_srs'',coalesce(('||
      'select jsonb_agg(jsonb_build_object(''id'',so.id,'||
       '''no'',coalesce(so.sr_no,so.order_no),'||
       '''amount'',coalesce(('||
          'select sum(il.line_total) from public.sales_sr_invoice_part_lines il '||
          'join public.sales_order_items si on si.id=il.sales_order_item_id '||
          'where il.invoice_part_id=h.id and si.sales_order_id=so.id'||
        '),0)) order by so.order_date,so.id)'||
      ' from public.sales_sr_invoice_sources ssrc '||
      'join public.sales_orders so on so.id=ssrc.sales_order_id '||
      'where ssrc.invoice_part_id=h.id),'||
     '''[]''::jsonb),');
 execute v_sql;

 -- Manager approval UI: return source SR labels and source ID per invoice line.
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_sr_split_invoice_detail';
 if position('v_o.sales_rep_id=auth.uid()' in v_sql)=0 then
  raise exception 'Unexpected split invoice detail role guard';
 end if;
 v_sql:=replace(v_sql,'v_o.sales_rep_id=auth.uid()',
  'exists(select 1 from public.sales_sr_invoice_sources src '||
  'join public.sales_orders so on so.id=src.sales_order_id '||
  'where src.invoice_part_id=v_h.id and so.sales_rep_id=auth.uid())');
 v_sql:=replace(v_sql,
  '''invoice_no'',v_h.invoice_no,',
  '''invoice_no'',v_h.invoice_no,'||
    '''source_srs'',coalesce(('||
       'select jsonb_agg(jsonb_build_object('||
         '''id'',so.id,''no'',coalesce(so.sr_no,so.order_no),'||
         '''amount'',coalesce(('||
            'select sum(il.line_total) from public.sales_sr_invoice_part_lines il '||
            'join public.sales_order_items si on si.id=il.sales_order_item_id '||
            'where il.invoice_part_id=v_h.id and si.sales_order_id=so.id),0),'||
         '''payments_recorded'',coalesce(('||
            'select sum(p.amount) from public.sales_payments p '||
            'where p.sales_order_id=so.id),0)'||
       ') order by so.order_date,so.id)'||
       ' from public.sales_sr_invoice_sources src '||
       'join public.sales_orders so on so.id=src.sales_order_id '||
       'where src.invoice_part_id=v_h.id),'||
    '''[]''::jsonb),');
 v_sql:=replace(v_sql,
  '''code'',l.product_code,''name'',l.item_name,''qty'',l.qty,''amount'',l.line_total)',
  '''code'',l.product_code,''name'',l.item_name,''qty'',l.qty,''amount'',l.line_total,'||
    '''sr_no'',(select coalesce(so.sr_no,so.order_no) '||
       'from public.sales_order_items si join public.sales_orders so on so.id=si.sales_order_id '||
       'where si.id=l.sales_order_item_id))');
 execute v_sql;

 -- Document Flow: show invoice progress on every source SR. Count ONLY
 -- the quantity originating from the current SR (not all invoice lines).
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_visible_sr_split_invoice_list';
 if position('where x.invoice_part_id=h.id' in v_sql)=0
   or position('where h.sales_order_id=o.id' in v_sql)=0 then
  raise exception 'Unexpected visible SR invoice list';
 end if;
 v_sql:=replace(v_sql,
  'where x.invoice_part_id=h.id',
  'where x.invoice_part_id=h.id '||
    'and exists(select 1 from public.sales_order_items si '||
    'where si.id=x.sales_order_item_id and si.sales_order_id=o.id)');
 v_sql:=replace(v_sql,'where h.sales_order_id=o.id',
  'where exists(select 1 from public.sales_sr_invoice_sources src '||
   'where src.invoice_part_id=h.id and src.sales_order_id=o.id)');
 execute v_sql;
end $patch$;
