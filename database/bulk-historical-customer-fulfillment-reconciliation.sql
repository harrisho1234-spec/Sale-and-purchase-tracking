-- Bulk Historical Customer Fulfillment reconciliation.
-- Uses the existing guarded single-item reconciliation and never posts a stock movement.

create or replace function public.reconcile_historical_customer_deliveries_batch(
  p_items jsonb,
  p_delivery_date date,
  p_stock_location_id uuid default null,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=coalesce(public.current_app_role(),'');
  v_item jsonb;
  v_id uuid;
  v_qty numeric;
  v_result_id uuid;
  v_results jsonb:='[]'::jsonb;
  v_success integer:=0;
  v_failed integer:=0;
begin
  if v_role not in ('admin','super_admin') then
    raise exception 'Admin or Super Admin access required';
  end if;
  if jsonb_typeof(coalesce(p_items,'[]'::jsonb))<>'array' then
    raise exception 'Expected an array of selected fulfillment items';
  end if;
  if jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>500 then
    raise exception 'Select between 1 and 500 fulfillment items';
  end if;
  if p_delivery_date is null then raise exception 'Historical delivery date is required'; end if;
  if p_delivery_date>current_date then raise exception 'Historical delivery date cannot be in the future'; end if;
  if (select count(distinct value->>'sales_order_item_id') from jsonb_array_elements(p_items))
     <> jsonb_array_length(p_items) then
    raise exception 'Duplicate or missing Sales item IDs in selection';
  end if;

  for v_item in select value from jsonb_array_elements(p_items)
  loop
    begin
      v_id:=(v_item->>'sales_order_item_id')::uuid;
      v_qty:=(v_item->>'qty')::numeric;
      v_result_id:=public.reconcile_historical_customer_delivery(
        v_id,v_qty,p_delivery_date,p_stock_location_id,p_note
      );
      v_success:=v_success+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'sales_order_item_id',v_id,'ok',true,'reconciliation_id',v_result_id
      ));
    exception when others then
      v_failed:=v_failed+1;
      v_results:=v_results||jsonb_build_array(jsonb_build_object(
        'sales_order_item_id',v_item->>'sales_order_item_id','ok',false,'error',sqlerrm
      ));
    end;
  end loop;

  return jsonb_build_object(
    'success_count',v_success,
    'failed_count',v_failed,
    'results',v_results
  );
end
$function$;

revoke all on function public.reconcile_historical_customer_deliveries_batch(jsonb,date,uuid,text) from public;
revoke all on function public.reconcile_historical_customer_deliveries_batch(jsonb,date,uuid,text) from anon;
grant execute on function public.reconcile_historical_customer_deliveries_batch(jsonb,date,uuid,text) to authenticated;
