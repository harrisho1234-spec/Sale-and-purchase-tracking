-- Invoice-scoped CN source selection. Non-destructive: prior CNs remain legacy.
-- For new CNs, enforce exact issued TK/RK quantities or uninvoiced SR cancellation.
alter table public.sales_return_items
  add column if not exists source_invoice_part_id uuid
  references public.sales_sr_invoice_parts(id) on delete restrict;
create index if not exists idx_cn_item_source_invoice_part
  on public.sales_return_items (source_invoice_part_id,sales_order_item_id);
alter table public.sales_returns add column if not exists source_scope_version smallint not null default 0;
alter table public.sales_returns alter column source_scope_version set default 1;

create or replace function public.cn_source_invoice_available(p_invoice_part_id uuid,p_sales_order_item_id uuid,p_exclude_return_item_id uuid default null)
returns numeric language sql stable security definer set search_path='public','auth','pg_temp'
as $scope$
with target as (
  select h.id,coalesce(h.issued_at,h.requested_at) as when_issued,l.qty
  from public.sales_sr_invoice_parts h
  join public.sales_sr_invoice_part_lines l on l.invoice_part_id=h.id
  where h.id=p_invoice_part_id and h.status='issued' and l.sales_order_item_id=p_sales_order_item_id
),
prior_issued as (
 select coalesce(sum(l2.qty),0) as qty
 from target t join public.sales_sr_invoice_part_lines l2 on l2.sales_order_item_id=p_sales_order_item_id
 join public.sales_sr_invoice_parts h2 on h2.id=l2.invoice_part_id and h2.status='issued'
 where (coalesce(h2.issued_at,h2.requested_at),h2.id)<(t.when_issued,t.id)
),
returns as (
 select
  coalesce(sum(ri.qty) filter(where ri.source_invoice_part_id=p_invoice_part_id),0) as specific,
  coalesce(sum(ri.qty) filter(where ri.source_invoice_part_id is null and cn.source_scope_version=0
                 and cn.action<>'cancel_undelivered'),0) as old_unlinked,
  coalesce(sum(ri.qty),0) as total
 from public.sales_return_items ri
 join public.sales_returns cn on cn.id=ri.sales_return_id
 left join public.cn_case_workflows w on w.sales_return_id=cn.id
 where ri.sales_order_item_id=p_sales_order_item_id and ri.id is distinct from p_exclude_return_item_id
   and cn.status<>'cancelled' and coalesce(w.approval_status,'pending')<>'rejected'
)
select coalesce(greatest(0,least(
  t.qty-r.specific-least(t.qty,greatest(0,r.old_unlinked-p.qty)),
  (select i.qty from public.sales_order_items i where i.id=p_sales_order_item_id)-r.total
)),0)
from target t cross join prior_issued p cross join returns r;
$scope$;
revoke all on function public.cn_source_invoice_available(uuid,uuid,uuid) from public,anon,authenticated;

create or replace function public.get_return_source_documents()
returns table(source_key text,source_kind text,source_id uuid,document_no text,
 customer_id uuid,customer_name text,order_date date,sales_rep_id uuid)
