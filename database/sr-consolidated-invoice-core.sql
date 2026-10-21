-- Consolidated TK/RK: one invoice header for several SRs of exactly one customer.
-- Every existing sales_order_item_id continues to reference its ORIGINAL SR.
-- No new Sale, Payment, Deposit, DO or Stock OUT is booked by this feature.
create table if not exists public.sales_sr_invoice_sources (
 invoice_part_id uuid not null references public.sales_sr_invoice_parts(id) on delete restrict,
 sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
 linked_at timestamptz not null default now(),
 primary key(invoice_part_id,sales_order_id)
);
create index if not exists sales_sr_invoice_sources_sr_idx
 on public.sales_sr_invoice_sources(sales_order_id,invoice_part_id);
alter table public.sales_sr_invoice_sources enable row level security;
revoke all on public.sales_sr_invoice_sources from public,anon,authenticated;

insert into public.sales_sr_invoice_sources(invoice_part_id,sales_order_id)
select id,sales_order_id from public.sales_sr_invoice_parts
on conflict do nothing;

create or replace function public.register_sr_invoice_source()
returns trigger language plpgsql security definer set search_path to 'public','auth','pg_temp'
as $fn$
begin
 insert into public.sales_sr_invoice_sources(invoice_part_id,sales_order_id)
 values(new.id,new.sales_order_id);
 return new;
end $fn$;
drop trigger if exists register_sr_invoice_source_trg on public.sales_sr_invoice_parts;
create trigger register_sr_invoice_source_trg
 after insert on public.sales_sr_invoice_parts for each row
 execute function public.register_sr_invoice_source();

create or replace function public.validate_sr_invoice_source()
returns trigger language plpgsql security definer set search_path to 'public','auth','pg_temp'
as $fn$
declare v_original public.sales_orders%rowtype;v_candidate public.sales_orders%rowtype;
begin
 select o.* into v_original from public.sales_sr_invoice_parts h
 join public.sales_orders o on o.id=h.sales_order_id where h.id=new.invoice_part_id;
 select * into v_candidate from public.sales_orders where id=new.sales_order_id;
 if not found or v_candidate.sales_flow_type<>'pre_order'
  or v_candidate.status='cancelled' or v_candidate.sales_invoice_no is not null
 then raise exception 'Source must be an active, non-finalized SR';end if;
 if v_candidate.customer_id is distinct from v_original.customer_id then
  raise exception 'Cannot combine SRs belonging to different customers';end if;
 if v_candidate.currency is distinct from v_original.currency then
  raise exception 'Cannot combine SRs with different currencies';end if;
 return new;
end $fn$;
drop trigger if exists validate_sr_invoice_source_trg on public.sales_sr_invoice_sources;
create trigger validate_sr_invoice_source_trg
 before insert or update on public.sales_sr_invoice_sources
 for each row execute function public.validate_sr_invoice_source();

create or replace function public.validate_sr_invoice_line_source()
returns trigger language plpgsql security definer set search_path to 'public','auth','pg_temp'
as $fn$
begin
 if not exists (
   select 1 from public.sales_order_items i
   join public.sales_sr_invoice_sources src on src.sales_order_id=i.sales_order_id
   where i.id=new.sales_order_item_id and src.invoice_part_id=new.invoice_part_id
 ) then raise exception 'Invoice line must belong to one of its linked source SRs';end if;
 return new;
end $fn$;
drop trigger if exists validate_sr_invoice_line_source_trg on public.sales_sr_invoice_part_lines;
create trigger validate_sr_invoice_line_source_trg
 before insert or update of invoice_part_id,sales_order_item_id
 on public.sales_sr_invoice_part_lines
 for each row execute function public.validate_sr_invoice_line_source();

