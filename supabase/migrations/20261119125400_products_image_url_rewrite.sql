-- =============================================================================
-- public.products.image_url — rewrite raw /object/public/ URLs to the
-- transform endpoint, so the Android app serves resized bytes with no
-- Play release
-- =============================================================================
-- NOT YET APPLIED. Written for human review. Applied by Claude via the
-- Supabase MCP after a human has read it.
--
-- WHY THIS EXISTS. The Android app queries public.products directly with
-- the anon key (CadieuxApp/constants/products.ts:190..206) and uses
-- image_url verbatim. Website code was fixed to wrap URLs in
-- productImageUrl() at render time (merged 2026-11-18, sha 57057ff),
-- but that path never touches the mobile app. Rewriting the column
-- values is the only way to get smaller images to the app without a
-- Play release. Changes to the WEBSITE are a no-op: productImageUrl()
-- is idempotent — a URL that already points at /render/image/public/
-- with a width= query param passes through unchanged (pinned by
-- tests/product-image-transform.test.mjs "is idempotent").
--
-- -----------------------------------------------------------------------------
-- WHAT IT DOES, in order
-- -----------------------------------------------------------------------------
--
--  1. Creates public.zz_products_image_url_20261119 — a full {id, image_url}
--     snapshot of the pre-rewrite state. If we have to undo, this is the
--     backup. Idempotent via IF NOT EXISTS.
--
--  2. Enables RLS on the backup, with NO policies. Matches the posture
--     chosen for every other zz_* backup table in
--     chore/db-cleanup-migrations (20261118195100): service-role only,
--     anon and authenticated cannot read.
--
--  3. UPDATE public.products.image_url ONLY where it currently points
--     at /storage/v1/object/public/ AND does NOT already carry a query
--     string. The query-string exclusion is the idempotence guard —
--     running this migration twice does nothing on the second pass.
--
--     Rewrite shape:
--        /storage/v1/object/public/     →  /storage/v1/render/image/public/
--        append                         →  ?width=1600&quality=80
--     which is what src/lib/supabase-image.ts emits and what the
--     website already renders through.
--
-- -----------------------------------------------------------------------------
-- WHAT IT DELIBERATELY DOES NOT TOUCH
-- -----------------------------------------------------------------------------
--
--   * products.gallery_urls — a text[] not a scalar. The brief named
--     image_url only; gallery_urls is not read by the app's
--     constants/products.ts (it selects image_url alone, see
--     PRODUCT_COLUMNS at CadieuxApp/constants/products.ts:79). If it
--     starts being read later, a sibling migration mirrors this shape
--     over the array with UNNEST + ARRAY_AGG.
--
--   * Any image_url already on the transform endpoint — the website
--     re-renders every URL through productImageUrl() which is
--     idempotent, so a column value rewritten HERE flows through the
--     website unchanged.
--
--   * Any image_url carrying a query string already — exceedingly
--     rare for raw storage URLs today (verified at the 2026-11-18
--     probe) and the second clause in the WHERE excludes it.
-- =============================================================================


-- 1 -------------- backup table -----------------------------------------
--
-- Shape matches the chore/db-cleanup zz_* convention: name ends in the
-- YYYYMMDD stamp, lives in public, holds only the columns needed to
-- undo. No FK back to products — this is a snapshot, not a view.
create table if not exists public.zz_products_image_url_20261119 as
select id, image_url
  from public.products;


-- 2 -------------- RLS on the backup, no policies -----------------------
--
-- Same pattern as 20261118195100_db_cleanup_redundant_policies_and_zz_rls
-- enforces for every other zz_* table in public. anon + authenticated
-- cannot read; service_role bypasses RLS and keeps working.
alter table public.zz_products_image_url_20261119 enable row level security;


-- 3 -------------- the rewrite ------------------------------------------
--
-- Both WHERE clauses matter:
--   * `like '%/storage/v1/object/public/%'` — only touch raw object
--     URLs. Rows already on the transform endpoint are left alone.
--   * `not like '%?%'` — skip anything that already carries a query
--     string. Raw storage URLs at this project have no query string
--     today (probed 2026-11-18), so this clause is belt-and-braces.
--     Without it, a re-run of this migration on a row that already
--     got rewritten would concatenate a SECOND ?width=... after the
--     first ?width=..., producing `?x?width=1600...` which is
--     malformed.
--
-- The rewrite itself is a plain `replace` + concat. Not regexp_replace
-- — the shape is a fixed prefix swap, and a plain replace is both
-- easier to read in review and faster to run than a regex at six rows.
update public.products
   set image_url = replace(image_url,
                            '/storage/v1/object/public/',
                            '/storage/v1/render/image/public/')
                  || '?width=1600&quality=80',
       updated_at = now()
 where image_url like '%/storage/v1/object/public/%'
   and image_url not like '%?%';
