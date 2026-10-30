-- Apply as one transaction after the existing CN case/credit/stock scripts.
-- Schema and functions only: no backfill and no existing CN/financial row updates.
begin;

alter table public.sales_returns drop constraint sales_returns_action_check;
alter table public.sales_returns add constraint sales_returns_action_check check
 (action in ('return_only','return_to_stock','exchange','damaged_return','cancel_undelivered'));

-- A posting is the durable idempotency key. CN lines are already immutable after approval.
create table public.cn_undelivered_postings (
 sales_return_id uuid primary key references public.sales_returns(id),
 posted_at timestamptz not null default now(),
 posted_by uuid not null references public.app_users(user_id)
);
alter table public.cn_undelivered_postings enable row level security;
revoke all on public.cn_undelivered_postings from public,anon,authenticated;
create table public.cn_cancellation_source_values (
 sales_return_id uuid not null references public.sales_returns(id),
 sales_order_id uuid not null references public.sales_orders(id),
 amount numeric not null check(amount>=0),
 primary key(sales_return_id,sales_order_id)
);
alter table public.cn_cancellation_source_values enable row level security;
revoke all on public.cn_cancellation_source_values from public,anon,authenticated;


-- One stock task per approved cancellation; no historical backfill.
create table public.cn_reservation_release_tasks (
 sales_return_id uuid primary key references public.sales_returns(id),
 created_at timestamptz not null default now(),
 completed_at timestamptz,
 completed_by uuid references public.app_users(user_id),
 check ((completed_at is null) = (completed_by is null))
);
alter table public.cn_reservation_release_tasks enable row level security;
revoke all on public.cn_reservation_release_tasks from public,anon,authenticated;

create function public.cn_cancellable_qty(p_item_id uuid,p_exclude_return uuid default null)
returns numeric language sql stable security definer set search_path='public','pg_temp'
as $fn$
 select greatest(least(
   i.qty - greatest(
     coalesce((select sum(m.qty) from public.stock_movements m where m.affects_balance
       and m.movement_type='sale_delivery' and m.reference_type='sales_order_item'
       and m.reference_item_id=i.id),0)
       + coalesce((select sum(h.qty) from public.customer_fulfillment_reconciliations h
          where h.sales_order_item_id=i.id and h.voided_at is null),0),
     coalesce((select sum(q.qty) from public.sales_item_status_quantities q
       where q.sales_order_item_id=i.id and q.status in ('delivered','installed')),0),
     case when i.fulfillment_status in ('delivered','installed') then i.qty else 0 end)
   - coalesce((select sum(q.qty) from public.sales_item_status_quantities q
       where q.sales_order_item_id=i.id and q.status='cancelled'),0)
   - coalesce((select sum(ri.qty) from public.sales_return_items ri
       join public.sales_returns r on r.id=ri.sales_return_id
       left join public.cn_case_workflows w on w.sales_return_id=r.id
       where ri.sales_order_item_id=i.id and r.action='cancel_undelivered'
         and r.status<>'cancelled' and coalesce(w.approval_status,'pending')<>'rejected'
         and r.id is distinct from p_exclude_return
         and not exists(select 1 from public.cn_reservation_release_tasks p where p.sales_return_id=r.id and p.completed_at is not null)),0),
   i.qty - coalesce((select sum(ri.qty) from public.sales_return_items ri
       join public.sales_returns r on r.id=ri.sales_return_id
       left join public.cn_case_workflows w on w.sales_return_id=r.id
       where ri.sales_order_item_id=i.id and r.status<>'cancelled'
         and coalesce(w.approval_status,'pending')<>'rejected'
         and r.id is distinct from p_exclude_return),0)
 ),0)
 from public.sales_order_items i join public.sales_orders o on o.id=i.sales_order_id
 where i.id=p_item_id and o.status<>'cancelled' and i.fulfillment_status<>'cancelled'
   and coalesce(i.line_kind,'product')='product';
$fn$;

create function public.get_cancellable_order_items(p_sales_order_id uuid)
returns table(sales_order_item_id uuid,product_id uuid,product_code text,item_name text,
 qty_sold numeric,qty_returned numeric,qty_available numeric,unit_price numeric)
