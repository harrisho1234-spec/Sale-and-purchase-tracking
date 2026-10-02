-- Guided History Repair review assistant.
-- Adds terminal manual review decisions, an audit trail, multi-line historical allocations,
-- and guided conflict resolution. All review actions preserve physical stock movements.

create table if not exists public.historical_reconstruction_resolutions (
  id uuid primary key default gen_random_uuid(),
  legacy_history_id bigint not null unique references public.stock_legacy_history(id) on delete cascade,
  resolution_type text not null check (resolution_type in ('duplicate_ignore','already_represented','manual_match','split_match')),
  target_type text null check (target_type is null or target_type in ('sales_delivery','sales_return','po_receipt')),
  resolution_data jsonb not null default '{}'::jsonb,
  note text null,
  stock_impact text not null default 'none' check (stock_impact='none'),
  resolved_by uuid null references public.app_users(user_id) on delete set null,
  resolved_at timestamptz not null default now()
);

create table if not exists public.historical_reconstruction_review_audit (
  id uuid primary key default gen_random_uuid(),
  legacy_history_id bigint not null references public.stock_legacy_history(id) on delete cascade,
  action text not null,
  before_state jsonb null,
  after_state jsonb null,
  note text null,
  stock_impact text not null default 'none' check (stock_impact='none'),
  acted_by uuid null references public.app_users(user_id) on delete set null,
  acted_at timestamptz not null default now()
);

alter table public.historical_reconstruction_links
drop constraint if exists historical_reconstruction_links_legacy_history_id_key;
create unique index if not exists ux_historical_reconstruction_link_history_target
on public.historical_reconstruction_links(legacy_history_id,target_item_id);

CREATE OR REPLACE FUNCTION public.apply_historical_reconstruction_safe_matches(p_types text[] DEFAULT ARRAY['sales_delivery'::text, 'sales_return'::text, 'po_receipt'::text])
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_run_id uuid;
  v_boundary date;
  v_row record;
  v_success integer:=0;
  v_failed integer:=0;
  v_sales integer:=0;
  v_returns integer:=0;
  v_po integer:=0;
  v_rec_id uuid;
  v_live_received numeric:=0;
  v_hist_qty numeric:=0;
  v_result jsonb:='[]'::jsonb;
  v_preview jsonb;
