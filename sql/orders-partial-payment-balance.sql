-- Partial payment: record what has actually been collected
-- =====================================================================
-- ░░ WRITTEN, NOT RUN. Reviewed and held deliberately. ░░
--
-- THE HOLD IS NOT ABOUT THIS DDL, WHICH IS SAFE. It is about the value the
-- DDL exists to support. The Android app tests payment_status for EQUALITY
-- with 'paid', so the first row ever written `partially_paid` makes that
-- order customer-editable (AddressEditor / ItemEditor / DeliveryEditor) and
-- makes the detail screen read "Cash on Delivery" or "Awaiting payment" on
-- an order that is half settled. Installed builds cannot be patched.
-- The full list of affected files is in the comment above `partially_paid`
-- in src/lib/payment-label.ts. A Play release ships BEFORE the first write.
--
-- Running THIS script alone writes no such row — it only adds the columns
-- and backfills fully-paid orders — so it is not itself the danger. It is
-- held because shipping the column invites the write.
--
-- THE PROBLEM. An order can be edited after it is placed — the admin edit
-- flow changes quantities, and the plpgsql RPC admin_edit_order already
-- writes a "REFUND DUE ₹X" note when the new total lands below what was
-- paid. That note is prose. Nothing in the schema says how much money has
-- actually reached us, so nothing can compute what is still owed, and the
-- rider's sheet keeps printing total_amount at a door where half of it is
-- already settled. That is a cash error, not a display nit.
--
-- THE SHAPE. One stored column and one derived one.
--
--   amount_paid   — what has ACTUALLY been collected against this order,
--                   in rupees. Starts at 0. The source of truth.
--   balance_due   — GENERATED. total_amount - amount_paid, maintained by
--                   Postgres.
--
-- balance_due is generated rather than written by the app on purpose. Two
-- columns that must agree, both writable, is the oldest way to end up with
-- a sheet and a screen quoting different numbers at the same customer. A
-- generated column cannot drift because there is nothing to forget to
-- update. The cost is that it is read-only — every write goes to
-- amount_paid — which is exactly the constraint we want.
--
-- NOT NULL DEFAULT 0 on amount_paid, so every one of the ~900 existing
-- rows backfills to "nothing collected yet". For a `paid` row that is
-- wrong on its face, which is why step 3 exists: settled rows are
-- backfilled to their own total so balance_due reads 0 for them and the
-- column is honest from the first second it exists rather than after a
-- follow-up nobody schedules.
--
-- THE PAYMENT STATUS. `partially_paid` is the sixth payment_status value
-- (payment_status, NOT status — partial payment is a money fact, the order
-- is still Pending or Confirmed). No DDL is needed for it: payment_status
-- is a bare TEXT column with no check constraint, same as status. The
-- application vocabulary is in PAYMENT_VIEWS, src/lib/payment-label.ts,
-- where there is a comment explaining why the name must not be changed to
-- anything starting with "paid".
--
-- WHAT THIS MIGRATION DOES NOT DO, AND MUST NOT BE EXTENDED TO DO:
--   • It does not put `partially_paid` into PAYABLE_PAYMENT_STATUSES.
--     Pay Now charges total_amount; until it charges balance_due, enabling
--     it would bill a part-paid customer for the whole order again.
--   • It does not change what the rider is told to collect. That is the
--     follow-on commit, and it is a code change (pass balance_due as
--     amountDue to paymentLabel), not a schema one.
--
-- SAFE TO RE-RUN: add column if not exists + an idempotent backfill.

begin;

-- 1. What has been collected. Rupees, same precision as total_amount.
alter table public.orders
  add column if not exists amount_paid decimal(10, 2) not null default 0;

-- 2. What is still owed. Derived, never written.
--
--    coalesce on total_amount because that column is nullable (see
--    database.sql) — a null total would otherwise make balance_due null,
--    and "unknown" is a worse answer to "how much do I collect" than
--    "nothing", which at least makes the rider ask.
alter table public.orders
  add column if not exists balance_due decimal(10, 2)
    generated always as (coalesce(total_amount, 0) - amount_paid) stored;

-- 3. Backfill the rows where we already know the answer.
--
--    A fully-paid order has collected its whole total. Prefix match, not
--    `= 'paid'`: `paid_orphaned` means the money captured too. This is the
--    same prefix rule isPaidStatus() applies in the app, and the two must
--    not disagree about whether money arrived.
--
--    Everything else — pending, created, abandoned, failed — is left at 0,
--    which is the truth: nothing has been collected on any of them.
update public.orders
  set amount_paid = coalesce(total_amount, 0)
  where lower(coalesce(payment_status, '')) like 'paid%'
    and amount_paid = 0;

-- 4. Verify before committing. Expect: `paid` rows with balance 0, and
--    every unpaid row with balance = total.
select
  payment_status,
  count(*)                                   as rows,
  sum(amount_paid)                           as collected,
  sum(balance_due)                           as outstanding,
  count(*) filter (where balance_due < 0)    as overpaid_rows
from public.orders
group by payment_status
order by payment_status;

commit;

-- A NOTE ON overpaid_rows ABOVE. balance_due is allowed to go NEGATIVE and
-- there is deliberately no check constraint forbidding it: that is exactly
-- the "REFUND DUE" case the edit RPC already writes a note about — the
-- order was edited DOWN after the customer paid. A constraint would make
-- the edit fail instead of making the refund visible, so the number is
-- surfaced in this query rather than prevented.
