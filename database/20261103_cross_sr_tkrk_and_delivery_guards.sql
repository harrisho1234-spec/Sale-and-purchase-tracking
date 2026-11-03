-- Prevent repeated SR->TK/RK invoice numbers across separate document tables.
-- Existing historical orders, payments, delivery records and stock movements are unchanged.
-- These guards apply only to NEW numbers, not unrelated updates to historical duplicates.
create or replace function public.guard_cross_source_tk_rk_invoice_number()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $guard$
declare v_doc text;
begin
  if tg_table_name='sales_orders' then
    if tg_op='UPDATE' then
      if new.order_no is not distinct from old.order_no
        and new.invoice_no is not distinct from old.invoice_no
        and new.sales_invoice_no is not distinct from old.sales_invoice_no then
        return new;
      end if;
    end if;
    for v_doc in
      select distinct upper(btrim(doc))
      from unnest(array[new.order_no,new.invoice_no,new.sales_invoice_no]) as docs(doc)
      where doc is not null and btrim(doc)<>'' and upper(btrim(doc)) ~ '^(TK|RK)'
      order by 1
    loop
      perform pg_advisory_xact_lock(hashtextextended('imperial-tkrk:'||v_doc,0));
      if exists (select 1 from public.sales_sr_invoice_parts h
        where upper(btrim(h.invoice_no))=v_doc and h.status in ('pending','issued'))
      then raise exception using errcode='23505',
        message='TK/RK '||v_doc||' is already reserved or issued through an SR conversion. Open the original SR -> linked TK/RK; do not create a second Sales Order.';
      end if;
    end loop;
  elsif tg_table_name='sales_sr_invoice_parts' then
    if new.status not in ('pending','issued') then return new; end if;
    if tg_op='UPDATE' then
      if new.invoice_no is not distinct from old.invoice_no
        and old.status in ('pending','issued') then return new; end if;
    end if;
    v_doc:=upper(btrim(new.invoice_no));
    if v_doc is not null and v_doc<>'' then
      perform pg_advisory_xact_lock(hashtextextended('imperial-tkrk:'||v_doc,0));
      if exists (select 1 from public.sales_orders so
        where upper(btrim(coalesce(so.order_no,'')))=v_doc
          or upper(btrim(coalesce(so.invoice_no,'')))=v_doc
          or upper(btrim(coalesce(so.sales_invoice_no,'')))=v_doc)
      then raise exception using errcode='23505',
        message='TK/RK '||v_doc||' already exists as a Sales Order. Resolve the existing document before issuing an SR conversion with this number.';
      end if;
    end if;
  end if;
  return new;
end;
$guard$;

revoke all on function public.guard_cross_source_tk_rk_invoice_number() from public,anon,authenticated;

drop trigger if exists guard_cross_source_tkrk_sales_orders on public.sales_orders;
create trigger guard_cross_source_tkrk_sales_orders
before insert or update of order_no,invoice_no,sales_invoice_no on public.sales_orders
for each row execute function public.guard_cross_source_tk_rk_invoice_number();

drop trigger if exists guard_cross_source_tkrk_sr_invoice_parts on public.sales_sr_invoice_parts;
create trigger guard_cross_source_tkrk_sr_invoice_parts
before insert or update of invoice_no,status on public.sales_sr_invoice_parts
for each row execute function public.guard_cross_source_tk_rk_invoice_number();

-- The approved SR invoice may already have been delivered through a
-- historical duplicate TK Sales Order. Protect the customer/stock from
-- another DO while retaining the original DO and its delivery movements.
create or replace function public.issued_sr_invoice_legacy_do_conflict(p_invoice_part_id uuid)
returns text language plpgsql stable security definer
set search_path=public,auth,pg_temp as $check$
declare v_invoice public.sales_sr_invoice_parts%rowtype;
        v_customer uuid;
        v_label text;
