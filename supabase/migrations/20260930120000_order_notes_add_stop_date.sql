-- NOT APPLIED. Written 2026-09-30, deliberately left unapplied.
--
-- Migrations in this repo are applied BY HAND through the Supabase
-- Management API, which mints its OWN ledger version at apply time. The
-- prefix above is when this file was written, not when it ran. After it is
-- applied, ask for the real ledger version and `git mv` this file to it,
-- content unchanged — otherwise `supabase db push` still believes it is
-- pending and tries to re-run it. Every statement below is guarded, so a
-- re-run is a no-op, but the filename must still be corrected.
--
-- ---------------------------------------------------------------------------
-- WHY THIS COLUMN, AND WHY NOT A NEW TABLE
--
-- The delivery board (/admin/deliveries) needs a note per STOP, for both of
-- the row kinds it normalises into one DeliveryRow: orders and subscriptions.
--
-- public.order_notes is already that store. It has carried the XOR parent
-- (order_id or subscription_id, never both, never neither) since
-- 20260914073154, it is admin-only (RLS enabled with zero policies, grants
-- revoked from anon and authenticated), and /api/admin/notes already reads it
-- one-owner and in batch. A second notes table would be a second place the
-- same note can live, which is the drift this codebase has already paid for
-- twice — so nothing new is created here.
--
-- What order_notes could NOT express is WHICH STOP a note belongs to. A note
-- binds to the PARENT. For an order that is the same thing: one order, one
-- delivery_date, one stop. For a subscription it is not — one plan has many
-- stops on many dates, so a plan-level note renders on every one of them.
-- On a routing board that means yesterday's "nobody home, left with guard"
-- greets the partner again on every future drop for that customer.
--
-- Hence exactly one new column.
--
-- WHY NOT subscription_deliveries.admin_notes, which already exists and is
-- already per-delivery: it is a different concept with a different author.
-- Both customer self-edit routes (web
-- api/subscriptions/[id]/deliveries/[deliveryId]/edit and the mobile twin)
-- APPEND "[user edit <stamp>] <old> -> <new>" to it, and both return the
-- updated row via select("*"), so its contents reach the customer. The admin
-- subscriptions drawer then OVERWRITES it wholesale, and
-- admin/subscriptions/page.tsx greps it for the literal "[user edit" to raise
-- the "User edited" badge. Putting a delivery partner's field note in there
-- would (a) publish it to the customer, (b) let free text forge that badge,
-- and (c) put the customer's reschedule history one admin save away from
-- being destroyed. It stays what it is: a customer-written schedule trail.
-- ---------------------------------------------------------------------------

-- Nullable, no default, on purpose.
--
--   NULL  = a note about the PARENT — every row written before this column
--           existed, plus anything the orders/subscriptions boards write.
--           Their meaning is unchanged by this migration.
--   date  = a note about ONE STOP on ONE DAY.
--
-- A default would retro-label every existing note as being about a stop it
-- was never written about, and NOT NULL is impossible without inventing a
-- date for rows that legitimately have none.
alter table public.order_notes
  add column if not exists stop_date date;

comment on column public.order_notes.stop_date is
  'IST calendar day this note is about, or NULL when the note is about the '
  'parent order/subscription as a whole. Set by the delivery board so a note '
  'on one stop of a multi-stop subscription does not appear on the others. '
  'For subscriptions the value must be the day the stop is LISTED under, i.e. '
  'scheduled_date ?? delivery_date (the precedence delivery_dates and '
  'loaf_counts_by_date are built with) — keying off the raw booked date would '
  'file the note under a day whose row is shown elsewhere.';

-- No index, deliberately.
--
-- order_notes_order_idx (order_id, created_at desc) and order_notes_sub_idx
-- (subscription_id, created_at desc) already serve every read path: callers
-- fetch by parent id — in batch, capped at 250 ids — and narrow by stop_date
-- in memory over the handful of notes a parent has. An index on stop_date
-- would be pure write overhead on a table whose whole job is to be appended
-- to, the same reasoning 20260917130000 records for delivery_zone_rules.

-- No UNIQUE on (parent, stop_date) either: order_notes is an append-only
-- timeline (the API has no PATCH and no DELETE, by design), so several notes
-- about the same stop is the correct state, not a conflict to resolve.
