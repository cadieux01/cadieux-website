import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");

const MIGRATION =
  "supabase/migrations/20261118195100_db_cleanup_redundant_policies_and_zz_rls.sql";

test("migration file carries NOT YET APPLIED banner", () => {
  assert.match(read(MIGRATION).slice(0, 1500), /NOT YET APPLIED/i);
});

test("notifications legacy-drop is guarded by a replacement-policy check", () => {
  const src = read(MIGRATION);
  assert.match(src, /notifications_select_own/);
  assert.match(src, /notifications_mark_read/);
  // The guard raises with a readable message mentioning the correct
  // prior migration to apply.
  assert.match(src, /refusing to drop legacy notifications policies/);
  assert.match(src, /20261118165900_mkt_team_tasks_goals/);
});

test("legacy drop statements use IF EXISTS so a second run is a no-op", () => {
  const src = read(MIGRATION);
  assert.match(src, /drop policy if exists notif_select_own on logistics\.notifications/);
  assert.match(src, /drop policy if exists notif_update_own on logistics\.notifications/);
});

test("all 10 zz_* tables are named in the migration", () => {
  const src = read(MIGRATION);
  const want = [
    "zz_orders_total_fee_backup_20261017",
    "zz_subs_slot_move_20261017",
    "zz_subs_template_slots_20261017",
    "zz_orders_slot_move_20261020",
    "zz_products_price_20261021",
    "zz_orders_cyclone_20261027",
    "zz_subscription_deliveries_cyclone_20261027",
    "zz_products_available_from_cyclone_20261027",
    "zz_orders_moveto28_20261027",
    "zz_products_available_from_20261106",
  ];
  for (const t of want) {
    assert.ok(src.includes(t), `zz_* table missing from migration: ${t}`);
  }
});

test("zz_* RLS enable is idempotent (per-table, with missing-table skip)", () => {
  const src = read(MIGRATION);
  // The DO block catches undefined_table so a deleted backup doesn't
  // abort the loop and leave the remaining tables un-RLS'd.
  assert.match(src, /when undefined_table/);
  // Every table gets `enable row level security` via the loop, not a
  // repeated verbatim statement.
  assert.match(src, /alter table public\.%I enable row level security/);
});

test("no zz_* table is referenced by application code (Phase 1 safety)", () => {
  // Walk src/ and assert none of the 10 names appears. A positive
  // control: a benign known string IS matched by the same walk.
  const names = [
    "zz_orders_total_fee_backup_20261017",
    "zz_subs_slot_move_20261017",
    "zz_subs_template_slots_20261017",
    "zz_orders_slot_move_20261020",
    "zz_products_price_20261021",
    "zz_orders_cyclone_20261027",
    "zz_subscription_deliveries_cyclone_20261027",
    "zz_products_available_from_cyclone_20261027",
    "zz_orders_moveto28_20261027",
    "zz_products_available_from_20261106",
  ];
  let positiveControlHit = false;
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".next") continue;
        walk(full);
      } else if (/\.(tsx?|mjs|js)$/.test(entry.name)) {
        const src = fs.readFileSync(full, "utf8");
        if (src.includes("image_url")) positiveControlHit = true;
        for (const n of names) if (src.includes(n)) offenders.push(`${full}::${n}`);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  assert.ok(
    positiveControlHit,
    "positive control string 'image_url' should appear somewhere under src/",
  );
  assert.deepEqual(offenders, [], `zz_* table referenced by app code: ${offenders.join(", ")}`);
});
