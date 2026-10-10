# audit_log.target_label backfill — WILL NOT RUN

**Status: abandoned 2026-10-10. The UPDATE it describes cannot execute, and the
only way to make it execute is refused.**

This file used to be `supabase/scripts/audit_log_relabel_backfill.sql`. It was
moved here, renamed, and had both UPDATE statements commented out so that no
one can paste it into a SQL console and watch it fail — or, worse, work around
the failure. It is kept because the measurements in it are real and the
read-time replacement at the bottom is built on them.

## Why it cannot run

`public.audit_log` is **append-only at the database level**. Two enabled
row-level triggers —

- `audit_log_no_update` — `BEFORE UPDATE … FOR EACH ROW`
- `audit_log_no_delete` — `BEFORE DELETE … FOR EACH ROW`

— both call `public.prevent_audit_log_mutation()`, whose entire body is
`raise exception 'audit_log is append-only'`. Any UPDATE against the table
raises **P0001**, which aborts the whole transaction and changes **0 rows**.
This was confirmed by running STEP 2 against prod on 2026-10-10: it failed,
and a row-by-row comparison against the snapshot showed nothing had changed.

The triggers come from `sql/audit-log-tamper-protection.sql`, whose stated
purpose is that "even a compromised service-role caller can't rewrite history".

**Running this backfill would therefore require `ALTER TABLE public.audit_log
DISABLE TRIGGER audit_log_no_update` — switching off tamper protection on
purpose. That is REFUSED.** Approval to relabel display strings is not
approval to disable the guarantee that the audit table cannot be rewritten,
and the two are not the same decision. Use read-time resolution instead; see
the last section.

## The "Expect UPDATE" counts below were never observed

STEP 2's `-- Expect UPDATE 1594` and `-- Expect UPDATE 131` are *predictions*
derived from the STEP 0 dry run. **No UPDATE ever completed, so no actual row
count was ever returned.** Nothing in this file should be read as a record of
what happened to the table — the table is unchanged and always was.

## What was actually run against prod

| When | What | Result |
| --- | --- | --- |
| 2026-10-09 | STEP 0 dry run | the counts in the preserved header below |
| 2026-10-10 | STEP 0 dry run again | drifted; see note |
| 2026-10-10 | STEP 1 snapshot | `public.audit_log_label_backup_20261009` created, **1,896 rows** (1,750 order + 146 subscription) |
| 2026-10-10 | STEP 2 | **ERROR P0001 `audit_log is append-only`. 0 rows changed.** |
| 2026-10-10 | `DROP TABLE public.audit_log_label_backup_20261009` | dropped. Verified first: 1,896 rows, 0 differing from live, 0 missing — a snapshot of a table nothing had modified. |

The drift in one day is worth keeping: order rows 1,749 → 1,750 and
would_change 1,594 → **1,595**; subscription uuid-shaped 139 → 146 and
would_change 131 → **138**; total 1,725 → **1,733**. Orphans (155 order /
8 subscription) did not move. **`already_correct` stayed 0 for both**, i.e.
the rows written that day ALSO got UUID-style labels — the writer fix had only
just reached `main` and was not yet deployed. Once it deploys, new rows carry
the code and this number stops growing.

---

# Original script, preserved

Everything below is the file as written on 2026-10-09, with the two UPDATE
statements commented out. The STEP 0 queries are read-only and still work.

```sql
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
-- STEP 1 — SNAPSHOT. Ran 2026-10-10. The table has since been DROPPED,
-- because the UPDATE it was insurance against cannot execute at all.
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
-- (1,749 order + 139 subscription). Actually returned 1,896 on
-- 2026-10-10 — the table had grown by a day.
SELECT count(*) AS snapshot_rows FROM public.audit_log_label_backup_20261009;


-- ---------------------------------------------------------------------
-- STEP 2 — THE BACKFILL. COMMENTED OUT: IT CANNOT RUN.
-- ---------------------------------------------------------------------
-- Both UPDATEs below raise P0001 'audit_log is append-only' from the
-- BEFORE UPDATE trigger and abort the transaction, changing 0 rows.
-- The "Expect UPDATE" counts are predictions from STEP 0 and were
-- NEVER OBSERVED. Do not uncomment these; the only way to make them
-- run is to disable tamper protection, which is refused.

-- BEGIN;

-- Orders → OLF. Expect UPDATE 1594. NEVER OBSERVED.
-- UPDATE public.audit_log a
--    SET target_label = o.order_number
--   FROM public.orders o
--  WHERE a.entity = 'order'
--    AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--    AND o.id = a.target_id::uuid
--    AND o.order_number IS NOT NULL
--    -- Idempotent: re-running changes nothing, so a half-finished attempt
--    -- can simply be run again.
--    AND COALESCE(a.target_label, '') <> o.order_number;

-- Subscriptions → OLS. Expect UPDATE 131. NEVER OBSERVED.
-- UPDATE public.audit_log a
--    SET target_label = s.subscription_number
--   FROM public.subscriptions s
--  WHERE a.entity = 'subscription'
--    AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--    AND s.id = a.target_id::uuid
--    AND s.subscription_number IS NOT NULL
--    AND COALESCE(a.target_label, '') <> s.subscription_number;

-- Post-check. It was written to run inside the transaction; it is
-- read-only, so it is left live here, where it reports the CURRENT gap
-- — which is exactly what read-time resolution closes without writing.
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
-- ROLLBACK, after the fact — MOOT
-- ---------------------------------------------------------------------
-- Nothing was ever written, and the snapshot table was dropped on
-- 2026-10-10. This is an UPDATE against audit_log too, so it could not
-- have run either: the append-only trigger does not care which
-- direction a rewrite goes in.

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

-- Snapshot dropped 2026-10-10, after verifying 1,896 rows / 0 differing
-- from live / 0 missing.
-- DROP TABLE public.audit_log_label_backup_20261009;


-- ---------------------------------------------------------------------
-- VARIANT — keep the product name on subscription rows
-- ---------------------------------------------------------------------
-- This was the approved variant: it prefixes the code rather than
-- replacing the label, so 'Protein Bread — Multigrain' becomes
-- 'OLS94 — Protein Bread — Multigrain' and nothing is discarded.
-- It is an UPDATE on audit_log, so it cannot run either. Read-time
-- resolution reproduces exactly this string without writing — see the
-- next section.

-- UPDATE public.audit_log a
--    SET target_label = s.subscription_number || ' — ' || a.target_label
--   FROM public.subscriptions s
--  WHERE a.entity = 'subscription'
--    AND a.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
--    AND s.id = a.target_id::uuid
--    AND s.subscription_number IS NOT NULL
--    AND a.target_label IS NOT NULL
--    AND a.target_label NOT LIKE 'OLS%';
```

