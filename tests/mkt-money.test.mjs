// /mkt/money — invariants that pin the rules the brief named:
//
//   1. cash_upi is a SPLIT settlement and must not be counted as
//      either cash alone or upi alone. It gets its OWN bucket.
//   2. Cancellations are filtered by status, NOT by cancelled_at
//      (0 writes of 1207 orders in prod — the column is dead).
//   3. Money accumulates in PAISE through the fold.
//   4. Days + weeks bucket in IST, so a 00:30 IST order does not
//      slide into the previous UTC day.
//   5. target_paise null → UI shows "Set your weekly target".
//   6. /api/mkt/money + /api/mkt/money/target are admin-gated.
//   7. Orders fetch paginates in 1000-row .range() pages (PostgREST
//      silently truncates no-limit SELECTs at 1000).

import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel) =>
  read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const mod = await import("../src/lib/mkt-money.ts");

// ── 1. cash_upi exclusion ──────────────────────────────────────────

test("cash_upi is its own bucket — never counted as cash or upi", () => {
  const rows = [
    row({ cod_settled_method: "cash" }),
    row({ cod_settled_method: "cash" }),
    row({ cod_settled_method: "upi" }),
    row({ cod_settled_method: "cash_upi" }),
    row({ cod_settled_method: "cash_upi" }),
    row({ cod_settled_method: null }),
  ];
  const s = mod.splitByPaymentMethod(rows);
  assert.equal(s.cash, 2, "cash bucket is cash-only rows");
  assert.equal(s.upi, 1, "upi bucket is upi-only rows");
  assert.equal(s.split, 2, "cash_upi carries its OWN bucket");
  assert.equal(s.unrecorded, 1);
  // The whole point: the split count must not be folded into either
  // atomic bucket.
  assert.notEqual(s.cash, 4);
  assert.notEqual(s.upi, 3);
});

// ── 2. isCancelled filter (NOT cancelled_at) ───────────────────────

test("isCancelled reads status, not cancelled_at", () => {
  // The dead-column trap — a status 'cancelled' row with null
  // cancelled_at must still be excluded. (Prod: 0 of 1207 writes.)
  assert.equal(mod.isCancelled("cancelled"), true);
  assert.equal(mod.isCancelled("Cancelled"), true);
  assert.equal(mod.isCancelled("delivered"), false);
  assert.equal(mod.isCancelled(null), false);
  assert.equal(mod.isCancelled(""), false);
});

test("buildDayBuckets drops cancelled rows", () => {
  const today = new Date("2026-11-18T12:00:00Z");
  const rows = [
    row({ created_at: "2026-11-18T06:00:00Z", total_amount: 500, status: "delivered" }),
    row({ created_at: "2026-11-18T06:30:00Z", total_amount: 999, status: "cancelled" }),
  ];
  const days = mod.buildDayBuckets(rows, 1, today);
  assert.equal(days.length, 1);
  assert.equal(days[0].paise, 50_000, "cancelled row excluded; 500₹ → 50000 paise");
  assert.equal(days[0].orders, 1);
});

test("computeLifetimeRepeat drops cancelled rows", () => {
  const rows = [
    row({ customer_id: "c1", created_at: "2026-10-01T06:00:00Z" }),
    row({ customer_id: "c1", created_at: "2026-11-01T06:00:00Z" }),
    // c2 has only a cancelled second — not a repeater.
    row({ customer_id: "c2", created_at: "2026-10-01T06:00:00Z" }),
    row({ customer_id: "c2", created_at: "2026-11-01T06:00:00Z", status: "cancelled" }),
  ];
  const r = mod.computeLifetimeRepeat(rows);
  assert.equal(r.ever_ordered, 2, "c1 and c2 each have >=1 non-cancelled order");
  assert.equal(r.repeat_customers, 1, "only c1 has >=2 non-cancelled orders");
  assert.equal(r.repeat_pct, 50);
});

// ── 3. Paise arithmetic ────────────────────────────────────────────

