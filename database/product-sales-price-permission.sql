-- Add separate normal Sales Price visibility permission.
-- Stock Controller defaults to hidden; existing non-stock roles preserve prior price visibility.

update public.app_access_role_templates
set permissions = permissions || jsonb_build_object(
  'products.sales_price_view',
  case when role_key='stock_controller' then false else true end
),
updated_at=now()
where role_key in ('sales','accountant','stock_controller','manager','admin','super_admin');
