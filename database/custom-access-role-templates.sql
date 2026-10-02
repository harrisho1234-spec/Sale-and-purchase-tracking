-- Custom access role templates while preserving legacy system-role compatibility.
-- app_users.role remains one of the six system roles for older workflows.
-- app_users.access_role_key points to the flexible role template used by granular permissions.

alter table public.app_access_role_templates
  add column if not exists base_role text;

update public.app_access_role_templates
set base_role=role_key
where base_role is null
  and role_key in ('sales','accountant','stock_controller','manager','admin','super_admin');

update public.app_access_role_templates
set base_role='sales'
where base_role is null;

alter table public.app_access_role_templates
  alter column base_role set not null;

alter table public.app_access_role_templates
  drop constraint if exists app_access_role_templates_base_role_check;

alter table public.app_access_role_templates
  add constraint app_access_role_templates_base_role_check
  check (base_role in ('sales','accountant','stock_controller','manager','admin','super_admin'));

alter table public.app_users
  add column if not exists access_role_key text;

update public.app_users
set access_role_key=role
where access_role_key is null;

alter table public.app_users
  drop constraint if exists app_users_access_role_key_fkey;

alter table public.app_users
  add constraint app_users_access_role_key_fkey
  foreign key (access_role_key)
  references public.app_access_role_templates(role_key)
  on update cascade
  on delete restrict;

create unique index if not exists ux_app_access_role_templates_active_name
on public.app_access_role_templates(lower(display_name))
where active=true;

-- Live functions also updated:
-- get_my_effective_access()
-- current_user_has_permission(text)
-- save_access_role_template(text,text,jsonb,boolean)
-- assign_access_role_to_user(uuid,text)
--
-- create-app-user and manage-app-user Edge Functions now resolve an existing role
-- by name/key or create a new custom role copied from a selected base system role.
