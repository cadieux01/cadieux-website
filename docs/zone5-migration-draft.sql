-- DRAFT. NOT APPLIED. NOT A MIGRATION.
--
-- This file deliberately lives in docs/ and NOT in supabase/migrations/.
-- `supabase db push` walks that directory and would run anything sitting in
-- it; nothing here should run until a fifth zone actually exists. Do not move
-- this file into supabase/migrations/ as a way of "getting it ready" — moving
-- it IS scheduling it.
--
-- When the day comes, copy the body into a real migration file and remember
-- that THE FILENAME PREFIX IS NOT THE LEDGER VERSION: Supabase mints its own
-- version on apply (that drift has shown up three times in this repo). After
-- applying, run `list_migrations`, rename the file to the minted version, and
-- record the version in the migration's own header.
--
--
-- WHAT THIS WOULD DO
-- ==================
-- Widen the two zone CHECK constraints — the only two columns named *zone*
-- anywhere in schema public — from four zones to five:
--
--   public.delivery_zone_rules.zone
--   public.delivery_zone_row_overrides.zone
--
-- `orders` does NOT store a zone. Nothing does. The zone is resolved at read
-- time from the address by src/lib/delivery-zones.ts, so these two columns are
-- the complete database surface of the zone concept.
--
--
-- WHY THIS MUST NOT BE APPLIED ALONE
-- ==================================
-- Zones are a CLOSED CODE-LEVEL SET (decision: Raja, 2026-10-02 — the
-- alternative, a `delivery_zones` lookup table with FKs, was considered and
-- rejected). The authority on which zones exist is TypeScript:
--
--   ZoneKey        (src/lib/delivery-zones.ts)  — the union
--   ZONE_KEYS      (src/lib/delivery-zones.ts)  — display order
--   ZONE_LABELS    (src/lib/delivery-zones.ts)  — what the operator reads
--   NUMBERED_ZONES (src/lib/zone-rules.ts)      — what a RULE may point at,
--                                                 mirroring the CHECK below
--
-- Run this widening WITHOUT widening those four, and the result is not a
-- crash. It is a rule that INSERTS, LISTS, AND DOES NOTHING:
--
--   * the POST passes — /api/admin/zone-rules validates with isNumberedZone,
--     which is derived from NUMBERED_ZONES, so a zone5 rule is rejected at
--     the API... unless the row is written by hand/SQL, in which case:
--   * buildRuleSet() hits `if (!isNumberedZone(r.zone)) continue` and the
--     rule never enters the pincode/locality Maps, so the resolver never
--     sees it and every address it names keeps its old zone;
--   * the rule still appears in the /admin/zone-rules table, because that
--     table renders the raw API rows.
--
-- That guard is also why the widening does NOT produce the failures it might
-- look like it would. It strips zone5 BEFORE the resolver, so no resolved
-- zone is ever zone5, which means:
--
--   * ZoneBadge does NOT throw — it is never handed zone5 by the resolver,
--     and since fix/zone-hardening it falls back to the unzoned styling and
--     prints the raw key anyway;
--   * the print sheet does NOT drop a group — there is no zone5 group to
--     drop, because no row resolves to zone5;
--   * the preview counters do NOT go NaN — they are keyed on ZONE_KEYS and
--     only ever incremented with a resolved zone.
--
-- The failure mode is silence, not breakage. Since fix/zone-hardening both
-- `continue`s console.warn the skipped zone and key, so the silence is at
-- least audible in the server log — but a logged warning is not a working
-- rule. THE WIDENING AND THE CODE CHANGE SHIP TOGETHER, IN ONE CHANGE, ON
-- THE DAY A ZONE 5 EXISTS.
--
--
-- WHAT ELSE THE SAME CHANGE MUST CARRY (code, not SQL)
-- ====================================================
--   1. ZoneKey, ZONE_KEYS, ZONE_LABELS, NUMBERED_ZONES — all four, together.
--   2. ZONE_DEFS (src/lib/delivery-zones.ts) — the built-in address->zone map,
--      if zone5 is to resolve from an address rather than only from a rule.
--   3. COLOR_BY_ZONE (src/components/admin/ZoneBadge.tsx) — a real colour, so
--      zone5 does not render in the fallback (unzoned) styling forever.
--   4. Nothing in the fee path. deliveryFee.ts does not mention zones at all;
--      the fee is the distance-based two-band ladder, not a zone ladder.
--   5. Nothing treats zone4 as "the outermost" — `unzoned` is the catch-all —
--      so there is no >= comparison or else-branch to extend. Verified.
--
-- And one consequence worth stating out loud before anyone runs it: because
-- the zone is resolved at read time and never persisted, adding a zone
-- RETROACTIVELY RECLASSIFIES HISTORY. Every past order whose address matches
-- the new zone will display and group under it, including on boards and print
-- sheets for days already driven.
--
--
-- THE SQL
-- =======

begin;

alter table public.delivery_zone_rules
  drop constraint if exists delivery_zone_rules_zone_check;
alter table public.delivery_zone_rules
  add constraint delivery_zone_rules_zone_check
  check (zone in ('zone1','zone2','zone3','zone4','zone5'));

alter table public.delivery_zone_row_overrides
  drop constraint if exists delivery_zone_row_overrides_zone_check;
alter table public.delivery_zone_row_overrides
  add constraint delivery_zone_row_overrides_zone_check
  check (zone in ('zone1','zone2','zone3','zone4','zone5'));

comment on column public.delivery_zone_rules.zone is
  'One of zone1..zone5. The authoritative list is NUMBERED_ZONES in '
  'src/lib/zone-rules.ts — widen this CHECK and that array in the SAME '
  'change, or rules in the new zone insert, list and never resolve.';

comment on column public.delivery_zone_row_overrides.zone is
  'One of zone1..zone5. Same pairing rule as delivery_zone_rules.zone: '
  'buildRuleSet() drops a pin whose zone is not in NUMBERED_ZONES, and a '
  'pin that does nothing looks exactly like no pin.';

commit;

-- Post-apply checks to run before calling it done:
--   select conname, pg_get_constraintdef(oid)
--     from pg_constraint
--    where conname in ('delivery_zone_rules_zone_check',
--                      'delivery_zone_row_overrides_zone_check');
--   select zone, count(*) from public.delivery_zone_rules group by 1 order by 1;
--   select zone, count(*) from public.delivery_zone_row_overrides group by 1 order by 1;
-- The counts must be unchanged by the widening — a widened CHECK can only
-- admit more rows, never alter existing ones. If a count moved, something
-- else ran.
