
-- Do not permit legacy Admin "Issue TK/RK" RPC to skip a pending Sales conversion approval.
create or replace function public.issue_sales_invoice_v2(
 p_order_id uuid,p_invoice_type text,p_invoice_no text,p_sales_category text,p_note text default null
) returns public.sales_orders language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
 v_type text:=upper(trim(coalesce(p_invoice_type,'')));
 v_no text:=upper(trim(coalesce(p_invoice_no,'')));
 v_category text:=lower(trim(coalesce(p_sales_category,'standard')));
 v_order public.sales_orders%rowtype;
 v_result public.sales_orders%rowtype;
begin
 if not public.is_admin_or_super() then raise exception 'Admin access required'; end if;
 if v_type not in ('TK','RK') then raise exception 'Invoice type must be TK or RK'; end if;
 if v_category not in ('standard','project') then raise exception 'Sales category must be Standard or Project'; end if;
 if v_no='' or v_no !~ '^[A-Z0-9/-]+$' then raise exception 'Valid invoice number is required'; end if;
 if v_no not like v_type||'%' then raise exception 'Invoice number must begin with %',v_type; end if;
 select * into v_order from public.sales_orders where id=p_order_id for update;
 if not found then raise exception 'Sales order not found'; end if;
 if v_order.sales_flow_type<>'pre_order' or v_order.status='cancelled' then raise exception 'Only an active SR can be invoiced'; end if;
 if v_order.sales_invoice_no is not null then raise exception 'Final TK/RK is already issued'; end if;
 if exists(select 1 from public.sales_sr_conversion_requests where sales_order_id=p_order_id and status='pending') then
   raise exception 'A Sales TK/RK conversion is awaiting review. Approve or reject it in Approvals instead of issuing directly';
 end if;
 if exists(select 1 from public.sales_orders where
    upper(btrim(coalesce(order_no,'')))=v_no or
    upper(btrim(coalesce(invoice_no,'')))=v_no or
    upper(btrim(coalesce(sr_no,'')))=v_no or
    upper(btrim(coalesce(sales_invoice_no,'')))=v_no
 ) then raise exception 'Invoice number already exists'; end if;
 update public.sales_orders set
  sales_invoice_type=v_type,sales_invoice_no=v_no,sales_category=v_category,
  invoice_request_status='issued',invoice_issued_at=now(),invoice_issued_by=auth.uid()
 where id=p_order_id returning * into v_result;
 insert into public.sales_document_events(
  sales_order_id,event_type,document_no,note,actor_user_id,metadata
 ) values(p_order_id,'invoice_issued',v_no,p_note,auth.uid(),
 jsonb_build_object('invoice_type',v_type,'sales_category',v_category));
 return v_result;
end;
$$;
create or replace function public.issue_sales_invoice(
 p_order_id uuid,p_invoice_type text,p_invoice_no text,p_note text default null
) returns public.sales_orders language plpgsql security definer
set search_path to 'public','pg_temp'
as $$
declare
 v_category text;
begin
 select coalesce(sales_category,'standard') into v_category
 from public.sales_orders where id=p_order_id;
 return public.issue_sales_invoice_v2(p_order_id,p_invoice_type,p_invoice_no,v_category,p_note);
end;
$$;
revoke all on function public.issue_sales_invoice_v2(uuid,text,text,text,text) from public,anon;
revoke all on function public.issue_sales_invoice(uuid,text,text,text) from public,anon;
grant execute on function public.issue_sales_invoice_v2(uuid,text,text,text,text) to authenticated;
grant execute on function public.issue_sales_invoice(uuid,text,text,text) to authenticated;
