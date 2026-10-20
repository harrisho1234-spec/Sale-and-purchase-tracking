-- Preserve every cent when a fractional currency-valued SR line is split across
-- several TK/RK invoices. The final allocation receives the remaining balance.
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='submit_sr_split_invoice';
 if v_sql is null then raise exception 'Split invoice RPC missing'; end if;
 if position('-- Final split line receives any cent rounding remainder.' in v_sql)>0 then return; end if;
 if position('if v_line_amount<0 then' in v_sql)=0 then
  raise exception 'Unexpected split invoice pricing function';
 end if;
 v_sql:=replace(v_sql,'if v_line_amount<0 then',
  '-- Final split line receives any cent rounding remainder.'||E'\n'||
  '  if v_used+v_qty=v_line.qty then'||E'\n'||
  '    v_line_amount:=round(('||
  'coalesce(v_line.line_total,v_line.qty*v_line.unit_price-coalesce(v_line.discount_amount,0))-'||
  'coalesce(v_o.order_discount,0)*'||
  'coalesce(v_line.line_total,v_line.qty*v_line.unit_price-coalesce(v_line.discount_amount,0))/'||
  'greatest((select sum(coalesce(ii.line_total,ii.qty*ii.unit_price-coalesce(ii.discount_amount,0)))'||
  ' from public.sales_order_items ii where ii.sales_order_id=p_order_id),0.01))'||
  ',2)-coalesce((select sum(l.line_total) from public.sales_sr_invoice_part_lines l'||
  ' join public.sales_sr_invoice_parts h on h.id=l.invoice_part_id'||
  ' where l.sales_order_item_id=v_line.id and h.status in (''pending'',''issued'')),0);'||E'\n'||
  '  end if;'||E'\n  '||
  'if v_line_amount<0 then');
 execute v_sql;
end $block$;