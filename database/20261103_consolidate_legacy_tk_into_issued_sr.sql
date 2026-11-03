-- Canonicalize the two CONFIRMED SR -> issued TK/RK duplicate-order pairs.
-- Canonical entity: original SR + issued sales_sr_invoice_parts record.
-- Duplicate standalone TK remains an immutable audit shell (never deleted).
-- No new payment, stock OUT, invoice, or DO is created by this migration.
create schema if not exists imperial_audit;
revoke all on schema imperial_audit from public,anon,authenticated;

create table if not exists imperial_audit.sr_tk_consolidations (
  legacy_tk_order_id uuid primary key references public.sales_orders(id) on delete restrict,
  canonical_sr_order_id uuid not null references public.sales_orders(id) on delete restrict,
  canonical_invoice_part_id uuid not null unique references public.sales_sr_invoice_parts(id) on delete restrict,
  duplicate_payment_id uuid not null unique references public.sales_payments(id) on delete restrict,
  canonical_sr_payment_id uuid not null references public.sales_payments(id) on delete restrict,
  moved_do_id uuid references public.delivery_requests(id) on delete restrict,
  invoice_no text not null unique,
  invoice_total numeric not null,
  mirrored_deposit numeric not null,
  reconciliation_note text not null,
  before_snapshot jsonb not null,
  consolidated_at timestamptz not null default now(),
  check (invoice_total>0 and mirrored_deposit>0 and mirrored_deposit<=invoice_total),
  check (legacy_tk_order_id<>canonical_sr_order_id),
  check (duplicate_payment_id<>canonical_sr_payment_id)
);
revoke all on imperial_audit.sr_tk_consolidations from public,anon,authenticated;

do $migrate$
declare
  wanted text;
  sr record; tk record; inv record; src_payment record; mirror_payment record;
  d record; qty_ok boolean; product_count integer; req_count integer;
  v_identity uuid;
  snap jsonb;
  v_dup_line record;
  v_sr_item uuid;
  v_sr_no text;
  v_canonical_received numeric;