language plpgsql stable security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 if auth.uid() is null or not public.can_view_sales_order(p_sales_order_id) then
   raise exception 'Access denied'; end if;
 return query select i.id,i.product_id,i.product_code_snapshot,i.item_name_snapshot,
   i.qty,i.qty-coalesce(public.cn_cancellable_qty(i.id),0),coalesce(public.cn_cancellable_qty(i.id),0),i.unit_price
 from public.sales_order_items i where i.sales_order_id=p_sales_order_id
 order by i.line_position nulls last,i.id;
end $fn$;

-- Covers every insert path, including older RPCs and direct table writes.
create function public.guard_undelivered_cn_line()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare r public.sales_returns%rowtype; i public.sales_order_items%rowtype; target_id uuid;
begin
 if tg_op='UPDATE' and old.sales_return_id is distinct from new.sales_return_id
   and exists(select 1 from public.sales_returns where id=old.sales_return_id and action='cancel_undelivered') then
   raise exception 'Cancellation lines cannot be moved to another CN'; end if;
 target_id:=case when tg_op='DELETE' then old.sales_return_id else new.sales_return_id end;
 select * into r from public.sales_returns where id=target_id for update;
 if r.action<>'cancel_undelivered' then return case when tg_op='DELETE' then old else new end; end if;
 if exists(select 1 from public.cn_case_workflows where sales_return_id=r.id and approval_status='approved') then
   raise exception 'Approved cancellation lines are immutable'; end if;
 if tg_op='DELETE' then return old; end if;
 if tg_op='UPDATE' and exists(select 1 from public.cn_undelivered_postings
   where sales_return_id=old.sales_return_id) then
   raise exception 'Posted cancellation lines are immutable'; end if;
 select * into i from public.sales_order_items where id=new.sales_order_item_id for update;
 if new.disposition<>'no_stock_action' or new.historical_stock_reconciled_qty<>0 then
   raise exception 'Undelivered cancellation cannot receive stock'; end if;
 if not public.can_edit_sales_order(i.sales_order_id) or not exists(
   select 1 from public.sales_orders o where o.id=i.sales_order_id and o.customer_id=r.customer_id)
 then raise exception 'Source invoice access denied'; end if;
 if new.qty is null or new.qty<=0 or new.qty::text in ('NaN','Infinity','-Infinity')
   or trunc(new.qty)<>new.qty or new.qty>coalesce(public.cn_cancellable_qty(i.id,r.id),0)
 then raise exception 'Cancellation exceeds undelivered available quantity'; end if;
 if exists(select 1 from public.sales_return_items x where x.sales_return_id=r.id
   and x.sales_order_item_id=i.id and x.id<>new.id) then
   raise exception 'Duplicate cancellation item'; end if;
 return new;
end $fn$;
create trigger guard_undelivered_cn_line_trg before insert or update or delete on public.sales_return_items
for each row execute function public.guard_undelivered_cn_line();

create function public.guard_undelivered_cn_header()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $fn$
begin
 if (old.action='cancel_undelivered' or new.action='cancel_undelivered') and old.action<>new.action then
   raise exception 'Create a new CN to change between cancellation and physical return'; end if;
 if old.action='cancel_undelivered' and exists(select 1 from public.cn_undelivered_postings p
   where p.sales_return_id=old.id) and
   (new.credit_amount,new.financial_effect,new.status) is distinct from
   (old.credit_amount,old.financial_effect,old.status) then
   raise exception 'Posted cancellation is immutable'; end if;
 return new;
end $fn$;
create trigger guard_undelivered_cn_header_trg before update on public.sales_returns
for each row execute function public.guard_undelivered_cn_header();

