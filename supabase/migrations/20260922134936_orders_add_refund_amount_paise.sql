-- APPLIED 2026-09-22 under Supabase ledger version 20260922134936
-- (filename now matches). Live in production. Every statement is
-- idempotent — `add column if not exists` + guarded constraint block —
-- so a stray db push is a no-op.
--
-- Adds public.orders.refund_amount_paise, the per-row record of how many
-- paise have already been refunded against a given order. Introduced for
-- the OLF/OLW split (see plan §4) where one Razorpay capture can back
-- TWO order rows, and cancelling ONE half must partially refund the
-- SHARED payment. Also useful for single orders — a manual admin
-- partial refund has nowhere to record itself today.
--
-- WHY INTEGER PAISE, NOT NUMERIC RUPEES:
--
--   Razorpay refund helper takes amountPaise: integer (see
--   src/lib/razorpay-refund.ts). Money in integer minor units means
--   SUM(refund_amount_paise) can't drift the way SUM(numeric_rupees × 100)
--   can — no float rounding, no half-paise edge cases, no coerce-back to
--   integer on the way out to Razorpay. total_amount stays numeric-rupees
--   for backward compat; new money columns land in paise.
--
-- WHY NULLABLE, NOT DEFAULT 0:
--
--   Distinguishes "never refunded" (NULL) from "explicitly zero-refunded"
--   (0). The refund gate reads COALESCE(refund_amount_paise, 0), so NULL
--   is treated as zero everywhere it matters — but the DB row still tells
--   the truth about whether a refund was ever attempted. Backfilling 289
--   legacy rows to 0 would erase that signal.
--
-- WHY NO BACKFILL:
--
--   All 289 existing rows have refund_status IS NULL AND refund_id IS
--   NULL — no partial refund history to reconstruct. Leaving
--   refund_amount_paise NULL for them is truthful.
--
-- INTERACTION WITH THE PLANNED REFUND GATE (plan §4, not this migration):
--
--   Refund allowed iff:
--     COALESCE(SUM(refund_amount_paise) FILTER (WHERE payment_group_id = g), 0)
--       + this_refund_paise
--       <= captured_paise
--
--   Enforced inside a refund RPC that mutates refund_amount_paise atomically
--   with the compare-and-swap on refund_status. This migration adds the
--   column; the RPC ships alongside the cancel/refund work in a later commit.

alter table public.orders
  add column if not exists refund_amount_paise integer;

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema='public' and table_name='orders'
      and constraint_name='orders_refund_amount_paise_nonneg'
  ) then
    alter table public.orders
      add constraint orders_refund_amount_paise_nonneg
      check (refund_amount_paise is null or refund_amount_paise >= 0);
  end if;
end $$;

comment on column public.orders.refund_amount_paise is
  'Total paise refunded against this order row (integer minor units — '
  'matches src/lib/razorpay-refund.ts amountPaise). NULL = never '
  'refunded, 0 = explicitly zero-refunded, N = N paise sent back. Under '
  'the OLF/OLW split, the group-level gate is SUM(refund_amount_paise) '
  'FILTER (WHERE payment_group_id = <group>) + this_refund <= captured. '
  'Mutated only inside the refund RPC, atomically with the '
  'refund_status compare-and-swap.';