begin
  -- A real Super Admin identity is used only to satisfy existing item-status
  -- write guards. Data change is explicitly identified by this migration.
  select user_id into v_identity from public.app_users
  where role='super_admin' and active=true order by user_id limit 1;
  if v_identity is null then raise exception 'Active Super Admin not found; migration aborted'; end if;
  perform set_config('request.jwt.claim.sub',v_identity::text,true);

  foreach wanted in array array['TK2610-003','TK2610-004'] loop
    select o.*,s.order_total,s.amount_paid into strict tk
      from public.sales_orders o join public.sales_order_summary s on s.id=o.id
      where upper(btrim(o.order_no))=wanted for update of o;
    if tk.sales_flow_type is distinct from 'stock_sale' or tk.status='cancelled' then
      raise exception 'Unexpected legacy TK type/status for %',wanted;
    end if;
    select h.* into strict inv from public.sales_sr_invoice_parts h
      where upper(btrim(h.invoice_no))=wanted and h.status='issued'
      for update;
    select o.*,s.order_total,s.amount_paid into strict sr
      from public.sales_orders o join public.sales_order_summary s on s.id=o.id
      where o.id=inv.sales_order_id for update of o;
    if sr.sales_flow_type is distinct from 'pre_order'
      or tk.customer_id<>sr.customer_id
      or tk.order_total<>sr.order_total
      or inv.invoice_total<>sr.order_total then
      raise exception 'Source SR / TK identity or totals mismatch for %',wanted;
    end if;
    if not exists(select 1 from public.sales_sr_invoice_sources x
      where x.invoice_part_id=inv.id and x.sales_order_id=sr.id) then
      raise exception 'SR invoice source link missing for %',wanted;
    end if;
    if exists(select 1 from imperial_audit.sr_tk_consolidations x
      where x.legacy_tk_order_id=tk.id or x.canonical_invoice_part_id=inv.id) then
      raise exception 'TK % already reconciled; migration must not rerun',wanted;
    end if;

    select p.* into strict src_payment from public.sales_payments p
      where p.sales_order_id=sr.id for update;
    select p.* into strict mirror_payment from public.sales_payments p
      where p.sales_order_id=tk.id for update;
    if src_payment.amount<>mirror_payment.amount
      or src_payment.amount<>sr.amount_paid
      or mirror_payment.amount<>tk.amount_paid then
      raise exception 'Cannot prove mirrored deposit equivalence for %',wanted;
    end if;

    select count(*) into req_count from public.sales_payment_requests p
      where p.sales_order_id=tk.id and p.status='approved'
        and p.applied_payment_id=mirror_payment.id;
    if req_count<>1 then
      raise exception 'Unexpected payment approval audit for %',wanted;
    end if;

    -- Every standalone TK product/qty/line-total must match exactly one SR
    -- invoice allocation. Never combine mismatched items/partial conversions.
    select count(*) into product_count from public.sales_order_items i
      where i.sales_order_id=tk.id;
    if product_count=0
      or product_count<>(select count(*) from public.sales_sr_invoice_part_lines l where l.invoice_part_id=inv.id)
      or exists(
        select 1 from public.sales_order_items ti
        where ti.sales_order_id=tk.id and not exists(
          select 1 from public.sales_sr_invoice_part_lines il
          join public.sales_order_items si on si.id=il.sales_order_item_id
          where il.invoice_part_id=inv.id and si.sales_order_id=sr.id
            and si.product_id=ti.product_id
            and il.qty=ti.qty and il.line_total=ti.line_total
        )
      ) then raise exception 'Item mapping mismatch for %',wanted; end if;
    if exists(
      select 1 from public.sales_order_items ti
      where ti.sales_order_id=tk.id
      group by ti.product_id having count(*)>1
    ) or exists (
      select 1 from public.sales_sr_invoice_part_lines il
      join public.sales_order_items si on si.id=il.sales_order_item_id
      where il.invoice_part_id=inv.id
      group by si.product_id having count(*)>1
    ) then raise exception 'Ambiguous repeated product mapping for %',wanted; end if;

    if exists(select 1 from public.sales_returns where sales_order_id=tk.id)
      or exists(select 1 from public.sales_credit_applications where sales_order_id=tk.id)
      or exists(select 1 from public.sales_return_items ri join public.sales_order_items i on i.id=ri.sales_order_item_id
        where i.sales_order_id=tk.id)
      or exists(select 1 from public.fulfillment_links fl join public.sales_order_items i on i.id=fl.sales_order_item_id
        where i.sales_order_id=tk.id)
      or exists(select 1 from public.sales_order_edit_requests where sales_order_id=tk.id)
    then raise exception 'Unreviewed return/credit/PO allocation references for %',wanted; end if;

    select d0.* into d from public.delivery_requests d0
      where d0.sales_order_id=tk.id for update;
    if found then
      if (select count(*) from public.delivery_requests where sales_order_id=tk.id)<>1
        or d.status not in ('delivered','partially_delivered','do_assigned','requested') then
        raise exception 'Unexpected multiple/cancelled DO for %',wanted;
      end if;
      if exists(select 1 from public.delivery_requests where sales_order_id=sr.id) then
        raise exception 'Source SR already has DO; avoid double delivery %',wanted;
      end if;
      if exists(select 1 from public.delivery_request_items di join public.sales_order_items ti on ti.id=di.sales_order_item_id
        where di.delivery_request_id=d.id and ti.sales_order_id<>tk.id) then
        raise exception 'DO contains non-legacy order item for %',wanted;
      end if;
    end if;

    snap=jsonb_build_object(
      'legacy_order',to_jsonb(tk),'canonical_sr',to_jsonb(sr),'invoice',to_jsonb(inv),
      'original_sr_payment',to_jsonb(src_payment),'mirrored_tk_payment',to_jsonb(mirror_payment),
      'payment_requests',(select coalesce(jsonb_agg(to_jsonb(pr)),'[]'::jsonb) from public.sales_payment_requests pr where pr.sales_order_id=tk.id),
      'legacy_items',(select jsonb_agg(to_jsonb(i)) from public.sales_order_items i where i.sales_order_id=tk.id),
      'canonical_items',(select jsonb_agg(to_jsonb(i)) from public.sales_order_items i where i.sales_order_id=sr.id),
      'delivery_request',case when d.id is not null then to_jsonb(d) else null end,
      'delivery_lines',(select coalesce(jsonb_agg(to_jsonb(di)),'[]'::jsonb) from public.delivery_request_items di where di.delivery_request_id=d.id),
      'stock_movements',(select coalesce(jsonb_agg(to_jsonb(sm)),'[]'::jsonb) from public.stock_movements sm where sm.delivery_request_id=d.id),
      'delivered_status',(select coalesce(jsonb_agg(to_jsonb(st)),'[]'::jsonb) from public.sales_item_status_quantities st join public.sales_order_items ti on ti.id=st.sales_order_item_id where ti.sales_order_id=tk.id),
      'item_tracking',(select coalesce(jsonb_agg(to_jsonb(it)),'[]'::jsonb) from public.item_tracking it join public.sales_order_items ti on ti.id=it.sales_order_item_id where ti.sales_order_id in (tk.id,sr.id))
    );

    if d.id is not null then
      -- Change references only, NOT quantities, stock locations, stock OUT
      -- counts, DO number, delivery status, timestamps or shipping evidence.
      for v_dup_line in select di.*,ti.product_id from public.delivery_request_items di
        join public.sales_order_items ti on ti.id=di.sales_order_item_id
        where di.delivery_request_id=d.id
      loop
        select il.sales_order_item_id into strict v_sr_item
        from public.sales_sr_invoice_part_lines il
        join public.sales_order_items si on si.id=il.sales_order_item_id
        where il.invoice_part_id=inv.id and si.product_id=v_dup_line.product_id
          and il.qty>=v_dup_line.requested_qty;
        update public.stock_movements sm set
          reference_id=sr.id,reference_item_id=v_sr_item
          where sm.delivery_request_item_id=v_dup_line.id
            and sm.reference_type='sales_order_item'
            and sm.reference_item_id=v_dup_line.sales_order_item_id;
        update public.delivery_request_items set sales_order_item_id=v_sr_item
          where id=v_dup_line.id;
        update public.sales_item_status_quantities st set sales_order_item_id=v_sr_item
          where st.sales_order_item_id=v_dup_line.sales_order_item_id
            and st.status in ('delivered','installed');
        update public.item_tracking it set status='delivered',
          delivered_at=coalesce(it.delivered_at,
            (select max(sm.created_at) from public.stock_movements sm
              where sm.delivery_request_item_id=v_dup_line.id))
          where it.sales_order_item_id=v_sr_item;
        update public.sales_order_items set fulfillment_status='delivered'
          where id=v_sr_item and fulfillment_status<>'delivered';
      end loop;
      -- The original DO number and all stock movement IDs remain exactly as-is.
      update public.delivery_requests set sales_order_id=sr.id,source_invoice_part_id=inv.id
        where id=d.id;
    end if;

    insert into imperial_audit.sr_tk_consolidations
      (legacy_tk_order_id,canonical_sr_order_id,canonical_invoice_part_id,
       duplicate_payment_id,canonical_sr_payment_id,moved_do_id,invoice_no,
       invoice_total,mirrored_deposit,reconciliation_note,before_snapshot)
    values(tk.id,sr.id,inv.id,mirror_payment.id,src_payment.id,d.id,
      wanted,inv.invoice_total,src_payment.amount,
      'Standalone TK was created after official SR invoice issuance. Its deposit duplicates the original SR receipt; retain both approved payment and request as non-financial audit evidence. DO and delivered-item refs are reattached to canonical issued SR invoice.',
      snap);

    -- Keep the original payment and approved request in history, but do not
    -- call it new cash. A machine-readable audit link carries nonfinanciality.
    update public.sales_payments
      set notes=concat_ws(' | ',nullif(notes,''),
        'AUDIT ONLY: copied SR deposit; original receipt '||src_payment.id||
        ' under '||coalesce(sr.sr_no,sr.order_no)||
        ' applied to issued '||wanted||'. Not a second receipt.')
      where id=mirror_payment.id;

    raise notice 'Consolidated % -> %: SR %, invoice %, delivered DO %, audit payment %',
      tk.order_no,wanted,sr.order_no,inv.id,d.do_no,mirror_payment.id;
  end loop;
