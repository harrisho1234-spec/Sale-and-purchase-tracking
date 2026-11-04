-- Add all existing database review queues to the existing bell / PWA attention
-- calculation. Keep its authorization, account handling, and signature logic.
CREATE OR REPLACE FUNCTION public.app_attention_snapshot_for_user(p_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_role text;
  v_approval_ids jsonb := '[]'::jsonb;
  v_follow_ids jsonb := '[]'::jsonb;
  v_tax_ids jsonb := '[]'::jsonb;
  v_stock_ids jsonb := '[]'::jsonb;
  v_approvals integer := 0;
  v_followups integer := 0;
  v_tax_sales integer := 0;
  v_stock_approvals integer := 0;
  v_cn_approvals integer := 0;
  v_do_edits integer := 0;
  v_count integer := 0;
  v_signature text;
  v_title text := 'L''Imperial';
  v_body text := '';
  v_target text := 'dashboard';
  v_jwt_role text := coalesce(auth.jwt()->>'role','');
begin
  if p_user_id is null then raise exception 'User is required'; end if;

  if v_jwt_role<>'service_role'
     and (auth.uid() is null or auth.uid() is distinct from p_user_id) then
    raise exception 'Access denied';
  end if;

  select role into v_role
  from public.app_users
  where user_id=p_user_id and active=true;

  if v_role is null then
    return jsonb_build_object(
      'count',0,'signature','inactive','title',v_title,
      'body','No action items','target','dashboard',
      'approvals',0,'followups',0,'tax_sales',0,'stock_approvals',0
    );
  end if;

  if v_role in ('manager','admin','super_admin') then
    select coalesce(jsonb_agg(x order by x),'[]'::jsonb)
    into v_approval_ids
    from (
      select 'order:'||id::text as x from public.sales_order_edit_requests where status='pending'
      union all
      select 'customer:'||id::text from public.customer_change_requests where status='pending'
      union all
      select 'payment:'||id::text from public.sales_payment_requests where status='pending'
      union all
      select 'stage:'||id::text from public.customer_lead_stage_change_requests where status='pending'
      union all
      select 'sr_conversion:'||id::text from public.sales_sr_conversion_requests where status='pending'
      union all
      select 'assignment:'||id::text from public.customer_activity_assignment_requests where status='pending'
      union all
      select 'cn:'||w.sales_return_id::text from public.cn_case_workflows w
      join public.sales_returns r on r.id=w.sales_return_id
      where w.approval_status='pending' and r.created_by is distinct from p_user_id
      union all
      select 'cn_credit:'||w.sales_return_id::text from public.cn_case_workflows w
      where w.approval_status='approved' and w.financial_decision='pending'
        and w.closed_at is null and public.cn_case_stock_complete(w.sales_return_id)
      union all
      select 'do_edit:'||id::text from public.delivery_order_edit_requests
      where status='pending' and v_role in ('admin','super_admin')
    ) q;
    v_approvals:=jsonb_array_length(v_approval_ids);
    select count(*) into v_cn_approvals from jsonb_array_elements_text(v_approval_ids) z
      where z like 'cn:%' or z like 'cn_credit:%';
    select count(*) into v_do_edits from jsonb_array_elements_text(v_approval_ids) z
      where z like 'do_edit:%';
  end if;

  if v_role in ('admin','super_admin') then
    select coalesce(jsonb_agg(x order by x),'[]'::jsonb)
    into v_stock_ids
    from (
      select 'stock_action:'||id::text as x
      from public.stock_action_requests
      where status='pending'
      union all
      select 'stock_change:'||id::text
      from public.stock_change_requests
      where status='pending'
      union all
      select 'stock_count_edit:'||id::text from public.stock_count_edit_requests where status='pending'
    ) q;
    v_stock_approvals:=jsonb_array_length(v_stock_ids);
  end if;

  if v_role='sales' then
    select coalesce(
      jsonb_agg(jsonb_build_object('id',id,'date',next_follow_up_date) order by next_follow_up_date,id),
      '[]'::jsonb
    )
    into v_follow_ids
    from public.customer_leads
    where assigned_sales_id=p_user_id
      and stage not in ('Buy','Reject')
      and next_follow_up_date is not null
      and next_follow_up_date<=current_date;
    v_followups:=jsonb_array_length(v_follow_ids);
  elsif v_role='manager' then
    select coalesce(
      jsonb_agg(jsonb_build_object('id',id,'date',next_follow_up_date) order by next_follow_up_date,id),
      '[]'::jsonb
    )
    into v_follow_ids
    from public.customer_leads
    where stage not in ('Buy','Reject')
      and next_follow_up_date is not null
      and next_follow_up_date<=current_date;
    v_followups:=jsonb_array_length(v_follow_ids);
  end if;

  if v_role='super_admin' then
    select coalesce(jsonb_agg(x order by x),'[]'::jsonb)
    into v_tax_ids
    from (
      select 'direct:'||id::text as x
      from public.tax_item_sale_alerts
      where alert_status='open'
      union all
      select 'set:'||id::text
      from public.tax_declared_set_sale_alerts
      where alert_status='open'
    ) q;

    v_tax_sales:=jsonb_array_length(v_tax_ids);
  end if;

  v_count:=v_approvals+v_stock_approvals+v_followups+v_tax_sales;
  v_signature:=md5(
    coalesce(v_role,'')||'|'||
    v_approval_ids::text||'|'||
    v_stock_ids::text||'|'||
    v_follow_ids::text||'|'||
    v_tax_ids::text
  );

  if v_count=0 then
    v_body:='No action items';
    v_target:='dashboard';
  else
    v_body:=concat_ws(
      ' · ',
      case when v_tax_sales>0 then v_tax_sales||' Tax sale alert'||case when v_tax_sales=1 then '' else 's' end end,
      case when v_stock_approvals>0 then v_stock_approvals||' stock approval'||case when v_stock_approvals=1 then '' else 's' end end,
      case when v_cn_approvals>0 then v_cn_approvals||' Return/CN review'||case when v_cn_approvals=1 then '' else 's' end end,
      case when v_do_edits>0 then v_do_edits||' DO edit'||case when v_do_edits=1 then '' else 's' end end,
      case when v_approvals-v_cn_approvals-v_do_edits>0 then
        (v_approvals-v_cn_approvals-v_do_edits)||' sales approval'||case when (v_approvals-v_cn_approvals-v_do_edits)=1 then '' else 's' end end,
      case when v_followups>0 then v_followups||' follow-up'||case when v_followups=1 then '' else 's' end end
    )||' need attention';

    if v_tax_sales>0 then v_target:='tax-inventory';
    elsif v_stock_approvals>0 then v_target:='stock-approvals';
    elsif v_approvals>0 then v_target:='approvals';
    else v_target:='customer-database';
    end if;
  end if;

  return jsonb_build_object(
    'count',v_count,
    'signature',v_signature,
    'title',v_title,
    'body',v_body,
    'target',v_target,
    'approvals',v_approvals,
    'stock_approvals',v_stock_approvals,
    'cn_reviews',v_cn_approvals,
    'do_edits',v_do_edits,
    'followups',v_followups,
    'tax_sales',v_tax_sales,
    'role',v_role
  );
end;
$function$