create function public.post_undelivered_cn(p_return_id uuid)
returns void language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare r public.sales_returns%rowtype; line record;
begin
 select * into r from public.sales_returns where id=p_return_id for update;
 if r.action<>'cancel_undelivered' then return; end if;
 if exists(select 1 from public.cn_undelivered_postings where sales_return_id=r.id) then return; end if;
 if auth.uid() is null or public.current_app_role() not in ('manager','admin','super_admin')
   or not public.current_user_has_permission('returns.approve') or r.created_by=auth.uid()
   or not exists(select 1 from public.cn_case_workflows where sales_return_id=r.id and approval_status='approved')
 then raise exception 'Independent management approval required'; end if;
 -- Serialize financial allocations for this customer; do not update any invoice/payment.
 perform 1 from public.customers where id=r.customer_id for update;
 if not exists(select 1 from public.sales_return_items where sales_return_id=r.id) then
   raise exception 'Cancellation requires items'; end if;
 for line in select ri.* from public.sales_return_items ri where ri.sales_return_id=r.id
   order by ri.sales_order_item_id
 loop
   perform 1 from public.sales_order_items where id=line.sales_order_item_id for update;
   if line.disposition<>'no_stock_action' or line.qty>coalesce(public.cn_cancellable_qty(line.sales_order_item_id,r.id),0) then
     raise exception 'Cancellation exceeds undelivered available quantity; refresh and review'; end if;
   if exists(select 1 from public.stock_action_requests a where a.status='pending' and
      ((a.action_type='sales_delivery' and a.payload->>'sales_order_item_id'=line.sales_order_item_id::text)
       or (a.action_type='do_delivery' and exists(select 1 from public.delivery_request_items d
         where d.id::text=a.payload->>'delivery_request_item_id' and d.sales_order_item_id=line.sales_order_item_id))))
   then raise exception 'Resolve pending stock release before cancellation'; end if;

 end loop;
 insert into public.cn_reservation_release_tasks(sales_return_id) values(r.id);
 insert into public.cn_cancellation_source_values(sales_return_id,sales_order_id,amount)
 select r.id,i.sales_order_id,sum(
   public.sales_order_item_net_return_value(i.id,ri.qty+coalesce(prior.qty,0))
   -public.sales_order_item_net_return_value(i.id,coalesce(prior.qty,0)))
 from public.sales_return_items ri join public.sales_order_items i on i.id=ri.sales_order_item_id
 left join lateral(select sum(other.qty) qty from public.sales_return_items other
   join public.sales_returns cn on cn.id=other.sales_return_id
   where other.sales_order_item_id=i.id and cn.id<>r.id and cn.financial_effect='credit_ar'
     and cn.status<>'cancelled') prior on true
 where ri.sales_return_id=r.id group by i.sales_order_id;
 perform public.refresh_cn_case_closure(r.id);
 perform public.set_sales_return_financial_treatment(r.id,'credit_ar');
 insert into public.cn_undelivered_postings(sales_return_id,posted_by) values(r.id,auth.uid());
end $fn$;

-- A deferred guard allows existing status-sync routines to delete/recreate buckets,
-- but prevents an approved cancellation from being reopened by a later status edit.
create function public.guard_posted_cancelled_quantity()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $fn$
declare item_id uuid; required_qty numeric; actual_qty numeric;
begin
 for item_id in select distinct x from unnest(array[
   case when tg_op<>'INSERT' then old.sales_order_item_id end,
   case when tg_op<>'DELETE' then new.sales_order_item_id end]) x where x is not null
 loop
   select coalesce(sum(ri.qty),0) into required_qty from public.sales_return_items ri
   join public.cn_reservation_release_tasks p on p.sales_return_id=ri.sales_return_id and p.completed_at is not null
   where ri.sales_order_item_id=item_id;
   select coalesce(sum(qty),0) into actual_qty from public.sales_item_status_quantities
   where sales_order_item_id=item_id and status='cancelled';
   if actual_qty<required_qty then raise exception 'Approved cancellation quantity cannot be reopened'; end if;
 end loop;
 return null;
end $fn$;
create constraint trigger guard_posted_cancelled_quantity_trg
after insert or update or delete on public.sales_item_status_quantities
deferrable initially deferred for each row execute function public.guard_posted_cancelled_quantity();

