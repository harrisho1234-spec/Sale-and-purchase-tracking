
-- Sales-only SR -> TK/RK preparation with Manager/Admin issuance approval.
-- Never touches inventory, SR references or payments.
create table if not exists public.sales_sr_conversion_requests (
 id uuid primary key default gen_random_uuid(),
 sales_order_id uuid not null references public.sales_orders(id) on delete restrict,
 requested_by uuid not null default auth.uid() references auth.users(id),
 requested_at timestamptz not null default now(),
 invoice_type text not null check(invoice_type in ('TK','RK')),
 invoice_no text not null check(length(invoice_no) between 3 and 80),
 sales_category text not null default 'standard' check(sales_category in ('standard','project')),
 request_note text,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reviewed_by uuid references auth.users(id),
 reviewed_at timestamptz,
 review_note text,
 created_at timestamptz not null default now()
);
create unique index if not exists sales_sr_one_pending_conversion_per_order
 on public.sales_sr_conversion_requests(sales_order_id) where status='pending';
create unique index if not exists sales_sr_one_pending_conversion_per_number
 on public.sales_sr_conversion_requests(upper(btrim(invoice_no))) where status='pending';
create unique index if not exists sales_orders_final_invoice_number_unique
 on public.sales_orders(upper(btrim(sales_invoice_no)))
 where sales_invoice_no is not null and btrim(sales_invoice_no)<>'';
alter table public.sales_sr_conversion_requests enable row level security;
revoke all on public.sales_sr_conversion_requests from public,anon,authenticated;

-- Enable for standard sales accounts; customize further in User & Access.
update public.app_access_role_templates
 set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),'{sales_orders.convert_request}','true'::jsonb,true),updated_at=now()
 where role_key='sales' and base_role='sales';
update public.app_access_role_templates
 set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),'{sales_orders.convert_approve}','true'::jsonb,true),updated_at=now()
 where base_role in ('manager','admin','super_admin')
   and role_key in ('manager','admin','super_admin');

create or replace function public.submit_sr_conversion_request(
 p_order_id uuid,p_invoice_type text,p_invoice_no text,
 p_sales_category text default 'standard',p_note text default null
) returns uuid language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
 v_order public.sales_orders%rowtype;
 v_type text := upper(btrim(coalesce(p_invoice_type,'')));
 v_no text := upper(regexp_replace(btrim(coalesce(p_invoice_no,'')),'\s+','','g'));
 v_category text := lower(btrim(coalesce(p_sales_category,'standard')));
 v_request uuid;
