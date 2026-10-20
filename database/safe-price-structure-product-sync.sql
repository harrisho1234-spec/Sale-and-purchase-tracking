-- Safe per-product Price Structure sync.
-- Existing product IDs and posted stock history are never replaced.
-- Legacy upsert(onConflict:'code') hit a BEFORE INSERT duplicate-code guard;
-- this function resolves normalized code first and UPDATEs by primary key instead.
create or replace function public.sync_price_structure_products_safe(p_products jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_row jsonb;
  v_existing public.product_catalog%rowtype;
  v_id uuid;
  v_code text;
  v_key text;
  v_action text;
  v_now timestamptz;
  v_created integer := 0;
  v_updated integer := 0;
  v_skipped integer := 0;
  v_conflicted integer := 0;
  v_failed integer := 0;
  v_results jsonb := '[]'::jsonb;
  v_reason text;
begin
  if auth.role() is distinct from 'service_role' then
    raise exception 'Service role required for product-sheet sync';
  end if;
  if p_products is null or jsonb_typeof(p_products)<>'array'
     or jsonb_array_length(p_products)<1 or jsonb_array_length(p_products)>150 then
    raise exception 'Expected 1–150 product records';
  end if;

  for v_row in select value from jsonb_array_elements(p_products)
  loop
    v_code := btrim(coalesce(v_row->>'code',''));
    v_action := null;
    v_reason := null;
    begin
      if v_code='' or length(v_code)>150 then
        v_action := 'conflict';
        v_reason := 'Missing or invalid product code';
      else
        v_key := lower(v_code);
        v_now := clock_timestamp();
        select * into v_existing from public.product_catalog
        where lower(btrim(code))=v_key for update;

        if found then
          v_id := v_existing.id;
          if coalesce(v_existing.manual_override,false) then
            v_action := 'skipped';
            v_reason := 'Product is protected by Manual Override';
          elsif not (
               (v_existing.source_system='price_structure_v3_private_push'
                 and lower(coalesce(v_existing.source_row_key,'')) = 'price:'||v_key)
               or (v_existing.source_system in ('app_products_sheet','app_created')
                 and lower(coalesce(v_existing.source_row_key,'')) = 'app:'||v_key)
             ) then
            v_action := 'conflict';
            v_reason := 'Product code belongs to another source; review manually';
          else
            update public.product_catalog set
              item_name=coalesce(nullif(btrim(v_row->>'item_name'),''),v_existing.item_name),
              brand=nullif(btrim(coalesce(v_row->>'brand','')),''),
              class=nullif(btrim(coalesce(v_row->>'class','')),''),
              description=nullif(btrim(coalesce(v_row->>'description','')),''),
              image_url=nullif(btrim(coalesce(v_row->>'image_url','')),''),
              sales_price=coalesce((v_row->>'sales_price')::numeric,0),
              currency='USD',
              source_last_synced_at=v_now,
              active=true,
              manual_override=false
            where id=v_id;
            -- NOTE: Do not update stock_qty, location, product ID, code,
            -- or existing product source ownership on updates.
            v_action := 'updated';
          end if;
        else
          -- Preserve established first-import behaviour for genuinely new codes.
          -- Initial stock (if present) is handled by existing inventory triggers.
          insert into public.product_catalog (
            code,item_name,brand,class,description,location,image_url,
            stock_qty,sales_price,currency,source_system,source_row_key,
            source_last_synced_at,active,manual_override
          ) values (
            v_code,coalesce(nullif(btrim(v_row->>'item_name'),''),v_code),
            nullif(btrim(coalesce(v_row->>'brand','')),''),
            nullif(btrim(coalesce(v_row->>'class','')),''),
            nullif(btrim(coalesce(v_row->>'description','')),''),
            nullif(btrim(coalesce(v_row->>'location','')),''),
            nullif(btrim(coalesce(v_row->>'image_url','')),''),
            coalesce((v_row->>'stock_qty')::numeric,0),
            coalesce((v_row->>'sales_price')::numeric,0),'USD',
            'price_structure_v3_private_push','price:'||v_key,
            v_now,true,false
          ) returning id into v_id;
          v_action := 'created';
        end if;

        if v_action in ('created','updated') then
          insert into public.product_costs(
            product_id,vendor_name,cost_currency,unit_cost,shipping_cost,landed_cost,notes,updated_at
          ) values (
            v_id,nullif(btrim(coalesce(v_row->>'vendor',v_row->>'brand','')),''),
            'USD',coalesce((v_row->>'cost')::numeric,0),0,
            coalesce((v_row->>'cost')::numeric,0),
            'Secure sync from private Price Structure V3',v_now
          ) on conflict(product_id) do update set
            vendor_name=excluded.vendor_name,
            unit_cost=excluded.unit_cost,
            landed_cost=excluded.landed_cost,
            updated_at=excluded.updated_at;
          -- Retain existing admin/warehouse location notes on existing products.
          if v_action='created' then
            insert into public.product_admin_details(product_id,location,updated_at)
            values(v_id,nullif(btrim(coalesce(v_row->>'location','')),''),v_now)
            on conflict(product_id) do nothing;
          end if;
        end if;
      end if;

    exception when others then
      -- PostgreSQL automatically rolls back this individual row's writes
      -- while leaving the other rows in the batch untouched.
      if SQLSTATE='23505' then
        v_action := 'conflict';
      else
        v_action := 'failed';
      end if;
      v_reason := left(SQLERRM,300);
    end;

    case v_action
      when 'created' then v_created := v_created+1;
      when 'updated' then v_updated := v_updated+1;
      when 'skipped' then v_skipped := v_skipped+1;
      when 'conflict' then v_conflicted := v_conflicted+1;
      else v_failed := v_failed+1;
    end case;

    if v_action in ('skipped','conflict','failed') then
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'code',v_code,'status',v_action,'reason',coalesce(v_reason,'Review required')
      ));
    end if;
  end loop;

  return jsonb_build_object(
    'received',jsonb_array_length(p_products),
    'created',v_created,'updated',v_updated,'upserted',v_created+v_updated,
    'skipped',v_skipped,'conflicted',v_conflicted,'failed',v_failed,
    'issues',v_results
  );
end;
$function$;
revoke all on function public.sync_price_structure_products_safe(jsonb) from public,anon,authenticated;
grant execute on function public.sync_price_structure_products_safe(jsonb) to service_role;