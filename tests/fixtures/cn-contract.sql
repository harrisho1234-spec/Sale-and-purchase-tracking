-- Isolated contract fixture; no production records or credentials.
set check_function_bodies=off;
-- Existing customer-wide reallocation entry point (called by payment/item triggers).
create function public.rebalance_customer_credits(p_customer_id uuid)
returns void language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare v_return_id uuid;
begin
 if p_customer_id is null then return; end if;
 delete from public.sales_credit_applications where customer_id=p_customer_id;
 for v_return_id in select r.id from public.sales_returns r where r.customer_id=p_customer_id
   and r.status<>'cancelled' and r.financial_effect='credit_ar' and r.credit_amount>0
   order by r.return_date,r.created_at,r.id
 loop perform public.rebuild_sales_return_credit_allocations(v_return_id); end loop;
end $fn$;
create role anon; create role authenticated;
create schema auth;
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function public.current_app_role() returns text language sql stable as $$ select current_setting('test.role',true) $$;
create function public.current_user_has_permission(text) returns boolean language sql stable as $$ select coalesce(current_setting('test.permission',true),'true')='true' $$;
create function public.can_edit_sales_order(uuid) returns boolean language sql stable as $$ select auth.uid() is not null and current_app_role() in ('sales','manager','admin','super_admin') and current_user_has_permission('returns.create') $$;
create function public.can_view_sales_order(uuid) returns boolean language sql stable as $$ select can_edit_sales_order($1) $$;
create function public.can_view_inventory() returns boolean language sql stable as $$ select auth.uid() is not null $$;
create table public.app_users(user_id uuid primary key);
create table public.customers(id uuid primary key,name text);
create table public.sales_orders(id uuid primary key,customer_id uuid,order_discount numeric default 0,status text default 'confirmed',sales_flow_type text default 'stock',order_type text default 'stock',order_date date default current_date,created_at timestamptz default now(),sr_no text,sales_invoice_no text,invoice_no text,order_no text,invoice_issued_at timestamptz);
create table public.sales_payments(id uuid primary key default gen_random_uuid(),sales_order_id uuid,amount numeric,notes text);
create table public.stock_movements(id uuid primary key default gen_random_uuid(),reference_item_id uuid,reference_id uuid,reference_type text,movement_type text,affects_balance boolean default true,qty numeric,product_id uuid);
create table public.customer_fulfillment_reconciliations(sales_order_item_id uuid,qty numeric,voided_at timestamptz);
create table public.cn_stock_receipt_requests(id uuid primary key,sales_return_id uuid,sales_return_item_id uuid,status text,requested_qty numeric,requested_at timestamptz);
create table public.cn_exchange_hold_requests(id uuid primary key,sales_return_item_id uuid,status text,held_qty numeric,requested_at timestamptz);
create sequence public.sales_credit_note_seq;
create table public.delivery_request_items(
id uuid primary key default gen_random_uuid(),
delivery_request_id uuid,
sales_order_item_id uuid,
requested_qty numeric,
created_at timestamptz default now()
);
create table public.sales_credit_applications(
id uuid primary key default gen_random_uuid(),
sales_return_id uuid,
customer_id uuid,
sales_order_id uuid,
amount numeric,
created_by uuid,
created_at timestamptz default now()
);
create table public.sales_item_status_quantities(
id uuid primary key default gen_random_uuid(),
sales_order_item_id uuid,
status text,
qty numeric,
updated_by uuid,
updated_at timestamptz default now()
);
create table public.sales_order_items(
id uuid primary key default gen_random_uuid(),
sales_order_id uuid,
product_id uuid,
product_code_snapshot text,
item_name_snapshot text,
image_url_snapshot text,
qty numeric,
unit_price numeric default 0,
discount_amount numeric default 0,
line_total numeric,
source_type text default 'stock'::text,
fulfillment_status text default 'pending'::text,
notes text,
created_at timestamptz default now(),
updated_at timestamptz default now(),
legacy_source_key text,
source_last_synced_at timestamptz,
line_position integer,
product_class_snapshot text,
product_type_snapshot text,
line_kind text default 'product'::text,
inventory_tracking_enabled boolean default true
);
create table public.sales_return_items(
id uuid primary key default gen_random_uuid(),
sales_return_id uuid,
sales_order_item_id uuid,
product_id uuid,
product_code_snapshot text,
item_name_snapshot text,
qty numeric,
unit_price numeric default 0,
condition text default 'good'::text,
disposition text default 'no_stock_action'::text,
notes text,
created_at timestamptz default now(),
historical_stock_reconciled boolean default false,
historical_stock_reconciled_qty numeric default 0,
historical_stock_reconciled_at timestamptz,
historical_stock_reconciled_by uuid,
historical_stock_reconciliation_note text
);
create table public.sales_returns(
id uuid primary key default gen_random_uuid(),
cn_no text,
sales_order_id uuid,
customer_id uuid,
return_date date default CURRENT_DATE,
action text default 'return_only'::text,
reason text,
status text default 'confirmed'::text,
financial_effect text default 'none'::text,
credit_amount numeric default 0,
notes text,
created_by uuid,
approved_by uuid,
created_at timestamptz default now(),
updated_at timestamptz default now()
);
create table public.stock_action_requests(
id uuid primary key default gen_random_uuid(),
action_type text,
payload jsonb default '{}'::jsonb,
reason text,
status text default 'pending'::text,
requested_by uuid default auth.uid(),
requested_at timestamptz default now(),
reviewed_by uuid,
reviewed_at timestamptz,
reviewer_note text,
applied_movement_id uuid,
created_at timestamptz default now(),
updated_at timestamptz default now()
);
alter table public.sales_returns add constraint sales_returns_action_check check(action in ('return_only','return_to_stock','exchange','damaged_return'));
alter table public.sales_returns add unique(cn_no);
alter table public.sales_item_status_quantities add unique(sales_order_item_id,status);
alter table public.sales_item_status_quantities add check(qty>0);
create function public.can_edit_sales_return(uuid) returns boolean language sql stable as $$ select can_edit_sales_order(sales_order_id) from sales_returns where id=$1 $$;
create function public.can_view_sales_return(uuid) returns boolean language sql stable as $$ select can_edit_sales_return($1) $$;
create view public.sales_order_summary as select o.*,
 greatest(coalesce((select sum(qty*unit_price-coalesce(discount_amount,0)) from sales_order_items where sales_order_id=o.id),0)-o.order_discount,0) order_total,
 coalesce((select sum(amount) from sales_payments where sales_order_id=o.id),0) amount_paid,
 greatest(coalesce((select sum(qty*unit_price-coalesce(discount_amount,0)) from sales_order_items where sales_order_id=o.id),0)-o.order_discount-coalesce((select sum(amount) from sales_payments where sales_order_id=o.id),0)-coalesce((select sum(amount) from sales_credit_applications where sales_order_id=o.id),0),0) balance_due
 from sales_orders o;
