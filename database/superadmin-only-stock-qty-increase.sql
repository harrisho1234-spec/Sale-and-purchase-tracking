-- Dedicated Super Admin-only increase of existing product QTY.
-- Writes an auditable adjustment_in stock movement; no direct catalog stock_qty changes.
-- Normal PO receiving and customer returns are separate operations and remain available.
create or replace function public.superadmin_increase_product_qty(
 p_product_id uuid,
 p_location_id uuid,
 p_qty numeric,
 p_reason text,
 p_request_id uuid
) returns uuid language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
 v_id uuid;
 v_old public.stock_movements%rowtype;
 v_reason text := btrim(coalesce(p_reason,''));
 v_key text := 'superadmin-qty:'||coalesce(p_request_id::text,'');
 v_product public.product_catalog%rowtype;
begin
 if not public.is_super_admin() then
   raise exception 'Only the Super Admin may manually increase product QTY';
 end if;
 if p_product_id is null or p_location_id is null or p_request_id is null then
   raise exception 'Product, warehouse location and action ID are required';
 end if;
 if p_qty is null or p_qty<>trunc(p_qty) or p_qty<=0 or p_qty>1000000 then
   raise exception 'Enter a whole-number increase from 1 to 1000000';
 end if;
 if length(v_reason)<6 or length(v_reason)>1000 then
   raise exception 'Enter a meaningful reason (6–1000 characters)';
 end if;
 select * into v_product from public.product_catalog where id=p_product_id for share;
 if not found then raise exception 'Product not found. Create its Product Code first.'; end if;
 if coalesce(v_product.active,true)=false then
   raise exception 'Inactive product: reactivate the product before increasing QTY';
 end if;
 if not exists(select 1 from public.stock_locations where id=p_location_id and active=true) then
   raise exception 'Choose an active warehouse/showroom location';
 end if;

 -- Repeated requests with the same ID must never duplicate stock.
 perform pg_advisory_xact_lock(hashtextextended(v_key,0));
 select * into v_old from public.stock_movements where source_key=v_key for update;
 if found then
   if v_old.product_id<>p_product_id or v_old.to_location_id<>p_location_id
      or v_old.qty<>p_qty or v_old.created_by is distinct from auth.uid()
      or v_old.movement_type<>'adjustment_in'
      or v_old.reference_type<>'superadmin_qty_adjustment' then
     raise exception 'This action ID was already used for a different stock adjustment';
   end if;
   return v_old.id;
 end if;

 insert into public.stock_movements(
  movement_date,product_id,movement_type,qty,to_location_id,
  reference_type,reference_no,note,source_system,source_key,created_by,affects_balance
 ) values (
  current_date,p_product_id,'adjustment_in',p_qty,p_location_id,
  'superadmin_qty_adjustment',
  'SA-ADJ-'||to_char(current_date,'YYMMDD')||'-'||upper(left(p_request_id::text,8)),
  'Super Admin QTY Increase: '||v_reason,
  'superadmin_qty_adjustment',v_key,auth.uid(),true
 ) returning id into v_id;
 perform public.refresh_inventory_product_snapshot(p_product_id);
 return v_id;
end;
$function$;
revoke all on function public.superadmin_increase_product_qty(uuid,uuid,numeric,text,uuid)
  from public,anon;
grant execute on function public.superadmin_increase_product_qty(uuid,uuid,numeric,text,uuid)
  to authenticated;

-- Existing Quick Stock Action's manual Stock IN/Adjustment + bypassed role-specific
-- restrictions. Harden the existing RPC without changing its other flows.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='create_stock_movement'
   and pg_get_function_identity_arguments(p.oid) like 'p_product_id uuid, p_movement_type text,%';
 if v_sql is null then raise exception 'create_stock_movement RPC not found'; end if;
 if position('Only Super Admin can manually increase product QTY' in v_sql)>0 then return; end if;
 if position('if coalesce(p_qty,0)<=0 then' in v_sql)=0 then
   raise exception 'Unexpected create_stock_movement signature; stopping migration';
 end if;
 v_sql:=replace(
  v_sql,
  'if coalesce(p_qty,0)<=0 then',
  'if v_move_type in (''in'',''adjustment_in'') and not public.is_super_admin() then '||
  'raise exception ''Only Super Admin can manually increase product QTY. '||
  'Stock Controller should use Receive PO or Customer Return.''; end if;'||E'\n  '||
  'if coalesce(p_qty,0)<=0 then'
 );
 execute v_sql;
end
$block$;

-- Guard editing manual IN/Adjustment+ records so Admin cannot increase
-- them via movement-history edit RPC either.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='admin_update_stock_movement'
   and pg_get_function_identity_arguments(p.oid) like 'p_movement_id uuid, p_movement_date date,%';
 if v_sql is null then raise exception 'admin_update_stock_movement RPC not found'; end if;
 if position('Only Super Admin can alter a manual stock increase' in v_sql)>0 then return; end if;
 if position('if coalesce(p_qty,0)<=0 then' in v_sql)=0 then
   raise exception 'Unexpected admin_update_stock_movement signature';
 end if;
 v_sql:=replace(
  v_sql,
  'if coalesce(p_qty,0)<=0 then',
  'if not public.is_super_admin() and ('||
  'v_old.movement_type in (''in'',''adjustment_in'') or '||
  'p_movement_type in (''in'',''adjustment_in'')'||
  ') then raise exception ''Only Super Admin can alter a manual stock increase''; end if;'||
  E'\n  '||'if coalesce(p_qty,0)<=0 then'
 );
 execute v_sql;
end
$block$;
