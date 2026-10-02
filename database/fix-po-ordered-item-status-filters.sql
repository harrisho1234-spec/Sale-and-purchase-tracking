-- Fix Procurement > PO Ordered Items status filtering.
-- Historical/Reconciled PO items are excluded from the live ordered-items list.
-- Current live item statuses are aligned to their PO header where item status was still the default 'placed'.

update public.supplier_po_items i
set procurement_status=p.status,
    updated_at=now()
from public.supplier_pos p
where p.id=i.supplier_po_id
  and coalesce(i.historical_stock_reconciled,false)=false
  and coalesce(i.procurement_status,'placed')='placed'
  and lower(coalesce(p.status,'placed')) in ('production','shipping','arrived','closed','complete','completed','delivered');

create or replace function public.get_sales_po_ordered_items()
returns table(
  po_id uuid,
  po_number text,
  po_pending_reference text,
  vendor_name text,
  order_date date,
  po_status text,
  estimated_arrival date,
  actual_arrival date,
  item_id uuid,
  product_id uuid,
  product_code text,
  item_name text,
  qty numeric,
  item_status text,
  image_url text,
  brand text,
  product_class text,
  allocated_qty numeric,
  unallocated_qty numeric,
  allocations jsonb,
  item_created_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=public.current_app_role();
begin
  if v_role not in ('sales','stock_controller','manager','admin','super_admin') then
    raise exception 'Sales / Stock / Manager access required';
  end if;

  return query
  select
    p.id,p.po_number,p.po_pending_reference,p.vendor_name,p.order_date,p.status,
    p.estimated_arrival,p.actual_arrival,
    i.id,i.product_id,i.product_code_snapshot,i.item_name_snapshot,i.qty,
    coalesce(i.procurement_status,p.status,'placed'),
    coalesce(i.image_url_snapshot,pc.image_url),pc.brand,pc.class,
    coalesce(a.allocated_qty,0),
    greatest(coalesce(i.qty,0)-coalesce(a.allocated_qty,0),0),
    coalesce(a.allocations,'[]'::jsonb),
    i.created_at
  from public.supplier_po_items i
  join public.supplier_pos p on p.id=i.supplier_po_id
  left join public.product_catalog pc on pc.id=i.product_id
  left join lateral (
    select
      coalesce(sum(x.qty_allocated),0)::numeric as allocated_qty,
      coalesce(
        jsonb_agg(
          jsonb_build_object(
            'sales_order_id',x.sales_order_id,
            'customer_id',x.customer_id,
            'customer_name',x.customer_name,
            'customer_code',x.customer_code,
            'order_ref',x.order_ref,
            'sales_rep_name',x.sales_rep_name,
            'qty_allocated',x.qty_allocated
          )
          order by x.customer_name nulls last,x.order_ref
        ),
        '[]'::jsonb
      ) as allocations
    from (
      select
        so.id as sales_order_id,
        c.id as customer_id,
        c.name as customer_name,
        c.customer_code,
        coalesce(
          nullif(so.sales_invoice_no,''),
          nullif(so.sr_no,''),
          nullif(so.invoice_no,''),
          nullif(so.order_no,''),
          'Order'
        ) as order_ref,
        so.sales_rep_name_snapshot as sales_rep_name,
        sum(f.qty_allocated)::numeric as qty_allocated
      from public.fulfillment_links f
      join public.sales_order_items soi on soi.id=f.sales_order_item_id
      join public.sales_orders so on so.id=soi.sales_order_id
      left join public.customers c on c.id=so.customer_id
      where f.supplier_po_item_id=i.id
      group by
        so.id,c.id,c.name,c.customer_code,
        so.sales_invoice_no,so.sr_no,so.invoice_no,so.order_no,
        so.sales_rep_name_snapshot
    ) x
  ) a on true
  where coalesce(i.historical_stock_reconciled,false)=false
    and lower(coalesce(p.status,'placed'))<>'cancelled'
  order by
    coalesce(p.order_date,p.created_at::date) desc,
    p.created_at desc,
    coalesce(i.sort_order,2147483647),
    i.created_at;
end;
$function$;
