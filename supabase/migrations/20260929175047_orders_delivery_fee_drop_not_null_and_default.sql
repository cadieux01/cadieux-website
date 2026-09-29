-- APPLIED BY HAND 2026-09-29 to production (uejagupcwevadfhfuadv) under
-- Supabase ledger version 20260929175047 (filename matches). Live already.
--
-- THIS FILE IS DOCUMENTATION OF A CHANGE ALREADY MADE. It was written after
-- the fact so git matches the database; it is not a pending change. Do not
-- re-apply it expecting it to do something. Every statement below is
-- replay-safe by its own syntax — `drop not null` and `drop default` both
-- succeed silently when there is nothing left to drop, and `comment on
-- column` simply overwrites — so a stray push against THIS database is a
-- no-op rather than an error. (There is no `if exists` form for these two
-- ALTERs; none is needed, because they are already idempotent.)
--
-- Loosens public.orders.delivery_fee from `numeric NOT NULL DEFAULT 50` to
-- `numeric` — nullable, no default.
--
-- NO DATA WAS REWRITTEN. Verified immediately before and after: count(*) 399,
-- count(delivery_fee) 399, min 0.00, max 212.00 — identical on both sides.
-- No row holds NULL today.
--
-- WHAT NULL MEANS NOW:
--
--   "Not yet determined." Distinct from 0, which means "determined, and it is
--   free" (pickup orders legitimately store 0). Readers that do arithmetic
--   already coalesce — e.g. src/app/api/orders/[id]/item-change-request
--   /route.ts and its mobile twin both do Number(order.delivery_fee ?? 0) —
--   and the display paths already guard on `typeof === "number"`.
--
-- WHY DROPPING THE DEFAULT IS THE POINT:
--
--   Rs50 is a fee charged NOWHERE in the product. src/lib/deliveryFee.ts
--   bands the fee by distance and its top band is DELIVERY_FEE_TOP_BAND_INR
--   = 32, so 50 sits above every figure that file can produce. A row that
--   inherited the default was therefore carrying a number no pricing rule
--   could ever have chosen, and it did so invisibly — the insert succeeded,
--   the order looked normal, and the customer was quoted a figure the code
--   would never have arrived at.
--
--   Every live insert path ALREADY sends delivery_fee explicitly, so this
--   changes no current behaviour. Re-audited against this commit's tree:
--
--     src/app/api/checkout/route.ts:369-371         via orderInsertColumns()
--     src/app/api/create-order/route.ts:176-178     via orderInsertColumns()
--     src/app/api/admin/orders/route.ts:257,267     via orderInsertColumns()
--     src/app/api/mobile/checkout/route.ts:361,365  inline
--     src/app/api/mobile/create-order/route.ts:373,377  inline
--
--   Those are the only five inserts into public.orders in the repo; the
--   other .from("orders") call sites are selects. The shared builder is
--   src/lib/order-checkout.ts:546, where the key is unconditional and
--   PreparedOrder.deliveryFee is typed `number` (:60), not optional — so it
--   cannot arrive undefined and be stripped on the way out. The two mobile
--   routes both assign `const deliveryFee = feeResult.feeInr`, and
--   computeDeliveryFee always returns a number. supabase/functions/ contains
--   no insert into orders at all.
--
--   What this removes is the invisible landing pad for the NEXT insert path
--   that forgets the key. That matters most for the dynamic-column-list RPC
--   admin_create_split_orders (20260923115206), which builds its column list
--   from a jsonb payload's keys: omit delivery_fee there and the row used to
--   take Rs50 in silence. It has zero callers today — confirmed in both src/
--   and pg_proc.
--
-- KNOWN STALE COMMENT, NOT FIXED HERE (no code changes in this commit):
--
--   src/lib/deliveryFee.ts still asserts "public.orders.delivery_fee is NOT
--   NULL DEFAULT 50 — omit the key and the row silently takes Rs50". As of
--   this migration that is no longer true: omitting the key now yields NULL.
--   Its INSTRUCTION is still right and still load-bearing (both split rows
--   must send the fee explicitly); only its stated reason is out of date.
--   Worth correcting whenever that file is next touched.
--
-- ROLLBACK (valid ONLY while no row holds NULL — check first):
--   -- select count(*) from public.orders where delivery_fee is null;  -- must be 0
--   alter table public.orders alter column delivery_fee set default 50;
--   alter table public.orders alter column delivery_fee set not null;

alter table public.orders
  alter column delivery_fee drop not null;

alter table public.orders
  alter column delivery_fee drop default;

comment on column public.orders.delivery_fee is
  'Delivery fee in INR. NULL = not yet determined. No default: callers must send this explicitly.';
