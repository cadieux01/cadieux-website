-- =====================================================================
-- audit_log.target_label backfill — NOT RUN. DO NOT RUN WITHOUT RAJA.
-- =====================================================================
--
-- This file lives in supabase/scripts/ and NOT in supabase/migrations/
-- deliberately: `supabase db push` applies every migration file absent
-- from remote history (see supabase/migrations/README.md), and this
-- script must never go off by accident. Nothing here has been executed.
-- Written 2026-10-09; counts below were measured against prod
-- (uejagupcwevadfhfuadv) the same day.
--
-- WHAT IT CHANGES. `audit_log.target_label` only — a DERIVED DISPLAY
-- STRING, the text the admin audit page prints next to an event. It
-- does not touch `target_id` (the UUID everything joins on), `context`,
-- `meta`, `actor`, `occurred_at` or any other column. Nothing in the
-- app reads target_label for a decision; it is rendered, nothing more.
--
-- WHY IT STILL NEEDS A DECISION. It is an audit table. Rewriting any
-- field of a historical audit row, even one that holds no evidence,
-- changes what a reader in six months sees when they look at what
-- happened. That is a judgement call about the record, not a bug fix,
-- so it is Raja's to make knowingly.
--
-- The WRITERS are already fixed in code (commit on
-- fix/admin-csv-export-scope): every admin mutation path now stores the
-- OLF/OLS code at event time. New rows are correct whether or not this
-- script is ever run. Running it only makes the HISTORY match.
--
-- ---------------------------------------------------------------------
-- MEASURED STATE OF PROD, 2026-10-09
-- ---------------------------------------------------------------------
--
--   entity='order'         1,749 rows
--     target_id UUID-shaped  1,749  (all of them)
--     joins to a live order  1,594  ← this script relabels these
--     target order GONE        155  ← cannot be relabelled; see below
--     already carries OLF          0
--
--   entity='subscription'  1,947 rows
--     target_id IS NULL      1,808  ← NOT a labelling bug. See below.
--     target_id UUID-shaped    139
--     joins to a live sub      131  ← this script relabels these
--     already carries OLS          0
--
--   Total rows this script would UPDATE: 1,725.
--
-- TWO CORRECTIONS TO THE BRIEF, both found while measuring:
--
-- 1. The 1,808 subscription rows with a NULL target_label are NOT the
--    same bug, and are NOT joinable: their `target_id` is ALSO NULL.
--    Every one of them is action='other', context='Active subscriptions
--    lookup for ******NNNN', written by
--    src/app/api/subscriptions/route.ts:76 — the CUSTOMER-side "my
--    subscriptions" read, which has no single target subscription to
--    name. A NULL label is the correct answer there, so this script
--    leaves them alone. (Worth saying separately: those 1,808 read
--    events are 93% of all subscription audit volume since 2026-09-04
--    and they bury the actual mutations. That is a signal-to-noise
--    problem, not a labelling one, and out of scope here.)
--
-- 2. The 131 relabellable subscription rows are NOT carrying UUID
--    slices. 128 of them carry a PRODUCT NAME — 'Protein Bread —
--    Multigrain' (61), 'Multigrain Protein Bread' (32), 'Protein Bread
--    — Plain' (19), 'Protein Rich Bread' (13), 'Protein Bread' (3) —
--    and only 3 carry 'sub <uuid8>'. So for subscriptions this is not
--    "UUID → code", it is "which bread → which plan". That is still an
--    improvement (a product name identifies no subscription) but it
--    DISCARDS the product information, which is nowhere else on the
--    row. If that matters, prefer the variant at the bottom of this
--    file which appends rather than replaces.
--
-- The 155 orphaned order rows point at orders that no longer exist.
-- There is no source for their code, so their '#xxxxxxxx' label stays.
-- That is correct: the UUID slice is genuinely all that is known.
--
-- =====================================================================


-- ---------------------------------------------------------------------
-- STEP 0 — DRY RUN. Read-only. Run this first, every time.
-- ---------------------------------------------------------------------
-- Expect the numbers in the block above. If they have drifted a lot,
-- stop and re-read: the writers have been live since the fix shipped,
-- so `already carries OLF/OLS` growing is EXPECTED and healthy, and
-- means fewer rows need touching, not more.

