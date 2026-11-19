// READ-ONLY: which column honestly carries "when was this cancelled?"
//
// Narrow the question to the 48 orders of the tried-cancelled cohort
// (each customer's LATEST cancelled order) and count coverage of each
// candidate column. Also check the full universe of 130 cancelled
// orders so the choice is not biased by the 48.

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

const PAGE = 1000;

// 1. Sample columns on one cancelled row.
const { data: sample } = await sb
  .from("orders")
  .select("*")
  .eq("status", "cancelled")
  .limit(1);
const cols = sample?.[0] ? Object.keys(sample[0]) : [];
const candidates = cols.filter((c) => /cancel|status|paid|refund|updated|picked/.test(c));
console.log("candidate timestamp-ish columns on orders:");
for (const c of candidates) console.log("  -", c);

// 2. Across ALL cancelled orders — coverage of each.
async function paginate(table, selectCols, filter = null) {
  const out = [];
  let from = 0;
  for (;;) {
    let q = sb.from(table).select(selectCols).range(from, from + PAGE - 1);
    if (filter) q = filter(q);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const allCancelled = await paginate(
  "orders",
  "id, customer_id, status, status_updated_at, cancelled_at, cancellation_reason, created_at",
  (q) => q.eq("status", "cancelled"),
);
console.log("\nALL cancelled orders:", allCancelled.length);
function count(key) {
  return allCancelled.filter((r) => r[key] != null).length;
}
for (const k of ["status_updated_at", "cancelled_at", "cancellation_reason", "created_at"]) {
  console.log(`  ${k.padEnd(22)} non-null: ${count(k)}`);
}

// 3. Narrow to the 48 cohort: customers with 0 non-cancelled orders +
//    no subscription + >=1 cancelled order. For each, find THEIR
//    LATEST cancelled order and check which columns carry a value.
const orders = await paginate("orders", "id, customer_id, status, status_updated_at, cancelled_at, created_at");
const subs = await paginate("subscriptions", "customer_id");
const subscribers = new Set();
for (const s of subs) if (s.customer_id) subscribers.add(s.customer_id);

const nonCancelledCount = new Map();
const cancelledOrders = new Map();
for (const o of orders) {
  if (!o.customer_id) continue;
  const isCancel = (o.status ?? "").toLowerCase() === "cancelled";
  if (isCancel) {
    const list = cancelledOrders.get(o.customer_id) ?? [];
    list.push(o);
    cancelledOrders.set(o.customer_id, list);
  } else {
    nonCancelledCount.set(o.customer_id, (nonCancelledCount.get(o.customer_id) ?? 0) + 1);
  }
}

const cohort = []; // the latest cancelled order per cohort customer
for (const [cid, list] of cancelledOrders) {
  if (subscribers.has(cid)) continue;
  if ((nonCancelledCount.get(cid) ?? 0) !== 0) continue;
  list.sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  cohort.push(list[0]);
}
console.log("\nCohort (latest cancelled order per tried-cancelled customer):", cohort.length);
for (const k of ["status_updated_at", "cancelled_at", "created_at"]) {
  const n = cohort.filter((r) => r[k] != null).length;
  console.log(`  ${k.padEnd(22)} non-null on the ${cohort.length}: ${n}`);
}

// 4. Sanity: do status_updated_at and created_at ever disagree? That
//    is what makes status_updated_at a better signal than created_at.
let same = 0;
let diff = 0;
for (const r of cohort) {
  if (!r.status_updated_at) continue;
  if (r.status_updated_at === r.created_at) same += 1;
  else diff += 1;
}
console.log(`\nof the ${cohort.length}: status_updated_at === created_at: ${same}, differs: ${diff}`);
