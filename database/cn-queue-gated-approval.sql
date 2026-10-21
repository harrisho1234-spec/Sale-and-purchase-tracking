-- Read-only warehouse queue: visible immediately, stock intake gated on CN approval.
-- Keeps earlier pre-workflow CNs running under their existing legacy process.
do $patch$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='get_cn_stock_receipt_queue';
 if v_sql is null then raise exception 'CN queue function missing';end if;
 if position('''warehouse_stage'',case' in v_sql)=0
   or position('''available_to_request'',case when r.disposition=' in v_sql)=0
 then raise exception 'Unexpected CN stock queue; abort patch';end if;
 v_sql:=replace(v_sql,
  '''awaiting_physical_return'',cn.status=''confirmed'',',
  '''awaiting_physical_return'',cn.status=''confirmed'' and '||
    '(wf.approval_status is null or wf.approval_status=''approved''),');
 v_sql:=replace(v_sql,
  '''warehouse_stage'',case',
  '''approval_status'',coalesce(wf.approval_status,''legacy''),'||
  '''warehouse_stage'',case '||
  'when wf.approval_status=''pending'' then ''awaiting_cn_approval'' '||
  'when wf.approval_status=''rejected'' then ''cn_rejected'' ');
 v_sql:=replace(v_sql,
  '''can_request_receipt'',r.disposition=''return_to_stock'' and',
  '''can_request_receipt'',(wf.approval_status is null or wf.approval_status=''approved'') '||
  'and r.disposition=''return_to_stock'' and');
 v_sql:=replace(v_sql,
  '''available_to_request'',case when r.disposition=''return_to_stock''',
  '''available_to_request'',case when (wf.approval_status is null '||
   'or wf.approval_status=''approved'') and r.disposition=''return_to_stock''');
 v_sql:=replace(v_sql,
  'join public.sales_returns cn on cn.id=r.sales_return_id',
  'join public.sales_returns cn on cn.id=r.sales_return_id '||
  'left join public.cn_case_workflows wf on wf.sales_return_id=cn.id');
 execute v_sql;
end $patch$;

-- New CN credit changes are protected at the DB boundary. No legacy changes.
create or replace function public.guard_cn_case_credit_on_update()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;
begin
 select * into w from public.cn_case_workflows where sales_return_id=new.id;
 if not found then return new;end if;
 if new.financial_effect is distinct from old.financial_effect then
  if w.closed_at is not null then raise exception 'CN case is closed; request controlled correction';end if;
  if w.approval_status<>'approved' or not public.cn_case_stock_complete(new.id) then
    raise exception 'Manager CN approval and approved physical stock receipts are required before customer credit';
  end if;
 end if;
 return new;
end $fn$;
drop trigger if exists guard_cn_case_credit_on_update_trg on public.sales_returns;
create trigger guard_cn_case_credit_on_update_trg
before update of financial_effect on public.sales_returns
for each row execute function public.guard_cn_case_credit_on_update();
