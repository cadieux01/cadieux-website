// READ-ONLY probe to confirm the schema this money screen depends on.
// Never prints customer PII, never writes.

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

// 1. public.app_config — the user says 7 rows, follow the convention.
const { data: cfg, error: cfgErr } = await sb.from("app_config").select("*");
console.log("\n=== public.app_config ===");
if (cfgErr) console.log("ERR:", cfgErr.message);
else {
  console.log("row count:", cfg.length);
  if (cfg[0]) console.log("columns:", Object.keys(cfg[0]));
  for (const row of cfg) {
    // Guess at which column is the key by looking at narrow string
    // columns; print each row flat.
    console.log("  " + JSON.stringify(row));
  }
}

// 2. orders — the columns the money screen needs.
const { count: oCount } = await sb
  .from("orders")
  .select("*", { count: "exact", head: true });
console.log("\n=== orders count:", oCount);

// Sample one row to see the column list (no PII — just column names
// then dropped).
const { data: sample } = await sb
  .from("orders")
  .select("*")
  .order("created_at", { ascending: false })
  .limit(1);
console.log("orders columns:", sample?.[0] ? Object.keys(sample[0]) : "none");

// 3. Distinct cod_settled_method values + counts.
const { data: methods } = await sb
  .from("orders")
  .select("cod_settled_method")
  .not("cod_settled_method", "is", null);
const methCounts = {};
for (const r of methods ?? []) {
  methCounts[r.cod_settled_method] = (methCounts[r.cod_settled_method] ?? 0) + 1;
}
console.log("\n=== cod_settled_method distribution ===");
for (const [k, v] of Object.entries(methCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// 4. Distinct source values + counts.
const { data: sources } = await sb.from("orders").select("source");
const srcCounts = {};
for (const r of sources ?? []) {
  srcCounts[r.source ?? "(null)"] = (srcCounts[r.source ?? "(null)"] ?? 0) + 1;
}
console.log("\n=== source distribution ===");
for (const [k, v] of Object.entries(srcCounts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k}: ${v}`);
}

// 5. Cancelled count both ways — status vs cancelled_at. The brief
// warns the dead column misleads.
const { count: cancStatus } = await sb
  .from("orders")
  .select("*", { count: "exact", head: true })
  .eq("status", "cancelled");
const { count: cancAt } = await sb
  .from("orders")
  .select("*", { count: "exact", head: true })
  .not("cancelled_at", "is", null);
console.log("\n=== cancellations ===");
console.log("  status='cancelled':  ", cancStatus);
console.log("  cancelled_at IS NOT NULL:", cancAt);

// 6. Last 7-day revenue and order count, in IST. IST is UTC+5:30 —
// anything from "today 00:00 IST" back 7 days.
const now = new Date();
const istOffset = 5.5 * 3600 * 1000;
const istMidnight = new Date(
  Math.floor((now.getTime() + istOffset) / 86_400_000) * 86_400_000 - istOffset,
);
const weekAgoIst = new Date(istMidnight.getTime() - 7 * 86_400_000);
const { data: recentOrders } = await sb
  .from("orders")
  .select("total_amount, status, customer_id, created_at, cod_settled_method, source, payment_status, payment_method")
  .gte("created_at", weekAgoIst.toISOString());
const notCanc = (recentOrders ?? []).filter(
  (o) => (o.status ?? "").toLowerCase() !== "cancelled",
);
const revenuePaise = notCanc.reduce(
  (s, o) => s + Math.round(Number(o.total_amount || 0) * 100),
  0,
);
const customerSet = new Set(notCanc.map((o) => o.customer_id).filter(Boolean));
const orderToCount = new Map();
for (const o of notCanc) {
  if (!o.customer_id) continue;
  orderToCount.set(o.customer_id, (orderToCount.get(o.customer_id) ?? 0) + 1);
}
const customersWithMultiple = Array.from(orderToCount.values()).filter((n) => n > 1).length;
console.log("\n=== last 7 days (IST), non-cancelled ===");
console.log("  orders:                ", notCanc.length);
console.log("  distinct customers:    ", customerSet.size);
console.log("  customers w/ 2+ orders:", customersWithMultiple);
console.log("  repeat rate:           ", customerSet.size === 0 ? "n/a" : `${((customersWithMultiple / customerSet.size) * 100).toFixed(1)}%`);
console.log("  revenue:               ", "₹" + (revenuePaise / 100).toLocaleString("en-IN"));

// UPI vs cash in that window.
const methBuckets = { cash: 0, upi: 0, cash_upi: 0, other: 0 };
for (const o of notCanc) {
  const m = o.cod_settled_method;
  if (m === "cash" || m === "upi" || m === "cash_upi") methBuckets[m] += 1;
  else if (m) methBuckets.other += 1;
}
console.log("  cod_settled_method:    ", methBuckets);

// source distribution in that window.
const sourceBuckets = {};
for (const o of notCanc) {
  sourceBuckets[o.source ?? "(null)"] = (sourceBuckets[o.source ?? "(null)"] ?? 0) + 1;
}
console.log("  source:                ", sourceBuckets);

// 7. Check if isCancelled helper exists (just confirming the name).
console.log("\n=== verdict ===");
console.log(
  cancStatus === cancAt
    ? "cancelled_at IS WRITTEN — using it would be safe (but brief says NO, use status)"
    : `MISMATCH — status says ${cancStatus} cancelled, cancelled_at says ${cancAt}. Use status.`,
);