---

# The replacement: resolve the code at READ time

Design only — **nothing is built yet, and nothing here writes to `audit_log`,
now or ever.** The point is that every fact the backfill wanted to store is
already derivable from `target_id` on every page load.

## Where the resolution happens

In `src/app/api/admin/audit-log/route.ts`, **not** in the page. The route
already holds the service-role client, and it is the single source for both
the table and the CSV export (`src/app/admin/audit-log/page.tsx:212`), so
resolving there means the download gets the codes too, with no second
implementation. The route gains one field per row, `target_code`, and
`page.tsx:455` renders `r.target_code ?? r.target_label ?? "—"`.

## The lookup is batched per page, not per row

The route returns at most `limit` rows (`DEFAULT_LIMIT` 100, `MAX_LIMIT`
1000). After the `audit_log` select returns:

1. Walk the rows once; collect `target_id` into two **de-duplicated** sets,
   one for `entity='order'` and one for `entity='subscription'`, keeping only
   values matching the UUID shape — the same guard the SQL needed, because
   `target_id` is TEXT and also holds `#xxxxxxxx` slices and NULLs.
2. One query per entity: `orders.select("id, order_number").in("id", ids)` and
   `subscriptions.select("id, subscription_number").in("id", ids)`.
   Primary-key lookups.
3. Build two `Map<uuid, code>` and attach `target_code` while serialising.

A 100-row page therefore costs **2 extra queries**, and a 1000-row CSV export
costs 2 — not 1000. One caveat to build in from the start: `.in()` goes out as
a GET querystring, and 1000 UUIDs is ~37 KB of URL, past what the gateway will
accept. Chunk the id list at ~200 per request; worst case is 10 queries for a
full export, and it still never scales per row.

## What the 155 + 8 orphans render as

**Exactly what they render today, which is the honest answer.** 155 order rows
and 8 subscription rows carry a `target_id` that joins to nothing — the order
or subscription was deleted. The map has no entry, `target_code` is null, and
the row falls back to its stored `target_label` (`#a1b2c3d4`) with the raw
`target_id` beneath it, which `page.tsx:457-461` already prints. No
placeholder, no "unknown", no guess: the UUID slice really is all that is
known about those events, and the fallback says so.

Subscription rows are the interesting case: 128 of the 131 carry a **product
name**, not a UUID slice. Read-time resolution composes
`` `${code} — ${target_label}` `` when both exist, i.e. `OLS94 — Protein Bread
— Multigrain` — **the approved prefix variant's exact output, produced on
render, with zero writes.** When the code does not resolve, the product name
stands alone, as now.

## Does this make search better? Yes — and it replaces the UUID match

Today `route.ts:84-91` ORs three `ilike '%q%'` branches over `target_label`,
`context` and `target_id`. **Searching `OLF346` returns nothing**: `target_id`
holds a UUID and `target_label` on those 1,595 rows holds `#a1b2c3d4`. The
only reason a code search ever appears to work today is incidental `context`
text.

The fix is a lookup in the other direction, done **before** the audit query:

- If `q` matches `/^OL[FS]\d+$/i`, resolve it to an id first —
  `orders.select("id").eq("order_number", q)` or
  `subscriptions.select("id").eq("subscription_number", q)`. One row, one
  indexed lookup.
- If it resolves, add `target_id.eq.<uuid>` to the existing `.or(...)`.
  Otherwise leave the clause list exactly as it is.

For code queries this **replaces** the `target_id.ilike.%q%` branch: a code is
never a substring of a UUID, so for that input the ilike branch can only ever
contribute false negatives. Keep `target_id.ilike` for the case it does serve
— an operator pasting a UUID fragment.

**The code lookup must be exact equality, never a substring.** Order codes are
sequential, so `order_number ilike '%OLF73%'` also matches OLF730 and OLF731 —
the same trap that forced `adminQueryRelevance` on the orders board. `.eq()`
has no such failure mode.

Net effect: `OLF346` finds that order's whole history, including the rows
whose stored label never carried the code — the entire benefit the backfill
was for, without touching a single audit row.
