-- Exchange CN item inspection:
-- Good inspected exchange goods -> existing audited CN Stock IN receipt.
-- Damaged exchange goods -> audited hold (NO saleable stock movement).
-- Replacement customer delivery remains a separate normal SO/DO workflow.
-- Existing financial allocations/credit remain untouched.
create table if not exists public.cn_exchange_hold_requests (
 id uuid primary key default gen_random_uuid(),
 sales_return_item_id uuid not null references public.sales_return_items(id) on delete restrict,
 sales_return_id uuid not null references public.sales_returns(id) on delete restrict,
 held_qty numeric not null check (held_qty>0 and held_qty=trunc(held_qty)),
 location_id uuid not null references public.stock_locations(id),
 inspection_condition text not null check(inspection_condition in ('damaged','defective')),
 note text not null check(length(note) between 3 and 2000),
 status text not null default 'pending' check (status in ('pending','approved','rejected')),
 requested_by uuid not null references public.app_users(user_id),
 requested_at timestamptz not null default now(),
 reviewed_by uuid references public.app_users(user_id),
 reviewed_at timestamptz,
 reviewer_note text
);
create index if not exists cn_exchange_hold_requests_item_status_idx
 on public.cn_exchange_hold_requests(sales_return_item_id,status);
create unique index if not exists cn_exchange_hold_one_pending_per_item_idx
 on public.cn_exchange_hold_requests(sales_return_item_id) where status='pending';
alter table public.cn_exchange_hold_requests enable row level security;
revoke all on public.cn_exchange_hold_requests from public,anon,authenticated;

create or replace function public.cn_exchange_hold_totals(p_item_id uuid)
returns table(pending_qty numeric,approved_qty numeric)
language sql stable security definer set search_path='public','auth','pg_temp'
as $func$
 select coalesce(sum(held_qty) filter (where status='pending'),0)::numeric,
  coalesce(sum(held_qty) filter (where status='approved'),0)::numeric
 from public.cn_exchange_hold_requests where sales_return_item_id=p_item_id
$func$;
revoke all on function public.cn_exchange_hold_totals(uuid) from public,anon,authenticated;

create or replace function public.submit_cn_exchange_hold(
 p_return_item_id uuid,p_qty numeric,p_location_id uuid,
 p_condition text,p_note text
) returns uuid language plpgsql security definer
set search_path='public','auth','pg_temp'
as $fn$
declare v_ri public.sales_return_items%rowtype;
 v_cn public.sales_returns%rowtype;
 v_posted numeric;v_stock_pending numeric;v_hold_pending numeric;v_held numeric;v_remaining numeric;v_id uuid;
begin
 if auth.uid() is null or not public.can_operate_inventory() then
  raise exception 'Stock Controller access required to request an exchange hold';end if;
 if p_qty is null or p_qty<=0 or p_qty<>trunc(p_qty) then
  raise exception 'Hold quantity must be a positive whole number';end if;
 if p_condition not in ('damaged','defective') then
  raise exception 'Only damaged/defective exchange items may be placed on hold';end if;
 if length(btrim(coalesce(p_note,'')))<3 or length(coalesce(p_note,''))>2000 then
  raise exception 'Describe the damage/defect and where the item will be held';end if;
 if not exists(select 1 from public.stock_locations where id=p_location_id and active) then
  raise exception 'Choose a valid physical hold location';end if;
 if p_return_item_id is null then raise exception 'Choose an exchange item';end if;

 perform pg_advisory_xact_lock(hashtextextended('cn-receipt:'||p_return_item_id::text,0));
 select * into v_ri from public.sales_return_items where id=p_return_item_id for update;
 if not found or v_ri.disposition<>'exchange' then
  raise exception 'Only CN Exchange lines can use the damaged-item hold workflow';end if;
 select * into v_cn from public.sales_returns where id=v_ri.sales_return_id;
 if not found or v_cn.status='cancelled' then raise exception 'CN is cancelled or missing';end if;
 if exists(select 1 from public.cn_case_workflows w where w.sales_return_id=v_cn.id
     and w.approval_status<>'approved') then
  raise exception 'Manager/Admin must approve the CN before inspecting exchange returns';end if;
 if exists(select 1 from public.cn_case_workflows w where w.sales_return_id=v_cn.id and w.closed_at is not null)
 then raise exception 'Exchange case is already closed';end if;

 select coalesce(sum(m.qty),0) into v_posted
 from public.stock_movements m
 where m.affects_balance and m.movement_type in ('in','return')
  and m.reference_type='sales_return_item' and m.reference_item_id=v_ri.id;
 select coalesce(sum(q.requested_qty),0) into v_stock_pending
 from public.cn_stock_receipt_requests q where q.sales_return_item_id=v_ri.id and q.status='pending';
 select pending_qty,approved_qty into v_hold_pending,v_held
 from public.cn_exchange_hold_totals(v_ri.id);
 if v_stock_pending>0 or v_hold_pending>0 then
  raise exception 'This exchange already has a pending warehouse request. Review it first';end if;
 v_remaining:=v_ri.qty-coalesce(v_ri.historical_stock_reconciled_qty,0)-v_posted-v_stock_pending-v_hold_pending-v_held;
 if p_qty>v_remaining or v_remaining<=0 then
  raise exception 'Exchange has only % unprocessed quantity',greatest(v_remaining,0);end if;
 insert into public.cn_exchange_hold_requests(
  sales_return_item_id,sales_return_id,held_qty,location_id,
  inspection_condition,note,requested_by
 ) values(v_ri.id,v_cn.id,p_qty,p_location_id,p_condition,btrim(p_note),auth.uid())
 returning id into v_id;
 return v_id;
