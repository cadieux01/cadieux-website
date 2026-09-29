-- APPLIED BY HAND 2026-09-29 to production (uejagupcwevadfhfuadv) under
-- Supabase ledger version 20260929175036 (filename matches). Live already.
--
-- THIS FILE IS DOCUMENTATION OF A CHANGE ALREADY MADE. It was written after
-- the fact so git matches the database; it is not a pending change. Do not
-- re-apply it expecting it to do something. Every statement below is
-- replay-safe — `add column if not exists` plus a `comment on column` that
-- simply overwrites — so a stray push against THIS database is a no-op
-- rather than an error.
--
-- Adds public.orders.delivery_pincode: the delivery pincode as a first-class
-- column, so that a future region/pincode-based delivery fee has something
-- trustworthy to key on.
--
-- WHY THE COLUMN IS ADDED EMPTY AND DELIBERATELY NOT BACKFILLED:
--
--   The obvious backfill is a 6-digit regex over delivery_address. It is
--   wrong here. Vizag addresses very often OPEN with a door number that is
--   itself six digits, so a naive extract does not fail loudly — it writes a
--   confident, wrong pincode.
--
--   This column is intended to decide whether a customer is CHARGED. A wrong
--   value is therefore worse than no value: NULL routes to "we don't know,
--   fall back / ask", whereas a wrong pincode silently prices someone into
--   the wrong band and looks authoritative while doing it.
--
--   All 399 rows at the time of writing are NULL, and that is correct.
--   Populating it is a separate CODE task, reading the pincode from the
--   checkout payload where it already exists as a distinct field
--   (PreparedOrder.pincode — see src/lib/order-checkout.ts) rather than
--   being reverse-engineered out of free text.
--
-- NOT IN SCOPE: region_delivery_fees. That table lands with the feature code,
-- once its columns are settled.
--
-- ROLLBACK:
--   alter table public.orders drop column delivery_pincode;

alter table public.orders
  add column if not exists delivery_pincode text;

comment on column public.orders.delivery_pincode is
  'Delivery pincode captured from the checkout payload. NULL = not captured. Never derive this from delivery_address text.';
