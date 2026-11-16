-- =============================================================================
-- logistics production tables: let DASHBOARD ADMINS read/write raw materials,
-- vendors and stock movements. Nothing changes for sales, partner or anon.
-- =============================================================================
-- APPLIED BY HAND to PRODUCTION (ref uejagupcwevadfhfuadv) on 2026-11-16 via
-- the Supabase MCP `apply_migration`; minted ledger version 20261116174449,
-- which is this filename. `supabase db push` is never run in this repo -- read
-- ./README.md before touching anything here. Every statement below is
-- idempotent and the re-run was done via `execute_sql`, never a second
-- `apply_migration` (that would mint a duplicate ledger row).
--
-- ONE DIFFERENCE between the text applied and the text below, disclosed rather
-- than glossed over: the `apply_migration` payload carried a SHORTER comment
-- preamble, because this block quotes a ledger version that did not exist until
-- the apply returned. The EXECUTABLE STATEMENTS were byte-identical -- verified
-- by stripping comment lines from both texts and diffing to exit 0. Nothing
-- below was re-ordered, added or removed.
--
-- -----------------------------------------------------------------------------
-- WHY
-- -----------------------------------------------------------------------------
-- The six production tables moved `public` -> `logistics` on 2026-11-07 (ledger
-- 20261107103856) carrying their original ACLs, which are postgres +
-- service_role ONLY. Measured on prod 2026-11-16: relacl on vendors,
-- raw_materials, stock_movements, production_batch_materials,
-- production_batches, yield_baselines and the raw_material_stock view is
-- exactly {postgres=arwdDxtm/postgres, service_role=arwdDxtm/postgres}.
-- The dashboard (cadieux01/cadieux-dashboard, Vite, ANON key, pins
-- db:{schema:'logistics'}) therefore cannot see a single row: its Materials
-- screen loads empty for an admin. This migration opens exactly the paths that
-- screen needs, to ADMINS ONLY.
--
-- -----------------------------------------------------------------------------
-- WHAT IS DELIBERATELY NOT HERE
-- -----------------------------------------------------------------------------
--   * production_batches and yield_baselines stay service_role-only. Not asked
--     for, not needed by the Materials screen.
--   * No DELETE anywhere. No TRUNCATE, TRIGGER, REFERENCES or MAINTAIN
--     anywhere -- TRUNCATE is NOT filtered by RLS, which is the whole reason
--     ledger 20261107132439 revoked those four from `authenticated` on nine
--     other tables. Granting them here would re-open that hole.
--   * Nothing to `anon`. Nothing to `PUBLIC`.
--   * sales and partner get NOTHING: every policy below is gated on
--     logistics.is_admin(), never is_sales().
--   * stock_movements gets SELECT + INSERT but no UPDATE: the ledger is
--     append-only and three statement triggers
--     (stock_movements_no_update / _no_delete / _no_truncate ->
--     logistics.prevent_stock_movement_mutation()) already enforce it. Those
--     triggers are untouched; the missing grant is the second lock.
--
-- -----------------------------------------------------------------------------
-- THREE PLACES THE LITERAL BRIEF COULD NOT BE FOLLOWED, AND WHY
-- -----------------------------------------------------------------------------
-- 1. "one policy per grant, USING and WITH CHECK" -- Postgres REFUSES a WITH
--    CHECK on a FOR SELECT policy and a USING on a FOR INSERT policy; only FOR
--    UPDATE takes both. So each grant gets its own per-command policy with the
--    clause(s) that command accepts. The predicate is is_admin() in all of
--    them, which is what the brief was asking for.
-- 2. A VIEW CANNOT CARRY AN RLS POLICY. raw_material_stock therefore gets the
--    SELECT grant and nothing else. It is created
--    `with (security_invoker = true)` (confirmed on prod: reloptions =
--    {security_invoker=true}), so it runs as the CALLER and the base tables'
--    policies below are what actually filter it. That property is restated on
--    the replace below -- dropping it would turn the view into an RLS
--    laundering hole, which is exactly the open defect already recorded
--    against logistics.central_stock_batches_v.
-- 3. The `production_batch_materials` SELECT policy is NOT cosmetic. unit_locked
--    is an EXISTS over that table evaluated in the CALLER's session. With no
--    policy the EXISTS returns FALSE rather than raising, so a consumed
--    material would read "unlocked" and the UI would offer to change its unit.
--    That is a fail-open, so the policy is load-bearing for correctness.
--
-- -----------------------------------------------------------------------------
-- ON THE entered_by TRIGGER (section 4) -- NOT ARGUED AGAINST, IT IS RIGHT
-- -----------------------------------------------------------------------------
-- logistics.stock_movements.entered_by is `text NOT NULL` with NO DEFAULT
-- (measured). Today the only thing that can populate it is the client, so the
-- moment the INSERT grant below exists, the ledger's "who" is a browser-supplied
-- string an admin can type anything into. The trigger moves it server-side.
--
-- It passes the row through UNTOUCHED when auth.uid() IS NULL. That is
-- required, not laziness: service_role / Edge Function / migration / SQL-editor
-- inserts have no JWT subject, and overwriting or raising on them would break
-- every existing non-browser writer. For those callers entered_by stays
-- whatever was supplied, exactly as it is today.
--
-- It is SECURITY DEFINER with `set search_path to ''` (house style, matching
-- is_admin() and prevent_stock_movement_mutation()) so the name lookup does not
-- itself depend on a profiles SELECT policy.
-- =============================================================================


