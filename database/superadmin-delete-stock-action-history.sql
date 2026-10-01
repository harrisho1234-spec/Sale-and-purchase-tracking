create or replace function public.superadmin_delete_stock_action_history(p_request_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public','auth','pg_temp'
as $function$
declare
  v_row public.stock_action_requests%rowtype;
begin
  if public.current_app_role()<>'super_admin' then
    raise exception 'Super Admin access required';
  end if;

  select * into v_row
  from public.stock_action_requests
  where id=p_request_id
  for update;

  if not found then
    return true;
  end if;

  if v_row.status='pending' then
    raise exception 'Pending stock approval requests cannot be deleted. Approve or reject the request first.';
  end if;

  delete from public.stock_action_requests
  where id=p_request_id;

  return true;
end;
$function$;

revoke all on function public.superadmin_delete_stock_action_history(uuid) from public;
revoke all on function public.superadmin_delete_stock_action_history(uuid) from anon;
grant execute on function public.superadmin_delete_stock_action_history(uuid) to authenticated;
