-- Per-product delivery floor ("pre-order until stock lands").
--
-- Context: Multigrain raw materials are in transit; the earliest Multigrain
-- delivery is 24 Sep 2026. Plain is unaffected. The product must stay VISIBLE,
-- BROWSABLE and SELLABLE — customers pre-order it, they just cannot pick a
-- delivery date before the floor.
--
-- WHY NOT `in_stock`: `in_stock = false` is a hard sell-block on seven server
-- paths (api/checkout, lib/order-validation, api/mobile/{checkout,create-order,
-- subscriptions}) and `lib/subscription-plans.ts` filters the plan list with
-- `.eq("in_stock", true)`. Flipping it would make Multigrain unbuyable and
-- unsubscribable — the opposite of pre-order. Overloading it would also make
-- every existing `in_stock === false` check silently wrong. `in_stock` keeps
-- its meaning; the floor sits BESIDE it.
--
-- WHY NOT `app_config.preorder_mode`: that toggle is site-wide and dateless
-- ("we'll schedule it later"). Turning it on would take Plain offline too.
-- It is deliberately untouched by this migration.
--
-- Idempotent by construction — migrations here are applied BY HAND (see
-- README.md in this directory); a filename is documentation, not proof.

-- ── 1. Schema ─────────────────────────────────────────────────────────────

alter table public.products
  add column if not exists available_from date,
  add column if not exists stock_message  text;

comment on column public.products.available_from is
  'Earliest deliverable date for this product (IST). NULL = no restriction. '
  'Independent of in_stock, which keeps its existing meaning (false = never '
  'sell). When set, the storefront shows an OUT OF STOCK badge with a PRE-ORDER '
  'button, the date pickers floor to this date, and the server rejects any '
  'earlier date with code "preorder_floor". An order containing several '
  'products floors to MAX(available_from) across its lines — orders carry one '
  'delivery_date and there is no split-fulfilment concept in this schema.';

comment on column public.products.stock_message is
  'Customer-facing availability line, e.g. "Back in stock Thursday 24 '
  'September." NULL = derive the sentence from available_from. Tone override '
  'only: available_from is the source of truth and the only thing enforced. '
  'Never hardcode the date in application code.';

-- ── 2. Data: put Multigrain on a 24 Sep 2026 floor ────────────────────────
-- in_stock is deliberately NOT touched. It stays true.

update public.products
   set available_from = date '2026-09-24',
       stock_message  = 'Back in stock Thursday 24 September.'
 where slug = 'multigrain';

-- ── 3. Data: the app-only copy ────────────────────────────────────────────
-- The Android app has NO OTA (no expo-updates, no runtimeVersion), and its
-- Supabase select list is a hardcoded column string baked into the shipped
-- binary (`PRODUCT_COLUMNS` in constants/products.ts). `available_from` and
-- `stock_message` are therefore INVISIBLE to every installed build. The row
-- below is the only way to tell an app customer anything without a Play
-- release. Server-side `preorder_floor` rejection is what actually ENFORCES
-- the floor for the app; this is the copy that stops them finding out at the
-- payment screen.
--
-- ORDER MATTERS: ship the server-side rejection BEFORE running this section.
-- Reversed, an app customer reads "pre-order, back Thu 24 Sep" while the
-- server still cheerfully books them for tomorrow — a promise the system
-- then breaks.
--
-- WHY NOT `products.tagline` AS WELL: it would reach three app screens
-- instead of one (PDP, subscription setup picker, home tab card) and is the
-- more visible surface — which is exactly why it is the wrong lever. Neither
-- string self-expires, but `available_from` does: a floor in the past yields
-- no floor, so every badge, pill, button and calendar block on the website
-- clears itself on 24 Sep with no action. Overwriting `tagline` would leave a
-- stale pre-order sentence on three screens if the manual cleanup below were
-- missed, against one screen here. Smallest blast radius wins.