-- 1 ------------------------------------------------------------------- GRANTS
--   No delete. No truncate/trigger/references/maintain. Nothing to anon.
grant select, insert, update on logistics.vendors                  to authenticated;
grant select, insert, update on logistics.raw_materials            to authenticated;
grant select, insert         on logistics.stock_movements          to authenticated;
grant select                 on logistics.production_batch_materials to authenticated;
grant select                 on logistics.raw_material_stock       to authenticated;


-- 2 ----------------------------------------------------------------- POLICIES
-- All PERMISSIVE, so they OR with the pre-existing `deny_anon_<table>_all`
-- policies (USING false, roles {anon,authenticated}) rather than being
-- cancelled by them. A RESTRICTIVE policy here would ALSO be fine, but a
-- `USING false` PERMISSIVE policy denies nothing on its own once a second
-- permissive policy exists, so the deny_anon_* rows are left exactly as they
-- are and anon is kept out by the absence of a grant instead.

-- vendors --------------------------------------------------------------------
drop policy if exists "lgx: admins select vendors" on logistics.vendors;
create policy "lgx: admins select vendors"
  on logistics.vendors for select to authenticated
  using (logistics.is_admin());

drop policy if exists "lgx: admins insert vendors" on logistics.vendors;
create policy "lgx: admins insert vendors"
  on logistics.vendors for insert to authenticated
  with check (logistics.is_admin());

drop policy if exists "lgx: admins update vendors" on logistics.vendors;
create policy "lgx: admins update vendors"
  on logistics.vendors for update to authenticated
  using (logistics.is_admin())
  with check (logistics.is_admin());

-- raw_materials --------------------------------------------------------------
drop policy if exists "lgx: admins select raw_materials" on logistics.raw_materials;
create policy "lgx: admins select raw_materials"
  on logistics.raw_materials for select to authenticated
  using (logistics.is_admin());

drop policy if exists "lgx: admins insert raw_materials" on logistics.raw_materials;
create policy "lgx: admins insert raw_materials"
  on logistics.raw_materials for insert to authenticated
  with check (logistics.is_admin());

drop policy if exists "lgx: admins update raw_materials" on logistics.raw_materials;
create policy "lgx: admins update raw_materials"
  on logistics.raw_materials for update to authenticated
  using (logistics.is_admin())
  with check (logistics.is_admin());