language sql stable security definer set search_path='public','auth','pg_temp'
as $docs$
select d.source_key,d.source_kind,d.source_id,d.document_no,d.customer_id,d.customer_name,d.order_date,d.sales_rep_id
from (
 select ('invoice_part:'||h.id::text) as source_key,'invoice_part'::text as source_kind,
   h.id as source_id,h.invoice_no::text as document_no,o.customer_id,c.name::text as customer_name,
   o.order_date,o.sales_rep_id
 from public.sales_sr_invoice_parts h
 join public.sales_orders o on o.id=h.sales_order_id
 join public.customers c on c.id=o.customer_id
 where auth.uid() is not null and h.status='issued' and coalesce(o.status,'')<>'cancelled'
  and public.can_view_sales_order(o.id)
 union all
 select 'order:'||o.id::text,'order',o.id,
   coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,'')),
   o.customer_id,c.name,o.order_date,o.sales_rep_id
 from public.sales_orders o join public.customers c on c.id=o.customer_id
 where auth.uid() is not null and public.can_view_sales_order(o.id) and coalesce(o.status,'')<>'cancelled'
  and (coalesce(o.sales_flow_type,o.order_type,'')<>'pre_order'
       or nullif(o.sales_invoice_no,'') is not null or nullif(o.invoice_no,'') is not null)
  and not exists (
    select 1 from public.sales_sr_invoice_part_lines l
    join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id and h.status='issued'
    join public.sales_order_items i on i.id=l.sales_order_item_id
    where i.sales_order_id=o.id
  )
 union all
 select 'sr_uninvoiced:'||o.id::text,'sr_uninvoiced',o.id,
   coalesce(nullif(o.sr_no,''),nullif(o.order_no,''))||' · Uninvoiced',
   o.customer_id,c.name,o.order_date,o.sales_rep_id
 from public.sales_orders o join public.customers c on c.id=o.customer_id
 where auth.uid() is not null and public.can_view_sales_order(o.id) and coalesce(o.status,'')<>'cancelled'
  and coalesce(o.sales_flow_type,o.order_type,'')='pre_order'
  and nullif(o.sales_invoice_no,'') is null and nullif(o.invoice_no,'') is null
  and exists(select 1 from public.sales_order_items i where i.sales_order_id=o.id
    and public.cn_cancellable_qty(i.id)>0
    and i.qty > coalesce((
      select sum(l.qty) from public.sales_sr_invoice_part_lines l
      join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
      where l.sales_order_item_id=i.id and h.status in ('issued','pending')
    ),0) + coalesce((
      select sum(ri.qty) from public.sales_return_items ri
      join public.sales_returns cn on cn.id=ri.sales_return_id
      left join public.cn_case_workflows w on w.sales_return_id=cn.id
      where ri.sales_order_item_id=i.id and cn.action='cancel_undelivered'
        and cn.status<>'cancelled' and coalesce(w.approval_status,'pending')<>'rejected'
    ),0)
  )
) d order by d.order_date desc,d.document_no desc;
$docs$;
revoke all on function public.get_return_source_documents() from public,anon;
grant execute on function public.get_return_source_documents() to authenticated;

create or replace function public.get_return_source_items(p_source_kind text,p_source_id uuid,p_action text)
returns table(sales_order_item_id uuid,product_id uuid,product_code text,item_name text,
 qty_sold numeric,qty_returned numeric,qty_available numeric,unit_price numeric,
 source_order_id uuid,source_invoice_part_id uuid)
