-- Collapse every live future booking onto the ONE delivery slot: 15:00-21:00.
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
-- 1. THE TARGET IS 15:00-21:00, NOT 16:00-21:00. One slot, 3 pm - 9 pm.
--
-- 2. THERE ARE THREE SOURCE VALUES, NOT ONE. The old script moved
--    '10:00-14:00' only. It has to move:
--      (a) '06:00-10:00' and '10:00-14:00'  — the paused windows
--      (b) '16:00-21:00'                    — the OLD evening value, which is
--          no longer the slot. (b) is the case the previous script missed
--          entirely: those rows looked already-correct and are not.
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
--   slot          — NULL on all 92 rows and DELIBERATELY LEFT NULL. It is
--                   null for every subscription that has ever existed, so no
--                   reader can be depending on a value in it; writing one
--                   would introduce a fourth carrier with no defined
--                   precedence against the other two. Status quo is safer
--                   than a tidy-looking write.
--
-- time_slot AND slots_by_day DISAGREE ON LIVE ROWS, and neither is derivable
-- from the other, so both must be rewritten. Measured on prod: 6 of the 23
-- live subscriptions have at least one per-day value different from their own
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
-- (verified against pg_constraint), so '15:00-21:00' is accepted as data with
-- no schema change. The slot universe is enforced in application code
-- (isValidSlotValue), not in the database.
--
-- CARVE-OUT: nothing dated TODAY (IST) or earlier is touched. Those deliver as
-- promised and age out on their own. Section 0 counts them so the figure is
-- known, and the verify block asserts the count did not move.


-- ===========================================================================
-- SECTION 0 -- PRE-FLIGHT. Reads only. Run first and read every row.
-- Any verdict containing FAIL means an assumption above has gone stale: stop
-- and re-derive before running section 2.
-- ===========================================================================
begin;

