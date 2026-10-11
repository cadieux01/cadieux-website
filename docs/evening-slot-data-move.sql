-- Collapse every live future booking onto the ONE delivery slot: 16:00-21:00.
--
-- NOT A MIGRATION. Do not move this under supabase/migrations/. This is a
-- one-off data move, run by hand, AFTER Raja has messaged the customers and
-- BEFORE the code that makes the old slots unbookable is deployed. If a slot
-- becomes invalid while rows still sit on it, those customers are parked on a
-- value the system refuses — they cannot self-edit, and admin cannot re-book
-- them from the dropdown either.
--
-- ===========================================================================
-- WHAT CHANGED vs the previous version of this file, and why
-- ===========================================================================
--
-- 1. THE TARGET IS 16:00-21:00. One slot, 4 pm - 9 pm.
--
--    THIS REVERSES AN EARLIER REVISION OF THIS FILE, which targeted
--    '15:00-21:00' and treated '16:00-21:00' as a legacy value to be moved
--    OFF. Raja restated the window as 4 - 9 PM, so the target is now the
--    value most live rows already hold. Every consequence of that reversal is
--    called out in items 7-9 below, because several checks INVERT rather than
--    just change their literal.
--
-- 2. THERE ARE THREE SOURCE VALUES, NOT ONE. The old script moved
--    '10:00-14:00' only. It has to move:
--      (a) '06:00-10:00' and '10:00-14:00'  — the paused windows
--      (b) '15:00-21:00'                    — the 3 pm target of the earlier
--          revision. Expected to be ZERO rows: neither the website nor the
--          app ever shipped it to a customer. It is in the list as free
--          insurance, so that if any row DID land on it the move sweeps it up
--          instead of stranding it on a value nothing can book.
--    Both are the same rewrite to the same target, so they are ONE statement
--    per table over a three-value list. Two statements would be two
--    predicates that can drift apart, which is the class of bug this file
--    exists to avoid. The dry run still reports (a) and (b) separately, so
--    the two numbers stay visible.
--
-- 3. NO DATE LITERAL AND NO ORDER NUMBER ANYWHERE. The previous verify block
--    expected `0 / 1 / 0`, where the `1` was OLF469 held back by hand inside
--    a hardcoded `>= date '2026-10-07'` window. Both have expired: OLF469 has
--    aged into the past and is cancelled, so `<> 'OLF469'` is now a no-op and
--    that line reads 0, not 1 — the script would have reported its own
--    success as a failure. The date rolled twice in 48 h during this work. So:
--    every boundary is computed from `now() at time zone 'Asia/Kolkata'` at
--    the moment the script runs, and every post-check is an invariant
--    compared against a snapshot taken inside the same transaction, never
--    against a number written into this file.
--
-- 4. THE PREDICATE IS `or` ACROSS BOTH SLOT COLUMNS, NOT `coalesce`.
--    `coalesce(slot, scheduled_time_slot)` only reads the second column when
--    the first is NULL, so a DRIFTED row — prod proof: OLS36 seq 2, `slot`
--    16:00-21:00 with `scheduled_time_slot` 06:00-10:00 — coalesces to the
--    evening value and gets SKIPPED, even though the customer's own tracking
--    page (which reads `scheduled_time_slot` only) is showing them morning.
--    Both columns are now tested independently.
--
-- 5. PICKUP IS EXCLUDED, AT NINE SITES — not just on the write.
--    `and coalesce(o.fulfillment_type, '') <> 'pickup'` appears on the four
--    section 1 dry-run order buckets (three legacy + the already-on-target
--    baseline), on the two `_before` snapshot rows that feed check 4
--    (`orders.to_move` and `orders.on_target`), on the section 2 UPDATE, and on
--    verify checks 1 and 4 — the last two being where it was missing.
--    NOT on `orders.carveout` / check 7, deliberately: that pair asserts a
--    population did not change, and both sides share one predicate, so adding
--    a filter to it would prove nothing it does not already prove.
--    Guarding only the UPDATE is a bug: verify check 4
--    asserts "orders now on target == _before.orders.to_move", so the snapshot
--    would count a pickup row the UPDATE skipped and the script would report
--    FAIL on a correct run — on exactly the day the guard first matters. The
--    dry run carries it for the same reason the dry run exists: the operator
--    compares it against what the move actually writes, and a predicate that
--    diverges by design makes that comparison worthless.
--    `coalesce(..., '')` is required because the column is nullable and
--    `NULL <> 'pickup'` is NULL, not true, which would silently drop every row
--    with no fulfillment type set.
--    WHY a pickup order can even hold a delivery window: checkout/page.tsx
--    :1264-1265 sends `delivery_date` and `delivery_slot` unconditionally and
--    order-checkout.ts:552-556 persists them, so choosing a slot and then
--    toggling to Pickup leaves the slot behind. 10 of 145 pickup orders hold
--    one (measured 2026-10-09). All 10 are dated inside the carve-out, so this
--    clause is a NO-OP today — one pickup order placed tomorrow would be in
--    scope, and without it the move would rewrite that row into the 4-9 pm
--    DELIVERY window and tell a collecting customer they are getting a
--    delivery.
--
-- 6. SECTION 2 RUNS AT REPEATABLE READ, UNDER A SHARE LOCK, WITH TIMEOUTS.
--    It was already one transaction, but at the server default of READ
--    COMMITTED, where every statement takes a FRESH snapshot — so a row could
--    enter scope between the snapshot and the UPDATE and make verify check 4
--    read "25 vs 24" and fail a move that was correct. This is observed, not
--    hypothetical: two admin edits at 22:38 and 22:39 on 9 Oct moved orders
--    from 7 Oct to 12 Oct and took the in-scope count 22 -> 24 between a
--    section 0 run and a section 1 run.
--    ISOLATION LEVEL ALONE WAS NOT ENOUGH, and would have been worse. There
--    are two conflict classes and Postgres treats them differently:
--      Case A, a row ENTERS scope. A row entering scope is a PHANTOM, and
--        neither READ COMMITTED nor REPEATABLE READ takes predicate locks.
--        Under REPEATABLE READ the UPDATE evaluates its WHERE against the
--        transaction snapshot, where the row does not match, so it is never
--        locked and NO serialization error is raised — it is silently skipped.
--        The verify block reads that SAME snapshot, so check 1 cannot see it
--        either and reads PASS. That commits an order left on a legacy slot
--        with no signal anywhere. READ COMMITTED at least turns the same event
--        into a loud, safe, spurious FAIL that rolls back and can be retried.
--        The explicit `lock table ... in share mode` is what closes Case A.
--      Case B, a concurrent edit to a row the UPDATE ALREADY targets. This is
--        a write-write conflict and does raise "could not serialize access due
--        to concurrent update", SQLSTATE 40001, aborting the whole transaction
--        cleanly. That abort is the CORRECT outcome, not a partial move.
--    The lock blocks ALL writers on public.orders, which includes CUSTOMERS
--    placing orders on the website, not only the admin board — hence
--    `lock_timeout` 3s (fail fast rather than queue behind someone else's long
--    transaction while checkout queues behind us) and `statement_timeout` 30s.
--
-- 7. THE `target_in_use` PREFLIGHT IS INVERTED, AND IS NO LONGER A FAIL.
--    The earlier revision asserted `target_in_use = 0` — "nothing is on
--    15:00-21:00 yet" — which was a sane guard for a value nobody had ever
--    booked. The target is now the value most live rows ALREADY hold, so that
--    same assertion is guaranteed to fail on a correct database. Measured on
--    prod 2026-10-10 it reads 6 orders + 23 deliveries + 7 subscriptions = 36.
--    It is therefore reported as a COUNT, not asserted against zero, and the
--    FAIL it used to provide is replaced by a different one that is still
--    meaningful: `target` must not itself appear in the `legacy` array. That
--    was impossible to get wrong when the two were disjoint by construction;
--    now that the target has moved INTO the old legacy list's territory, a
--    half-finished edit to one of the two params would have the UPDATE rewrite
--    every row on the target to the target and the verify block count it as a
--    move. One `p.target = any(p.legacy)` check costs nothing and makes that
--    class of edit loud.
--
-- 8. CHECKS 4, 5 AND 6 ASSERT `on_target + to_move`, NOT `to_move`.
--    Those three checks each count rows sitting on the target AFTER the move
--    and compare the count to the snapshot. When the target was a fresh value
--    the only rows that could be there afterwards were the ones the move put
--    there, so `== _before.to_move` was right. Now that rows were already on
--    the target before the move, the post-count is the SUM of the two, and the
--    old form would fail by exactly the pre-existing population — 36 rows'
--    worth of false FAIL. `_before` therefore snapshots `on_target` alongside
--    `to_move` for each of the three tables, inside the same transaction and
--    under the same predicates (pickup exclusion included — see item 5), and
--    the checks assert against the sum. Both numbers are printed, so an
--    operator can see which half moved.
--
-- 9. THE `unknown_*` PREFLIGHTS EXCLUDE THE TARGET EXPLICITLY.
--    `unknown_orders` / `unknown_deliv` exist to catch slot values that are
--    neither legacy nor expected — a bare time like '18:30', say — by testing
--    `not (value = any(legacy))`. With the target removed from the legacy
--    array, every row already on the target now satisfies that test and gets
--    reported as an unknown value: all 29 order + delivery rows on
--    '16:00-21:00' would flag, and preflight rows 8 and 9 would FAIL on a
--    healthy database. Both CTEs now also require
--    `value is distinct from p.target`. `is distinct from` rather than `<>`
--    because the columns are nullable and `NULL <> 'x'` is NULL, which would
--    drop the row from the count instead of keeping it.
--
-- 10. EVERY DATE PREDICATE ON subscription_deliveries READS
--     `coalesce(d.scheduled_date, d.delivery_date)`.
--     That table carries both columns, and every date READER in the app uses
--     `scheduled_date ?? delivery_date` in that order — the admin board, the
--     bake plan, the customer tracking page. A predicate testing
--     `delivery_date` alone disagrees with all of them whenever a delivery has
--     been rescheduled: a row the operator sees on the 20th could be filtered
--     by its original 5th, dropping a live future delivery out of scope and
--     stranding it on a legacy slot. It is done with `coalesce` and not `or`
--     across both columns — the opposite of the choice in item 4 — because
--     here there IS a defined precedence and the readers all share it, so
--     mirroring them is what makes the move's scope equal what a human sees.
--     Item 4's slot columns have no such agreement, which is exactly why they
--     need `or`.
--     MEASURED BEFORE MAKING THE CHANGE: zero rows change scope today, over
--     all rows and over live rows alike (2026-10-10). It is purely preventive,
--     which is the only safe time to make it.
--     `public.orders` HAS NO `scheduled_date` COLUMN — it carries
--     `delivery_date` plus a `scheduled_delivery_date_at` TIMESTAMP that is a
--     different thing. The coalesce is applied to the subscription_deliveries
--     predicates ONLY. Writing it on an orders predicate aborts the
--     transaction with "column o.scheduled_date does not exist".
--
-- ===========================================================================
-- EVERY COLUMN THAT NAMES THE SLOT, ON ALL THREE TABLES
-- ===========================================================================
--
-- orders.delivery_slot                 — single carrier, straightforward.
--
-- subscription_deliveries has TWO, read with OPPOSITE precedence:
--   bake plan / print sheet   src/lib/bake-plan-lines.ts:365
--       slot: d.slot || d.scheduled_time_slot          -> `slot` wins
--   admin board               src/lib/admin-subscription-derive.ts:106
--       slot: row.scheduled_time_slot ?? row.slot      -> `scheduled_time_slot` wins
--   customer tracking page    src/app/subscriptions/track/page.tsx:328
--     and                     src/app/subscriptions/track/[deliveryId]/page.tsx:213
--       reads scheduled_time_slot ONLY, no fallback
--   admin edit modal          src/components/admin/EditDeliveryModal.tsx:72
--       delivery.scheduled_time_slot ?? delivery.slot
--   Writing one column bakes the new slot while the customer's own page still
--   says the old one. The app already treats this as a known hazard and
--   writes every slot column on every edit —
--   src/app/api/mobile/subscriptions/[id]/deliveries/[deliveryId]/edit/route.ts:276-292.
--
-- subscriptions (the recurring TEMPLATE) has THREE:
--   time_slot     — the whole-subscription slot.
--   slots_by_day  — jsonb OBJECT keyed by weekday abbreviation:
--                   {"mon":"10:00-14:00","thu":"16:00-21:00"}. Rewritten
--                   value-by-value, so a day holding something that is not a
--                   recognised slot keeps exactly what it has.
--   slot          — DEAD COLUMN. NULL on all 94 rows (re-checked 2026-10-10:
--                   94 rows, 0 non-null) and DELIBERATELY LEFT NULL. As of
--                   this work nothing in the codebase reads it or writes it:
--                   the reader in lib/subscription-display.ts and all five
--                   writers were removed together, because removing the read
--                   alone would have left a column that looked live. Writing
--                   it here would reintroduce a carrier with no defined
--                   precedence against the other two. The column itself is
--                   left on the table — dropping it is a separate,
--                   irreversible decision.
--
-- time_slot AND slots_by_day DISAGREE ON LIVE ROWS, and neither is derivable
-- from the other, so both must be rewritten. Measured on prod 2026-10-10:
-- 6 of the 24 live subscriptions have at least one per-day value different
-- from their own
-- time_slot — e.g. time_slot '16:00-21:00' with {"fri":"16:00-21:00",
-- "mon":"10:00-14:00"}. Filtering on time_slot alone misses that mon entry;
-- filtering on slots_by_day alone misses rows whose time_slot is the only
-- stale carrier.
--
-- ===========================================================================
-- TRACE: what records this move, per table
-- ===========================================================================
-- orders                   trg_audit_orders -> capture_public_audit fires on
--                          UPDATE, so before/after is captured automatically.
--                          NOTE: `orders` has NO `updated_at` column — adding
--                          `set updated_at = now()` fails with "column
--                          updated_at of relation orders does not exist" and
--                          rolls the whole statement back. `status_updated_at`
--                          exists but this is not a status change, so it is
--                          left alone.
-- subscription_deliveries  NO TRIGGERS AT ALL. The trace is an appended
--                          admin_notes line naming BOTH old column values, so
--                          a drift stays legible after the fact.
-- subscriptions            NO audit trigger (only assign_number, which is
--                          BEFORE INSERT, and assert_not_cod — see below) and
--                          no admin_notes column, so `updated_at` (which this
--                          table does have, unlike orders) is the only trace
--                          available. That is a gap, recorded here rather than
--                          papered over.
--
-- A TRIGGER THAT DOES *NOT* FIRE — checked, not assumed:
--   tg_subscriptions_assert_not_cod is
--     BEFORE INSERT OR UPDATE **OF payment_method** ON public.subscriptions
--   Scoped to that one column, and this script never writes it, so the trigger
--   is not invoked. Had it been a bare `BEFORE UPDATE` it would have aborted
--   the statement for every row already sitting on cod (14 legacy rows do).
--
-- NO CHECK CONSTRAINT mentions any slot column on any of the three tables
-- (verified against pg_constraint), so every value named in this file — target
-- and legacy alike — is accepted as data with no schema change. That cuts both
-- ways: it is why this move needs no DDL, and it is why prod holds ~20 bare
-- point-times like '18:30' that no slot list has ever contained. The slot
-- universe is enforced in application code (isValidSlotValue), not in the
-- database.
--
-- CARVE-OUT: nothing dated TODAY (IST) or earlier is touched. Those deliver as
-- promised and age out on their own. Section 0 counts them so the figure is
-- known, and the verify block asserts the count did not move.
--
-- ===========================================================================
-- HOW TO RUN IT
-- ===========================================================================
--
-- Order of operations:
--   1. Raja messages the affected customers.
--   2. Run SECTION 0. Every verdict must read `ok` or `informational` — two
--      rows are informational by design and have no pass/fail (rows 7 and 12).
--      Any FAIL means an assumption in this header has gone stale — stop and
--      re-derive.
--   3. Run SECTION 1. Note the four order buckets, and note that bucket (c) is
--      the ALREADY-ON-TARGET baseline: those rows do not move and those
--      customers are not messaged.
--   4. Run SECTION 2 as written — it ends in `rollback`, so it is a rehearsal.
--      Read every line of the verify block. All 10 must read PASS.
--   5. Only then swap the last two lines (`rollback;` -> `commit;`) and run it
--      again. Re-read the verify block before you accept the commit.
--   6. Deploy the code that makes the old slots unbookable.
--
-- RUN IT AS ONE SCRIPT IN ONE SESSION. Section 2 is a single transaction, and
-- a client that sends each statement in its own autocommit transaction defeats
-- the snapshot, the lock and the rollback all at once. Use psql or the
-- Supabase SQL editor, paste the whole section, and confirm the trailing
-- `rollback` actually took before trusting a rehearsal.
--
-- QUOTE NO COUNT FROM THIS FILE. Every figure here is dated because the live
-- ones move within the hour. In-scope orders read 22, then 24, then 25 across
-- 48 minutes on the evening of 9 Oct while an operator worked the board — and
-- the increase was NOT new orders (the newest in-scope order predated both
-- readings); it was admin date edits pulling rows out of the carve-out, which
-- `audit_log` records as "Admin edit: Delivery moved from ... to ...". Re-run
-- SECTION 0 immediately before SECTION 2 and treat that as the only authority.
-- Related: two figures read in two SEPARATE queries can differ for real
-- reasons, so any check that compares one population to another belongs in a
-- SINGLE statement, or the apparent FAIL is just the clock.
--
-- HOW LONG THE LOCK IS HELD: 106.4 ms, measured against production with
-- `rollback` in place (lock acquired 0.4 ms, snapshot 22.5, orders 80.8,
-- deliveries 89.9, subscriptions 98.3, verify 106.8; all 10 checks PASS and
-- nothing persisted). The orders UPDATE is ~55% of that because
-- trg_audit_orders fires per row, roughly 2.3 ms/row — so the figure scales
-- with ROWS MOVED, not table size. Acquisition was uncontended; in a real run
-- competing with checkout traffic it can take up to the 3 s `lock_timeout`
-- and then abort. Honest summary: ~0.1 s held, plus up to 3 s waiting to get
-- it, and it gives up rather than queue.
--
-- IF IT ABORTS, THAT IS THE DESIGN. `could not serialize access due to
-- concurrent update` (SQLSTATE 40001) means someone edited one of the rows
-- being moved; nothing was written. Re-run the whole section. Likewise a
-- `lock_timeout` abort means someone else holds a conflicting lock — nothing
-- was written, try again when the board is quiet. Neither is a partial move.
-- The one failure this script cannot self-detect is a row entering scope while
-- it runs, which is precisely what the SHARE lock exists to prevent — see
-- item 6 above. Do not remove that lock to "speed it up".