language plpgsql stable security definer set search_path='public','auth','pg_temp'
as $items$
begin
 if auth.uid() is null then raise exception 'Sign in required'; end if;
 if p_action not in ('cancel_undelivered','return_only','return_to_stock','damaged_return')
 then raise exception 'Invalid return action'; end if;
 if p_source_kind='invoice_part' then
   if not exists(select 1 from public.sales_sr_invoice_parts h
     join public.sales_orders o on o.id=h.sales_order_id
     where h.id=p_source_id and h.status='issued' and public.can_view_sales_order(o.id))
   then raise exception 'Issued TK/RK invoice is not available'; end if;
   return query
   select i.id,i.product_id,i.product_code_snapshot,i.item_name_snapshot,
     l.qty::numeric,(l.qty-public.cn_source_invoice_available(h.id,i.id))::numeric,
     public.cn_source_invoice_available(h.id,i.id)::numeric,i.unit_price,i.sales_order_id,h.id
   from public.sales_sr_invoice_parts h
   join public.sales_sr_invoice_part_lines l on l.invoice_part_id=h.id
   join public.sales_order_items i on i.id=l.sales_order_item_id
   where h.id=p_source_id and h.status='issued' and public.can_view_sales_order(i.sales_order_id)
     and public.cn_source_invoice_available(h.id,i.id)>0
   order by i.line_position nulls last,i.id;
 elsif p_source_kind='sr_uninvoiced' then
   if p_action<>'cancel_undelivered' then raise exception 'SR only allows cancellation of uninvoiced quantities';end if;
   if not exists(select 1 from public.sales_orders o where o.id=p_source_id
     and coalesce(o.sales_flow_type,o.order_type,'')='pre_order'
     and nullif(o.sales_invoice_no,'') is null and nullif(o.invoice_no,'') is null
     and public.can_view_sales_order(o.id))
   then raise exception 'SR is not eligible for uninvoiced cancellation';end if;
   return query
   select i.id,i.product_id,i.product_code_snapshot,i.item_name_snapshot,i.qty,
     greatest(i.qty - cap.available,0)::numeric,cap.available,i.unit_price,i.sales_order_id,null::uuid
   from public.sales_order_items i
   cross join lateral (
     select greatest(0,least(public.cn_cancellable_qty(i.id),
       i.qty-coalesce((
         select sum(l.qty) from public.sales_sr_invoice_part_lines l
         join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
         where l.sales_order_item_id=i.id and h.status in ('issued','pending')
       ),0)-coalesce((
         select sum(ri.qty) from public.sales_return_items ri
         join public.sales_returns cn on cn.id=ri.sales_return_id
         left join public.cn_case_workflows w on w.sales_return_id=cn.id
         where ri.sales_order_item_id=i.id and cn.action='cancel_undelivered'
           and cn.status<>'cancelled' and coalesce(w.approval_status,'pending')<>'rejected'
       ),0)
     ))::numeric as available
   ) cap
   where i.sales_order_id=p_source_id and cap.available>0
   order by i.line_position nulls last,i.id;
 elsif p_source_kind='order' then
   if not exists(select 1 from public.sales_orders o where o.id=p_source_id
     and public.can_view_sales_order(o.id) and coalesce(o.status,'')<>'cancelled'
     and (coalesce(o.sales_flow_type,o.order_type,'')<>'pre_order'
       or nullif(o.sales_invoice_no,'') is not null or nullif(o.invoice_no,'') is not null)
     and not exists(
       select 1 from public.sales_sr_invoice_part_lines l
       join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id and h.status='issued'
       join public.sales_order_items si on si.id=l.sales_order_item_id
       where si.sales_order_id=o.id))
   then raise exception 'Use issued TK/RK invoice for this converted SR';end if;
   if p_action='cancel_undelivered' then
     return query select g.sales_order_item_id,g.product_id,g.product_code,g.item_name,
       g.qty_sold,g.qty_returned,g.qty_available,g.unit_price,p_source_id,null::uuid
     from public.get_cancellable_order_items(p_source_id) g;
   else
     return query select g.sales_order_item_id,g.product_id,g.product_code,g.item_name,
       g.qty_sold,g.qty_returned,g.qty_available,g.unit_price,p_source_id,null::uuid
     from public.get_returnable_order_items(p_source_id) g;
   end if;
 else
   raise exception 'Unknown return source';
 end if;
end $items$;
revoke all on function public.get_return_source_items(text,uuid,text) from public,anon;
grant execute on function public.get_return_source_items(text,uuid,text) to authenticated;

create or replace function public.validate_invoice_scoped_cn_item()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $guard$
declare v_cn public.sales_returns%rowtype;v_i public.sales_order_items%rowtype;v_o public.sales_orders%rowtype;
 v_reserved numeric:=0;v_cancelled numeric:=0;v_allowed numeric:=0;
begin
 select * into v_cn from public.sales_returns where id=new.sales_return_id;
 if not found then raise exception 'CN not found';end if;
 if v_cn.source_scope_version=0 then return new;end if; -- grandfather all existing CNs unchanged
 select * into v_i from public.sales_order_items where id=new.sales_order_item_id;
 select * into v_o from public.sales_orders where id=v_i.sales_order_id;
 if new.source_invoice_part_id is not null then
   v_allowed:=public.cn_source_invoice_available(new.source_invoice_part_id,new.sales_order_item_id,
          case when tg_op='UPDATE' then old.id else null::uuid end);
   if v_allowed is null or new.qty>v_allowed+0.000001 then
      raise exception 'Return quantity exceeds the issued TK/RK line or is linked to the wrong invoice';
   end if;
 elsif coalesce(v_o.sales_flow_type,v_o.order_type,'')='pre_order'
       and nullif(v_o.sales_invoice_no,'') is null and nullif(v_o.invoice_no,'') is null then
   if v_cn.action<>'cancel_undelivered' then
     raise exception 'Select the issued TK/RK for returns; SR may only cancel uninvoiced items';
   end if;
   select coalesce(sum(l.qty),0) into v_reserved from public.sales_sr_invoice_part_lines l
     join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
     where l.sales_order_item_id=v_i.id and h.status in ('issued','pending');
   select coalesce(sum(ri.qty),0) into v_cancelled from public.sales_return_items ri
     join public.sales_returns cn on cn.id=ri.sales_return_id
     left join public.cn_case_workflows w on w.sales_return_id=cn.id
     where ri.sales_order_item_id=v_i.id and ri.id is distinct from
       (case when tg_op='UPDATE' then old.id else null::uuid end)
       and cn.action='cancel_undelivered' and cn.status<>'cancelled'
       and coalesce(w.approval_status,'pending')<>'rejected';
   v_allowed:=greatest(0,least(public.cn_cancellable_qty(v_i.id,v_cn.id),
      v_i.qty-v_reserved-v_cancelled));
   if new.qty>v_allowed+0.000001 then
      raise exception 'SR cancellation exceeds the uninvoiced available quantity';
   end if;
 end if;
 return new;
