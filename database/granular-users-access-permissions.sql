-- Flexible Users & Access permission builder.
-- Existing app roles remain reusable templates; individual users can store only permission overrides.

create table if not exists public.app_access_role_templates (
  role_key text primary key,
  display_name text not null,
  permissions jsonb not null default '{}'::jsonb,
  restrict_assigned_customers boolean not null default false,
  active boolean not null default true,
  updated_by uuid null references public.app_users(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_access_role_permissions_object check (jsonb_typeof(permissions)='object')
);

create table if not exists public.app_user_access_overrides (
  user_id uuid primary key references public.app_users(user_id) on delete cascade,
  permissions jsonb not null default '{}'::jsonb,
  restrict_assigned_customers boolean null,
  updated_by uuid null references public.app_users(user_id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint app_user_access_permissions_object check (jsonb_typeof(permissions)='object')
);

create table if not exists public.app_access_audit (
  id uuid primary key default gen_random_uuid(),
  target_type text not null check (target_type in ('role','user')),
  target_key text not null,
  before_state jsonb null,
  after_state jsonb null,
  changed_by uuid null references public.app_users(user_id) on delete set null,
  changed_at timestamptz not null default now()
);

alter table public.app_access_role_templates enable row level security;
alter table public.app_user_access_overrides enable row level security;
alter table public.app_access_audit enable row level security;

drop policy if exists access_roles_superadmin on public.app_access_role_templates;
create policy access_roles_superadmin on public.app_access_role_templates
for all to authenticated using (coalesce(public.is_super_admin(),false))
with check (coalesce(public.is_super_admin(),false));

drop policy if exists access_overrides_superadmin on public.app_user_access_overrides;
create policy access_overrides_superadmin on public.app_user_access_overrides
for all to authenticated using (coalesce(public.is_super_admin(),false))
with check (coalesce(public.is_super_admin(),false));

drop policy if exists access_audit_superadmin on public.app_access_audit;
create policy access_audit_superadmin on public.app_access_audit
for select to authenticated using (coalesce(public.is_super_admin(),false));

insert into public.app_access_role_templates(role_key,display_name,permissions,restrict_assigned_customers,active)
values
('accountant','Accountant','{"reports.view":true,"returns.edit":false,"returns.view":true,"users.manage":false,"payments.edit":true,"payments.view":true,"products.edit":false,"products.view":true,"tracking.edit":false,"tracking.view":true,"approvals.view":false,"customers.edit":false,"customers.view":true,"inventory.view":true,"reports.export":true,"returns.create":false,"sales.view_all":true,"finance.ar_view":true,"inventory.count":false,"payments.create":true,"products.create":false,"products.delete":false,"returns.approve":false,"approvals.manage":false,"customers.create":false,"customers.delete":false,"payments.approve":false,"procurement.view":false,"inventory.approve":false,"inventory.operate":false,"inventory.reports":true,"products.tax_view":false,"sales_orders.edit":false,"sales_orders.view":true,"activity_logs.view":false,"inventory.transfer":false,"sales_orders.print":false,"inventory.reconcile":false,"procurement.po_edit":false,"products.tax_manage":false,"sales_access.manage":false,"sales_orders.create":false,"sales_orders.delete":false,"sales_orders.export":false,"procurement.shipping":false,"procurement.po_create":false,"procurement.po_delete":false,"procurement.po_receive":false,"stock_locations.manage":false,"finance.payment_records":true,"procurement.allocations":false,"finance.cost_margin_view":true,"procurement.vendor_manage":false,"procurement.supplier_payments":false,"procurement.historical_reconcile":false}'::jsonb,false,true),
('admin','Admin','{"reports.view":true,"returns.edit":true,"returns.view":true,"users.manage":false,"payments.edit":true,"payments.view":true,"products.edit":true,"products.view":true,"tracking.edit":true,"tracking.view":true,"approvals.view":true,"customers.edit":true,"customers.view":true,"inventory.view":true,"reports.export":true,"returns.create":true,"sales.view_all":true,"finance.ar_view":true,"inventory.count":true,"payments.create":true,"products.create":true,"products.delete":true,"returns.approve":true,"approvals.manage":true,"customers.create":true,"customers.delete":true,"payments.approve":true,"procurement.view":true,"inventory.approve":true,"inventory.operate":true,"inventory.reports":true,"products.tax_view":true,"sales_orders.edit":true,"sales_orders.view":true,"activity_logs.view":false,"inventory.transfer":true,"sales_orders.print":true,"inventory.reconcile":true,"procurement.po_edit":true,"products.tax_manage":false,"sales_access.manage":true,"sales_orders.create":true,"sales_orders.delete":true,"sales_orders.export":true,"procurement.shipping":true,"procurement.po_create":true,"procurement.po_delete":true,"procurement.po_receive":true,"stock_locations.manage":true,"finance.payment_records":true,"procurement.allocations":true,"finance.cost_margin_view":true,"procurement.vendor_manage":true,"procurement.supplier_payments":true,"procurement.historical_reconcile":true}'::jsonb,false,true),
('manager','Manager','{"reports.view":true,"returns.edit":true,"returns.view":true,"users.manage":false,"payments.edit":true,"payments.view":true,"products.edit":false,"products.view":true,"tracking.edit":true,"tracking.view":true,"approvals.view":true,"customers.edit":true,"customers.view":true,"inventory.view":true,"reports.export":true,"returns.create":true,"sales.view_all":true,"finance.ar_view":true,"inventory.count":false,"payments.create":true,"products.create":false,"products.delete":false,"returns.approve":false,"approvals.manage":true,"customers.create":true,"customers.delete":false,"payments.approve":false,"procurement.view":false,"inventory.approve":false,"inventory.operate":false,"inventory.reports":true,"products.tax_view":false,"sales_orders.edit":true,"sales_orders.view":true,"activity_logs.view":false,"inventory.transfer":false,"sales_orders.print":true,"inventory.reconcile":false,"procurement.po_edit":false,"products.tax_manage":false,"sales_access.manage":true,"sales_orders.create":true,"sales_orders.delete":false,"sales_orders.export":true,"procurement.shipping":false,"procurement.po_create":false,"procurement.po_delete":false,"procurement.po_receive":false,"stock_locations.manage":false,"finance.payment_records":false,"procurement.allocations":false,"finance.cost_margin_view":false,"procurement.vendor_manage":false,"procurement.supplier_payments":false,"procurement.historical_reconcile":false}'::jsonb,false,true),
('sales','Sales','{"reports.view":true,"returns.edit":false,"returns.view":true,"users.manage":false,"payments.edit":false,"payments.view":true,"products.edit":false,"products.view":true,"tracking.edit":true,"tracking.view":true,"approvals.view":false,"customers.edit":true,"customers.view":true,"inventory.view":false,"reports.export":false,"returns.create":true,"sales.view_all":false,"finance.ar_view":false,"inventory.count":false,"payments.create":false,"products.create":false,"products.delete":false,"returns.approve":false,"approvals.manage":false,"customers.create":true,"customers.delete":false,"payments.approve":false,"procurement.view":false,"inventory.approve":false,"inventory.operate":false,"inventory.reports":false,"products.tax_view":false,"sales_orders.edit":true,"sales_orders.view":true,"activity_logs.view":false,"inventory.transfer":false,"sales_orders.print":true,"inventory.reconcile":false,"procurement.po_edit":false,"products.tax_manage":false,"sales_access.manage":false,"sales_orders.create":true,"sales_orders.delete":false,"sales_orders.export":false,"procurement.shipping":false,"procurement.po_create":false,"procurement.po_delete":false,"procurement.po_receive":false,"stock_locations.manage":false,"finance.payment_records":false,"procurement.allocations":false,"finance.cost_margin_view":false,"procurement.vendor_manage":false,"procurement.supplier_payments":false,"procurement.historical_reconcile":false}'::jsonb,true,true),
('stock_controller','Stock Controller','{"reports.view":false,"returns.edit":false,"returns.view":false,"users.manage":false,"payments.edit":false,"payments.view":false,"products.edit":false,"products.view":true,"tracking.edit":false,"tracking.view":false,"approvals.view":false,"customers.edit":false,"customers.view":false,"inventory.view":true,"reports.export":false,"returns.create":false,"sales.view_all":false,"finance.ar_view":false,"inventory.count":true,"payments.create":false,"products.create":false,"products.delete":false,"returns.approve":false,"approvals.manage":false,"customers.create":false,"customers.delete":false,"payments.approve":false,"procurement.view":true,"inventory.approve":false,"inventory.operate":true,"inventory.reports":true,"products.tax_view":false,"sales_orders.edit":false,"sales_orders.view":false,"activity_logs.view":false,"inventory.transfer":true,"sales_orders.print":false,"inventory.reconcile":false,"procurement.po_edit":false,"products.tax_manage":false,"sales_access.manage":false,"sales_orders.create":false,"sales_orders.delete":false,"sales_orders.export":false,"procurement.shipping":false,"procurement.po_create":false,"procurement.po_delete":false,"procurement.po_receive":true,"stock_locations.manage":false,"finance.payment_records":false,"procurement.allocations":false,"finance.cost_margin_view":false,"procurement.vendor_manage":false,"procurement.supplier_payments":false,"procurement.historical_reconcile":false}'::jsonb,false,true),
('super_admin','Super Admin','{"reports.view":true,"returns.edit":true,"returns.view":true,"users.manage":true,"payments.edit":true,"payments.view":true,"products.edit":true,"products.view":true,"tracking.edit":true,"tracking.view":true,"approvals.view":true,"customers.edit":true,"customers.view":true,"inventory.view":true,"reports.export":true,"returns.create":true,"sales.view_all":true,"finance.ar_view":true,"inventory.count":true,"payments.create":true,"products.create":true,"products.delete":true,"returns.approve":true,"approvals.manage":true,"customers.create":true,"customers.delete":true,"payments.approve":true,"procurement.view":true,"inventory.approve":true,"inventory.operate":true,"inventory.reports":true,"products.tax_view":true,"sales_orders.edit":true,"sales_orders.view":true,"activity_logs.view":true,"inventory.transfer":true,"sales_orders.print":true,"inventory.reconcile":true,"procurement.po_edit":true,"products.tax_manage":true,"sales_access.manage":true,"sales_orders.create":true,"sales_orders.delete":true,"sales_orders.export":true,"procurement.shipping":true,"procurement.po_create":true,"procurement.po_delete":true,"procurement.po_receive":true,"stock_locations.manage":true,"finance.payment_records":true,"procurement.allocations":true,"finance.cost_margin_view":true,"procurement.vendor_manage":true,"procurement.supplier_payments":true,"procurement.historical_reconcile":true}'::jsonb,false,true)
on conflict (role_key) do update set
  display_name=excluded.display_name,
  permissions=excluded.permissions,
  restrict_assigned_customers=excluded.restrict_assigned_customers,
  active=excluded.active;


CREATE OR REPLACE FUNCTION public.can_admin_inventory()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('inventory.approve')
$function$
;

CREATE OR REPLACE FUNCTION public.can_edit_customer(p_customer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('customers.edit')
    and (
      public.can_view_all_sales()
      or exists (
        select 1 from public.customers c
        where c.id=p_customer_id
          and (c.assigned_sales_id=auth.uid() or c.created_by=auth.uid())
      )
      or public.has_active_customer_grant(p_customer_id,true)
      or exists (
        select 1 from public.sales_orders so
        where so.customer_id=p_customer_id
          and public.has_active_order_grant(so.id,true)
      )
    )
$function$
;

CREATE OR REPLACE FUNCTION public.can_edit_sales_order(p_order_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('sales_orders.edit')
    and (
      public.can_view_all_sales()
      or exists (
        select 1
        from public.sales_orders so
        left join public.customers c on c.id=so.customer_id
        where so.id=p_order_id
          and (
            so.sales_rep_id=auth.uid()
            or c.assigned_sales_id=auth.uid()
            or c.created_by=auth.uid()
          )
      )
      or public.has_active_order_grant(p_order_id,true)
      or exists (
        select 1
        from public.sales_orders so
        where so.id=p_order_id
          and public.has_active_customer_grant(so.customer_id,true)
      )
    )
$function$
;

CREATE OR REPLACE FUNCTION public.can_insert_sales_order_for_customer(p_customer_id uuid, p_sales_rep_id uuid, p_created_by uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  select public.current_user_has_permission('sales_orders.create')
    and (
      public.can_view_all_sales()
      or (
        p_sales_rep_id=auth.uid()
        and p_created_by=auth.uid()
        and exists(
          select 1
          from public.customers c
          where c.id=p_customer_id
            and c.active=true
            and c.review_status in ('approved','pending')
            and (
              c.assigned_sales_id=auth.uid()
              or c.created_by=auth.uid()
              or public.has_active_customer_grant(c.id,true)
            )
        )
      )
    )
$function$
;

CREATE OR REPLACE FUNCTION public.can_manage_sales_access()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('sales_access.manage')
$function$
;

CREATE OR REPLACE FUNCTION public.can_operate_inventory()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('inventory.operate')
$function$
;

CREATE OR REPLACE FUNCTION public.can_reconcile_inventory()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('inventory.reconcile')
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_all_sales()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('sales.view_all')
     and not public.current_user_restrict_assigned_customers()
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_customer(p_customer_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('customers.view')
    and (
      public.can_view_all_sales()
      or exists (
        select 1 from public.customers c
        where c.id=p_customer_id
          and (c.assigned_sales_id=auth.uid() or c.created_by=auth.uid())
      )
      or public.has_active_customer_grant(p_customer_id,false)
      or exists (
        select 1 from public.sales_orders so
        where so.customer_id=p_customer_id
          and public.has_active_order_grant(so.id,false)
      )
    )
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_inventory()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('inventory.view')
$function$
;

CREATE OR REPLACE FUNCTION public.can_view_sales_order(p_order_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  select public.current_user_has_permission('sales_orders.view')
    and (
      public.can_view_all_sales()
      or exists (
        select 1
        from public.sales_orders so
        left join public.customers c on c.id=so.customer_id
        where so.id=p_order_id
          and (
            so.sales_rep_id=auth.uid()
            or c.assigned_sales_id=auth.uid()
            or c.created_by=auth.uid()
          )
      )
      or public.has_active_order_grant(p_order_id,false)
      or exists (
        select 1
        from public.sales_orders so
        where so.id=p_order_id
          and public.has_active_customer_grant(so.customer_id,false)
      )
    )
$function$
;

CREATE OR REPLACE FUNCTION public.clear_user_access_override(p_user_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_before jsonb;
begin
  if not coalesce(public.is_super_admin(),false) then
    raise exception 'Super Admin access required';
  end if;

  select to_jsonb(o) into v_before
  from public.app_user_access_overrides o
  where o.user_id=p_user_id;

  delete from public.app_user_access_overrides
  where user_id=p_user_id;

  insert into public.app_access_audit(target_type,target_key,before_state,after_state,changed_by)
  values('user',p_user_id::text,v_before,null,auth.uid());
end
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_has_permission(p_permission text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  with me as (
    select user_id,role
    from public.app_users
    where user_id=auth.uid() and active=true
  ),
  resolved as (
    select
      me.role,
      rt.permissions role_permissions,
      uo.permissions override_permissions
    from me
    left join public.app_access_role_templates rt
      on rt.role_key=me.role and rt.active=true
    left join public.app_user_access_overrides uo
      on uo.user_id=me.user_id
  )
  select coalesce((
    select case
      when role='super_admin' then true
      when coalesce(override_permissions,'{}'::jsonb) ? p_permission
        then coalesce((override_permissions->>p_permission)::boolean,false)
      else coalesce((role_permissions->>p_permission)::boolean,false)
    end
    from resolved
  ),false)
$function$
;

CREATE OR REPLACE FUNCTION public.current_user_restrict_assigned_customers()
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
  select coalesce((
    select coalesce(uo.restrict_assigned_customers,rt.restrict_assigned_customers,false)
    from public.app_users u
    left join public.app_access_role_templates rt
      on rt.role_key=u.role and rt.active=true
    left join public.app_user_access_overrides uo
      on uo.user_id=u.user_id
    where u.user_id=auth.uid() and u.active=true
  ),true)
$function$
;

CREATE OR REPLACE FUNCTION public.get_access_admin_snapshot()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_roles jsonb;
  v_overrides jsonb;
  v_audit jsonb;
begin
  if not coalesce(public.is_super_admin(),false) then
    raise exception 'Super Admin access required';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by
    case r.role_key
      when 'super_admin' then 1 when 'admin' then 2 when 'manager' then 3
      when 'accountant' then 4 when 'stock_controller' then 5 when 'sales' then 6 else 99 end
  ),'[]'::jsonb)
  into v_roles
  from public.app_access_role_templates r
  where r.active=true;

  select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb)
  into v_overrides
  from public.app_user_access_overrides o;

  select coalesce(jsonb_agg(to_jsonb(a) order by a.changed_at desc),'[]'::jsonb)
  into v_audit
  from (
    select *
    from public.app_access_audit
    order by changed_at desc
    limit 100
  ) a;

  return jsonb_build_object(
    'roles',v_roles,
    'overrides',v_overrides,
    'audit',v_audit
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.get_my_effective_access()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_user public.app_users%rowtype;
  v_role public.app_access_role_templates%rowtype;
  v_override public.app_user_access_overrides%rowtype;
begin
  select * into v_user from public.app_users
  where user_id=auth.uid() and active=true;

  if not found then
    return jsonb_build_object(
      'role_key',null,
      'role_name',null,
      'permissions','{}'::jsonb,
      'restrict_assigned_customers',true,
      'has_custom_override',false
    );
  end if;

  select * into v_role
  from public.app_access_role_templates
  where role_key=v_user.role and active=true;

  select * into v_override
  from public.app_user_access_overrides
  where user_id=v_user.user_id;

  return jsonb_build_object(
    'role_key',v_user.role,
    'role_name',coalesce(v_role.display_name,v_user.role),
    'permissions',
      case
        when v_user.role='super_admin'
          then coalesce(v_role.permissions,'{}'::jsonb)
        else coalesce(v_role.permissions,'{}'::jsonb) || coalesce(v_override.permissions,'{}'::jsonb)
      end,
    'restrict_assigned_customers',
      coalesce(v_override.restrict_assigned_customers,v_role.restrict_assigned_customers,false),
    'has_custom_override',v_override.user_id is not null
  );
end
$function$
;

CREATE OR REPLACE FUNCTION public.save_access_role_template(p_role_key text, p_display_name text, p_permissions jsonb, p_restrict_assigned_customers boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_before jsonb;
  v_after jsonb;
begin
  if not coalesce(public.is_super_admin(),false) then
    raise exception 'Super Admin access required';
  end if;
  if p_role_key not in ('sales','accountant','stock_controller','manager','admin','super_admin') then
    raise exception 'Unknown role template';
  end if;
  if jsonb_typeof(coalesce(p_permissions,'{}'::jsonb))<>'object' then
    raise exception 'Permissions must be an object';
  end if;
  if p_role_key='super_admin' then
    raise exception 'Super Admin template is protected';
  end if;

  select to_jsonb(r) into v_before
  from public.app_access_role_templates r
  where r.role_key=p_role_key;

  update public.app_access_role_templates
  set display_name=coalesce(nullif(trim(p_display_name),''),display_name),
      permissions=coalesce(p_permissions,'{}'::jsonb),
      restrict_assigned_customers=coalesce(p_restrict_assigned_customers,false),
      updated_by=auth.uid(),
      updated_at=now()
  where role_key=p_role_key;

  select to_jsonb(r) into v_after
  from public.app_access_role_templates r
  where r.role_key=p_role_key;

  insert into public.app_access_audit(target_type,target_key,before_state,after_state,changed_by)
  values('role',p_role_key,v_before,v_after,auth.uid());
end
$function$
;

CREATE OR REPLACE FUNCTION public.save_user_access_override(p_user_id uuid, p_permissions jsonb, p_restrict_assigned_customers boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'auth', 'pg_temp'
AS $function$
declare
  v_before jsonb;
  v_after jsonb;
  v_role text;
begin
  if not coalesce(public.is_super_admin(),false) then
    raise exception 'Super Admin access required';
  end if;
  if jsonb_typeof(coalesce(p_permissions,'{}'::jsonb))<>'object' then
    raise exception 'Permissions must be an object';
  end if;

  select role into v_role
  from public.app_users
  where user_id=p_user_id and active=true;

  if v_role is null then
    raise exception 'Active user not found';
  end if;
  if v_role='super_admin' then
    raise exception 'Super Admin access cannot be overridden';
  end if;

  select to_jsonb(o) into v_before
  from public.app_user_access_overrides o
  where o.user_id=p_user_id;

  insert into public.app_user_access_overrides(
    user_id,permissions,restrict_assigned_customers,updated_by,updated_at
  )
  values(
    p_user_id,coalesce(p_permissions,'{}'::jsonb),p_restrict_assigned_customers,auth.uid(),now()
  )
  on conflict (user_id) do update
  set permissions=excluded.permissions,
      restrict_assigned_customers=excluded.restrict_assigned_customers,
      updated_by=excluded.updated_by,
      updated_at=excluded.updated_at;

  select to_jsonb(o) into v_after
  from public.app_user_access_overrides o
  where o.user_id=p_user_id;

  insert into public.app_access_audit(target_type,target_key,before_state,after_state,changed_by)
  values('user',p_user_id::text,v_before,v_after,auth.uid());
end
$function$
;

revoke all on function public.get_my_effective_access() from public,anon;
grant execute on function public.get_my_effective_access() to authenticated;
revoke all on function public.current_user_has_permission(text) from public,anon;
grant execute on function public.current_user_has_permission(text) to authenticated;
revoke all on function public.current_user_restrict_assigned_customers() from public,anon;
grant execute on function public.current_user_restrict_assigned_customers() to authenticated;
revoke all on function public.get_access_admin_snapshot() from public,anon;
grant execute on function public.get_access_admin_snapshot() to authenticated;
revoke all on function public.save_access_role_template(text,text,jsonb,boolean) from public,anon;
grant execute on function public.save_access_role_template(text,text,jsonb,boolean) to authenticated;
revoke all on function public.save_user_access_override(uuid,jsonb,boolean) from public,anon;
grant execute on function public.save_user_access_override(uuid,jsonb,boolean) to authenticated;
revoke all on function public.clear_user_access_override(uuid) from public,anon;
grant execute on function public.clear_user_access_override(uuid) to authenticated;
