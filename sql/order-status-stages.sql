-- Order status stages
-- =====================================================================
-- Adds first-class status progression for orders:
--   placed → confirmed → preparing → out_for_delivery → delivered
--   (cancelled = terminal)
--
-- Schema changes:
--   1. orders.status_updated_at timestamptz — bumped whenever status
--      changes (used by the customer Track Order page to show the
--      "last updated" timestamp under the stage tracker).
--   2. Backfill status_updated_at = created_at for legacy rows.
--   3. Normalize legacy values:
--        pending     → placed
--        dispatched  → out_for_delivery
--      pending_payment is intentionally left alone — it represents the
--      pre-payment state for the mobile flow and is not part of the
--      customer-facing tracker.
--
-- All steps use IF NOT EXISTS / coalesce so the migration is safe to
-- re-run.

begin;

-- 1. Column. timestamptz with a default of now() so any future
-- insert that doesn't explicitly set it still records a timestamp.
alter table public.orders
  add column if not exists status_updated_at timestamptz default now();

-- 2. Backfill: for any row that still has a null status_updated_at,
-- treat the original created_at as the moment the (single) status
-- value was set. Cheap because the column is brand-new.
update public.orders
  set status_updated_at = created_at
  where status_updated_at is null;

-- 3. Normalize legacy status values to the new canonical set, and
-- bump status_updated_at so the tracker reflects the migration moment
-- for any in-flight orders that were previously "pending"/"dispatched".
update public.orders
  set status = 'placed', status_updated_at = now()
  where status = 'pending';

update public.orders
  set status = 'out_for_delivery', status_updated_at = now()
  where status = 'dispatched';

commit;