-- ===========================================================================
-- SECTION 0 -- PRE-FLIGHT. Reads only. Run first and read every row.
-- Any verdict containing FAIL means an assumption above has gone stale: stop
-- and re-derive before running section 2.
-- ===========================================================================
begin;

with p as (
  select ((now() at time zone 'Asia/Kolkata')::date + 1)          as move_from,
          (now() at time zone 'Asia/Kolkata')::date               as carve_through,
         '16:00-21:00'::text                                      as target,
         array['06:00-10:00','10:00-14:00','15:00-21:00']::text[] as legacy
),
-- The target MUST NOT appear in the legacy list. See header item 7: the two
-- used to be disjoint by construction, and are now one edit apart, so this is
-- the check that catches a half-finished re-point. If it ever fires, the move
-- would rewrite target rows to the target and count them as moved.
target_vs_legacy as (
  select (select target = any(legacy) from p) as bad
),
-- How many rows ALREADY sit on the target. This is informational, not a FAIL:
-- the target is the long-standing evening slot, so most live rows are already
-- there. The number is printed because checks 4/5/6 in section 2 assert
-- `on_target + to_move`, and this is the first sight of the on_target half.
target_in_use as (
  select (select count(*) from public.orders, p where delivery_slot = p.target)
       + (select count(*) from public.subscription_deliveries, p
            where p.target in (slot, scheduled_time_slot))
       + (select count(*) from public.subscriptions, p where time_slot = p.target)
      as n
),
-- Any slot value in the LIVE FUTURE set that is neither a legacy value nor the
-- target is a value this script does not know how to move. NULL is fine
-- (pickup / not yet chosen) and is excluded. The `is distinct from p.target`
-- arm is load-bearing — see header item 9: without it every row already on the
-- target reports as an unknown value and these two checks FAIL on a healthy
-- database. `is distinct from` rather than `<>` because both columns are
-- nullable.
unknown_orders as (
  select string_agg(distinct o.delivery_slot, ', ') as v
  from public.orders o, p
  where o.delivery_date >= p.move_from
    and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
    and o.delivery_slot is not null
    and not (o.delivery_slot = any(p.legacy))
    and o.delivery_slot is distinct from p.target
),
unknown_deliv as (
  select string_agg(distinct u.v, ', ') as v from (
    select d.slot as v from public.subscription_deliveries d, p
     where coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
       and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
       and d.slot is not null and not (d.slot = any(p.legacy))
       and d.slot is distinct from p.target
    union
    select d.scheduled_time_slot from public.subscription_deliveries d, p
     where coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
       and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
       and d.scheduled_time_slot is not null
       and not (d.scheduled_time_slot = any(p.legacy))
       and d.scheduled_time_slot is distinct from p.target
  ) u
),
-- The live-subscription allowlist used below is
-- ('active','pending_confirmation','paused'). A status outside the whole
-- known universe would mean a live template is silently skipped.
unknown_status as (
  select string_agg(distinct coalesce(status,'(null)'), ', ') as v
  from public.subscriptions
  where coalesce(status,'') not in
    ('active','pending_confirmation','paused','completed','cancelled','canceled','expired')
),
-- Bare legacy times ('07:30' etc) from the old 30-minute grid. 14 rows hold
-- one and NONE is live — 4 cancelled, 10 completed (prod, 2026-10-10). They
-- are history and are NOT moved. Re-measured here rather than trusted, because
-- a live one would be a row this script cannot move and a human has to decide
-- about. Where they came from: a never-shipped revision of the app offered a
-- 25-entry half-hourly grid; `isValidSlotValue` would now reject every one of
-- those values at checkout, which is why none can appear again.
bare_live as (
  select count(*) as n from public.subscriptions
  where time_slot is not null
    and time_slot !~ '^[0-9]{2}:[0-9]{2}-[0-9]{2}:[0-9]{2}$'
    and coalesce(status,'') in ('active','pending_confirmation','paused')
),
-- Rows whose two delivery columns already disagree. The `or` predicate in
-- section 2 catches them; this makes the number visible before and after.
drifted as (
  select count(*) as n from public.subscription_deliveries d, p
  where coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
    and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
    and coalesce(d.slot,'~') <> coalesce(d.scheduled_time_slot,'~')
)
select item, value, verdict from (
  select 1 as ord, 'now (IST)' as item,
         (select (now() at time zone 'Asia/Kolkata')::text) as value,
         '' as verdict
  union all
  select 2, 'move applies to delivery_date >=',
         (select move_from::text from p), ''
  union all
  select 3, 'carve-out (untouched), delivery_date <=',
         (select carve_through::text from p), ''
  union all
  select 4, 'target value',
         (select target from p), ''
  union all
  select 5, 'legacy values',
         (select array_to_string(legacy, ', ') from p), ''
  union all
  select 6, 'target must NOT be in the legacy list',
         case when (select bad from target_vs_legacy) then 'YES' else 'no' end,
         case when (select bad from target_vs_legacy)
              then 'FAIL - target is also listed as legacy, re-point is half done'
              else 'ok' end
  union all
  select 7, 'rows ALREADY on the target (informational, expect many)',
         (select n::text from target_in_use), 'informational'
  union all
  select 8, 'unknown slot values, orders live+future',
         coalesce((select v from unknown_orders), '(none)'),
         case when (select v from unknown_orders) is null
              then 'ok' else 'FAIL - review by hand' end
  union all
  select 9, 'unknown slot values, deliveries live+future',
         coalesce((select v from unknown_deliv), '(none)'),
         case when (select v from unknown_deliv) is null
              then 'ok' else 'FAIL - review by hand' end
  union all
  select 10, 'unknown subscription status values',
         coalesce((select v from unknown_status), '(none)'),
         case when (select v from unknown_status) is null
              then 'ok' else 'FAIL - widen the live allowlist' end
  union all
  select 11, 'LIVE subs holding a bare-time time_slot (expect 0)',
         (select n::text from bare_live),
         case when (select n from bare_live) = 0
              then 'ok' else 'FAIL - review by hand, not moved by this script' end
  union all
  select 12, 'deliveries with drifted slot columns, live+future',
         (select n::text from drifted), 'informational'
) x order by ord;

