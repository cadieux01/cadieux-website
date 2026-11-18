-- =============================================================================
-- DB cleanup — redundant notifications policies + RLS on zz_* backup tables
-- =============================================================================
-- NOT YET APPLIED. Written for review. Applied by Claude via the Supabase
-- MCP after a human has read it. Every statement is idempotent.
--
-- TWO disjoint changes, batched into one migration because neither is big
-- enough to earn its own ledger row:
--
--   A. logistics.notifications — drop the two REDUNDANT policies left over
--      from before the new pair landed. A safety guard refuses the drop
--      unless the replacement pair is visible, so this migration cannot
--      lock every authenticated user out of their own notifications even
--      if run against a database where the 20261118165900 migration never
--      applied.
--
--   B. public.zz_*_20261017..20261106 — ten backup tables that currently
--      sit in the public schema with RLS DISABLED and so are readable by
--      anyone with the anon key. They hold real order + subscription +
--      product data (names say what date each one was snapshotted). This
--      migration enables RLS on every one of them with NO policies — same
--      as a "deny all" posture for anon and authenticated. The service
--      role (used by every admin route in this repo) bypasses RLS and
--      keeps working. Backups are useful; publicly-readable backups are a
--      data leak the shape of the whole bucket.
--
-- PRE-APPLY GREP in this repo (2026-11-18), with a positive control:
--   positive control  → `grep image_url src` → matches
--     src/app/shop/page.tsx:85 (so grep CAN match)
--   each of the 10 zz_* names in src/, tests/, scripts/, supabase/
--     → ZERO matches
--   therefore no application code reads these tables; enabling RLS with
--   no policies is safe.
-- =============================================================================


-- ============================================================================
-- A. drop the redundant notifications policies
-- ============================================================================
--
-- Pre-existing pair: notif_select_own, notif_update_own
-- Replacement pair (added by 20261118165900_mkt_team_tasks_goals):
--   notifications_select_own, notifications_mark_read
--
-- The pairs OR-combined in the policy evaluator, so the pre-existing ones
-- have widened nothing — they just sit next to the new ones. Dropping
-- them removes the ambiguity: a future author tightening one should know
-- which one is the source of truth.
--
-- SAFETY GUARD: this block refuses to drop the legacy pair unless the
-- new pair is actually present in pg_policies. Dropping both pairs would
-- leave authenticated callers with NO SELECT on their own notifications
-- and no UPDATE to mark them read, which is a visible break.
do $$
declare
  have_select boolean;
  have_mark boolean;
begin
  select exists (
    select 1 from pg_policies
     where schemaname = 'logistics'
       and tablename  = 'notifications'
       and policyname = 'notifications_select_own'
  ) into have_select;

  select exists (
    select 1 from pg_policies
     where schemaname = 'logistics'
       and tablename  = 'notifications'
       and policyname = 'notifications_mark_read'
  ) into have_mark;

  if not have_select or not have_mark then
    raise exception using
      errcode = '55000',  -- object_not_in_prerequisite_state
      message = format(
        'refusing to drop legacy notifications policies: replacement pair missing (select=%s, mark=%s). Apply 20261118165900_mkt_team_tasks_goals first.',
        have_select, have_mark
      );
  end if;
end$$;

drop policy if exists notif_select_own on logistics.notifications;
drop policy if exists notif_update_own on logistics.notifications;


-- ============================================================================
-- B. enable RLS (no policies) on ten public.zz_* backup tables
-- ============================================================================
--
-- `alter table ... enable row level security` is idempotent — running it
-- again on an already-RLS'd table is a no-op. No policies are added, so
-- the authenticated and anon roles can SELECT no rows. Service role
-- bypasses RLS and keeps working.
--
-- Per-statement so an absent table (a backup that was deleted after we
-- wrote this file) cannot abort the rest. Wrapped in a DO block that
-- catches the undefined_table error and emits NOTICE, matching the
-- "every statement is idempotent" convention at the top of this file.

do $$
declare
  t text;
  tables text[] := array[
    'zz_orders_total_fee_backup_20261017',
    'zz_subs_slot_move_20261017',
    'zz_subs_template_slots_20261017',
    'zz_orders_slot_move_20261020',
    'zz_products_price_20261021',
    'zz_orders_cyclone_20261027',
    'zz_subscription_deliveries_cyclone_20261027',
    'zz_products_available_from_cyclone_20261027',
    'zz_orders_moveto28_20261027',
    'zz_products_available_from_20261106'
  ];
begin
  foreach t in array tables loop
    begin
      execute format(
        'alter table public.%I enable row level security',
        t
      );
      raise notice '[zz-rls] enabled RLS on public.%', t;
    exception
      when undefined_table then
        raise notice '[zz-rls] skipped missing table public.%', t;
    end;
  end loop;
end$$;
