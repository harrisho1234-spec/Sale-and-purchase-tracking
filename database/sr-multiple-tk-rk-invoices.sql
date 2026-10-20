-- One SR can issue many independently numbered TK/RK documents without duplicating Sales Orders,
-- deposits, customer receivables or the original SR's items.
create table if not exists public.sales_sr_invoice_parts(
 id uuid primary key default gen_random_uuid(),
 sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
 invoice_type text not null check(invoice_type in ('TK','RK')),
 invoice_no text not null,
 sales_category text not null default 'standard' check(sales_category in ('standard','project')),
 status text not null default 'pending' check(status in ('pending','issued','rejected')),
 request_note text,
 requested_by uuid not null default auth.uid() references auth.users(id),
 requested_at timestamptz not null default now(),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 review_note text,
 invoice_total numeric not null default 0 check(invoice_total>=0),
 issued_at timestamptz
);
create unique index if not exists sales_sr_invoice_parts_number_uniq
 on public.sales_sr_invoice_parts(upper(btrim(invoice_no)));
create index if not exists sales_sr_invoice_parts_order_status_idx
 on public.sales_sr_invoice_parts(sales_order_id,status);
create table if not exists public.sales_sr_invoice_part_lines(
 id uuid primary key default gen_random_uuid(),
 invoice_part_id uuid not null references public.sales_sr_invoice_parts(id) on delete restrict,
 sales_order_item_id uuid not null references public.sales_order_items(id) on delete restrict,
 qty numeric not null check(qty>0 and qty=trunc(qty)),
 unit_price numeric not null,
 discount_amount numeric not null default 0,
 line_total numeric not null check(line_total>=0),
 product_code text not null,
 item_name text not null,
 unique(invoice_part_id,sales_order_item_id)
);
create index if not exists sales_sr_invoice_part_lines_item_idx
 on public.sales_sr_invoice_part_lines(sales_order_item_id);
alter table public.sales_sr_invoice_parts enable row level security;
alter table public.sales_sr_invoice_part_lines enable row level security;
revoke all on public.sales_sr_invoice_parts,public.sales_sr_invoice_part_lines from public,anon,authenticated;
-- Only vetted SECURITY DEFINER functions below may expose/modify these tables.
grant select on public.sales_sr_invoice_parts,public.sales_sr_invoice_part_lines to authenticated;