create function public.guard_undelivered_stock_movement()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $fn$
declare i public.sales_order_items%rowtype; cancelled numeric; released numeric;
begin
 if new.reference_type='sales_return_item' and exists(select 1 from public.sales_return_items ri
   join public.sales_returns r on r.id=ri.sales_return_id where ri.id=new.reference_item_id and r.action='cancel_undelivered')
 then raise exception 'Undelivered cancellations never create stock movements'; end if;
 if new.affects_balance and new.movement_type='sale_delivery' and new.reference_type='sales_order_item' then
   select * into i from public.sales_order_items where id=new.reference_item_id for update;
   select coalesce(sum(qty),0) into cancelled from public.sales_item_status_quantities
     where sales_order_item_id=i.id and status='cancelled';
   cancelled:=cancelled+coalesce((select sum(ri.qty) from public.sales_return_items ri
     join public.cn_reservation_release_tasks t on t.sales_return_id=ri.sales_return_id
     where ri.sales_order_item_id=i.id and t.completed_at is null),0);
   select coalesce(sum(qty),0) into released from public.stock_movements where affects_balance
     and movement_type='sale_delivery' and reference_type='sales_order_item' and reference_item_id=i.id and id<>new.id;
   released:=released+coalesce((select sum(qty) from public.customer_fulfillment_reconciliations
     where sales_order_item_id=i.id and voided_at is null),0);
   if cancelled>0 and released+new.qty+cancelled>i.qty then raise exception 'Stock release exceeds uncancelled quantity'; end if;
 end if;
 return new;
end $fn$;
create trigger guard_undelivered_stock_movement_trg before insert or update on public.stock_movements
for each row execute function public.guard_undelivered_stock_movement();

create function public.guard_undelivered_receipt_request()
returns trigger language plpgsql security definer set search_path='public','pg_temp'
as $fn$
begin
 if exists(select 1 from public.sales_return_items ri join public.sales_returns r on r.id=ri.sales_return_id
   where ri.id=new.sales_return_item_id and r.action='cancel_undelivered') then
   raise exception 'Undelivered cancellations do not have warehouse receipts or exchange holds'; end if;
 return new;
end $fn$;
create trigger guard_undelivered_receipt_request_trg before insert or update on public.cn_stock_receipt_requests
for each row execute function public.guard_undelivered_receipt_request();
create trigger guard_undelivered_exchange_request_trg before insert or update on public.cn_exchange_hold_requests
for each row execute function public.guard_undelivered_receipt_request();

revoke all on function public.cn_cancellable_qty(uuid,uuid),public.guard_undelivered_cn_line(),
 public.guard_undelivered_cn_header(),public.post_undelivered_cn(uuid),
 public.guard_posted_cancelled_quantity(),public.guard_undelivered_stock_movement(),
 public.guard_undelivered_receipt_request() from public,anon,authenticated;
revoke all on function public.get_cancellable_order_items(uuid) from public,anon;
grant execute on function public.get_cancellable_order_items(uuid) to authenticated;

-- Updated RPC definitions follow. Existing physical return branches are preserved.
create table public.cn_cancellation_requests (
 request_id uuid primary key,
 sales_return_id uuid not null references public.sales_returns(id) on delete cascade,
 requested_by uuid not null,
 payload jsonb not null
);
alter table public.cn_cancellation_requests enable row level security;
revoke all on public.cn_cancellation_requests from public,anon,authenticated;

create function public.create_undelivered_cancellation(p_request_id uuid,p_sales_order_ids uuid[],
 p_cn_no text,p_return_date date,p_reason text,p_notes text,p_items jsonb)
returns table(return_id uuid,cn_no text)
language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare prior public.cn_cancellation_requests%rowtype; payload_json jsonb; result record;
begin
 if auth.uid() is null or p_request_id is null then raise exception 'Authenticated request ID required'; end if;
 payload_json:=jsonb_build_object('orders',p_sales_order_ids,'cn',p_cn_no,'date',p_return_date,
   'reason',p_reason,'notes',p_notes,'items',p_items);
 perform pg_advisory_xact_lock(hashtextextended('cancel-request:'||p_request_id::text,0));
 select * into prior from public.cn_cancellation_requests where request_id=p_request_id;
 if found then
   if prior.requested_by<>auth.uid() or prior.payload<>payload_json then
     raise exception 'Cancellation request ID was already used for a different request'; end if;
   return query select r.id,r.cn_no from public.sales_returns r where r.id=prior.sales_return_id;
   return;
 end if;
 select * into result from public.create_sales_return_multi(p_sales_order_ids,p_cn_no,p_return_date,
   'cancel_undelivered',p_reason,p_notes,p_items);
 insert into public.cn_cancellation_requests values(p_request_id,result.return_id,auth.uid(),payload_json);
 return query select result.return_id::uuid,result.cn_no::text;
