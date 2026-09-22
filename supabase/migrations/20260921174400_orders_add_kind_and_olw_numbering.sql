-- APPLIED 2026-09-21. Live in production under Supabase migration ledger
-- version 20260921174400 (this file's own prefix drifted from that version;
-- bodies verified identical against prod 2026-09-22). Every statement is
-- idempotent — re-running is a no-op.
--
-- Adds order_kind + payment_group_id to public.orders, introduces the OLW
-- number series for sandwich orders, and REPLACES public.tg_orders_assign_number
-- so the BEFORE INSERT trigger dispatches OLF vs OLW off order_kind. The OLF
-- side is BYTE-FOR-BYTE the current live body (introspected against production
-- 2026-09-21).
--
-- Two axes:
--
--   order_kind text NOT NULL DEFAULT 'bread'         -- 'bread' | 'sandwich'
--     Bread is EVERY existing row (the default backfills them) and every one-off
--     loaf order going forward. Sandwich rows are minted by the sandwich kitchen
--     surface (behind an admin-off switch) and are excluded from the bake plan.
--
--   payment_group_id uuid NULL
--     Set on BOTH rows when one payment splits a mixed cart (a bread order + a
--     sandwich order paid in one Razorpay flow). NULL on the single-row common
--     case. A shared UUID is intentional — the two rows are peer members of the
--     group, so a self-referential FK would create an insert-order paradox.
--
-- OLW numbering:
--
--   Own sequence `public.orders_sandwich_number_seq`, own column
--   `orders.sandwich_number_seq`, and a `NEW.order_number := 'OLW' || ...`
--   branch inside the trigger. OLF is unchanged for order_kind='bread'.
--   The two sequences share nothing — a gap in OLF is not a sandwich, and
--   vice versa. Match the two-counter split from 2026-09-14 (OLF vs OLS).
--
-- WHY THE FUNCTION REPLACE IS SAFE:
--
--   The current function does two things: assigns OLF+order_number_seq, and
--   loops on gen_public_ref() until public_ref is unique. Both are preserved
--   verbatim. Only the numbering branch changes, and it changes ONLY when
--   NEW.order_kind = 'sandwich' — which is impossible until this migration
--   runs, so pre-application there is nothing to differ over.

-- 1. Columns on public.orders.
alter table public.orders
  add column if not exists order_kind text not null default 'bread';

do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema='public' and table_name='orders'
      and constraint_name='orders_order_kind_check'
  ) then
    alter table public.orders
      add constraint orders_order_kind_check
      check (order_kind in ('bread','sandwich'));
  end if;
end $$;

alter table public.orders
  add column if not exists payment_group_id uuid;

alter table public.orders
  add column if not exists sandwich_number_seq bigint;

-- 2. OLW sequence. Owned by the column so a drop cascades cleanly.
create sequence if not exists public.orders_sandwich_number_seq
  as bigint minvalue 1 start with 1 increment by 1 no cycle;

alter sequence public.orders_sandwich_number_seq
  owned by public.orders.sandwich_number_seq;

-- 3. Indexes.
--   order_kind is low-cardinality (two values, ~99% 'bread'), so a plain
--   btree would rarely be picked. Partial index on 'sandwich' keeps the
--   admin "sandwich orders" tab cheap without paying for the bread scan.
create index if not exists orders_kind_sandwich_idx
  on public.orders (created_at desc)
  where order_kind = 'sandwich';

--   payment_group_id lookups are always "give me both rows in this group"
--   — a partial index on the non-null side avoids the 99% NULL cost.
create index if not exists orders_payment_group_idx
  on public.orders (payment_group_id)
  where payment_group_id is not null;

-- 4. Trigger function REPLACEMENT. OLF branch is unchanged from production.
create or replace function public.tg_orders_assign_number()
  returns trigger
  language plpgsql
  set search_path to ''
as $function$
  begin
    -- Sandwich orders take OLW<n> from their own sequence. Own counter so a
    -- gap in OLF is not a sandwich, and vice versa. Kitchen is admin-off
    -- until Sunny flips it, so this branch is unreachable in production
    -- until then.
    if new.order_kind = 'sandwich' then
      if new.sandwich_number_seq is null then
        new.sandwich_number_seq := nextval('public.orders_sandwich_number_seq');
        new.order_number := 'OLW' || new.sandwich_number_seq::text;
      end if;
    else
      -- Bread orders. BYTE-FOR-BYTE the live body — this branch must not
      -- change without a memory update. Order_number_seq + OLF are the
      -- customer-facing number since 2026-09-14. History note in the live
      -- body preserved verbatim below.
      -- OLF<n> is the customer-facing number for a one-off order.
      -- History, both on 2026-09-14: numbers were renumbered from 1 and split
      -- off the shared counter (as OLS<n>), then the PREFIXES were swapped so
      -- that OLF = order and OLS = subscription. The swap changed the three
      -- letters only -- OLS45 became OLF45. Sequences were not touched.
      -- WARNING: "OLS" now means SUBSCRIPTION. Any note, comment or transcript
      -- older than 2026-09-14 that reads OLS and means an order is STALE.
      if new.order_number_seq is null then
        new.order_number_seq := nextval('public.orders_number_seq');
        new.order_number := 'OLF' || new.order_number_seq::text;
      end if;
    end if;

    -- public_ref is RETAINED and still generated: it is the admin search key
    -- and it is printed on SMS already delivered and unchangeable. It is no
    -- longer what we show the customer. Runs for BOTH order kinds.
    if new.public_ref is null then
      loop
        new.public_ref := public.gen_public_ref();
        exit when not exists (select 1 from public.orders where public_ref = new.public_ref);
      end loop;
    end if;

    return new;
  end;
$function$;

comment on column public.orders.order_kind is
  'One-of ''bread''|''sandwich''. Chooses OLF vs OLW numbering (see '
  'public.tg_orders_assign_number). Bake plan filters .eq(''order_kind'',''bread''). '
  'Default is ''bread'' so every historical + one-off loaf row is stamped '
  'without a backfill script.';

comment on column public.orders.payment_group_id is
  'Set on BOTH rows when one Razorpay flow splits a mixed cart into a bread '
  'order + a sandwich order. NULL for the single-row common case. Peer members '
  'share the UUID; there is no head row.';

comment on column public.orders.sandwich_number_seq is
  'OLW<n> counterpart to order_number_seq. Populated only when order_kind='
  '''sandwich''. Own sequence public.orders_sandwich_number_seq — a gap in '
  'OLF is NOT a sandwich, and vice versa.';
