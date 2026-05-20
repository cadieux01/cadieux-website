-- Pickup locations migration. Run once in the Supabase SQL editor.
-- All statements are idempotent so you can re-run safely.
--
-- Replaces the hard-coded `src/lib/find-us-locations.ts` array with a
-- DB-backed catalogue the admin can edit live. Pickup locations are
-- the physical points a customer can collect orders from — the kitchen
-- itself, owned-and-operated stalls, and partner pickup spots.
--
-- Communities and gyms (the wider delivery footprint) are NOT modelled
-- here; they're surfaced via service_areas and outbound delivery only.

begin;

-- 1) Type enum.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'pickup_location_type') then
    create type public.pickup_location_type as enum (
      'kitchen',
      'stall',
      'partner_pickup'
    );
  end if;
end$$;

-- 2) Table.
create table if not exists public.pickup_locations (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  type         public.pickup_location_type not null,
  area         text not null,
  address      text not null,
  latitude     double precision not null,
  longitude    double precision not null,
  notes        text,
  sort_order   integer not null default 0,
  is_archived  boolean not null default false,
  archived_at  timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists pickup_locations_active_idx
  on public.pickup_locations (is_archived, sort_order)
  where is_archived = false;

create index if not exists pickup_locations_type_idx
  on public.pickup_locations (type);

-- 3) updated_at trigger. Reuses the public.touch_updated_at() function
--    already defined by the product-editor migration; create it here
--    too in case that migration hasn't been run.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists pickup_locations_touch_updated_at on public.pickup_locations;
create trigger pickup_locations_touch_updated_at
before update on public.pickup_locations
for each row execute function public.touch_updated_at();

-- 4) RLS. Service-role bypasses RLS automatically; "no policy = no
--    access" semantics keep anon/auth out so all writes go through
--    the admin API (which uses service-role).
alter table public.pickup_locations enable row level security;

-- 5) Seed the ten existing stalls. Kitchen-flagship (stall-01) becomes
--    type=kitchen; the other nine become type=stall. Coordinates and
--    areas mirror the previous find-us-locations.ts entries so the
--    public marker positions don't shift on first deploy.
insert into public.pickup_locations
  (name, type, area, address, latitude, longitude, notes, sort_order)
values
  ('Cadieux Kitchen + Flagship Stall', 'kitchen',
   'PM Palem / Bakkanapalem',
   'PM Palem / Bakkanapalem, Visakhapatnam',
   17.8096875, 83.33767189999999,
   'Our flagship — also the kitchen.', 0),
  ('Cadieux Madhurawada Stall', 'stall',
   'Madhurawada / Kommadi / IT Park',
   'Madhurawada / Kommadi / IT Park, Visakhapatnam',
   17.8170275, 83.3422987, null, 10),
  ('Cadieux Rushikonda Stall', 'stall',
   'Rushikonda / Beach Rd North',
   'Rushikonda / Beach Rd North, Visakhapatnam',
   17.7925467, 83.38420219999999, null, 20),
  ('Cadieux Yendada Stall', 'stall',
   'Yendada / Sagar Nagar / IT Corridor',
   'Yendada / Sagar Nagar / IT Corridor, Visakhapatnam',
   17.7751229, 83.3632739, null, 30),
  ('Cadieux MVP Colony Stall', 'stall',
   'MVP Sectors 1-12',
   'MVP Sectors 1-12, Visakhapatnam',
   17.746291, 83.3383315, null, 40),
  ('Cadieux Seethammadhara Stall', 'stall',
   'Seethammadhara / HB Colony / Pedda Waltair',
   'Seethammadhara / HB Colony / Pedda Waltair, Visakhapatnam',
   17.7435916, 83.3172987, null, 50),
  ('Cadieux Siripuram Stall', 'stall',
   'Siripuram / RK Beach / Waltair Uplands',
   'Siripuram / RK Beach / Waltair Uplands, Visakhapatnam',
   17.720371999999998, 83.31680709999999, null, 60),
  ('Cadieux Dwaraka Nagar Stall', 'stall',
   'Dwaraka Nagar / Jagadamba / Central',
   'Dwaraka Nagar / Jagadamba / Central, Visakhapatnam',
   17.729416699999998, 83.3092679, null, 70),
  ('Cadieux Akkayyapalem Stall', 'stall',
   'Akkayyapalem / Maddilapalem / NAD North',
   'Akkayyapalem / Maddilapalem / NAD North, Visakhapatnam',
   17.7352775, 83.29995249999999, null, 80),
  ('Cadieux Gajuwaka Stall', 'stall',
   'Gajuwaka / Vadlapudi / Steel Plant',
   'Gajuwaka / Vadlapudi / Steel Plant, Visakhapatnam',
   17.7096554, 83.17806019999999, null, 90)
on conflict do nothing;

commit;

-- 6) Pincode + Google place_id (added later). Both nullable so older
--    rows that were inserted before this migration keep working.
--    google_place_id improves /find-us "Get Directions" accuracy when
--    present; pincode lets the public locator search by pincode.
begin;

alter table public.pickup_locations
  add column if not exists pincode text;

alter table public.pickup_locations
  add column if not exists google_place_id text;

create index if not exists pickup_locations_pincode_idx
  on public.pickup_locations (pincode)
  where pincode is not null;

commit;
