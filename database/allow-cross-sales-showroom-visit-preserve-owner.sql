-- Allow a Sales user to record a Showroom/Online activity for an existing customer
-- owned by another Sales Rep without changing ownership.
-- The activity row remains assigned to the existing owner; created_by records who entered it.

create or replace function public.create_customer_activity_v2(
  p_activity_type text,
  p_activity_date date,
  p_business_code text,
  p_customer_name text,
  p_phone text default null,
  p_customer_type text default null,
  p_source_channel text default null,
  p_status text default null,
  p_interest text default null,
  p_remark text default null,
  p_follow_up_date date default null,
  p_assigned_sales_id uuid default null,
  p_selected_customer_id uuid default null,
  p_selected_lead_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=public.current_app_role();
  v_id uuid;
  v_ctx jsonb;
  v_owner uuid;
  v_owner_name text;
  v_customer_id uuid;
  v_lead_id uuid;
  v_phone text;
  v_name text;
  v_assigned uuid;
begin
  if v_role not in ('sales','manager','admin','super_admin') then
    raise exception 'Sales access required';
  end if;
  if p_activity_type not in ('showroom_visit','online') then
    raise exception 'Invalid activity type';
  end if;
  if p_business_code not in ('RK','TK') then
    raise exception 'Business must be RK or TK';
  end if;
  if nullif(trim(coalesce(p_customer_name,'')),'') is null then
    raise exception 'Customer name is required';
  end if;
  if not public.customer_activity_pic_is_valid(p_assigned_sales_id) then
    raise exception 'Person In Charge must be an active Sales/Manager user or left Unassigned';
  end if;

  v_ctx:=public.resolve_customer_activity_identity(p_phone,p_selected_customer_id,p_selected_lead_id);
  v_owner:=nullif(v_ctx->>'assigned_sales_id','')::uuid;
  v_owner_name:=v_ctx->>'assigned_sales_name';
  v_customer_id:=nullif(v_ctx->>'customer_id','')::uuid;
  v_lead_id:=nullif(v_ctx->>'lead_id','')::uuid;
  v_phone:=coalesce(nullif(trim(coalesce(p_phone,'')),''),nullif(v_ctx->>'phone',''));
  v_name:=coalesce(nullif(v_ctx->>'customer_name',''),trim(p_customer_name));

  if v_owner is not null then
    if p_assigned_sales_id is not null and p_assigned_sales_id<>v_owner then
      raise exception 'This customer/phone is already assigned to %. You cannot reassign it from Showroom/Online.',
        coalesce(v_owner_name,'another Sales Rep');
    end if;
    v_assigned:=v_owner;
  else
    if v_role='sales'
       and p_assigned_sales_id is not null
       and p_assigned_sales_id<>auth.uid() then
      raise exception 'Sales users can only claim an unassigned customer for themselves';
    end if;
    v_assigned:=p_assigned_sales_id;
  end if;

  if v_assigned is not null and v_owner is null
     and public.normalize_customer_phone(v_phone) is null
     and v_customer_id is null then
    raise exception 'A valid contact phone number is required before claiming this customer';
  end if;

  if v_customer_id is not null and v_owner is null and v_assigned is not null then
    update public.customers
    set assigned_sales_id=v_assigned
    where id=v_customer_id and assigned_sales_id is null;
  end if;

  insert into public.customer_activity(
    activity_date,activity_type,business_code,customer_name,phone,customer_type,
    source_channel,status,interest,remark,follow_up_date,assigned_sales_id,
    linked_customer_id,lead_id,created_by
  )
  values(
    coalesce(p_activity_date,current_date),p_activity_type,p_business_code,v_name,
    nullif(trim(coalesce(v_phone,'')),''),nullif(trim(coalesce(p_customer_type,'')),''),
    nullif(trim(coalesce(p_source_channel,'')),''),nullif(trim(coalesce(p_status,'')),''),
    nullif(trim(coalesce(p_interest,'')),''),nullif(trim(coalesce(p_remark,'')),''),
    p_follow_up_date,v_assigned,v_customer_id,v_lead_id,auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$function$;

create or replace function public.update_customer_activity_v2(
  p_id uuid,
  p_activity_date date,
  p_business_code text,
  p_customer_name text,
  p_phone text default null,
  p_customer_type text default null,
  p_source_channel text default null,
  p_status text default null,
  p_interest text default null,
  p_remark text default null,
  p_follow_up_date date default null,
  p_assigned_sales_id uuid default null,
  p_selected_customer_id uuid default null,
  p_selected_lead_id uuid default null
)
returns void
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=public.current_app_role();
  v_existing public.customer_activity%rowtype;
  v_ctx jsonb;
  v_owner uuid;
  v_owner_name text;
  v_customer_id uuid;
  v_lead_id uuid;
  v_phone text;
  v_name text;
  v_assigned uuid;
begin
  select * into v_existing from public.customer_activity where id=p_id;
  if not found then raise exception 'Entry not found'; end if;

  if v_role in ('admin','super_admin','manager') then
    null;
  elsif v_role='sales'
    and (v_existing.created_by=auth.uid() or v_existing.assigned_sales_id=auth.uid()) then
    null;
  else
    raise exception 'You cannot edit this entry';
  end if;

  if p_business_code not in ('RK','TK') then
    raise exception 'Business must be RK or TK';
  end if;
  if nullif(trim(coalesce(p_customer_name,'')),'') is null then
    raise exception 'Customer name is required';
  end if;
  if not public.customer_activity_pic_is_valid(p_assigned_sales_id) then
    raise exception 'Person In Charge must be an active Sales/Manager user or left Unassigned';
  end if;

  v_ctx:=public.resolve_customer_activity_identity(
    p_phone,
    coalesce(p_selected_customer_id,v_existing.linked_customer_id),
    coalesce(p_selected_lead_id,v_existing.lead_id)
  );
  v_owner:=nullif(v_ctx->>'assigned_sales_id','')::uuid;
  v_owner_name:=v_ctx->>'assigned_sales_name';
  v_customer_id:=nullif(v_ctx->>'customer_id','')::uuid;
  v_lead_id:=nullif(v_ctx->>'lead_id','')::uuid;
  v_phone:=coalesce(nullif(trim(coalesce(p_phone,'')),''),nullif(v_ctx->>'phone',''));
  v_name:=coalesce(nullif(v_ctx->>'customer_name',''),trim(p_customer_name));

  if v_owner is not null then
    if p_assigned_sales_id is not null and p_assigned_sales_id<>v_owner then
      raise exception 'This customer/phone is already assigned to %. You cannot reassign it from Showroom/Online.',
        coalesce(v_owner_name,'another Sales Rep');
    end if;
    v_assigned:=v_owner;
  else
    if v_role='sales'
       and p_assigned_sales_id is not null
       and p_assigned_sales_id<>auth.uid() then
      raise exception 'Sales users can only claim an unassigned customer for themselves';
    end if;
    v_assigned:=p_assigned_sales_id;
  end if;

  if v_assigned is not null and v_owner is null
     and public.normalize_customer_phone(v_phone) is null
     and v_customer_id is null then
    raise exception 'A valid contact phone number is required before claiming this customer';
  end if;

  if v_customer_id is not null and v_owner is null and v_assigned is not null then
    update public.customers
    set assigned_sales_id=v_assigned
    where id=v_customer_id and assigned_sales_id is null;
  end if;

  update public.customer_activity
  set activity_date=coalesce(p_activity_date,activity_date),
      business_code=p_business_code,
      customer_name=v_name,
      phone=nullif(trim(coalesce(v_phone,'')),''),
      customer_type=nullif(trim(coalesce(p_customer_type,'')),''),
      source_channel=nullif(trim(coalesce(p_source_channel,'')),''),
      status=nullif(trim(coalesce(p_status,'')),''),
      interest=nullif(trim(coalesce(p_interest,'')),''),
      remark=nullif(trim(coalesce(p_remark,'')),''),
      follow_up_date=p_follow_up_date,
      assigned_sales_id=v_assigned,
      linked_customer_id=v_customer_id,
      lead_id=v_lead_id
  where id=p_id;
end;
$function$;