end $guard$;
revoke all on function public.validate_invoice_scoped_cn_item() from public,anon,authenticated;
drop trigger if exists validate_invoice_scoped_cn_item_trg on public.sales_return_items;
create trigger validate_invoice_scoped_cn_item_trg before insert or update of
  qty,source_invoice_part_id,sales_order_item_id,sales_return_id
  on public.sales_return_items for each row execute function public.validate_invoice_scoped_cn_item();

create or replace function public.get_cn_return_item_sources(p_return_id uuid)
returns table(return_item_id uuid,source_invoice_part_id uuid)
language sql stable security definer set search_path='public','auth','pg_temp'
as $link$
 select ri.id,ri.source_invoice_part_id from public.sales_return_items ri
 where ri.sales_return_id=p_return_id and public.can_view_sales_return(p_return_id);
$link$;
revoke all on function public.get_cn_return_item_sources(uuid) from public,anon;
grant execute on function public.get_cn_return_item_sources(uuid) to authenticated;

create or replace function public.cn_return_line_document_no(p_return_item_id uuid)
returns text language sql stable security definer set search_path='public','auth','pg_temp'
as $doc$
 select coalesce(
  h.invoice_no,
  (select min(h2.invoice_no) from public.sales_sr_invoice_part_lines l2
     join public.sales_sr_invoice_parts h2 on h2.id=l2.invoice_part_id
     where l2.sales_order_item_id=ri.sales_order_item_id and h2.status='issued'
     having count(distinct h2.id)=1),
  nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.sr_no,''),o.order_no
 )
 from public.sales_return_items ri
 join public.sales_order_items i on i.id=ri.sales_order_item_id
 join public.sales_orders o on o.id=i.sales_order_id
 left join public.sales_sr_invoice_parts h on h.id=ri.source_invoice_part_id
 where ri.id=p_return_item_id;
$doc$;
revoke all on function public.cn_return_line_document_no(uuid) from public,anon,authenticated;


-- Preserve original CN creation/edit validation and add immutable invoice-part provenance.
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
      item_name_snapshot,qty,unit_price,condition,disposition,notes,source_invoice_part_id
    )
    values(
      v_return_id,v_original.id,v_original.product_id,v_original.product_code_snapshot,
      v_original.item_name_snapshot,v_qty,coalesce(v_original.unit_price,0),
      case when coalesce(v_item->>'condition','good') in ('good','damaged','defective','other')
        then coalesce(v_item->>'condition','good') else 'good' end,
      case when coalesce(v_item->>'disposition','no_stock_action') in ('return_to_stock','damaged_hold','exchange','no_stock_action')
        then coalesce(v_item->>'disposition','no_stock_action') else 'no_stock_action' end,
      nullif(trim(coalesce(v_item->>'notes','')),''),
      nullif(v_item->>'source_invoice_part_id','')::uuid
    );
    v_count:=v_count+1;
  end loop;

  if v_count=0 then
    raise exception 'Please select at least one item to return';
  end if;

  return query select v_return_id,v_cn;
end;
$function$
;