begin
 if public.current_app_role()<>'sales' or not public.current_user_has_permission('sales_orders.convert_request') then
   raise exception 'Sales conversion request permission required';
 end if;
 if v_type not in ('TK','RK') or length(v_no)<3 or length(v_no)>80 or v_no !~ '^[A-Z0-9/-]+$'
    or left(v_no,2)<>v_type then
   raise exception 'Enter a valid TK/RK invoice number matching the selected business';
 end if;
 if v_category not in ('standard','project') then raise exception 'Invalid sales category'; end if;
 select * into v_order from public.sales_orders where id=p_order_id for update;
 if not found then raise exception 'SR not found'; end if;
 if v_order.sales_flow_type<>'pre_order' or v_order.status='cancelled' then
   raise exception 'Only active SR pre-orders can be converted';
 end if;
 if v_order.sales_rep_id is distinct from auth.uid() then
   raise exception 'You can request conversion only for your own SR';
 end if;
 if v_order.sales_invoice_no is not null then raise exception 'Final TK/RK is already issued'; end if;
 if not exists (select 1 from public.sales_order_items where sales_order_id=p_order_id) then
   raise exception 'SR has no items';
 end if;
 if exists (
   select 1 from public.sales_order_items soi
   left join public.item_tracking it on it.sales_order_item_id=soi.id
   where soi.sales_order_id=p_order_id
     and lower(coalesce(it.status,soi.fulfillment_status,'ordered')) not in ('arrived','ready','delivered')
 ) then raise exception 'All SR items must be Arrived/Ready before preparing conversion'; end if;
 if exists(select 1 from public.sales_sr_conversion_requests where sales_order_id=p_order_id and status='pending') then
   raise exception 'This SR already has a pending conversion request';
 end if;
 if exists(select 1 from public.sales_orders
      where upper(btrim(coalesce(order_no,'')))=v_no
         or upper(btrim(coalesce(invoice_no,'')))=v_no
         or upper(btrim(coalesce(sr_no,'')))=v_no
         or upper(btrim(coalesce(sales_invoice_no,'')))=v_no) then
   raise exception 'Invoice number already exists in Sales Tracking';
 end if;
 insert into public.sales_sr_conversion_requests(
   sales_order_id,invoice_type,invoice_no,sales_category,request_note
 ) values(
   p_order_id,v_type,v_no,v_category,nullif(left(btrim(coalesce(p_note,'')),2000),'')
 ) returning id into v_request;
 insert into public.sales_document_events(sales_order_id,event_type,document_no,note,actor_user_id,metadata)
 values (p_order_id,'invoice_conversion_requested',v_no,p_note,auth.uid(),
   jsonb_build_object('request_id',v_request,'type',v_type,'category',v_category));
 return v_request;
end;
$$;

create or replace function public.get_my_sr_conversion_requests()
returns table (
 request_id uuid,sales_order_id uuid,invoice_type text,invoice_no text,
 sales_category text,status text,requested_at timestamptz,reviewed_at timestamptz,
 review_note text
) language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $$
 select r.id,r.sales_order_id,r.invoice_type,r.invoice_no,r.sales_category,
 r.status,r.requested_at,r.reviewed_at,r.review_note
 from public.sales_sr_conversion_requests r
 join public.sales_orders o on o.id=r.sales_order_id
 where auth.uid()=r.requested_by
    or (o.sales_rep_id=auth.uid() and public.current_app_role()='sales')
    or (public.current_app_role() in ('manager','admin','super_admin')
        and public.current_user_has_permission('sales_orders.convert_approve'))
 order by r.requested_at desc
 limit 1000;
$$;

create or replace function public.get_pending_sr_conversion_requests()
returns table(
 request_id uuid,sales_order_id uuid,sr_no text,customer_name text,
 sales_rep_name text,invoice_type text,invoice_no text,sales_category text,
 request_note text,requested_by_name text,requested_by uuid,requested_at timestamptz
) language sql stable security definer
set search_path to 'public','auth','pg_temp'
as $$
 select r.id,r.sales_order_id,coalesce(o.sr_no,o.order_no),
        c.name,coalesce(nullif(rep.display_name,''),o.sales_rep_name_snapshot,'Sales Rep'),
        r.invoice_type,r.invoice_no,r.sales_category,r.request_note,
        coalesce(nullif(requester.display_name,''),requester.email,'Sales'),
        r.requested_by,r.requested_at
 from public.sales_sr_conversion_requests r
 join public.sales_orders o on o.id=r.sales_order_id
 join public.customers c on c.id=o.customer_id
 left join public.app_users rep on rep.user_id=o.sales_rep_id
 left join public.app_users requester on requester.user_id=r.requested_by
 where r.status='pending'
   and public.current_app_role() in ('manager','admin','super_admin')
   and public.current_user_has_permission('sales_orders.convert_approve')
 order by r.requested_at desc;
$$;

create or replace function public.review_sr_conversion_request(
 p_request_id uuid,p_action text,p_note text default null
) returns text language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
 v_req public.sales_sr_conversion_requests%rowtype;
 v_order public.sales_orders%rowtype;
 v_action text := lower(btrim(coalesce(p_action,'')));
