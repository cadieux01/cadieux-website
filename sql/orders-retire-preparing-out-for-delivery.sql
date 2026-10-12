-- Retire `preparing` and `out_for_delivery` from orders.status
-- =====================================================================
-- The admin status list is now exactly five entries:
--
--   Pending · Confirmed · Delivered · Cancelled · New Update
--
-- (`New Update` is computed on read and never stored — see
--  src/lib/order-new-update.ts. `ready_for_pickup` and `picked_up` are
--  still stored and still rendered, deliberately kept out of the menu.)
--
-- `preparing` and `out_for_delivery` are gone from the vocabulary. They
-- described a kitchen/rider stage nobody was actually maintaining — prod
-- holds 1 and 5 rows respectively against 567 delivered — so the board was
-- offering two choices that mostly meant "someone clicked this once".
--
-- THAT COUNT WAS 1 AND 7 WHEN THE PLAN WAS WRITTEN, AND NEITHER READING WAS
-- WRONG: two of the seven were delivered in between (delivered went 564 →
-- 567, pending 39 → 43, confirmed 42 → 40 over the same interval). This is a
-- live table. Re-read step 1 at the moment you run it rather than trusting
-- any number in a comment, including this one.
--
-- Coverage check at the time of writing, which is the thing actually worth
-- trusting: the eleven status values ever used sum to 744 and the table
-- holds 744 rows, so there is no twelfth value hiding behind an `in (...)`
-- list. After this runs, every row is one of pending / confirmed /
-- delivered / cancelled.
--
-- WHY THIS RUNS BEFORE THE CODE IS TRUSTED, NOT AFTER.
-- orders.status has NO check constraint (the only constraint on the table
-- is orders_refund_status_check, on a different column), so this is an
-- application-level retirement plus a data move. Nothing enforces it at the
-- database. That cuts both ways:
--   • the UPDATE below cannot fail on a constraint, and
--   • nothing stops a future write from putting the value back.
-- The second is handled in code: STATUS_ALIAS in
-- src/app/api/admin/orders/[id]/route.ts folds both spellings to
-- `confirmed` on the way in, so a stale client cannot re-dirty the column.
--
-- TARGET IS `confirmed`, NOT `delivered`. Both values mean the order was
-- accepted and is in motion; neither means it arrived. Moving them to
-- `delivered` would invent a delivery that may never have happened, and on
-- a COD row it would also change what cod-settlement reads. Moving them
-- back to `pending` would un-accept orders the kitchen had accepted.
-- `confirmed` is the only choice that adds no claim.
--
-- status_updated_at IS BUMPED, and that is correct rather than convenient:
-- a human IS setting this status, right now, by running this script. The
-- admin board's New Update flag compares note.created_at against this
-- column, so leaving the old stamp would make any of these orders that
-- already carries a note light up as "New Update" the moment the board
-- reloads — pointing at a note written days ago.
--
-- SAFE TO RE-RUN. The WHERE clause matches nothing on a second pass.

begin;

-- 1. BEFORE. Read this, do not skim it. The order_number column is here so
--    the rows can be checked individually rather than trusted as a count —
--    on 2026-10-12 three of the six (OLF565, OLF603, OLF617) carried a
--    delivery_date of 2026-10-17, i.e. they were marked "out for delivery"
--    for a delivery that has not happened yet. For those rows `confirmed`
--    is a CORRECTION, not a downgrade.
select order_number, status, payment_status, payment_method,
       delivery_date, status_updated_at
from public.orders
where status in ('preparing', 'out_for_delivery')
order by created_at;

select status, count(*) as rows
from public.orders
where status in ('preparing', 'out_for_delivery')
group by status
order by status;

-- 2. THE MOVE.
update public.orders
  set status = 'confirmed',
      status_updated_at = now()
  where status in ('preparing', 'out_for_delivery');

-- 3. AFTER. Must return zero rows. If it does not, something wrote one of
--    the retired values between steps 1 and 2 — stop and find the writer
--    rather than re-running, because a live writer will just do it again.
select status, count(*) as rows
from public.orders
where status in ('preparing', 'out_for_delivery')
group by status;

commit;

-- AFTERWARDS, NOT HERE:
--   • supabase/functions/whatsapp-ai-reply/index.ts holds its OWN copy of
--     this vocabulary and deploys separately from the Next.js app. It is
--     read-only with respect to orders.status, so it cannot re-dirty the
--     column — but it will keep describing orders using the retired words
--     until it is redeployed.
--   • Installed Android builds cannot be updated. They are unaffected
--     because no value is being DELETED at the database level and the rows
--     land on `confirmed`, which every shipped build already renders.
