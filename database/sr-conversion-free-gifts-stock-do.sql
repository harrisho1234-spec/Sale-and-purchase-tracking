-- Free gifts selected while preparing SR -> TK/RK.
-- A proposed gift is not part of stock or the original SR until another
-- Manager/Admin approves that invoice. On approval it becomes a $0 stock item
-- on the same SR, so the existing DO -> release -> stock OUT pipeline applies.
create table if not exists public.sales_sr_invoice_free_gifts (
 id uuid primary key default gen_random_uuid(),
 invoice_part_id uuid not null references public.sales_sr_invoice_parts(id) on delete restrict,
 product_id uuid not null references public.product_catalog(id) on delete restrict,
 product_code text not null,
 product_name text not null,
 product_image_url text,
 qty numeric not null check (qty > 0 and qty=trunc(qty) and qty <= 10000),
 unit_price numeric not null default 0 check (unit_price=0),
 sales_order_item_id uuid unique references public.sales_order_items(id) on delete restrict,
 proposed_at timestamptz not null default now(),
 unique (invoice_part_id,product_id)
);
create index if not exists sales_sr_invoice_free_gifts_invoice_idx
 on public.sales_sr_invoice_free_gifts(invoice_part_id);
alter table public.sales_sr_invoice_free_gifts enable row level security;
revoke all on public.sales_sr_invoice_free_gifts from public,anon,authenticated;
-- Never allow end-users to insert directly or bypass invoice approval.
-- Access is via the SECURITY DEFINER functions, like split invoice lines.

create or replace function public.submit_sr_split_invoice_with_gifts(
 p_order_id uuid,p_invoice_type text,p_invoice_no text,p_sales_category text,
 p_lines jsonb,p_gifts jsonb,p_note text default null
) returns uuid
language plpgsql security definer set search_path to 'public','auth','pg_temp'
as $fn$
declare
 v_invoice uuid;
 v_gift jsonb;
 v_product public.product_catalog%rowtype;
 v_qty numeric;
 v_product_id uuid;
begin
 if p_gifts is null or jsonb_typeof(p_gifts)<>'array' or jsonb_array_length(p_gifts)>40
 then raise exception 'Free gifts must be an array of up to 40 items'; end if;

 -- Enforce existing SR ownership, role permission, readiness, invoice-no
 -- uniqueness and invoice line quantity guards FIRST.
 v_invoice:=public.submit_sr_split_invoice(
   p_order_id,p_invoice_type,p_invoice_no,p_sales_category,p_lines,p_note
 );
 for v_gift in select value from jsonb_array_elements(p_gifts) loop
   if jsonb_typeof(v_gift)<>'object' then raise exception 'Invalid gift row'; end if;
   if coalesce(v_gift->>'product_id','')='' or
      coalesce(v_gift->>'qty','') !~ '^[0-9]+$' then
       raise exception 'Gift requires a catalog product and whole-number quantity';
   end if;
   v_product_id:=(v_gift->>'product_id')::uuid;
   v_qty:=(v_gift->>'qty')::numeric;
   if v_qty<1 or v_qty>10000 then raise exception 'Gift quantity must be between 1 and 10000'; end if;

   select * into v_product from public.product_catalog
   where id=v_product_id and active=true and archived_at is null;
   if not found then raise exception 'Free gift product is not active in Products'; end if;

   -- Price is always zero. Never trust a client-supplied cost/price or
   -- arbitrary name/code; snapshot the official catalog values.
   insert into public.sales_sr_invoice_free_gifts(
      invoice_part_id,product_id,product_code,product_name,product_image_url,qty,unit_price
   ) values(
      v_invoice,v_product.id,v_product.code,v_product.item_name,v_product.image_url,v_qty,0
   );
 end loop;
 return v_invoice;
end;
$fn$;

-- Internal-only helper, invoked by the independent approval RPC.
create or replace function public.finalize_sr_invoice_free_gifts(p_request_id uuid)
returns integer language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $fn$
declare
 g public.sales_sr_invoice_free_gifts%rowtype;
 v_invoice public.sales_sr_invoice_parts%rowtype;
 v_item uuid;v_count integer:=0;