-- Preserve original CN creation/edit validation and add immutable invoice-part provenance.
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
      item_name_snapshot,qty,unit_price,condition,disposition,notes,source_invoice_part_id
    )
    values(
      p_return_id,v_original.id,v_original.product_id,v_original.product_code_snapshot,
      v_original.item_name_snapshot,v_qty,coalesce(v_original.unit_price,0),
      case when coalesce(v_item->>'condition','good') in ('good','damaged','defective','other')
        then coalesce(v_item->>'condition','good') else 'good' end,
      case when coalesce(v_item->>'disposition','no_stock_action') in ('return_to_stock','damaged_hold','exchange','no_stock_action')
        then coalesce(v_item->>'disposition','no_stock_action') else 'no_stock_action' end,
      nullif(trim(coalesce(v_item->>'notes','')),''),
      nullif(v_item->>'source_invoice_part_id','')::uuid
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
$function$
;

-- Display verified issued TK/RK rather than the parent SR when a return item has exactly one source invoice.
CREATE OR REPLACE FUNCTION public.get_visible_sales_returns()
 RETURNS TABLE(return_id uuid, cn_no text, return_date date, status text, action text, reason text, notes text, sales_order_id uuid, original_document_no text, customer_name text, sales_rep_id uuid, return_value numeric, item_count bigint)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  select
    r.id,
    r.cn_no,
    r.return_date,
    r.status,
    r.action,
    r.reason,
    r.notes,
    r.sales_order_id,
    coalesce(src.original_document_no,
      coalesce(nullif(primary_o.sales_invoice_no,''),nullif(primary_o.invoice_no,''),nullif(primary_o.sr_no,''),nullif(primary_o.order_no,''))),
    c.name,
    primary_o.sales_rep_id,
    coalesce(src.return_value,0),
    coalesce(src.item_count,0)
  from public.sales_returns r
  join public.sales_orders primary_o on primary_o.id=r.sales_order_id
  join public.customers c on c.id=r.customer_id
  left join lateral (
    select
      string_agg(distinct public.cn_return_line_document_no(ri.id), ', ' order by public.cn_return_line_document_no(ri.id)) as original_document_no,
      sum(public.sales_order_item_net_return_value(ri.sales_order_item_id,ri.qty))::numeric as return_value,
      count(ri.id)::bigint as item_count
    from public.sales_return_items ri
    join public.sales_order_items soi on soi.id=ri.sales_order_item_id
    join public.sales_orders o on o.id=soi.sales_order_id
    where ri.sales_return_id=r.id
  ) src on true
  where public.can_view_sales_return(r.id)
  order by r.return_date desc,r.created_at desc
$function$
;

CREATE OR REPLACE FUNCTION public.get_sales_return_items_detail_v2(p_return_id uuid)
 RETURNS TABLE(return_item_id uuid, sales_order_item_id uuid, source_order_id uuid, source_document_no text, product_code text, item_name text, qty numeric, qty_sold numeric, qty_returned_other numeric, max_edit_qty numeric, unit_price numeric, return_value numeric, condition text, disposition text, notes text)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
begin
  if not public.can_view_sales_return(p_return_id) then raise exception 'Access denied'; end if;

  return query
  select
    ri.id,
    ri.sales_order_item_id,
    soi.sales_order_id,
    public.cn_return_line_document_no(ri.id),
    ri.product_code_snapshot,
    ri.item_name_snapshot,
    ri.qty,
    soi.qty,
    coalesce((
      select sum(ri2.qty)
      from public.sales_return_items ri2
      join public.sales_returns r2 on r2.id=ri2.sales_return_id
      where ri2.sales_order_item_id=ri.sales_order_item_id
        and r2.id<>p_return_id
        and r2.status<>'cancelled'
    ),0)::numeric,
    greatest(
      soi.qty-coalesce((
        select sum(ri2.qty)
        from public.sales_return_items ri2
        join public.sales_returns r2 on r2.id=ri2.sales_return_id
        where ri2.sales_order_item_id=ri.sales_order_item_id
          and r2.id<>p_return_id
          and r2.status<>'cancelled'
      ),0),0
    )::numeric,
    ri.unit_price,
    public.sales_order_item_net_return_value(ri.sales_order_item_id,ri.qty),
    ri.condition,
    ri.disposition,
    ri.notes
  from public.sales_return_items ri
  join public.sales_order_items soi on soi.id=ri.sales_order_item_id
  join public.sales_orders o on o.id=soi.sales_order_id
  where ri.sales_return_id=p_return_id
  order by o.order_date,o.created_at,soi.line_position nulls last,soi.created_at,soi.id;
end;
$function$
;

-- Existing CN lines remain unchanged; new CNs use source_scope_version=1.
