-- Add PJ (Project) as a third sales invoice/category code beside TK and RK.
-- PJ is a sales/business classification only. It does NOT create or change any stock location.

alter table public.sales_orders
  drop constraint if exists sales_orders_sales_invoice_type_check;

alter table public.sales_orders
  add constraint sales_orders_sales_invoice_type_check
  check (sales_invoice_type is null or sales_invoice_type in ('TK','RK','PJ'));


create or replace function public.classify_sales_document()
returns trigger
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_doc text;
begin
  v_doc := coalesce(nullif(trim(new.order_no),''), nullif(trim(new.invoice_no),''));

  if new.sales_flow_type is null then
    if new.order_type = 'pre_order' or upper(coalesce(v_doc,'')) like 'SR%' then
      new.sales_flow_type := 'pre_order';
    else
      new.sales_flow_type := 'stock_sale';
    end if;
  end if;

  if new.sales_flow_type = 'pre_order' then
    if new.sr_no is null and upper(coalesce(v_doc,'')) like 'SR%' then
      new.sr_no := v_doc;
    end if;
    if new.sales_invoice_no is not null then
      new.invoice_request_status := 'issued';
    elsif new.invoice_request_status is null or new.invoice_request_status = 'not_needed' then
      new.invoice_request_status := 'not_requested';
    end if;
  else
    if new.sales_invoice_no is null and (
      upper(coalesce(v_doc,'')) like 'TK%'
      or upper(coalesce(v_doc,'')) like 'RK%'
      or upper(coalesce(v_doc,'')) like 'PJ%'
    ) then
      new.sales_invoice_no := v_doc;
    end if;

    if new.sales_invoice_type is null and new.sales_invoice_no is not null then
      if upper(new.sales_invoice_no) like 'TK%' then new.sales_invoice_type := 'TK';
      elsif upper(new.sales_invoice_no) like 'RK%' then new.sales_invoice_type := 'RK';
      elsif upper(new.sales_invoice_no) like 'PJ%' then new.sales_invoice_type := 'PJ';
      end if;
    end if;

    new.invoice_request_status := 'not_needed';
  end if;

  if new.sales_invoice_no is not null and new.sales_invoice_type is null then
    if upper(new.sales_invoice_no) like 'TK%' then new.sales_invoice_type := 'TK';
    elsif upper(new.sales_invoice_no) like 'RK%' then new.sales_invoice_type := 'RK';
    elsif upper(new.sales_invoice_no) like 'PJ%' then new.sales_invoice_type := 'PJ';
    end if;
  end if;

  return new;
end;
$function$;


create or replace function public.issue_sales_invoice(
  p_order_id uuid,
  p_invoice_type text,
  p_invoice_no text,
  p_note text default null
)
returns public.sales_orders
language plpgsql
security definer
set search_path to 'public','pg_temp'
as $function$
declare
  v_type text:=upper(trim(coalesce(p_invoice_type,'')));
  v_no text:=trim(coalesce(p_invoice_no,''));
  v_order public.sales_orders%rowtype;
  v_result public.sales_orders%rowtype;
begin
  if not public.is_admin_or_super() then raise exception 'Admin access required'; end if;
  if v_type not in ('TK','RK','PJ') then raise exception 'Invoice type must be TK, RK or PJ'; end if;
  if v_no='' then raise exception 'Invoice number is required'; end if;
  if upper(v_no) not like v_type||'%' then raise exception 'Invoice number must begin with %',v_type; end if;

  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Sales order not found'; end if;
  if v_order.sales_flow_type <> 'pre_order' then
    raise exception 'Use the existing TK/RK/PJ document for stock sales';
  end if;

  update public.sales_orders
  set sales_invoice_type=v_type,
      sales_invoice_no=v_no,
      invoice_request_status='issued',
      invoice_issued_at=now(),
      invoice_issued_by=auth.uid()
  where id=p_order_id
  returning * into v_result;

  insert into public.sales_document_events(
    sales_order_id,event_type,document_no,note,actor_user_id,metadata
  )
  values(
    p_order_id,'invoice_issued',v_no,p_note,auth.uid(),
    jsonb_build_object('invoice_type',v_type)
  );

  return v_result;
end;
$function$;