create or replace function public.get_sr_combination_candidates(p_primary_sr uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public','auth','pg_temp'
as $fn$
declare
 v_primary public.sales_orders%rowtype;v_role text:=public.current_app_role();
begin
 if v_role not in ('sales','manager','admin','super_admin')
  or not public.current_user_has_permission('sales_orders.convert_request')
 then raise exception 'Prepare SR to TK/RK permission required';end if;
 select * into v_primary from public.sales_orders where id=p_primary_sr;
 if not found or v_primary.sales_flow_type<>'pre_order' then
  raise exception 'Starting SR not found';end if;
 if v_role='sales' and v_primary.sales_rep_id is distinct from auth.uid() then
  raise exception 'Only assigned Sales may prepare this SR';end if;

 return jsonb_build_object(
  'customer_id',v_primary.customer_id,'currency',v_primary.currency,
  'customer_name',(select c.name from public.customers c where c.id=v_primary.customer_id),
  'candidates',coalesce((
    select jsonb_agg(jsonb_build_object(
      'id',o.id,'sr_no',coalesce(nullif(o.sr_no,''),o.order_no),
      'customer_id',o.customer_id,'currency',o.currency,
      'sales_rep_id',o.sales_rep_id,
      'order_discount',o.order_discount,
      'lines',(select coalesce(jsonb_agg(jsonb_build_object(
        'id',i.id,'code',i.product_code_snapshot,'name',i.item_name_snapshot,
        'image',i.image_url_snapshot,'qty',i.qty,'unit_price',i.unit_price,
        'line_total',i.line_total,
        'ready',lower(coalesce(it.status,i.fulfillment_status,'ordered')) in ('ready','arrived','delivered'),
        'issued_qty',coalesce((select sum(l.qty) from public.sales_sr_invoice_part_lines l
           join public.sales_sr_invoice_parts hdr on hdr.id=l.invoice_part_id
           where l.sales_order_item_id=i.id and hdr.status='issued'),0),
        'pending_qty',coalesce((select sum(l.qty) from public.sales_sr_invoice_part_lines l
           join public.sales_sr_invoice_parts hdr on hdr.id=l.invoice_part_id
           where l.sales_order_item_id=i.id and hdr.status='pending'),0)
      ) order by i.line_position nulls last,i.created_at),'[]'::jsonb)
       from public.sales_order_items i left join public.item_tracking it on it.sales_order_item_id=i.id
       where i.sales_order_id=o.id and coalesce(i.fulfillment_status,'')<>'cancelled'
       and coalesce(i.legacy_source_key,'') not like 'sr-invoice-free-gift:%')
    ) order by o.created_at desc)
    from public.sales_orders o
    where o.id<>p_primary_sr
      and o.customer_id=v_primary.customer_id and o.currency=v_primary.currency
      and o.sales_flow_type='pre_order'
      and o.status<>'cancelled' and o.sales_invoice_no is null
      and (v_role<>'sales' or o.sales_rep_id=auth.uid())
      and not exists(select 1 from public.sales_sr_conversion_requests legacy
        where legacy.sales_order_id=o.id and legacy.status in ('pending','approved'))
      and not exists(select 1 from public.sales_sr_invoice_sources src
        join public.sales_sr_invoice_parts inv on inv.id=src.invoice_part_id
        where src.sales_order_id=o.id and inv.status='pending')
      and exists(
        select 1 from public.sales_order_items i
        left join public.item_tracking it on it.sales_order_item_id=i.id
        where i.sales_order_id=o.id
          and lower(coalesce(it.status,i.fulfillment_status,'ordered')) in ('ready','arrived','delivered')
          and i.qty>coalesce((
            select sum(l.qty) from public.sales_sr_invoice_part_lines l
            join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
            where l.sales_order_item_id=i.id and h.status in ('pending','issued')),0)
          and coalesce(i.legacy_source_key,'') not like 'sr-invoice-free-gift:%'
      )
    limit 50
  ),'[]'::jsonb));
end $fn$;

create or replace function public.submit_sr_combined_invoice_with_gifts(
 p_primary_sr uuid,p_invoice_type text,p_invoice_no text,
 p_sales_category text,p_lines jsonb,p_gifts jsonb,p_note text default null
) returns uuid language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $fn$
declare
 v_primary public.sales_orders%rowtype;
 v_source public.sales_orders%rowtype;
 v_entry jsonb;v_parent_lines jsonb;
 v_header uuid;v_i record;v_qty numeric;v_used numeric;
 v_line_total numeric;v_line_discount numeric;v_total numeric:=0;
 v_sources uuid[];v_source_id uuid;v_seen integer;
 v_role text:=public.current_app_role();
begin
 if v_role not in ('sales','manager','admin','super_admin')
   or not public.current_user_has_permission('sales_orders.convert_request')
 then raise exception 'Prepare TK/RK permission required';end if;
 if jsonb_typeof(p_lines)<>'array' or jsonb_array_length(p_lines)<1
   or jsonb_array_length(p_lines)>100 then
  raise exception 'Select 1 to 100 invoice line quantities';end if;
 select * into v_primary from public.sales_orders where id=p_primary_sr;
 if not found then raise exception 'Starting SR not found';end if;
 -- Identify every source from actual SR line IDs, not from user-provided SR IDs.
 select array_agg(distinct so.id order by so.id) into v_sources
 from jsonb_array_elements(p_lines) e
 join public.sales_order_items i on i.id=nullif(e->>'item_id','')::uuid
 join public.sales_orders so on so.id=i.sales_order_id;
 if array_length(v_sources,1) is distinct from (
   select count(distinct i.sales_order_id)
   from jsonb_array_elements(p_lines) e join public.sales_order_items i
     on i.id=nullif(e->>'item_id','')::uuid
 ) or v_sources is null then
  raise exception 'Invoice includes invalid SR item IDs';end if;
 if not (p_primary_sr=any(v_sources)) then
  raise exception 'Select at least one item from the starting SR';end if;
 if cardinality(v_sources)>20 then raise exception 'Maximum 20 SRs per TK/RK invoice';end if;
 if (select count(*) from jsonb_array_elements(p_lines))<>(
  select count(distinct e->>'item_id') from jsonb_array_elements(p_lines) e
 ) then raise exception 'Same SR item selected more than once';end if;

 -- Lock every source order to serialize competing partial invoice requests.
 for v_source_id in select unnest(v_sources) order by 1 loop
  select * into v_source from public.sales_orders where id=v_source_id for update;
  if not found or v_source.sales_flow_type<>'pre_order' or v_source.status='cancelled'
      or v_source.sales_invoice_no is not null
  then raise exception 'Only active, non-finalized SRs may be combined';end if;
  if v_source.customer_id is distinct from v_primary.customer_id then
   raise exception 'All selected SRs must belong to the same Customer Database record';end if;
  if v_source.currency is distinct from v_primary.currency then
   raise exception 'Combined SRs must use the same currency';end if;
  if v_role='sales' and v_source.sales_rep_id is distinct from auth.uid() then
   raise exception 'Sales can combine only their assigned SRs. Ask a Manager to prepare this invoice.';end if;
  if exists(select 1 from public.sales_sr_conversion_requests cr
        where cr.sales_order_id=v_source_id and cr.status in ('approved','pending'))
  then raise exception 'SR % already has a legacy invoice conversion',coalesce(v_source.sr_no,v_source.order_no);end if;
  if exists(select 1 from public.sales_sr_invoice_sources src
     join public.sales_sr_invoice_parts hdr on hdr.id=src.invoice_part_id
     where src.sales_order_id=v_source_id and hdr.status='pending')
  then raise exception 'SR % already has a pending TK/RK request',coalesce(v_source.sr_no,v_source.order_no);end if;
 end loop;

 select coalesce(jsonb_agg(e.value),'[]'::jsonb) into v_parent_lines
 from jsonb_array_elements(p_lines) e(value)
 join public.sales_order_items i on i.id=(e.value->>'item_id')::uuid
 where i.sales_order_id=p_primary_sr;

 -- Reuse the vetted single-SR conversion, free gifts, numbering, role
 -- and price guards. All later writes roll back if ANY other source fails.
 v_header:=public.submit_sr_split_invoice_with_gifts(
   p_primary_sr,p_invoice_type,p_invoice_no,p_sales_category,v_parent_lines,
   coalesce(p_gifts,'[]'::jsonb),p_note
 );

 for v_source_id in select unnest(v_sources) where unnest<>p_primary_sr order by 1 loop
  insert into public.sales_sr_invoice_sources(invoice_part_id,sales_order_id)
  values(v_header,v_source_id);
 end loop;

 for v_entry in select value from jsonb_array_elements(p_lines) loop
  select i.id,i.sales_order_id,i.product_code_snapshot,i.item_name_snapshot,
    i.qty,i.unit_price,i.discount_amount,i.line_total,
    lower(coalesce(it.status,i.fulfillment_status,'ordered')) as item_status
  into v_i
  from public.sales_order_items i
  left join public.item_tracking it on it.sales_order_item_id=i.id
  where i.id=(v_entry->>'item_id')::uuid;
  if not found then raise exception 'SR product no longer exists';end if;
  if v_i.sales_order_id=p_primary_sr then continue;end if;
  if (v_entry->>'qty') !~ '^[0-9]+$' then
   raise exception 'Product % needs positive whole-number quantity',v_i.product_code_snapshot;end if;
  v_qty:=(v_entry->>'qty')::numeric;
  if v_qty<1 or v_qty>100000 then raise exception 'Invalid quantity for %',v_i.product_code_snapshot;end if;
  if v_i.item_status not in ('ready','arrived','delivered') then
   raise exception 'Product % is not Ready/Arrived yet',v_i.product_code_snapshot;end if;
  select coalesce(sum(l.qty),0) into v_used from public.sales_sr_invoice_part_lines l
  join public.sales_sr_invoice_parts hdr on hdr.id=l.invoice_part_id
  where l.sales_order_item_id=v_i.id and hdr.status in ('pending','issued');
  if v_qty+v_used>v_i.qty then
   raise exception 'Product % has only % uninvoiced quantity',v_i.product_code_snapshot,v_i.qty-v_used;end if;
  select * into v_source from public.sales_orders where id=v_i.sales_order_id;
  v_line_discount:=round(coalesce(v_i.discount_amount,0)*v_qty/v_i.qty,2);
  v_line_total:=round((
    coalesce(v_i.line_total,v_i.qty*v_i.unit_price-coalesce(v_i.discount_amount,0))
    -coalesce(v_source.order_discount,0)
      *coalesce(v_i.line_total,v_i.qty*v_i.unit_price-coalesce(v_i.discount_amount,0))
      /greatest((select sum(coalesce(ii.line_total,ii.qty*ii.unit_price-coalesce(ii.discount_amount,0)))
               from public.sales_order_items ii where ii.sales_order_id=v_i.sales_order_id),0.01)
  )*v_qty/v_i.qty,2);
  if v_used+v_qty=v_i.qty then
   v_line_total:=round((
    coalesce(v_i.line_total,v_i.qty*v_i.unit_price-coalesce(v_i.discount_amount,0))
    -coalesce(v_source.order_discount,0)
      *coalesce(v_i.line_total,v_i.qty*v_i.unit_price-coalesce(v_i.discount_amount,0))
      /greatest((select sum(coalesce(ii.line_total,ii.qty*ii.unit_price-coalesce(ii.discount_amount,0)))
               from public.sales_order_items ii where ii.sales_order_id=v_i.sales_order_id),0.01)
   ),2)-coalesce((
      select sum(l.line_total) from public.sales_sr_invoice_part_lines l
      join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id
      where l.sales_order_item_id=v_i.id and h.status in ('pending','issued')
   ),0);
  end if;
  if v_line_total<0 then raise exception 'Invalid invoice amount for %',v_i.product_code_snapshot;end if;
  insert into public.sales_sr_invoice_part_lines(
    invoice_part_id,sales_order_item_id,qty,unit_price,discount_amount,
    line_total,product_code,item_name
  ) values(
    v_header,v_i.id,v_qty,v_i.unit_price,v_line_discount,
    v_line_total,v_i.product_code_snapshot,v_i.item_name_snapshot
  );
  v_total:=v_total+v_line_total;
 end loop;
 update public.sales_sr_invoice_parts
 set invoice_total=invoice_total+v_total where id=v_header;

 insert into public.sales_document_events(
  sales_order_id,event_type,document_no,note,actor_user_id,metadata)
 select v_source_id,'invoice_conversion_requested',upper(btrim(p_invoice_no)),
   p_note,auth.uid(),jsonb_build_object(
    'split_invoice_id',v_header,'consolidated',true,
    'primary_sr_id',p_primary_sr,'source_sr_id',v_source_id)
 from unnest(v_sources) v_source_id where v_source_id<>p_primary_sr;

 return v_header;
end $fn$;

revoke all on function public.get_sr_combination_candidates(uuid)
 from public,anon;
revoke all on function public.submit_sr_combined_invoice_with_gifts(uuid,text,text,text,jsonb,jsonb,text)
 from public,anon;
grant execute on function public.get_sr_combination_candidates(uuid) to authenticated;
grant execute on function public.submit_sr_combined_invoice_with_gifts(uuid,text,text,text,jsonb,jsonb,text) to authenticated;
