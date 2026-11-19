// READ-ONLY probe: the 48-figure the user named.
//
// "Tried, cancelled" = customers with 0 non-cancelled orders AND >=1
// cancelled order AND no subscription. Disjoint from never_ordered
// (never_ordered rules this group out via total_orders===0 AND the
// NEW requirement of "never attempted an order either").
//
// Verifies three numbers:
//   no orders at all, no subs            = 422   (new never_ordered)
//   no NON-cancelled orders, no subs     = 470   (existing count)
//   only-cancelled-orders customers      = 48    (the new chip)
//
// Also pulls the cancellation signal for a few sample rows so I know
// what data is available to show per-row in the list.

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
async function paginate(table, cols) {
  const out = [];
  let from = 0;
  for (;;) {
    const { data, error } = await sb
      .from(table)
      .select(cols)
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

const orders = await paginate(
  "orders",
  "id, customer_id, status, cancellation_reason, created_at",
);
const customers = await paginate("customers", "id");
const subs = await paginate("subscriptions", "customer_id");

const subscribers = new Set();
for (const s of subs) if (s.customer_id) subscribers.add(s.customer_id);

// Per-customer counters.
const cancelledOrdersByCust = new Map();   // cancelled count
const nonCancelledByCust = new Map();      // non-cancelled count
const lastCancellationByCust = new Map();  // { at, reason }
for (const o of orders) {
  if (!o.customer_id) continue;
  const isCancel = (o.status ?? "").toLowerCase() === "cancelled";
  if (isCancel) {
    cancelledOrdersByCust.set(
      o.customer_id,
      (cancelledOrdersByCust.get(o.customer_id) ?? 0) + 1,
    );
    const prev = lastCancellationByCust.get(o.customer_id);
    if (!prev || o.created_at > prev.at) {
      lastCancellationByCust.set(o.customer_id, {
        at: o.created_at,
        reason: o.cancellation_reason,
      });
    }
  } else {
    nonCancelledByCust.set(
      o.customer_id,
      (nonCancelledByCust.get(o.customer_id) ?? 0) + 1,
    );
  }
}

let zeroAnyAndNoSubs = 0;        // "no orders at all, no subs" → 422
let zeroNonCancelledNoSubs = 0;  // "no NON-cancelled orders, no subs" → 470
let onlyCancelledNoSubs = 0;     // "only-cancelled-orders customers" → 48
for (const c of customers) {
  const isSub = subscribers.has(c.id);
  if (isSub) continue;
  const nc = nonCancelledByCust.get(c.id) ?? 0;
  const cx = cancelledOrdersByCust.get(c.id) ?? 0;
  if (nc === 0) {
    zeroNonCancelledNoSubs += 1;
    if (cx === 0) zeroAnyAndNoSubs += 1;
    else onlyCancelledNoSubs += 1;
  }
}

console.log("─".repeat(60));
console.log("customers in table :", customers.length);
console.log("subscription rows  :", subs.length);
console.log("unique subscribers :", subscribers.size);
console.log("─".repeat(60));
console.log(`no orders at all, no subs            = ${zeroAnyAndNoSubs}`);
console.log(`no NON-cancelled orders, no subs     = ${zeroNonCancelledNoSubs}`);
console.log(`only-cancelled-orders customers      = ${onlyCancelledNoSubs}`);
console.log("─".repeat(60));
console.log(
  "sum check:",
  zeroAnyAndNoSubs + onlyCancelledNoSubs,
  "==",
  zeroNonCancelledNoSubs,
  zeroAnyAndNoSubs + onlyCancelledNoSubs === zeroNonCancelledNoSubs ? "OK" : "FAIL",
);

// What cancellation signal can we show per row?
console.log("\n--- sample last-cancellation reasons (first 10 of the 48) ---");
let shown = 0;
for (const c of customers) {
  if (shown >= 10) break;
  if (subscribers.has(c.id)) continue;
  if ((nonCancelledByCust.get(c.id) ?? 0) !== 0) continue;
  if ((cancelledOrdersByCust.get(c.id) ?? 0) === 0) continue;
  const lc = lastCancellationByCust.get(c.id);
  shown += 1;
  console.log(
    `  cust=${c.id.slice(0, 8)}…  at=${lc?.at ?? "?"}  reason=${JSON.stringify(lc?.reason ?? null)}`,
  );
}

// How many of the 48 carry a non-null reason?
let withReason = 0;
let withoutReason = 0;
for (const [cid, lc] of lastCancellationByCust) {
  if (subscribers.has(cid)) continue;
  if ((nonCancelledByCust.get(cid) ?? 0) !== 0) continue;
  if ((lc?.reason ?? "").trim()) withReason += 1;
  else withoutReason += 1;
}
console.log(
  `\nof the ${onlyCancelledNoSubs}: with cancellation_reason = ${withReason}, blank = ${withoutReason}`,
);