end $fn$;

create or replace function public.review_cn_exchange_hold(
 p_request_id uuid,p_approve boolean,p_note text default null
) returns text language plpgsql security definer
set search_path='public','auth','pg_temp'
as $fn$
declare v_req public.cn_exchange_hold_requests%rowtype;
begin
 if auth.uid() is null or not public.can_admin_inventory() then
  raise exception 'Admin inventory approval permission required';end if;
 if length(coalesce(p_note,''))>2000 then raise exception 'Review note is too long';end if;
 select * into v_req from public.cn_exchange_hold_requests where id=p_request_id;
 if not found then raise exception 'Exchange hold request not found';end if;
 perform pg_advisory_xact_lock(hashtextextended('cn-receipt:'||v_req.sales_return_item_id::text,0));
 select * into v_req from public.cn_exchange_hold_requests where id=p_request_id for update;
 if v_req.status<>'pending' then raise exception 'Exchange hold request already reviewed';end if;
 if coalesce(p_approve,false) and exists(select 1 from public.cn_case_workflows w
     where w.sales_return_id=v_req.sales_return_id and w.approval_status<>'approved') then
   raise exception 'Approve the CN before approving damaged exchange hold';end if;
 update public.cn_exchange_hold_requests set
   status=case when coalesce(p_approve,false) then 'approved' else 'rejected' end,
   reviewed_at=now(),reviewed_by=auth.uid(),reviewer_note=nullif(btrim(coalesce(p_note,'')),'')
 where id=v_req.id;
 perform public.refresh_cn_case_closure(v_req.sales_return_id);
 return case when coalesce(p_approve,false) then 'approved' else 'rejected' end;
end $fn$;

create or replace function public.get_cn_exchange_hold_requests(p_return_id uuid default null)
returns jsonb language sql stable security definer
set search_path='public','auth','pg_temp'
as $func$
 select case when auth.uid() is null or not public.can_view_inventory() then null else
 coalesce((select jsonb_agg(jsonb_build_object(
   'id',h.id,'return_id',h.sales_return_id,'return_item_id',h.sales_return_item_id,
   'cn_no',cn.cn_no,'customer_name',c.name,'product_code',ri.product_code_snapshot,
   'item_name',ri.item_name_snapshot,'qty',h.held_qty,'location',l.code,
   'location_id',h.location_id,'condition',h.inspection_condition,
   'note',h.note,'status',h.status,'requested_at',h.requested_at,
   'requested_by',h.requested_by,'requested_by_name',coalesce(u.display_name,u.email,'Stock Staff'),
   'reviewed_at',h.reviewed_at,'reviewer_note',h.reviewer_note
  ) order by (h.status='pending') desc,h.requested_at desc)
 from public.cn_exchange_hold_requests h
 join public.sales_returns cn on cn.id=h.sales_return_id
 join public.sales_return_items ri on ri.id=h.sales_return_item_id
 join public.customers c on c.id=cn.customer_id
 join public.stock_locations l on l.id=h.location_id
 left join public.app_users u on u.user_id=h.requested_by
 where (public.can_admin_inventory() or h.requested_by=auth.uid())
  and (p_return_id is null or h.sales_return_id=p_return_id)
 ),'[]'::jsonb) end