do $migration$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid)
  into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public'
    and p.proname='review_sales_order_edit_request'
  limit 1;

  if v_def is not null then
    v_def:=replace(v_def,
      'v_type not in (''TK'',''RK'')',
      'v_type not in (''TK'',''RK'',''PJ'')'
    );
    v_def:=replace(v_def,
      'Invoice type must be TK or RK',
      'Invoice type must be TK, RK or PJ'
    );
    execute v_def;
  end if;
end
$migration$;


create or replace function public.get_sales_report_rows_v4()
returns table(
  order_id uuid,
  order_date date,
  customer_id uuid,
  customer_name text,
  sales_rep_id uuid,
  sales_rep_name text,
  document_no text,
  business_code text,
  business_name text,
  gross_sales numeric,
  return_value numeric,
  net_sales numeric,
  amount_received numeric,
  balance_due numeric,
  order_status text,
  order_type text,
  invoice_value numeric,
  prepayment_value numeric,
  pending_value numeric,
  actual_sales numeric,
  collection_value numeric,
  confirmed_sales numeric
)
language sql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
  select
    r.order_id,r.order_date,r.customer_id,r.customer_name,r.sales_rep_id,r.sales_rep_name,r.document_no,
    case when upper(coalesce(r.document_no,'')) like 'PJ%' then 'PJ' else r.business_code end::text,
    case when upper(coalesce(r.document_no,'')) like 'PJ%' then 'Project' else r.business_name end::text,
    r.gross_sales,r.return_value,r.net_sales,r.amount_received,r.balance_due,r.order_status,r.order_type,
    r.invoice_value,r.prepayment_value,r.pending_value,r.actual_sales,r.collection_value,r.confirmed_sales
  from public.get_sales_report_rows_v3() r
$function$;

grant execute on function public.get_sales_report_rows_v4() to authenticated;


create or replace function public.get_sales_report_item_rows_v4()
returns table(
  sales_order_item_id uuid,
  sales_order_id uuid,
  order_date date,
  sales_rep_id uuid,
  sales_rep_name text,
  document_no text,
  business_code text,
  business_name text,
  brand text,
  product_type text,
  product_class text,
  line_kind text,
  qty numeric,
  gross_line_value numeric,
  line_discount numeric,
  allocated_order_discount numeric,
  return_value numeric,
  net_sales numeric,
  invoice_value numeric,
  prepayment_value numeric,
  pending_value numeric,
  actual_sales numeric,
  collection_value numeric,
  confirmed_sales numeric
)
language sql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
  select
    r.sales_order_item_id,r.sales_order_id,r.order_date,r.sales_rep_id,r.sales_rep_name,r.document_no,
    case when upper(coalesce(r.document_no,'')) like 'PJ%' then 'PJ' else r.business_code end::text,
    case when upper(coalesce(r.document_no,'')) like 'PJ%' then 'Project' else r.business_name end::text,
    r.brand,r.product_type,r.product_class,r.line_kind,r.qty,r.gross_line_value,r.line_discount,
    r.allocated_order_discount,r.return_value,r.net_sales,r.invoice_value,r.prepayment_value,
    r.pending_value,r.actual_sales,r.collection_value,r.confirmed_sales
  from public.get_sales_report_item_rows_v3() r
$function$;

grant execute on function public.get_sales_report_item_rows_v4() to authenticated;


create or replace function public.stock_out_customer_conflict(
  p_reference_type text,
  p_reference_no text,
  p_counterparty text
)
returns text
language plpgsql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_ref_type text:=lower(trim(coalesce(p_reference_type,'')));
  v_ref text:=trim(coalesce(p_reference_no,''));
  v_party text:=trim(coalesce(p_counterparty,''));
  v_party_norm text;
begin
  if v_ref_type='sales_order' then
    return 'The selected reference is a Sales Order / customer document.';
  end if;

  if v_ref ~* '^\s*(RK|TK|PJ|SR)[0-9]' then
    return 'RK / TK / PJ / SR customer references cannot be used for a generic Stock OUT.';
  end if;

  if v_party<>'' then
    v_party_norm:=lower(regexp_replace(v_party,'[^a-zA-Z0-9]','','g'));
    if v_party_norm<>'' and exists(
      select 1
      from public.customers c
      where lower(regexp_replace(coalesce(c.name,''),'[^a-zA-Z0-9]','','g'))=v_party_norm
    ) then
      return 'The destination / counterparty matches an existing customer.';
    end if;
  end if;

  return null;
end;
$function$;

grant execute on function public.stock_out_customer_conflict(text,text,text) to authenticated;