test("money is accumulated in paise — fractional rupees land cleanly", () => {
  // The delivery-fee case: total_amount = 123.45 should land as
  // 12345 paise, not drift via a float-rupee accumulator.
  const today = new Date("2026-11-18T12:00:00Z");
  const rows = [
    row({ created_at: "2026-11-18T06:00:00Z", total_amount: 123.45 }),
    row({ created_at: "2026-11-18T07:00:00Z", total_amount: 100 }),
    row({ created_at: "2026-11-18T08:00:00Z", total_amount: 0.01 }),
  ];
  const days = mod.buildDayBuckets(rows, 1, today);
  assert.equal(days[0].paise, 12345 + 10000 + 1);
});

test("buildWeekBuckets accumulates in paise, not rupees", () => {
  const today = new Date("2026-11-18T12:00:00Z"); // Wed → week of Mon 2026-11-16 (IST)
  const rows = [
    row({ created_at: "2026-11-16T06:00:00Z", total_amount: 49.50 }),
    row({ created_at: "2026-11-17T06:00:00Z", total_amount: 49.50 }),
    row({ created_at: "2026-11-18T06:00:00Z", total_amount: 0.33 }),
  ];
  const weeks = mod.buildWeekBuckets(rows, 1, today);
  assert.equal(weeks[0].paise, 4950 + 4950 + 33);
});

test("computeJar accumulates in paise", () => {
  const today = new Date("2026-11-18T12:00:00Z");
  const rows = [
    row({ created_at: "2026-11-16T06:00:00Z", total_amount: 100.25 }),
    row({ created_at: "2026-11-17T06:00:00Z", total_amount: 100 }),
  ];
  const jar = mod.computeJar(rows, 50_000_00, today); // 50,000 ₹
  assert.equal(jar.current_week_paise, 10025 + 10000);
  assert.equal(jar.target_paise, 5_000_000);
  // 20025 / 5_000_000 → 0.4%, rounds to 0% — still a non-negative int.
  assert.ok(Number.isInteger(jar.pct_of_target));
});

// ── 4. IST bucketing ───────────────────────────────────────────────

test("istDayKey buckets a 00:30 IST order into the IST day, not the UTC day", () => {
  // 00:30 IST on 2026-11-18 == 19:00 UTC on 2026-11-17.
  // The naive UTC-slice path groups this into 2026-11-17. We don't.
  const iso = "2026-11-17T19:00:00Z";
  assert.equal(mod.istDayKey(iso), "2026-11-18");
});

test("istWeekKey rolls back to Monday in IST", () => {
  // Sunday 2026-11-22 IST → Monday 2026-11-16 IST.
  assert.equal(mod.istWeekKey("2026-11-22T06:00:00Z"), "2026-11-16");
  // Monday itself → itself.
  assert.equal(mod.istWeekKey("2026-11-16T06:00:00Z"), "2026-11-16");
  // Sunday 23:00 IST = Sunday 17:30 UTC → still that Monday.
  assert.equal(mod.istWeekKey("2026-11-22T17:30:00Z"), "2026-11-16");
  // Monday 00:30 IST = Sunday 19:00 UTC → that IST day IS the Monday
  // itself, not the previous week (the UTC-naive path would bucket
  // this into the previous Sunday and roll back to Mon 2026-11-09).
  assert.equal(mod.istWeekKey("2026-11-15T19:00:00Z"), "2026-11-16");
});

test("buildDayBuckets fills every day in the window, even zero-order days", () => {
  const today = new Date("2026-11-18T12:00:00Z");
  const rows = [
    row({ created_at: "2026-11-18T06:00:00Z", total_amount: 100 }),
  ];
  const days = mod.buildDayBuckets(rows, 7, today);
  assert.equal(days.length, 7, "every day in the window renders as its own bar");
  const totalOrders = days.reduce((a, d) => a + d.orders, 0);
  assert.equal(totalOrders, 1);
  // The last bucket is today (IST).
  assert.equal(days[days.length - 1].key, "2026-11-18");
});

// ── 5. target-not-set UI ───────────────────────────────────────────

test("computeJar carries target_paise=null when nothing is configured", () => {
  const today = new Date("2026-11-18T12:00:00Z");
  const jar = mod.computeJar([], null, today);
  assert.equal(jar.target_paise, null);
  assert.equal(jar.pct_of_target, 0);
});

test("MoneyClient renders the 'Set your weekly target' empty state", () => {
  const src = read("src/app/mkt/money/MoneyClient.tsx");
  // Copy pin — the brief named this sentence explicitly.
  assert.match(src, /Set your weekly target/);
  // The branch is keyed on target_paise being null, not on pct === 0.
  assert.match(src, /targetRupees\s*===\s*null/);
});

