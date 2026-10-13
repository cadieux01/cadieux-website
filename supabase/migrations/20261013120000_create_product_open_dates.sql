-- Discrete per-product OPEN DAYS, sitting beside the existing floor.
--
-- WHY. `products.available_from` is a FLOOR: one date, and every day after it
-- is bookable. Raja needs specific days. Confirmed with him 2026-10-13:
--
--   multigrain, multigrain-bun, multigrain-pizza-base
--       open 13 Oct, open 16 Oct, then DAILY from 19 Oct
--   high-protein, burger-bun, pizza-base
--       daily from 16 Oct          <- already correct, untouched by this file
--
-- There is NO data-only mitigation for the first group. Setting
-- available_from = 19 Oct closes 13 and 16 Oct, which he wants open; leaving
-- it at 13 Oct (where it is now, and where it has already expired — a floor
-- on today's date yields no floor) opens 14, 15, 17 and 18 Oct, which he is
-- not baking. One date cannot express two open days plus a later ray.
--
-- THE RULE. It is a UNION, not a whitelist:
--     bookable(product, date)  ==  date IN open_dates(product)
--                               OR (available_from IS NOT NULL
--                                   AND date >= available_from)
--
-- Two consequences, and both are the reason this file is safe to apply on its
-- own, ahead of any code:
--
--   (a) A PRODUCT WITH ZERO ROWS BEHAVES EXACTLY AS IT DOES TODAY. The first
--       clause is simply never true for it. All six current products have the
--       `available_from` they had before this file ran, so nothing in the
--       system changes the moment the table lands — not a badge, not a
--       calendar cell, not a server rejection. The rows seeded below are
--       INERT until the reading code deploys.
--
--   (b) ONLY EVER INSERT DATES EARLIER THAN `available_from`. A row on or
--       after the floor is already bookable via the second clause, so it buys
--       nothing and becomes a lie the day the floor moves. Never insert
--       19 Oct or later for the multigrain group: 19 Oct onward is the RAY,
--       and the ray is `available_from`'s job.
--
-- Every existing reader computes the second clause already and stays correct.
-- Once the reading code ships, nothing that is bookable today becomes
-- bookable; some days that are bookable today stop being so. That is the
-- whole point.
--
-- WHY NOT A BLACKOUT TABLE (closed_dates). It inverts the default: a day
-- nobody remembered to blacklist is bookable. That is precisely the failure
-- that produced this exposure. Open days fail CLOSED.
--
-- WHY NOT open_weekdays (a bitmask or a day-key array). 13 Oct is a Monday
-- and 16 Oct is a Thursday with 14/15 shut between them. These are not a
-- weekly pattern and never will be — they track raw-material arrivals.
--
-- WHY NOT in_stock. Unchanged from migration 20260918090000: in_stock=false
-- is a hard sell-block on seven server paths and filters the subscription
-- plan list. These products stay VISIBLE, BROWSABLE and SELLABLE.
--
-- STATUS: APPLIED to production (uejagupcwevadfhfuadv) BY HAND on 2026-10-13.
-- Section 1 and section 2 both ran; verified 6 rows, RLS on, anon SELECT 200,
-- anon INSERT/DELETE 42501, and all six products' available_from and
-- stock_message unchanged. NOT recorded in
-- supabase_migrations.schema_migrations — see README.md: `db push` is
-- forbidden in this directory, so there is no ledger row to add and this file
-- joins the unrecorded list there. Every statement below is idempotent, so a
-- future replay is a no-op.
--
-- Idempotent by construction — migrations here are applied BY HAND (see
-- README.md in this directory); a filename is documentation, not proof.

-- ── 1. Schema ─────────────────────────────────────────────────────────────

create table if not exists public.product_open_dates (
  -- products.id is TEXT and equal to products.slug on every row in prod
  -- (verified 2026-10-13: id = 'multigrain', slug = 'multigrain'). The FK is
  -- what makes that equality self-documenting rather than folklore, and it
  -- stops a typo'd slug becoming a silently dead open day.
  product_id text not null
    references public.products (id) on delete cascade,
  open_date  date not null,
  created_at timestamptz not null default now(),
  primary key (product_id, open_date)
);

comment on table public.product_open_dates is
  'Discrete delivery days for a product, in ADDITION to the open-ended ray '
  'that products.available_from starts. A date is deliverable for a product '
  'iff it has a row here OR it is >= available_from — a UNION, not a '
  'whitelist, so a product with NO rows here behaves exactly as it did '
  'before this table existed. '
  'ONLY INSERT DATES EARLIER THAN available_from: a row on or after the floor '
  'is already bookable through the second clause, so it buys nothing and '
  'turns into a lie the day the floor moves. '
  'Rows in the PAST are kept, not pruned: they explain why an old order '
  'carries that date, and the read path already filters to '
  'open_date >= today (IST) exactly as productFloor() spends a floor whose '
  'date has passed. '
  'INVARIANT WORTH KNOWING: a product with rows here and available_from NULL '
  'has a FINITE set of deliverable days, so a cart combining it with another '
  'product can have an EMPTY intersection and no bookable date at all. That '
  'is legal (a one-day-only special is a real thing) and the storefront has '
  'copy for it, but it is not the shape any of the six current products use — '
  'all six end in a ray.';

comment on column public.product_open_dates.open_date is
  'IST calendar date, yyyy-mm-dd. NOT an instant. The 12-hour booking lead '
  'still applies on top: an open day is only reachable until roughly 12 h '
  'before the slot the customer wants (04:00 IST for a 16:00 slot), so an '
  'open day can be open and unreachable at the same time. Never add a CHECK '
  'against current_date — it is not IMMUTABLE and Postgres refuses it in a '
  'table constraint anyway.';

-- Read-only to the public roles. DELIBERATELY LOOSER than this directory's
-- usual "RLS on, zero policies, service_role only" shape (see
-- delivery_zone_rules), because lib/subscription-plans.ts reads the product
-- catalogue with the ANON key and the subscription wizard would otherwise see
-- an empty open-day set — which degrades to "every date is bookable", the
-- exact direction this table exists to prevent. Open days are printed on the
-- storefront; they are not a secret. Writes stay service_role-only.
alter table public.product_open_dates enable row level security;

revoke all on public.product_open_dates from anon, authenticated;
grant select on public.product_open_dates to anon, authenticated;

drop policy if exists product_open_dates_public_read on public.product_open_dates;
create policy product_open_dates_public_read
  on public.product_open_dates
  for select
  to anon, authenticated
  using (true);

-- ── 2. Data: the multigrain group ─────────────────────────────────────────
-- The two discrete days BELOW the eventual floor. Written as one statement
-- over the three slugs so they cannot drift apart — they share a dough and a
-- bake.
--
-- 19 Oct and after are deliberately ABSENT. That is the ray, and the ray is
-- `available_from`'s job (see rule (b) in the header).
--
-- 13 Oct is TODAY and, past ~04:00 IST, already unreachable under the 12 h
-- lead. It is inserted anyway: it is TRUE, the lead-time gate is what makes
-- it unselectable, and omitting it would make this file wrong if it were
-- replayed. Do not "tidy" it away.

insert into public.product_open_dates (product_id, open_date)
select p.id, d.open_date
  from public.products p
 cross join (values (date '2026-10-13'), (date '2026-10-16')) as d(open_date)
 where p.slug in ('multigrain', 'multigrain-bun', 'multigrain-pizza-base')
    on conflict (product_id, open_date) do nothing;

-- high-protein / burger-bun / pizza-base are deliberately NOT touched.
-- available_from = 2026-10-16 with no open-day rows already means exactly
-- "daily from 16 Oct". Adding rows for them would be noise with a
-- maintenance cost.

-- ── 3. Verify ─────────────────────────────────────────────────────────────
-- Expect 6 rows: three slugs x two dates.
--
--   select product_id, open_date from public.product_open_dates order by 1, 2;

-- ══════════════════════════════════════════════════════════════════════════
-- WHAT THIS FILE DOES NOT DO
-- ══════════════════════════════════════════════════════════════════════════
-- 1. IT DOES NOT MOVE available_from, AND IT DOES NOT CLEAR stock_message.
--    Those two writes belong in the SAME deploy as the reading code, never
--    before it, because neither value is correct on its own:
--
--      available_from = '2026-10-19' closes 16 Oct — an open day — for every
--        reader that cannot yet see this table, and makes the storefront say
--        "from Monday 19 October", which is false.
--      available_from = '2026-10-16' suppresses the website pdp.subtitle for
--        the multigrain trio, and unlike the protein trio theirs is genuine
--        product copy ('More Protein. Same Routine.', 'Pack of 2 · 90 g
--        each · 180 g net', 'One base · 140 g'), not a dated announcement.
--
--    Neither is expressible as a floor. That is the whole reason this table
--    exists. Until the reading code is live the floor stays at 2026-10-13,
--    which has already expired, so the system behaves today exactly as it did
--    this morning — see (a) in the header.
--
-- 2. It does not touch content_strings. The Android app cannot see
--    available_from OR this table — its select list is a hardcoded column
--    string baked into the shipped binary (PRODUCT_COLUMNS in
--    constants/products.ts, verified 2026-10-13: available_from is absent)
--    and there is no OTA. The pdp.subtitle row is the only way to tell an app
--    customer anything. Per the ORDER MATTERS note in migration
--    20260918090000, that copy ships AFTER the server-side rejection is
--    deployed, never before, or the app promises days the server still
--    refuses. It is a separate statement for that reason.
--
-- 3. It does not repair the orders and subscription deliveries ALREADY
--    sitting on days the kitchen is not baking. As of 2026-10-13 that is 20
--    orders (9 paid) and 14 non-cancelled subscription deliveries (3
--    confirmed), almost all of them on 17 Oct — dates that were legal when
--    they were placed, because the floor was then 17 Oct. No migration can
--    decide whether to move or honour them. Reported, not acted on.
--
-- 4. It does not lift itself. When multigrain really does go daily, the whole
--    thing clears with:
--      delete from public.product_open_dates
--       where product_id in ('multigrain','multigrain-bun','multigrain-pizza-base');
--      update public.products set available_from = null
--       where slug in ('multigrain','multigrain-bun','multigrain-pizza-base');
--    No deploy. Both halves self-expire anyway once the floor is past: a
--    floor in the past yields no floor, and open_date < today is filtered out.
-- ══════════════════════════════════════════════════════════════════════════
