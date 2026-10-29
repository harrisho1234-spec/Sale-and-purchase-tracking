# Cancel Undelivered Items

Choose **Cancel Undelivered Items** for products that never reached the customer. Keep **Exchange** for products physically returned. The new action is available in the existing CN form and uses the existing independent management approval queue.

Creation does not change balances or reservations. Approval atomically:

1. Rechecks undelivered quantities against stock releases, historical fulfillment, status quantities, other CNs, and pending stock release requests.
2. Moves the approved quantity to the existing cancelled status bucket. Reservations and the fulfillment queue already subtract that bucket. Sold quantities, prices, stock movements, deposits, and payments remain intact.
3. Freezes the discounted cancellation value per source invoice, applies at most that source's outstanding balance (including pre-invoice SR balances), and retains excess as customer credit. It does not automatically spend excess on unrelated invoices or issue a cash refund.
4. Closes the case. The existing internal `received` status is retained for compatibility; the interface labels it **Cancellation Applied**, with stock receipt **Not required**.

Creation retries use a request UUID and return the same CN. Approval locks the case, source items and customer; posting has a unique CN key. Repeated credit approval is a read-only response. Posted cancellations cannot be edited, removed, moved into another CN, converted to physical returns, or reopened through status-bucket edits. Warehouse receipt requests, exchange holds and CN stock movements are rejected for cancellations.

## Deployment

The change is committed source code, **not a live deployment**. There is no historical backfill and no DML against existing financial records. CN-2026-024 must remain unchanged.

1. Apply `database/cancel-undelivered-items.sql` once, as a transaction, after the existing CN case, Exchange, credit-allocation and reservation scripts. This follows this repository's `database/*.sql` deployment convention. The script expects the schema/function contracts inspected on 2026-10-29. Do not run older CN patches afterward, as they can replace these RPCs.
2. Verify in a staging copy with the actual RLS policies and delivery/credit triggers. The new tables are RLS-enabled and accessible only through RPCs; helper execution is revoked from public client roles.
3. Publish the frontend files together with the updated script versions in `index.html`.

Do not publish the interface before the database script. No live SQL migration, approval, cancellation, receipt, credit, payment edit, or historical repair was performed as part of this implementation. Existing historical CNs cannot be converted to this action.

## Validation

Install pinned development dependencies with `pnpm install --frozen-lockfile`; run `pnpm test`.

The database tests execute SQL in an isolated PGlite PostgreSQL engine using synthetic records and a contract fixture of the existing CN/credit functions. They test partial delivery, historical delivery, pending releases, stale approval, rejected requests, free items, discounts and cent rounding, stock/pre-order reservations, source-specific multi-invoice allocation, deposits, excess credit, idempotency, rollback, approval permissions, immutable postings, receipt rejection, and Exchange regression. A synthetic CN-2026-024 sentinel is checked for changes; no real historical record is loaded or modified.

The DOM tests exercise the actual form code, cancellation quantity lookup, disabled receipt handling, over-quantity validation, double-submit prevention, retry IDs and switching back to Exchange. JavaScript syntax and Git whitespace checks are also run.

Limits: PGlite serializes requests, so this is not a multi-connection stress test. Test authorization helpers simulate roles; staging verification must cover the full production RLS configuration and concurrent delivery/payment/approval activity. No live end-to-end browser approval was performed.

Existing unrelated tests also ran and fail on unchanged baseline files:

- `pnpm test:tax-inventory`: old CSV fixture is interpreted as an invalid Tax Cost.
- `pnpm test:sales-daily`: three failures involving the sheet mock's missing `insertSheet`, an outdated validation expectation, and missing `sessionStorage` in the UI test environment.

Those suites and their application files are unchanged by this feature.