-- content_strings 'pdp.subtitle' — the app PDP resolves its subtitle as
--   pickString(content, 'pdp.subtitle', productId) || product.tagline
-- (app/shop/[slug].tsx:100, rendered :261). Today NO such row exists, so the
-- tagline shows through by ACCIDENT.
--
-- *** READ THIS BEFORE EDITING CONTENT ***
-- This row is a GUARD, not decoration. content_strings is admin-editable from
-- /admin/content. If this row were absent, anyone seeding a Multigrain
-- subtitle would silently delete the pre-order line from the app PDP — no
-- error, no warning, and no way to fix it without a Play release. Owning the
-- row converts "depends on a row never existing" into "depends on a row we
-- created, visible in the admin editor".
-- Do not delete it while products.available_from is set for multigrain.
--
-- The website suppresses its own content subtitle while a floor is live
-- (src/app/shop/[slug]/page.tsx and src/app/shop/page.tsx render the
-- availability block from stock_message instead), so this line does not print
-- twice there. The corollary is in the restore block: clearing the floor
-- UNSUPPRESSES it, so this row must be deleted FIRST, not after.
--
-- Full row shape deliberately: every product-scoped pdp.* row on prod carries
-- locale='en', page_slug='pdp', is_visible=true and a product_id. page_slug is
-- nullable, so omitting it fails silently rather than loudly — and would put
-- the row outside idx_content_strings_page, which is partial on
-- page_slug IS NOT NULL. The conflict target matches the unique index
-- content_strings_key_locale_product_uniq (key, locale, product_id).
insert into public.content_strings
  (key, locale, page_slug, product_id, value, is_visible, note)
values (
  'pdp.subtitle',
  'en',
  'pdp',
  'multigrain',
  'Pre-order now — back in stock Thursday 24 September.',
  true,
  'Pre-order guard row. See migration 20260918090000. Do not delete while products.available_from is set for multigrain — the app PDP falls back to products.tagline only when this row is absent, and an admin edit here silently overrides the pre-order copy in a shipped app build.'
)
on conflict (key, locale, product_id) do update
   set page_slug  = excluded.page_slug,
       value      = excluded.value,
       is_visible = true,
       note       = excluded.note,
       updated_at = now();

-- ══════════════════════════════════════════════════════════════════════════
-- LIFTING THIS WHEN STOCK LANDS
-- ══════════════════════════════════════════════════════════════════════════
-- Two statements, in THIS ORDER, plus a verify. No deploy, no app build.
--
-- ORDER IS LOAD-BEARING. The website suppresses pdp.subtitle only WHILE a
-- floor is live. Nulling available_from first would unsuppress the guard row
-- and start printing "Pre-order now — back in stock Thursday 24 September."
-- on the website PDP and shop list — the exact stale string this is meant to
-- remove. Delete the row first; the floor is still enforced in between, so
-- there is no window where an early date becomes bookable.
--
--   -- 1. Remove the app PDP guard row FIRST. The app PDP then falls back to
--   --    products.tagline, which this migration never touched.
--   delete from public.content_strings
--    where key = 'pdp.subtitle'
--      and locale = 'en'
--      and product_id = 'multigrain';
--
--   -- 2. Remove the floor. Every badge, availability line, PRE-ORDER button,
--   --    date-picker floor and server rejection clears with it. Website is
--   --    clean within 60s (unstable_cache revalidate 60, tag "products").
--   update public.products
--      set available_from = null,
--          stock_message  = null
--    where slug = 'multigrain';
--
--   -- 3. Belt and braces. An earlier draft of this migration also overwrote
--   --    products.tagline; it was cut before shipping, so on an untouched
--   --    database this statement is a no-op. It is kept because tagline does
--   --    NOT self-expire and reaches three app screens (PDP, subscription
--   --    setup picker, home tab card) with no way to correct it short of a
--   --    Play release. The value is the VERBATIM original, read from prod
--   --    2026-09-18 — do not retype it from memory.
--   update public.products
--      set tagline = 'More Protein. Same Routine.'
--    where slug = 'multigrain'
--      and tagline <> 'More Protein. Same Routine.';
--
--   -- 4. Verify. Expect: 0 rows; then available_from null, stock_message
--   --    null, in_stock true, tagline 'More Protein. Same Routine.'.
--   select count(*) from public.content_strings
--    where key = 'pdp.subtitle' and product_id = 'multigrain';
--   select slug, in_stock, available_from, stock_message, tagline
--     from public.products where slug = 'multigrain';
--
-- Note that step 2 alone is enough to make the SYSTEM correct — the floor is
-- what is enforced, and it expires by itself once 2026-09-24 is in the past.
-- Steps 1 and 3 remove stale COPY, which does not expire. If cleanup is ever
-- missed, this is the whole exposure: one app screen, one sentence.
-- ══════════════════════════════════════════════════════════════════════════