$func$;

-- Prevent changing any CN that has active exchange-hold history.
create or replace function public.guard_cn_exchange_hold_item()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 if exists(select 1 from public.cn_exchange_hold_requests h
   where h.sales_return_item_id=old.id and h.status in ('pending','approved'))
 and (tg_op='DELETE' or
   (old.qty,old.disposition,old.product_id,old.sales_return_id)
   is distinct from (new.qty,new.disposition,new.product_id,new.sales_return_id))
 then raise exception 'This CN exchange has a pending or approved hold; use an audited correction';end if;
 return case when tg_op='DELETE' then old else new end;
end $fn$;
drop trigger if exists guard_cn_exchange_hold_item_trg on public.sales_return_items;
create trigger guard_cn_exchange_hold_item_trg before update or delete
on public.sales_return_items for each row execute function public.guard_cn_exchange_hold_item();

create or replace function public.guard_cn_exchange_hold_parent()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 if exists(select 1 from public.cn_exchange_hold_requests h
   where h.sales_return_id=old.id and h.status in ('pending','approved'))
 and (tg_op='DELETE' or new.status='cancelled' and old.status<>'cancelled')
 then raise exception 'This CN exchange has pending or approved damaged-item hold history';end if;
 return case when tg_op='DELETE' then old else new end;
end $fn$;
drop trigger if exists guard_cn_exchange_hold_parent_trg on public.sales_returns;
create trigger guard_cn_exchange_hold_parent_trg before update or delete
on public.sales_returns for each row execute function public.guard_cn_exchange_hold_parent();

