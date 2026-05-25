-- Migration: add distance_km to orders table for distance-based delivery fee.
-- delivery_fee already exists (DEFAULT 50) — this just adds the companion column
-- that records how far the driver travelled so admin can audit and refine the
-- fee table over time.
--
-- Nullable so every existing row stays valid without a backfill.
-- Apply once via Supabase SQL Editor → Run.

alter table orders
  add column if not exists distance_km double precision;
