# Tax Inventory

Tax Inventory is under Stock & Inventory. It uses the existing inventory balance view, aging calculation, stock card, and movement history. No tax quantity is stored or editable. While visible, the tax view refreshes every 30 seconds; Refresh Balances also reloads it immediately.

Super Admin can edit Tax Item, Tax Group / Set, and Tax Note from a product detail or stock card. The database trigger also enforces this for direct API writes. Server-generated `tax_updated_at` and `tax_updated_by` record the last classification change.

Bulk Tax Tagging is available in Products and Stock Balance / Tax Inventory. Paste one code per line or upload CSV, TSV, or TXT with columns `SKU,group/set,note` (optional header). Omitted metadata columns retain existing values; supplied empty columns clear them. The preview shows old and new values and permits selecting matched products. Duplicate inputs, ambiguous catalog codes, and unmatched codes cannot be selected. Up to 500 rows are accepted per batch. Applying is atomic and rejects changed codes or stale tax metadata.

Tax Items Only is available in Products, Stock Balance, Procurement PO Items and Needs Ordering. TAX badges appear on product cards, stock rows/cards/history, and procurement item rows. Existing approval, sales, delivery order, receiving, movement, and stock-count mutation functions are unchanged.

`tax-inventory.sql` is the schema artifact applied to Supabase as `product_tax_inventory_metadata`; do not reapply it to an already migrated project.

Validation:

- `node tests/tax-inventory.test.cjs` checks CSV/TSV parsing, limits, matching, badges, and pagination for catalog and aging reads.
- `tests/tax-inventory-rollback.sql` verifies live database role enforcement, audit fields, stale-preview rejection, batch atomicity, and unchanged ledger quantities, then rolls back every test write.
- Browser tests used the complete app with isolated sample data: single edit, pasted bulk preview/apply, CSV upload, products and procurement badges/filters, tax inventory beyond row 1000, stock card history, and Stock Controller view/approval controls.
- Production browser sign-in and real stock/DO transactions were not exercised; no business data was changed for testing.
