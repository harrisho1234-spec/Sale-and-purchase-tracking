-- Preserve original CRM ownership when a Sales user requests/claims a Showroom/Online customer.
-- Rejected ownership requests must not leave the rejected requester as CRM owner.
-- Showroom/Online report visibility is handled in customer-activity-report.js.

create or replace function public.request_activity_customer_master(
  p_activity_id uuid,
  p_request_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_role text:=public.current_app_role();
  v_a public.customer_activity%rowtype;
  v_lead public.customer_leads%rowtype;
  v_existing public.customers%rowtype;
  v_phone text;
  v_match_count integer:=0;
  v_req_id uuid;
  v_customer_id uuid;
  v_payload jsonb;
  v_contacts jsonb:='[]'::jsonb;
begin
  if v_role<>'sales' then raise exception 'Only Sales users submit this customer request'; end if;

  select * into v_a from public.customer_activity where id=p_activity_id;
  if not found then raise exception 'Showroom/Online entry not found'; end if;

  if v_a.lead_id is not null then
    select * into v_lead from public.customer_leads where id=v_a.lead_id;
  end if;

  if v_a.linked_customer_id is not null then
    select * into v_existing
    from public.customers
    where id=v_a.linked_customer_id and active=true;
  end if;

  v_phone:=public.normalize_customer_phone(v_a.phone);

  if v_existing.id is null and v_phone is not null then
    with matches as (
      select c.id from public.customers c
      where c.active=true and c.review_status in ('pending','approved')
        and public.normalize_customer_phone(c.phone)=v_phone
      union
      select c.id
      from public.customers c
      join public.customer_contacts cc on cc.customer_id=c.id
      where c.active=true and c.review_status in ('pending','approved')
        and cc.contact_type='phone'
        and public.normalize_customer_phone(cc.contact_value)=v_phone
    )
    select count(*) into v_match_count from matches;

    if v_match_count>1 then
      raise exception 'This phone matches multiple Customer Master records. Manager/Admin must clean the duplicate before it can be claimed.';
    elsif v_match_count=1 then
      with matches as (
        select c.id from public.customers c
        where c.active=true and c.review_status in ('pending','approved')
          and public.normalize_customer_phone(c.phone)=v_phone
        union
        select c.id
        from public.customers c
        join public.customer_contacts cc on cc.customer_id=c.id
        where c.active=true and c.review_status in ('pending','approved')
          and cc.contact_type='phone'
          and public.normalize_customer_phone(cc.contact_value)=v_phone
      )
      select c.* into v_existing
      from public.customers c join matches m on m.id=c.id
      limit 1;
    end if;
  end if;

  if v_existing.id is not null then
    if v_existing.review_status='pending' and v_existing.assigned_sales_id=auth.uid() then
      return jsonb_build_object(
        'action','pending','customer_id',v_existing.id,'request_id',v_existing.review_request_id,
        'message','This customer is already in your Customer Master as Pending Review.'
      );
    end if;

    if v_existing.review_status='approved' and v_existing.assigned_sales_id=auth.uid() then
      update public.customer_activity
      set linked_customer_id=v_existing.id,assigned_sales_id=auth.uid()
      where id=v_a.id;

      if v_a.lead_id is not null then
        perform set_config('app.customer_code_override','system',true);
        update public.customer_leads
        set linked_customer_id=v_existing.id,
            assigned_sales_id=auth.uid(),
            customer_code=v_existing.customer_code,
            pending_customer_request_id=null
        where id=v_a.lead_id;
        perform set_config('app.customer_code_override','',true);
      end if;

      return jsonb_build_object(
        'action','linked','customer_id',v_existing.id,'customer_code',v_existing.customer_code,
        'message','Existing Customer Master record linked to this activity.'
      );
    end if;

    if exists(select 1 from public.customer_change_requests where customer_id=v_existing.id and status='pending') then
      raise exception 'This existing customer already has a pending customer request';
    end if;

    v_payload:=public.customer_snapshot(v_existing.id)
      || jsonb_build_object(
        'assigned_sales_id',auth.uid(),
        '_workflow_reason','ownership_claim',
        '_source_activity_id',v_a.id,
        '_source_lead_id',v_a.lead_id
      );

    insert into public.customer_change_requests(
      request_type,customer_id,requested_by,request_note,
      original_customer,original_contacts,requested_customer,requested_contacts
    )
    values(
      'update',v_existing.id,auth.uid(),
      coalesce(nullif(trim(coalesce(p_request_note,'')),''),
        'Sales requests this existing customer from Showroom/Online.'),
      public.customer_snapshot(v_existing.id),
      public.customer_contacts_snapshot(v_existing.id),
      v_payload,
      public.customer_contacts_snapshot(v_existing.id)
    )
    returning id into v_req_id;

    if v_a.lead_id is not null then
      update public.customer_leads
      set pending_customer_request_id=v_req_id
      where id=v_a.lead_id;
    end if;

    return jsonb_build_object(
      'action','ownership_request','request_id',v_req_id,'customer_id',v_existing.id,
      'current_owner',v_existing.assigned_sales_id,
      'message','Ownership/link request sent to Manager/Admin.'
    );
  end if;

  if v_lead.id is not null
     and v_lead.assigned_sales_id is not null
     and v_lead.assigned_sales_id<>auth.uid() then
    if v_phone is null then
      raise exception 'This CRM customer belongs to another Sales Rep. A valid phone number is required to request ownership.';
    end if;
    return public.request_customer_ownership_by_phone(
      v_a.phone,
      coalesce(nullif(trim(coalesce(p_request_note,'')),''),
        'Requested from Showroom/Online activity.')
    );
  end if;

  if v_a.phone is not null and v_phone is not null then
    v_contacts:=jsonb_build_array(jsonb_build_object(
      'contact_type','phone','label','Main','contact_value',v_a.phone,'is_primary',true
    ));
  end if;

  v_payload:=jsonb_build_object(
    'name',trim(v_a.customer_name),
    'address',null,
    'notes',coalesce(nullif(trim(v_a.remark),''),nullif(trim(v_a.interest),'')),
    'assigned_sales_id',auth.uid(),
    'active',true,
    'customer_since',coalesce(v_a.activity_date,current_date),
    '_workflow_reason','activity_customer_request',
    '_source_activity_id',v_a.id,
    '_source_lead_id',v_a.lead_id,
    '_source_lead_original_owner_id',v_lead.assigned_sales_id
  );

  v_req_id:=public.submit_customer_change_request(
    'create',null,v_payload,v_contacts,
    coalesce(nullif(trim(coalesce(p_request_note,'')),''),
      'Requested from Showroom/Online activity.')
  );

  select customer_id into v_customer_id
  from public.customer_change_requests
  where id=v_req_id;

  update public.customer_activity
  set linked_customer_id=v_customer_id,assigned_sales_id=auth.uid()
  where id=v_a.id;

  if v_a.lead_id is not null then
    perform set_config('app.customer_code_override','system',true);
    update public.customer_leads
    set linked_customer_id=v_customer_id,
        assigned_sales_id=auth.uid(),
        pending_customer_request_id=v_req_id,
        customer_code=(select customer_code from public.customers where id=v_customer_id)
    where id=v_a.lead_id;
    perform set_config('app.customer_code_override','',true);
  end if;

  return jsonb_build_object(
    'action','pending','request_id',v_req_id,'customer_id',v_customer_id,
    'customer_code',(select customer_code from public.customers where id=v_customer_id),
    'message','Customer added to your Customer Master as Pending Review. You may create an order while Manager/Admin reviews it.'
  );
end;
$function$;


create or replace function public.cleanup_rejected_customer_request_links()
returns trigger
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_lead_id uuid;
  v_original_owner uuid;
begin
  if old.status='pending' and new.status='rejected' then
    update public.customer_leads
    set pending_customer_request_id=null
    where pending_customer_request_id=new.id;

    if new.request_type='create' and new.customer_id is not null then
      update public.customer_activity
      set linked_customer_id=null
      where linked_customer_id=new.customer_id;

      v_lead_id:=nullif(new.requested_customer->>'_source_lead_id','')::uuid;
      v_original_owner:=nullif(new.requested_customer->>'_source_lead_original_owner_id','')::uuid;

      update public.customer_leads
      set linked_customer_id=null,
          pending_customer_request_id=null,
          assigned_sales_id=case
            when id=v_lead_id and v_original_owner is not null then v_original_owner
            else assigned_sales_id
          end
      where linked_customer_id=new.customer_id
         or pending_customer_request_id=new.id
         or id=v_lead_id;
    end if;
  end if;
  return new;
end;
$function$;


with candidates as (
  select
    r.requested_by,
    nullif(r.requested_customer->>'_source_lead_id','')::uuid as lead_id,
    (
      select a.assigned_sales_id
      from public.customer_activity a
      where a.lead_id=nullif(r.requested_customer->>'_source_lead_id','')::uuid
        and a.assigned_sales_id is not null
        and a.assigned_sales_id<>r.requested_by
      order by a.activity_date desc,a.created_at desc
      limit 1
    ) as prior_owner
  from public.customer_change_requests r
  where r.status='rejected'
    and r.request_type='create'
    and r.requested_customer->>'_workflow_reason'='activity_customer_request'
    and nullif(r.requested_customer->>'_source_lead_id','') is not null
)
update public.customer_leads l
set assigned_sales_id=c.prior_owner,updated_at=now()
from candidates c
where l.id=c.lead_id
  and l.assigned_sales_id=c.requested_by
  and c.prior_owner is not null;