end $fn$;
revoke all on function public.create_undelivered_cancellation(uuid,uuid[],text,date,text,text,jsonb) from public,anon;
grant execute on function public.create_undelivered_cancellation(uuid,uuid[],text,date,text,text,jsonb) to authenticated;

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

  -- Lock source items in deterministic order before checking remaining quantities.
  perform 1 from public.sales_order_items where id in
    (select (value->>'sales_order_item_id')::uuid from jsonb_array_elements(p_items))
    order by id for update;
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

  if p_action not in ('return_only','return_to_stock','exchange','damaged_return','cancel_undelivered') then
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
      and r.status<>'cancelled'
      and not exists(select 1 from public.cn_case_workflows w where w.sales_return_id=r.id and w.approval_status='rejected');

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
  if p_action not in ('return_only','return_to_stock','exchange','damaged_return','cancel_undelivered') then
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

  perform 1 from public.sales_order_items where id in
    (select (value->>'sales_order_item_id')::uuid from jsonb_array_elements(p_items))
    order by id for update;
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

CREATE OR REPLACE FUNCTION public.review_cn_case(p_return_id uuid, p_approve boolean, p_note text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
 if p_approve and r.action='cancel_undelivered' then
   perform public.post_undelivered_cn(p_return_id);
 end if;
 if p_approve then perform public.refresh_cn_case_closure(p_return_id);end if;
 return jsonb_build_object('return_id',p_return_id,
  'approval_status',case when p_approve then 'approved' else 'rejected' end);
end $function$;

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

  if exists(select 1 from public.cn_undelivered_postings where sales_return_id=p_return_id) then
    if p_effect is distinct from 'credit_ar' then raise exception 'Posted cancellation is immutable'; end if;
    return (select jsonb_build_object('return_id',r.id,'credit_amount',r.credit_amount,
      'applied_amount',coalesce(sum(a.amount),0),'available_credit',greatest(r.credit_amount-coalesce(sum(a.amount),0),0),
      'financial_effect','credit_ar') from public.sales_returns r left join public.sales_credit_applications a
      on a.sales_return_id=r.id where r.id=p_return_id group by r.id);
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

  if exists(select 1 from public.sales_returns where id=p_return_id and action='cancel_undelivered') then
    select coalesce(sum(amount),0) into v_value from public.cn_cancellation_source_values
      where sales_return_id=p_return_id;
  end if;

  if v_value<=0 and not exists(select 1 from public.sales_returns where id=p_return_id and action='cancel_undelivered') then
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

  perform 1 from public.customers where id=v_return.customer_id for update;
  -- Cancellation value is frozen on approval, including line/order discounts.
  -- Apply only each source invoice's share; retain excess on the customer account.
  if v_return.action='cancel_undelivered' then
    delete from public.sales_credit_applications where sales_return_id=p_return_id;
    if v_return.financial_effect<>'credit_ar' or v_return.status='cancelled' then
      return jsonb_build_object('return_id',p_return_id,'credit_amount',0,'applied_amount',0,'available_credit',0);
    end if;
    v_credit:=v_return.credit_amount;
    v_remaining:=v_credit;
    for v_order in select sales_order_id id,amount source_value
      from public.cn_cancellation_source_values where sales_return_id=p_return_id order by sales_order_id
    loop
      select least(v_remaining,v_order.source_value,greatest(s.balance_due,0)) into v_apply
        from public.sales_order_summary s where s.id=v_order.id and s.status<>'cancelled';
      if v_apply>0 then
        insert into public.sales_credit_applications(sales_return_id,customer_id,sales_order_id,amount,created_by)
        values(p_return_id,v_return.customer_id,v_order.id,v_apply,v_return.approved_by);
        v_remaining:=v_remaining-v_apply;v_applied:=v_applied+v_apply;
      end if;
    end loop;
    return jsonb_build_object('return_id',p_return_id,'credit_amount',v_credit,
      'applied_amount',v_applied,'available_credit',v_remaining);
  end if;
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
 where cn.action<>'cancel_undelivered' and cn.status in ('confirmed','received')
 ),'[]'::jsonb) end
$function$;

-- Allocation helpers are internal only. Existing SECURITY DEFINER RPCs/triggers
-- still call them as owner; clients must go through permission-checked approval.
revoke all on function public.rebuild_sales_return_credit_allocations(uuid),
 public.rebalance_customer_credits(uuid) from public,anon,authenticated;
