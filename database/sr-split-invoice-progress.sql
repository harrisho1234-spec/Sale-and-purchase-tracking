-- Compact invoice progress for visible SR document-flow cards.
create or replace function public.get_visible_sr_split_invoice_list()
returns jsonb language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $function$
select case when auth.uid() is null then '[]'::jsonb else
 coalesce((select jsonb_agg(jsonb_build_object(
  'sr_id',o.id,'issued_count',coalesce(t.issued_count,0),
  'pending_count',coalesce(t.pending_count,0),
  'issued_numbers',coalesce(t.issued_numbers,'[]'::jsonb),
  'total_qty',coalesce(q.total_qty,0),
  'issued_qty',coalesce(t.issued_qty,0),
  'pending_qty',coalesce(t.pending_qty,0)
 ) order by o.created_at desc)
 from public.sales_orders o
 cross join lateral (select coalesce(sum(i.qty),0) total_qty
   from public.sales_order_items i where i.sales_order_id=o.id) q
 left join lateral (
  select count(*) filter(where h.status='issued') issued_count,
    count(*) filter(where h.status='pending') pending_count,
    coalesce(jsonb_agg(jsonb_build_object('no',h.invoice_no,'total',h.invoice_total)
      order by h.issued_at) filter(where h.status='issued'),'[]'::jsonb) issued_numbers,
    coalesce(sum(l.quantity) filter(where h.status='issued'),0) issued_qty,
    coalesce(sum(l.quantity) filter(where h.status='pending'),0) pending_qty
  from public.sales_sr_invoice_parts h
  left join lateral(select sum(x.qty) as quantity from public.sales_sr_invoice_part_lines x
    where x.invoice_part_id=h.id) l on true
  where h.sales_order_id=o.id
 ) t on true
 where o.sales_flow_type='pre_order'
  and (o.sales_rep_id=auth.uid() or public.current_app_role() in ('manager','admin','super_admin'))
  and exists(select 1 from public.sales_sr_invoice_parts h where h.sales_order_id=o.id)
 ),'[]'::jsonb) end
$function$;
revoke all on function public.get_visible_sr_split_invoice_list() from public,anon;
grant execute on function public.get_visible_sr_split_invoice_list() to authenticated;

-- Guard legacy single-invoice conversion requests while the multi-invoice flow is active.
create or replace function public.guard_sr_legacy_request_after_split()
returns trigger language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $function$
begin
 if exists(select 1 from public.sales_sr_invoice_parts h
  where h.sales_order_id=new.sales_order_id and h.status in ('pending','issued')) then
   raise exception 'This SR uses multiple TK/RK invoice documents. Continue invoicing from its remaining SR items.';
 end if;
 return new;
end $function$;
drop trigger if exists trg_guard_sr_legacy_request_after_split on public.sales_sr_conversion_requests;
create trigger trg_guard_sr_legacy_request_after_split
 before insert on public.sales_sr_conversion_requests
 for each row execute function public.guard_sr_legacy_request_after_split();