CREATE OR REPLACE FUNCTION public.sales_order_item_net_return_value(p_sales_order_item_id uuid, p_qty numeric)
 RETURNS numeric
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  with target as (
    select
      i.id,
      i.sales_order_id,
      greatest(coalesce(i.qty,0),0) as sold_qty,
      greatest(coalesce(i.qty,0)*coalesce(i.unit_price,0)-coalesce(i.discount_amount,0),0) as line_net_before_order_discount,
      greatest(coalesce(o.order_discount,0),0) as order_discount
    from public.sales_order_items i
    join public.sales_orders o on o.id=i.sales_order_id
    where i.id=p_sales_order_item_id
  ),
  base as (
    select
      t.*,
      coalesce((
        select sum(greatest(coalesce(i2.qty,0)*coalesce(i2.unit_price,0)-coalesce(i2.discount_amount,0),0))
        from public.sales_order_items i2
        where i2.sales_order_id=t.sales_order_id
      ),0) as order_base_subtotal
    from target t
  )
  select coalesce(round(
    case
      when b.sold_qty<=0 or b.order_base_subtotal<=0 then 0
      else
        (
          greatest(least(coalesce(p_qty,0),b.sold_qty),0) / b.sold_qty
        )
        * b.line_net_before_order_discount
        * (
          greatest(
            b.order_base_subtotal-least(b.order_discount,b.order_base_subtotal),
            0
          ) / b.order_base_subtotal
        )
    end
  ,2),0)
  from base b
$function$;

