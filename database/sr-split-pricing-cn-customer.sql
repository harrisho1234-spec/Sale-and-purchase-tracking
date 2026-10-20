-- Include customer identity in the warehouse CN queue and apply original SR-level
-- discount proportionally across independently numbered TK/RK invoices.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_cn_stock_receipt_queue';
 if v_sql is null then raise exception 'CN queue RPC missing'; end if;
 if position('''customer_name'',cust.name' in v_sql)=0 then
  if position('''return_date'',cn.return_date' in v_sql)=0 or
     position('from public.sales_return_items r join public.sales_returns cn on cn.id=r.sales_return_id' in v_sql)=0
     then raise exception 'Unexpected CN queue SQL; no changes made'; end if;
  v_sql:=replace(v_sql,
   '''return_date'',cn.return_date',
   '''return_date'',cn.return_date,''customer_name'',cust.name');
  v_sql:=replace(v_sql,
   'from public.sales_return_items r join public.sales_returns cn on cn.id=r.sales_return_id',
   'from public.sales_return_items r join public.sales_returns cn on cn.id=r.sales_return_id '||
   'left join public.customers cust on cust.id=cn.customer_id');
  execute v_sql;
 end if;
end $block$;

do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on p.pronamespace=n.oid
 where n.nspname='public' and p.proname='submit_sr_split_invoice';
 if v_sql is null then raise exception 'Split invoice RPC missing'; end if;
 if position('coalesce(v_o.order_discount,0)' in v_sql)>0 then return; end if;
 if position(
  'v_line_amount:=round(coalesce(v_line.line_total,v_line.qty*v_line.unit_price-coalesce(v_line.discount_amount,0))*v_qty/v_line.qty,2);'
  in v_sql)=0 then raise exception 'Unexpected split invoice value formula'; end if;
 v_sql:=replace(v_sql,
  'v_line_amount:=round(coalesce(v_line.line_total,v_line.qty*v_line.unit_price-coalesce(v_line.discount_amount,0))*v_qty/v_line.qty,2);',
  'v_line_amount:=round(('||
   'coalesce(v_line.line_total,v_line.qty*v_line.unit_price-coalesce(v_line.discount_amount,0))-'||
   'coalesce(v_o.order_discount,0)*'||
   'coalesce(v_line.line_total,v_line.qty*v_line.unit_price-coalesce(v_line.discount_amount,0))/'||
   'greatest((select sum(coalesce(ii.line_total,ii.qty*ii.unit_price-coalesce(ii.discount_amount,0))) '||
   'from public.sales_order_items ii where ii.sales_order_id=p_order_id),0.01)'||
   ')*v_qty/v_line.qty,2);');
 execute v_sql;
end $block$;

do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on p.pronamespace=n.oid
 where n.nspname='public' and p.proname='get_sr_split_invoice_summary';
 if v_sql is null then raise exception 'Split summary RPC missing'; end if;
 if position('''order_discount'',v_o.order_discount' in v_sql)=0 then
  if position('''sr_id'',p_order_id' in v_sql)=0 then raise exception 'Unexpected summary RPC'; end if;
  v_sql:=replace(v_sql,'''sr_id'',p_order_id',
    '''sr_id'',p_order_id,''order_discount'',v_o.order_discount');
  execute v_sql;
 end if;
end $block$;