begin
 select * into v_invoice from public.sales_sr_invoice_parts
 where id=p_request_id for update;
 if not found or v_invoice.status<>'pending' then
  raise exception 'Free gifts may only be finalized during pending invoice approval';
 end if;
 for g in select * from public.sales_sr_invoice_free_gifts
   where invoice_part_id=p_request_id for update
 loop
  if g.sales_order_item_id is not null then
   raise exception 'Gift was already converted to a stock-tracked Sales Order item';
  end if;

  if not exists(select 1 from public.product_catalog
      where id=g.product_id and active=true and archived_at is null) then
      raise exception 'Gift % is no longer an active catalog product',g.product_code;
  end if;

  insert into public.sales_order_items(
    sales_order_id,product_id,product_code_snapshot,item_name_snapshot,
    image_url_snapshot,qty,unit_price,discount_amount,line_total,source_type,
    fulfillment_status,notes,legacy_source_key,line_kind,inventory_tracking_enabled
  ) values(
    v_invoice.sales_order_id,g.product_id,g.product_code,g.product_name,
    g.product_image_url,g.qty,0,0,0,'stock',
    'ready','Free Gift ($0) added with TK/RK '||v_invoice.invoice_no||
             '. Request DO and release stock normally.',
    'sr-invoice-free-gift:'||g.id::text,'product',true
  ) returning id into v_item;

  update public.sales_sr_invoice_free_gifts
  set sales_order_item_id=v_item where id=g.id;

  -- Invoice printed/detail lines and stock/DO refer to the SAME Sales Order
  -- item ID; no duplicated sale or early stock decrement.
  insert into public.sales_sr_invoice_part_lines(
    invoice_part_id,sales_order_item_id,qty,unit_price,discount_amount,
    line_total,product_code,item_name
  ) values(
    p_request_id,v_item,g.qty,0,0,0,g.product_code,g.product_name
  );
  v_count:=v_count+1;
 end loop;
 return v_count;
end;
$fn$;

-- The finalization helper cannot be invoked directly by end-user roles.
revoke all on function public.finalize_sr_invoice_free_gifts(uuid)
 from public,anon,authenticated;

-- Extend the existing Manager approval within its transaction, BEFORE
-- status changes to issued. Errors roll back all changes atomically.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='review_sr_split_invoice';
 if v_sql is null then raise exception 'Existing split invoice review RPC is missing'; end if;
 if position('perform public.finalize_sr_invoice_free_gifts' in v_sql)=0 then
   if position('update public.sales_sr_invoice_parts' || E'\n' ||
       '     set status=''issued''' in v_sql)=0 then
     raise exception 'Unexpected approval RPC structure; refusing unsafe migration';
   end if;
   v_sql:=replace(v_sql,
     'update public.sales_sr_invoice_parts' || E'\n' ||
       '     set status=''issued''',
     'perform public.finalize_sr_invoice_free_gifts(p_request_id);'||E'\n  '||
     'update public.sales_sr_invoice_parts'||E'\n'||
       '     set status=''issued'''
   );
   execute v_sql;
 end if;
end $block$;

-- Keep gift proposal visible even when invoice is pending or rejected.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_sr_split_invoice_detail';
 if v_sql is null then raise exception 'Missing split invoice detail RPC'; end if;
 if position('''free_gifts''' in v_sql)=0 then
   v_sql:=replace(v_sql,
     '''invoice_total'',v_h.invoice_total,',
     '''invoice_total'',v_h.invoice_total,'||
     '''free_gifts'',coalesce((select jsonb_agg(jsonb_build_object('||
      '''code'',g.product_code,''name'',g.product_name,''qty'',g.qty,'||
      '''unit_price'',0,''amount'',0) order by g.product_code)'||
      ' from public.sales_sr_invoice_free_gifts g '||
      'where g.invoice_part_id=v_h.id),''[]''::jsonb),');
   execute v_sql;
 end if;
end $block$;

-- Visibility alongside existing TK/RK invoice lines.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql
 from pg_proc p join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_sr_split_invoice_summary';
 if v_sql is null then raise exception 'Missing split invoice summary RPC'; end if;
 if position('''free_gifts''' in v_sql)=0 then
  v_sql:=replace(v_sql,
    '''total'',h.invoice_total,''requested_at''',
    '''total'',h.invoice_total,'||
    '''free_gifts'',coalesce((select jsonb_agg(jsonb_build_object('||
    '''code'',g.product_code,''name'',g.product_name,''qty'',g.qty,''amount'',0)'||
    ' order by g.product_code) from public.sales_sr_invoice_free_gifts g '||
    'where g.invoice_part_id=h.id),''[]''::jsonb),''requested_at''');
  execute v_sql;
 end if;
end $block$;

revoke all on function public.submit_sr_split_invoice_with_gifts(uuid,text,text,text,jsonb,jsonb,text)
 from public,anon;
grant execute on function public.submit_sr_split_invoice_with_gifts(uuid,text,text,text,jsonb,jsonb,text)
 to authenticated;
