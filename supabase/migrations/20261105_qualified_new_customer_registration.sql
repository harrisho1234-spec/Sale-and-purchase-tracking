-- Sales-only qualification for NEW official Customer Master requests.
-- Existing customers, historical requests and updates remain unchanged.
-- A first-time buyer does not need an existing visit or invoice:
-- "purchased_pending_invoice" is a valid answer; the issued invoice
-- is linked separately after approval through the existing Sales workflow.
create or replace function public.request_qualified_customer_registration(
  p_source text,
  p_source_id uuid,
  p_purchase_status text,
  p_official_name text,
  p_request_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to public,auth,pg_temp
as $function$
declare
  v_source text := lower(trim(coalesce(p_source,'')));
  v_status text := lower(trim(coalesce(p_purchase_status,'')));
  v_name text := trim(coalesce(p_official_name,''));
  v_note text := nullif(trim(coalesce(p_request_note,'')),'');
  v_original_name text;
  v_activity_type text;
  v_response jsonb;
  v_request_id uuid;
  v_customer_id uuid;
  v_before timestamptz := clock_timestamp();
  v_request public.customer_change_requests%rowtype;
begin
  if public.current_app_role() <> 'sales' then
    raise exception 'Sales account required for official customer requests';
  end if;
  if v_source not in ('crm','showroom_visit','online') or p_source_id is null then
    raise exception 'Choose an existing Customer Database, Showroom Visit or Online record';
  end if;
  if v_status not in ('purchased_pending_invoice','purchased_invoiced','deal_confirmed') then
    raise exception 'Confirm a purchase or closed deal first. Unpurchased leads belong in Customer Database';
  end if;
  if length(v_name) < 2 or length(v_name) > 150 then
    raise exception 'Official customer name must be 2 to 150 characters';
  end if;
  if length(coalesce(v_note,'')) > 1000 then
    raise exception 'Keep the request note within 1,000 characters';
  end if;

  if v_source = 'crm' then
    select customer_name into v_original_name
    from public.customer_leads where id=p_source_id;
    if v_original_name is null then raise exception 'Customer Database record not found'; end if;
    v_response := public.convert_customer_lead(p_source_id);
  else
    select customer_name,activity_type into v_original_name,v_activity_type
    from public.customer_activity where id=p_source_id;
    if v_original_name is null or v_activity_type is distinct from v_source then
      raise exception 'Selected Showroom/Online activity does not match the chosen source';
    end if;
    v_response := public.request_activity_customer_master(p_source_id,v_note);
  end if;

  v_request_id := nullif(v_response->>'request_id','')::uuid;
  if coalesce(v_response->>'action','') <> 'pending' or v_request_id is null then
    -- Native workflow resolves existing customers and ownership claims.
    -- Never reassign or overwrite those records as part of registration.
    return v_response;
  end if;

  select * into v_request
  from public.customer_change_requests
  where id=v_request_id for update;

  if not found or v_request.request_type <> 'create'
     or v_request.requested_by is distinct from auth.uid()
     or v_request.status <> 'pending' then
    return v_response;
  end if;

  -- Native conversions may return a previously created pending request.
  -- Do not impose NEW verification rules on it or alter historical data.
  if v_request.requested_at < v_before then
    return v_response || jsonb_build_object('existing_request',true);
  end if;

  update public.customer_change_requests
  set requested_customer=requested_customer || jsonb_build_object(
        'name',v_name,
        '_qualification_version','2026-11-05',
        '_purchase_confirmation',v_status,
        '_qualification_source',v_source,
        '_source_record_id',p_source_id,
        '_original_source_name',v_original_name,
        '_invoice_link_status','pending_invoice_or_issued_later'),
      request_note=coalesce(v_note,request_note),
      updated_at=now()
  where id=v_request_id and requested_by=auth.uid()
    and status='pending' and request_type='create';

  v_customer_id := v_request.customer_id;
  if v_customer_id is not null then
    update public.customers
    set name=v_name,updated_at=now()
    where id=v_customer_id and review_status='pending';
  end if;

  return v_response || jsonb_build_object(
    'qualification_recorded',true,
    'invoice_can_be_linked_after_approval',true
  );
end
$function$;

revoke all on function public.request_qualified_customer_registration(text,uuid,text,text,text) from public;
grant execute on function public.request_qualified_customer_registration(text,uuid,text,text,text) to authenticated;
