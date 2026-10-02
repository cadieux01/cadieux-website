-- How a COD order's money physically arrived at the door.
--
-- NOT YET APPLIED. Raja approves migrations. After it is applied, run
-- list_migrations, rename this file to the version Supabase actually minted
-- and replace this line with that version — the written prefix has differed
-- from the minted one every time so far.
--
-- WHY A NEW COLUMN AND NOT payment_status.
-- Seven consumers compare payment_status with a strict `=== "paid"`:
-- lib/order-state.ts:65, lib/order-cancellation.ts:73,
-- lib/order-notification.ts:142 and :264, lib/cron/abandoned-payments-digest.ts:65,
-- app/account/requests/page.tsx:124 and app/api/admin/orders/[id]/edit/route.ts:426,
-- plus the `.neq("payment_status","paid")` guards in the Razorpay routes.
-- Encoding the method as 'paid_cash' would read as UNPAID to all of them —
-- a settled order could compute as `expired` (order-state) and the "payment
-- received" admin alert would refuse to send. lib/payment-label.ts:57 is
-- prefix-based and WOULD have tolerated it, which is exactly what makes the
-- mistake easy to miss: half the app would agree and half would not.
-- So payment_status stays exactly 'paid' and the method lives here.
--
-- WHY NOT payment_method. That column holds the instrument chosen at
-- checkout ('cod' | 'razorpay') and every `payment_method === "cod"` test in
-- the app depends on it. A cash collection must leave it reading 'cod'.
--
-- Deliberately NOT included:
--   • a cross-column constraint tying this to payment_method='cod' — the
--     column is nullable and the write path enforces it;
--   • a backfill — the 2 pre-existing cod/paid rows (OLF429, OLF430) are
--     30 Sep test flips with no Razorpay id, and guessing a method for them
--     would invent a collection that may never have happened;
--   • a settled_at timestamp — orders.paid_at already carries the when, and
--     there are no per-admin accounts to record a who.

alter table public.orders
  add column cod_settled_method text
    check (cod_settled_method in ('cash','upi','cash_upi'));

comment on column public.orders.cod_settled_method is
  'How a COD order''s money physically arrived: cash, upi, or both. '
  'Null = not recorded. Independent of payment_status, which stays '
  'exactly ''paid'' so prefix- and equality-based consumers both hold.';