create or replace function public.get_sr_split_invoice_summary(p_order_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare v_o public.sales_orders%rowtype; v_visible boolean;
begin
 select * into v_o from public.sales_orders where id=p_order_id;
 if not found or auth.uid() is null then return null; end if;
 v_visible:=public.current_app_role() in ('admin','manager','super_admin')
  or v_o.sales_rep_id=auth.uid();
 if not v_visible then raise exception 'Not authorized to view SR invoices'; end if;
 return jsonb_build_object(
 'sr_id',p_order_id,
 'invoices',coalesce((
   select jsonb_agg(jsonb_build_object(
     'id',h.id,'invoice_no',h.invoice_no,'invoice_type',h.invoice_type,
     'category',h.sales_category,'status',h.status,
     'total',h.invoice_total,'requested_at',h.requested_at,'issued_at',h.issued_at,
     'lines',(select coalesce(jsonb_agg(jsonb_build_object(
       'item_id',l.sales_order_item_id,'code',l.product_code,'name',l.item_name,
       'qty',l.qty,'amount',l.line_total) order by l.product_code),'[]'::jsonb)
       from public.sales_sr_invoice_part_lines l where l.invoice_part_id=h.id)
   ) order by h.requested_at,h.id)
   from public.sales_sr_invoice_parts h where h.sales_order_id=p_order_id
 ),'[]'::jsonb),
 'items',coalesce((
  select jsonb_agg(jsonb_build_object(
    'id',i.id,'code',i.product_code_snapshot,'name',i.item_name_snapshot,
    'image',i.image_url_snapshot,'qty',i.qty,'unit_price',i.unit_price,
    'line_total',i.line_total,'discount',i.discount_amount,
    'ready',lower(coalesce(it.status,i.fulfillment_status,'ordered')) in ('arrived','ready','delivered'),
    'issued_qty',coalesce((select sum(l.qty) from public.sales_sr_invoice_part_lines l
      join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
      where l.sales_order_item_id=i.id and h.status='issued'),0),
    'pending_qty',coalesce((select sum(l.qty) from public.sales_sr_invoice_part_lines l
      join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
      where l.sales_order_item_id=i.id and h.status='pending'),0)
  ) order by i.line_position nulls last,i.created_at)
  from public.sales_order_items i left join public.item_tracking it on it.sales_order_item_id=i.id
  where i.sales_order_id=p_order_id
 ),'[]'::jsonb));
end
$function$;

create or replace function public.submit_sr_split_invoice(
 p_order_id uuid,p_invoice_type text,p_invoice_no text,
 p_sales_category text,p_lines jsonb,p_note text default null
) returns uuid language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
 v_o public.sales_orders%rowtype;
 v_type text:=upper(btrim(coalesce(p_invoice_type,'')));
 v_no text:=upper(btrim(coalesce(p_invoice_no,'')));
 v_category text:=lower(btrim(coalesce(p_sales_category,'standard')));
 v_json jsonb; v_line record; v_qty numeric;v_used numeric;v_id uuid;
 v_count integer:=0;v_total numeric:=0;v_line_amount numeric;v_line_discount numeric;
begin
 if public.current_app_role()<>'sales' or not public.current_user_has_permission('sales_orders.convert_request') then
  raise exception 'Sales SR conversion request permission required';
 end if;
 if v_type not in ('TK','RK') or v_no !~ '^(TK|RK)[A-Z0-9/-]+$' or left(v_no,2)<>v_type or length(v_no)>80 then
  raise exception 'Invoice number must use the selected TK/RK prefix';
 end if;
 if v_category not in ('standard','project') then raise exception 'Invalid category'; end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1 or jsonb_array_length(p_lines)>100 then
  raise exception 'Select 1–100 SR lines and quantities';
 end if;
 select * into v_o from public.sales_orders where id=p_order_id for update;
 if not found or v_o.sales_flow_type<>'pre_order' or v_o.status='cancelled' then
  raise exception 'Active SR pre-order required';
 end if;
 if v_o.sales_rep_id is distinct from auth.uid() then
  raise exception 'Only the assigned Sales Rep can submit an SR invoice';
 end if;
 if v_o.sales_invoice_no is not null then
  raise exception 'SR was finalized using the earlier single-invoice system. No additional invoice can be issued.';
 end if;
 if exists(select 1 from public.sales_sr_conversion_requests
           where sales_order_id=p_order_id and status in ('pending','approved')) then
  raise exception 'A legacy SR invoice conversion is already pending/issued';
 end if;
 if exists(select 1 from public.sales_orders so where
  upper(btrim(coalesce(so.order_no,'')))=v_no or upper(btrim(coalesce(so.invoice_no,'')))=v_no
  or upper(btrim(coalesce(so.sr_no,'')))=v_no or upper(btrim(coalesce(so.sales_invoice_no,'')))=v_no)
  or exists(select 1 from public.sales_sr_conversion_requests r
      where upper(btrim(r.invoice_no))=v_no and r.status in ('pending','approved'))
  or exists(select 1 from public.sales_sr_invoice_parts h where upper(btrim(h.invoice_no))=v_no) then
    raise exception 'Invoice number % already exists or was used before',v_no;
 end if;
 insert into public.sales_sr_invoice_parts(sales_order_id,invoice_type,invoice_no,sales_category,request_note)
  values(p_order_id,v_type,v_no,v_category,nullif(left(btrim(coalesce(p_note,'')),2000),''))
  returning id into v_id;
 for v_json in select value from jsonb_array_elements(p_lines)
 loop
  if not (v_json ? 'item_id') or not (v_json ? 'qty') then raise exception 'Each line needs an SR item and quantity'; end if;
  if (v_json->>'qty') !~ '^[0-9]+(\.[0-9]+)?$' then raise exception 'Invalid quantity entered'; end if;
  v_qty:=(v_json->>'qty')::numeric;
  if v_qty<=0 or v_qty<>trunc(v_qty) then raise exception 'Only positive whole-number quantities allowed'; end if;
  select i.id,i.qty,i.unit_price,i.discount_amount,i.line_total,
   i.product_code_snapshot,i.item_name_snapshot,
   lower(coalesce(it.status,i.fulfillment_status,'ordered')) as item_status
   into v_line from public.sales_order_items i
   left join public.item_tracking it on it.sales_order_item_id=i.id
   where i.id=(v_json->>'item_id')::uuid and i.sales_order_id=p_order_id;
  if not found then raise exception 'Line does not belong to this SR'; end if;
  if v_line.item_status not in ('arrived','ready','delivered') then
   raise exception 'Product % is not Arrived/Ready yet',v_line.product_code_snapshot;
  end if;
  select coalesce(sum(l.qty),0) into v_used
   from public.sales_sr_invoice_part_lines l join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
   where l.sales_order_item_id=v_line.id and h.status in ('issued','pending');
  if v_used+v_qty>v_line.qty then
   raise exception 'Product %: only % qty remains uninvoiced',v_line.product_code_snapshot,v_line.qty-v_used;
  end if;
  -- Split line value proportionally, without recreating another Sales Order or income.
  v_line_discount:=round(coalesce(v_line.discount_amount,0)*v_qty/v_line.qty,2);
  v_line_amount:=round(coalesce(v_line.line_total,v_line.qty*v_line.unit_price-coalesce(v_line.discount_amount,0))*v_qty/v_line.qty,2);
  if v_line_amount<0 then raise exception 'Line has invalid amount'; end if;
  insert into public.sales_sr_invoice_part_lines(
   invoice_part_id,sales_order_item_id,qty,unit_price,discount_amount,line_total,product_code,item_name)
   values(v_id,v_line.id,v_qty,v_line.unit_price,v_line_discount,
     v_line_amount,v_line.product_code_snapshot,v_line.item_name_snapshot);
  v_count:=v_count+1;v_total:=v_total+v_line_amount;
 end loop;
 update public.sales_sr_invoice_parts set invoice_total=v_total where id=v_id;
 insert into public.sales_document_events(sales_order_id,event_type,document_no,note,actor_user_id,metadata)
 values(p_order_id,'invoice_conversion_requested',v_no,p_note,auth.uid(),
  jsonb_build_object('split_invoice_id',v_id,'lines',v_count,'invoice_total',v_total,
  'invoice_type',v_type,'sales_category',v_category,'partial',true));
 return v_id;
end
$function$;

create or replace function public.review_sr_split_invoice(
 p_request_id uuid,p_approve boolean,p_note text default null
) returns text language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare v_h public.sales_sr_invoice_parts%rowtype; v_o public.sales_orders%rowtype;
 v_qty_bad integer; v_total numeric;
begin
 if public.current_app_role() not in ('manager','admin','super_admin')
   or not public.current_user_has_permission('sales_orders.convert_approve') then
  raise exception 'Sales Manager/Admin conversion approval required';
 end if;
 select * into v_h from public.sales_sr_invoice_parts where id=p_request_id for update;
 if not found or v_h.status<>'pending' then raise exception 'Split invoice request is no longer pending'; end if;
 if v_h.requested_by=auth.uid() then raise exception 'Cannot approve own request'; end if;
 select * into v_o from public.sales_orders where id=v_h.sales_order_id for update;
 if v_o.sales_flow_type<>'pre_order' or v_o.status='cancelled' or v_o.sales_invoice_no is not null then
  raise exception 'SR is no longer eligible for additional invoicing';
 end if;
 if p_approve then
  if exists(select 1 from public.sales_orders so where upper(btrim(coalesce(so.invoice_no,'')))=upper(v_h.invoice_no)
     or upper(btrim(coalesce(so.sales_invoice_no,'')))=upper(v_h.invoice_no)
     or upper(btrim(coalesce(so.order_no,'')))=upper(v_h.invoice_no)
     or upper(btrim(coalesce(so.sr_no,'')))=upper(v_h.invoice_no)) then
     raise exception 'Invoice number already in use';
  end if;
  select count(*) into v_qty_bad from public.sales_sr_invoice_part_lines l
   left join public.sales_order_items i on i.id=l.sales_order_item_id
   left join public.item_tracking it on it.sales_order_item_id=i.id
   where l.invoice_part_id=v_h.id and
   (i.sales_order_id is distinct from v_h.sales_order_id
      or lower(coalesce(it.status,i.fulfillment_status,'ordered')) not in ('arrived','ready','delivered')
      or l.qty>i.qty);
  if v_qty_bad>0 then raise exception 'One or more SR items are no longer valid/ready'; end if;
  if exists(
   select 1 from public.sales_sr_invoice_part_lines il
   join public.sales_order_items si on si.id=il.sales_order_item_id
   where il.invoice_part_id=v_h.id
    and (select coalesce(sum(l.qty),0) from public.sales_sr_invoice_part_lines l
         join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
         where l.sales_order_item_id=si.id and h.status in ('pending','issued'))>si.qty
  ) then raise exception 'SR item has more than total quantity allocated to invoices'; end if;
  update public.sales_sr_invoice_parts
     set status='issued',reviewed_by=auth.uid(),reviewed_at=now(),issued_at=now(),
         review_note=nullif(left(btrim(coalesce(p_note,'')),2000),'')
     where id=v_h.id;
  insert into public.sales_document_events(sales_order_id,event_type,document_no,note,actor_user_id,metadata)
   values(v_h.sales_order_id,'invoice_issued',v_h.invoice_no,p_note,auth.uid(),
     jsonb_build_object('split_invoice_id',v_h.id,'invoice_type',v_h.invoice_type,
      'sales_category',v_h.sales_category,'total',v_h.invoice_total,
      'partial',true,'no_duplicate_sales_booking',true));
 else
  update public.sales_sr_invoice_parts
    set status='rejected',reviewed_by=auth.uid(),reviewed_at=now(),
        review_note=nullif(left(btrim(coalesce(p_note,'')),2000),'')
    where id=v_h.id;
 end if;
 return case when p_approve then 'issued' else 'rejected' end;
end
$function$;

create or replace function public.get_sr_split_invoice_detail(p_id uuid)
returns jsonb language plpgsql stable security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare v_h public.sales_sr_invoice_parts%rowtype; v_o public.sales_orders%rowtype;
begin
 select * into v_h from public.sales_sr_invoice_parts where id=p_id;
 if not found then return null; end if;
 select * into v_o from public.sales_orders where id=v_h.sales_order_id;
 if auth.uid() is null or not (
  v_o.sales_rep_id=auth.uid() or public.current_app_role() in ('manager','admin','super_admin')
 ) then raise exception 'Not allowed to view invoice request'; end if;
 return jsonb_build_object('id',v_h.id,'sr_id',v_h.sales_order_id,'status',v_h.status,
  'invoice_no',v_h.invoice_no,'invoice_total',v_h.invoice_total,
  'lines',coalesce((select jsonb_agg(jsonb_build_object(
   'code',l.product_code,'name',l.item_name,'qty',l.qty,'amount',l.line_total) order by l.product_code)
   from public.sales_sr_invoice_part_lines l where l.invoice_part_id=v_h.id),'[]'::jsonb));
end
$function$;

-- Include new split requests in the existing Manager/Admin Approvals dashboard.
create or replace function public.get_pending_sr_conversion_requests()
returns table(request_id uuid,sales_order_id uuid,sr_no text,customer_name text,
 sales_rep_name text,invoice_type text,invoice_no text,sales_category text,
 request_note text,requested_by_name text,requested_by uuid,requested_at timestamptz)
language sql stable security definer set search_path to 'public','auth','pg_temp'
as $function$
 select r.id,r.sales_order_id,coalesce(o.sr_no,o.order_no),
   c.name,coalesce(nullif(rep.display_name,''),o.sales_rep_name_snapshot,'Sales Rep'),
   r.invoice_type,r.invoice_no,r.sales_category,r.request_note,
   coalesce(nullif(requester.display_name,''),requester.email,'Sales'),
   r.requested_by,r.requested_at
 from public.sales_sr_conversion_requests r join public.sales_orders o on o.id=r.sales_order_id
 join public.customers c on c.id=o.customer_id
 left join public.app_users rep on rep.user_id=o.sales_rep_id
 left join public.app_users requester on requester.user_id=r.requested_by
 where r.status='pending' and public.current_app_role() in ('manager','admin','super_admin')
  and public.current_user_has_permission('sales_orders.convert_approve')
 union all
 select h.id,h.sales_order_id,coalesce(o.sr_no,o.order_no),
   c.name,coalesce(nullif(rep.display_name,''),o.sales_rep_name_snapshot,'Sales Rep'),
   h.invoice_type,h.invoice_no,h.sales_category,h.request_note,
   coalesce(nullif(requester.display_name,''),requester.email,'Sales'),
   h.requested_by,h.requested_at
 from public.sales_sr_invoice_parts h join public.sales_orders o on o.id=h.sales_order_id
 join public.customers c on c.id=o.customer_id
 left join public.app_users rep on rep.user_id=o.sales_rep_id
 left join public.app_users requester on requester.user_id=h.requested_by
 where h.status='pending' and public.current_app_role() in ('manager','admin','super_admin')
  and public.current_user_has_permission('sales_orders.convert_approve')
 order by requested_at desc;
$function$;

-- Prevent a subsequent legacy full invoice from double-invoicing a split SR.
create or replace function public.guard_sr_legacy_invoice_after_split()
returns trigger language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
begin
 if new.sales_invoice_no is not null and
    (tg_op='INSERT' or old.sales_invoice_no is distinct from new.sales_invoice_no)
    and exists(select 1 from public.sales_sr_invoice_parts h
               where h.sales_order_id=new.id and h.status in ('pending','issued')) then
  raise exception 'This SR uses multiple TK/RK invoices. Manage each linked invoice in Document Flow.';
 end if;
 return new;
end
$function$;
drop trigger if exists trg_guard_sr_legacy_invoice_after_split on public.sales_orders;
create trigger trg_guard_sr_legacy_invoice_after_split
 before insert or update of sales_invoice_no on public.sales_orders
 for each row execute function public.guard_sr_legacy_invoice_after_split();

revoke all on function public.submit_sr_split_invoice(uuid,text,text,text,jsonb,text) from public,anon;
revoke all on function public.review_sr_split_invoice(uuid,boolean,text) from public,anon;
revoke all on function public.get_sr_split_invoice_summary(uuid) from public,anon;
revoke all on function public.get_sr_split_invoice_detail(uuid) from public,anon;
grant execute on function public.submit_sr_split_invoice(uuid,text,text,text,jsonb,text) to authenticated;
grant execute on function public.review_sr_split_invoice(uuid,boolean,text) to authenticated;
grant execute on function public.get_sr_split_invoice_summary(uuid) to authenticated;
grant execute on function public.get_sr_split_invoice_detail(uuid) to authenticated;