begin
  if not public.current_user_has_permission('inventory.reconcile') then
    raise exception 'Historical reconciliation permission required';
  end if;

  select boundary_date into v_boundary
  from public.historical_reconstruction_config
  where id=true;

  if v_boundary is null then
    raise exception 'Historical reconstruction boundary is not configured';
  end if;

  if p_types is null or cardinality(p_types)=0 then
    raise exception 'Choose at least one reconstruction type';
  end if;

  if exists(
    select 1 from unnest(p_types) x
    where x not in ('sales_delivery','sales_return','po_receipt')
  ) then
    raise exception 'Unknown reconstruction type';
  end if;

  select public.get_historical_reconstruction_preview(null,null,null,1) into v_preview;

  insert into public.historical_reconstruction_runs(
    boundary_date,preview_snapshot,run_type,created_by
  )
  values(v_boundary,v_preview,'apply',auth.uid())
  returning id into v_run_id;

  for v_row in
    select *
    from public.historical_reconstruction_candidates_internal() historical_reconstruction_candidates_internal
    where classification='safe'
      and target_type=any(p_types)
      and not exists(
        select 1 from public.historical_reconstruction_resolutions rr
        where rr.legacy_history_id=historical_reconstruction_candidates_internal.legacy_history_id
      )
    order by
      case target_type when 'sales_delivery' then 1 when 'sales_return' then 2 else 3 end,
      movement_date,legacy_history_id
  loop
    begin
      perform pg_advisory_xact_lock(hashtextextended('historical-reconstruction:'||v_row.legacy_history_id::text,0));

      if exists(
        select 1 from public.historical_reconstruction_links
        where legacy_history_id=v_row.legacy_history_id
      ) then
        continue;
      end if;

      if v_row.target_type='sales_delivery' then
        v_rec_id:=public.reconcile_historical_customer_delivery(
          v_row.target_item_id,
          v_row.legacy_qty,
          v_row.movement_date,
          null,
          concat(
            'Historical reconstruction from imported Stock OUT',
            case when nullif(trim(coalesce(v_row.reference_no,'')),'') is not null
              then ' · '||v_row.reference_no else '' end
          )
        );

        update public.customer_fulfillment_reconciliations
        set reconstruction_run_id=v_run_id
        where id=v_rec_id;

        v_sales:=v_sales+1;

      elsif v_row.target_type='sales_return' then
        update public.sales_return_items ri
        set historical_stock_reconciled_qty=least(ri.qty,coalesce(ri.historical_stock_reconciled_qty,0)+v_row.legacy_qty),
            historical_stock_reconciled=coalesce(ri.historical_stock_reconciled_qty,0)+v_row.legacy_qty>=ri.qty,
            historical_stock_reconciled_at=now(),
            historical_stock_reconciled_by=auth.uid(),
            historical_stock_reconciliation_note=concat(
              'Matched imported historical Return',
              case when nullif(trim(coalesce(v_row.reference_no,'')),'') is not null
                then ' · '||v_row.reference_no else '' end
            )
        where ri.id=v_row.target_item_id;

        update public.sales_returns r
        set status='received',updated_at=now()
        where r.id=v_row.target_header_id
          and not exists(
            select 1
            from public.sales_return_items ri
            where ri.sales_return_id=r.id
              and ri.disposition<>'no_stock_action'
              and coalesce(ri.historical_stock_reconciled_qty,0)<ri.qty
          );

        v_returns:=v_returns+1;

      elsif v_row.target_type='po_receipt' then
        select coalesce(sum(m.qty),0)::numeric into v_live_received
        from public.stock_movements m
        where m.affects_balance=true
          and m.movement_type='po_receipt'
          and m.reference_type='supplier_po_item'
          and m.reference_item_id=v_row.target_item_id;

        select coalesce(i.historical_stock_reconciled_qty,0)::numeric into v_hist_qty
        from public.supplier_po_items i
        where i.id=v_row.target_item_id
        for update;

        update public.supplier_po_items i
        set historical_stock_reconciled_qty=least(
              greatest(i.qty-v_live_received,0),
              coalesce(i.historical_stock_reconciled_qty,0)+v_row.legacy_qty
            ),
            historical_stock_reconciled=(
              v_live_received+
              least(
                greatest(i.qty-v_live_received,0),
                coalesce(i.historical_stock_reconciled_qty,0)+v_row.legacy_qty
              )
            )>=i.qty,
            historical_stock_reconciled_at=now(),
            historical_stock_reconciled_by=auth.uid(),
            historical_stock_reconciliation_note=concat(
              'Matched imported historical Stock IN',
              case when nullif(trim(coalesce(v_row.reference_no,'')),'') is not null
                then ' · '||v_row.reference_no else '' end
            ),
            updated_at=now()
        where i.id=v_row.target_item_id;

        v_po:=v_po+1;
      end if;

      insert into public.historical_reconstruction_links(
        legacy_history_id,match_type,target_header_id,target_item_id,matched_qty,
        match_method,legacy_reference_no,legacy_product_code,legacy_movement_date,
        applied_by,note
      )
      values(
        v_row.legacy_history_id,v_row.target_type,v_row.target_header_id,v_row.target_item_id,v_row.legacy_qty,
        v_row.match_method,v_row.reference_no,v_row.product_code,v_row.movement_date,
        auth.uid(),'Automatically applied safe historical match. No stock movement was created.'
      );

      v_success:=v_success+1;
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'legacy_history_id',v_row.legacy_history_id,
        'target_type',v_row.target_type,
        'target_item_id',v_row.target_item_id,
        'qty',v_row.legacy_qty,
        'ok',true
      ));
    exception when others then
      v_failed:=v_failed+1;
      v_result:=v_result||jsonb_build_array(jsonb_build_object(
        'legacy_history_id',v_row.legacy_history_id,
        'target_type',v_row.target_type,
        'target_item_id',v_row.target_item_id,
        'qty',v_row.legacy_qty,
        'ok',false,
        'error',sqlerrm
      ));
    end;
  end loop;

  update public.historical_reconstruction_runs
  set apply_result=jsonb_build_object(
    'success_count',v_success,
    'failed_count',v_failed,
    'sales_applied',v_sales,
    'returns_applied',v_returns,
    'po_applied',v_po,
    'results',v_result
  )
  where id=v_run_id;

  return jsonb_build_object(
    'run_id',v_run_id,
    'boundary_date',v_boundary,
    'success_count',v_success,
    'failed_count',v_failed,
    'sales_applied',v_sales,
    'returns_applied',v_returns,
    'po_applied',v_po,
    'results',v_result
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_historical_reconstruction_preview(p_type text DEFAULT NULL::text, p_classification text DEFAULT NULL::text, p_search text DEFAULT NULL::text, p_limit integer DEFAULT 200)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_summary jsonb;
  v_rows jsonb;
  v_cfg jsonb;
begin
  if not public.current_user_has_permission('inventory.reconcile') then
    raise exception 'Historical reconciliation permission required';
  end if;

  select to_jsonb(c) into v_cfg
  from public.historical_reconstruction_config c
  where c.id=true;

  with c as (
    select * from public.historical_reconstruction_candidates_internal()
  )
  select jsonb_build_object(
    'total_legacy_rows',(select count(*) from public.stock_legacy_history h where h.movement_type in ('out','return','in')),
    'safe_rows',count(*) filter (where classification='safe'),
    'safe_qty',coalesce(sum(legacy_qty) filter (where classification='safe'),0),
    'applied_rows',count(*) filter (where classification='applied'),
    'resolved_rows',count(*) filter (where classification='resolved'),
    'already_reconciled_rows',count(*) filter (where classification='already_reconciled'),
    'conflict_rows',count(*) filter (where classification='conflict'),
    'unmatched_rows',count(*) filter (where classification='unmatched'),
    'sales_safe',count(*) filter (where target_type='sales_delivery' and classification='safe'),
    'po_safe',count(*) filter (where target_type='po_receipt' and classification='safe'),
    'return_safe',count(*) filter (where target_type='sales_return' and classification='safe'),
    'sales_applied',count(*) filter (where target_type='sales_delivery' and classification='applied'),
    'po_applied',count(*) filter (where target_type='po_receipt' and classification='applied'),
    'return_applied',count(*) filter (where target_type='sales_return' and classification='applied')
  )
  into v_summary
  from c;

  with c as (
    select *
    from public.historical_reconstruction_candidates_internal()
    where (nullif(trim(coalesce(p_type,'')),'') is null or target_type=p_type)
      and (nullif(trim(coalesce(p_classification,'')),'') is null or classification=p_classification)
      and (
        nullif(trim(coalesce(p_search,'')),'') is null
        or lower(coalesce(reference_no,'')) like '%'||lower(trim(p_search))||'%'
        or lower(coalesce(product_code,'')) like '%'||lower(trim(p_search))||'%'
        or lower(coalesce(target_document_no,'')) like '%'||lower(trim(p_search))||'%'
        or lower(coalesce(target_party,'')) like '%'||lower(trim(p_search))||'%'
        or lower(coalesce(counterparty,'')) like '%'||lower(trim(p_search))||'%'
      )
    order by
      case classification when 'conflict' then 1 when 'unmatched' then 2 when 'safe' then 3 when 'already_reconciled' then 4 when 'resolved' then 5 else 6 end,
      movement_date desc,legacy_history_id desc
    limit greatest(1,least(coalesce(p_limit,200),500))
  )
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb)
  into v_rows
  from c;

  return jsonb_build_object('config',v_cfg,'summary',v_summary,'rows',v_rows);
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_historical_reconstruction_review(p_legacy_history_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_h public.stock_legacy_history%rowtype;
  v_candidates jsonb;
  v_candidate_count integer:=0;
  v_remaining numeric:=0;
  v_grouped numeric:=0;
  v_reason text;
  v_suggestion text;
  v_suggested_action text;
  v_resolution jsonb;
  v_audit jsonb;
  v_base record;
begin
  if not public.current_user_has_permission('inventory.reconcile') then
    raise exception 'Historical reconciliation permission required';
  end if;

  select * into v_h from public.stock_legacy_history where id=p_legacy_history_id;
  if not found then raise exception 'Historical movement not found'; end if;

  select * into v_base
  from public.historical_reconstruction_candidates_internal()
  where legacy_history_id=p_legacy_history_id
  limit 1;

  select
    coalesce(jsonb_agg(to_jsonb(c) order by c.line_no,c.target_item_id),'[]'::jsonb),
    count(*)::int,
    coalesce(sum(c.remaining_qty),0)::numeric
  into v_candidates,v_candidate_count,v_remaining
  from public.historical_reconstruction_review_candidates(p_legacy_history_id) c;

  v_grouped:=coalesce(v_base.grouped_legacy_qty,0);

  select to_jsonb(r) into v_resolution
  from public.historical_reconstruction_resolutions r
  where r.legacy_history_id=p_legacy_history_id;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.acted_at desc),'[]'::jsonb)
  into v_audit
  from (
    select *
    from public.historical_reconstruction_review_audit
    where legacy_history_id=p_legacy_history_id
    order by acted_at desc
    limit 30
  ) a;

  if v_resolution is not null then
    v_reason:='This historical movement has already been manually reviewed.';
    v_suggestion:='No further action is required.';
    v_suggested_action:='resolved';
  elsif v_candidate_count=0 then
    v_reason:='No exact document + Code line could be found for this historical movement.';
    v_suggestion:='Verify the original reference/Code. Leave unresolved unless you can identify the source document with confidence.';
    v_suggested_action:='leave_unresolved';
  elsif v_remaining<=0 then
    v_reason:='All matching document quantity is already fully delivered / received / reconciled.';
    v_suggestion:='This is likely already represented or a duplicate historical movement. Verify the source, then mark it Already Represented or Duplicate / Ignore.';
    v_suggested_action:='already_represented';
  elsif v_candidate_count>1 then
    v_reason:='More than one document line has the same reference + Code.';
    v_suggestion:='Choose the exact line, or split the historical quantity across matching lines. Do not guess if the source document is unclear.';
    v_suggested_action:='choose_or_split';
  elsif v_h.qty>v_remaining then
    v_reason:='Historical movement quantity is greater than the unresolved document quantity.';
    v_suggestion:='Check the original invoice/PO/CN. If the imported document quantity is wrong, correct that quantity first. Otherwise mark the movement Already Represented or Duplicate / Ignore.';
    v_suggested_action:='verify_document_qty';
  elsif v_grouped>v_remaining and v_grouped>v_h.qty then
    v_reason:='Several historical movements point to this same document line and together exceed its remaining quantity.';
    v_suggestion:='Review all movements for this reference + Code. Match only what the source document supports; mark duplicates as Duplicate / Ignore.';
    v_suggested_action:='review_group';
  else
    v_reason:='The movement can be matched to the document line without changing physical stock.';
    v_suggestion:='Match this historical movement to the document line.';
    v_suggested_action:='match';
  end if;

  return jsonb_build_object(
    'history',jsonb_build_object(
      'legacy_history_id',v_h.id,
      'movement_date',v_h.movement_date,
      'movement_type',v_h.movement_type,
      'reference_no',v_h.reference_no,
      'counterparty',v_h.counterparty,
      'product_code',v_h.product_code_snapshot,
      'item_name',v_h.item_name_snapshot,
      'qty',v_h.qty,
      'location_code',v_h.location_code,
      'note',v_h.note
    ),
    'current',case when v_base.legacy_history_id is null then null else to_jsonb(v_base) end,
    'candidates',v_candidates,
    'candidate_count',v_candidate_count,
    'total_candidate_remaining',v_remaining,
    'grouped_legacy_qty',v_grouped,
    'reason',v_reason,
    'suggestion',v_suggestion,
    'suggested_action',v_suggested_action,
    'stock_impact','none',
    'resolution',v_resolution,
    'audit',v_audit
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.historical_reconstruction_candidates_internal()
 RETURNS TABLE(legacy_history_id bigint, movement_date date, movement_type text, reference_no text, counterparty text, product_code text, legacy_qty numeric, target_type text, target_header_id uuid, target_item_id uuid, target_document_no text, target_party text, target_qty numeric, target_remaining_qty numeric, candidate_count integer, grouped_legacy_qty numeric, classification text, match_method text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
with cfg as (
  select boundary_date from public.historical_reconstruction_config where id=true
),
linked as (
  select legacy_history_id from public.historical_reconstruction_links
),
resolved as (
  select legacy_history_id from public.historical_reconstruction_resolutions
),
live_sales as (
  select reference_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id is not null
  group by reference_item_id
),
hist_sales as (
  select sales_order_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.customer_fulfillment_reconciliations
  where voided_at is null
  group by sales_order_item_id
),
sales_docs as (
  select distinct
    o.id header_id,
    i.id item_id,
    r.ref_norm,
    public.normalize_history_match_text(coalesce(pc.code,i.product_code_snapshot)) sku_norm,
    coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),'Sales Order') document_no,
    c.name party,
    i.qty target_qty,
    greatest(i.qty-coalesce(ls.qty,0)-coalesce(hs.qty,0),0)::numeric remaining_qty
  from public.sales_orders o
  join public.sales_order_items i on i.sales_order_id=o.id
  join public.customers c on c.id=o.customer_id
  left join public.product_catalog pc on pc.id=i.product_id
  left join live_sales ls on ls.item_id=i.id
  left join hist_sales hs on hs.item_id=i.id
  cross join lateral (
    select distinct public.normalize_history_match_text(x) ref_norm
    from unnest(array[o.sales_invoice_no,o.invoice_no,o.order_no,o.sr_no]) x
    where nullif(trim(coalesce(x,'')),'') is not null
  ) r
  where i.line_kind='product'
    and i.source_type='stock'
    and coalesce(o.status,'')<>'cancelled'
    and coalesce(i.fulfillment_status,'')<>'cancelled'
),
sales_h as (
  select h.*
  from public.stock_legacy_history h,cfg
  where h.movement_type='out'
    and h.movement_date<=cfg.boundary_date
),
sales_pairs as (
  select
    h.id legacy_history_id,
    d.header_id,d.item_id,d.document_no,d.party,d.target_qty,d.remaining_qty
  from sales_h h
  join sales_docs d
    on d.ref_norm=public.normalize_history_match_text(h.reference_no)
   and d.sku_norm=public.normalize_history_match_text(h.product_code_snapshot)
),
sales_h_stats as (
  select h.id legacy_history_id,
         count(distinct p.item_id)::int candidate_count,
         min(p.header_id::text)::uuid header_id,
         min(p.item_id::text)::uuid item_id,
         min(p.document_no) document_no,
         min(p.party) party,
         min(p.target_qty) target_qty,
         min(p.remaining_qty) remaining_qty
  from sales_h h
  left join sales_pairs p on p.legacy_history_id=h.id
  group by h.id
),
sales_target_totals as (
  select s.item_id,coalesce(sum(h.qty),0)::numeric grouped_qty
  from sales_h_stats s
  join sales_h h on h.id=s.legacy_history_id
  where s.candidate_count=1
    and not exists(select 1 from linked l where l.legacy_history_id=s.legacy_history_id)
  group by s.item_id
),
sales_rows as (
  select
    h.id,h.movement_date,h.movement_type,h.reference_no,h.counterparty,h.product_code_snapshot,h.qty,
    'sales_delivery'::text target_type,
    s.header_id,s.item_id,s.document_no,s.party,s.target_qty,s.remaining_qty,s.candidate_count,
    coalesce(t.grouped_qty,0)::numeric grouped_qty,
    case
      when l.legacy_history_id is not null then 'applied'
      when rv.legacy_history_id is not null then 'resolved'
      when s.candidate_count=0 then 'unmatched'
      when s.candidate_count>1 then 'conflict'
      when coalesce(s.remaining_qty,0)<=0 then 'already_reconciled'
      when h.qty<>trunc(h.qty) then 'conflict'
      when coalesce(t.grouped_qty,0)<=coalesce(s.remaining_qty,0) then 'safe'
      else 'conflict'
    end classification,
    'exact reference + Code'::text match_method
  from sales_h h
  join sales_h_stats s on s.legacy_history_id=h.id
  left join sales_target_totals t on t.item_id=s.item_id
  left join linked l on l.legacy_history_id=h.id
  left join resolved rv on rv.legacy_history_id=h.id
),
live_po as (
  select reference_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.stock_movements
  where affects_balance=true
    and movement_type='po_receipt'
    and reference_type='supplier_po_item'
    and reference_item_id is not null
  group by reference_item_id
),
po_docs as (
  select distinct
    p.id header_id,
    i.id item_id,
    r.ref_norm,
    public.normalize_history_match_text(coalesce(pc.code,i.product_code_snapshot)) sku_norm,
    coalesce(p.po_number,p.po_pending_reference,'PO') document_no,
    p.vendor_name party,
    i.qty target_qty,
    greatest(i.qty-coalesce(lp.qty,0)-coalesce(i.historical_stock_reconciled_qty,0),0)::numeric remaining_qty
  from public.supplier_pos p
  join public.supplier_po_items i on i.supplier_po_id=p.id
  left join public.product_catalog pc on pc.id=i.product_id
  left join live_po lp on lp.item_id=i.id
  cross join lateral (
    select distinct public.normalize_history_match_text(x) ref_norm
    from unnest(array[p.po_number,p.po_pending_reference]) x
    where nullif(trim(coalesce(x,'')),'') is not null
  ) r
  where i.inventory_tracking_enabled=true
    and i.product_id is not null
),
po_h as (
  select h.*
  from public.stock_legacy_history h,cfg
  where h.movement_type='in'
    and h.movement_date<=cfg.boundary_date
),
po_pairs as (
  select h.id legacy_history_id,d.header_id,d.item_id,d.document_no,d.party,d.target_qty,d.remaining_qty
  from po_h h
  join po_docs d
    on d.ref_norm=public.normalize_history_match_text(h.reference_no)
   and d.sku_norm=public.normalize_history_match_text(h.product_code_snapshot)
),
po_h_stats as (
  select h.id legacy_history_id,
         count(distinct p.item_id)::int candidate_count,
         min(p.header_id::text)::uuid header_id,
         min(p.item_id::text)::uuid item_id,
         min(p.document_no) document_no,
         min(p.party) party,
         min(p.target_qty) target_qty,
         min(p.remaining_qty) remaining_qty
  from po_h h
  left join po_pairs p on p.legacy_history_id=h.id
  group by h.id
),
po_target_totals as (
  select s.item_id,coalesce(sum(h.qty),0)::numeric grouped_qty
  from po_h_stats s
  join po_h h on h.id=s.legacy_history_id
  where s.candidate_count=1
    and not exists(select 1 from linked l where l.legacy_history_id=s.legacy_history_id)
  group by s.item_id
),
po_rows as (
  select
    h.id,h.movement_date,h.movement_type,h.reference_no,h.counterparty,h.product_code_snapshot,h.qty,
    'po_receipt'::text target_type,
    s.header_id,s.item_id,s.document_no,s.party,s.target_qty,s.remaining_qty,s.candidate_count,
    coalesce(t.grouped_qty,0)::numeric grouped_qty,
    case
      when l.legacy_history_id is not null then 'applied'
      when rv.legacy_history_id is not null then 'resolved'
      when s.candidate_count=0 then 'unmatched'
      when s.candidate_count>1 then 'conflict'
      when coalesce(s.remaining_qty,0)<=0 then 'already_reconciled'
      when coalesce(t.grouped_qty,0)<=coalesce(s.remaining_qty,0) then 'safe'
      else 'conflict'
    end classification,
    'exact reference + Code'::text match_method
  from po_h h
  join po_h_stats s on s.legacy_history_id=h.id
  left join po_target_totals t on t.item_id=s.item_id
  left join linked l on l.legacy_history_id=h.id
  left join resolved rv on rv.legacy_history_id=h.id
),
return_docs as (
  select distinct
    r.id header_id,
    ri.id item_id,
    refs.ref_norm,
    public.normalize_history_match_text(coalesce(pc.code,ri.product_code_snapshot,soi.product_code_snapshot)) sku_norm,
    coalesce(r.cn_no,coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,'')),'Return') document_no,
    c.name party,
    ri.qty target_qty,
    greatest(ri.qty-coalesce(ri.historical_stock_reconciled_qty,0),0)::numeric remaining_qty
  from public.sales_returns r
  join public.sales_return_items ri on ri.sales_return_id=r.id
  join public.sales_order_items soi on soi.id=ri.sales_order_item_id
  join public.sales_orders o on o.id=soi.sales_order_id
  join public.customers c on c.id=r.customer_id
  left join public.product_catalog pc on pc.id=ri.product_id
  cross join lateral (
    select distinct public.normalize_history_match_text(x) ref_norm
    from unnest(array[r.cn_no,o.sales_invoice_no,o.invoice_no,o.order_no,o.sr_no]) x
    where nullif(trim(coalesce(x,'')),'') is not null
  ) refs
  where r.status<>'cancelled'
),
return_h as (
  select h.*
  from public.stock_legacy_history h,cfg
  where h.movement_type='return'
    and h.movement_date<=cfg.boundary_date
),
return_pairs as (
  select h.id legacy_history_id,d.header_id,d.item_id,d.document_no,d.party,d.target_qty,d.remaining_qty
  from return_h h
  join return_docs d
    on d.ref_norm=public.normalize_history_match_text(h.reference_no)
   and d.sku_norm=public.normalize_history_match_text(h.product_code_snapshot)
),
return_h_stats as (
  select h.id legacy_history_id,
         count(distinct p.item_id)::int candidate_count,
         min(p.header_id::text)::uuid header_id,
         min(p.item_id::text)::uuid item_id,
         min(p.document_no) document_no,
         min(p.party) party,
         min(p.target_qty) target_qty,
         min(p.remaining_qty) remaining_qty
  from return_h h
  left join return_pairs p on p.legacy_history_id=h.id
  group by h.id
),
return_target_totals as (
  select s.item_id,coalesce(sum(h.qty),0)::numeric grouped_qty
  from return_h_stats s
  join return_h h on h.id=s.legacy_history_id
  where s.candidate_count=1
    and not exists(select 1 from linked l where l.legacy_history_id=s.legacy_history_id)
  group by s.item_id
),
return_rows as (
  select
    h.id,h.movement_date,h.movement_type,h.reference_no,h.counterparty,h.product_code_snapshot,h.qty,
    'sales_return'::text target_type,
    s.header_id,s.item_id,s.document_no,s.party,s.target_qty,s.remaining_qty,s.candidate_count,
    coalesce(t.grouped_qty,0)::numeric grouped_qty,
    case
      when l.legacy_history_id is not null then 'applied'
      when rv.legacy_history_id is not null then 'resolved'
      when s.candidate_count=0 then 'unmatched'
      when s.candidate_count>1 then 'conflict'
      when coalesce(s.remaining_qty,0)<=0 then 'already_reconciled'
      when coalesce(t.grouped_qty,0)<=coalesce(s.remaining_qty,0) then 'safe'
      else 'conflict'
    end classification,
    'exact reference + Code'::text match_method
  from return_h h
  join return_h_stats s on s.legacy_history_id=h.id
  left join return_target_totals t on t.item_id=s.item_id
  left join linked l on l.legacy_history_id=h.id
  left join resolved rv on rv.legacy_history_id=h.id
)
select id,movement_date,movement_type,reference_no,counterparty,product_code_snapshot,qty,
       target_type,header_id,item_id,document_no,party,target_qty,remaining_qty,candidate_count,grouped_qty,classification,match_method
