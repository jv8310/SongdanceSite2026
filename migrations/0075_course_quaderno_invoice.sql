-- Manual bank-transfer course orders.
--
-- A course paid by bank transfer never touches Stripe, so the Stripe→Quaderno
-- native connector — which is what normally creates the invoice on a paid
-- checkout — never fires for it. The admin "manual order" flow
-- (src/lib/orders/manual-order.ts) therefore creates the Quaderno invoice
-- itself (marked paid, wire transfer) via the API and persists its id here, so
-- the admin order view can link straight to it — matching `registrations`
-- (retreats) and `workshop_registrations`, which already carry this column.
ALTER TABLE course_registrations ADD COLUMN quaderno_invoice_id TEXT;
