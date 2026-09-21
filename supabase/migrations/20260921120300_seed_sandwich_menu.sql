-- HELD — NOT APPLIED. Sunny to review before running.
--
-- First-cut sandwich menu (2026-09-21). Every insert is
-- `on conflict do nothing`, so re-running never overwrites an operator edit —
-- once admin has touched a row, this file is inert against it.
--
-- Prices are per-bread. A missing (sandwich, bread) row means "not offered on
-- that bread" — the migration deliberately does not seed a placeholder for
-- combinations the menu marks "—". Two rows minus one, not two rows with a
-- NULL sentinel.
--
-- Bread slugs used: 'high-protein' and 'multigrain' — these match products.slug
-- on live (the Plain loaf's product row has slug='high-protein'). Free-text on
-- sandwich_variants (no FK to products); rename-safe.
--
-- sort_order steps in 10s so admin can insert-between without renumbering the
-- whole list.

-- ── VEG ────────────────────────────────────────────────────────────────
insert into public.sandwiches (slug, name, category, sort_order) values
  ('veg-plain',                'Veg plain',                        'veg', 10),
  ('veg-grilled',              'Veg grilled',                      'veg', 20),
  ('grilled-spinach-corn',     'Grilled spinach & corn',           'veg', 30),
  ('cucumber-herb-tramezzini', 'Cucumber & fresh herb tramezzini', 'veg', 40),
  ('grilled-cheesy-garlic',    'Grilled cheesy garlic',            'veg', 50),
  ('tawa-paneer',              'Tawa paneer',                      'veg', 60),
  ('no-cook-paneer',           'No-cook paneer',                   'veg', 70),
  ('guac',                     'Guac',                             'veg', 80)
on conflict (slug) do nothing;

-- ── NON-VEG ────────────────────────────────────────────────────────────
insert into public.sandwiches (slug, name, category, sort_order) values
  ('sunny-side-avocado',        'Sunny-side up eggs with avocado', 'nonveg', 110),
  ('tamago-sando',              'Tamago sando',                    'nonveg', 120),
  ('grilled-tamago-sando',      'Grilled tamago sando',            'nonveg', 130),
  ('plain-chicken-coleslaw',    'Plain chicken coleslaw',          'nonveg', 140),
  ('grilled-chicken-coleslaw',  'Grilled chicken coleslaw',        'nonveg', 150),
  ('grilled-chicken-tikka',     'Grilled chicken tikka',           'nonveg', 160),
  ('grilled-chicken-mozzarella','Grilled chicken with mozzarella', 'nonveg', 170),
  ('grilled-chicken-special',   'Grilled chicken special',         'nonveg', 180),
  ('grilled-chicken-pesto',     'Grilled chicken with pesto',      'nonveg', 190),
  ('grilled-chicken-avocado',   'Grilled chicken with avocado',    'nonveg', 200),
  ('fried-chicken-mozzarella',  'Fried chicken with mozzarella',   'nonveg', 210)
on conflict (slug) do nothing;

-- ── VARIANTS ───────────────────────────────────────────────────────────
-- Insert row-by-row via SELECT so the sandwich_id lookup is inline and the
-- migration stays a single transactional block. `on conflict do nothing` is
-- keyed on the (sandwich_id, bread_slug) UNIQUE — an existing price is
-- respected. "—" combinations are ABSENT rows, never present-with-NULL.

-- Veg: high-protein
insert into public.sandwich_variants (sandwich_id, bread_slug, price_inr)
  select id, 'high-protein', 120 from public.sandwiches where slug='veg-plain'
  union all select id, 'high-protein', 160 from public.sandwiches where slug='veg-grilled'
  union all select id, 'high-protein', 140 from public.sandwiches where slug='grilled-spinach-corn'
  union all select id, 'high-protein', 100 from public.sandwiches where slug='cucumber-herb-tramezzini'
  union all select id, 'high-protein', 140 from public.sandwiches where slug='grilled-cheesy-garlic'
  union all select id, 'high-protein', 160 from public.sandwiches where slug='tawa-paneer'
  union all select id, 'high-protein', 140 from public.sandwiches where slug='no-cook-paneer'
  union all select id, 'high-protein', 150 from public.sandwiches where slug='guac'
on conflict (sandwich_id, bread_slug) do nothing;

-- Veg: multigrain (veg-plain is intentionally OMITTED — menu says "—")
insert into public.sandwich_variants (sandwich_id, bread_slug, price_inr)
  select id, 'multigrain', 200 from public.sandwiches where slug='veg-grilled'
  union all select id, 'multigrain', 180 from public.sandwiches where slug='grilled-spinach-corn'
  union all select id, 'multigrain', 140 from public.sandwiches where slug='cucumber-herb-tramezzini'
  union all select id, 'multigrain', 180 from public.sandwiches where slug='grilled-cheesy-garlic'
  union all select id, 'multigrain', 200 from public.sandwiches where slug='tawa-paneer'
  union all select id, 'multigrain', 180 from public.sandwiches where slug='no-cook-paneer'
  union all select id, 'multigrain', 190 from public.sandwiches where slug='guac'
on conflict (sandwich_id, bread_slug) do nothing;

-- Non-veg: high-protein
insert into public.sandwich_variants (sandwich_id, bread_slug, price_inr)
  select id, 'high-protein', 150 from public.sandwiches where slug='sunny-side-avocado'
  union all select id, 'high-protein', 118 from public.sandwiches where slug='tamago-sando'
  union all select id, 'high-protein', 128 from public.sandwiches where slug='grilled-tamago-sando'
  union all select id, 'high-protein', 140 from public.sandwiches where slug='plain-chicken-coleslaw'
  union all select id, 'high-protein', 160 from public.sandwiches where slug='grilled-chicken-coleslaw'
  union all select id, 'high-protein', 180 from public.sandwiches where slug='grilled-chicken-tikka'
  union all select id, 'high-protein', 160 from public.sandwiches where slug='grilled-chicken-mozzarella'
  union all select id, 'high-protein', 190 from public.sandwiches where slug='grilled-chicken-special'
  union all select id, 'high-protein', 200 from public.sandwiches where slug='grilled-chicken-pesto'
  union all select id, 'high-protein', 220 from public.sandwiches where slug='grilled-chicken-avocado'
  union all select id, 'high-protein', 180 from public.sandwiches where slug='fried-chicken-mozzarella'
on conflict (sandwich_id, bread_slug) do nothing;

-- Non-veg: multigrain (tamago-sando + plain-chicken-coleslaw OMITTED — "—")
insert into public.sandwich_variants (sandwich_id, bread_slug, price_inr)
  select id, 'multigrain', 190 from public.sandwiches where slug='sunny-side-avocado'
  union all select id, 'multigrain', 170 from public.sandwiches where slug='grilled-tamago-sando'
  union all select id, 'multigrain', 200 from public.sandwiches where slug='grilled-chicken-coleslaw'
  union all select id, 'multigrain', 220 from public.sandwiches where slug='grilled-chicken-tikka'
  union all select id, 'multigrain', 200 from public.sandwiches where slug='grilled-chicken-mozzarella'
  union all select id, 'multigrain', 230 from public.sandwiches where slug='grilled-chicken-special'
  union all select id, 'multigrain', 240 from public.sandwiches where slug='grilled-chicken-pesto'
  union all select id, 'multigrain', 260 from public.sandwiches where slug='grilled-chicken-avocado'
  union all select id, 'multigrain', 220 from public.sandwiches where slug='fried-chicken-mozzarella'
on conflict (sandwich_id, bread_slug) do nothing;
