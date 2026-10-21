-- New CNs use an independent, auditable approval and case-closure workflow.
-- Older CNs remain legacy records and are not assigned pending approvals.
create table if not exists public.cn_case_workflows(
 sales_return_id uuid primary key references public.sales_returns(id) on delete cascade,
 approval_status text not null default 'pending'
   check(approval_status in ('pending','approved','rejected')),
 approved_by uuid references public.app_users(user_id),
 approved_at timestamptz,
 approval_note text,
 financial_decision text not null default 'pending'
   check(financial_decision in ('pending','no_credit','credit_ar')),
 financial_decided_by uuid references public.app_users(user_id),
 financial_decided_at timestamptz,
 closed_at timestamptz,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.cn_case_workflows enable row level security;
revoke all on public.cn_case_workflows from public,anon,authenticated;
-- Only RPCs access case state. Stock-facing queue exposes the necessary flags.

create or replace function public.create_cn_case_workflow()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 insert into public.cn_case_workflows(sales_return_id) values(new.id);
 return new;
end $fn$;
drop trigger if exists create_cn_case_workflow_trg on public.sales_returns;
create trigger create_cn_case_workflow_trg after insert on public.sales_returns
for each row execute function public.create_cn_case_workflow();

create or replace function public.cn_case_stock_complete(p_return_id uuid)
returns boolean language sql stable security definer set search_path='public','auth','pg_temp'
as $fn$
 select not exists (
   select 1 from public.sales_return_items ri
   where ri.sales_return_id=p_return_id and ri.disposition='return_to_stock'
     and (
       ri.qty>coalesce(ri.historical_stock_reconciled_qty,0)+coalesce((
         select sum(sm.qty) from public.stock_movements sm
         where sm.affects_balance and sm.movement_type in ('return','in')
          and sm.reference_type='sales_return_item' and sm.reference_item_id=ri.id
       ),0)
       or exists(select 1 from public.cn_stock_receipt_requests req
          where req.sales_return_item_id=ri.id and req.status='pending')
     )
 );
$fn$;

create or replace function public.refresh_cn_case_closure(p_return_id uuid)
returns void language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype; r public.sales_returns%rowtype; done_stock boolean;
begin
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found then return; end if; -- Preserve legacy CNs.
 select * into r from public.sales_returns where id=p_return_id;
 done_stock:=public.cn_case_stock_complete(p_return_id);
 if r.status='cancelled' or w.approval_status<>'approved' then
   update public.cn_case_workflows set closed_at=null,updated_at=now()
   where sales_return_id=p_return_id and closed_at is not null;
   return;
 end if;
 if done_stock and r.status='confirmed' then
   -- No Stock Action cases also move to ready-for-financial-decision.
   perform set_config('app.cn_workflow_internal','1',true);
   update public.sales_returns set status='received',updated_at=now() where id=p_return_id;
   perform set_config('app.cn_workflow_internal','',true);
 end if;
 update public.cn_case_workflows
 set closed_at=case when done_stock and financial_decision<>'pending'
   then coalesce(closed_at,now()) else null end,updated_at=now()
 where sales_return_id=p_return_id;
end $fn$;

create or replace function public.review_cn_case(p_return_id uuid,p_approve boolean,p_note text default null)
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;r public.sales_returns%rowtype;
begin
 if auth.uid() is null or public.current_app_role() not in ('manager','admin','super_admin')
  or not public.current_user_has_permission('returns.approve')
 then raise exception 'Manager/Admin CN approval permission required';end if;
 if length(coalesce(p_note,''))>2000 then raise exception 'CN approval note is too long';end if;
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found then raise exception 'Historical CN is outside the new approval workflow';end if;
 select * into r from public.sales_returns where id=p_return_id for update;
 if r.status='cancelled' then raise exception 'Cancelled CN cannot be approved';end if;
 if w.approval_status<>'pending' then raise exception 'This CN approval was already reviewed';end if;
 if r.created_by=auth.uid() then raise exception 'CN preparer cannot approve their own CN';end if;
 update public.cn_case_workflows
 set approval_status=case when p_approve then 'approved' else 'rejected' end,
     approved_by=auth.uid(),approved_at=now(),
     approval_note=nullif(btrim(coalesce(p_note,'')),''),updated_at=now()
 where sales_return_id=p_return_id;
 if p_approve then perform public.refresh_cn_case_closure(p_return_id);end if;
 return jsonb_build_object('return_id',p_return_id,
  'approval_status',case when p_approve then 'approved' else 'rejected' end);
end $fn$;

create or replace function public.resubmit_cn_case(p_return_id uuid)
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;
begin
 if not public.can_edit_sales_return(p_return_id) then
   raise exception 'You do not have permission to resubmit this CN';end if;
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found or w.approval_status<>'rejected' then
  raise exception 'Only rejected CNs can be resubmitted';end if;
 if exists(select 1 from public.cn_stock_receipt_requests where sales_return_id=p_return_id) then
  raise exception 'CN has warehouse receipts and cannot be resubmitted';end if;
 update public.cn_case_workflows
 set approval_status='pending',approved_by=null,approved_at=null,approval_note=null,
  financial_decision='pending',financial_decided_by=null,financial_decided_at=null,
  closed_at=null,updated_at=now() where sales_return_id=p_return_id;
 return jsonb_build_object('approval_status','pending','return_id',p_return_id);
end $fn$;

create or replace function public.decide_cn_no_credit(p_return_id uuid,p_note text default null)
returns jsonb language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;r public.sales_returns%rowtype;
begin
 if auth.uid() is null or public.current_app_role() not in ('manager','admin','super_admin')
  or not public.current_user_has_permission('returns.approve') then
  raise exception 'Manager/Admin CN financial decision permission required';end if;
 select * into w from public.cn_case_workflows where sales_return_id=p_return_id for update;
 if not found or w.approval_status<>'approved' then raise exception 'CN approval required';end if;
 if w.financial_decision<>'pending' then raise exception 'Financial decision already finalized';end if;
 if not public.cn_case_stock_complete(p_return_id) then
  raise exception 'Finish physical stock receipts before final financial decision';end if;
 select * into r from public.sales_returns where id=p_return_id;
 if r.financial_effect<>'none' then raise exception 'Customer Credit already applied';end if;
 update public.cn_case_workflows set financial_decision='no_credit',
 financial_decided_by=auth.uid(),financial_decided_at=now(),
 updated_at=now() where sales_return_id=p_return_id;
 perform public.refresh_cn_case_closure(p_return_id);
 return jsonb_build_object('return_id',p_return_id,'financial_decision','no_credit','case_closed',true);
end $fn$;

create or replace function public.mark_cn_credit_decision()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;
begin
 select * into w from public.cn_case_workflows where sales_return_id=new.id for update;
 if not found or new.financial_effect is not distinct from old.financial_effect then return new;end if;
 if w.approval_status<>'approved' then raise exception 'Approve the CN before customer-credit changes';end if;
 if not public.cn_case_stock_complete(new.id) then
  raise exception 'Complete physical stock receipt approval before applying customer credit';end if;
 if w.closed_at is not null then
  raise exception 'This CN is closed. Contact an administrator to review corrections';end if;
 if new.financial_effect='credit_ar' then
  update public.cn_case_workflows set financial_decision='credit_ar',
   financial_decided_by=auth.uid(),financial_decided_at=now(),updated_at=now()
   where sales_return_id=new.id;
 else
  update public.cn_case_workflows set financial_decision='pending',
   financial_decided_by=null,financial_decided_at=null,updated_at=now()
   where sales_return_id=new.id;
 end if;
 return new;
end $fn$;
drop trigger if exists mark_cn_credit_decision_trg on public.sales_returns;
create trigger mark_cn_credit_decision_trg
before update of financial_effect on public.sales_returns
for each row execute function public.mark_cn_credit_decision();

create or replace function public.close_cn_case_after_credit()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 if old.financial_effect is distinct from new.financial_effect then
  perform public.refresh_cn_case_closure(new.id);
 end if;
 return new;
end $fn$;
drop trigger if exists close_cn_case_after_credit_trg on public.sales_returns;
create trigger close_cn_case_after_credit_trg
after update of financial_effect on public.sales_returns
for each row execute function public.close_cn_case_after_credit();

create or replace function public.guard_cn_case_stock_receipt()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare v_status text;
begin
 select approval_status into v_status from public.cn_case_workflows
 where sales_return_id=new.sales_return_id;
 if found and v_status<>'approved' then
  raise exception 'Manager/Admin must approve the CN before Stock can receive it';end if;
 return new;
end $fn$;
drop trigger if exists guard_cn_case_stock_receipt_insert on public.cn_stock_receipt_requests;
create trigger guard_cn_case_stock_receipt_insert
before insert on public.cn_stock_receipt_requests
for each row execute function public.guard_cn_case_stock_receipt();
drop trigger if exists guard_cn_case_stock_receipt_review on public.cn_stock_receipt_requests;
create trigger guard_cn_case_stock_receipt_review
before update of status on public.cn_stock_receipt_requests
for each row when(new.status='approved')
execute function public.guard_cn_case_stock_receipt();

create or replace function public.after_cn_stock_receipt_approval()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
begin
 if new.status in ('approved','rejected') and old.status is distinct from new.status then
  perform public.refresh_cn_case_closure(new.sales_return_id);
 end if;
 return new;
end $fn$;
drop trigger if exists after_cn_stock_receipt_approval_trg on public.cn_stock_receipt_requests;
create trigger after_cn_stock_receipt_approval_trg
after update of status on public.cn_stock_receipt_requests
for each row execute function public.after_cn_stock_receipt_approval();

create or replace function public.guard_cn_case_edits()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare w public.cn_case_workflows%rowtype;v_id uuid;
begin
 v_id:=case when tg_op='DELETE' then old.id else new.id end;
 select * into w from public.cn_case_workflows where sales_return_id=v_id;
 if not found then return case when tg_op='DELETE' then old else new end;end if;
 if tg_op='DELETE' then
  if w.approval_status='approved' then
   raise exception 'Approved CNs cannot be deleted; request a controlled correction';end if;
  return old;
 end if;
 if new.status is distinct from old.status and
   coalesce(current_setting('app.cn_workflow_internal',true),'')<>'1' then
   if new.status='received' then
    raise exception 'New CNs are marked Received through warehouse completion, not manually';end if;
   if new.status='cancelled' and w.approval_status='approved' then
    raise exception 'Approved CN cannot be cancelled directly';end if;
 end if;
 if (new.action,new.reason,new.return_date,new.sales_order_id,new.customer_id,new.notes)
    is distinct from (old.action,old.reason,old.return_date,old.sales_order_id,old.customer_id,old.notes)
    and w.approval_status='approved' then
  raise exception 'Approved CN cannot be edited directly';end if;
 return new;
end $fn$;
drop trigger if exists guard_cn_case_edits_trg on public.sales_returns;
create trigger guard_cn_case_edits_trg
before update or delete on public.sales_returns
for each row execute function public.guard_cn_case_edits();

create or replace function public.guard_cn_case_item_edits()
returns trigger language plpgsql security definer set search_path='public','auth','pg_temp'
as $fn$
declare v_id uuid;v_status text;
begin
 v_id:=case when tg_op='DELETE' then old.sales_return_id else new.sales_return_id end;
 select approval_status into v_status from public.cn_case_workflows where sales_return_id=v_id;
 if found and v_status='approved' then
  raise exception 'Approved CN product lines cannot be changed';end if;
 return case when tg_op='DELETE' then old else new end;
end $fn$;
drop trigger if exists guard_cn_case_item_edits_trg on public.sales_return_items;
create trigger guard_cn_case_item_edits_trg
before insert or update or delete on public.sales_return_items
for each row execute function public.guard_cn_case_item_edits();

create or replace function public.get_visible_cn_case_workflows()
returns jsonb language sql stable security definer set search_path='public','auth','pg_temp'
as $fn$
select case when auth.uid() is null then null else
coalesce((select jsonb_agg(jsonb_build_object(
 'return_id',w.sales_return_id,'cn_no',r.cn_no,
 'approval_status',w.approval_status,'approval_note',w.approval_note,
 'approved_at',w.approved_at,'approved_by',w.approved_by,
 'financial_decision',w.financial_decision,'closed_at',w.closed_at,
 'stock_complete',public.cn_case_stock_complete(w.sales_return_id),
 'requested_by',r.created_by,'customer_name',c.name,
 'workflow_status',case
  when w.approval_status='pending' then 'Awaiting CN Approval'
  when w.approval_status='rejected' then 'CN Rejected'
  when w.closed_at is not null then 'Case Closed'
  when not public.cn_case_stock_complete(w.sales_return_id) then 'Awaiting Stock Receipt'
  else 'Awaiting Financial Decision' end
) order by r.created_at desc)
from public.cn_case_workflows w
join public.sales_returns r on r.id=w.sales_return_id
join public.customers c on c.id=r.customer_id
where public.can_view_sales_return(r.id)
),'[]'::jsonb) end
$fn$;

-- Only the CN-case RPCs can mutate case state. Read uses scoped SECURITY DEFINER.
revoke all on function public.cn_case_stock_complete(uuid) from public,anon,authenticated;
revoke all on function public.refresh_cn_case_closure(uuid) from public,anon,authenticated;
revoke all on function public.review_cn_case(uuid,boolean,text) from public,anon;
revoke all on function public.resubmit_cn_case(uuid) from public,anon;
revoke all on function public.decide_cn_no_credit(uuid,text) from public,anon;
revoke all on function public.get_visible_cn_case_workflows() from public,anon;
grant execute on function public.review_cn_case(uuid,boolean,text) to authenticated;
grant execute on function public.resubmit_cn_case(uuid) to authenticated;
grant execute on function public.decide_cn_no_credit(uuid,text) to authenticated;
grant execute on function public.get_visible_cn_case_workflows() to authenticated;