rollback;


-- ===========================================================================
-- SECTION 1 -- DRY RUN. Counts only, changes nothing. Safe to run as-is.
-- (a) and (b) are reported separately because they are two different
-- customer conversations. They are EXECUTED as one statement per table.
-- (c) is neither: it is the ALREADY-ON-TARGET baseline, reported because
-- section 2's checks 4/5/6 assert `on_target + to_move` and this is where the
-- operator first sees the on_target half. (c) rows are NOT moved and NOT
-- messaged — nothing about their delivery changes.
-- ===========================================================================
begin;

with p as (
  select ((now() at time zone 'Asia/Kolkata')::date + 1) as move_from,
          (now() at time zone 'Asia/Kolkata')::date      as carve_through
)
select bucket, n from (
  -- The FOUR order buckets below carry the SAME pickup exclusion as the
  -- snapshot and the UPDATE in section 2. The dry run exists so the operator
  -- can compare it against what the move actually writes, so its predicate
  -- must not diverge from the UPDATE's — otherwise the comparison is worthless
  -- on the one day a pickup order is in scope. Four sites, kept in step.
  --
  -- (a) off the paused morning / midday windows
  select 1 as ord, '(a) orders on 06:00-10:00' as bucket, count(*) as n
    from public.orders o, p
   where o.delivery_slot = '06:00-10:00' and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
     and coalesce(o.fulfillment_type, '') <> 'pickup'
  union all
  select 2, '(a) orders on 10:00-14:00', count(*)
    from public.orders o, p
   where o.delivery_slot = '10:00-14:00' and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
     and coalesce(o.fulfillment_type, '') <> 'pickup'
  -- (b) the 3 pm target of the earlier revision of this file. Expected 0 — it
  -- was never shipped to a customer. Here as insurance, not as an expectation.
  union all
  select 3, '(b) orders on 15:00-21:00 (expect 0)', count(*)
    from public.orders o, p
   where o.delivery_slot = '15:00-21:00' and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
     and coalesce(o.fulfillment_type, '') <> 'pickup'
  -- (c) baseline: already on the target. Not moved. Mirrors _before.
  union all
  select 4, '(c) orders ALREADY on 16:00-21:00 (not moved)', count(*)
    from public.orders o, p
   where o.delivery_slot = '16:00-21:00' and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
     and coalesce(o.fulfillment_type, '') <> 'pickup'

  union all
  select 5, '(a) deliveries, either column on 06:00-10:00 or 10:00-14:00', count(*)
    from public.subscription_deliveries d, p
   where ('06:00-10:00' in (d.slot, d.scheduled_time_slot)
       or '10:00-14:00' in (d.slot, d.scheduled_time_slot))
     and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
     and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
  union all
  select 6, '(b) deliveries, either column on 15:00-21:00 (expect 0)', count(*)
    from public.subscription_deliveries d, p
   where '15:00-21:00' in (d.slot, d.scheduled_time_slot)
     and not ('06:00-10:00' in (d.slot, d.scheduled_time_slot)
           or '10:00-14:00' in (d.slot, d.scheduled_time_slot))
     and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
     and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
  -- (c) baseline. BOTH columns, because that is what check 5 counts after the
  -- move: a row with only one column on the target is a DRIFTED row, it holds
  -- a legacy value in the other column, and it belongs to (a) or (b).
  union all
  select 7, '(c) deliveries ALREADY on 16:00-21:00 in BOTH columns (not moved)', count(*)
    from public.subscription_deliveries d, p
   where d.slot = '16:00-21:00' and d.scheduled_time_slot = '16:00-21:00'
     and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
     and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')

  union all
  select 8, '(a) live subscriptions with a morning/midday carrier', count(*)
    from public.subscriptions s
   where coalesce(s.status,'') in ('active','pending_confirmation','paused')
     and (s.time_slot in ('06:00-10:00','10:00-14:00')
       or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                   where e.value in ('06:00-10:00','10:00-14:00')))
  union all
  select 9, '(b) live subscriptions with a 15:00-21:00 carrier (expect 0)', count(*)
    from public.subscriptions s
   where coalesce(s.status,'') in ('active','pending_confirmation','paused')
     and (s.time_slot = '15:00-21:00'
       or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                   where e.value = '15:00-21:00'))
     and s.time_slot is distinct from '06:00-10:00'
     and s.time_slot is distinct from '10:00-14:00'
     and not exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                      where e.value in ('06:00-10:00','10:00-14:00'))
  -- (c) baseline, time_slot ONLY — that is the carrier check 6 counts. A sub
  -- whose time_slot is on the target but which has a legacy day inside
  -- slots_by_day is a MOVED row and is already counted in (a); it is excluded
  -- here so (a) and (c) stay disjoint and their sum is the post-move count.
  -- 2 of 25 live subs were in exactly that state on 2026-10-11. (An earlier
  -- revision of this comment said "6 of 24", which was a stale figure copied
  -- from a header line measuring carrier DRIFT and total live subs rather
  -- than this predicate. Re-measured against prod: 18 subs hold a legacy
  -- time_slot, 2 more are on the target with a legacy day inside
  -- slots_by_day, 18 + 2 = 20 = bucket (a), and 20 + 5 clean = 25 live.)
  union all
  select 10, '(c) live subscriptions ALREADY on 16:00-21:00 (time_slot, not moved)', count(*)
    from public.subscriptions s
   where coalesce(s.status,'') in ('active','pending_confirmation','paused')
     and s.time_slot = '16:00-21:00'
     and not exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                      where e.value in ('06:00-10:00','10:00-14:00','15:00-21:00'))

  -- Carve-out, for information. NOT moved.
  union all
  select 11, '-- carve-out, NOT moved: orders dated today or earlier', count(*)
    from public.orders o, p
   where o.delivery_slot is not null and o.delivery_date <= p.carve_through
  union all
  select 12, '-- carve-out, NOT moved: deliveries dated today or earlier', count(*)
    from public.subscription_deliveries d, p
   where (d.slot is not null or d.scheduled_time_slot is not null)
     and coalesce(d.scheduled_date, d.delivery_date) <= p.carve_through
) x order by ord;