with p as (
  select ((now() at time zone 'Asia/Kolkata')::date + 1)          as move_from,
          (now() at time zone 'Asia/Kolkata')::date               as carve_through,
         '15:00-21:00'::text                                      as target,
         array['06:00-10:00','10:00-14:00','16:00-21:00']::text[] as legacy
),
-- The target must not already be in use anywhere. If it is, this script has
-- already been run (or someone has booked onto it) and "after == before" is
-- no longer a valid invariant.
target_in_use as (
  select (select count(*) from public.orders, p where delivery_slot = p.target)
       + (select count(*) from public.subscription_deliveries, p
            where p.target in (slot, scheduled_time_slot))
       + (select count(*) from public.subscriptions, p where time_slot = p.target)
      as n
),
-- Any slot value in the LIVE FUTURE set that is not one of the three legacy
-- values is a value this script does not know how to move. NULL is fine
-- (pickup / not yet chosen) and is excluded.
unknown_orders as (
  select string_agg(distinct o.delivery_slot, ', ') as v
  from public.orders o, p
  where o.delivery_date >= p.move_from
    and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
    and o.delivery_slot is not null
    and not (o.delivery_slot = any(p.legacy))
),
unknown_deliv as (
  select string_agg(distinct u.v, ', ') as v from (
    select d.slot as v from public.subscription_deliveries d, p
     where d.delivery_date >= p.move_from
       and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
       and d.slot is not null and not (d.slot = any(p.legacy))
    union
    select d.scheduled_time_slot from public.subscription_deliveries d, p
     where d.delivery_date >= p.move_from
       and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
       and d.scheduled_time_slot is not null
       and not (d.scheduled_time_slot = any(p.legacy))
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
-- one; 0 of them are live. They are history and are NOT moved. Re-measured
-- here rather than trusted.
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
  where d.delivery_date >= p.move_from
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
  select 5, 'rows already on the target (expect 0)',
         (select n::text from target_in_use),
         case when (select n from target_in_use) = 0
              then 'ok' else 'FAIL - target already in use' end
  union all
  select 6, 'unknown slot values, orders live+future',
         coalesce((select v from unknown_orders), '(none)'),
         case when (select v from unknown_orders) is null
              then 'ok' else 'FAIL - review by hand' end
  union all
  select 7, 'unknown slot values, deliveries live+future',
         coalesce((select v from unknown_deliv), '(none)'),
         case when (select v from unknown_deliv) is null
              then 'ok' else 'FAIL - review by hand' end
  union all
  select 8, 'unknown subscription status values',
         coalesce((select v from unknown_status), '(none)'),
         case when (select v from unknown_status) is null
              then 'ok' else 'FAIL - widen the live allowlist' end
  union all
  select 9, 'LIVE subs holding a bare-time time_slot (expect 0)',
         (select n::text from bare_live),
         case when (select n from bare_live) = 0
              then 'ok' else 'FAIL - review by hand, not moved by this script' end
  union all
  select 10, 'deliveries with drifted slot columns, live+future',
         (select n::text from drifted), 'informational'
) x order by ord;

rollback;


-- ===========================================================================
-- SECTION 1 -- DRY RUN. Counts only, changes nothing. Safe to run as-is.
-- (a) and (b) are reported separately because they are two different
-- customer conversations. They are EXECUTED as one statement per table.
-- ===========================================================================
begin;

with p as (
  select ((now() at time zone 'Asia/Kolkata')::date + 1) as move_from,
          (now() at time zone 'Asia/Kolkata')::date      as carve_through
)
select bucket, n from (
  -- (a) off the paused morning / midday windows
  select 1 as ord, '(a) orders on 06:00-10:00' as bucket, count(*) as n
    from public.orders o, p
   where o.delivery_slot = '06:00-10:00' and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
  union all
  select 2, '(a) orders on 10:00-14:00', count(*)
    from public.orders o, p
   where o.delivery_slot = '10:00-14:00' and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
  -- (b) relabel: already on the OLD evening value
  union all
  select 3, '(b) orders on 16:00-21:00', count(*)
    from public.orders o, p
   where o.delivery_slot = '16:00-21:00' and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')

  union all
  select 4, '(a) deliveries, either column on 06:00-10:00 or 10:00-14:00', count(*)
    from public.subscription_deliveries d, p
   where ('06:00-10:00' in (d.slot, d.scheduled_time_slot)
       or '10:00-14:00' in (d.slot, d.scheduled_time_slot))
     and d.delivery_date >= p.move_from
     and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
  union all
  select 5, '(b) deliveries already on 16:00-21:00 and nothing older', count(*)
    from public.subscription_deliveries d, p
   where '16:00-21:00' in (d.slot, d.scheduled_time_slot)
     and not ('06:00-10:00' in (d.slot, d.scheduled_time_slot)
           or '10:00-14:00' in (d.slot, d.scheduled_time_slot))
     and d.delivery_date >= p.move_from
     and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')

  union all
  select 6, '(a) live subscriptions with a morning/midday carrier', count(*)
    from public.subscriptions s
   where coalesce(s.status,'') in ('active','pending_confirmation','paused')
     and (s.time_slot in ('06:00-10:00','10:00-14:00')
       or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                   where e.value in ('06:00-10:00','10:00-14:00')))
  union all
  select 7, '(b) live subscriptions on 16:00-21:00 only', count(*)
    from public.subscriptions s
   where coalesce(s.status,'') in ('active','pending_confirmation','paused')
     and (s.time_slot = '16:00-21:00'
       or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                   where e.value = '16:00-21:00'))
     and s.time_slot is distinct from '06:00-10:00'
     and s.time_slot is distinct from '10:00-14:00'
     and not exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                      where e.value in ('06:00-10:00','10:00-14:00'))

  -- Carve-out, for information. NOT moved.
  union all
  select 8, '-- carve-out, NOT moved: orders dated today or earlier', count(*)
    from public.orders o, p
   where o.delivery_slot is not null and o.delivery_date <= p.carve_through
  union all
  select 9, '-- carve-out, NOT moved: deliveries dated today or earlier', count(*)
    from public.subscription_deliveries d, p
   where (d.slot is not null or d.scheduled_time_slot is not null)
     and d.delivery_date <= p.carve_through
) x order by ord;

rollback;


-- ===========================================================================
-- SECTION 2 -- THE MOVE. Run only after the customers have been messaged.
-- One transaction: all three tables move together or not at all.
-- Ends in ROLLBACK. Read the verify block, then swap the last two lines.
-- ===========================================================================
begin;

-- Run-time constants. The ONLY place a value is named. Nothing below contains
-- a date literal or an order number.
create temporary table _p on commit drop as
select ((now() at time zone 'Asia/Kolkata')::date + 1)          as move_from,
        (now() at time zone 'Asia/Kolkata')::date               as carve_through,
       '15:00-21:00'::text                                      as target,
       array['06:00-10:00','10:00-14:00','16:00-21:00']::text[] as legacy;

-- Snapshot taken BEFORE the updates, in the same transaction. The verify
-- block compares against these rows, so its expectations cannot go stale the
-- way a written-in number does.
create temporary table _before on commit drop as
select 'orders.to_move' as k, count(*) as n
  from public.orders o, _p p
 where o.delivery_slot = any(p.legacy) and o.delivery_date >= p.move_from
   and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
union all
select 'orders.carveout', count(*)
  from public.orders o, _p p
 where o.delivery_slot = any(p.legacy) and o.delivery_date <= p.carve_through
union all
select 'deliveries.to_move', count(*)
  from public.subscription_deliveries d, _p p
 where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
   and d.delivery_date >= p.move_from
   and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered')
