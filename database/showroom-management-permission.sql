-- Showroom Management Mode permission
-- Access is controlled by L'Imperial Sales & Order Management Users & Access.
-- Admin and Super Admin retain the existing default access, while any role/user
-- can be granted or denied showroom.management_mode.

update public.app_access_role_templates
set permissions = coalesce(permissions,'{}'::jsonb)
  || jsonb_build_object(
       'showroom.management_mode',
       role_key in ('admin','super_admin')
     )
where active=true;

drop policy if exists showroom_background_settings_manager_insert
  on public.showroom_background_settings;
create policy showroom_background_settings_manager_insert
on public.showroom_background_settings
for insert to authenticated
with check (
  id='default'
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_background_settings_manager_update
  on public.showroom_background_settings;
create policy showroom_background_settings_manager_update
on public.showroom_background_settings
for update to authenticated
using (
  id='default'
  and (select public.current_user_has_permission('showroom.management_mode'))
)
with check (
  id='default'
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_campaign_manager_read
  on public.showroom_promotion_campaigns;
create policy showroom_campaign_manager_read
on public.showroom_promotion_campaigns
for select to authenticated
using (
  (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_campaign_manager_insert
  on public.showroom_promotion_campaigns;
create policy showroom_campaign_manager_insert
on public.showroom_promotion_campaigns
for insert to authenticated
with check (
  (select public.current_user_has_permission('showroom.management_mode'))
  and created_by=(select auth.uid())
);

drop policy if exists showroom_campaign_manager_update
  on public.showroom_promotion_campaigns;
create policy showroom_campaign_manager_update
on public.showroom_promotion_campaigns
for update to authenticated
using (
  (select public.current_user_has_permission('showroom.management_mode'))
)
with check (
  (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_default_backgrounds_manager_select on storage.objects;
create policy showroom_default_backgrounds_manager_select
on storage.objects
for select to authenticated
using (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='defaults'
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_default_backgrounds_manager_insert on storage.objects;
create policy showroom_default_backgrounds_manager_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='defaults'
  and lower(storage.extension(name))=any(array['jpg','jpeg','png','webp','gif'])
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_default_backgrounds_manager_update on storage.objects;
create policy showroom_default_backgrounds_manager_update
on storage.objects
for update to authenticated
using (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='defaults'
  and (select public.current_user_has_permission('showroom.management_mode'))
)
with check (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='defaults'
  and lower(storage.extension(name))=any(array['jpg','jpeg','png','webp','gif'])
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_default_backgrounds_manager_delete on storage.objects;
create policy showroom_default_backgrounds_manager_delete
on storage.objects
for delete to authenticated
using (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='defaults'
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_seasonal_backgrounds_manager_select on storage.objects;
create policy showroom_seasonal_backgrounds_manager_select
on storage.objects
for select to authenticated
using (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='campaigns'
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_seasonal_backgrounds_manager_insert on storage.objects;
create policy showroom_seasonal_backgrounds_manager_insert
on storage.objects
for insert to authenticated
with check (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='campaigns'
  and lower(storage.extension(name))=any(array['jpg','jpeg','png','webp','gif'])
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_seasonal_backgrounds_manager_update on storage.objects;
create policy showroom_seasonal_backgrounds_manager_update
on storage.objects
for update to authenticated
using (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='campaigns'
  and (select public.current_user_has_permission('showroom.management_mode'))
)
with check (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='campaigns'
  and lower(storage.extension(name))=any(array['jpg','jpeg','png','webp','gif'])
  and (select public.current_user_has_permission('showroom.management_mode'))
);

drop policy if exists showroom_seasonal_backgrounds_manager_delete on storage.objects;
create policy showroom_seasonal_backgrounds_manager_delete
on storage.objects
for delete to authenticated
using (
  bucket_id='showroom-seasonal-backgrounds'
  and (storage.foldername(name))[1]='campaigns'
  and (select public.current_user_has_permission('showroom.management_mode'))
);