-- stock_movements (append-only: select + insert, never update/delete) --------
drop policy if exists "lgx: admins select stock_movements" on logistics.stock_movements;
create policy "lgx: admins select stock_movements"
  on logistics.stock_movements for select to authenticated
  using (logistics.is_admin());

drop policy if exists "lgx: admins insert stock_movements" on logistics.stock_movements;
create policy "lgx: admins insert stock_movements"
  on logistics.stock_movements for insert to authenticated
  with check (logistics.is_admin());

-- production_batch_materials (read-only; feeds unit_locked) ------------------
drop policy if exists "lgx: admins select production_batch_materials"
  on logistics.production_batch_materials;
create policy "lgx: admins select production_batch_materials"
  on logistics.production_batch_materials for select to authenticated
  using (logistics.is_admin());


-- 3 ------------------------------------------- raw_material_stock.unit_locked
-- Body below is prod's own pg_get_viewdef(..., true) read on 2026-11-16, with
-- ONE addition: unit_locked appended as column 14. CREATE OR REPLACE VIEW can
-- only append at the end and cannot change the 13 existing columns' names,
-- types or order, so the dashboard's current reads are unaffected. The ACL
-- granted in section 1 survives a replace.
--
-- m.id is in the GROUP BY, so the correlated EXISTS is legal in this grouped
-- query. It is TRUE once any production batch has consumed the material, which
-- is the signal the UI needs to stop offering a unit change (changing `unit`
-- after consumption would silently rewrite the meaning of every historic qty).
create or replace view logistics.raw_material_stock
with (security_invoker = true) as
 SELECT m.id AS material_id,
    m.code,
    m.name,
    m.unit,
    m.category,
    m.reorder_level,
    m.lead_time_days,
    m.vendor_id,
    m.is_active,
    COALESCE(sum(sm.qty *
        CASE sm.direction
            WHEN 'out'::text THEN '-1'::integer
            ELSE 1
        END::numeric), 0::numeric)::numeric(14,3) AS current_qty,
    count(sm.id) AS movement_count,
    max(sm.entered_at) AS last_movement_at,
        CASE
            WHEN m.reorder_level IS NULL THEN NULL::boolean
            ELSE COALESCE(sum(sm.qty *
            CASE sm.direction
                WHEN 'out'::text THEN '-1'::integer
                ELSE 1
            END::numeric), 0::numeric) <= m.reorder_level
        END AS needs_reorder,
    EXISTS (
        SELECT 1
        FROM logistics.production_batch_materials pbm
        WHERE pbm.material_id = m.id
    ) AS unit_locked
   FROM logistics.raw_materials m
     LEFT JOIN logistics.stock_movements sm ON sm.material_id = m.id
  GROUP BY m.id, m.code, m.name, m.unit, m.category, m.reorder_level, m.lead_time_days, m.vendor_id, m.is_active;


-- 4 --------------------------------------- server-side stock_movements.entered_by
create or replace function logistics.set_stock_movement_entered_by()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  v_uid  uuid;
  v_name text;
begin
  v_uid := auth.uid();

  -- No JWT subject => service_role key, an Edge Function, a migration or the
  -- SQL editor. Leave the supplied value alone; those callers are trusted and
  -- have no profile row to read a name from.
  if v_uid is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.full_name, '')), '')
    into v_name
    from logistics.profiles p
   where p.id = v_uid;

  if v_name is null then
    raise exception
      'cannot record stock movement: profile % has no full_name', v_uid
      using errcode = '23514',
            hint = 'Set the full name on this account before entering stock.';
  end if;

  -- Overwrite unconditionally: whatever the browser sent is discarded.
  new.entered_by := v_name;
  return new;
end;
$function$;

revoke execute on function logistics.set_stock_movement_entered_by() from public;

drop trigger if exists stock_movements_set_entered_by on logistics.stock_movements;
create trigger stock_movements_set_entered_by
  before insert on logistics.stock_movements
  for each row execute function logistics.set_stock_movement_entered_by();
