-- Temporarily suspend NEW Exchange CNs (both header action and item
-- disposition) while keeping historical exchanges and stock workflows intact.
-- A return followed by a new purchase is two independent transactions:
-- Return/CN → approved Customer Credit; New TK/RK for the purchase.
create or replace function public.block_new_cn_exchanges()
returns trigger language plpgsql security definer
set search_path=public,pg_temp as $lock$
begin
  if tg_table_name='sales_returns' then
    if new.action='exchange' and (tg_op='INSERT' or (tg_op='UPDATE' and old.action is distinct from new.action)) then
      raise exception using errcode='23514',
        message='Exchange is temporarily disabled. Submit a Return/CN and a separate TK/RK for new purchases.';
    end if;
  elsif tg_table_name='sales_return_items' then
    if new.disposition='exchange' and (tg_op='INSERT' or (tg_op='UPDATE' and old.disposition is distinct from new.disposition)) then
      raise exception using errcode='23514',
        message='Exchange handling is temporarily disabled. Use Return to Stock or another normal return handling method.';
    end if;
  end if;
  return new;
end;
$lock$;

revoke all on function public.block_new_cn_exchanges() from public,anon,authenticated;
drop trigger if exists temporarily_block_exchange_cn_action on public.sales_returns;
create trigger temporarily_block_exchange_cn_action
  before insert or update of action on public.sales_returns
  for each row execute function public.block_new_cn_exchanges();

drop trigger if exists temporarily_block_exchange_cn_item on public.sales_return_items;
create trigger temporarily_block_exchange_cn_item
  before insert or update of disposition on public.sales_return_items
  for each row execute function public.block_new_cn_exchanges();

-- Read-only financial detail for invoice cards, filtered by existing
-- Sales Order permissions. CN values are net of item + order discounts and
-- recorded separately from approved credits and received cash.
create or replace function public.get_sales_tracking_return_financial_breakdown()
returns table(
  sales_order_id uuid,
  recorded_return_value numeric,
  received_return_value numeric,
  cn_count integer,
  cn_numbers text
)
language sql stable security definer
set search_path=public,auth,pg_temp as $data$
  select i.sales_order_id,
    round(coalesce(sum(public.sales_order_item_net_return_value(ri.sales_order_item_id,ri.qty)),0),2)::numeric as recorded_return_value,
    round(coalesce(sum(public.sales_order_item_net_return_value(ri.sales_order_item_id,ri.qty)) filter(where r.status='received'),0),2)::numeric as received_return_value,
    count(distinct r.id)::integer as cn_count,
    string_agg(distinct r.cn_no,', ' order by r.cn_no) as cn_numbers
  from public.sales_return_items ri
  join public.sales_returns r on r.id=ri.sales_return_id
  join public.sales_order_items i on i.id=ri.sales_order_item_id
  where r.status<>'cancelled'
    and not exists (
      select 1 from public.cn_case_workflows w
      where w.sales_return_id=r.id and w.approval_status='rejected'
    )
    and public.can_view_sales_order(i.sales_order_id)
  group by i.sales_order_id
  order by i.sales_order_id;
$data$;
revoke all on function public.get_sales_tracking_return_financial_breakdown() from public,anon;
grant execute on function public.get_sales_tracking_return_financial_breakdown() to authenticated;
