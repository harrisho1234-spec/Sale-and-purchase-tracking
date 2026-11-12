begin;
select set_config('test.users',(select jsonb_agg(jsonb_build_object('id',user_id,'role',role))::text from public.app_users where active),true);
select set_config('test.alias',(select code from public.product_code_aliases limit 1),true);
select set_config('test.ledger',(select count(*)::text from public.stock_movements),true);
set local role authenticated;
do $$
declare u jsonb; pid uuid; poid uuid; lineid uuid; x record; saved jsonb; total integer; before_count bigint; blocked boolean; superid text;
begin
 for u in select value from jsonb_array_elements(current_setting('test.users')::jsonb) loop
  perform set_config('request.jwt.claim.sub',u->>'id',true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u->>'id','role','authenticated')::text,true);
  if u->>'role' in ('admin','super_admin') then
   insert into public.product_catalog(code,item_name,stock_qty,source_system,manual_override)
    values('ROLLBACK-'||gen_random_uuid(),'Rollback verification',0,'app_created',true) returning id into pid;
   insert into public.product_admin_details(product_id,location) values(pid,'Verification');
   insert into public.product_costs(product_id,unit_cost,shipping_cost,landed_cost,cost_currency) values(pid,1,1,2,'USD');
   if not exists(select 1 from public.product_code_aliases) then raise exception 'Admin alias check cannot see reserved codes'; end if;
   begin
    insert into public.product_catalog(code,item_name) values(current_setting('test.alias'),'Alias reuse');
    raise exception 'Alias reuse allowed';
   exception when unique_violation then null; end;
   begin insert into public.product_code_aliases(code,product_id) values('FORBIDDEN',pid);raise exception 'Alias write allowed';exception when insufficient_privilege then null;end;
   insert into public.supplier_pos(po_number,vendor_name,po_document_name,po_document_path)
    values('ROLLBACK-'||gen_random_uuid(),'Verification','uploaded.pdf','verification/uploaded.pdf') returning id into poid;
   insert into public.supplier_po_items(supplier_po_id,product_id,product_code_snapshot,item_name_snapshot,qty)
    select poid,pid,code,item_name,2 from public.product_catalog where id=pid returning id into lineid;
   update public.supplier_pos set notes='Edited uploaded PO',po_document_name='replacement.pdf',po_document_path='verification/replacement.pdf' where id=poid;
   if not found then raise exception 'PO edit silently denied'; end if;
   update public.supplier_po_items set unit_cost=3,qty=3 where id=lineid;
   if not found then raise exception 'Unreceived PO line edit denied'; end if;
   if u->>'role'='admin' then
    begin insert into public.product_catalog(code,item_name,stock_qty) values('FORBIDDEN-'||gen_random_uuid(),'Manual initial stock',1);raise exception 'Admin initial stock allowed';exception when insufficient_privilege then null;end;
    begin update public.product_catalog set stock_qty=1 where id=pid;raise exception 'Admin direct quantity allowed';exception when insufficient_privilege then null;end;
    blocked:=false;begin perform public.superadmin_increase_product_qty(pid,null,1,'Rollback verification',gen_random_uuid());exception when others then blocked:=sqlerrm like '%Super Admin%';end;
    if not blocked then raise exception 'Admin increase RPC not denied';end if;
    blocked:=false;begin perform public.superadmin_archive_product(pid,'Rollback verification');exception when others then blocked:=sqlerrm like '%Super Admin%';end;
    if not blocked then raise exception 'Admin archive not denied';end if;
    delete from public.product_catalog where id=pid;
    if found then raise exception 'Admin physical deletion allowed'; end if;
   end if;
  else
   begin insert into public.product_catalog(code,item_name) values('FORBIDDEN-'||gen_random_uuid(),'Other role');raise exception 'Other role product create allowed: %',u->>'role';exception when insufficient_privilege then null;end;
   begin insert into public.supplier_pos(po_number,vendor_name) values('FORBIDDEN-'||gen_random_uuid(),'Other role');raise exception 'Other role PO create allowed';exception when insufficient_privilege then null;end;
   update public.supplier_pos set notes='forbidden' where id=poid;
   if found then raise exception 'Other role PO edit allowed';end if;
   if exists(select 1 from public.product_code_aliases) then raise exception 'Other role alias read allowed';end if;
  end if;
 end loop;
 -- Test real received/historical/linked rows without persisting any changes.
 select value->>'id' into superid from jsonb_array_elements(current_setting('test.users')::jsonb) where value->>'role'='admin' limit 1;
 perform set_config('request.jwt.claim.sub',superid,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',superid,'role','authenticated')::text,true);
 total:=0;
 for x in select i.* from public.supplier_po_items i where i.historical_stock_reconciled
   or exists(select 1 from public.fulfillment_links f where f.supplier_po_item_id=i.id)
   or exists(select 1 from public.stock_movements m where m.movement_type='po_receipt' and m.reference_type='supplier_po_item' and m.reference_item_id=i.id)
 loop
  saved:=to_jsonb(x);
  update public.supplier_po_items set unit_cost=unit_cost+0.01 where id=x.id;
  if not found then raise exception 'Protected line cost edit failed';end if;
  blocked:=false;begin update public.supplier_po_items set qty=qty+1 where id=x.id;exception when others then blocked:=sqlerrm like '%PO item%' or sqlerrm like '%SR%';end;
  if not blocked then raise exception 'Protected line quantity changed';end if;
  blocked:=false;begin delete from public.supplier_po_items where id=x.id;exception when others then blocked:=sqlerrm like '%PO item%' or sqlerrm like '%SR%';end;
  if not blocked then raise exception 'Protected line deleted';end if;
  if exists(select 1 from public.supplier_po_items where id=x.id and (product_id is distinct from x.product_id or qty<>x.qty or procurement_status<>x.procurement_status)) then raise exception 'Line history changed';end if;
  total:=total+1;
 end loop;
 if total=0 then raise exception 'No protected PO fixtures tested';end if;
 if (select count(*) from public.stock_movements)<>current_setting('test.ledger')::bigint then raise exception 'Stock movements changed';end if;
end $$;
reset role;
rollback;
select 'PASS: all active roles; Admin/Super Admin product + uploaded PO edits; alias reuse/write blocked; Admin initial/manual stock and archive/delete denied; received/historical/SR-linked line costs editable, qty/delete denied; ledger unchanged; all writes rolled back' result;