rollback;


-- ===========================================================================
-- SECTION 2 -- THE MOVE. Run only after the customers have been messaged.
-- One transaction: all three tables move together or not at all.
-- Ends in ROLLBACK. Read the verify block, then swap the last two lines.
-- ===========================================================================
-- ISOLATION: repeatable read, plus an explicit SHARE lock below.
--
-- REPEATABLE READ means every statement below — snapshot, the three UPDATEs
-- and the verify block — sees ONE consistent view. Under the default READ
-- COMMITTED each statement re-snapshots, so an order edited into scope
-- between the snapshot and the UPDATE makes verify check 4 read "25 vs 24"
-- and report FAIL on a move that was actually correct. Observed live: two
-- admin edits at 22:38 and 22:39 on 9 Oct moved orders 7 Oct -> 12 Oct, +2
-- in 18 minutes.
--
-- IF THIS TRANSACTION ABORTS with "could not serialize access due to
-- concurrent update" (SQLSTATE 40001): someone edited one of the rows being
-- moved. That is the CORRECT outcome — a clean abort, not a partial move.
-- Nothing was written. Just run the whole section again.
--
-- The SHARE lock is what handles the other direction, which isolation level
-- CANNOT: a row entering scope is a phantom, and under REPEATABLE READ alone
-- the UPDATE would skip it with no error AND the verify block, on the same
-- snapshot, would not see it either — committing a silent miss. The lock
-- stops writers for the few ms the move takes, so that cannot arise.
begin isolation level repeatable read;

