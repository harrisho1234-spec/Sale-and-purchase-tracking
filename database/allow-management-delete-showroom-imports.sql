-- Imported showroom quotations are staging records, not the source saved quotation
-- or official sales_orders. Only management may remove these staging records.
-- The original public showroom saved-list record and any converted Sales Order remain intact.

DROP POLICY IF EXISTS showroom_quotation_imports_delete ON public.showroom_quotation_imports;
CREATE POLICY showroom_quotation_imports_delete
ON public.showroom_quotation_imports
FOR DELETE TO authenticated
USING (
  public.current_app_role() IN ('super_admin', 'admin', 'manager')
);

-- Management can review/import housekeeping records across users; other roles
-- keep the existing owner-or-view-all-sales restriction.
DROP POLICY IF EXISTS showroom_quotation_imports_select ON public.showroom_quotation_imports;
CREATE POLICY showroom_quotation_imports_select
ON public.showroom_quotation_imports
FOR SELECT TO authenticated
USING (
  public.current_user_has_permission('sales_orders.view')
  AND (
    imported_by = (SELECT auth.uid())
    OR public.can_view_all_sales()
    OR public.current_app_role() IN ('super_admin', 'admin', 'manager')
  )
);