-- Good exchanges reuse the existing exact-once CN stock receipt approval.
-- Quantity allocated to damaged holds cannot also become saleable stock.
do $patch$
declare s text;
begin
 select pg_get_functiondef(p.oid) into s from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='submit_cn_stock_receipt';
 if position('if ri.disposition<>''return_to_stock'' then' in s)=0 or
    position('remaining:=ri.qty-coalesce(ri.historical_stock_reconciled_qty,0)-posted-pending;' in s)=0
 then raise exception 'CN stock submission function changed unexpectedly; refusing patch';end if;
 s:=replace(s,'if ri.disposition<>''return_to_stock'' then',
  'if ri.disposition not in (''return_to_stock'',''exchange'') then');
 s:=replace(s,'remaining:=ri.qty-coalesce(ri.historical_stock_reconciled_qty,0)-posted-pending;',
 'remaining:=ri.qty-coalesce(ri.historical_stock_reconciled_qty,0)-posted-pending-'||
  'case when ri.disposition=''exchange'' then coalesce((select sum(held_qty) '||
   'from public.cn_exchange_hold_requests where sales_return_item_id=ri.id '||
   'and status in (''pending'',''approved'')),0) else 0 end;');
 s:=replace(s,
   'if pending>0 then raise exception ''This CN line already has a stock receipt awaiting approval. Approve or reject it first.''; end if;',
   'if pending>0 or (ri.disposition=''exchange'' and exists('||
    'select 1 from public.cn_exchange_hold_requests h where h.sales_return_item_id=ri.id '||
    'and h.status=''pending'')) then '||
     'raise exception ''This CN line has a pending warehouse receipt or exchange hold. Review it first.''; end if;');
 execute s;

 select pg_get_functiondef(p.oid) into s from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_cn_stock_receipt_queue';
 if position('''available_to_request'',case when' in s)=0 or
    position('when r.disposition<>''return_to_stock'' then ''no_stock_action''' in s)=0
 then raise exception 'CN Stock queue function changed unexpectedly; refusing patch';end if;
 s:=replace(s,
  '''approval_status'',coalesce(wf.approval_status,''legacy''),',
  '''approval_status'',coalesce(wf.approval_status,''legacy''),'||
   '''exchange_hold_pending_qty'',coalesce(hld.pending_qty,0),'||
   '''exchange_held_qty'',coalesce(hld.approved_qty,0),'||
   '''exchange_hold_request_id'',hld.pending_id,'||
   '''exchange_available_to_process'',case when r.disposition=''exchange'' then '||
      'greatest(r.qty-coalesce(r.historical_stock_reconciled_qty,0)'||
       '-coalesce(mv.received,0)-coalesce(pnd.qty,0)'||
       '-coalesce(hld.pending_qty,0)-coalesce(hld.approved_qty,0),0) '||
       'else 0 end,');
 s:=replace(s,
  'when r.disposition<>''return_to_stock'' then ''no_stock_action''',
  'when r.disposition=''exchange'' and coalesce(hld.pending_qty,0)>0 then ''exchange_hold_approval_pending'' '||
  'when r.disposition=''exchange'' and '||
   '(coalesce(r.historical_stock_reconciled_qty,0)+coalesce(mv.received,0)+'||
    'coalesce(hld.approved_qty,0))>=r.qty then ''exchange_resolved'' '||
  'when r.disposition=''exchange'' then ''exchange_inspection_pending'' '||
  'when r.disposition<>''return_to_stock'' then ''no_stock_action''');
 s:=replace(s,
  'r.disposition=''return_to_stock'' and',
  'r.disposition in (''return_to_stock'',''exchange'') and');
 s:=replace(s,
  'r.disposition=''return_to_stock''',
  'r.disposition in (''return_to_stock'',''exchange'')');
 s:=replace(s,
  '-coalesce(pnd.qty,0),0)',
  '-coalesce(pnd.qty,0)-case when r.disposition=''exchange'' then '||
    'coalesce(hld.pending_qty,0)+coalesce(hld.approved_qty,0) else 0 end,0)');
 s:=replace(s,
   'left join public.customers cust on cust.id=cn.customer_id',
   'left join public.customers cust on cust.id=cn.customer_id '||
   'left join lateral (select coalesce(sum(held_qty) filter (where status=''pending''),0) pending_qty,'||
   'coalesce(sum(held_qty) filter (where status=''approved''),0) approved_qty,'||
   '(array_agg(id order by requested_at) filter (where status=''pending''))[1] pending_id '||
   'from public.cn_exchange_hold_requests where sales_return_item_id=r.id) hld on true');
 -- Guard against accidental double replacement.
 if position('''exchange_available_to_process''' in s)=0 or
   position('''exchange_hold_request_id''' in s)=0 then
    raise exception 'Exchange queue fields missing after patch';end if;
 execute s;
end $patch$;

