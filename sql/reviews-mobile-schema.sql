-- =============================================================================
-- REVIEWS — defensive schema baseline for mobile review submissions
-- =============================================================================
-- Run this in the Supabase SQL Editor. Idempotent — safe to re-run.
--
-- Context:
--   The website POST /api/reviews and mobile POST /api/mobile/reviews both
--   insert into public.reviews with shape:
--     { product_slug, author_name, rating, body, customer_phone }
--   and rely on these additional columns for soft-delete bookkeeping:
--     { is_deleted, deleted_at }
--   The base schema in src/lib/database.sql predates the OTP-verified review
--   flow and does NOT declare customer_phone / is_deleted / deleted_at. They
--   were added directly in Supabase over time — this script makes that state
--   reproducible and surfaces drift if a column is missing.
--
-- Effect:
--   * Adds customer_phone (TEXT, nullable) if missing.
--   * Adds is_deleted (BOOLEAN NOT NULL DEFAULT false) if missing.
--   * Adds deleted_at (TIMESTAMPTZ) if missing.
--   * NO UNIQUE constraint on (customer_phone, product_slug): users may post
--     multiple reviews if they want to, and the PATCH/DELETE flow handles the
--     "edit existing review" path on the client.
--   * Indexes customer_phone for fast lookups by PATCH/DELETE /api/reviews/[id].
--
-- =============================================================================

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS customer_phone TEXT;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS reviews_customer_phone_idx
  ON public.reviews (customer_phone)
  WHERE customer_phone IS NOT NULL;

-- Verify (optional — read-only, paste output back if reporting drift):
--   SELECT column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--   WHERE table_schema = 'public' AND table_name = 'reviews'
--   ORDER BY ordinal_position;