-- Both timeouts are bounded because the SHARE lock below stops ALL writers on
-- public.orders — that includes CUSTOMERS placing orders on the website, not
-- just the admin board. Fine for a few milliseconds, not fine if anything
-- hangs.
--   lock_timeout      we fail fast rather than queueing behind someone else's
--                     long transaction. A 3 s wait that then aborts is far
--                     better than an unbounded wait during which checkout is
--                     already blocked behind us.
--   statement_timeout a stuck statement cannot hold the orders table against
--                     live checkout traffic indefinitely.
-- SET LOCAL, so both revert at COMMIT/ROLLBACK and leak into nothing else.
set local lock_timeout = '3s';
set local statement_timeout = '30s';

-- Blocks writers, allows readers: the admin board stays viewable while this
-- runs. Conflicts with ROW EXCLUSIVE, so a concurrent admin edit or checkout
-- waits (or hits lock_timeout) instead of interleaving with the move.
lock table public.orders,
           public.subscription_deliveries,
           public.subscriptions in share mode;

-- Run-time constants. The ONLY place a value is named. Nothing below contains
-- a date literal or an order number.
create temporary table _p on commit drop as
select ((now() at time zone 'Asia/Kolkata')::date + 1)          as move_from,
        (now() at time zone 'Asia/Kolkata')::date               as carve_through,
       '16:00-21:00'::text                                      as target,
       array['06:00-10:00','10:00-14:00','15:00-21:00']::text[] as legacy;