CREATE OR REPLACE FUNCTION public.rebuild_sales_return_credit_allocations(p_return_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_return public.sales_returns%rowtype;
  v_return_value numeric:=0;
  v_credit numeric:=0;
  v_remaining numeric:=0;
  v_apply numeric:=0;
  v_applied numeric:=0;
  v_order record;
begin
  select * into v_return
  from public.sales_returns
  where id=p_return_id
  for update;

  if not found then raise exception 'Credit Note not found'; end if;

  delete from public.sales_credit_applications where sales_return_id=p_return_id;

  if v_return.status='cancelled' or v_return.financial_effect<>'credit_ar' then
    return jsonb_build_object('return_id',p_return_id,'credit_amount',0,'applied_amount',0,'available_credit',0);
  end if;

  select coalesce(sum(public.sales_order_item_net_return_value(ri.sales_order_item_id,ri.qty)),0)
  into v_return_value
  from public.sales_return_items ri
  where ri.sales_return_id=p_return_id;

  v_credit:=least(greatest(coalesce(v_return.credit_amount,0),0),greatest(v_return_value,0));

  update public.sales_returns
  set credit_amount=v_credit,updated_at=now()
  where id=p_return_id;

  v_remaining:=v_credit;

  for v_order in
    select s.id,s.balance_due,s.order_date,s.created_at
    from public.sales_order_summary s
    where s.customer_id=v_return.customer_id
      and coalesce(s.status,'')<>'cancelled'
      and coalesce(s.balance_due,0)>0.001
      and not (
        (
          lower(coalesce(s.sales_flow_type,''))='pre_order'
          or lower(coalesce(s.order_type,'')) in ('pre_order','mixed')
          or upper(coalesce(s.sr_no,'')) like 'SR%'
        )
        and nullif(coalesce(s.sales_invoice_no,''),'') is null
        and s.invoice_issued_at is null
      )
    order by
      case when exists(
        select 1
        from public.sales_return_items ri
        join public.sales_order_items soi on soi.id=ri.sales_order_item_id
        where ri.sales_return_id=p_return_id
          and soi.sales_order_id=s.id
      ) then 0 else 1 end,
      s.order_date asc,s.created_at asc
  loop
    exit when v_remaining<=0.001;
    v_apply:=least(v_remaining,greatest(coalesce(v_order.balance_due,0),0));
    if v_apply>0.001 then
      insert into public.sales_credit_applications(
        sales_return_id,customer_id,sales_order_id,amount,created_by
      ) values(
        p_return_id,v_return.customer_id,v_order.id,v_apply,coalesce(v_return.approved_by,auth.uid())
      );
      v_remaining:=v_remaining-v_apply;
      v_applied:=v_applied+v_apply;
    end if;
  end loop;

  return jsonb_build_object(
    'return_id',p_return_id,
    'credit_amount',v_credit,
    'applied_amount',v_applied,
    'available_credit',greatest(v_remaining,0)
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.set_sales_return_financial_treatment(p_return_id uuid, p_effect text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text;
  v_status text;
  v_order_id uuid;
  v_value numeric := 0;
  v_result jsonb;
begin
  v_role:=public.current_app_role();
  if v_role not in ('manager','admin','super_admin') then
    raise exception 'Manager, Admin or Super Admin access required';
  end if;

  select status,sales_order_id
  into v_status,v_order_id
  from public.sales_returns
  where id=p_return_id;

  if v_order_id is null then
    raise exception 'Credit Note not found';
  end if;

  if not public.can_edit_sales_return(p_return_id) then
    raise exception 'You do not have permission to update this Credit Note';
  end if;

  if p_effect not in ('none','credit_ar') then
    raise exception 'Invalid financial treatment';
  end if;

  if p_effect='none' then
    delete from public.sales_credit_applications where sales_return_id=p_return_id;
    update public.sales_returns
    set financial_effect='none',
        credit_amount=0,
        approved_by=null,
        updated_at=now()
    where id=p_return_id;

    return jsonb_build_object(
      'return_id',p_return_id,
      'financial_effect','none',
      'credit_amount',0,
      'applied_amount',0,
      'available_credit',0
    );
  end if;

  if v_status<>'received' then
    raise exception 'Mark the return as Received before applying customer credit';
  end if;

  select coalesce(sum(public.sales_order_item_net_return_value(ri.sales_order_item_id,ri.qty)),0)
  into v_value
  from public.sales_return_items ri
  where ri.sales_return_id=p_return_id;

  if v_value<=0 then
    raise exception 'This Credit Note has no net return value';
  end if;

  update public.sales_returns
  set financial_effect='credit_ar',
      credit_amount=v_value,
      approved_by=auth.uid(),
      updated_at=now()
  where id=p_return_id;

  v_result:=public.rebuild_sales_return_credit_allocations(p_return_id);
  return v_result || jsonb_build_object('financial_effect','credit_ar');
end;
$function$;

CREATE OR REPLACE FUNCTION public.create_sales_return_multi(p_sales_order_ids uuid[], p_cn_no text, p_return_date date, p_action text, p_reason text, p_notes text, p_items jsonb)
 RETURNS TABLE(return_id uuid, cn_no text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_return_id uuid;
  v_customer_id uuid;
  v_order_id uuid;
  v_primary_order_id uuid;
  v_order_customer uuid;
  v_cn text;
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_original public.sales_order_items%rowtype;
  v_existing_returned numeric;
  v_count integer := 0;
  v_orders uuid[];
begin
  select array_agg(distinct x)
  into v_orders
  from unnest(coalesce(p_sales_order_ids,array[]::uuid[])) x
  where x is not null;

  if coalesce(array_length(v_orders,1),0)=0 then
    raise exception 'Select at least one original invoice';
  end if;

  v_primary_order_id:=v_orders[1];

  foreach v_order_id in array v_orders loop
    if not public.can_edit_sales_order(v_order_id) then
      raise exception 'You do not have permission to create a return for one of the selected invoices';
    end if;

    select customer_id into v_order_customer
    from public.sales_orders
    where id=v_order_id;

    if v_order_customer is null then
      raise exception 'Selected invoice not found';
    end if;

    if v_customer_id is null then
      v_customer_id:=v_order_customer;
    elsif v_customer_id<>v_order_customer then
      raise exception 'All invoices on one Credit Note must belong to the same customer';
    end if;
  end loop;

  if exists(
    select 1
    from (
      select nullif(value->>'sales_order_item_id','')::uuid item_id,count(*) c
      from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
      where coalesce(nullif(value->>'qty','')::numeric,0)>0
      group by 1
      having count(*)>1
    ) d
  ) then
    raise exception 'The same sales item cannot be added twice to one Credit Note';
  end if;

  v_cn:=upper(trim(coalesce(p_cn_no,'')));
  if v_cn='' then
    v_cn:='CN-'||lpad(nextval('public.sales_credit_note_seq')::text,5,'0');
  elsif v_cn ~* '^CN' then
    v_cn:='CN-'||regexp_replace(v_cn,'^CN[- ]*','','i');
  else
    v_cn:='CN-'||v_cn;
  end if;

  insert into public.sales_returns(
    cn_no,sales_order_id,customer_id,return_date,action,reason,status,
    financial_effect,credit_amount,notes,created_by
  )
  values(
    v_cn,v_primary_order_id,v_customer_id,coalesce(p_return_date,current_date),
    p_action,nullif(trim(coalesce(p_reason,'')),''),
    'confirmed','none',0,nullif(trim(coalesce(p_notes,'')),''),auth.uid()
  )
  returning id into v_return_id;

  if p_action not in ('return_only','return_to_stock','exchange','damaged_return') then
    raise exception 'Invalid return action';
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_item_id:=nullif(v_item->>'sales_order_item_id','')::uuid;
    v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0);
    if v_qty<=0 then continue; end if;

    select * into v_original
    from public.sales_order_items
    where id=v_item_id;

    if not found then
      raise exception 'Original sales item not found';
    end if;

    if not (v_original.sales_order_id=any(v_orders)) then
      raise exception 'Returned item is not part of a selected invoice';
    end if;

    if not public.can_edit_sales_order(v_original.sales_order_id) then
      raise exception 'You do not have permission to return one of the selected items';
    end if;

    select coalesce(sum(ri.qty),0)
    into v_existing_returned
    from public.sales_return_items ri
    join public.sales_returns r on r.id=ri.sales_return_id
    where ri.sales_order_item_id=v_item_id
      and r.status<>'cancelled';

    if v_qty>greatest(v_original.qty-v_existing_returned,0) then
      raise exception 'Return quantity for % cannot exceed remaining returnable quantity %',
        coalesce(v_original.item_name_snapshot,v_original.product_code_snapshot,'item'),
        greatest(v_original.qty-v_existing_returned,0);
    end if;

    insert into public.sales_return_items(
      sales_return_id,sales_order_item_id,product_id,product_code_snapshot,
      item_name_snapshot,qty,unit_price,condition,disposition,notes
    )
    values(
      v_return_id,v_original.id,v_original.product_id,v_original.product_code_snapshot,
      v_original.item_name_snapshot,v_qty,coalesce(v_original.unit_price,0),
      case when coalesce(v_item->>'condition','good') in ('good','damaged','defective','other')
        then coalesce(v_item->>'condition','good') else 'good' end,
      case when coalesce(v_item->>'disposition','no_stock_action') in ('return_to_stock','damaged_hold','exchange','no_stock_action')
        then coalesce(v_item->>'disposition','no_stock_action') else 'no_stock_action' end,
      nullif(trim(coalesce(v_item->>'notes','')),'')
    );
    v_count:=v_count+1;
  end loop;

  if v_count=0 then
    raise exception 'Please select at least one item to return';
  end if;

  return query select v_return_id,v_cn;
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_sales_return(p_return_id uuid, p_return_date date, p_action text, p_reason text, p_notes text, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_primary_order_id uuid;
  v_customer_id uuid;
  v_status text;
  v_effect text;
  v_item jsonb;
  v_item_id uuid;
  v_qty numeric;
  v_original public.sales_order_items%rowtype;
  v_item_customer uuid;
  v_other_returned numeric;
  v_count integer:=0;
  v_credit numeric:=0;
begin
  if not public.can_edit_sales_return(p_return_id) then
    raise exception 'You do not have permission to edit this Credit Note';
  end if;

  select sales_order_id,customer_id,status,financial_effect
  into v_primary_order_id,v_customer_id,v_status,v_effect
  from public.sales_returns
  where id=p_return_id;

  if v_primary_order_id is null then raise exception 'Credit Note not found'; end if;
  if v_status='cancelled' then raise exception 'Cancelled Credit Notes cannot be edited'; end if;
  if p_action not in ('return_only','return_to_stock','exchange','damaged_return') then
    raise exception 'Invalid return action';
  end if;

  if exists(
    select 1
    from (
      select nullif(value->>'sales_order_item_id','')::uuid item_id,count(*) c
      from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
      where coalesce(nullif(value->>'qty','')::numeric,0)>0
      group by 1
      having count(*)>1
    ) d
  ) then
    raise exception 'The same sales item cannot be added twice to one Credit Note';
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_item_id:=nullif(v_item->>'sales_order_item_id','')::uuid;
    v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0);
    if v_qty<=0 then continue; end if;

    select * into v_original from public.sales_order_items where id=v_item_id;
    if not found then raise exception 'Original sales item not found'; end if;

    select customer_id into v_item_customer
    from public.sales_orders
    where id=v_original.sales_order_id;

    if v_item_customer is distinct from v_customer_id then
      raise exception 'All returned items on one Credit Note must belong to the same customer';
    end if;

    if not public.can_edit_sales_order(v_original.sales_order_id) then
      raise exception 'You do not have permission to edit one of the source invoices';
    end if;

    select coalesce(sum(ri2.qty),0)
    into v_other_returned
    from public.sales_return_items ri2
    join public.sales_returns r2 on r2.id=ri2.sales_return_id
    where ri2.sales_order_item_id=v_item_id
      and r2.id<>p_return_id
      and r2.status<>'cancelled';

    if v_qty>greatest(v_original.qty-v_other_returned,0) then
      raise exception 'Return quantity for % cannot exceed remaining returnable quantity %',
        coalesce(v_original.item_name_snapshot,v_original.product_code_snapshot,'item'),
        greatest(v_original.qty-v_other_returned,0);
    end if;
    v_count:=v_count+1;
  end loop;

  if v_count=0 then raise exception 'A Credit Note must contain at least one returned item'; end if;

  update public.sales_returns
  set return_date=coalesce(p_return_date,current_date),
      action=p_action,
      reason=nullif(trim(coalesce(p_reason,'')),''),
      notes=nullif(trim(coalesce(p_notes,'')),''),
      updated_at=now()
  where id=p_return_id;

  delete from public.sales_return_items where sales_return_id=p_return_id;

  for v_item in select value from jsonb_array_elements(coalesce(p_items,'[]'::jsonb))
  loop
    v_item_id:=nullif(v_item->>'sales_order_item_id','')::uuid;
    v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0);
    if v_qty<=0 then continue; end if;

    select * into v_original from public.sales_order_items where id=v_item_id;

    insert into public.sales_return_items(
      sales_return_id,sales_order_item_id,product_id,product_code_snapshot,
      item_name_snapshot,qty,unit_price,condition,disposition,notes
    )
    values(
      p_return_id,v_original.id,v_original.product_id,v_original.product_code_snapshot,
      v_original.item_name_snapshot,v_qty,coalesce(v_original.unit_price,0),
      case when coalesce(v_item->>'condition','good') in ('good','damaged','defective','other')
        then coalesce(v_item->>'condition','good') else 'good' end,
      case when coalesce(v_item->>'disposition','no_stock_action') in ('return_to_stock','damaged_hold','exchange','no_stock_action')
        then coalesce(v_item->>'disposition','no_stock_action') else 'no_stock_action' end,
      nullif(trim(coalesce(v_item->>'notes','')),'')
    );
  end loop;

  if v_effect='credit_ar' then
    select coalesce(sum(public.sales_order_item_net_return_value(ri.sales_order_item_id,ri.qty)),0)
    into v_credit
    from public.sales_return_items ri
    where ri.sales_return_id=p_return_id;

    update public.sales_returns
    set credit_amount=v_credit,updated_at=now()
    where id=p_return_id;

    perform public.rebuild_sales_return_credit_allocations(p_return_id);
  end if;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_returnable_order_items(p_sales_order_id uuid)
 RETURNS TABLE(sales_order_item_id uuid, product_id uuid, product_code text, item_name text, qty_sold numeric, qty_returned numeric, qty_available numeric, unit_price numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth'
AS $function$
begin
  if not public.can_view_sales_order(p_sales_order_id) then
    raise exception 'Access denied';
  end if;

  return query
  select
    i.id,
    i.product_id,
    i.product_code_snapshot,
    i.item_name_snapshot,
    i.qty,
    coalesce((
      select sum(ri.qty)
      from public.sales_return_items ri
      join public.sales_returns r on r.id = ri.sales_return_id
      where ri.sales_order_item_id = i.id
        and r.status <> 'cancelled'
    ),0),
    greatest(
      i.qty - coalesce((
        select sum(ri.qty)
        from public.sales_return_items ri
        join public.sales_returns r on r.id = ri.sales_return_id
        where ri.sales_order_item_id = i.id
          and r.status <> 'cancelled'
      ),0),
      0
    ),
    i.unit_price
  from public.sales_order_items i
  where i.sales_order_id = p_sales_order_id
  order by i.line_position nulls last, i.created_at, i.id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_cn_stock_receipt_queue()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
select case when auth.uid() is null or not public.can_view_inventory() then null
 else coalesce((
 select jsonb_agg(jsonb_build_object(
  'return_item_id',r.id,'return_id',cn.id,'cn_no',cn.cn_no,
  'return_date',cn.return_date,'customer_name',cust.name,'return_status',cn.status,
  'awaiting_physical_return',cn.status='confirmed' and (wf.approval_status is null or wf.approval_status='approved'),
  'approval_status',coalesce(wf.approval_status,'legacy'),'exchange_hold_pending_qty',coalesce(hld.pending_qty,0),'exchange_held_qty',coalesce(hld.approved_qty,0),'exchange_hold_request_id',hld.pending_id,'exchange_available_to_process',case when r.disposition='exchange' then greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0)-coalesce(pnd.qty,0)-coalesce(hld.pending_qty,0)-coalesce(hld.approved_qty,0),0) else 0 end,'warehouse_stage',case when wf.approval_status='pending' then 'awaiting_cn_approval' when wf.approval_status='rejected' then 'cn_rejected'
    when coalesce(pnd.qty,0)>0 then 'receipt_approval_pending'
    when r.disposition='exchange' and coalesce(hld.pending_qty,0)>0 then 'exchange_hold_approval_pending' when r.disposition='exchange' and (coalesce(r.historical_stock_reconciled_qty,0)+coalesce(mv.received,0)+coalesce(hld.approved_qty,0))>=r.qty then 'exchange_resolved' when r.disposition='exchange' then 'exchange_inspection_pending' when r.disposition<>'return_to_stock' then 'no_stock_action'
    when greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0),0)=0 then 'stock_received'
    when cn.status='confirmed' then 'awaiting_physical_return'
    else 'ready_for_stock_receipt' end,
  'can_request_receipt',(wf.approval_status is null or wf.approval_status='approved') and r.disposition in ('return_to_stock','exchange') and
    greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0)-coalesce(pnd.qty,0)-case when r.disposition='exchange' then coalesce(hld.pending_qty,0)+coalesce(hld.approved_qty,0) else 0 end,0)>0,
  'item_name',r.item_name_snapshot,'product_code',r.product_code_snapshot,
  'product_id',r.product_id,'cn_qty',r.qty,
  'historical_qty',coalesce(r.historical_stock_reconciled_qty,0),
  'received_qty',coalesce(mv.received,0),'pending_approval_qty',coalesce(pnd.qty,0),
  'available_to_request',case when (wf.approval_status is null or wf.approval_status='approved') and r.disposition in ('return_to_stock','exchange')
    then greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)-coalesce(mv.received,0)-coalesce(pnd.qty,0)-case when r.disposition='exchange' then coalesce(hld.pending_qty,0)+coalesce(hld.approved_qty,0) else 0 end,0)
    else 0 end,
  'condition',r.condition,'disposition',r.disposition,'notes',r.notes,
  'request_id',pnd.id
 ) order by cn.return_date desc,cn.cn_no,r.created_at)
 from public.sales_return_items r
 join public.sales_returns cn on cn.id=r.sales_return_id left join public.cn_case_workflows wf on wf.sales_return_id=cn.id
 left join public.customers cust on cust.id=cn.customer_id left join lateral (select coalesce(sum(held_qty) filter (where status='pending'),0) pending_qty,coalesce(sum(held_qty) filter (where status='approved'),0) approved_qty,(array_agg(id order by requested_at) filter (where status='pending'))[1] pending_id from public.cn_exchange_hold_requests where sales_return_item_id=r.id) hld on true
 left join lateral (
  select coalesce(sum(m.qty),0) received from public.stock_movements m
  where m.affects_balance and m.movement_type in ('in','return')
   and m.reference_type='sales_return_item' and m.reference_item_id=r.id
 ) mv on true
 left join lateral (
  select req.id,req.requested_qty qty from public.cn_stock_receipt_requests req
  where req.sales_return_item_id=r.id and req.status='pending'
  order by req.requested_at limit 1
 ) pnd on true
 where cn.status in ('confirmed','received')
 ),'[]'::jsonb) end
