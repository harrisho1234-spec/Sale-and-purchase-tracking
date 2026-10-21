-- Optional HTTPS training screenshots or video links for staff guides.
-- Only authorized guide editors may update through existing RLS policies.
alter table public.app_help_guide_content
 add column if not exists media_url text
 check (media_url is null or (length(media_url)<=1800 and media_url ~ '^https://[^[:space:]]+$'));