-- Static verified review function (avoids dynamic parser ambiguity in IF/CASE).
CREATE OR REPLACE FUNCTION public.review_cn_stock_receipt(p_request_id uuid, p_approve boolean, p_reviewer_note text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare req public.cn_stock_receipt_requests%rowtype; ri public.sales_return_items%rowtype;
 cn public.sales_returns%rowtype; posted numeric; historical numeric; mv uuid;
begin
 if auth.uid() is null or not public.can_admin_inventory() then raise exception 'Admin inventory approval access required'; end if;
 select * into req from public.cn_stock_receipt_requests where id=p_request_id;
 if not found then raise exception 'CN receipt approval not found'; end if;
 perform pg_advisory_xact_lock(hashtextextended('cn-receipt:'||req.sales_return_item_id::text,0));
 select * into req from public.cn_stock_receipt_requests where id=p_request_id for update;
 if req.status<>'pending' then raise exception 'CN receipt request already reviewed'; end if;
 if coalesce(p_approve,false) then
  select * into ri from public.sales_return_items where id=req.sales_return_item_id for update;
  select * into cn from public.sales_returns where id=req.sales_return_id;
  if ri.id is null or cn.id is null or cn.status='cancelled' or ri.sales_return_id<>cn.id then raise exception 'CN no longer valid'; end if;
  if ri.disposition not in ('return_to_stock','exchange') or ri.product_id is null or req.inspected_condition<>'good' then
    raise exception 'CN line is not eligible for saleable-stock receipt'; end if;
  if not exists(select 1 from public.stock_locations where id=req.location_id and active) then raise exception 'Location is inactive'; end if;
  select coalesce(sum(m.qty),0) into posted from public.stock_movements m
   where m.affects_balance and m.movement_type in ('in','return') and
    m.reference_type='sales_return_item' and m.reference_item_id=ri.id;
  historical:=coalesce(ri.historical_stock_reconciled_qty,0);
  if posted+historical+req.requested_qty+
      (select coalesce(sum(h.held_qty),0) from public.cn_exchange_hold_requests h
       where ri.disposition='exchange' and h.sales_return_item_id=ri.id
         and h.status in ('pending','approved'))>ri.qty then raise exception 'CN quantity already received, cannot receive again'; end if;
  perform set_config('app.cn_receipt_approved','1',true);
  insert into public.stock_movements(
    product_id,movement_type,qty,to_location_id,movement_date,
    reference_type,reference_id,reference_item_id,reference_no,note,created_by
  ) values(
    ri.product_id,'return',req.requested_qty,req.location_id,current_date,
    'sales_return_item',cn.id,ri.id,cn.cn_no,
    concat('Approved CN stock receipt · Good',case when req.note is not null then ' · '||req.note else '' end),auth.uid()
  ) returning id into mv;
  perform set_config('app.cn_receipt_approved','',true);
  perform public.refresh_inventory_product_snapshot(ri.product_id);
 end if;
 update public.cn_stock_receipt_requests set status=case when coalesce(p_approve,false) then 'approved' else 'rejected' end,
   reviewed_by=auth.uid(),reviewed_at=now(),reviewer_note=nullif(btrim(coalesce(p_reviewer_note,'')),''),applied_movement_id=mv
 where id=req.id;
 return mv;
end;
$function$;

-- For new CNs, an Exchange must be physically resolved (good Stock IN
-- or approved damaged Hold) before automatic case closure / credit finalization.
create or replace function public.cn_case_stock_complete(p_return_id uuid)
returns boolean language sql stable security definer set search_path='public','auth','pg_temp'
as $fn$
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
$fn$;

-- Surface unresolved exchange on CN details and Sales Returns badge.
create or replace function public.get_visible_cn_pending_stock_receipts()
returns table(return_id uuid,return_item_id uuid,pending_qty numeric)
language sql stable security definer set search_path='public','auth','pg_temp'
as $fn$
 select r.id,ri.id,
  greatest(ri.qty-coalesce(ri.historical_stock_reconciled_qty,0)-
   coalesce((select sum(m.qty) from public.stock_movements m
     where m.affects_balance and m.movement_type in ('in','return')
      and m.reference_type='sales_return_item' and m.reference_item_id=ri.id),0)-
   case when ri.disposition='exchange' then coalesce((
    select sum(h.held_qty) from public.cn_exchange_hold_requests h
    where h.sales_return_item_id=ri.id and h.status='approved'),0)
    else 0 end,0)::numeric
 from public.sales_returns r
 join public.sales_return_items ri on ri.sales_return_id=r.id
 where auth.uid() is not null and r.status<>'cancelled'
  and ri.disposition in ('return_to_stock','exchange')
  and public.can_view_sales_return(r.id)
  and ri.qty-coalesce(ri.historical_stock_reconciled_qty,0)
   -coalesce((select sum(m.qty) from public.stock_movements m
      where m.affects_balance and m.movement_type in ('in','return')
       and m.reference_type='sales_return_item' and m.reference_item_id=ri.id),0)
   -case when ri.disposition='exchange' then coalesce((
     select sum(h.held_qty) from public.cn_exchange_hold_requests h
     where h.sales_return_item_id=ri.id and h.status='approved'),0)
      else 0 end>0
$fn$;

-- Rollback-friendly final grants. All mutation entrypoints enforce roles.
revoke all on function public.submit_cn_exchange_hold(uuid,numeric,uuid,text,text) from public,anon;
revoke all on function public.review_cn_exchange_hold(uuid,boolean,text) from public,anon;
revoke all on function public.get_cn_exchange_hold_requests(uuid) from public,anon;
grant execute on function public.submit_cn_exchange_hold(uuid,numeric,uuid,text,text) to authenticated;
grant execute on function public.review_cn_exchange_hold(uuid,boolean,text) to authenticated;
grant execute on function public.get_cn_exchange_hold_requests(uuid) to authenticated;