-- Snapshot taken BEFORE the updates, in the same transaction. The verify
-- block compares against these rows, so its expectations cannot go stale the
-- way a written-in number does.
-- THE `*.on_target` ROWS EXIST BECAUSE THE TARGET IS NOT A FRESH VALUE.
-- Checks 4/5/6 count rows on the target AFTER the move; some rows were already
-- there BEFORE it, so the invariant is `after == on_target + to_move`. See
-- header item 8. Each on_target row is written to be DISJOINT from its
-- to_move partner and to count exactly the population its check counts —
-- otherwise the sum double-counts a drifted row and fails a correct run.
create temporary table _before on commit drop as
-- orders.to_move MUST carry the same pickup exclusion as the UPDATE below.
-- Verify check 4 asserts "orders now on target == orders.to_move"; if only the
-- UPDATE excluded pickup, then on the first day a pickup order is in scope the
-- snapshot would count it, the UPDATE would skip it, and the script would FAIL
-- a correct run — on exactly the day the clause earns its keep.
select 'orders.to_move' as k, count(*) as n
  from public.orders o, _p p
 where o.delivery_slot = any(p.legacy) and o.delivery_date >= p.move_from
   and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
   and coalesce(o.fulfillment_type, '') <> 'pickup'
union all
-- Disjoint from orders.to_move because `target` is not in `legacy` — which is
-- what section 0's check 6 exists to guarantee.
select 'orders.on_target', count(*)
  from public.orders o, _p p
 where o.delivery_slot = p.target and o.delivery_date >= p.move_from
   and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
   and coalesce(o.fulfillment_type, '') <> 'pickup'
union all
-- No pickup clause here on purpose: check 7 compares this population to
-- itself after the move, and both sides use this one predicate.
select 'orders.carveout', count(*)
  from public.orders o, _p p
 where o.delivery_slot = any(p.legacy) and o.delivery_date <= p.carve_through
union all
select 'deliveries.to_move', count(*)
  from public.subscription_deliveries d, _p p
 where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
   and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
   and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
union all
-- BOTH columns, matching check 5. A row with ONE column on the target holds a
-- legacy value in the other and is therefore in deliveries.to_move; counting
-- it here too would double it in the sum. This is not hypothetical — OLS36
-- seq 2 was exactly that row (slot 16:00-21:00 / scheduled_time_slot
-- 06:00-10:00).
select 'deliveries.on_target', count(*)
  from public.subscription_deliveries d, _p p
 where d.slot = p.target and d.scheduled_time_slot = p.target
   and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
   and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
