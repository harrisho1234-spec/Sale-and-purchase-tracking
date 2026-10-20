
-- Protect SR final invoice fields from direct Sales updates through PostgREST.
-- Normal stock-sale creation (TK/RK) remains supported.
create or replace function public.guard_sales_sr_invoice_issuance()
returns trigger language plpgsql security definer
set search_path to 'public','auth','pg_temp'
as $$
declare
 v_is_sr boolean;
begin
 if public.current_app_role() <> 'sales' then return NEW; end if;
 if TG_OP='INSERT' then
   v_is_sr := coalesce(NEW.sales_flow_type,NEW.order_type,'')='pre_order'
               or coalesce(NEW.sr_no,'') ilike 'SR%';
   if v_is_sr and
     (NEW.sales_invoice_no is not null or NEW.sales_invoice_type is not null
       or NEW.invoice_issued_at is not null or NEW.invoice_issued_by is not null
       or NEW.invoice_request_status='issued') then
     raise exception 'SR pre-orders require Manager/Admin approval before final TK/RK issuance';
   end if;
 else
   if OLD.sales_flow_type='pre_order' or OLD.order_type='pre_order'
       or coalesce(OLD.sr_no,'') ilike 'SR%' then
     if NEW.sales_flow_type is distinct from OLD.sales_flow_type
       or NEW.sales_invoice_no is distinct from OLD.sales_invoice_no
       or NEW.sales_invoice_type is distinct from OLD.sales_invoice_type
       or NEW.invoice_no is distinct from OLD.invoice_no
       or NEW.invoice_issued_at is distinct from OLD.invoice_issued_at
       or NEW.invoice_issued_by is distinct from OLD.invoice_issued_by
       or (NEW.invoice_request_status='issued'
           and OLD.invoice_request_status is distinct from 'issued') then
       raise exception 'Sales cannot issue or directly convert an SR to TK/RK. Submit a conversion approval request';
     end if;
   end if;
 end if;
 return NEW;
end;
$$;
drop trigger if exists guard_sales_sr_invoice_issuance on public.sales_orders;
create trigger guard_sales_sr_invoice_issuance
 before insert or update on public.sales_orders
 for each row execute function public.guard_sales_sr_invoice_issuance();
revoke all on function public.guard_sales_sr_invoice_issuance() from public,anon,authenticated;