WITH candidate AS (
  SELECT
    a.id,
    a.entity,
    a.target_label AS before_label,
    COALESCE(o.order_number, s.subscription_number) AS after_label
  FROM public.audit_log a
  LEFT JOIN public.orders o
    ON a.entity = 'order'
   AND o.id = a.target_id::uuid
  LEFT JOIN public.subscriptions s
    ON a.entity = 'subscription'
   AND s.id = a.target_id::uuid
  WHERE a.entity IN ('order', 'subscription')
    -- target_id is TEXT, so the cast above must be guarded or a single
    -- non-UUID value takes the whole statement down with 22P02.
    AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
SELECT
  entity,
  count(*) FILTER (WHERE after_label IS NULL)                       AS target_row_gone,
  count(*) FILTER (WHERE after_label IS NOT NULL
                     AND COALESCE(before_label, '') = after_label)  AS already_correct,
  count(*) FILTER (WHERE after_label IS NOT NULL
                     AND COALESCE(before_label, '') <> after_label) AS would_change
FROM candidate
GROUP BY entity
ORDER BY entity;

-- Eyeball a sample of the actual rewrites before committing to 1,725
-- of them. Replace LIMIT as needed; this is read-only.
WITH candidate AS (
  SELECT
    a.occurred_at,
    a.entity,
    a.target_label AS before_label,
    COALESCE(o.order_number, s.subscription_number) AS after_label
  FROM public.audit_log a
  LEFT JOIN public.orders o
    ON a.entity = 'order' AND o.id = a.target_id::uuid
  LEFT JOIN public.subscriptions s
    ON a.entity = 'subscription' AND s.id = a.target_id::uuid
  WHERE a.entity IN ('order', 'subscription')
    AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
SELECT occurred_at, entity, before_label, after_label
FROM candidate
WHERE after_label IS NOT NULL
  AND COALESCE(before_label, '') <> after_label
ORDER BY occurred_at DESC
LIMIT 40;


-- ---------------------------------------------------------------------
-- STEP 1 — SNAPSHOT. This IS the rollback. Run it before STEP 2.
-- ---------------------------------------------------------------------
-- There is no history on audit_log.target_label: no trigger, no audit
-- of the audit, no temporal table. Once the UPDATE commits, the old
-- strings are gone and no amount of SQL brings them back. The snapshot
-- below is the ONLY way to undo this, so it is not optional.
--
-- It is a real table, not a temp one, on purpose: a temp table dies
-- with the session and would leave nothing to roll back to the moment
-- the psql window closed.

CREATE TABLE IF NOT EXISTS public.audit_log_label_backup_20261009 AS
SELECT id, entity, target_id, target_label, occurred_at
FROM public.audit_log
WHERE entity IN ('order', 'subscription')
  AND target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- Prove the snapshot took before changing anything. Expect 1,888
-- (1,749 order + 139 subscription).
SELECT count(*) AS snapshot_rows FROM public.audit_log_label_backup_20261009;


-- ---------------------------------------------------------------------
-- STEP 2 — THE BACKFILL. Transactional. Verify inside, then COMMIT.
-- ---------------------------------------------------------------------
-- Run as one block. The SELECT between the UPDATEs and the COMMIT is
-- there so the row counts can be checked while rolling back is still
-- free; if anything looks wrong, ROLLBACK instead of COMMIT.

BEGIN;

-- Orders → OLF. Expect UPDATE 1594.
UPDATE public.audit_log a
   SET target_label = o.order_number
  FROM public.orders o
 WHERE a.entity = 'order'
   AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND o.id = a.target_id::uuid
   AND o.order_number IS NOT NULL
   -- Idempotent: re-running changes nothing, so a half-finished attempt
   -- can simply be run again.
   AND COALESCE(a.target_label, '') <> o.order_number;

-- Subscriptions → OLS. Expect UPDATE 131.
UPDATE public.audit_log a
   SET target_label = s.subscription_number
  FROM public.subscriptions s
 WHERE a.entity = 'subscription'
   AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
   AND s.id = a.target_id::uuid
   AND s.subscription_number IS NOT NULL
   AND COALESCE(a.target_label, '') <> s.subscription_number;

-- Post-check, still inside the transaction. `would_change` must now be
-- 0 for both entities and `target_row_gone` must still read 155 / 8.
WITH candidate AS (
  SELECT
    a.entity,
    a.target_label AS before_label,
    COALESCE(o.order_number, s.subscription_number) AS after_label
  FROM public.audit_log a
  LEFT JOIN public.orders o
    ON a.entity = 'order' AND o.id = a.target_id::uuid
  LEFT JOIN public.subscriptions s
    ON a.entity = 'subscription' AND s.id = a.target_id::uuid
  WHERE a.entity IN ('order', 'subscription')
    AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
)
SELECT
  entity,
  count(*) FILTER (WHERE after_label IS NULL)                       AS target_row_gone,
  count(*) FILTER (WHERE after_label IS NOT NULL
                     AND COALESCE(before_label, '') <> after_label) AS would_change
FROM candidate
GROUP BY entity
ORDER BY entity;

-- COMMIT;
-- ROLLBACK;


-- ---------------------------------------------------------------------
-- ROLLBACK, after the fact
-- ---------------------------------------------------------------------
-- Only possible if STEP 1 ran. Restores every label byte-for-byte,
-- including the NULLs.

-- BEGIN;
-- UPDATE public.audit_log a
--    SET target_label = b.target_label
--   FROM public.audit_log_label_backup_20261009 b
--  WHERE b.id = a.id
--    AND COALESCE(a.target_label, '') <> COALESCE(b.target_label, '');
-- -- Expect 0 rows differing from the snapshot afterwards:
-- SELECT count(*) AS still_differing
--   FROM public.audit_log a
--   JOIN public.audit_log_label_backup_20261009 b ON b.id = a.id
--  WHERE COALESCE(a.target_label, '') <> COALESCE(b.target_label, '');
-- COMMIT;

-- Drop the snapshot only once the new labels have been read on the
-- admin audit page and accepted. It is ~1,888 narrow rows; keeping it
-- a month costs nothing.
-- DROP TABLE public.audit_log_label_backup_20261009;


-- ---------------------------------------------------------------------
-- VARIANT — keep the product name on subscription rows
-- ---------------------------------------------------------------------
-- Use this INSTEAD of the subscription UPDATE in STEP 2 if correction 2
-- above matters: it prefixes the code rather than replacing the label,
-- so 'Protein Bread — Multigrain' becomes
-- 'OLS94 — Protein Bread — Multigrain' and nothing is discarded.
-- Not idempotent against repeated prefixing by itself, hence the
-- NOT LIKE guard.

-- UPDATE public.audit_log a
--    SET target_label = s.subscription_number || ' — ' || a.target_label
--   FROM public.subscriptions s
--  WHERE a.entity = 'subscription'
--    AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--    AND s.id = a.target_id::uuid
--    AND s.subscription_number IS NOT NULL
--    AND a.target_label IS NOT NULL
--    AND a.target_label NOT LIKE 'OLS%';