revoke all on function public.create_sales_return_multi(uuid[],text,date,text,text,text,jsonb),
 public.update_sales_return(uuid,date,text,text,text,jsonb),
 public.set_sales_return_financial_treatment(uuid,text) from public,anon;

-- Stock processing is atomic and idempotent. It does not post finance or stock movements.
create function public.complete_cn_reservation_release(p_return_id uuid)
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare r public.sales_returns%rowtype; t public.cn_reservation_release_tasks%rowtype;
 line record; q record; remaining numeric; take_qty numeric;
begin
 if auth.uid() is null or not coalesce(public.can_operate_inventory(),false)
   or coalesce(public.current_app_role(),'') not in ('stock_controller','admin','super_admin') then
   raise exception 'Stock operation permission required'; end if;
 -- Same workflow/header lock order as approval and closure.
 perform 1 from public.cn_case_workflows where sales_return_id=p_return_id for update;
 select * into r from public.sales_returns where id=p_return_id for update;
 select * into t from public.cn_reservation_release_tasks where sales_return_id=p_return_id for update;
 if not found or r.action is distinct from 'cancel_undelivered' or r.status='cancelled'
   or not exists(select 1 from public.cn_case_workflows where sales_return_id=p_return_id and approval_status='approved')
   or not exists(select 1 from public.cn_undelivered_postings where sales_return_id=p_return_id) then
   raise exception 'Approved cancellation task required'; end if;
 if t.completed_at is not null then
   return jsonb_build_object('return_id',r.id,'completed_at',t.completed_at,'completed_by',t.completed_by,'already_completed',true);
 end if;
 for line in select * from public.sales_return_items where sales_return_id=r.id order by sales_order_item_id
 loop
   perform 1 from public.sales_order_items where id=line.sales_order_item_id for update;
   if line.qty>coalesce(public.cn_cancellable_qty(line.sales_order_item_id,r.id),0) then
     raise exception 'Cancellation exceeds undelivered available quantity; refresh and review'; end if;
   -- Move quantities out of nonterminal buckets. Never change sold qty/pricing or stock ledger.
   remaining:=line.qty;
   for q in select * from public.sales_item_status_quantities where sales_order_item_id=line.sales_order_item_id
     and status not in ('delivered','installed','cancelled') order by id for update
   loop
     exit when remaining<=0;
     take_qty:=least(q.qty,remaining);
     if take_qty=q.qty then delete from public.sales_item_status_quantities where id=q.id;
     else update public.sales_item_status_quantities set qty=qty-take_qty,updated_by=auth.uid(),updated_at=now() where id=q.id; end if;
     remaining:=remaining-take_qty;
   end loop;
   insert into public.sales_item_status_quantities(sales_order_item_id,status,qty,updated_by)
   values(line.sales_order_item_id,'cancelled',line.qty,auth.uid())
   on conflict(sales_order_item_id,status) do update set qty=sales_item_status_quantities.qty+excluded.qty,
     updated_by=excluded.updated_by,updated_at=now();
 end loop;
 update public.cn_reservation_release_tasks set completed_at=now(),completed_by=auth.uid()
 where sales_return_id=r.id returning * into t;
 perform public.refresh_cn_case_closure(r.id);
 return jsonb_build_object('return_id',r.id,'completed_at',t.completed_at,'completed_by',t.completed_by,'already_completed',false);
end $fn$;
revoke all on function public.complete_cn_reservation_release(uuid) from public,anon;
grant execute on function public.complete_cn_reservation_release(uuid) to authenticated;

create function public.get_cn_reservation_release_queue()
returns jsonb language sql stable security definer set search_path='public','auth','pg_temp'
as $fn$
 select case when auth.uid() is null or not coalesce(public.can_view_inventory(),false) then null else
 coalesce((select jsonb_agg(jsonb_build_object(
 'return_id',r.id,'cn_no',r.cn_no,'customer_name',c.name,'created_at',t.created_at,
 'completed_at',t.completed_at,'completed_by',t.completed_by,
 'items',(select jsonb_agg(jsonb_build_object('item_name',ri.item_name_snapshot,
   'product_code',ri.product_code_snapshot,'qty',ri.qty) order by ri.id)
   from public.sales_return_items ri where ri.sales_return_id=r.id)
 ) order by t.created_at desc,r.id)
 from public.cn_reservation_release_tasks t join public.sales_returns r on r.id=t.sales_return_id
 join public.cn_case_workflows w on w.sales_return_id=r.id
 join public.customers c on c.id=r.customer_id
 where r.action='cancel_undelivered' and r.status<>'cancelled' and w.approval_status='approved'),'[]'::jsonb) end
