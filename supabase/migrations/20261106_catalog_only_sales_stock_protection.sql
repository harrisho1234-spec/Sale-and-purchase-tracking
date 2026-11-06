-- Catalog-only products are valid quotation/pre-order references but must
-- not be silently enabled as physically tracked stock lines.
create or replace function public.set_new_stock_sales_item_inventory_tracking()
returns trigger language plpgsql
set search_path to public,pg_temp
as $fn$
begin
 if new.legacy_source_key is null
    and new.source_type='stock'
    and coalesce(new.line_kind,'product')='product'
    and new.product_id is not null then
   new.inventory_tracking_enabled:=not exists(
     select 1 from public.product_catalog p
     where p.id=new.product_id and p.catalog_role='catalog_only'
   );
 end if;
 return new;
end $fn$;

create or replace function public.enable_inventory_tracking_for_sales_item(
 p_sales_order_item_id uuid)
returns void language plpgsql security definer
set search_path to public,auth,pg_temp
as $fn$
declare
  v_item public.sales_order_items%rowtype;
  v_order public.sales_orders%rowtype;
begin
  if not public.can_operate_inventory() then
    raise exception 'Stock Controller or Admin access required';
  end if;
  select * into v_item from public.sales_order_items
  where id=p_sales_order_item_id for update;
  if not found then raise exception 'Sales item not found. Refresh the Delivery Order.'; end if;
  select * into v_order from public.sales_orders
  where id=v_item.sales_order_id;
  if v_item.product_id is null then
    raise exception 'Cannot link to Stock: this Sales Order item has no matching catalog product. Ask Admin to correct the product code.';
  end if;
  if exists(select 1 from public.product_catalog p where p.id=v_item.product_id
       and p.catalog_role='catalog_only') then
    raise exception 'Cannot link to physical Stock: this is a Tong Lou Catalog Only reference code. Admin must verify and connect the proper official Stock Product to the Sales/DO item, or explicitly promote it before receiving or releasing stock.';
  end if;
  if coalesce(v_item.line_kind,'product')<>'product' then
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
end $fn$;