begin
 if public.current_app_role() not in ('manager','admin','super_admin')
   or not public.current_user_has_permission('sales_orders.convert_approve') then
   raise exception 'Sales Manager/Admin invoice conversion approval permission required';
 end if;
 if v_action not in ('approved','rejected') then raise exception 'Invalid approval action'; end if;
 select * into v_req from public.sales_sr_conversion_requests where id=p_request_id for update;
 if not found or v_req.status<>'pending' then raise exception 'Conversion request is no longer pending'; end if;
 if v_req.requested_by=auth.uid() then raise exception 'You cannot approve your own conversion request'; end if;
 select * into v_order from public.sales_orders where id=v_req.sales_order_id for update;
 if not found or v_order.sales_flow_type<>'pre_order' or v_order.status='cancelled' then
   raise exception 'SR is no longer eligible for conversion';
 end if;

 if v_action='approved' then
   if v_order.sales_invoice_no is not null then raise exception 'Final invoice already issued'; end if;
   if not exists(select 1 from public.sales_order_items where sales_order_id=v_order.id) then
     raise exception 'SR has no items';
   end if;
   if exists(
     select 1 from public.sales_order_items soi
     left join public.item_tracking it on it.sales_order_item_id=soi.id
     where soi.sales_order_id=v_order.id
       and lower(coalesce(it.status,soi.fulfillment_status,'ordered')) not in ('arrived','ready','delivered')
   ) then raise exception 'SR items are no longer all Arrived/Ready'; end if;
   if exists (select 1 from public.sales_orders where
       upper(btrim(coalesce(order_no,'')))=upper(btrim(v_req.invoice_no))
       or upper(btrim(coalesce(invoice_no,'')))=upper(btrim(v_req.invoice_no))
       or upper(btrim(coalesce(sr_no,'')))=upper(btrim(v_req.invoice_no))
       or upper(btrim(coalesce(sales_invoice_no,'')))=upper(btrim(v_req.invoice_no)))
   then raise exception 'Invoice number already exists'; end if;
   update public.sales_orders set
      sales_invoice_type=v_req.invoice_type,sales_invoice_no=v_req.invoice_no,
      sales_category=v_req.sales_category,invoice_request_status='issued',
      invoice_issued_at=now(),invoice_issued_by=auth.uid()
   where id=v_order.id;
   insert into public.sales_document_events(sales_order_id,event_type,document_no,note,actor_user_id,metadata)
   values(v_order.id,'invoice_issued',v_req.invoice_no,p_note,auth.uid(),
     jsonb_build_object('invoice_type',v_req.invoice_type,'sales_category',v_req.sales_category,
                        'conversion_request_id',v_req.id,'requested_by',v_req.requested_by));
 else
   insert into public.sales_document_events(sales_order_id,event_type,document_no,note,actor_user_id,metadata)
   values(v_order.id,'invoice_conversion_rejected',v_req.invoice_no,p_note,auth.uid(),
     jsonb_build_object('conversion_request_id',v_req.id));
 end if;
 update public.sales_sr_conversion_requests
    set status=v_action,reviewed_by=auth.uid(),reviewed_at=now(),
        review_note=nullif(left(btrim(coalesce(p_note,'')),2000),'')
    where id=v_req.id;
 return v_action;
end;
$$;

revoke all on function public.submit_sr_conversion_request(uuid,text,text,text,text) from public,anon;
revoke all on function public.get_my_sr_conversion_requests() from public,anon;
revoke all on function public.get_pending_sr_conversion_requests() from public,anon;
revoke all on function public.review_sr_conversion_request(uuid,text,text) from public,anon;
grant execute on function public.submit_sr_conversion_request(uuid,text,text,text,text) to authenticated;
grant execute on function public.get_my_sr_conversion_requests() to authenticated;
grant execute on function public.get_pending_sr_conversion_requests() to authenticated;
grant execute on function public.review_sr_conversion_request(uuid,text,text) to authenticated;