$fn$;
revoke all on function public.get_cn_reservation_release_queue() from public,anon;
grant execute on function public.get_cn_reservation_release_queue() to authenticated;

CREATE OR REPLACE FUNCTION public.cn_case_stock_complete(p_return_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
 select case when exists(select 1 from public.sales_returns where id=p_return_id and action='cancel_undelivered')
 then exists(select 1 from public.cn_reservation_release_tasks where sales_return_id=p_return_id and completed_at is not null)
 else not exists (
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
 ) end;
$function$;

CREATE OR REPLACE FUNCTION public.get_visible_cn_case_workflows()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
select case when auth.uid() is null then null else
coalesce((select jsonb_agg(jsonb_build_object(
 'action',r.action,'return_id',w.sales_return_id,'cn_no',r.cn_no,
 'approval_status',w.approval_status,'approval_note',w.approval_note,
 'approved_at',w.approved_at,'approved_by',w.approved_by,
 'financial_decision',w.financial_decision,'closed_at',w.closed_at,
 'stock_complete',public.cn_case_stock_complete(w.sales_return_id),
 'requested_by',r.created_by,'customer_name',c.name,
 'workflow_status',case
  when w.approval_status='pending' then 'Awaiting CN Approval'
  when w.approval_status='rejected' then 'CN Rejected'
  when w.closed_at is not null then 'Case Closed'
  when not public.cn_case_stock_complete(w.sales_return_id) then case when r.action='cancel_undelivered' then 'Awaiting Reservation Release' else 'Awaiting Stock Receipt' end
  else 'Awaiting Financial Decision' end
) order by r.created_at desc)
from public.cn_case_workflows w
join public.sales_returns r on r.id=w.sales_return_id
join public.customers c on c.id=r.customer_id
where public.can_view_sales_return(r.id)
),'[]'::jsonb) end
$function$;

CREATE OR REPLACE FUNCTION public.mark_cn_credit_decision()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare w public.cn_case_workflows%rowtype;
begin
 select * into w from public.cn_case_workflows where sales_return_id=new.id for update;
 if not found or new.financial_effect is not distinct from old.financial_effect then return new;end if;
 if public.current_app_role() not in ('manager','admin','super_admin') or not public.current_user_has_permission('returns.approve') then raise exception 'Manager/Admin CN financial approval permission required';end if;
if w.approval_status<>'approved' then raise exception 'Approve the CN before customer-credit changes';end if;
 if new.action<>'cancel_undelivered' and not public.cn_case_stock_complete(new.id) then
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
end $function$;

CREATE OR REPLACE FUNCTION public.refresh_cn_case_closure(p_return_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
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
 if (done_stock or r.action='cancel_undelivered') and r.status='confirmed' then
   -- No Stock Action cases also move to ready-for-financial-decision.
   perform set_config('app.cn_workflow_internal','1',true);
   update public.sales_returns set status='received',updated_at=now() where id=p_return_id;
   perform set_config('app.cn_workflow_internal','',true);
 end if;
 update public.cn_case_workflows
 set closed_at=case when done_stock and financial_decision<>'pending'
   then coalesce(closed_at,now()) else null end,updated_at=now()
 where sales_return_id=p_return_id;
end $function$;

-- Keep the second live credit guard aligned with the cancellation approval path.
CREATE OR REPLACE FUNCTION public.guard_cn_case_credit_on_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','auth','pg_temp'
AS $fn$
declare w public.cn_case_workflows%rowtype;
begin
 select * into w from public.cn_case_workflows where sales_return_id=new.id;
 if not found then return new;end if;
 if new.financial_effect is distinct from old.financial_effect then
  if w.closed_at is not null then raise exception 'CN case is closed; request controlled correction';end if;
  if w.approval_status<>'approved' or (new.action<>'cancel_undelivered' and not public.cn_case_stock_complete(new.id)) then
    raise exception 'Manager CN approval and approved physical stock receipts are required before customer credit';
  end if;
 end if;
 return new;
end $fn$;

commit;
