-- Move the production/raw-material tables out of `public` and into `logistics`.
--
-- WHY THIS EXISTS
-- The admin dashboard (cadieux01/cadieux-dashboard, a SEPARATE Vercel project
-- served at /dashboard) creates its Supabase client with
--
--     createClient(url, anonKey, { db: { schema: 'logistics' } })
--
-- so EVERY `.from()` it issues is resolved against the `logistics` schema. It
-- is a browser client holding the anon key, and it authenticates as a real
-- Supabase Auth user, so its RLS identity is `authenticated` — never
-- `service_role`. For that app to reach these tables at all they have to live
-- in the schema its client is pinned to. Phase 1 created them in `public`,
-- which is the website's schema; this migration corrects that placement. It is
-- a MOVE, not a copy: nothing is left behind in `public`.
--
-- WHY IT IS SAFE TO MOVE THEM NOW
-- All six tables are EMPTY — 0 rows each, verified 7 Nov 2026:
--
--     vendors 0 | raw_materials 0 | stock_movements 0
--     production_batches 0 | production_batch_materials 0 | yield_baselines 0
--
-- So there is no data to migrate, no window in which a row could be written to
-- the old location, and nothing to reconcile afterwards. This is the cheapest
-- this move will ever be; once the dashboard starts writing, it stops being a
-- schema rename and becomes a data migration.
--
-- THE FK GRAPH IS SELF-CONTAINED, so no cross-schema foreign key results.
-- Every foreign key that touches the set has BOTH ends inside the set — five of
-- them, confirmed against pg_constraint:
--
--     production_batch_materials.batch_id            -> production_batches
--     production_batch_materials (material_id, unit) -> raw_materials (id, unit)
--     raw_materials.vendor_id                        -> vendors
--     stock_movements.material_id                    -> raw_materials
--     yield_baselines.material_id                    -> raw_materials
--
-- None of them references a table outside the set, and no table outside the set
-- references into it. Moving all six together therefore leaves every FK with
-- both sides in `logistics`. A cross-schema FK would be legal in Postgres but
-- would couple the two schemas permanently; there is none to create here.
--
-- The dependency sweep came back clean too: no other view and no other function
-- in the database references any of these six by name, and the only view over
-- them, `raw_material_stock`, is moved in the same transaction. `stock_movements`
-- carries three guard triggers (no_delete, no_update, no_truncate), all pointing
-- at `prevent_stock_movement_mutation()`, which is why that function is moved as
-- well — triggers resolve their function by OID, so they follow it across the
-- move. The function is `search_path = ''` and schema-qualifies nothing, so it
-- needs no body change.
--
-- WHAT THIS MIGRATION DELIBERATELY DOES NOT DO
-- IT WRITES NO RLS POLICIES AND NO GRANTS. The six deny-all policies against
-- {anon, authenticated} created by phase 1 travel with their tables untouched,
-- and the grants do too, so immediately after this runs the tables are still
-- service_role-only and the dashboard still cannot read them. That is the
-- intended end state of THIS step: a move with no change in who can see what.
--
-- Opening them to `authenticated` is the NEXT migration and it needs designing
-- against `logistics.profiles.role` — the dashboard's roles are 'admin',
-- 'sales' and 'partner', enforced today only client-side in ProtectedRoute.jsx,
-- so a policy written against `authenticated` alone would expose raw-material
-- costs and vendor terms to every partner login. Granting access and relocating
-- the tables are kept in separate migrations so the relocation can be reviewed
-- and reverted without touching the permission model.
--
-- APPLIED TO PRODUCTION BY HAND on 7 Nov 2026, not by `supabase db push` — the
-- linked ref IS production. Registered in supabase_migrations.schema_migrations
-- as version 20261107103856, which is where this file's name comes from: the
-- ledger version is minted at apply time, so the filename is renamed to match
-- it afterwards rather than the other way round.
--
-- NOT IDEMPOTENT, and deliberately left that way. `alter ... set schema` errors
-- once the object is already in `logistics`, which is the honest behaviour for a
-- one-way relocation: a second run SHOULD fail loudly rather than no-op and
-- imply the move is still pending. It is one transaction, so a failure part-way
-- through leaves nothing half-moved.
--
-- TO REVERSE: the same eight statements with `set schema public`. Safe while the
-- tables are still empty; once the dashboard starts writing, reversing stops
-- being a rename and becomes a data migration.

begin;

alter table public.vendors                   set schema logistics;
alter table public.raw_materials             set schema logistics;
alter table public.stock_movements           set schema logistics;
alter table public.production_batches        set schema logistics;
alter table public.production_batch_materials set schema logistics;
alter table public.yield_baselines           set schema logistics;
alter view  public.raw_material_stock        set schema logistics;
alter function public.prevent_stock_movement_mutation() set schema logistics;

commit;
