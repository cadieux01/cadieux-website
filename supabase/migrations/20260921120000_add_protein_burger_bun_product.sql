-- Protein Burger Bun — a new one-time-only product.
--
-- NOT APPLIED. Reported for review first.
--
-- Sold exactly like a loaf on the one-time path (`/api/checkout` and
-- `/api/create-order` both resolve a cart line by `products.slug`, so a row
-- here is all the order path needs), and deliberately ABSENT from the
-- subscription wizard: `getSubscriptionPlans` filters on
-- `is_subscription_plan = true`, so leaving the flag false is the whole of
-- the exclusion. There is no second list to keep in step.
--
-- `subscription_discount_pct` is set EXPLICITLY to 0. The column is
-- NOT NULL DEFAULT 10.0, so omitting it would silently record a 10% plan
-- discount on a product that has no plan — inert today, but a landmine the
-- day someone flips `is_subscription_plan`.
--
-- `available_from` stays NULL: that column is the pre-order floor, and NULL
-- means "no restriction", which is what "orderable on any delivery date
-- under the normal 12 h rule" resolves to. The 12 h lead is enforced by
-- `validateBookingSlot`, not by anything on the product row.
--
-- `weight` MUST parse as a bare gram figure. `parseWeightGrams`
-- (src/lib/stat-tiles.ts) accepts only `^(\d+(\.\d+)?)\s*(kg|g)?$`, and its
-- output feeds three things that all have to agree: the schema.org
-- QuantitativeValue on the PDP, the `net_weight` stat tile, and
-- `sliceWeightGrams`, which is the denominator of the nutrition save guard.
-- The customer-facing unit label ("Pack of 2 · 90 g each · 180 g net")
-- therefore lives in the PDP subtitle, not in this column.

insert into public.products (
  id,
  slug,
  name,
  price_inr,
  weight,
  slices_per_loaf,
  description,
  tagline,
  highlights,
  image_url,
  gallery_urls,
  is_active,
  in_stock,
  is_archived,
  available_from,
  stock_message,
  sort_order,
  is_subscription_plan,
  subscription_per_loaf_inr,
  subscription_discount_pct,
  ingredients,
  allergens,
  nutrition_per_slice
) values (
  'burger-bun',
  'burger-bun',
  'Protein Burger Bun',
  69,
  '180g',
  -- The pack holds 2 buns. `slices_per_loaf` is a COUNT of the unit the
  -- nutrition figures describe; for this product that unit is a bun, not a
  -- slice. The column name is the loaf-era one and is not worth renaming —
  -- every reader treats it as "how many units in the pack".
  2,
  'High-protein burger bun. No maida.',
  -- Admin-facing only: no storefront surface renders products.tagline (the
  -- shop and PDP read their copy through content_strings). Recorded so the
  -- unit label has a home on the row itself.
  'Pack of 2 · 90 g each · 180 g net',
  '{}',
  -- Photo pending. NULL is the correct value, not a placeholder path: the
  -- bundled stock bread photos were deleted on purpose (they were not
  -- pictures of the product), and `resolveHeroImage` returns null so the
  -- tile and PDP render their empty state until a real photo is uploaded
  -- from /admin.
  null,
  '{}',
  true,
  true,
  false,
  null,
  null,
  3,
  false,
  null,
  0,
  null,
  null,
  -- PER BUN (90 g), because that is the unit `nutrition_per_slice` describes
  -- and the only unit the PDP nutrition table prints. The per-pack column
  -- from the lab sheet is NOT stored: nothing renders a pack total, and
  -- storing both would be two figures for one food label with no mechanism
  -- keeping them in step.
  --
  -- Values a lab reported as "less than" are stored as bounds ("<0.09"),
  -- never as the bare number — 0.09 would be a precision claim the report
  -- does not make. `parseNutrientValue` accepts the string form and the
  -- PDP prints it as "< 0.09 g".
  --
  -- Clears both arms of `validateNutritionPerSlice`:
  --   macro sum 14.93 + 40.36 + 5.28 + 3.02 = 63.59 g  <=  90 g per bun
  --   Atwater  4(14.93) + 4(40.36) + 9(3.02) + 2(5.28) = 258.90 kcal,
  --            4.2% from the stated 248 kcal (tolerance 20%)
  jsonb_build_object(
    'protein_g',       14.93,
    'carbs_g',         40.36,
    'fat_g',            3.02,
    'fibre_g',          5.28,
    'sugar_g',          3.36,
    'saturated_fat_g',  0.403,
    'trans_fat_g',    '<0.09',
    'added_sugar_g',   '<0.9',
    'sodium_mg',      568.89,
    'cholesterol_mg',  '<0.9',
    'calories',           248
  )
)
on conflict (id) do nothing;

-- Stat strip. EVERY tile here is a derived key — `resolveStatTiles` ignores
-- the stored `value` for these four and reads through to the products row
-- above, so the strip cannot drift from the nutrition table or the net
-- weight. The values below are written anyway because the column is NOT
-- NULL and the admin editor shows them; they are never rendered.
--
-- No free-text tile carries a food-label figure. "90 g each" is deliberately
-- absent as a tile: it is 180g / 2, both of which ARE on the strip, and a
-- hand-typed third figure would be the one that goes stale.
--
-- Labels are the only free text, which is where "bun" replaces "slice".
insert into public.product_stat_tiles (product_id, locale, tile_key, value, label, sort_order, is_visible)
values
  ('burger-bun', 'en', 'protein_per_slice', '14.93', 'Protein/bun',    1, true),
  ('burger-bun', 'en', 'fiber_per_slice',    '5.28', 'Fibre/bun',      2, true),
  ('burger-bun', 'en', 'slices',                '2', 'Buns per pack',  3, true),
  ('burger-bun', 'en', 'net_weight',        '180g',  'Net weight',     4, true)
on conflict do nothing;
