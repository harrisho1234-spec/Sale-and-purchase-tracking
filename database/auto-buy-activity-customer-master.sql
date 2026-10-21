-- Automatic Customer Master conversion when Sales saves a Showroom/Online Buy.
-- Reuse the existing guarded identity matching, ownership and Pending Review flow.
-- The visit and conversion are atomic: errors cannot leave Buy saved without routing.
create or replace function public.save_customer_activity_buy(
 p_activity_id uuid,
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
) returns jsonb language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $fn$
declare v_id uuid;v_activity public.customer_activity%rowtype;v_master jsonb;
 v_lock_key text;
begin
 if auth.uid() is null or public.current_app_role()<>'sales' then
   raise exception 'Only assigned Sales can use the automatic Buy conversion';end if;
 if p_status is distinct from 'Buy' then raise exception 'This workflow is only for Buy';end if;
 if p_activity_type not in ('showroom_visit','online') then raise exception 'Invalid activity type';end if;

 if p_activity_id is null then
  v_id:=public.create_customer_activity_v3(
   p_activity_type,p_activity_date,p_business_code,p_customer_name,p_phone,p_customer_type,
   p_source_channel,p_status,p_interest,p_remark,p_follow_up_date,p_assigned_sales_id,
   p_selected_customer_id,p_selected_lead_id);
 else
  select id into v_id from public.customer_activity
    where id=p_activity_id and activity_type=p_activity_type;
  if v_id is null then raise exception 'Activity is missing or belongs to another area';end if;
  perform public.update_customer_activity_v3(
   v_id,p_activity_date,p_business_code,p_customer_name,p_phone,p_customer_type,
   p_source_channel,p_status,p_interest,p_remark,p_follow_up_date,p_assigned_sales_id,
   p_selected_customer_id,p_selected_lead_id);
 end if;
 select * into v_activity from public.customer_activity where id=v_id;
 if not found or v_activity.status<>'Buy' then raise exception 'Failed to save Buy activity';end if;

 if v_activity.linked_customer_id is not null then
  -- Already registered (including someone else's existing customer).
  -- Never transfer ownership silently.
  v_master:=jsonb_build_object('action','linked','customer_id',v_activity.linked_customer_id,
   'message','This Buy activity is linked to an existing Customer Master. Ownership is unchanged.');
 else
  -- Serializes simultaneous Buy submissions using the same contact identity,
  -- to avoid accidentally creating multiple pending customers for one buyer.
  v_lock_key:=coalesce(
   public.normalize_customer_phone(v_activity.phone),
   public.normalize_customer_name(v_activity.customer_name),v_id::text);
  perform pg_advisory_xact_lock(hashtextextended('buy-customer:'||v_lock_key,0));
  v_master:=public.request_activity_customer_master(
   v_id,'Automatic Customer Master request from Showroom/Online Buy. Requires normal review.');
 end if;
 return jsonb_build_object('activity_id',v_id,'master',v_master);
end $fn$;
revoke all on function public.save_customer_activity_buy(uuid,text,date,text,text,text,text,text,text,text,text,date,uuid,uuid,uuid) from public,anon;
grant execute on function public.save_customer_activity_buy(uuid,text,date,text,text,text,text,text,text,text,text,date,uuid,uuid,uuid) to authenticated;
