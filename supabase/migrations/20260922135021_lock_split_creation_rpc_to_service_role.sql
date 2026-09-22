-- APPLIED 2026-09-22 under Supabase ledger version 20260922135021.
-- Live in production. Every statement is idempotent — repeated revoke
-- is a no-op; repeated grant is a no-op.
--
-- WHY THIS EXISTS:
--
-- The predecessor migration 20260922134956 ended with
-- `revoke all ... from public`, which is the pattern that works on a
-- vanilla Postgres cluster. Supabase is not vanilla. Its default role
-- setup grants EXECUTE on newly-created functions to anon and
-- authenticated DIRECTLY, not by inheritance through the PUBLIC
-- pseudo-role, so `revoke from public` DOES NOT TOUCH THEM.
--
-- Verified after the 134956 apply: proacl on
-- public.admin_create_split_orders(jsonb, jsonb, text) read
-- {postgres=X, anon=X, authenticated=X, service_role=X} — the intended
-- lockdown had not happened. Not exploitable in the interim window
-- because SECURITY INVOKER routes the caller through RLS on
-- public.orders (which anon and authenticated cannot INSERT into), but
-- the lockdown Sunny asked for did not exist until this migration
-- ran, and it would have become a real hole the day someone re-granted
-- INSERT to anon on public.orders for an unrelated reason.
--
-- STANDING RULE for every future function migration:
--   1. Revoke from anon and authenticated BY NAME, not via public.
--   2. Revoke from public as belt-and-braces (harmless if redundant).
--   3. Grant EXECUTE to service_role explicitly.
--   4. Verify proacl (pg_proc.proacl) AFTER applying, before considering
--      the lockdown complete. Trust the catalog, not the SQL.
--
-- This rule is repeated in the memory file cadieux-migration-ledger-drift.md
-- so the next window does not rediscover it.

revoke all on function public.admin_create_split_orders(jsonb, jsonb, text) from anon;
revoke all on function public.admin_create_split_orders(jsonb, jsonb, text) from authenticated;
revoke all on function public.admin_create_split_orders(jsonb, jsonb, text) from public;
grant  execute on function public.admin_create_split_orders(jsonb, jsonb, text) to service_role;
