-- User-facing terminology: use Code instead of SKU.\n-- Internal field names and legacy import aliases remain unchanged for compatibility.\n\nCREATE OR REPLACE FUNCTION public.bulk_create_supplier_pos(p_pos jsonb, p_create_new_products boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text;
  v_po jsonb;
  v_item jsonb;
  v_po_id uuid;
  v_product_id uuid;
  v_product_result jsonb;
  v_po_number text;
  v_vendor text;
  v_currency text;
  v_order_date date;
  v_eta date;
  v_agent text;
  v_code text;
  v_name text;
  v_qty numeric;
  v_cost numeric;
  v_ship numeric;
  v_po_count integer:=0;
  v_item_count integer:=0;
  v_new_products integer:=0;
  v_po_numbers text[]:='{}';
begin
  v_role:=public.current_app_role();
  if v_role not in ('admin','super_admin') then
    raise exception 'Admin or Super Admin access required';
  end if;

  if p_pos is null or jsonb_typeof(p_pos)<>'array' or jsonb_array_length(p_pos)=0 then
    raise exception 'No Supplier POs were supplied';
  end if;

  if exists(
    select 1
    from (
      select lower(trim(x->>'po_number')) as po_number,count(*) as c
      from jsonb_array_elements(p_pos) x
      group by lower(trim(x->>'po_number'))
      having count(*)>1
    ) d
  ) then
    raise exception 'The import contains a duplicate Official PO Number';
  end if;

  for v_po in select value from jsonb_array_elements(p_pos)
  loop
    v_po_number:=trim(coalesce(v_po->>'po_number',''));
    v_vendor:=trim(coalesce(v_po->>'vendor_name',''));
    v_currency:=upper(trim(coalesce(v_po->>'currency','USD')));
    v_agent:=nullif(trim(coalesce(v_po->>'shipping_agent','')),'');
    v_order_date:=coalesce(nullif(v_po->>'order_date','')::date,current_date);
    v_eta:=nullif(v_po->>'estimated_arrival','')::date;

    if v_po_number='' then raise exception 'Every bulk-imported PO requires an Official PO Number'; end if;
    if v_vendor='' then raise exception 'Vendor / Supplier is required for PO %',v_po_number; end if;
    if jsonb_typeof(v_po->'items')<>'array' or jsonb_array_length(v_po->'items')=0 then
      raise exception 'PO % has no item rows',v_po_number;
    end if;
    if exists(select 1 from public.supplier_pos p where lower(trim(coalesce(p.po_number,'')))=lower(v_po_number)) then
      raise exception 'PO % already exists in the system',v_po_number;
    end if;

    insert into public.supplier_pos(
      po_number,vendor_name,order_date,currency,shipping_agent,estimated_arrival,
      status,notes,created_by,po_pending_reference
    ) values(
      v_po_number,v_vendor,v_order_date,v_currency,v_agent,v_eta,
      'placed',null,auth.uid(),null
    )
    returning id into v_po_id;

    v_po_count:=v_po_count+1;
    v_po_numbers:=array_append(v_po_numbers,v_po_number);

    for v_item in select value from jsonb_array_elements(v_po->'items')
    loop
      v_code:=trim(coalesce(v_item->>'code',''));
      v_name:=trim(coalesce(v_item->>'item_name',''));
      v_qty:=coalesce(nullif(v_item->>'qty','')::numeric,0);
      v_cost:=coalesce(nullif(v_item->>'unit_cost','')::numeric,0);
      v_ship:=coalesce(nullif(v_item->>'shipping_cost','')::numeric,0);

      if v_code='' then raise exception 'PO % contains an item without Code',v_po_number; end if;
      if v_qty<=0 then raise exception 'PO % / % must have QTY greater than zero',v_po_number,v_code; end if;
      if v_cost<0 or v_ship<0 then raise exception 'PO % / % has a negative cost or shipping value',v_po_number,v_code; end if;

      select p.id,p.item_name
        into v_product_id,v_name
      from public.product_catalog p
      where lower(trim(p.code))=lower(v_code)
      order by p.active desc,p.created_at asc
      limit 1;

      if v_product_id is not null then
        update public.product_catalog p
        set active=true,
            manual_override=true,
            source_system='app_created',
            source_row_key='app:'||lower(trim(p.code))
        where p.id=v_product_id
          and p.active=false
          and (
            coalesce(p.source_row_key,'') like 'app:%'
            or coalesce(p.source_system,'') in ('app_created','app_products_sheet')
          );
      else
        v_name:=trim(coalesce(v_item->>'item_name',''));
        if v_name='' then
          raise exception 'New Code % in PO % needs an Item Name',v_code,v_po_number;
        end if;

        if coalesce(p_create_new_products,true) then
          v_product_result:=public.ensure_app_product_from_procurement(
            v_code,v_name,v_currency,v_vendor,v_cost,v_ship,null
          );
          v_product_id:=nullif(v_product_result->>'product_id','')::uuid;
          if coalesce((v_product_result->>'created')::boolean,false) then
            v_new_products:=v_new_products+1;
          end if;
        end if;
      end if;

      if v_name='' then raise exception 'Item Name is missing for % in PO %',v_code,v_po_number; end if;

      insert into public.supplier_po_items(
        supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,
        qty,unit_cost,shipping_cost,shipping_currency,procurement_status,sort_order,
        image_url_snapshot
      )
      select
        v_po_id,v_product_id,v_code,v_name,
        v_qty,v_cost,v_ship,'USD','placed',v_item_count+1,
        p.image_url
      from (select 1) x
      left join public.product_catalog p on p.id=v_product_id;

      v_item_count:=v_item_count+1;
      v_product_id:=null;
      v_product_result:=null;
    end loop;
  end loop;

  return jsonb_build_object(
    'created_po_count',v_po_count,
    'created_item_count',v_item_count,
    'new_product_count',v_new_products,
    'po_numbers',to_jsonb(v_po_numbers)
  );
end;
$function$
;\n\nCREATE OR REPLACE FUNCTION public.ensure_app_product_from_procurement(p_code text, p_item_name text, p_po_currency text DEFAULT 'USD'::text, p_vendor_name text DEFAULT NULL::text, p_unit_cost numeric DEFAULT 0, p_shipping_cost_usd numeric DEFAULT 0, p_image_url text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text:=public.current_app_role();
  v_code text:=trim(coalesce(p_code,''));
  v_name text:=trim(coalesce(p_item_name,''));
  v_currency text:=upper(trim(coalesce(p_po_currency,'USD')));
  v_product public.product_catalog%rowtype;
  v_created boolean:=false;
  v_app_owned boolean:=false;
  v_note text;
begin
  if v_role not in ('admin','super_admin') then
    raise exception 'Admin or Super Admin access required';
  end if;
  if v_code='' then raise exception 'Product Code is required'; end if;
  if v_name='' then raise exception 'Item Name is required'; end if;
  if coalesce(p_unit_cost,0)<0 or coalesce(p_shipping_cost_usd,0)<0 then
    raise exception 'Cost and shipping cannot be negative';
  end if;
  if v_currency not in ('USD','EUR','CNY','GBP') then
    raise exception 'Unsupported PO currency';
  end if;

  select * into v_product
  from public.product_catalog
  where lower(trim(code))=lower(v_code)
  limit 1
  for update;

  if found then
    v_app_owned :=
      coalesce(v_product.source_row_key,'') like 'app:%'
      or coalesce(v_product.source_system,'') in ('app_created','app_products_sheet');

    if v_product.active=false and v_app_owned then
      update public.product_catalog
      set item_name=v_name,
          image_url=coalesce(nullif(trim(coalesce(p_image_url,'')),''),image_url),
          active=true,
          manual_override=true,
          source_system='app_created',
          source_row_key='app:'||lower(v_code)
      where id=v_product.id
      returning * into v_product;
    end if;

    return jsonb_build_object(
      'product_id',v_product.id,
      'created',false,
      'reactivated',v_product.active,
      'code',v_product.code,
      'item_name',v_product.item_name,
      'image_url',v_product.image_url,
      'active',v_product.active,
      'app_owned',v_app_owned
    );
  end if;

  insert into public.product_catalog(
    code,item_name,brand,class,image_url,stock_qty,sales_price,currency,
    active,manual_override,source_system,source_row_key,description
  )
  values(
    v_code,v_name,null,null,nullif(trim(coalesce(p_image_url,'')),''),
    0,0,'USD',true,true,'app_created','app:'||lower(v_code),
    'Created from Procurement / Supplier PO'
  )
  returning * into v_product;

  v_created:=true;

  v_note:=case
    when v_currency='USD'
      then 'Created from Procurement. PO unit cost and shipping are both USD.'
    else 'Created from Procurement. Unit cost follows PO currency; PO shipping is stored separately in USD.'
  end;

  insert into public.product_costs(
    product_id,vendor_name,cost_currency,unit_cost,shipping_cost,landed_cost,notes,updated_at
  )
  values(
    v_product.id,
    nullif(trim(coalesce(p_vendor_name,'')),''),
    v_currency,
    coalesce(p_unit_cost,0),
    case when v_currency='USD' then coalesce(p_shipping_cost_usd,0) else 0 end,
    case
      when v_currency='USD' then coalesce(p_unit_cost,0)+coalesce(p_shipping_cost_usd,0)
      else coalesce(p_unit_cost,0)
    end,
    v_note,
    now()
  )
  on conflict (product_id) do nothing;

  return jsonb_build_object(
    'product_id',v_product.id,
    'created',v_created,
    'reactivated',false,
    'code',v_product.code,
    'item_name',v_product.item_name,
    'image_url',v_product.image_url,
    'active',v_product.active,
    'app_owned',true
  );
end;
$function$
;\n\nCREATE OR REPLACE FUNCTION public.historical_reconstruction_candidates_internal()
 RETURNS TABLE(legacy_history_id bigint, movement_date date, movement_type text, reference_no text, counterparty text, product_code text, legacy_qty numeric, target_type text, target_header_id uuid, target_item_id uuid, target_document_no text, target_party text, target_qty numeric, target_remaining_qty numeric, candidate_count integer, grouped_legacy_qty numeric, classification text, match_method text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
with cfg as (
  select boundary_date from public.historical_reconstruction_config where id=true
),
linked as (
  select legacy_history_id from public.historical_reconstruction_links
),
live_sales as (
  select reference_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.stock_movements
  where affects_balance=true
    and movement_type='sale_delivery'
    and reference_type='sales_order_item'
    and reference_item_id is not null
  group by reference_item_id
),
hist_sales as (
  select sales_order_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.customer_fulfillment_reconciliations
  where voided_at is null
  group by sales_order_item_id
),
sales_docs as (
  select distinct
    o.id header_id,
    i.id item_id,
    r.ref_norm,
    public.normalize_history_match_text(coalesce(pc.code,i.product_code_snapshot)) sku_norm,
    coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,''),'Sales Order') document_no,
    c.name party,
    i.qty target_qty,
    greatest(i.qty-coalesce(ls.qty,0)-coalesce(hs.qty,0),0)::numeric remaining_qty
  from public.sales_orders o
  join public.sales_order_items i on i.sales_order_id=o.id
  join public.customers c on c.id=o.customer_id
  left join public.product_catalog pc on pc.id=i.product_id
  left join live_sales ls on ls.item_id=i.id
  left join hist_sales hs on hs.item_id=i.id
  cross join lateral (
    select distinct public.normalize_history_match_text(x) ref_norm
    from unnest(array[o.sales_invoice_no,o.invoice_no,o.order_no,o.sr_no]) x
    where nullif(trim(coalesce(x,'')),'') is not null
  ) r
  where i.line_kind='product'
    and i.source_type='stock'
    and coalesce(o.status,'')<>'cancelled'
    and coalesce(i.fulfillment_status,'')<>'cancelled'
),
sales_h as (
  select h.*
  from public.stock_legacy_history h,cfg
  where h.movement_type='out'
    and h.movement_date<=cfg.boundary_date
),
sales_pairs as (
  select
    h.id legacy_history_id,
    d.header_id,d.item_id,d.document_no,d.party,d.target_qty,d.remaining_qty
  from sales_h h
  join sales_docs d
    on d.ref_norm=public.normalize_history_match_text(h.reference_no)
   and d.sku_norm=public.normalize_history_match_text(h.product_code_snapshot)
),
sales_h_stats as (
  select h.id legacy_history_id,
         count(distinct p.item_id)::int candidate_count,
         min(p.header_id::text)::uuid header_id,
         min(p.item_id::text)::uuid item_id,
         min(p.document_no) document_no,
         min(p.party) party,
         min(p.target_qty) target_qty,
         min(p.remaining_qty) remaining_qty
  from sales_h h
  left join sales_pairs p on p.legacy_history_id=h.id
  group by h.id
),
sales_target_totals as (
  select s.item_id,coalesce(sum(h.qty),0)::numeric grouped_qty
  from sales_h_stats s
  join sales_h h on h.id=s.legacy_history_id
  where s.candidate_count=1
    and not exists(select 1 from linked l where l.legacy_history_id=s.legacy_history_id)
  group by s.item_id
),
sales_rows as (
  select
    h.id,h.movement_date,h.movement_type,h.reference_no,h.counterparty,h.product_code_snapshot,h.qty,
    'sales_delivery'::text target_type,
    s.header_id,s.item_id,s.document_no,s.party,s.target_qty,s.remaining_qty,s.candidate_count,
    coalesce(t.grouped_qty,0)::numeric grouped_qty,
    case
      when l.legacy_history_id is not null then 'applied'
      when s.candidate_count=0 then 'unmatched'
      when s.candidate_count>1 then 'conflict'
      when coalesce(s.remaining_qty,0)<=0 then 'already_reconciled'
      when h.qty<>trunc(h.qty) then 'conflict'
      when coalesce(t.grouped_qty,0)<=coalesce(s.remaining_qty,0) then 'safe'
      else 'conflict'
    end classification,
    'exact reference + Code'::text match_method
  from sales_h h
  join sales_h_stats s on s.legacy_history_id=h.id
  left join sales_target_totals t on t.item_id=s.item_id
  left join linked l on l.legacy_history_id=h.id
),
live_po as (
  select reference_item_id item_id,coalesce(sum(qty),0)::numeric qty
  from public.stock_movements
  where affects_balance=true
    and movement_type='po_receipt'
    and reference_type='supplier_po_item'
    and reference_item_id is not null
  group by reference_item_id
),
po_docs as (
  select distinct
    p.id header_id,
    i.id item_id,
    r.ref_norm,
    public.normalize_history_match_text(coalesce(pc.code,i.product_code_snapshot)) sku_norm,
    coalesce(p.po_number,p.po_pending_reference,'PO') document_no,
    p.vendor_name party,
    i.qty target_qty,
    greatest(i.qty-coalesce(lp.qty,0)-coalesce(i.historical_stock_reconciled_qty,0),0)::numeric remaining_qty
  from public.supplier_pos p
  join public.supplier_po_items i on i.supplier_po_id=p.id
  left join public.product_catalog pc on pc.id=i.product_id
  left join live_po lp on lp.item_id=i.id
  cross join lateral (
    select distinct public.normalize_history_match_text(x) ref_norm
    from unnest(array[p.po_number,p.po_pending_reference]) x
    where nullif(trim(coalesce(x,'')),'') is not null
  ) r
  where i.inventory_tracking_enabled=true
    and i.product_id is not null
),
po_h as (
  select h.*
  from public.stock_legacy_history h,cfg
  where h.movement_type='in'
    and h.movement_date<=cfg.boundary_date
),
po_pairs as (
  select h.id legacy_history_id,d.header_id,d.item_id,d.document_no,d.party,d.target_qty,d.remaining_qty
  from po_h h
  join po_docs d
    on d.ref_norm=public.normalize_history_match_text(h.reference_no)
   and d.sku_norm=public.normalize_history_match_text(h.product_code_snapshot)
),
po_h_stats as (
  select h.id legacy_history_id,
         count(distinct p.item_id)::int candidate_count,
         min(p.header_id::text)::uuid header_id,
         min(p.item_id::text)::uuid item_id,
         min(p.document_no) document_no,
         min(p.party) party,
         min(p.target_qty) target_qty,
         min(p.remaining_qty) remaining_qty
  from po_h h
  left join po_pairs p on p.legacy_history_id=h.id
  group by h.id
),
po_target_totals as (
  select s.item_id,coalesce(sum(h.qty),0)::numeric grouped_qty
  from po_h_stats s
  join po_h h on h.id=s.legacy_history_id
  where s.candidate_count=1
    and not exists(select 1 from linked l where l.legacy_history_id=s.legacy_history_id)
  group by s.item_id
),
po_rows as (
  select
    h.id,h.movement_date,h.movement_type,h.reference_no,h.counterparty,h.product_code_snapshot,h.qty,
    'po_receipt'::text target_type,
    s.header_id,s.item_id,s.document_no,s.party,s.target_qty,s.remaining_qty,s.candidate_count,
    coalesce(t.grouped_qty,0)::numeric grouped_qty,
    case
      when l.legacy_history_id is not null then 'applied'
      when s.candidate_count=0 then 'unmatched'
      when s.candidate_count>1 then 'conflict'
      when coalesce(s.remaining_qty,0)<=0 then 'already_reconciled'
      when coalesce(t.grouped_qty,0)<=coalesce(s.remaining_qty,0) then 'safe'
      else 'conflict'
    end classification,
    'exact reference + Code'::text match_method
  from po_h h
  join po_h_stats s on s.legacy_history_id=h.id
  left join po_target_totals t on t.item_id=s.item_id
  left join linked l on l.legacy_history_id=h.id
),
return_docs as (
  select distinct
    r.id header_id,
    ri.id item_id,
    refs.ref_norm,
    public.normalize_history_match_text(coalesce(pc.code,ri.product_code_snapshot,soi.product_code_snapshot)) sku_norm,
    coalesce(r.cn_no,coalesce(nullif(o.sales_invoice_no,''),nullif(o.invoice_no,''),nullif(o.order_no,''),nullif(o.sr_no,'')),'Return') document_no,
    c.name party,
    ri.qty target_qty,
    greatest(ri.qty-coalesce(ri.historical_stock_reconciled_qty,0),0)::numeric remaining_qty
  from public.sales_returns r
  join public.sales_return_items ri on ri.sales_return_id=r.id
  join public.sales_order_items soi on soi.id=ri.sales_order_item_id
  join public.sales_orders o on o.id=soi.sales_order_id
  join public.customers c on c.id=r.customer_id
  left join public.product_catalog pc on pc.id=ri.product_id
  cross join lateral (
    select distinct public.normalize_history_match_text(x) ref_norm
    from unnest(array[r.cn_no,o.sales_invoice_no,o.invoice_no,o.order_no,o.sr_no]) x
    where nullif(trim(coalesce(x,'')),'') is not null
  ) refs
  where r.status<>'cancelled'
),
return_h as (
  select h.*
  from public.stock_legacy_history h,cfg
  where h.movement_type='return'
    and h.movement_date<=cfg.boundary_date
),
return_pairs as (
  select h.id legacy_history_id,d.header_id,d.item_id,d.document_no,d.party,d.target_qty,d.remaining_qty
  from return_h h
  join return_docs d
    on d.ref_norm=public.normalize_history_match_text(h.reference_no)
   and d.sku_norm=public.normalize_history_match_text(h.product_code_snapshot)
),
return_h_stats as (
  select h.id legacy_history_id,
         count(distinct p.item_id)::int candidate_count,
         min(p.header_id::text)::uuid header_id,
         min(p.item_id::text)::uuid item_id,
         min(p.document_no) document_no,
         min(p.party) party,
         min(p.target_qty) target_qty,
         min(p.remaining_qty) remaining_qty
  from return_h h
  left join return_pairs p on p.legacy_history_id=h.id
  group by h.id
),
return_target_totals as (
  select s.item_id,coalesce(sum(h.qty),0)::numeric grouped_qty
  from return_h_stats s
  join return_h h on h.id=s.legacy_history_id
  where s.candidate_count=1
    and not exists(select 1 from linked l where l.legacy_history_id=s.legacy_history_id)
  group by s.item_id
),
return_rows as (
  select
    h.id,h.movement_date,h.movement_type,h.reference_no,h.counterparty,h.product_code_snapshot,h.qty,
    'sales_return'::text target_type,
    s.header_id,s.item_id,s.document_no,s.party,s.target_qty,s.remaining_qty,s.candidate_count,
    coalesce(t.grouped_qty,0)::numeric grouped_qty,
    case
      when l.legacy_history_id is not null then 'applied'
      when s.candidate_count=0 then 'unmatched'
      when s.candidate_count>1 then 'conflict'
      when coalesce(s.remaining_qty,0)<=0 then 'already_reconciled'
      when coalesce(t.grouped_qty,0)<=coalesce(s.remaining_qty,0) then 'safe'
      else 'conflict'
    end classification,
    'exact reference + Code'::text match_method
  from return_h h
  join return_h_stats s on s.legacy_history_id=h.id
  left join return_target_totals t on t.item_id=s.item_id
  left join linked l on l.legacy_history_id=h.id
)
select id,movement_date,movement_type,reference_no,counterparty,product_code_snapshot,qty,
       target_type,header_id,item_id,document_no,party,target_qty,remaining_qty,candidate_count,grouped_qty,classification,match_method
from sales_rows
union all
select id,movement_date,movement_type,reference_no,counterparty,product_code_snapshot,qty,
       target_type,header_id,item_id,document_no,party,target_qty,remaining_qty,candidate_count,grouped_qty,classification,match_method
from po_rows
union all
select id,movement_date,movement_type,reference_no,counterparty,product_code_snapshot,qty,
       target_type,header_id,item_id,document_no,party,target_qty,remaining_qty,candidate_count,grouped_qty,classification,match_method
from return_rows
$function$
;\n\n