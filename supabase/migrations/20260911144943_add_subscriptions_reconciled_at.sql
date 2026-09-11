-- Adds the sweeper-reconciliation marker on subscriptions.
--
-- WHY THIS EXISTS
-- The subscription sweeper (see @/lib/sweep-abandoned-subscriptions) will,
-- before abandoning any 'created' row that has a razorpay_order_id, ask
-- Razorpay whether that order was actually paid. If it was — the app died
-- between checkout and verify, but the money got through — the sweeper
-- marks the subscription paid on its own, without going through the app's
-- verifySubscriptionPayment path.
--
-- Rows written by the sweeper are indistinguishable in `payment_status`
-- from rows written by the normal verify path. This column IS the
-- distinction: NOT NULL means "we, the sweeper, found this ourselves".
--
-- IT IS A SUCCESS MARKER, AND NOTHING ELSE READS IT.
-- A reconciled row is a live subscription with live deliveries. It must never
-- be used as evidence that a payment is unscheduled or orphaned — that state
-- has its own payment_status value, 'paid_orphaned'. An earlier draft of the
-- mobile payment-status endpoint derived "orphaned" from
-- `payment_status='paid' AND reconciled_at IS NOT NULL`, which inverted the
-- two and would have told a rescued customer we were holding their money.
--
-- Nullable + additive. No backfill needed — every existing row was written
-- by the verify path.
--
-- ALREADY APPLIED to the live database, recorded there as
-- 20260911144943 add_subscriptions_reconciled_at (applied via MCP, so the
-- recorded version differs from this filename). `if not exists` keeps this
-- file a harmless no-op for anyone who runs it.

alter table public.subscriptions
  add column if not exists reconciled_at timestamptz;

comment on column public.subscriptions.reconciled_at is
  'Set by the daily sweeper when Razorpay confirmed a payment for this subscription''s razorpay_order_id but the app never called verify. NULL means the row was marked paid through the normal verify path.';
