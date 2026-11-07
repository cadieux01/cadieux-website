-- =============================================================================
-- logistics hardening: fix is_service_role() + drop the GRANT ALL overreach
-- =============================================================================
-- APPLIED BY HAND to PRODUCTION (ref uejagupcwevadfhfuadv) on 2026-11-07 via
-- the Supabase MCP `apply_migration`; minted ledger version 20261107132439,
-- which is this filename. `supabase db push` is never run in this repo -- read
-- ./README.md before touching anything here. Every statement below is
-- idempotent and the re-run was done via `execute_sql`, never a second
-- `apply_migration` (that would mint a duplicate ledger row).
--
-- -----------------------------------------------------------------------------
-- HOW THIS WAS VERIFIED, AND THE ONE THING THAT COULD NOT BE
-- -----------------------------------------------------------------------------
-- The fix CANNOT be shown to deny from a `postgres` database session, because
-- clause 3 is *designed* to pass for one -- that is how migrations and the SQL
-- editor keep working. Every in-database harness available here (MCP, SQL
-- editor) IS a `postgres` session: `SET LOCAL ROLE authenticated` rewrites
-- `current_user` but NOT `session_user`, and `SET SESSION AUTHORIZATION` is
-- refused ("permission denied to set session authorization") because the
-- `postgres` role on Supabase is not a superuser. So:
--
--   * measured in-DB as `postgres`                     -> true   (correct)
--   * measured in-DB with SET LOCAL ROLE authenticated -> true, because
--     session_user is still `postgres`. A HARNESS ARTEFACT, not the fix
--     failing. No forged JWT was used to work around it.
--   * measured over PostgREST with the publishable anon key, which is the only
--     way an app caller ever reaches this function:
--         POST /rest/v1/rpc/is_service_role, Content-Profile: logistics
--         -> `false`, http 200.
--     `pg_stat_activity` confirms PostgREST's session_user is `authenticator`
--     (application_name `postgrest`), so clauses 2 and 3 are both false there.
--     Before this migration the same call returned true.
--
-- That last line is the proof that matters. The function reads exactly three
-- values: the JWT claim, and `session_user` twice. For ANY PostgREST caller
-- session_user is `authenticator`, and the claim role is `anon` or
-- `authenticated` (measured for both an admin sub and a partner sub) -- never
-- `service_role`. So it is false for every non-service_role API caller,
-- partner and admin alike.
--
-- Knock-on for prevent_role_change(): with clause 1 false, the outcome is
-- decided by its second gate, `EXISTS (... id = auth.uid() AND role='admin')`,
-- measured false for the partner sub and true for the admin sub. The trigger's
-- WHEN condition is exactly `old.role IS DISTINCT FROM new.role`, so once that
-- second gate fails the RAISE is unconditional. The end-to-end deny needs a
-- real partner login against the dashboard; it is not reproducible from a
-- `postgres` connection and was NOT faked.
--
-- -----------------------------------------------------------------------------
-- 1. WHY is_service_role() HAD TO CHANGE
-- -----------------------------------------------------------------------------
-- The function was unconditionally TRUE for every caller, `anon` included:
--
--     RETURN ( current_setting('request.jwt.claims', true)::json->>'role'
--                = 'service_role'
--              OR current_user = 'service_role'
--              OR current_user = 'postgres' );   -- <= can never be false
--
-- It is SECURITY DEFINER owned by `postgres`, and SECURITY DEFINER rewrites
-- `current_user` to the function OWNER. So inside the body `current_user` IS
-- `postgres` no matter who called it, and the third clause always holds.
-- `session_user` is NOT rewritten by SECURITY DEFINER -- it remains the role
-- that opened the connection -- so both role clauses now test that instead.
--
-- Exactly two things consume the result, and both are meant to DENY:
--   * logistics.prevent_role_change() opens with
--       IF logistics.is_service_role() THEN RETURN NEW;
--     so the guard that is supposed to stop a user rewriting their own
--     profiles.role was a no-op for everybody. Combined with the
--     "lgx: users update own profile" policy (USING / WITH CHECK
--     `auth.uid() = id`, which never inspects `role`), a partner could run
--     `update logistics.profiles set role='admin' where id = auth.uid()`
--     and self-promote.
--   * the "lgx: insert profiles" policy's WITH CHECK
--       (is_service_role() OR is_admin() OR (is_sales() AND role='partner'))
--     collapsed to WITH CHECK (true) for any logged-in caller.
--
-- SIGNUP IS NOT AFFECTED. There is no trigger on auth.users (checked:
-- `select ... from pg_trigger where tgrelid = 'auth.users'::regclass and not
-- tgisinternal` returns zero rows) and there is no `supabase.auth.signUp`
-- anywhere in the dashboard. Every account is created by the `manage-partner`
-- Edge Function on a SUPABASE_SERVICE_ROLE_KEY client, which inserts the
-- profile over PostgREST -- so clause 1, the JWT claim, is genuinely satisfied
-- on that path and never relied on either role clause.
--
-- NOTE for anyone reading the clauses: over PostgREST `session_user` is the
-- pooler login (`authenticator`), not `service_role`, so clause 2 does not
-- fire there -- clause 1 is what covers the service-role key. Clause 3 covers
-- a direct `postgres` connection: migrations, the SQL editor, MCP.
--
-- -----------------------------------------------------------------------------
-- 2. WHY THE GRANTS HAD TO CHANGE
-- -----------------------------------------------------------------------------
-- Nine relations carried `GRANT ALL` to `authenticated` -- TRUNCATE, TRIGGER,
-- REFERENCES and MAINTAIN on top of SELECT/INSERT/UPDATE/DELETE.
-- **TRUNCATE IS NOT FILTERED BY ROW-LEVEL SECURITY**, so any logged-in
-- dashboard user -- a partner included -- could empty profiles, orders, sales,
-- audit_logs, leads, order_invitations or profile_change_requests regardless of
-- the 75 policies on this schema. TRIGGER would additionally let them attach
-- their own trigger function to those tables.
--
-- The schema's own default ACL already omits all four
-- (pg_default_acl for logistics tables = `authenticated=arwd`), so this merely
-- brings the explicit grants back in line with the declared default: a table
-- created today never had them. The four came from historic explicit
-- `GRANT ALL` statements.
--
-- Revoked BY NAME, never `ON ALL TABLES IN SCHEMA`, so the seven
-- service_role-only tables (admin_pins, production_batches,
-- production_batch_materials, raw_materials, stock_movements, vendors,
-- yield_baselines) and the raw_material_stock view are not touched, and
-- SELECT/INSERT/UPDATE/DELETE is left exactly as it was everywhere.
--
-- -----------------------------------------------------------------------------
-- DELIBERATELY OUT OF SCOPE -- do not fold these in without a separate review
-- -----------------------------------------------------------------------------
--   * logistics.central_stock_batches_v has no `security_invoker`, so it
--     launders RLS (measured: a partner sees 0 rows on the base table and 22
--     through the view). Fixing it CHANGES WHAT PARTNERS SEE on screen, so it
--     needs a UI check first.
--   * logistics.lookup_phone_by_name(text) is anon-executable and returns
--     profiles.phone + role with no role check. It cannot simply be revoked:
--     it is called BEFORE login, by src/pages/Login.jsx:85 in the dashboard
--     repo, to turn a typed name into the synthetic <phone>@cadieux.<role>
--     login address. Revoking anon/PUBLIC EXECUTE locks every name-login user
--     out behind a generic "invalid credentials". Two-repo change.
--   * 32 logistics functions hold PUBLIC EXECUTE (`=X/postgres`), so revoking
--     `anon` alone would close nothing -- `REVOKE ... FROM PUBLIC` is the
--     operative statement. Not done here. The 27 write-path functions
--     (create_central_batch, record_partner_sale, verify_payment, ...) are
--     already correctly revoked from PUBLIC.
--   * nothing in the `public` schema.
-- =============================================================================


-- 1 -------------------------------------------------------- is_service_role()
create or replace function logistics.is_service_role()
returns boolean
language plpgsql
stable
security definer
set search_path to ''
as $function$
begin
  -- session_user is the role that opened the connection and is NOT rewritten
  -- by SECURITY DEFINER; current_user would always read 'postgres' in here.
  return ( current_setting('request.jwt.claims', true)::json->>'role' = 'service_role'
           or session_user = 'service_role'
           or session_user = 'postgres' );
exception
  when others then
    -- an absent or malformed request.jwt.claims must deny, not raise
    return false;
end;
$function$;


-- 2 ----------------------------------------- drop TRUNCATE/TRIGGER/REFERENCES
--                                             /MAINTAIN from `authenticated`
revoke truncate, trigger, references, maintain
  on logistics.audit_logs from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.leads from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.order_invitations from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.orders from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.profile_change_requests from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.profiles from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.sales from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.attribution_summary from authenticated;

revoke truncate, trigger, references, maintain
  on logistics.variant_summary from authenticated;
