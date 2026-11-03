-- Strengthen duplicate protections after initial cross-source migration.
-- Keep all historical TK, SR, DO and payment rows untouched.
create or replace function public.guard_issued_sr_invoice_legacy_do()
returns trigger language plpgsql security definer
set search_path=public,auth,pg_temp as $do$
declare v_invoice text;
        v_customer uuid;
        v_conflict text;
begin
  if new.source_invoice_part_id is null then return new; end if;
  select h.invoice_no,so.customer_id into v_invoice,v_customer
  from public.sales_sr_invoice_parts h
  join public.sales_orders so on so.id=h.sales_order_id
  where h.id=new.source_invoice_part_id and h.status='issued';
  if v_invoice is null then return new; end if;
  -- Security-definer trigger must enforce independently of caller/JWT role.
  select coalesce(dr.do_no,'Existing DO ('||dr.status||')') into v_conflict
  from public.sales_orders so
  join public.delivery_requests dr on dr.sales_order_id=so.id
    and dr.status<>'cancelled'
  where so.customer_id=v_customer and so.sales_flow_type<>'pre_order'
    and (upper(btrim(coalesce(so.order_no,'')))=upper(btrim(v_invoice))
      or upper(btrim(coalesce(so.invoice_no,'')))=upper(btrim(v_invoice))
      or upper(btrim(coalesce(so.sales_invoice_no,'')))=upper(btrim(v_invoice)))
  order by case when dr.status='delivered' then 0 else 1 end,dr.created_at
  limit 1;
  if v_conflict is not null then
    raise exception 'This issued TK/RK already has % from a historical duplicate TK record. Do not request or release another DO; use the existing delivery history.',v_conflict;
  end if;
  return new;
end;
$do$;
revoke all on function public.guard_issued_sr_invoice_legacy_do() from public,anon,authenticated;

CREATE OR REPLACE FUNCTION public.merge_sales_order_document(p_order_id uuid, p_customer_id uuid, p_expected_doc_no text, p_flow_type text, p_order_discount_add numeric DEFAULT 0, p_items jsonb DEFAULT '[]'::jsonb, p_payment_amount numeric DEFAULT 0, p_payment_date date DEFAULT CURRENT_DATE, p_payment_method text DEFAULT 'Deposit'::text, p_payment_note text DEFAULT 'Additional deposit from merged entry'::text)
 RETURNS TABLE(order_id uuid, item_count bigint, order_total numeric, amount_paid numeric, balance_due numeric)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_role text := public.current_app_role();
  v_uid uuid := auth.uid();
  v_order public.sales_orders%rowtype;
  v_customer_assigned uuid;
  v_doc text := upper(regexp_replace(coalesce(p_expected_doc_no,''), '\s+', '', 'g'));
  v_existing_doc text;
  v_base_pos int;
  v_line_sum numeric;
  v_new_discount numeric;
  v_total numeric;
  v_paid numeric;