union all
select 'deliveries.carveout', count(*)
  from public.subscription_deliveries d, _p p
 where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
   and coalesce(d.scheduled_date, d.delivery_date) <= p.carve_through
union all
-- ROW-LEVEL: how many templates the UPDATE touches. Matches the UPDATE's WHERE
-- exactly. Reported for the operator; NOT what check 6 asserts against — see
-- the next two rows.
select 'subs.to_move', count(*)
  from public.subscriptions s, _p p
 where coalesce(s.status,'') in ('active','pending_confirmation','paused')
   and (s.time_slot = any(p.legacy)
     or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                 where e.value = any(p.legacy)))
union all
-- CHECK 6 COUNTS ONE CARRIER, time_slot, SO ITS SNAPSHOT MUST TOO.
-- `subs.to_move` above is a ROW count over BOTH carriers, and the two
-- populations are neither disjoint from `on_target` nor equal to what ends up
-- on the target:
--   a sub with time_slot already on target AND a legacy day inside
--   slots_by_day is in to_move and would also be in a naive on_target —
--   counted twice, though only one row ends on the target. 6 of 24 live subs
--   were in that state on 2026-10-10.
--   a sub whose time_slot is NULL or a bare time, moved only because of a
--   legacy day, is in to_move but does NOT end on the target at all.
-- So check 6 uses these two time_slot-only counts, which ARE disjoint (target
-- is not in legacy) and whose sum is exactly the post-move population.
select 'subs.time_slot.to_move', count(*)
  from public.subscriptions s, _p p
 where coalesce(s.status,'') in ('active','pending_confirmation','paused')
   and s.time_slot = any(p.legacy)
union all
select 'subs.time_slot.on_target', count(*)
  from public.subscriptions s, _p p
 where coalesce(s.status,'') in ('active','pending_confirmation','paused')
   and s.time_slot = p.target;


-- ── 1 of 3: one-off orders ──────────────────────────────────────────────
-- No updated_at column on this table; trg_audit_orders records before/after.
--
-- PICKUP IS EXCLUDED. A pickup order has no delivery window, but it can still
-- be CARRYING one: checkout/page.tsx:1264-1265 sends delivery_date and
-- delivery_slot unconditionally and order-checkout.ts:552-556 persists them,
-- so choosing a slot and then toggling to Pickup leaves the slot behind.
-- 10 of 145 pickup orders hold one today (8 x 10:00-14:00, 2 x 16:00-21:00,
-- most recently OLF669 on 7 Oct). None is in scope right now, so this clause
-- is a no-op as written — but one pickup order placed tomorrow WOULD be in
-- scope, and without this the move would rewrite it into the 4-9 pm DELIVERY
-- window and tell a collecting customer they are getting a delivery.
-- `coalesce(..., '')` because the column is nullable and NULL <> 'pickup' is
-- NULL, not true, which would silently drop every row that has no type set.
update public.orders o
   set delivery_slot = p.target
  from _p p
 where o.delivery_slot = any(p.legacy)
   and o.delivery_date >= p.move_from
   and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
   and coalesce(o.fulfillment_type, '') <> 'pickup';


-- ── 2 of 3: subscription deliveries ─────────────────────────────────────
-- BOTH slot columns, because the bake sheet and the customer's tracking page
-- disagree on which one wins. `or` across the columns, not coalesce, so a
-- drifted row is caught. The DATE goes the other way —
-- `coalesce(scheduled_date, delivery_date)`, mirroring every date reader in
-- the app, because unlike the slot columns those DO agree on a precedence.
-- Header items 4 and 10 are the two halves of that distinction.
-- admin_notes carries the trace this table has no
-- trigger for; the right-hand side of a SET reads the OLD row, so the note
-- records what the values were.
update public.subscription_deliveries d
   set slot                = p.target,
       scheduled_time_slot = p.target,
       status_updated_at   = now(),
       admin_notes         = case when coalesce(d.admin_notes,'') = ''
                                  then '' else d.admin_notes || E'\n' end
                             || 'Slot moved ' || coalesce(d.slot,'(null)')
                             || ' / ' || coalesce(d.scheduled_time_slot,'(null)')
                             || ' -> ' || p.target
                             || ' (evening-only rollout, single slot 4-9 pm)'
  from _p p
 where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
   and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
   and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered');


-- ── 3 of 3: subscription TEMPLATES ──────────────────────────────────────
-- Both carriers. slots_by_day is rebuilt value-by-value so a day holding an
-- unrecognised value keeps it; the null/{} guard stops jsonb_object_agg from
-- returning NULL and wiping the column. `slot` is left NULL on purpose — see
-- the header. No date filter: a template has no delivery_date, and its dated
-- rows are subscription_deliveries, handled above.
update public.subscriptions s
   set time_slot    = case when s.time_slot = any(p.legacy) then p.target
                           else s.time_slot end,
       slots_by_day = case
                        when s.slots_by_day is null or s.slots_by_day = '{}'::jsonb
                          then s.slots_by_day
                        else (select jsonb_object_agg(e.key,
                                case when e.value = any(p.legacy) then p.target
                                     else e.value end)
                              from jsonb_each_text(s.slots_by_day) e)
                      end,
       updated_at   = now()
  from _p p
 where coalesce(s.status,'') in ('active','pending_confirmation','paused')
   and (s.time_slot = any(p.legacy)
     or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                 where e.value = any(p.legacy)));


-- ── VERIFY ──────────────────────────────────────────────────────────────
-- Every line must read PASS. Each is an invariant, not a number:
--   1-3   nothing live and future is left on ANY legacy value
--   4-6   the count now on the target equals what was ALREADY there plus what
--         was to be moved (header item 8 — it is not `to_move` alone)
--   7-8   the carve-out is untouched (same rows still on legacy values)
--   9     no live future delivery has its two slot columns disagreeing
--   10    no live subscription has a per-day value disagreeing with time_slot
select item, detail,
       case when ok then 'PASS' else 'FAIL -> ROLLBACK' end as verdict
