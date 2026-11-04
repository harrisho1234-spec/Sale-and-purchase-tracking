-- Include the original CN creation date in the existing permission-scoped
-- case queue so centralized Approvals can sort pending reviews newest-first.
CREATE OR REPLACE FUNCTION public.get_visible_cn_case_workflows()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
select case when auth.uid() is null then null else
coalesce((select jsonb_agg(jsonb_build_object(
 'action',r.action,'return_id',w.sales_return_id,'cn_no',r.cn_no,
 'requested_at',r.created_at,
 'approval_status',w.approval_status,'approval_note',w.approval_note,
 'approved_at',w.approved_at,'approved_by',w.approved_by,
 'financial_decision',w.financial_decision,'closed_at',w.closed_at,
 'stock_complete',public.cn_case_stock_complete(w.sales_return_id),
 'requested_by',r.created_by,'customer_name',c.name,
 'workflow_status',case
  when w.approval_status='pending' then 'Awaiting CN Approval'
  when w.approval_status='rejected' then 'CN Rejected'
  when w.closed_at is not null then 'Case Closed'
  when not public.cn_case_stock_complete(w.sales_return_id) then case when r.action='cancel_undelivered' then 'Awaiting Reservation Release' else 'Awaiting Stock Receipt' end
  else 'Awaiting Financial Decision' end
) order by r.created_at desc)
from public.cn_case_workflows w
join public.sales_returns r on r.id=w.sales_return_id
join public.customers c on c.id=r.customer_id
where public.can_view_sales_return(r.id)
),'[]'::jsonb) end
$function$

