-- Move midday (10:00-14:00) bookings to the evening slot (16:00-21:00).
--
-- NOT A MIGRATION. Do not move this under supabase/migrations/. This is a
-- one-off data move, run by hand, AFTER Raja has messaged the customers and
-- BEFORE the code that makes midday unbookable is pushed. If midday becomes
-- unbookable while rows still sit on it, those customers are parked on a slot
-- the system refuses.
--
-- CARVE-OUT: nothing dated 2026-10-06 is touched. Those deliver as promised
-- and age out on their own.
--
-- HELD BACK BY HAND: OLF469. Dated 2026-10-07, status out_for_delivery, but
-- status_updated_at is 2026-10-03 -- the status is stale, so the row does not
-- say what is actually happening to that order. Ruled out of the bulk move for
-- a human to look at. It is excluded from BOTH the counts and the update, and
-- the post-move check below reports it separately instead of expecting 0.
--
-- ---------------------------------------------------------------------------
-- THREE CORRECTIONS vs the drafted statements
-- ---------------------------------------------------------------------------
-- 1. `orders` has NO `updated_at` column. `set ... updated_at = now()` fails
--    with "column updated_at of relation orders does not exist" and the whole
--    statement rolls back. The column that exists is `status_updated_at`, and
--    this is not a status change, so it is left alone.
--
-- 2. `subscription_deliveries` needs BOTH slot columns set, not `slot` alone.
--    The two are read with OPPOSITE precedence:
--      - bake plan / print sheet  src/lib/bake-plan-lines.ts:365
--          slot: d.slot || d.scheduled_time_slot      -> `slot` wins
--      - admin board              src/lib/admin-subscription-derive.ts:106
--          slot: row.scheduled_time_slot ?? row.slot  -> `scheduled_time_slot` wins
--      - customer tracking page   src/app/subscriptions/track/page.tsx:328
--        and                      src/app/subscriptions/track/[deliveryId]/page.tsx:213
--          reads scheduled_time_slot ONLY, no fallback
--      - admin edit modal         src/components/admin/EditDeliveryModal.tsx:72
--          delivery.scheduled_time_slot ?? delivery.slot
--    Setting `slot` alone would print evening on the bake sheet while the
--    customer's own tracking page and the admin board still said 10:00-14:00.
--    All 40 in-scope rows are in that state. The app already treats this as a
--    known hazard and writes every slot column on every edit --
--    src/app/api/mobile/subscriptions/[id]/deliveries/[deliveryId]/edit/route.ts:276-292
--      "Write every column that names the date or the slot on this row...
--       prod proof is OLS36 seq 2 (slot 16:00-21:00, scheduled_time_slot 06:00-10:00)."
--    That exact drifted row is still in prod (2026-09-23).
--
-- 3. `subscription_deliveries` has NO audit trigger. `orders` has
--    trg_audit_orders -> capture_public_audit, so the 12 order updates are
--    captured automatically. The 40 subscription rows would be untraceable, so
--    this appends an admin_notes line the way the edit routes do.
-- ---------------------------------------------------------------------------


-- ===========================================================================
-- DRY RUN -- counts only, changes nothing. Safe to run as-is.
-- ===========================================================================
begin;

select 'orders to move' as bucket, count(*) as rows
from public.orders
where delivery_slot = '10:00-14:00'
  and delivery_date >= date '2026-10-07'
  and coalesce(status,'') not in ('cancelled','canceled','delivered')
  and order_number <> 'OLF469'
union all
select 'orders HELD BACK by hand (OLF469)', count(*)
from public.orders
where delivery_slot = '10:00-14:00'
  and delivery_date >= date '2026-10-07'
  and coalesce(status,'') not in ('cancelled','canceled','delivered')
  and order_number = 'OLF469'
union all
select 'subscription_deliveries to move', count(*)
from public.subscription_deliveries
where coalesce(slot, scheduled_time_slot) = '10:00-14:00'
  and delivery_date >= date '2026-10-07'
  and coalesce(status,'') not in ('cancelled','canceled','skipped','delivered');

rollback;


-- ===========================================================================
-- THE MOVE -- run only after step 3 (customers messaged).
-- Wrapped in a transaction so the two tables move together or not at all.
-- ===========================================================================
begin;

-- one-off orders, 7 Oct onward.
-- No updated_at column; trg_audit_orders records before/after automatically.
-- OLF469 is excluded deliberately -- see HELD BACK BY HAND in the header.
update public.orders
   set delivery_slot = '16:00-21:00'
 where delivery_slot = '10:00-14:00'
   and delivery_date >= date '2026-10-07'
   and coalesce(status,'') not in ('cancelled','canceled','delivered')
   and order_number <> 'OLF469';

-- subscription deliveries, 7 Oct onward.
-- Both slot columns, because the board and the print sheet disagree on which
-- one wins. admin_notes carries the trace this table has no trigger for.
update public.subscription_deliveries
   set slot                = '16:00-21:00',
       scheduled_time_slot = '16:00-21:00',
       status_updated_at   = now(),
       admin_notes         = case
                               when admin_notes is null or admin_notes = ''
                                 then 'Slot moved 10:00-14:00 -> 16:00-21:00 (evening-only rollout)'
                               else admin_notes || E'\n' ||
                                    'Slot moved 10:00-14:00 -> 16:00-21:00 (evening-only rollout)'
                             end
 where coalesce(slot, scheduled_time_slot) = '10:00-14:00'
   and delivery_date >= date '2026-10-07'
   and coalesce(status,'') not in ('cancelled','canceled','skipped','delivered');

-- Verify before committing. The first two must read 0; the third must read 1,
-- because OLF469 is held back on purpose. A 0 on the third line means the
-- exclusion did not match and the row was moved anyway -- roll back.
select 'orders left on midday (7 Oct+, excl OLF469)' as check, count(*) as rows
from public.orders
where delivery_slot = '10:00-14:00'
  and delivery_date >= date '2026-10-07'
  and coalesce(status,'') not in ('cancelled','canceled','delivered')
  and order_number <> 'OLF469'
union all
select 'OLF469 still on midday (must be 1)', count(*)
from public.orders
where delivery_slot = '10:00-14:00'
  and delivery_date >= date '2026-10-07'
  and coalesce(status,'') not in ('cancelled','canceled','delivered')
  and order_number = 'OLF469'
union all
select 'sub_deliveries left on midday (7 Oct+)', count(*)
from public.subscription_deliveries
where coalesce(slot, scheduled_time_slot) = '10:00-14:00'
  and delivery_date >= date '2026-10-07'
  and coalesce(status,'') not in ('cancelled','canceled','skipped','delivered');

-- commit;    -- uncomment once the two checks above read 0
rollback;
