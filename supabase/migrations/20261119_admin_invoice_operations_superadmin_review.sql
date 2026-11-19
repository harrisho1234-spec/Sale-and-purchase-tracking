-- 2026-11-19: Admin invoice edit/delete privilege, super-admin post-action audit review.
-- Leaves user access, roles, tax settings and other Super-Admin-only areas protected.
begin;
alter table public.sales_invoice_admin_audit
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid,
  add column if not exists review_note text;
drop policy if exists sales_invoice_admin_audit_super_insert on public.sales_invoice_admin_audit;
create policy sales_invoice_admin_audit_admin_insert
on public.sales_invoice_admin_audit for insert to authenticated
with check (
 public.current_app_role() in ('admin','super_admin')
 and actor_user_id = (select auth.uid())
 and action = 'edit'
);
CREATE OR REPLACE FUNCTION public.super_admin_delete_sales_invoice(p_order_id uuid, p_reason text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.sales_orders%rowtype;
  v_old jsonb;
  v_actor_email text;
  v_return_refs text;
  v_payment_count integer;
  v_item_count integer;
begin
  if not (public.is_super_admin() or public.current_app_role() = 'admin') then
    raise exception 'Admin or Super Admin only' using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'Deletion reason is required';
  end if;

  select *
  into v_order
  from public.sales_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  select string_agg(coalesce(cn_no,id::text), ', ' order by created_at, id)
  into v_return_refs
  from public.sales_returns
  where sales_order_id = p_order_id;

  if v_return_refs is not null then
    raise exception 'Cannot delete this invoice because it has Return/CN record(s): %. Cancel or resolve those records first.', v_return_refs;
  end if;

  select count(*) into v_payment_count
  from public.sales_payments
  where sales_order_id = p_order_id;

  select count(*) into v_item_count
  from public.sales_order_items
  where sales_order_id = p_order_id;

  select email
  into v_actor_email
  from public.app_users
  where user_id = auth.uid();

  select jsonb_build_object(
    'order', to_jsonb(v_order),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at, i.id)
      from public.sales_order_items i
      where i.sales_order_id = p_order_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
      from public.sales_payments p
      where p.sales_order_id = p_order_id
    ), '[]'::jsonb),
    'document_events', coalesce((
      select jsonb_agg(to_jsonb(e) order by e.created_at, e.id)
      from public.sales_document_events e
      where e.sales_order_id = p_order_id
    ), '[]'::jsonb)
  )
  into v_old;

  insert into public.sales_invoice_admin_audit (
    sales_order_id, order_no, invoice_no, action,
    actor_user_id, actor_email, reason, old_data, new_data
  )
  values (
    p_order_id,
    v_order.order_no,
    v_order.invoice_no,
    'delete',
    auth.uid(),
    v_actor_email,
    btrim(p_reason),
    v_old,
    null
  );

  delete from public.sales_orders
  where id = p_order_id;

  return jsonb_build_object(
    'ok', true,
    'sales_order_id', p_order_id,
    'action', 'delete',
    'deleted_items', v_item_count,
    'deleted_payments', v_payment_count
  );
end;
$function$


