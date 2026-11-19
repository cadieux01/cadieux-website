// READ-ONLY audit for the three "did they come back?" metrics the
// new /mkt/money brief named, plus the two CRM segment counts the
// screen links through to. No writes, no PII.
//
// Three numbers, all status <> 'cancelled', all IST-bucketed:
//   A. RETURNING THIS WEEK — of customers who ordered in the last 7
//      IST days, the share who had ANY earlier non-cancelled order.
//   B. LIFETIME REPEAT — customers with >=2 orders ever /
//      customers with >=1 order ever.
//   C. NEW THIS WEEK — among this-week customers, those whose FIRST
//      ever non-cancelled order fell in the window.
//
// Plus:
//   • never_ordered — customers with 0 orders AND no subscription
//     (that is the chip's definition in src/lib/mkt-crm.ts; a
//     plan-holder with no ad-hoc orders is not a stranger).
//   • lapsed >21d — customers whose most recent order is >21 days
//     old. Must carry a last_order_at (never_ordered is disjoint).

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const envPath = path.join(process.cwd(), ".env.local");
for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
  const m = /^([A-Z0-9_]+)=(.*)$/.exec(line);
  if (m) process.env[m[1]] ??= m[2].replace(/^"(.*)"$/, "$1");
}

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// ── IST window helpers ─────────────────────────────────────────────

const IST_OFFSET_MS = 5.5 * 3600 * 1000;
const now = new Date();
// IST midnight today — the START of the IST day "today" belongs to.
const istMidnight = new Date(
  Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000) * 86_400_000 -
    IST_OFFSET_MS,
);
// "Last 7 IST days ending today (inclusive)" = window starts
// exactly 6 days before today's IST midnight, so today IS day 7.
const weekStartIst = new Date(istMidnight.getTime() - 6 * 86_400_000);

console.log("now UTC:", now.toISOString());
console.log("IST midnight today:", istMidnight.toISOString());
console.log("last-7-days window starts:", weekStartIst.toISOString(), "(inclusive)");

// ── Fetch all orders, paginated ────────────────────────────────────

const PAGE = 1000;
let from = 0;
const orders = [];
for (;;) {
  const { data, error } = await sb
    .from("orders")
    .select("id, customer_id, status, created_at")
    .order("created_at", { ascending: true })
    .range(from, from + PAGE - 1);
  if (error) {
    console.error("orders fetch failed:", error.message);
    process.exit(1);
  }
  const rows = data ?? [];
  orders.push(...rows);
  if (rows.length < PAGE) break;
  from += PAGE;
}
console.log("\norders fetched:", orders.length);
const nonCancelled = orders.filter(
  (o) => (o.status ?? "").toLowerCase() !== "cancelled" && o.customer_id,
);
console.log("non-cancelled with customer_id:", nonCancelled.length);
const cancelledDropped = orders.length - nonCancelled.length;
console.log("dropped (cancelled or null customer):", cancelledDropped);

// ── Build per-customer order histories ─────────────────────────────

const histories = new Map(); // customer_id -> [ISO strings], ascending
for (const o of nonCancelled) {
  const list = histories.get(o.customer_id) ?? [];
  list.push(o.created_at);
  histories.set(o.customer_id, list);
}

// Week-window predicate
const weekStart = weekStartIst.toISOString();
const inWindow = (iso) => iso >= weekStart;

// ── A. RETURNING THIS WEEK ─────────────────────────────────────────

const thisWeekCustomers = [];
let returning = 0;
let newThisWeek = 0;
for (const [cid, times] of histories) {
  const thisWeekOrders = times.filter(inWindow);
  if (thisWeekOrders.length === 0) continue;
  thisWeekCustomers.push(cid);
  // "Any earlier non-cancelled order" = at least one timestamp that
  // precedes the window start.
  const earlierExists = times[0] < weekStart;
  if (earlierExists) returning += 1;
  else newThisWeek += 1;
}
const totalThisWeek = thisWeekCustomers.length;
const returningPct = totalThisWeek === 0 ? 0 : (returning / totalThisWeek) * 100;
const newPct = totalThisWeek === 0 ? 0 : (newThisWeek / totalThisWeek) * 100;

// ── B. LIFETIME REPEAT ─────────────────────────────────────────────

const everOrdered = histories.size;
let everRepeat = 0;
for (const times of histories.values()) {
  if (times.length >= 2) everRepeat += 1;
}
const lifetimeRepeatPct = everOrdered === 0 ? 0 : (everRepeat / everOrdered) * 100;

// ── Segment counts: never_ordered + lapsed >21d ────────────────────

// customers table — one row per person. The CRM page reads from
// /api/mkt/customers which lifts the public.customers table; use the
// same table here. We also need to know if a customer has an active
// subscription, because `never_ordered` requires AND no subscription.
//
// Get all customer IDs (paginated), then join with the order
// histories we already built and a subscription-holder set.

async function paginateAll(table, selectCols) {
  const out = [];
  let f = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(selectCols)
      .range(f, f + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    f += PAGE;
  }
  return out;
}

const customers = await paginateAll("customers", "id");
console.log("\ncustomers (people on the CRM):", customers.length);

// Subscription holders — any status that the UI considers "has a
// subscription". The CRM page's has_subscription flag today treats
// any non-null subscription row as a holder; mirror that.
let subscribers = new Set();
try {
  const subs = await paginateAll("subscriptions", "customer_id");
  for (const s of subs) if (s.customer_id) subscribers.add(s.customer_id);
} catch (e) {
  console.log("subscriptions table unreadable:", e.message);
}
console.log("customers with any subscription row:", subscribers.size);

// never_ordered = total_orders === 0 AND !has_subscription
// lapsed       = last_order_at exists AND (now - last_order_at) > 21d
const LAPSED_MS = 21 * 86_400_000;
let neverOrdered = 0;
let lapsed = 0;
for (const c of customers) {
  const times = histories.get(c.id); // undefined if zero non-cancelled orders
  if (!times || times.length === 0) {
    if (!subscribers.has(c.id)) neverOrdered += 1;
    continue;
  }
  const last = times[times.length - 1];
  const age = now.getTime() - Date.parse(last);
  if (age > LAPSED_MS) lapsed += 1;
}

// ── Report ─────────────────────────────────────────────────────────

const pct = (n) => `${n.toFixed(1)}%`;
const labels = [
  "A. RETURNING THIS WEEK (customers this week with ANY earlier non-cancelled order)",
  "B. LIFETIME REPEAT (customers with >=2 orders ever / with >=1 order ever)",
  "C. NEW THIS WEEK (first ever non-cancelled order fell in the last 7 IST days)",
];
console.log("\n" + "═".repeat(66));
console.log(labels[0]);
console.log(`   ${returning} of ${totalThisWeek} = ${pct(returningPct)}`);
console.log(labels[1]);
console.log(`   ${everRepeat} / ${everOrdered} = ${pct(lifetimeRepeatPct)}`);
console.log(labels[2]);
console.log(`   ${newThisWeek} of ${totalThisWeek} = ${pct(newPct)}`);
console.log("\n--- segment counts for the links next to the metrics ---");
console.log(`   never_ordered: ${neverOrdered}`);
console.log(`   lapsed >21d:   ${lapsed}`);
console.log("═".repeat(66));
