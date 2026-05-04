-- =============================================================================
-- RLS LOCKDOWN — customers, orders, subscriptions, subscription_deliveries
-- =============================================================================
-- Run this in the Supabase SQL Editor after deploying the API refactor that
-- replaces all anon-keyed direct queries with /api/admin/* and /api/checkout
-- routes (commit ref: TBD).
--
-- Effect:
--   * The publishable / anon key (NEXT_PUBLIC_SUPABASE_ANON_KEY) and any
--     unauthenticated session can no longer SELECT, INSERT, UPDATE, or DELETE
--     these tables. Realtime subscriptions for these tables also stop firing
--     for anon — the app already polls instead.
--   * The service-role key (SUPABASE_SERVICE_ROLE_KEY, used by all
--     /api/* routes) is unaffected. Service role bypasses RLS unconditionally.
--
-- Rollback:
--   ALTER TABLE public.<table> DISABLE ROW LEVEL SECURITY;
--   DROP POLICY "deny all anon" ON public.<table>;
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- customers
-- ---------------------------------------------------------------------------
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all anon" ON public.customers;
CREATE POLICY "deny all anon"
  ON public.customers
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all anon" ON public.orders;
CREATE POLICY "deny all anon"
  ON public.orders
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- subscriptions
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all anon" ON public.subscriptions;
CREATE POLICY "deny all anon"
  ON public.subscriptions
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

-- ---------------------------------------------------------------------------
-- subscription_deliveries
-- ---------------------------------------------------------------------------
ALTER TABLE public.subscription_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscription_deliveries FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny all anon" ON public.subscription_deliveries;
CREATE POLICY "deny all anon"
  ON public.subscription_deliveries
  AS RESTRICTIVE
  FOR ALL
  TO anon, authenticated
  USING (false)
  WITH CHECK (false);

COMMIT;

-- =============================================================================
-- Verification queries (run as a separate session, NOT inside the txn):
-- =============================================================================
-- 1. Confirm RLS is on:
--    SELECT relname, relrowsecurity, relforcerowsecurity
--    FROM pg_class
--    WHERE relname IN ('customers','orders','subscriptions','subscription_deliveries');
--
-- 2. Confirm anon is denied (using the anon role from psql):
--    SET ROLE anon;
--    SELECT * FROM public.orders LIMIT 1;   -- expect: 0 rows / permission denied
--    RESET ROLE;
--
-- 3. Service role bypasses RLS automatically — every /api/* route should keep
--    working with no code changes.