CREATE OR REPLACE FUNCTION public.super_admin_update_sales_invoice(p_order_id uuid, p_order jsonb, p_items jsonb DEFAULT '[]'::jsonb, p_reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
declare
  v_order public.sales_orders%rowtype;
  v_old jsonb;
  v_new jsonb;
  v_item jsonb;
  v_item_id uuid;
  v_existing public.sales_order_items%rowtype;
  v_has_return boolean;
  v_actor_email text;
begin
  if not (public.is_super_admin() or public.current_app_role() = 'admin') then
    raise exception 'Admin or Super Admin only' using errcode = '42501';
  end if;

  if coalesce(btrim(p_reason),'') = '' then
    raise exception 'Correction reason is required';
  end if;

  if p_order is null or jsonb_typeof(p_order) <> 'object' then
    raise exception 'Invalid invoice data';
  end if;

  if p_items is not null and jsonb_typeof(p_items) <> 'array' then
    raise exception 'Invalid invoice item data';
  end if;

  select *
  into v_order
  from public.sales_orders
  where id = p_order_id
  for update;

  if not found then
    raise exception 'Invoice not found' using errcode = 'P0002';
  end if;

  select email
  into v_actor_email
  from public.app_users
  where user_id = auth.uid();

  select jsonb_build_object(
    'order', to_jsonb(v_order),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at, i.id)
      from public.sales_order_items i
      where i.sales_order_id = p_order_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
      from public.sales_payments p
      where p.sales_order_id = p_order_id
    ), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id)
      from public.sales_returns r
      where r.sales_order_id = p_order_id
    ), '[]'::jsonb)
  )
  into v_old;

  if (p_order ? 'order_no') and coalesce(btrim(p_order->>'order_no'),'') = '' then
    raise exception 'Order number cannot be blank';
  end if;

  update public.sales_orders
  set
    order_no = case
      when p_order ? 'order_no' then btrim(p_order->>'order_no')
      else order_no
    end,
    invoice_no = case
      when p_order ? 'invoice_no' then nullif(btrim(p_order->>'invoice_no'),'')
      else invoice_no
    end,
    customer_id = case
      when p_order ? 'customer_id' then (p_order->>'customer_id')::uuid
      else customer_id
    end,
    order_date = case
      when p_order ? 'order_date' then (p_order->>'order_date')::date
      else order_date
    end,
    order_type = case
      when p_order ? 'order_type' then p_order->>'order_type'
      else order_type
    end,
    status = case
      when p_order ? 'status' then p_order->>'status'
      else status
    end,
    order_discount = case
      when p_order ? 'order_discount' then greatest(coalesce((p_order->>'order_discount')::numeric,0),0)
      else order_discount
    end,
    notes = case
      when p_order ? 'notes' then nullif(p_order->>'notes','')
      else notes
    end,
    updated_at = now()
  where id = p_order_id;

  if p_items is not null then
    for v_item in
      select value from jsonb_array_elements(p_items)
    loop
      if coalesce(v_item->>'id','') = '' then
        raise exception 'Invoice item id is required';
      end if;

      v_item_id := (v_item->>'id')::uuid;

      select *
      into v_existing
      from public.sales_order_items
      where id = v_item_id
        and sales_order_id = p_order_id
      for update;

      if not found then
        raise exception 'Invoice item % does not belong to this invoice', v_item_id;
      end if;

      select exists (
        select 1
        from public.sales_return_items sri
        where sri.sales_order_item_id = v_item_id
      )
      into v_has_return;

      if v_has_return and (
        coalesce((v_item->>'qty')::numeric, v_existing.qty) <> v_existing.qty
        or coalesce((v_item->>'unit_price')::numeric, v_existing.unit_price) <> v_existing.unit_price
        or coalesce((v_item->>'discount_amount')::numeric, v_existing.discount_amount) <> v_existing.discount_amount
      ) then
        raise exception 'This item already has a Return/CN. Quantity, price, and discount can no longer be changed.';
      end if;

      update public.sales_order_items
      set
        qty = case
          when v_item ? 'qty' then greatest((v_item->>'qty')::numeric, 0.01)
          else qty
        end,
        unit_price = case
          when v_item ? 'unit_price' then greatest((v_item->>'unit_price')::numeric, 0)
          else unit_price
        end,
        discount_amount = case
          when v_item ? 'discount_amount' then greatest((v_item->>'discount_amount')::numeric, 0)
          else discount_amount
        end,
        source_type = case
          when v_item ? 'source_type' then v_item->>'source_type'
          else source_type
        end,
        fulfillment_status = case
          when v_item ? 'fulfillment_status' then v_item->>'fulfillment_status'
          else fulfillment_status
        end,
        notes = case
          when v_item ? 'notes' then nullif(v_item->>'notes','')
          else notes
        end,
        updated_at = now()
      where id = v_item_id
        and sales_order_id = p_order_id;
    end loop;
  end if;

  select jsonb_build_object(
    'order', to_jsonb(so),
    'items', coalesce((
      select jsonb_agg(to_jsonb(i) order by i.created_at, i.id)
      from public.sales_order_items i
      where i.sales_order_id = p_order_id
    ), '[]'::jsonb),
    'payments', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
      from public.sales_payments p
      where p.sales_order_id = p_order_id
    ), '[]'::jsonb),
    'returns', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.created_at, r.id)
      from public.sales_returns r
      where r.sales_order_id = p_order_id
    ), '[]'::jsonb)
  )
  into v_new
  from public.sales_orders so
  where so.id = p_order_id;

  insert into public.sales_invoice_admin_audit (
    sales_order_id, order_no, invoice_no, action,
    actor_user_id, actor_email, reason, old_data, new_data
  )
  values (
    p_order_id,
    v_order.order_no,
    v_order.invoice_no,
    'edit',
    auth.uid(),
    v_actor_email,
    nullif(btrim(coalesce(p_reason,'')),''),
    v_old,
    v_new
  );

  return jsonb_build_object(
    'ok', true,
    'sales_order_id', p_order_id,
    'action', 'edit'
  );
end;
$function$

create or replace function public.super_admin_review_invoice_audit(p_audit_id uuid, p_note text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_event public.sales_invoice_admin_audit%rowtype;
begin
  if not public.is_super_admin() then
    raise exception 'Super Admin only' using errcode = '42501';
  end if;
  if coalesce(btrim(p_note),'') = '' or length(btrim(p_note)) > 750 then
    raise exception 'A review note (1 to 750 characters) is required';
  end if;
  select * into v_event from public.sales_invoice_admin_audit
   where id = p_audit_id for update;
  if not found then raise exception 'Invoice audit event not found'; end if;
  if v_event.actor_user_id = auth.uid() then
    raise exception 'You cannot review your own invoice changes';
  end if;
  if v_event.reviewed_at is not null then
    raise exception 'This invoice change was already reviewed';
  end if;
  update public.sales_invoice_admin_audit
    set reviewed_at = now(), reviewed_by = auth.uid(), review_note = btrim(p_note)
  where id = p_audit_id;
  return jsonb_build_object('ok',true,'audit_id',p_audit_id,'reviewed',true);
end;
$$;
revoke all on function public.super_admin_review_invoice_audit(uuid,text) from public,anon;
grant execute on function public.super_admin_review_invoice_audit(uuid,text) to authenticated;
commit;