begin
  select * into v_invoice from public.sales_sr_invoice_parts where id=p_invoice_part_id and status='issued';
  if not found then return null; end if;
  if public.current_app_role() not in ('sales','manager','admin','super_admin') then return null; end if;
  if not public.can_view_sales_order(v_invoice.sales_order_id) then return null; end if;
  select customer_id into v_customer from public.sales_orders where id=v_invoice.sales_order_id;
  select coalesce(dr.do_no,'Existing DO ('||dr.status||')') into v_label
    from public.sales_orders so
    join public.delivery_requests dr on dr.sales_order_id=so.id and dr.status<>'cancelled'
    where so.customer_id=v_customer
      and so.id<>v_invoice.sales_order_id
      and so.sales_flow_type<>'pre_order'
      and (upper(btrim(coalesce(so.sales_invoice_no,'')))=upper(btrim(v_invoice.invoice_no))
        or upper(btrim(coalesce(so.invoice_no,'')))=upper(btrim(v_invoice.invoice_no))
        or upper(btrim(coalesce(so.order_no,'')))=upper(btrim(v_invoice.invoice_no)))
    order by case when dr.status='delivered' then 0 else 1 end,dr.created_at
    limit 1;
  return v_label;
end;
$check$;
revoke all on function public.issued_sr_invoice_legacy_do_conflict(uuid) from public,anon;
grant execute on function public.issued_sr_invoice_legacy_do_conflict(uuid) to authenticated;

create or replace function public.guard_issued_sr_invoice_legacy_do()
returns trigger language plpgsql security definer
set search_path=public,auth,pg_temp as $do$
declare v_conflict text;
begin
  if new.source_invoice_part_id is null then return new; end if;
  v_conflict:=public.issued_sr_invoice_legacy_do_conflict(new.source_invoice_part_id);
  if v_conflict is not null then
    raise exception 'This issued TK/RK already has delivery % through a historical TK record. Do not request a second DO; reconcile its existing delivery instead.',v_conflict;
  end if;
  return new;
end;
$do$;
revoke all on function public.guard_issued_sr_invoice_legacy_do() from public,anon,authenticated;
drop trigger if exists guard_issued_sr_invoice_legacy_do on public.delivery_requests;
create trigger guard_issued_sr_invoice_legacy_do
before insert on public.delivery_requests
for each row execute function public.guard_issued_sr_invoice_legacy_do();