// ── NEW: three metrics replace the single repeat-rate hero ─────────

test("computeReturningMetrics — returning vs new is disjoint and sums to this_week_customers", () => {
  // Fixed today so the window is deterministic.
  const today = new Date("2026-11-18T12:00:00Z");
  // Window is last 7 IST days → starts 2026-11-12 IST midnight.
  // A pre-window order marks the customer as "has ordered before".
  const rows = [
    // c1: ordered in Oct (pre-window) and this week → RETURNING
    row({ customer_id: "c1", created_at: "2026-10-05T06:00:00Z" }),
    row({ customer_id: "c1", created_at: "2026-11-17T06:00:00Z" }),
    // c2: first order this week → NEW
    row({ customer_id: "c2", created_at: "2026-11-15T06:00:00Z" }),
    // c3: ordered pre-window but NOT this week → not in this_week_customers
    row({ customer_id: "c3", created_at: "2026-10-01T06:00:00Z" }),
    // c4: pre-window order was cancelled; this week's order is their
    //     FIRST non-cancelled → NEW, not returning.
    row({ customer_id: "c4", created_at: "2026-10-01T06:00:00Z", status: "cancelled" }),
    row({ customer_id: "c4", created_at: "2026-11-16T06:00:00Z" }),
  ];
  const r = mod.computeReturningMetrics(rows, 7, today);
  assert.equal(r.this_week_customers, 3, "c1, c2, c4 ordered this week (c3 did not)");
  assert.equal(r.returning_count, 1, "only c1 had an earlier non-cancelled order");
  assert.equal(r.new_count, 2, "c2 and c4 (c4's earlier order was cancelled)");
  // Returning + new = this_week_customers, by construction.
  assert.equal(r.returning_count + r.new_count, r.this_week_customers);
});

test("computeLifetimeRepeat — denominator is customers with >=1 non-cancelled order ever", () => {
  const rows = [
    row({ customer_id: "c1", created_at: "2026-10-01T06:00:00Z" }),
    row({ customer_id: "c1", created_at: "2026-11-01T06:00:00Z" }),
    row({ customer_id: "c2", created_at: "2026-11-01T06:00:00Z" }),
    // c3's only order was cancelled — must not join the denominator.
    row({ customer_id: "c3", created_at: "2026-11-01T06:00:00Z", status: "cancelled" }),
  ];
  const r = mod.computeLifetimeRepeat(rows);
  assert.equal(r.ever_ordered, 2);
  assert.equal(r.repeat_customers, 1);
  assert.equal(r.repeat_pct, 50);
});

test("computeSegmentCounts — never_ordered excludes subscribers, lapsed requires a last_order_at", () => {
  const today = new Date("2026-11-18T12:00:00Z");
  const rows = [
    // c1 ordered last week → not lapsed.
    row({ customer_id: "c1", created_at: "2026-11-15T06:00:00Z" }),
    // c2 ordered 30 days ago → lapsed.
    row({ customer_id: "c2", created_at: "2026-10-19T06:00:00Z" }),
    // c3's only order was cancelled → counts as never_ordered.
    row({ customer_id: "c3", created_at: "2026-11-01T06:00:00Z", status: "cancelled" }),
  ];
  // Four customer IDs total — c4 has NO orders at all.
  const customerIds = ["c1", "c2", "c3", "c4"];
  // c3 holds a subscription → disqualifies never_ordered.
  const subscribers = new Set(["c3"]);
  const s = mod.computeSegmentCounts(customerIds, rows, subscribers, today);
  assert.equal(s.never_ordered, 1, "only c4 (c3 has a subscription)");
  assert.equal(s.lapsed_over_21d, 1, "only c2's last order is > 21 days old");
});

test("windowStartIso — last 7 IST days ending today is 6 IST-midnights ago", () => {
  // today @ 12:00 UTC on 2026-11-18 is 17:30 IST — well inside the
  // IST day 2026-11-18. The window starts at IST-midnight of
  // 2026-11-12, which is 2026-11-11T18:30:00Z.
  const start = mod.windowStartIso(7, new Date("2026-11-18T12:00:00Z"));
  assert.equal(start, "2026-11-11T18:30:00.000Z");
});

