CREATE OR REPLACE FUNCTION public.guard_cn_case_credit_on_update()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','auth','pg_temp'
AS $fn$
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

create trigger guard_cn_case_credit_on_update_trg before update of financial_effect on public.sales_returns
for each row execute function public.guard_cn_case_credit_on_update();