-- Extend the existing duplicate-check RPC without changing its signature,
-- its role checks, or its ordinary Sales Order merge behavior.
CREATE OR REPLACE FUNCTION public.check_sales_document_duplicate(p_doc_no text, p_customer_id uuid DEFAULT NULL::uuid)
 RETURNS TABLE(order_id uuid, document_no text, customer_id uuid, customer_name text, customer_code text, sales_rep_id uuid, sales_rep_name text, order_type text, sales_flow_type text, status text, order_total numeric, amount_paid numeric, balance_due numeric, item_count bigint, can_merge boolean, merge_reason text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text:=public.current_app_role();
  v_uid uuid:=auth.uid();
  v_doc text:=upper(regexp_replace(coalesce(p_doc_no,''),'\s+','','g'));
begin
  if v_doc='' then
    return;
  end if;

  if v_role not in ('sales','manager','admin','super_admin') then
    return;
  end if;

  -- Cross-namespace duplicate: official SR -> TK/RK parts are invoices too.
  -- This branch always rejects merging; it must never append items or cash
  -- to a finalized SR invoice just because the same document no. was entered.
  return query
  select sr.id,
    h.invoice_no::text,
    sr.customer_id,
    coalesce(c.name,'Unknown Customer')::text,
    c.customer_code,
    sr.sales_rep_id,
    coalesce(sr.sales_rep_name_snapshot,au.display_name,au.email,'Unassigned')::text,
    sr.order_type,
    sr.sales_flow_type,
    h.status::text,
    coalesce(h.invoice_total,0)::numeric,
    0::numeric,
    0::numeric,
    (select count(*) from public.sales_sr_invoice_part_lines l where l.invoice_part_id=h.id)::bigint,
    false::boolean,
    ('Official SR '||coalesce(sr.sr_no,sr.order_no)||' already has TK/RK '||h.invoice_no||
      ' ('||upper(h.status)||'). Do NOT create a new Sales Order or merge into this invoice. '||
      'Open the original SR → linked TK/RK for delivery and payment review.')::text
  from public.sales_sr_invoice_parts h
  join public.sales_sr_invoice_sources src on src.invoice_part_id=h.id
  join public.sales_orders sr on sr.id=src.sales_order_id
  left join public.customers c on c.id=sr.customer_id
  left join public.app_users au on au.user_id=sr.sales_rep_id
  where upper(regexp_replace(coalesce(h.invoice_no,''),'\s+','','g'))=v_doc
    and h.status in ('pending','issued')
  order by h.requested_at asc,h.id
  limit 1;
  if found then return; end if;

  return query
  select
    so.id,
    coalesce(
      nullif(so.sales_invoice_no,''),
      nullif(so.invoice_no,''),
      nullif(so.sr_no,''),
      nullif(so.order_no,'')
    ) as document_no,
    so.customer_id,
    coalesce(c.name,'Unknown Customer') as customer_name,
    c.customer_code,
    so.sales_rep_id,
    coalesce(so.sales_rep_name_snapshot,au.display_name,au.email,'Unassigned') as sales_rep_name,
    so.order_type,
    so.sales_flow_type,
    so.status,
    coalesce(s.order_total,0)::numeric as order_total,
    coalesce(s.amount_paid,0)::numeric as amount_paid,
    coalesce(s.balance_due,0)::numeric as balance_due,
    coalesce((
      select count(*)
      from public.sales_order_items soi
      where soi.sales_order_id=so.id
    ),0)::bigint as item_count,

    case
      when so.status='cancelled' then false
      when p_customer_id is not null and so.customer_id<>p_customer_id then false
      when v_role in ('manager','admin','super_admin') then true
      when v_role='sales'
       and p_customer_id is not null
       and so.customer_id=p_customer_id
       and (so.sales_rep_id=v_uid or c.assigned_sales_id=v_uid)
      then true
      else false
    end as can_merge,

    case
      when so.status='cancelled'
        then 'This invoice/order number already exists but the existing document is cancelled. Use a different number unless Manager/Admin corrects it.'
      when p_customer_id is null
        then 'This invoice/order number already exists. Select the correct customer to check whether it can be merged.'
      when so.customer_id<>p_customer_id
        then 'This invoice/order number is already used for a different customer. Use a different number.'
      when v_role in ('manager','admin','super_admin')
        then 'You can merge into this existing document.'
      when v_role='sales'
       and so.customer_id=p_customer_id
       and (so.sales_rep_id=v_uid or c.assigned_sales_id=v_uid)
        then 'You can merge because this is your assigned customer/order.'
      when v_role='sales' and so.customer_id=p_customer_id
        then 'This invoice/order already exists for this customer but belongs to another Sales Rep. Ask Manager/Admin if it needs to be merged.'
      else 'This invoice/order number already exists. Use a different number.'
    end as merge_reason

  from public.sales_orders so
  left join public.customers c on c.id=so.customer_id
  left join public.app_users au on au.user_id=so.sales_rep_id
  left join public.sales_order_summary s on s.id=so.id
  where
    upper(regexp_replace(coalesce(so.order_no,''),'\s+','','g'))=v_doc
    or upper(regexp_replace(coalesce(so.invoice_no,''),'\s+','','g'))=v_doc
    or upper(regexp_replace(coalesce(so.sr_no,''),'\s+','','g'))=v_doc
    or upper(regexp_replace(coalesce(so.sales_invoice_no,''),'\s+','','g'))=v_doc
  order by so.created_at asc
  limit 1;
end;
$function$

