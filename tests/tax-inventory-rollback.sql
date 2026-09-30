begin;
select set_config('test.tax_users',(select jsonb_agg(jsonb_build_object('id',user_id,'role',role))::text from public.app_users where active),true);
set local role authenticated;
do $$
declare users jsonb:=current_setting('test.tax_users')::jsonb; u jsonb; admin_id uuid;
  p public.product_catalog; p2 public.product_catalog; args jsonb; old_balance jsonb; old_count bigint; result integer;
begin
  select (x->>'id')::uuid into admin_id from jsonb_array_elements(users) x where x->>'role'='super_admin' limit 1;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  select * into p from public.product_catalog where active order by id limit 1;
  select * into p2 from public.product_catalog where active and id<>p.id order by id limit 1;
  select to_jsonb(b) into old_balance from public.inventory_product_balance b where product_id=p.id;
  select count(*) into old_count from public.stock_movements;
  args:=jsonb_build_array(jsonb_build_object('product_id',p.id,'code',p.code,'tax_item',true,'tax_group_or_set','TEST ROLLBACK','tax_note','Verification only','expected_tax_updated_at',p.tax_updated_at));
  result:=public.set_product_tax_metadata(args);
  if result<>1 then raise exception 'Expected one updated product'; end if;
  if not exists(select 1 from public.product_catalog where id=p.id and tax_item and tax_updated_by=admin_id and tax_updated_at is not null) then raise exception 'Audit or update failed'; end if;
  if not exists(select 1 from public.tax_inventory where product_id=p.id) then raise exception 'Tax mirror missing product'; end if;
  if old_balance is distinct from (select to_jsonb(b) from public.inventory_product_balance b where product_id=p.id) then raise exception 'Balance changed'; end if;
  if old_count<>(select count(*) from public.stock_movements) then raise exception 'Ledger changed'; end if;
  begin perform public.set_product_tax_metadata(args);raise exception 'Stale update accepted'; exception when serialization_failure then null; end;
  -- A failure on any row must roll back the entire batch.
  args:=jsonb_build_array(jsonb_build_object('product_id',p2.id,'code',p2.code,'tax_item',true,'expected_tax_updated_at',p2.tax_updated_at),jsonb_build_object('product_id',p.id,'code',p.code,'tax_item',false,'expected_tax_updated_at',null));
  begin perform public.set_product_tax_metadata(args);raise exception 'Invalid batch accepted'; exception when serialization_failure then null; end;
  if (select tax_item from public.product_catalog where id=p2.id) is distinct from p2.tax_item then raise exception 'Partial batch committed'; end if;
  for u in select value from jsonb_array_elements(users) where value->>'role'<>'super_admin' loop
    perform set_config('request.jwt.claim.sub',u->>'id',true);
    perform set_config('request.jwt.claims',jsonb_build_object('sub',u->>'id','role','authenticated')::text,true);
    begin perform public.set_product_tax_metadata(args);raise exception 'Non-super-admin RPC accepted'; exception when insufficient_privilege then null; end;
    begin
      update public.product_catalog set tax_item=false where id=p.id;
      if found then raise exception 'Non-super-admin direct update accepted'; end if;
    exception when insufficient_privilege then null; end;
  end loop;
  perform set_config('request.jwt.claim.sub',admin_id::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',admin_id,'role','authenticated')::text,true);
  -- Audit fields cannot be spoofed even by the permitted editor.
  update public.product_catalog set tax_updated_by=null,tax_updated_at=null where id=p.id;
  if not exists(select 1 from public.product_catalog where id=p.id and tax_updated_by=admin_id and tax_updated_at is not null) then raise exception 'Audit spoof accepted'; end if;
  args:=jsonb_build_array(jsonb_build_object('product_id',p.id,'code',p.code,'tax_item',false,'expected_tax_updated_at',(select tax_updated_at from public.product_catalog where id=p.id)));
  perform public.set_product_tax_metadata(args);
  if exists(select 1 from public.tax_inventory where product_id=p.id) then raise exception 'Untag did not remove mirror row'; end if;
end $$;
reset role;
rollback;
select 'PASS: Super Admin update and audit, all other active roles denied, stale previews rejected, atomic batch, untag, unchanged ledger; all test writes rolled back' result;
