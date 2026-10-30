# Cancel Undelivered Items

Choose **Cancel Undelivered Items** for products that never reached the customer. Keep **Exchange** for products physically returned. The new action is available in the existing CN form and uses the existing independent management approval queue.

Creation does not change balances or reservations. Approval atomically:

1. Rechecks undelivered quantities against stock releases, historical fulfillment, status quantities, other CNs, and pending stock release requests.
2. Creates one **Release Reservation** task for Stock. Reservations remain held until Stock processes this task. Approved quantities cannot be delivered while the task is pending.
3. Freezes the discounted cancellation value per source invoice, applies at most that source's outstanding balance (including pre-invoice SR balances), and retains excess as customer credit. It does not automatically spend excess on unrelated invoices or issue a cash refund.
4. Leaves the case open as **Awaiting Reservation Release**. The existing internal `received` status is retained for financial compatibility; the interface separately shows the pending stock task.

Stock Controller, Admin or Super Admin with `inventory.operate` completes the task from Stock & Inventory or My Requests. This atomically moves cancelled quantities out of nonterminal fulfillment buckets into the existing cancelled bucket, releasing calculated reservations. It records `completed_by` and `completed_at`, then closes the case. It never creates a stock movement, receipt, exchange hold, or second credit allocation. Sold quantities, prices, deposits and payments remain intact. Completed tasks remain available in the queue history; retries return the original completion audit.

Creation retries use a request UUID and return the same CN. Approval locks the case, source items and customer; posting has a unique CN key. Repeated credit approval is a read-only response. Posted cancellations cannot be edited, removed, moved into another CN, converted to physical returns, or reopened through status-bucket edits. Warehouse receipt requests, exchange holds and CN stock movements are rejected for cancellations.

## Deployment

The database migration `cancel_undelivered_items_stock_release` was applied on 2026-10-30. The frontend release is tracked in PR #2. There is no historical backfill and no DML against existing financial records. CN-2026-024 must remain unchanged.

1. Apply the consolidated `database/cancel-undelivered-items.sql` once, as a transaction, after the existing CN case, Exchange, credit-allocation and reservation scripts. This includes the earlier cancellation branch and its stock-task extension; it replaces the earlier un-deployed script, not an additional migration to apply afterward. This follows this repository's `database/*.sql` deployment convention. The script expects the schema/function contracts inspected on 2026-10-29. Do not run older CN patches afterward, as they can replace these RPCs.
2. Verify in a staging copy with the actual RLS policies and delivery/credit triggers. The new tables are RLS-enabled and accessible only through RPCs; helper execution is revoked from public client roles.
3. Publish the frontend files together with the updated script versions in `index.html`.

The database script must precede the frontend release; do not reapply it after deployment. No live approval, cancellation, receipt, credit, payment edit, or historical repair was performed. Existing historical CNs cannot be converted to this action.

Post-deployment database checks confirmed the task table has RLS enabled, clients cannot write it directly, anonymous users cannot call the release RPC, and unauthenticated release attempts are rejected. The new task/posting tables were empty after deployment. CN-2026-024 header, item, workflow and credit checksums matched their pre-deployment values. The live secondary credit guard was added to the isolated fixture, reproduced a blocking failure, and passed after the cancellation-specific correction.

## Validation

Install pinned development dependencies with `pnpm install --frozen-lockfile`; run `pnpm test`.

The database tests execute SQL in an isolated PGlite PostgreSQL engine using synthetic records and a contract fixture of the existing CN/credit functions. They test partial delivery, historical delivery, pending releases, stale approval, rejected requests, free items, discounts and cent rounding, stock/pre-order reservations, source-specific multi-invoice allocation, deposits, excess credit, idempotency, rollback, approval permissions, immutable postings, receipt rejection, and Exchange regression. A synthetic CN-2026-024 sentinel is checked for changes; no real historical record is loaded or modified.

The database suite also tests pending stock tasks, two approved cancellations sharing an item, delivery protection before release, authenticated stock RPC execution, repeat release audit, unchanged credit allocations during release, and physical return receipt regression. The DOM tests exercise the actual form and stock task code, cancellation detail, quantity lookup, disabled receipt handling, over-quantity validation, double-submit prevention, lost-response retries, completed-task history, permissions, escaping, and switching back to Exchange. JavaScript syntax and Git whitespace checks are also run.

Limits: PGlite serializes requests, so this is not a multi-connection stress test. Test authorization helpers simulate roles; staging verification must cover the full production RLS configuration and concurrent delivery/payment/approval activity. No live end-to-end browser approval was performed.

Existing unrelated tests also ran and fail on unchanged baseline files:

- `pnpm test:tax-inventory`: old CSV fixture is interpreted as an invalid Tax Cost.
- `pnpm test:sales-daily`: three failures involving the sheet mock's missing `insertSheet`, an outdated validation expectation, and missing `sessionStorage` in the UI test environment.

Those suites and their application files are unchanged by this feature.
