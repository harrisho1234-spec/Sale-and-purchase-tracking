-- Allow History Repair for users granted Inventory > Historical / month-end reconciliation.
-- Admin and Super Admin have this permission by default; it can be overridden through Users & Access.

-- The live RPC definitions are stored here by intent:
-- get_historical_reconstruction_preview() and apply_historical_reconstruction_safe_matches()
-- now guard with:
--   public.current_user_has_permission('inventory.reconcile')
-- instead of Super-Admin-only role checks.