from sales_rows
union all
select id,movement_date,movement_type,reference_no,counterparty,product_code_snapshot,qty,
       target_type,header_id,item_id,document_no,party,target_qty,remaining_qty,candidate_count,grouped_qty,classification,match_method
from po_rows
union all
select id,movement_date,movement_type,reference_no,counterparty,product_code_snapshot,qty,
       target_type,header_id,item_id,document_no,party,target_qty,remaining_qty,candidate_count,grouped_qty,classification,match_method
from return_rows
$function$
;

CREATE OR REPLACE FUNCTION public.historical_reconstruction_review_candidates(p_legacy_history_id bigint)
 RETURNS TABLE(target_type text, target_header_id uuid, target_item_id uuid, document_no text, party text, document_date date, line_no integer, product_code text, item_name text, item_state text, document_qty numeric, live_stock_qty numeric, historical_qty numeric, already_reconciled_qty numeric, remaining_qty numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
with h as (
  select * from public.stock_legacy_history where id=p_legacy_history_id
),
sales_live as (
  select reference_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id is not null
  group by reference_item_id
),
sales_candidates as (
  select distinct
    'sales_delivery'::text,
    o.id,
    i.id,
    coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),'Sales Order'),
    c.name,
    o.order_date,
    coalesce(i.line_position,0),
    coalesce(pc.code,i.product_code_snapshot),
    i.item_name_snapshot,
    i.fulfillment_status,
    i.qty,
    coalesce(sl.qty,0)::numeric,
    public.historical_customer_delivery_qty(i.id)::numeric,
    (coalesce(sl.qty,0)+public.historical_customer_delivery_qty(i.id))::numeric,
    greatest(i.qty-coalesce(sl.qty,0)-public.historical_customer_delivery_qty(i.id),0)::numeric
  from h
  join public.sales_orders o
    on h.movement_type='out'
   and public.normalize_history_match_text(h.reference_no)<>''
   and public.normalize_history_match_text(h.reference_no) in (
     public.normalize_history_match_text(o.sales_invoice_no),
     public.normalize_history_match_text(o.invoice_no),
     public.normalize_history_match_text(o.order_no),
     public.normalize_history_match_text(o.sr_no)
   )
  join public.sales_order_items i on i.sales_order_id=o.id
  join public.customers c on c.id=o.customer_id
  left join public.product_catalog pc on pc.id=i.product_id
  left join sales_live sl on sl.item_id=i.id
  where i.line_kind='product'
    and i.source_type='stock'
    and coalesce(o.status,'')<>'cancelled'
    and coalesce(i.fulfillment_status,'')<>'cancelled'
    and public.normalize_history_match_text(coalesce(pc.code,i.product_code_snapshot))
        =public.normalize_history_match_text(h.product_code_snapshot)
),
po_live as (
  select reference_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.stock_movements
  where affects_balance=true
    and movement_type='po_receipt'
    and reference_type='supplier_po_item'
    and reference_item_id is not null
  group by reference_item_id
),
po_candidates as (
  select distinct
    'po_receipt'::text,
    p.id,
    i.id,
    coalesce(p.po_number,p.po_pending_reference,'PO'),
    p.vendor_name,
    p.order_date,
    coalesce(i.sort_order,0),
    coalesce(pc.code,i.product_code_snapshot),
    i.item_name_snapshot,
    i.procurement_status,
    i.qty,
    coalesce(pl.qty,0)::numeric,
    coalesce(i.historical_stock_reconciled_qty,0)::numeric,
    (coalesce(pl.qty,0)+coalesce(i.historical_stock_reconciled_qty,0))::numeric,
    greatest(i.qty-coalesce(pl.qty,0)-coalesce(i.historical_stock_reconciled_qty,0),0)::numeric
  from h
  join public.supplier_pos p
    on h.movement_type='in'
   and public.normalize_history_match_text(h.reference_no)<>''
   and public.normalize_history_match_text(h.reference_no) in (
     public.normalize_history_match_text(p.po_number),
     public.normalize_history_match_text(p.po_pending_reference)
   )
  join public.supplier_po_items i on i.supplier_po_id=p.id
  left join public.product_catalog pc on pc.id=i.product_id
  left join po_live pl on pl.item_id=i.id
  where i.inventory_tracking_enabled=true
    and i.product_id is not null
    and coalesce(p.status,'')<>'cancelled'
    and public.normalize_history_match_text(coalesce(pc.code,i.product_code_snapshot))
        =public.normalize_history_match_text(h.product_code_snapshot)
),
return_candidates as (
  select distinct
    'sales_return'::text,
    r.id,
    ri.id,
    coalesce(nullif(r.cn_no,''),nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),'Return'),
    c.name,
    r.return_date,
    0,
    coalesce(pc.code,ri.product_code_snapshot,soi.product_code_snapshot),
    coalesce(ri.item_name_snapshot,soi.item_name_snapshot),
    r.status,
    ri.qty,
    0::numeric,
    coalesce(ri.historical_stock_reconciled_qty,0)::numeric,
    coalesce(ri.historical_stock_reconciled_qty,0)::numeric,
    greatest(ri.qty-coalesce(ri.historical_stock_reconciled_qty,0),0)::numeric
  from h
  join public.sales_returns r on h.movement_type='return'
  join public.sales_order_items soi on soi.sales_order_id=r.sales_order_id
  join public.sales_orders o on o.id=r.sales_order_id
  join public.customers c on c.id=r.customer_id
  join public.sales_return_items ri on ri.sales_return_id=r.id and ri.sales_order_item_id=soi.id
  left join public.product_catalog pc on pc.id=ri.product_id
  where r.status<>'cancelled'
    and public.normalize_history_match_text(h.reference_no)<>''
    and public.normalize_history_match_text(h.reference_no) in (
      public.normalize_history_match_text(r.cn_no),
      public.normalize_history_match_text(o.sales_invoice_no),
      public.normalize_history_match_text(o.invoice_no),
      public.normalize_history_match_text(o.order_no),
      public.normalize_history_match_text(o.sr_no)
    )
    and public.normalize_history_match_text(coalesce(pc.code,ri.product_code_snapshot,soi.product_code_snapshot))
        =public.normalize_history_match_text(h.product_code_snapshot)
)
select * from sales_candidates
union all select * from po_candidates
union all select * from return_candidates
$function$
;

