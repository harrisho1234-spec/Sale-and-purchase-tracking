-- English-only Help & Guides: user-specific training status and editable guide text.
-- No training state can change roles or gate access to app functionality.
create table if not exists public.app_help_training_progress (
 user_id uuid primary key references auth.users(id) on delete cascade,
 tour_version integer not null default 1 check (tour_version between 1 and 1000),
 role_key text not null default '',
 next_step integer not null default 0 check (next_step between 0 and 99),
 started_at timestamptz,
 completed_at timestamptz,
 dismissed_at timestamptz,
 updated_at timestamptz not null default now()
);
alter table public.app_help_training_progress enable row level security;
revoke all on public.app_help_training_progress from public,anon;
grant select,insert,update on public.app_help_training_progress to authenticated;
drop policy if exists help_training_own_select on public.app_help_training_progress;
create policy help_training_own_select on public.app_help_training_progress
 for select to authenticated using (user_id=auth.uid());
drop policy if exists help_training_own_insert on public.app_help_training_progress;
create policy help_training_own_insert on public.app_help_training_progress
 for insert to authenticated with check (user_id=auth.uid());
drop policy if exists help_training_own_update on public.app_help_training_progress;
create policy help_training_own_update on public.app_help_training_progress
 for update to authenticated using (user_id=auth.uid()) with check (user_id=auth.uid());

create table if not exists public.app_help_guide_content (
 guide_id text primary key check (guide_id ~ '^[a-z][a-z0-9-]{1,70}$'),
 title text not null check (length(title) between 3 and 140),
 summary text not null default '' check (length(summary)<=450),
 steps jsonb not null default '[]'::jsonb
   check (jsonb_typeof(steps)='array' and jsonb_array_length(steps) between 1 and 18),
 cautions text not null default '' check (length(cautions)<=2000),
 updated_by uuid references auth.users(id),
 updated_at timestamptz not null default now()
);
alter table public.app_help_guide_content enable row level security;
revoke all on public.app_help_guide_content from public,anon;
grant select,insert,update on public.app_help_guide_content to authenticated;

create or replace function public.can_edit_app_help_guides()
returns boolean language sql stable security definer set search_path='public','auth','pg_temp'
as $func$
 select exists(
   select 1 from public.app_users u
   where u.user_id=auth.uid() and u.active
   and (u.role='super_admin'
     or (u.role in ('admin','manager') and public.current_user_has_permission('help.manage')))
 )
$func$;
revoke all on function public.can_edit_app_help_guides() from public,anon;
grant execute on function public.can_edit_app_help_guides() to authenticated;

drop policy if exists help_guide_read on public.app_help_guide_content;
create policy help_guide_read on public.app_help_guide_content
 for select to authenticated using (
  exists (select 1 from public.app_users u where u.user_id=auth.uid() and u.active)
 );
drop policy if exists help_guide_editor_insert on public.app_help_guide_content;
create policy help_guide_editor_insert on public.app_help_guide_content
 for insert to authenticated with check (
    public.can_edit_app_help_guides() and updated_by=auth.uid()
 );
drop policy if exists help_guide_editor_update on public.app_help_guide_content;
create policy help_guide_editor_update on public.app_help_guide_content
 for update to authenticated using (public.can_edit_app_help_guides())
 with check (public.can_edit_app_help_guides() and updated_by=auth.uid());

-- Only active management can grant Help Editor; default restricted to Super Admin.
update public.app_access_role_templates
 set permissions=jsonb_set(coalesce(permissions,'{}'::jsonb),'{help.manage}',
   case when base_role='super_admin' then 'true'::jsonb else 'false'::jsonb end,true),
 updated_at=now()
where not(coalesce(permissions,'{}'::jsonb) ? 'help.manage');
