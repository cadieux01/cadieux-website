-- ORDER PIN — a second, independent PIN that gates order/subscription
-- status changes to confirmed / active / cancelled.
--
-- Deliberately NOT the same row as `website_admin_pin`. That PIN gates
-- product-catalogue edits and mints a 5-minute grant; this one has no
-- grant at all and is re-entered on every single status change.
--
-- Every statement here is idempotent. Migrations in this repo are applied
-- BY HAND (see supabase/migrations/README.md) — never `supabase db push`.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Audit enum values
--
-- `audit_log.entity` and `audit_log.action` are Postgres ENUMS, not text with
-- a CHECK. An unknown label is a hard INSERT error, and `recordAuditEvent`
-- swallows its own failures — so forgetting this would silently produce NO
-- audit trail rather than an error anyone would see.
--
-- ALTER TYPE ... ADD VALUE is legal inside a transaction on PG 12+, but the
-- new label cannot be USED until that transaction commits. Nothing below
-- uses these, so this is safe as written.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TYPE public.audit_entity ADD VALUE IF NOT EXISTS 'order_pin';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'pin_reset';
ALTER TYPE public.audit_action ADD VALUE IF NOT EXISTS 'pin_blocked';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. The PIN row
--
-- Single row, id = 1, same shape as website_admin_pin plus the security
-- answer. `answer_hash`/`answer_salt` are NOT NULL: a PIN cannot exist
-- without a reset path, and there is no default answer to fall back to.
-- The answer is scrypt-hashed exactly like the PIN — it appears in no
-- source file, no migration, and no client bundle.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.website_order_pin (
  id              integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  pin_hash        text        NOT NULL,
  pin_salt        text        NOT NULL,
  answer_hash     text        NOT NULL,
  answer_salt     text        NOT NULL,
  failed_attempts integer     NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.website_order_pin IS
  'Order PIN (scrypt). Gates order/subscription status changes to confirmed/active/cancelled. Re-entered on every change — no grant window. Service-role only.';
COMMENT ON COLUMN public.website_order_pin.answer_hash IS
  'scrypt hash of the normalised answer to "Who is your best friend?". Set by the operator in /admin/profile. Never stored or written in plaintext anywhere.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Reset brute-force guard — DB-backed, per IP
--
-- This table IS the rate limiter. It fails CLOSED by construction: if the
-- DB is unreachable the reset request cannot proceed at all, because the
-- same connection is needed to read the PIN row. There is deliberately no
-- Upstash path here — an Upstash limiter with missing secrets fails open
-- and the limit then silently does not exist.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.website_order_pin_reset_attempts (
  ip_key       text PRIMARY KEY,
  attempts     integer     NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.website_order_pin_reset_attempts IS
  'Per-IP brute-force guard for the order-PIN security-question reset. 3 wrong answers -> 30 minute lockout. DB-backed so it cannot fail open.';

-- Lets the stale-row sweep in the route use an index rather than a seq scan
-- once this table has any volume.
CREATE INDEX IF NOT EXISTS website_order_pin_reset_attempts_last_attempt_idx
  ON public.website_order_pin_reset_attempts (last_attempt);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. RLS: on, with NO policies
--
-- Enabling RLS without policies denies anon and authenticated outright.
-- The service-role key bypasses RLS, so only server-side code holding
-- SUPABASE_SERVICE_ROLE_KEY can read or write these rows. This is the same
-- posture as website_admin_pin.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.website_order_pin              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.website_order_pin_reset_attempts ENABLE ROW LEVEL SECURITY;

-- Belt and braces: revoke the grants PostgREST's roles get by default, so a
-- future policy added by accident still cannot expose the hashes.
REVOKE ALL ON public.website_order_pin              FROM anon, authenticated;
REVOKE ALL ON public.website_order_pin_reset_attempts FROM anon, authenticated;
