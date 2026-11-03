-- Keep historical payment/invoice evidence visible to management while
-- zeroing the archived duplicate TK's current financial contribution.
create or replace view public.sales_order_summary as
select q.*,
  a.invoice_total as legacy_original_invoice_total,
  a.mirrored_deposit as legacy_original_mirrored_deposit,
  d.do_no as legacy_moved_do_no
from (
 SELECT base.id,
    base.order_no,
    base.invoice_no,
    base.customer_id,
    base.customer_name,
    base.sales_rep_id,
    base.order_date,
    base.order_type,
    base.status,
    base.currency,
    base.order_discount,
        CASE
            WHEN a.legacy_tk_order_id IS NOT NULL THEN 0::numeric
            ELSE base.order_total
        END AS order_total,
        CASE
            WHEN a.legacy_tk_order_id IS NOT NULL THEN 0::numeric
            ELSE base.amount_paid
        END AS amount_paid,
        CASE
            WHEN a.legacy_tk_order_id IS NOT NULL THEN 0::numeric
            ELSE base.balance_due
        END AS balance_due,
        CASE
            WHEN a.legacy_tk_order_id IS NOT NULL THEN 'paid'::text
            ELSE base.payment_status
        END AS payment_status,
    base.created_at,
    base.updated_at,
    base.sales_rep_name_snapshot,
    base.sales_flow_type,
    base.sr_no,
    base.sales_invoice_no,
    base.sales_invoice_type,
    base.invoice_request_status,
    base.invoice_requested_at,
    base.invoice_issued_at,
        CASE
            WHEN a.legacy_tk_order_id IS NOT NULL THEN 0::numeric
            ELSE base.gross_balance_due
        END AS gross_balance_due,
        CASE
            WHEN a.legacy_tk_order_id IS NOT NULL THEN 0::numeric
            ELSE base.credit_applied
        END AS credit_applied,
    base.sales_category,
    a.legacy_tk_order_id IS NOT NULL AS is_consolidated_duplicate,
    a.canonical_sr_order_id AS consolidated_sr_id,
    a.canonical_invoice_part_id AS consolidated_invoice_part_id
   FROM ( SELECT so.id,
            so.order_no,
            so.invoice_no,
            so.customer_id,
            c.name AS customer_name,
            so.sales_rep_id,
            so.order_date,
            so.order_type,
            so.status,
            so.currency,
            so.order_discount,
            GREATEST(COALESCE(i.items_total, 0::numeric) - so.order_discount, 0::numeric) AS order_total,
            COALESCE(p.amount_paid, 0::numeric) AS amount_paid,
            GREATEST(GREATEST(COALESCE(i.items_total, 0::numeric) - so.order_discount, 0::numeric) - COALESCE(p.amount_paid, 0::numeric) - COALESCE(cr.credit_applied, 0::numeric), 0::numeric) AS balance_due,
                CASE
                    WHEN (COALESCE(p.amount_paid, 0::numeric) + COALESCE(cr.credit_applied, 0::numeric)) <= 0::numeric THEN 'unpaid'::text
                    WHEN (COALESCE(p.amount_paid, 0::numeric) + COALESCE(cr.credit_applied, 0::numeric)) >= GREATEST(COALESCE(i.items_total, 0::numeric) - so.order_discount, 0::numeric) THEN 'paid'::text
                    ELSE 'partially_paid'::text
                END AS payment_status,
            so.created_at,
            so.updated_at,
            so.sales_rep_name_snapshot,
            so.sales_flow_type,
            so.sr_no,
            so.sales_invoice_no,
            so.sales_invoice_type,
            so.invoice_request_status,
            so.invoice_requested_at,
            so.invoice_issued_at,
            GREATEST(GREATEST(COALESCE(i.items_total, 0::numeric) - so.order_discount, 0::numeric) - COALESCE(p.amount_paid, 0::numeric), 0::numeric) AS gross_balance_due,
            COALESCE(cr.credit_applied, 0::numeric) AS credit_applied,
            so.sales_category
           FROM sales_orders so
             JOIN customers c ON c.id = so.customer_id
             LEFT JOIN LATERAL ( SELECT sum(soi.line_total) AS items_total
                   FROM sales_order_items soi
                  WHERE soi.sales_order_id = so.id) i ON true
             LEFT JOIN LATERAL ( SELECT sum(sp.amount) AS amount_paid
                   FROM sales_payments sp
                  WHERE sp.sales_order_id = so.id) p ON true
             LEFT JOIN LATERAL ( SELECT sum(sca.amount) AS credit_applied
                   FROM sales_credit_applications sca
                  WHERE sca.sales_order_id = so.id) cr ON true) base
     LEFT JOIN imperial_audit.sr_tk_consolidations a ON a.legacy_tk_order_id = base.id
) q
left join imperial_audit.sr_tk_consolidations a on a.legacy_tk_order_id=q.id
left join public.delivery_requests d on d.id=a.moved_do_id;