CREATE OR REPLACE FUNCTION public.reconcile_historical_customer_delivery(p_sales_order_item_id uuid, p_qty numeric, p_delivery_date date DEFAULT CURRENT_DATE, p_stock_location_id uuid DEFAULT NULL::uuid, p_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text:=coalesce(public.current_app_role(),'');
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
  v_actual numeric:=0;
  v_hist numeric:=0;
  v_cancelled numeric:=0;
  v_remaining numeric:=0;
  v_id uuid;
  v_ordered numeric:=0;
  v_production numeric:=0;
  v_shipping numeric:=0;
  v_arrived numeric:=0;
  v_delivered numeric:=0;
  v_active numeric:=0;
  v_nonterm numeric:=0;
  v_excess numeric:=0;
  v_deficit numeric:=0;
  v_take numeric:=0;
  v_count integer:=0;
  v_fallback text;
  v_aggregate text;
begin
  if not public.current_user_has_permission('inventory.reconcile') then
    raise exception 'Historical reconciliation permission required';
  end if;
  if p_qty is null or p_qty<=0 or p_qty<>trunc(p_qty) then
    raise exception 'Historical delivery quantity must be a positive whole number';
  end if;
  if coalesce(p_delivery_date,current_date)>current_date then
    raise exception 'Historical delivery date cannot be in the future';
  end if;
  if length(nullif(trim(coalesce(p_note,'')),''))>2000 then
    raise exception 'Historical reconciliation note must be at most 2000 characters';
  end if;
  if p_stock_location_id is not null and not exists(select 1 from public.stock_locations where id=p_stock_location_id) then
    raise exception 'Selected stock location was not found';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('historical-fulfillment:'||p_sales_order_item_id::text,0));

  select * into v_item from public.sales_order_items where id=p_sales_order_item_id for update;
  if not found then raise exception 'Sales item not found'; end if;
  select * into v_order from public.sales_orders where id=v_item.sales_order_id;

  if v_item.product_id is null or coalesce(v_item.line_kind,'product')<>'product' or v_item.source_type<>'stock' then
    raise exception 'Historical reconciliation is available only for stock product lines';
  end if;
  if coalesce(v_order.status,'')='cancelled' or coalesce(v_item.fulfillment_status,'')='cancelled' then
    raise exception 'Cancelled items cannot be reconciled as historical delivery';
  end if;

  select coalesce(sum(qty),0)::numeric into v_actual
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=p_sales_order_item_id;

  select public.historical_customer_delivery_qty(p_sales_order_item_id) into v_hist;

  select coalesce(sum(qty),0)::numeric into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id and lower(status)='cancelled';

  v_cancelled:=least(greatest(v_cancelled,0),v_item.qty);
  v_remaining:=greatest(v_item.qty-v_actual-v_hist-v_cancelled,0);

  if v_remaining<=0 then raise exception 'This item is already fully delivered / reconciled'; end if;
  if p_qty>v_remaining then raise exception 'Historical quantity exceeds remaining quantity. Remaining: %',v_remaining; end if;

  insert into public.customer_fulfillment_reconciliations(
    sales_order_item_id,qty,delivery_date,stock_location_id,note,reconciled_by,reconciled_at
  )
  values(
    p_sales_order_item_id,p_qty,coalesce(p_delivery_date,current_date),p_stock_location_id,
    nullif(trim(coalesce(p_note,'')),''),auth.uid(),now()
  )
  returning id into v_id;

  select
    count(*)::int,
    coalesce(sum(qty) filter (where lower(status) in ('ordered','pending','reserved')),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='production'),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='shipping'),0)::numeric,
    coalesce(sum(qty) filter (where lower(status) in ('arrived','ready')),0)::numeric,
    coalesce(sum(qty) filter (where lower(status)='cancelled'),0)::numeric
  into v_count,v_ordered,v_production,v_shipping,v_arrived,v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=p_sales_order_item_id;

  v_fallback:=case lower(coalesce(v_item.fulfillment_status,'ordered'))
    when 'pending' then 'ordered'
    when 'reserved' then 'ordered'
    when 'ready' then 'arrived'
    when 'installed' then 'delivered'
    else lower(coalesce(v_item.fulfillment_status,'ordered'))
  end;

  if v_count=0 then
    v_ordered:=0;v_production:=0;v_shipping:=0;v_arrived:=0;v_cancelled:=0;
    if v_fallback='ordered' then v_ordered:=v_item.qty;
    elsif v_fallback='production' then v_production:=v_item.qty;
    elsif v_fallback='shipping' then v_shipping:=v_item.qty;
    elsif v_fallback='arrived' then v_arrived:=v_item.qty;
    end if;
  end if;

  v_cancelled:=least(greatest(v_cancelled,0),v_item.qty);
  v_hist:=v_hist+p_qty;
  v_delivered:=least(greatest(v_actual+v_hist,0),greatest(v_item.qty-v_cancelled,0));
  v_active:=greatest(v_item.qty-v_cancelled-v_delivered,0);
  v_nonterm:=greatest(v_ordered,0)+greatest(v_production,0)+greatest(v_shipping,0)+greatest(v_arrived,0);

  if v_nonterm>v_active then
    v_excess:=v_nonterm-v_active;
    v_take:=least(v_arrived,v_excess);v_arrived:=v_arrived-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_shipping,v_excess);v_shipping:=v_shipping-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_production,v_excess);v_production:=v_production-v_take;v_excess:=v_excess-v_take;
    v_take:=least(v_ordered,v_excess);v_ordered:=v_ordered-v_take;v_excess:=v_excess-v_take;
  elsif v_nonterm<v_active then
    v_deficit:=v_active-v_nonterm;
    if v_fallback='ordered' then v_ordered:=v_ordered+v_deficit;
    elsif v_fallback='production' then v_production:=v_production+v_deficit;
    elsif v_fallback='shipping' then v_shipping:=v_shipping+v_deficit;
    else v_arrived:=v_arrived+v_deficit;
    end if;
  end if;

  delete from public.sales_item_status_quantities where sales_order_item_id=p_sales_order_item_id;

  insert into public.sales_item_status_quantities(sales_order_item_id,status,qty,updated_by,updated_at)
  select p_sales_order_item_id,s.status,s.qty,auth.uid(),now()
  from (values
    ('ordered'::text,v_ordered),
    ('production'::text,v_production),
    ('shipping'::text,v_shipping),
    ('arrived'::text,v_arrived),
    ('delivered'::text,v_delivered),
    ('cancelled'::text,v_cancelled)
  ) s(status,qty)
  where s.qty>0;

  v_aggregate:=case
    when v_ordered>0 then 'ordered'
    when v_production>0 then 'production'
    when v_shipping>0 then 'shipping'
    when v_arrived>0 then 'arrived'
    when v_delivered>0 then 'delivered'
    else 'cancelled'
  end;

  update public.sales_order_items set fulfillment_status=v_aggregate,updated_at=now()
  where id=p_sales_order_item_id;

  insert into public.item_tracking(sales_order_item_id,status,updated_by,updated_at,delivered_at)
  values(
    p_sales_order_item_id,v_aggregate,auth.uid(),now(),
    case when v_aggregate='delivered' then coalesce(p_delivery_date,current_date)::timestamp else null end
  )
  on conflict (sales_order_item_id) do update
  set status=excluded.status,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at,
      delivered_at=case
        when excluded.status='delivered' then coalesce(public.item_tracking.delivered_at,excluded.delivered_at)
        else null
      end;

  perform public.refresh_inventory_product_snapshot(v_item.product_id);
  return v_id;
