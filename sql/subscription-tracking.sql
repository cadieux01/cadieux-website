-- ================================================================
-- Subscription tracking migration (additive, idempotent).
--
-- Adds:
--   * new columns on `subscriptions` for the per-week tracking model
--   * new columns on `subscription_deliveries` (scheduled_date,
--     scheduled_time_slot, admin_notes)
--   * new table `subscription_change_requests`
--
-- Does NOT drop or rename any existing columns. Safe to run on an
-- existing DB whose `subscriptions` and `subscription_deliveries`
-- tables already carry the legacy multi-day wizard columns.
--
-- Run in Supabase SQL Editor.
-- ================================================================

-- ---------- subscriptions: additive columns ---------------------
ALTER TABLE subscriptions
  ADD COLUMN IF NOT EXISTS customer_id            UUID REFERENCES customers(id),
  ADD COLUMN IF NOT EXISTS product_slug           TEXT,
  ADD COLUMN IF NOT EXISTS product_name           TEXT,
  ADD COLUMN IF NOT EXISTS quantity_per_delivery  INT DEFAULT 1,
  ADD COLUMN IF NOT EXISTS frequency              TEXT DEFAULT 'weekly',
  ADD COLUMN IF NOT EXISTS day_of_week            TEXT,
  ADD COLUMN IF NOT EXISTS time_slot              TEXT,
  ADD COLUMN IF NOT EXISTS total_weeks            INT,
  ADD COLUMN IF NOT EXISTS delivery_address       JSONB,
  ADD COLUMN IF NOT EXISTS total_amount           DECIMAL(10,2),
  ADD COLUMN IF NOT EXISTS payment_status         TEXT DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payment_method         TEXT,
  ADD COLUMN IF NOT EXISTS updated_at             TIMESTAMPTZ DEFAULT now();

CREATE INDEX IF NOT EXISTS subscriptions_customer_id_idx
  ON subscriptions(customer_id);
CREATE INDEX IF NOT EXISTS subscriptions_status_idx
  ON subscriptions(status);

-- ---------- subscription_deliveries: additive columns ----------
ALTER TABLE subscription_deliveries
  ADD COLUMN IF NOT EXISTS scheduled_date       DATE,
  ADD COLUMN IF NOT EXISTS scheduled_time_slot  TEXT,
  ADD COLUMN IF NOT EXISTS admin_notes          TEXT;

-- Backfill scheduled_* from legacy columns where empty.
UPDATE subscription_deliveries
   SET scheduled_date = delivery_date
 WHERE scheduled_date IS NULL AND delivery_date IS NOT NULL;

UPDATE subscription_deliveries
   SET scheduled_time_slot = slot
 WHERE scheduled_time_slot IS NULL AND slot IS NOT NULL;

CREATE INDEX IF NOT EXISTS subscription_deliveries_status_idx
  ON subscription_deliveries(status);
CREATE INDEX IF NOT EXISTS subscription_deliveries_week_idx
  ON subscription_deliveries(subscription_id, week_number);

-- ---------- subscription_change_requests (new) ------------------
CREATE TABLE IF NOT EXISTS subscription_change_requests (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id           UUID NOT NULL REFERENCES subscription_deliveries(id) ON DELETE CASCADE,
  subscription_id       UUID NOT NULL REFERENCES subscriptions(id) ON DELETE CASCADE,
  requested_date        DATE,
  requested_time_slot   TEXT,
  reason                TEXT,
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected')),
  admin_response        TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sub_change_req_delivery_idx
  ON subscription_change_requests(delivery_id);
CREATE INDEX IF NOT EXISTS sub_change_req_sub_idx
  ON subscription_change_requests(subscription_id);
CREATE INDEX IF NOT EXISTS sub_change_req_status_idx
  ON subscription_change_requests(status);

-- ---------- RLS lockdown (deny anon, service role bypasses) ----

ALTER TABLE subscriptions               ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscriptions               FORCE  ROW LEVEL SECURITY;
ALTER TABLE subscription_deliveries     ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_deliveries     FORCE  ROW LEVEL SECURITY;
ALTER TABLE subscription_change_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_change_requests FORCE  ROW LEVEL SECURITY;

DO $$
BEGIN
  -- subscriptions
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='subscriptions'
       AND policyname='deny_anon_subscriptions_all'
  ) THEN
    CREATE POLICY deny_anon_subscriptions_all
      ON subscriptions
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  -- subscription_deliveries
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='subscription_deliveries'
       AND policyname='deny_anon_subscription_deliveries_all'
  ) THEN
    CREATE POLICY deny_anon_subscription_deliveries_all
      ON subscription_deliveries
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;

  -- subscription_change_requests
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='subscription_change_requests'
       AND policyname='deny_anon_subscription_change_requests_all'
  ) THEN
    CREATE POLICY deny_anon_subscription_change_requests_all
      ON subscription_change_requests
      AS RESTRICTIVE
      FOR ALL
      TO anon, authenticated
      USING (false)
      WITH CHECK (false);
  END IF;
END $$;
