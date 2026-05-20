-- Areas We Serve — geocoding + proximity auto-approve.
--
-- Adds latitude/longitude/geocoded_at to service_areas so the public
-- pincode-check route can compute haversine distance to active areas
-- and approve nearby (≤3km) pincodes that aren't directly active.
--
-- Also adds:
--   * pincode_geocache — a tiny cache of customer-pincode → lat/lng to
--     keep Google Geocoding API spend down (one lookup per pincode ever).
--   * delivery_requests.source — distinguishes manual "send request"
--     submissions from automatic "area suggestion" rows created by a
--     proximity-approved order. Status stays 'pending' for both so the
--     existing admin UI surfaces them unchanged.
--
-- Idempotent — safe to re-run.

begin;

alter table public.service_areas
  add column if not exists latitude double precision,
  add column if not exists longitude double precision,
  add column if not exists geocoded_at timestamptz;

create index if not exists service_areas_active_geocoded_idx
  on public.service_areas (is_active)
  where is_active = true and latitude is not null and longitude is not null;

create table if not exists public.pincode_geocache (
  pincode text primary key,
  latitude double precision not null,
  longitude double precision not null,
  created_at timestamptz not null default now()
);

alter table public.delivery_requests
  add column if not exists source text not null default 'manual';

commit;