union all
select 'deliveries.carveout', count(*)
  from public.subscription_deliveries d, _p p
 where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
   and d.delivery_date <= p.carve_through
union all
select 'subs.to_move', count(*)
  from public.subscriptions s, _p p
 where coalesce(s.status,'') in ('active','pending_confirmation','paused')
   and (s.time_slot = any(p.legacy)
     or exists (select 1 from jsonb_each_text(coalesce(s.slots_by_day,'{}'::jsonb)) e
                 where e.value = any(p.legacy)));


-- ── 1 of 3: one-off orders ──────────────────────────────────────────────
-- No updated_at column on this table; trg_audit_orders records before/after.
update public.orders o
   set delivery_slot = p.target
  from _p p
 where o.delivery_slot = any(p.legacy)
   and o.delivery_date >= p.move_from
   and coalesce(o.status,'') not in ('cancelled','canceled','delivered');


-- ── 2 of 3: subscription deliveries ─────────────────────────────────────
-- BOTH slot columns, because the bake sheet and the customer's tracking page
-- disagree on which one wins. `or` across the columns, not coalesce, so a
-- drifted row is caught. admin_notes carries the trace this table has no
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
                             || ' (evening-only rollout, single slot 3-9 pm)'
  from _p p
 where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
   and d.delivery_date >= p.move_from
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
--   4-6   the count now on the target equals the count that was to be moved
--   7-8   the carve-out is untouched (same rows still on legacy values)
--   9     no live future delivery has its two slot columns disagreeing
--   10    no live subscription has a per-day value disagreeing with time_slot
select item, detail,
       case when ok then 'PASS' else 'FAIL -> ROLLBACK' end as verdict
from (
  select 1 as ord, 'orders left on a legacy slot (live, future)' as item,
         count(*)::text as detail, count(*) = 0 as ok
    from public.orders o, _p p
   where o.delivery_slot = any(p.legacy) and o.delivery_date >= p.move_from
     and coalesce(o.status,'') not in ('cancelled','canceled','delivered')
  union all
  select 2, 'deliveries left on a legacy slot, either column (live, future)',
         count(*)::text, count(*) = 0
    from public.subscription_deliveries d, _p p
   where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
     and d.delivery_date >= p.move_from
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
  select 4, 'orders now on target == orders.to_move',
         (select count(*)::text from public.orders o, _p p
           where o.delivery_slot = p.target and o.delivery_date >= p.move_from
             and coalesce(o.status,'') not in ('cancelled','canceled','delivered'))
         || ' vs ' || (select n::text from _before where k = 'orders.to_move'),
         (select count(*) from public.orders o, _p p
           where o.delivery_slot = p.target and o.delivery_date >= p.move_from
             and coalesce(o.status,'') not in ('cancelled','canceled','delivered'))
         = (select n from _before where k = 'orders.to_move')
  union all
  select 5, 'deliveries now on target in BOTH columns == deliveries.to_move',
         (select count(*)::text from public.subscription_deliveries d, _p p
           where d.slot = p.target and d.scheduled_time_slot = p.target
             and d.delivery_date >= p.move_from
             and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered'))
         || ' vs ' || (select n::text from _before where k = 'deliveries.to_move'),
         (select count(*) from public.subscription_deliveries d, _p p
           where d.slot = p.target and d.scheduled_time_slot = p.target
             and d.delivery_date >= p.move_from
             and coalesce(d.status,'') not in ('cancelled','canceled','skipped','delivered'))
         = (select n from _before where k = 'deliveries.to_move')
  union all
  select 6, 'live subs now on target (time_slot) == subs.to_move',
         (select count(*)::text from public.subscriptions s, _p p
           where s.time_slot = p.target
             and coalesce(s.status,'') in ('active','pending_confirmation','paused'))
         || ' vs ' || (select n::text from _before where k = 'subs.to_move'),
         (select count(*) from public.subscriptions s, _p p
           where s.time_slot = p.target
             and coalesce(s.status,'') in ('active','pending_confirmation','paused'))
         = (select n from _before where k = 'subs.to_move')

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
             and d.delivery_date <= p.carve_through)
         || ' vs ' || (select n::text from _before where k = 'deliveries.carveout'),
         (select count(*) from public.subscription_deliveries d, _p p
           where (d.slot = any(p.legacy) or d.scheduled_time_slot = any(p.legacy))
             and d.delivery_date <= p.carve_through)
         = (select n from _before where k = 'deliveries.carveout')

  union all
  select 9, 'deliveries with the two slot columns disagreeing (live, future)',
         count(*)::text, count(*) = 0
    from public.subscription_deliveries d, _p p
   where d.delivery_date >= p.move_from
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
