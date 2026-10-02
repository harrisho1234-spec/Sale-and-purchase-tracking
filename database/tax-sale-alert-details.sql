-- Expand Tax Sale alerts with product thumbnail and review details.

CREATE OR REPLACE FUNCTION public.get_tax_sale_alerts(p_status text DEFAULT 'open'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text;
  v_result jsonb;
begin
  select role into v_role
  from public.app_users
  where user_id=auth.uid() and active=true;

  if v_role<>'super_admin' then
    raise exception 'Super Admin access required';
  end if;

  with alerts as (
    select
      a.id,
      'direct'::text as alert_type,
      a.sales_order_id,
      a.product_id,
      null::uuid as declared_product_id,
      a.product_code_snapshot as code,
      a.item_name_snapshot as item_name,
      a.customer_name_snapshot as customer_name,
      a.sales_rep_name_snapshot as sales_rep_name,
      a.order_no,
      a.invoice_no,
      a.order_date,
      a.qty,
      null::text as set_status,
      0::integer as complete_sets,
      '[]'::jsonb as components,
      a.sold_at,
      a.alert_status,
      coalesce(b.on_hand,0) as on_hand,
      coalesce(b.available,0) as available,
      coalesce(b.locations,'[]'::jsonb) as locations,
      pc.image_url,
      pc.brand,
      pc.class as product_class,
      pc.tax_group_or_set,
      pc.tax_note,
      tp.tax_cost,
      tp.tax_sale_price,
      coalesce(tp.tax_currency,'USD') as tax_currency,
      tp.tax_pricing_note,
      pc.sales_price as normal_sales_price,
      pc.currency as normal_currency
    from public.tax_item_sale_alerts a
    left join public.inventory_product_tax_balance b on b.product_id=a.product_id
    left join public.product_catalog pc on pc.id=a.product_id
    left join public.product_tax_pricing tp on tp.product_id=a.product_id
    where p_status is null
       or trim(lower(p_status)) in ('','all')
       or a.alert_status=trim(lower(p_status))

    union all

    select
      s.id,
      'declared_set'::text,
      s.sales_order_id,
      s.declared_product_id,
      s.declared_product_id,
      s.declared_code_snapshot,
      s.declared_name_snapshot,
      s.customer_name_snapshot,
      s.sales_rep_name_snapshot,
      s.order_no,
      s.invoice_no,
      s.order_date,
      s.total_component_qty,
      s.set_status,
      s.complete_sets,
      s.component_summary,
      s.sold_at,
      s.alert_status,
      coalesce(b.on_hand,0),
      coalesce(b.available,0),
      coalesce(b.locations,'[]'::jsonb),
      pc.image_url,
      pc.brand,
      pc.class,
      pc.tax_group_or_set,
      pc.tax_note,
      tp.tax_cost,
      tp.tax_sale_price,
      coalesce(tp.tax_currency,'USD'),
      tp.tax_pricing_note,
      pc.sales_price,
      pc.currency
    from public.tax_declared_set_sale_alerts s
    left join public.inventory_product_tax_balance b on b.product_id=s.declared_product_id
    left join public.product_catalog pc on pc.id=s.declared_product_id
    left join public.product_tax_pricing tp on tp.product_id=s.declared_product_id
    where p_status is null
       or trim(lower(p_status)) in ('','all')
       or s.alert_status=trim(lower(p_status))
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id',id,
        'alert_type',alert_type,
        'sales_order_id',sales_order_id,
        'product_id',product_id,
        'declared_product_id',declared_product_id,
        'code',code,
        'item_name',item_name,
        'customer_name',customer_name,
        'sales_rep_name',sales_rep_name,
        'order_no',order_no,
        'invoice_no',invoice_no,
        'order_date',order_date,
        'qty',qty,
        'set_status',set_status,
        'complete_sets',complete_sets,
        'components',components,
        'sold_at',sold_at,
        'alert_status',alert_status,
        'on_hand',on_hand,
        'available',available,
        'locations',locations,
        'image_url',image_url,
        'brand',brand,
        'product_class',product_class,
        'tax_group_or_set',tax_group_or_set,
        'tax_note',tax_note,
        'tax_cost',tax_cost,
        'tax_sale_price',tax_sale_price,
        'tax_currency',tax_currency,
        'tax_pricing_note',tax_pricing_note,
        'normal_sales_price',normal_sales_price,
        'normal_currency',normal_currency
      )
      order by sold_at desc,id desc
    ),
    '[]'::jsonb
  )
  into v_result
  from alerts;

  return v_result;
end;
$function$
;