begin
  select * into v_order from public.sales_orders where id=p_order_id for update;
  if not found then raise exception 'Existing sales order not found.'; end if;

  select assigned_sales_id into v_customer_assigned from public.customers where id=v_order.customer_id;

  if v_role not in ('super_admin','admin','manager') and not (
    v_role='sales' and v_order.customer_id=p_customer_id and (v_order.sales_rep_id=v_uid or v_customer_assigned=v_uid)
  ) then
    raise exception 'You do not have permission to merge into this order.';
  end if;

  if v_order.customer_id is distinct from p_customer_id then raise exception 'The existing document belongs to a different customer.'; end if;
  if v_order.status='cancelled' then raise exception 'Cannot merge into a cancelled order.'; end if;

  v_existing_doc := upper(regexp_replace(coalesce(v_order.invoice_no,v_order.sr_no,v_order.order_no,v_order.sales_invoice_no,''), '\s+', '', 'g'));
  if v_doc='' or v_existing_doc<>v_doc then raise exception 'Document number changed. Please check again before merging.'; end if;
  -- Merging normal TK/RK copies into an already issued SR invoice would
  -- silently alter amounts/products on the wrong document. Block it server-side.
  if exists(select 1 from public.sales_sr_invoice_parts h
    where upper(btrim(h.invoice_no))=v_doc and h.status in ('pending','issued'))
  then
    raise exception 'TK/RK % already belongs to an SR conversion. Open the source SR and linked invoice; do not merge into a separate order.',v_doc;
  end if;

  if p_flow_type='pre_order' and coalesce(v_order.sales_flow_type,'')<>'pre_order' and coalesce(v_order.order_type,'')<>'pre_order' then
    raise exception 'Cannot merge a pre-order entry into a stock-sale document.';
  end if;
  if p_flow_type='stock_sale' and (coalesce(v_order.sales_flow_type,'')='pre_order' or coalesce(v_order.order_type,'')='pre_order') then
    raise exception 'Cannot merge a stock-sale entry into an SR pre-order document.';
  end if;

  if coalesce(p_order_discount_add,0)<0 then raise exception 'Order discount cannot be negative.'; end if;
  if coalesce(p_payment_amount,0)<0 then raise exception 'Payment amount cannot be negative.'; end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then raise exception 'Items payload must be an array.'; end if;
  if jsonb_array_length(coalesce(p_items,'[]'::jsonb))=0 then raise exception 'Add at least one item to merge.'; end if;

  if exists (
    select 1 from jsonb_array_elements(p_items) x
    where coalesce((x->>'qty')::numeric,0)<=0
       or coalesce((x->>'unit_price')::numeric,-1)<0
       or coalesce((x->>'discount_amount')::numeric,-1)<0
  ) then raise exception 'Please check item quantity, price and discount.'; end if;

  select greatest(coalesce(max(line_position),0),count(*)::int) into v_base_pos
  from public.sales_order_items where sales_order_id=p_order_id;

  insert into public.sales_order_items(
    sales_order_id,product_id,product_code_snapshot,item_name_snapshot,image_url_snapshot,
    qty,unit_price,discount_amount,source_type,fulfillment_status,notes,line_position
  )
  select
    p_order_id,
    nullif(x.item->>'product_id','')::uuid,
    nullif(x.item->>'product_code_snapshot',''),
    nullif(x.item->>'item_name_snapshot',''),
    nullif(x.item->>'image_url_snapshot',''),
    (x.item->>'qty')::numeric,
    (x.item->>'unit_price')::numeric,
    coalesce((x.item->>'discount_amount')::numeric,0),
    coalesce(nullif(x.item->>'source_type',''),case when p_flow_type='pre_order' then 'pre_order' else 'stock' end),
    coalesce(nullif(x.item->>'fulfillment_status',''),case when p_flow_type='pre_order' then 'pending' else 'ready' end),
    nullif(x.item->>'notes',''),
    v_base_pos + x.ord::int
  from jsonb_array_elements(p_items) with ordinality as x(item,ord);

  update public.sales_orders
  set order_discount=coalesce(order_discount,0)+coalesce(p_order_discount_add,0), updated_at=now()
  where id=p_order_id;

  select coalesce(sum(line_total),0) into v_line_sum from public.sales_order_items where sales_order_id=p_order_id;
  select coalesce(order_discount,0) into v_new_discount from public.sales_orders where id=p_order_id;
  if v_new_discount>v_line_sum then raise exception 'Total order discount cannot exceed the item subtotal.'; end if;

  select coalesce(order_total,0),coalesce(amount_paid,0) into v_total,v_paid from public.sales_order_summary where id=p_order_id;
  if coalesce(p_payment_amount,0)>greatest(v_total-v_paid,0)+0.001 then
    raise exception 'Additional payment cannot exceed the remaining balance after the merged items are added.';
  end if;

  if coalesce(p_payment_amount,0)>0 then
    insert into public.sales_payments(sales_order_id,payment_date,amount,method,notes,received_by)
    values(p_order_id,coalesce(p_payment_date,current_date),p_payment_amount,coalesce(nullif(trim(p_payment_method),''),'Deposit'),coalesce(nullif(trim(p_payment_note),''),'Additional deposit from merged entry'),v_uid);
  end if;

  return query
  select s.id,
         (select count(*) from public.sales_order_items soi where soi.sales_order_id=s.id)::bigint,
         coalesce(s.order_total,0)::numeric,
         coalesce(s.amount_paid,0)::numeric,
         coalesce(s.balance_due,0)::numeric
  from public.sales_order_summary s where s.id=p_order_id;
end;
$function$

