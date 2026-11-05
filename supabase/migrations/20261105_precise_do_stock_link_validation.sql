-- Keep all existing permissions, product constraints and stock-history behavior.
-- Only clarify which catalog/Sales Order linkage is invalid so Stock users can
-- correct the right source record instead of receiving a misleading generic
-- error. Linking never creates or releases physical stock.
create or replace function public.enable_inventory_tracking_for_sales_item(
  p_sales_order_item_id uuid
)
returns void
language plpgsql
security definer
set search_path to public, auth, pg_temp
as $function$
declare
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
begin
  if not public.can_operate_inventory() then
    raise exception 'Stock Controller or Admin access required';
  end if;

  select * into v_item
  from public.sales_order_items
  where id=p_sales_order_item_id for update;
  if not found then raise exception 'Sales item not found. Refresh the Delivery Order.'; end if;

  select * into v_order
  from public.sales_orders
  where id=v_item.sales_order_id;

  if v_item.product_id is null then
    raise exception 'Cannot link to Stock: this Sales Order item has no matching catalog product. Ask Admin to correct the product code.';
  end if;
  if coalesce(v_item.line_kind,'product') <> 'product' then
    raise exception 'Cannot link to Stock: this is not a stock product line. Service and fee lines cannot be released from inventory.';
  end if;
  if coalesce(v_item.source_type,'') not in ('stock','pre_order') then
    raise exception 'Cannot link to Stock: Sales Order source type (%) is not stock/pre-order. Ask Admin to correct the original line.',
      coalesce(v_item.source_type,'missing');
  end if;
  if coalesce(v_order.status,'')='cancelled'
     or coalesce(v_item.fulfillment_status,'')='cancelled' then
    raise exception 'Cancelled items cannot be linked to inventory';
  end if;
  if lower(coalesce(v_item.fulfillment_status,'')) in ('delivered','installed') then
    raise exception 'This item is already marked Delivered. Historical delivered items should not be newly reserved.';
  end if;

  update public.sales_order_items
  set inventory_tracking_enabled=true,updated_at=now()
  where id=p_sales_order_item_id;

  perform public.sync_sales_item_status_with_stock(p_sales_order_item_id);
  perform public.refresh_inventory_product_snapshot(v_item.product_id);
end;
$function$;