$function$;

-- New CNs use an independent, auditable approval and case-closure workflow.
-- Older CNs remain legacy records and are not assigned pending approvals.
create table if not exists public.cn_case_workflows(
 sales_return_id uuid primary key references public.sales_returns(id) on delete cascade,
 approval_status text not null default 'pending'
   check(approval_status in ('pending','approved','rejected')),
 approved_by uuid references public.app_users(user_id),
 approved_at timestamptz,
 approval_note text,
 financial_decision text not null default 'pending'
   check(financial_decision in ('pending','no_credit','credit_ar')),
 financial_decided_by uuid references public.app_users(user_id),
 financial_decided_at timestamptz,
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.cn_case_workflows enable row level security;
revoke all on public.cn_case_workflows from public,anon,authenticated;
-- Only RPCs access case state. Stock-facing queue exposes the necessary flags.

create or replace function public.create_cn_case_workflow()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 insert into public.cn_case_workflows(sales_return_id) values(new.id);
 return new;
end $fn$;
drop trigger if exists create_cn_case_workflow_trg on public.sales_returns;
create trigger create_cn_case_workflow_trg after insert on public.sales_returns
for each row execute function public.create_cn_case_workflow();

create or replace function public.cn_case_stock_complete(p_return_id uuid)
returns boolean language sql stable security definer set search_path='public','auth','pg_temp'
as $fn$
 select not exists (
   select 1 from public.sales_return_items ri
   where ri.sales_return_id=p_return_id and ri.disposition='return_to_stock'
     and (
       ri.qty>coalesce(ri.historical_stock_reconciled_qty,0)+coalesce((
         select sum(sm.qty) from public.stock_movements sm
         where sm.affects_balance and sm.movement_type in ('return','in')
          and sm.reference_type='sales_return_item' and sm.reference_item_id=ri.id
       ),0)
       or exists(select 1 from public.cn_stock_receipt_requests req
          where req.sales_return_item_id=ri.id and req.status='pending')
     )
 );
$fn$;

create or replace function public.refresh_cn_case_closure(p_return_id uuid)
returns void language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype; r public.sales_returns%rowtype; done_stock boolean;
begin
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found then return; end if; -- Preserve legacy CNs.
 select * into r from public.sales_returns where id=p_return_id;
 done_stock:=public.cn_case_stock_complete(p_return_id);
 if r.status='cancelled' or w.approval_status<>'approved' then
   update public.cn_case_workflows set closed_at=null,updated_at=now()
   where sales_return_id=p_return_id and closed_at is not null;
   return;
 end if;
 if done_stock and r.status='confirmed' then
   -- No Stock Action cases also move to ready-for-financial-decision.
   perform set_config('app.cn_workflow_internal','1',true);
   update public.sales_returns set status='received',updated_at=now() where id=p_return_id;
   perform set_config('app.cn_workflow_internal','',true);
 end if;
 update public.cn_case_workflows
 set closed_at=case when done_stock and financial_decision<>'pending'
   then coalesce(closed_at,now()) else null end,updated_at=now()
 where sales_return_id=p_return_id;
end $fn$;

create or replace function public.review_cn_case(p_return_id uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;r public.sales_returns%rowtype;
begin
 if auth.uid() is null or public.current_app_role() not in ('manager','admin','super_admin')
  or not public.current_user_has_permission('returns.approve')
 then raise exception 'Manager/Admin CN approval permission required';end if;
 if length(coalesce(p_note,''))>2000 then raise exception 'CN approval note is too long';end if;
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found then raise exception 'Historical CN is outside the new approval workflow';end if;
 select * into r from public.sales_returns where id=p_return_id for update;
 if r.status='cancelled' then raise exception 'Cancelled CN cannot be approved';end if;
 if w.approval_status<>'pending' then raise exception 'This CN approval was already reviewed';end if;
 if r.created_by=auth.uid() then raise exception 'CN preparer cannot approve their own CN';end if;
 update public.cn_case_workflows
 set approval_status=case when p_approve then 'approved' else 'rejected' end,
     approved_by=auth.uid(),approved_at=now(),
     approval_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=now()
 where sales_return_id=p_return_id;
 if p_approve then perform public.refresh_cn_case_closure(p_return_id);end if;
 return jsonb_build_object('return_id',p_return_id,
  'approval_status',case when p_approve then 'approved' else 'rejected' end);
end $fn$;

create or replace function public.resubmit_cn_case(p_return_id uuid)
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;
begin
 if not public.can_edit_sales_return(p_return_id) then
   raise exception 'You do not have permission to resubmit this CN';end if;
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found or w.approval_status<>'rejected' then
  raise exception 'Only rejected CNs can be resubmitted';end if;
 if exists(select 1 from public.cn_stock_receipt_requests where sales_return_id=p_return_id) then
  raise exception 'CN has warehouse receipts and cannot be resubmitted';end if;
 update public.cn_case_workflows
 set approval_status='pending',approved_by=null,approved_at=null,approval_note=null,
  financial_decision='pending',financial_decided_by=null,financial_decided_at=null,
  closed_at=null,updated_at=now() where sales_return_id=p_return_id;
 return jsonb_build_object('approval_status','pending','return_id',p_return_id);
end $fn$;

create or replace function public.decide_cn_no_credit(p_return_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;r public.sales_returns%rowtype;
begin
 if auth.uid() is null or public.current_app_role() not in ('manager','admin','super_admin')
  or not public.current_user_has_permission('returns.approve') then
  raise exception 'Manager/Admin CN financial decision permission required';end if;
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found or w.approval_status<>'approved' then raise exception 'CN approval required';end if;
 if w.financial_decision<>'pending' then raise exception 'Financial decision already finalized';end if;
 if not public.cn_case_stock_complete(p_return_id) then
  raise exception 'Finish physical stock receipts before final financial decision';end if;
 select * into r from public.sales_returns where id=p_return_id;
 if r.financial_effect<>'none' then raise exception 'Customer Credit already applied';end if;
 update public.cn_case_workflows set financial_decision='no_credit',
 financial_decided_by=auth.uid(),financial_decided_at=now(),
 updated_at=now() where sales_return_id=p_return_id;
 perform public.refresh_cn_case_closure(p_return_id);
 return jsonb_build_object('return_id',p_return_id,'financial_decision','no_credit','case_closed',true);
end $fn$;

create or replace function public.mark_cn_credit_decision()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;
begin
 select * into w from public.cn_case_workflows where sales_return_id=new.id for update;
 if not found or new.financial_effect is not distinct from old.financial_effect then return new;end if;
 if w.approval_status<>'approved' then raise exception 'Approve the CN before customer-credit changes';end if;
 if not public.cn_case_stock_complete(new.id) then
  raise exception 'Complete physical stock receipt approval before applying customer credit';end if;
 if w.closed_at is not null then
  raise exception 'This CN is closed. Contact an administrator to review corrections';end if;
 if new.financial_effect='credit_ar' then
  update public.cn_case_workflows set financial_decision='credit_ar',
   financial_decided_by=auth.uid(),financial_decided_at=now(),updated_at=now()
   where sales_return_id=new.id;
 else
  update public.cn_case_workflows set financial_decision='pending',
   financial_decided_by=null,financial_decided_at=null,updated_at=now()
   where sales_return_id=new.id;
 end if;
 return new;
end $fn$;
drop trigger if exists mark_cn_credit_decision_trg on public.sales_returns;
create trigger mark_cn_credit_decision_trg
before update of financial_effect on public.sales_returns
for each row execute function public.mark_cn_credit_decision();

create or replace function public.close_cn_case_after_credit()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 if old.financial_effect is distinct from new.financial_effect then
  perform public.refresh_cn_case_closure(new.id);
 end if;
 return new;
end $fn$;
drop trigger if exists close_cn_case_after_credit_trg on public.sales_returns;
create trigger close_cn_case_after_credit_trg
after update of financial_effect on public.sales_returns
for each row execute function public.close_cn_case_after_credit();

create or replace function public.guard_cn_case_stock_receipt()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare v_status text;
begin
 select approval_status into v_status from public.cn_case_workflows
 where sales_return_id=new.sales_return_id;
 if found and v_status<>'approved' then
  raise exception 'Manager/Admin must approve the CN before Stock can receive it';end if;
 return new;
end $fn$;
drop trigger if exists guard_cn_case_stock_receipt_insert on public.cn_stock_receipt_requests;
create trigger guard_cn_case_stock_receipt_insert
before insert on public.cn_stock_receipt_requests
for each row execute function public.guard_cn_case_stock_receipt();
drop trigger if exists guard_cn_case_stock_receipt_review on public.cn_stock_receipt_requests;
create trigger guard_cn_case_stock_receipt_review
before update of status on public.cn_stock_receipt_requests
for each row when(new.status='approved')
execute function public.guard_cn_case_stock_receipt();

create or replace function public.after_cn_stock_receipt_approval()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 if new.status in ('approved','rejected') and old.status is distinct from new.status then
  perform public.refresh_cn_case_closure(new.sales_return_id);
 end if;
 return new;
end $fn$;
drop trigger if exists after_cn_stock_receipt_approval_trg on public.cn_stock_receipt_requests;
create trigger after_cn_stock_receipt_approval_trg
after update of status on public.cn_stock_receipt_requests
for each row execute function public.after_cn_stock_receipt_approval();

create or replace function public.guard_cn_case_edits()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;v_id uuid;
begin
 v_id:=case when tg_op='DELETE' then old.id else new.id end;
 select * into w from public.cn_case_workflows where sales_return_id=v_id;
 if not found then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
  if w.approval_status='approved' then
   raise exception 'Approved CNs cannot be deleted; request a controlled correction';end if;
  return old;
 end if;
 if new.status is distinct from old.status and
   coalesce(current_setting('app.cn_workflow_internal',true),'')<>'1' then
   if new.status='received' then
    raise exception 'New CNs are marked Received through warehouse completion, not manually';end if;
   if new.status='cancelled' and w.approval_status='approved' then
    raise exception 'Approved CN cannot be cancelled directly';end if;
 end if;
 if (new.action,new.reason,new.return_date,new.sales_order_id,new.customer_id,new.notes)
    is distinct from (old.action,old.reason,old.return_date,old.sales_order_id,old.customer_id,old.notes)
    and w.approval_status='approved' then
  raise exception 'Approved CN cannot be edited directly';end if;
 return new;
end $fn$;
drop trigger if exists guard_cn_case_edits_trg on public.sales_returns;
create trigger guard_cn_case_edits_trg
before update or delete on public.sales_returns
for each row execute function public.guard_cn_case_edits();

create or replace function public.guard_cn_case_item_edits()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare v_id uuid;v_status text;
begin
 v_id:=case when tg_op='DELETE' then old.sales_return_id else new.sales_return_id end;
 select approval_status into v_status from public.cn_case_workflows where sales_return_id=v_id;
 if found and v_status='approved' then
  raise exception 'Approved CN product lines cannot be changed';end if;
 return case when tg_op='DELETE' then old else new end;
end $fn$;
drop trigger if exists guard_cn_case_item_edits_trg on public.sales_return_items;
create trigger guard_cn_case_item_edits_trg
before insert or update or delete on public.sales_return_items
for each row execute function public.guard_cn_case_item_edits();

create or replace function public.get_visible_cn_case_workflows()
returns jsonb language sql stable security definer set search_path='public','auth','pg_temp'
as $fn$
select case when auth.uid() is null then null else
coalesce((select jsonb_agg(jsonb_build_object(
 'return_id',w.sales_return_id,'cn_no',r.cn_no,
 'approval_status',w.approval_status,'approval_note',w.approval_note,
 'approved_at',w.approved_at,'approved_by',w.approved_by,
 'financial_decision',w.financial_decision,'closed_at',w.closed_at,
 'stock_complete',public.cn_case_stock_complete(w.sales_return_id),
 'requested_by',r.created_by,'customer_name',c.name,
 'workflow_status',case
  when w.approval_status='pending' then 'Awaiting CN Approval'
  when w.approval_status='rejected' then 'CN Rejected'
  when w.closed_at is not null then 'Case Closed'
  when not public.cn_case_stock_complete(w.sales_return_id) then 'Awaiting Stock Receipt'
  else 'Awaiting Financial Decision' end
) order by r.created_at desc)
from public.cn_case_workflows w
join public.sales_returns r on r.id=w.sales_return_id
join public.customers c on c.id=r.customer_id
where public.can_view_sales_return(r.id)
),'[]'::jsonb) end
$fn$;

-- Only the CN-case RPCs can mutate case state. Read uses scoped SECURITY DEFINER.
revoke all on function public.cn_case_stock_complete(uuid) from public,anon,authenticated;
revoke all on function public.refresh_cn_case_closure(uuid) from public,anon,authenticated;
revoke all on function public.review_cn_case(uuid,boolean,text) from public,anon;
revoke all on function public.resubmit_cn_case(uuid) from public,anon;
revoke all on function public.decide_cn_no_credit(uuid,text) from public,anon;
revoke all on function public.get_visible_cn_case_workflows() from public,anon;
grant execute on function public.review_cn_case(uuid,boolean,text) to authenticated;
grant execute on function public.resubmit_cn_case(uuid) to authenticated;
grant execute on function public.decide_cn_no_credit(uuid,text) to authenticated;
grant execute on function public.get_visible_cn_case_workflows() to authenticated;
CREATE OR REPLACE FUNCTION public.cn_case_stock_complete(p_return_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
 select not exists (
  select 1 from public.sales_return_items ri
  where ri.sales_return_id=p_return_id
   and ri.disposition in ('return_to_stock','exchange')
   and (
     ri.qty>coalesce(ri.historical_stock_reconciled_qty,0)+coalesce((
       select sum(sm.qty) from public.stock_movements sm
       where sm.affects_balance and sm.movement_type in ('return','in')
        and sm.reference_type='sales_return_item' and sm.reference_item_id=ri.id
     ),0)+case when ri.disposition='exchange' then coalesce((
       select sum(held_qty) from public.cn_exchange_hold_requests h
       where h.sales_return_item_id=ri.id and h.status='approved'
     ),0) else 0 end
     or exists(select 1 from public.cn_stock_receipt_requests req
       where req.sales_return_item_id=ri.id and req.status='pending')
     or exists(select 1 from public.cn_exchange_hold_requests h
       where h.sales_return_item_id=ri.id and h.status='pending')
   )
 );
$function$;