end;
$migrate$;

-- Prevent future payments or fresh DO requests on the old standalone TK shell.
-- The original matching SR is now the only live payment/DO source.
create or replace function public.guard_archived_duplicate_tk_new_payment_or_do()
returns trigger language plpgsql security definer set search_path=public,imperial_audit,pg_temp as $guard$
declare v_order uuid;
begin
  if tg_table_name='sales_payments' then v_order=new.sales_order_id;
  elsif tg_table_name='delivery_requests' then v_order=new.sales_order_id;
  else return new; end if;
  if exists(select 1 from imperial_audit.sr_tk_consolidations x
    where x.legacy_tk_order_id=v_order) then
      raise exception 'This TK/RK was consolidated into the original SR invoice. Open the SR-issued TK/RK to record payments or DOs.';
  end if;
  return new;
end;
$guard$;
revoke all on function public.guard_archived_duplicate_tk_new_payment_or_do() from public,anon,authenticated;
drop trigger if exists guard_archived_tk_payment on public.sales_payments;
create trigger guard_archived_tk_payment before insert on public.sales_payments
for each row execute function public.guard_archived_duplicate_tk_new_payment_or_do();
drop trigger if exists guard_archived_tk_delivery on public.delivery_requests;
create trigger guard_archived_tk_delivery before insert on public.delivery_requests
for each row execute function public.guard_archived_duplicate_tk_new_payment_or_do();
