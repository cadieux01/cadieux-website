-- R6 — take the DATED announcement out of `pdp.subtitle`.
--
-- STATUS: APPLIED to production (uejagupcwevadfhfuadv) BY HAND on 2026-10-13.
-- Not in the remote ledger. See README.md in this directory — migrations here
-- are applied statement-for-statement by hand and every statement is
-- idempotent.
--
-- THE PROBLEM
--
-- Three products carried this in their `pdp.subtitle` row:
--
--     "Pre-order now — delivery from Friday 16 October."
--
-- It was put there for the ANDROID APP, which has no OTA and cannot see
-- `products.available_from` at all, so a product's subtitle is the only slot
-- that can tell an installed build about a schedule. The website hid the row
-- while the schedule was live and printed its own sentence instead.
--
-- Two things are wrong with that:
--
--   1. It goes FALSE on 16 October. Nothing clears it, the app has no OTA,
--      and the row then reads as a stale announcement for as long as it sits
--      there. A sentence with a date in it needs an owner to retire it, and
--      it did not have one.
--
--   2. The website's defence was `preorder ? "" : pickString(...)` — a
--      suppression that never looks at the VALUE, only at whether the product
--      has a schedule. So it also blanked the three MULTIGRAIN subtitles,
--      which are genuine product copy and not announcements at all. Real copy
--      was being hidden to mask copy that should never have been written.
--
-- THE FIX, in the order it has to happen: retire the dated copy first (this
-- file), then delete the suppression in the reading code. The reverse order
-- unmasks the stale sentence on the website.
--
-- The replacement strings are not new words. Each is the product's existing
-- bundled editorial subtitle from `src/lib/data.ts` (PRODUCTS[].subtitle) —
-- for `burger-bun` and `pizza-base` also the `CRITICAL_FALLBACKS` entry in
-- `src/lib/content.ts`, so website copy is unchanged for those two by
-- construction. `high-protein` has NO bundled fallback for this key, which is
-- why the row is updated rather than deleted: delete it and that product's
-- subtitle would render empty on the web and in the app.
--
-- Idempotent: each UPDATE is keyed on the exact stale value, so replaying is a
-- no-op and a row an editor has since rewritten by hand is left alone.

update content_strings
set value = 'Clean sandwich bread built for protein without the fuss. Soft slices, no compromise.',
    note = 'Product subtitle. Keep it UNDATED — the Android app has no OTA and nothing retires a sentence with a date in it. Baking days are rendered from products.available_from + product_open_dates, never from this row.',
    updated_at = now()
where key = 'pdp.subtitle'
  and locale = 'en'
  and product_id = 'high-protein'
  and value = 'Pre-order now — delivery from Friday 16 October.';

update content_strings
set value = 'Pack of 2 · 90 g each · 180 g net',
    note = 'Product subtitle. Keep it UNDATED — the Android app has no OTA and nothing retires a sentence with a date in it. Baking days are rendered from products.available_from + product_open_dates, never from this row.',
    updated_at = now()
where key = 'pdp.subtitle'
  and locale = 'en'
  and product_id = 'burger-bun'
  and value = 'Pre-order now — delivery from Friday 16 October.';

update content_strings
set value = 'Our protein dough, shaped and par-baked for the oven.',
    note = 'Product subtitle. Keep it UNDATED — the Android app has no OTA and nothing retires a sentence with a date in it. Baking days are rendered from products.available_from + product_open_dates, never from this row.',
    updated_at = now()
where key = 'pdp.subtitle'
  and locale = 'en'
  and product_id = 'pizza-base'
  and value = 'Pre-order now — delivery from Friday 16 October.';

-- The three MULTIGRAIN rows are deliberately NOT touched. Their values are
-- already genuine product copy ("More Protein. Same Routine.",
-- "Pack of 2 · 90 g each · 180 g net", "One base · 140 g"); only their `note`
-- described them as pre-order guard rows, which was never true of the value.
update content_strings
set note = 'Product subtitle. Keep it UNDATED — the Android app has no OTA and nothing retires a sentence with a date in it. Baking days are rendered from products.available_from + product_open_dates, never from this row.',
    updated_at = now()
where key = 'pdp.subtitle'
  and locale = 'en'
  and product_id in ('multigrain', 'multigrain-bun', 'multigrain-pizza-base')
  and note like '%TEAR DOWN THIS ROW%';