test("MoneyClient renders the three labelled metric tiles + the two segment chips", () => {
  const src = read("src/app/mkt/money/MoneyClient.tsx");
  // Labels — pinning the copy means nobody has to guess the window.
  assert.match(src, /RETURNING THIS WEEK/);
  assert.match(src, /LIFETIME REPEAT/);
  assert.match(src, /NEW THIS WEEK/);
  // Segment chips link into /mkt with the right ?segment= value.
  assert.match(src, /\/mkt\?segment=never_ordered/);
  assert.match(src, /\/mkt\?segment=lapsed/);
});

// ── 6. Admin-only gates ────────────────────────────────────────────

test("/api/mkt/money gates to admin+active, 401/403 otherwise", () => {
  const src = code("src/app/api/mkt/money/route.ts");
  assert.match(src, /role\s*!==\s*"admin"/);
  assert.match(src, /status\s*!==\s*"active"/);
  assert.match(src, /status:\s*401/);
  assert.match(src, /status:\s*403/);
});

test("/api/mkt/money/target gates to admin on GET AND PATCH", () => {
  const src = code("src/app/api/mkt/money/target/route.ts");
  // Both handlers call the same gate.
  const get = src.slice(src.indexOf("export async function GET"), src.indexOf("export async function PATCH"));
  const patch = src.slice(src.indexOf("export async function PATCH"));
  assert.match(get, /requireAdmin/);
  assert.match(patch, /requireAdmin/);
  // PATCH refuses zero / negative / non-integer paise.
  assert.match(patch, /raw\s*<=\s*0/);
  assert.match(patch, /Number\.isInteger/);
});

test("/mkt/money page is admin-gated on the server", () => {
  const src = code("src/app/mkt/money/page.tsx");
  assert.match(src, /requireMktSession\(\s*\{\s*requireAdmin:\s*true\s*\}\s*\)/);
});

// ── 7. PostgREST pagination ────────────────────────────────────────

test("/api/mkt/money paginates orders in 1000-row .range() pages", () => {
  const src = code("src/app/api/mkt/money/route.ts");
  // The constant + the range call + the stop-on-short-page break.
  // The shared paginator keeps the window-size name consistent
  // across orders / customers / subscriptions.
  assert.match(src, /PAGE\s*=\s*1000/);
  assert.match(src, /\.range\(\s*from\s*,\s*from\s*\+\s*size\s*-\s*1\s*\)/);
  assert.match(src, /if\s*\(\s*page\.length\s*<\s*pageSize\s*\)\s*break/);
});

test("/api/mkt/money paginates customers + subscriptions too", () => {
  // never_ordered needs the FULL customer table and the FULL
  // subscription-holder set — same 1000-row PostgREST hazard. Pin
  // that both fetches go through the shared paginator.
  const src = code("src/app/api/mkt/money/route.ts");
  assert.match(src, /paginateAll[\s\S]*?\.from\("customers"\)/);
  assert.match(src, /paginateAll[\s\S]*?\.from\("subscriptions"\)/);
});

test("MoneyClient hits /api/mkt/money through mktFetch (bounded timeout)", () => {
  const src = read("src/app/mkt/money/MoneyClient.tsx");
  assert.match(src, /mktFetch<MoneyResponse>\(\s*"\/api\/mkt\/money"/);
  // Target writes also go through the timeout-bounded helper.
  assert.match(src, /mktPatch\(\s*"\/api\/mkt\/money\/target"/);
});

// ── Source split: null → "manual", web+app → online ────────────────

test("splitBySource groups web+app as online, offline alone, null as manual", () => {
  const rows = [
    row({ source: "web" }),
    row({ source: "web" }),
    row({ source: "app" }),
    row({ source: "offline" }),
    row({ source: null }),
    row({ source: "weird_future_value" }),
  ];
  const s = mod.splitBySource(rows);
  assert.equal(s.online, 3, "web + app");
  assert.equal(s.offline, 1);
  assert.equal(s.manual, 2, "null + unknown land in manual");
});

// ── Test helper ────────────────────────────────────────────────────

function row(overrides) {
  return {
    customer_id: "c-default",
    total_amount: 100,
    created_at: "2026-11-18T06:00:00Z",
    status: "delivered",
    cod_settled_method: null,
    source: "web",
    ...overrides,
  };
}
