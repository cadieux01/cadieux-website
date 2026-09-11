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
-- The mobile payment-status endpoint reads it to tell the app whether to
-- show the ordinary "paid, live" state or the special "we have your
-- payment, someone will confirm" state.
--
-- Nullable + additive. No backfill needed — every existing row was written
-- by the verify path.

alter table public.subscriptions
  add column if not exists reconciled_at timestamptz;

comment on column public.subscriptions.reconciled_at is
  'Set by the daily sweeper when Razorpay confirmed a payment for this subscription''s razorpay_order_id but the app never called verify. NULL means the row was marked paid through the normal verify path.';