from (
  select 1 as ord, 'orders left on a legacy slot (live, future, non-pickup)' as item,
         count(*)::text as detail, count(*) = 0 as ok
    from public.orders o, _p p
   where o.delivery_slot = any(p.legacy) and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
     -- PICKUP SITE. The orders UPDATE deliberately skips pickup orders, so
     -- without this clause a pickup order in scope is left on a legacy value
     -- and THIS CHECK FAILS A CORRECT RUN -- the same false-FAIL class the
     -- header's item 5 describes for check 4. No-op today (all 10
     -- slot-carrying pickup orders are inside the carve-out); live the first
     -- day someone places a pickup order for tomorrow.
     and coalesce(o.fulfillment_type,'') <> 'pickup'
  union all
  select 2, 'deliveries left on a legacy slot, either column (live, future)',
         count(*)::text, count(*) = 0
    from public.subscription_deliveries d, _p p
   where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
     and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
     and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
  union all
  select 3, 'live subscriptions left on a legacy slot, either carrier',
         count(*)::text, count(*) = 0
    from public.subscriptions s, _p p
   where coalesce(s.status,'') in ('active','pending_confirmation','paused')
     and (s.time_slot = any(p.legacy)
       or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                   where e.value = any(p.legacy)))

  union all
  -- CHECKS 4-6 ASSERT `on_target + to_move`, NOT `to_move`. The target is the
  -- value most live rows already held, so the post-move population is the sum
  -- of the two snapshot halves. Asserting against to_move alone fails by
  -- exactly the pre-existing population — see header item 8. Both halves are
  -- printed so an operator can see which one moved.
  -- The pickup clause on check 4 matches BOTH snapshot halves; drop it from
  -- any one of the three and the sum stops being comparable.
  select 4, 'orders now on target == orders.on_target + orders.to_move',
         (select count(*)::text from public.orders o, _p p
           where o.delivery_slot = p.target and o.delivery_date >= p.move_from
             and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
             and coalesce(o.fulfillment_type,'') <> 'pickup')
         || ' vs ' || (select n::text from _before where k = 'orders.on_target')
         || ' + '  || (select n::text from _before where k = 'orders.to_move'),
         (select count(*) from public.orders o, _p p
           where o.delivery_slot = p.target and o.delivery_date >= p.move_from
             and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
             and coalesce(o.fulfillment_type,'') <> 'pickup')
         = (select n from _before where k = 'orders.on_target')
         + (select n from _before where k = 'orders.to_move')
  union all
  select 5, 'deliveries now on target in BOTH columns == on_target + to_move',
         (select count(*)::text from public.subscription_deliveries d, _p p
           where d.slot = p.target and d.scheduled_time_slot = p.target
             and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
             and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered'))
         || ' vs ' || (select n::text from _before where k = 'deliveries.on_target')
         || ' + '  || (select n::text from _before where k = 'deliveries.to_move'),
         (select count(*) from public.subscription_deliveries d, _p p
           where d.slot = p.target and d.scheduled_time_slot = p.target
             and coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
             and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered'))
         = (select n from _before where k = 'deliveries.on_target')
         + (select n from _before where k = 'deliveries.to_move')
  union all
  -- time_slot-only halves, NOT the row-level `subs.to_move`. The reason is
  -- spelled out on those snapshot rows: the row count covers both carriers,
  -- so it over-counts a sub already on the target with one legacy day, and
  -- includes subs that never end up on the target at all.
  select 6, 'live subs now on target (time_slot) == on_target + to_move',
         (select count(*)::text from public.subscriptions s, _p p
           where s.time_slot = p.target
             and coalesce(s.status,'') in ('active','pending_confirmation','paused'))
         || ' vs ' || (select n::text from _before where k = 'subs.time_slot.on_target')
         || ' + '  || (select n::text from _before where k = 'subs.time_slot.to_move')
         || '   (templates touched: '
         || (select n::text from _before where k = 'subs.to_move') || ')',
         (select count(*) from public.subscriptions s, _p p
           where s.time_slot = p.target
             and coalesce(s.status,'') in ('active','pending_confirmation','paused'))
         = (select n from _before where k = 'subs.time_slot.on_target')
         + (select n from _before where k = 'subs.time_slot.to_move')

  union all
  select 7, 'carve-out orders unchanged',
         (select count(*)::text from public.orders o, _p p
           where o.delivery_slot = any(p.legacy) and o.delivery_date <= p.carve_through)
         || ' vs ' || (select n::text from _before where k = 'orders.carveout'),
         (select count(*) from public.orders o, _p p
           where o.delivery_slot = any(p.legacy) and o.delivery_date <= p.carve_through)
         = (select n from _before where k = 'orders.carveout')
  union all
  select 8, 'carve-out deliveries unchanged',
         (select count(*)::text from public.subscription_deliveries d, _p p
           where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
             and coalesce(d.scheduled_date, d.delivery_date) <= p.carve_through)
         || ' vs ' || (select n::text from _before where k = 'deliveries.carveout'),
         (select count(*) from public.subscription_deliveries d, _p p
           where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
             and coalesce(d.scheduled_date, d.delivery_date) <= p.carve_through)
         = (select n from _before where k = 'deliveries.carveout')

  union all
  select 9, 'deliveries with the two slot columns disagreeing (live, future)',
         count(*)::text, count(*) = 0
    from public.subscription_deliveries d, _p p
   where coalesce(d.scheduled_date, d.delivery_date) >= p.move_from
     and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
     and coalesce(d.slot,'~') <> coalesce(d.scheduled_time_slot,'~')
  union all
  select 10, 'live subs with a slots_by_day day <> their own time_slot',
         count(*)::text, count(*) = 0
    from public.subscriptions s
   where coalesce(s.status,'') in ('active','pending_confirmation','paused')
     and s.slots_by_day is not null
     and exists (select 1 from jsonb_each_text(s.slots_by_day) e
                  where e.value is distinct from s.time_slot)
) v order by ord;

-- Swap these two lines once every line above reads PASS.
rollback;
-- commit;
