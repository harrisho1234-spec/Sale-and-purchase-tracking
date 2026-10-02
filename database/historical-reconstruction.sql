-- Historical reconstruction / history repair.
-- Historical stock movement is the source of truth through the imported history boundary.
-- This migration never rewrites Customers, Customer Leads, Showroom/Online data, CRM assignments,
-- or today's stock movements when reconciling old documents.

create table if not exists public.historical_reconstruction_config (
  id boolean primary key default true check (id),
  boundary_date date not null,
  live_start_date date not null,
  source_table text not null default 'stock_legacy_history',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid null references public.app_users(user_id) on delete set null
);

insert into public.historical_reconstruction_config(id,boundary_date,live_start_date,source_table)
select true,coalesce(max(movement_date),current_date-1),coalesce(max(movement_date),current_date-1)+1,'stock_legacy_history'
from public.stock_legacy_history
on conflict (id) do nothing;

create table if not exists public.historical_reconstruction_links (
  id uuid primary key default gen_random_uuid(),
  legacy_history_id bigint not null references public.stock_legacy_history(id) on delete cascade,
  match_type text not null check (match_type in ('sales_delivery','sales_return','po_receipt')),
  target_header_id uuid null,
  target_item_id uuid not null,
  matched_qty numeric not null check (matched_qty>0),
  match_method text not null,
  legacy_reference_no text null,
  legacy_product_code text null,
  legacy_movement_date date null,
  applied_at timestamptz not null default now(),
  applied_by uuid null references public.app_users(user_id) on delete set null,
  note text null,
  unique(legacy_history_id)
);

create table if not exists public.historical_reconstruction_runs (
  id uuid primary key default gen_random_uuid(),
  boundary_date date not null,
  preview_snapshot jsonb null,
  apply_result jsonb null,
  run_type text not null check (run_type in ('preview','apply')),
  created_at timestamptz not null default now(),
  created_by uuid null references public.app_users(user_id) on delete set null
);

alter table public.historical_reconstruction_config enable row level security;
alter table public.historical_reconstruction_links enable row level security;
alter table public.historical_reconstruction_runs enable row level security;

drop policy if exists historical_reconstruction_config_superadmin on public.historical_reconstruction_config;
create policy historical_reconstruction_config_superadmin on public.historical_reconstruction_config
for all to authenticated using (coalesce(public.is_super_admin(),false))
with check (coalesce(public.is_super_admin(),false));

drop policy if exists historical_reconstruction_links_superadmin on public.historical_reconstruction_links;
create policy historical_reconstruction_links_superadmin on public.historical_reconstruction_links
for select to authenticated using (coalesce(public.is_super_admin(),false));

drop policy if exists historical_reconstruction_runs_superadmin on public.historical_reconstruction_runs;
create policy historical_reconstruction_runs_superadmin on public.historical_reconstruction_runs
for select to authenticated using (coalesce(public.is_super_admin(),false));

alter table public.customer_fulfillment_reconciliations
  add column if not exists reconstruction_run_id uuid null references public.historical_reconstruction_runs(id) on delete set null;

alter table public.supplier_po_items
  add column if not exists historical_stock_reconciled_qty numeric not null default 0 check (historical_stock_reconciled_qty>=0);

alter table public.sales_return_items
  add column if not exists historical_stock_reconciled boolean not null default false,
  add column if not exists historical_stock_reconciled_qty numeric not null default 0 check (historical_stock_reconciled_qty>=0),
  add column if not exists historical_stock_reconciled_at timestamptz null,
  add column if not exists historical_stock_reconciled_by uuid null references public.app_users(user_id) on delete set null,
  add column if not exists historical_stock_reconciliation_note text null;


CREATE OR REPLACE FUNCTION public.normalize_history_match_text(p_value text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE PARALLEL SAFE
AS $function$
  select regexp_replace(upper(coalesce(trim(p_value),'')),'[^A-Z0-9]','','g')
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
  if not coalesce(public.is_super_admin(),false) then
    raise exception 'Super Admin access required';
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
      case classification when 'conflict' then 1 when 'unmatched' then 2 when 'safe' then 3 when 'already_reconciled' then 4 else 5 end,
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
  if not coalesce(public.is_super_admin(),false) then
    raise exception 'Super Admin access required';
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
    from public.historical_reconstruction_candidates_internal()
    where classification='safe'
      and target_type=any(p_types)
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

CREATE OR REPLACE FUNCTION public.guard_tracked_stock_delivered_status()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_tracked boolean;
  v_source text;
  v_released numeric:=0;
  v_other numeric:=0;
  v_status text;
begin
  v_status:=case lower(coalesce(new.status,''))
    when 'installed' then 'delivered'
    else lower(coalesce(new.status,''))
  end;
  if v_status<>'delivered' then return new; end if;

  select inventory_tracking_enabled,source_type into v_tracked,v_source
  from public.sales_order_items
  where id=new.sales_order_item_id;

  if coalesce(v_tracked,false)=false or v_source<>'stock' then return new; end if;

  select coalesce(sum(qty),0)::numeric into v_released
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=new.sales_order_item_id;

  -- Historical reconciliations represent stock that physically left before the live
  -- workflow existed. They count as delivered status, but never create a new Stock OUT.
  v_released:=v_released+public.historical_customer_delivery_qty(new.sales_order_item_id);

  select coalesce(sum(qty),0)::numeric into v_other
  from public.sales_item_status_quantities
  where sales_order_item_id=new.sales_order_item_id
    and lower(status) in ('delivered','installed')
    and id<>new.id;

  if v_other+coalesce(new.qty,0)>v_released+0.0001 then
    raise exception 'Tracked stock items can only be marked Delivered through approved Stock OUT or authorized Historical Delivery Reconciliation';
  end if;
  return new;
end;
$function$
;

CREATE OR REPLACE FUNCTION public.guard_tracked_stock_fulfillment_delivered()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_released numeric:=0;
  v_cancelled numeric:=0;
  v_status text;
begin
  if coalesce(new.inventory_tracking_enabled,false)=false or new.source_type<>'stock' then return new; end if;

  v_status:=case lower(coalesce(new.fulfillment_status,''))
    when 'installed' then 'delivered'
    else lower(coalesce(new.fulfillment_status,''))
  end;
  if v_status<>'delivered' then return new; end if;

  select coalesce(sum(qty),0)::numeric into v_released
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id=new.id;

  v_released:=v_released+public.historical_customer_delivery_qty(new.id);

  select coalesce(sum(qty),0)::numeric into v_cancelled
  from public.sales_item_status_quantities
  where sales_order_item_id=new.id
    and lower(status)='cancelled';

  if v_released+v_cancelled+0.0001<coalesce(new.qty,0) then
    raise exception 'Tracked stock items can only become Delivered after approved Stock OUT or authorized Historical Delivery Reconciliation';
  end if;
  return new;
end;
$function$
;

revoke all on function public.historical_reconstruction_candidates_internal() from public,anon,authenticated;
revoke all on function public.get_historical_reconstruction_preview(text,text,text,integer) from public,anon;
grant execute on function public.get_historical_reconstruction_preview(text,text,text,integer) to authenticated;
revoke all on function public.apply_historical_reconstruction_safe_matches(text[]) from public,anon;
grant execute on function public.apply_historical_reconstruction_safe_matches(text[]) to authenticated;