end
$function$
;

CREATE OR REPLACE FUNCTION public.resolve_historical_reconstruction_review(p_legacy_history_id bigint, p_action text, p_allocations jsonb DEFAULT '[]'::jsonb, p_target_item_id uuid DEFAULT NULL::uuid, p_new_qty numeric DEFAULT NULL::numeric, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_h public.stock_legacy_history%rowtype;
  v_action text:=lower(trim(coalesce(p_action,'')));
  v_candidate record;
  v_alloc record;
  v_sum numeric:=0;
  v_count integer:=0;
  v_before jsonb;
  v_after jsonb;
  v_old_qty numeric;
  v_reconciled numeric;
  v_rec_id uuid;
  v_live_received numeric;
  v_hist numeric;
  v_resolution_type text;
  v_target_type text;
  v_resolution_data jsonb:='{}'::jsonb;
begin
  if not public.current_user_has_permission('inventory.reconcile') then
    raise exception 'Historical reconciliation permission required';
  end if;
  if length(coalesce(p_note,''))>2000 then
    raise exception 'Review note must be at most 2000 characters';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('historical-review:'||p_legacy_history_id::text,0));

  select * into v_h
  from public.stock_legacy_history
  where id=p_legacy_history_id
  for update;
  if not found then raise exception 'Historical movement not found'; end if;

  if exists(select 1 from public.historical_reconstruction_resolutions where legacy_history_id=p_legacy_history_id) then
    raise exception 'This historical movement has already been manually resolved';
  end if;
  if exists(select 1 from public.historical_reconstruction_links where legacy_history_id=p_legacy_history_id) then
    raise exception 'This historical movement is already linked';
  end if;

  if v_action in ('duplicate_ignore','already_represented') then
    v_resolution_type:=v_action;
    insert into public.historical_reconstruction_resolutions(
      legacy_history_id,resolution_type,target_type,resolution_data,note,resolved_by
    )
    values(
      p_legacy_history_id,v_resolution_type,
      case v_h.movement_type when 'out' then 'sales_delivery' when 'return' then 'sales_return' when 'in' then 'po_receipt' else null end,
      jsonb_build_object('history_qty',v_h.qty,'reference_no',v_h.reference_no,'product_code',v_h.product_code_snapshot),
      nullif(trim(coalesce(p_note,'')),''),auth.uid()
    );

    insert into public.historical_reconstruction_review_audit(
      legacy_history_id,action,before_state,after_state,note,acted_by
    )
    values(
      p_legacy_history_id,v_action,
      jsonb_build_object('resolution',null),
      jsonb_build_object('resolution_type',v_resolution_type,'stock_impact','none'),
      nullif(trim(coalesce(p_note,'')),''),auth.uid()
    );

    return jsonb_build_object(
      'ok',true,'action',v_action,'stock_impact','none',
      'message',case when v_action='duplicate_ignore'
        then 'Historical movement marked Duplicate / Ignore. No stock movement changed.'
        else 'Historical movement marked Already Represented. No stock movement changed.'
      end
    );
  end if;

  if v_action='correct_document_qty' then
    if p_target_item_id is null or p_new_qty is null or p_new_qty<=0 then
      raise exception 'Choose a document line and enter a positive corrected quantity';
    end if;

    select * into v_candidate
    from public.historical_reconstruction_review_candidates(p_legacy_history_id)
    where target_item_id=p_target_item_id
    limit 1;
    if not found then raise exception 'Selected line is not a valid exact reference + Code candidate'; end if;
    if p_new_qty<v_candidate.already_reconciled_qty then
      raise exception 'Corrected quantity cannot be below already reconciled quantity (%)',v_candidate.already_reconciled_qty;
    end if;

    v_before:=to_jsonb(v_candidate);
    v_old_qty:=v_candidate.document_qty;
    v_target_type:=v_candidate.target_type;

    if v_target_type='sales_delivery' then
      update public.sales_order_items
      set qty=p_new_qty,
          line_total=greatest((p_new_qty*unit_price)-discount_amount,0),
          updated_at=now()
      where id=p_target_item_id;
    elsif v_target_type='po_receipt' then
      update public.supplier_po_items
      set qty=p_new_qty,updated_at=now()
      where id=p_target_item_id;
    elsif v_target_type='sales_return' then
      update public.sales_return_items
      set qty=p_new_qty
      where id=p_target_item_id;
    else
      raise exception 'Unsupported document type';
    end if;

    select to_jsonb(c) into v_after
    from public.historical_reconstruction_review_candidates(p_legacy_history_id) c
    where c.target_item_id=p_target_item_id
    limit 1;

    insert into public.historical_reconstruction_review_audit(
      legacy_history_id,action,before_state,after_state,note,acted_by
    )
    values(
      p_legacy_history_id,'correct_document_qty',
      v_before,
      coalesce(v_after,'{}'::jsonb)||jsonb_build_object('old_qty',v_old_qty,'new_qty',p_new_qty,'stock_impact','none'),
      nullif(trim(coalesce(p_note,'')),''),auth.uid()
    );

    return jsonb_build_object(
      'ok',true,'action','correct_document_qty','old_qty',v_old_qty,'new_qty',p_new_qty,
      'stock_impact','none','document_impact','quantity_and_totals',
      'message','Imported document quantity corrected. No physical stock movement was created or changed.'
    );
  end if;

  if v_action not in ('match_line','split') then raise exception 'Unknown review action'; end if;
  if jsonb_typeof(coalesce(p_allocations,'[]'::jsonb))<>'array' then raise exception 'Allocations must be an array'; end if;

  create temporary table if not exists pg_temp.history_review_allocations(
    target_item_id uuid primary key,
    qty numeric not null
  ) on commit drop;
  truncate pg_temp.history_review_allocations;

  insert into pg_temp.history_review_allocations(target_item_id,qty)
  select (x->>'target_item_id')::uuid,(x->>'qty')::numeric
  from jsonb_array_elements(coalesce(p_allocations,'[]'::jsonb)) x;

  select count(*)::int,coalesce(sum(qty),0)::numeric into v_count,v_sum
  from pg_temp.history_review_allocations;

  if v_count=0 then raise exception 'Choose at least one matching document line'; end if;
  if exists(select 1 from pg_temp.history_review_allocations where qty<=0) then
    raise exception 'Every allocation quantity must be greater than 0';
  end if;
  if v_action='match_line' and v_count<>1 then raise exception 'Match This Line requires exactly one line'; end if;
  if abs(v_sum-v_h.qty)>0.0001 then
    raise exception 'Allocated quantity (%) must equal historical movement quantity (%)',v_sum,v_h.qty;
  end if;

  for v_alloc in select * from pg_temp.history_review_allocations loop
    select * into v_candidate
    from public.historical_reconstruction_review_candidates(p_legacy_history_id)
    where target_item_id=v_alloc.target_item_id
    limit 1;
    if not found then raise exception 'One selected line is not a valid exact reference + Code candidate'; end if;
    if v_alloc.qty>v_candidate.remaining_qty+0.0001 then
      raise exception 'Allocation % exceeds remaining % for %',v_alloc.qty,v_candidate.remaining_qty,v_candidate.document_no;
    end if;

    if v_target_type is null then v_target_type:=v_candidate.target_type;
    elsif v_target_type<>v_candidate.target_type then raise exception 'Cannot mix document types in one allocation'; end if;

    if v_candidate.target_type='sales_delivery' then
      v_rec_id:=public.reconcile_historical_customer_delivery(
        v_candidate.target_item_id,v_alloc.qty,v_h.movement_date,null,
        concat('History Repair #',p_legacy_history_id,' · ',coalesce(v_h.reference_no,''),' · no stock deduction')
      );
    elsif v_candidate.target_type='po_receipt' then
      select coalesce(sum(m.qty),0)::numeric into v_live_received
      from public.stock_movements m
      where m.affects_balance=true
        and m.movement_type='po_receipt'
        and m.reference_type='supplier_po_item'
        and m.reference_item_id=v_candidate.target_item_id;

      select coalesce(i.historical_stock_reconciled_qty,0)::numeric into v_hist
      from public.supplier_po_items i
      where i.id=v_candidate.target_item_id
      for update;

      update public.supplier_po_items i
      set historical_stock_reconciled_qty=least(
            greatest(i.qty-v_live_received,0),
            coalesce(i.historical_stock_reconciled_qty,0)+v_alloc.qty
          ),
          historical_stock_reconciled=(
            v_live_received+
            least(greatest(i.qty-v_live_received,0),coalesce(i.historical_stock_reconciled_qty,0)+v_alloc.qty)
          )>=i.qty,
          historical_stock_reconciled_at=now(),
          historical_stock_reconciled_by=auth.uid(),
          historical_stock_reconciliation_note=concat('History Repair #',p_legacy_history_id,' · ',coalesce(v_h.reference_no,''),' · no Stock IN'),
          updated_at=now()
      where i.id=v_candidate.target_item_id;
    elsif v_candidate.target_type='sales_return' then
      update public.sales_return_items ri
      set historical_stock_reconciled_qty=least(ri.qty,coalesce(ri.historical_stock_reconciled_qty,0)+v_alloc.qty),
          historical_stock_reconciled=coalesce(ri.historical_stock_reconciled_qty,0)+v_alloc.qty>=ri.qty,
          historical_stock_reconciled_at=now(),
          historical_stock_reconciled_by=auth.uid(),
          historical_stock_reconciliation_note=concat('History Repair #',p_legacy_history_id,' · ',coalesce(v_h.reference_no,''),' · no stock posting')
      where ri.id=v_candidate.target_item_id;

      update public.sales_returns r
      set status='received',updated_at=now()
      where r.id=v_candidate.target_header_id
        and not exists(
          select 1 from public.sales_return_items ri
          where ri.sales_return_id=r.id
            and ri.disposition<>'no_stock_action'
            and coalesce(ri.historical_stock_reconciled_qty,0)<ri.qty
        );
    end if;

    insert into public.historical_reconstruction_links(
      legacy_history_id,match_type,target_header_id,target_item_id,matched_qty,
      match_method,legacy_reference_no,legacy_product_code,legacy_movement_date,applied_by,note
    )
    values(
      p_legacy_history_id,v_candidate.target_type,v_candidate.target_header_id,v_candidate.target_item_id,v_alloc.qty,
      case when v_action='split' then 'manual review split · exact reference + Code' else 'manual review · exact reference + Code' end,
      v_h.reference_no,v_h.product_code_snapshot,v_h.movement_date,auth.uid(),
      coalesce(nullif(trim(coalesce(p_note,'')),''),'History Repair manual review. No stock movement created.')
    );
  end loop;

  v_resolution_type:=case when v_action='split' then 'split_match' else 'manual_match' end;
  select coalesce(jsonb_agg(jsonb_build_object('target_item_id',target_item_id,'qty',qty)),'[]'::jsonb)
  into v_resolution_data
  from pg_temp.history_review_allocations;

  insert into public.historical_reconstruction_resolutions(
    legacy_history_id,resolution_type,target_type,resolution_data,note,resolved_by
  )
  values(
    p_legacy_history_id,v_resolution_type,v_target_type,v_resolution_data,
    nullif(trim(coalesce(p_note,'')),''),auth.uid()
  );

  insert into public.historical_reconstruction_review_audit(
    legacy_history_id,action,before_state,after_state,note,acted_by
  )
  values(
    p_legacy_history_id,v_action,
    jsonb_build_object('history_qty',v_h.qty,'reference_no',v_h.reference_no,'product_code',v_h.product_code_snapshot),
    jsonb_build_object('allocations',v_resolution_data,'resolution_type',v_resolution_type,'stock_impact','none'),
    nullif(trim(coalesce(p_note,'')),''),auth.uid()
  );

  return jsonb_build_object(
    'ok',true,'action',v_action,'allocations',v_resolution_data,'stock_impact','none',
    'message','Historical movement reconciled to the selected document line(s). No physical stock movement was created or changed.'
  );
end
$function$
;

