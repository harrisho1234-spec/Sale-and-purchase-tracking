-- sales_order_items.line_total is GENERATED ALWAYS. The SR gift insert
-- must leave it to the database (zero price and discount yield zero total).
do $block$
declare v_sql text;
begin
 select pg_get_functiondef(p.oid) into v_sql from pg_proc p
 join pg_namespace n on n.oid=p.pronamespace
 where n.nspname='public' and p.proname='finalize_sr_invoice_free_gifts';
 if v_sql is null then raise exception 'Gift finalization function missing'; end if;
 if position('image_url_snapshot,qty,unit_price,discount_amount,line_total,source_type,' in v_sql)>0 then
  v_sql:=replace(v_sql,
   'image_url_snapshot,qty,unit_price,discount_amount,line_total,source_type,',
   'image_url_snapshot,qty,unit_price,discount_amount,source_type,');
  v_sql:=replace(v_sql,
   'g.product_image_url,g.qty,0,0,0,''stock'',',
   'g.product_image_url,g.qty,0,0,''stock'',');
  execute v_sql;
 end if;
end $block$;