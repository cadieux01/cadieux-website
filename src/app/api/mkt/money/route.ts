// GET /api/mkt/money — the aggregated numbers behind /mkt/money.
//
// Admin only. Returns:
//   * days:   last 30 IST-bucketed daily revenue buckets
//   * weeks:  last 12 IST Monday-week revenue buckets
//   * returning: RETURNING-THIS-WEEK + NEW-THIS-WEEK (shared
//                denominator = customers who ordered in the last 7
//                IST days; disjoint).
//   * lifetime:  LIFETIME-REPEAT across the whole non-cancelled history.
//   * segments:  never_ordered + tried_cancelled + lapsed >21d —
//                each is a different action and each clicks straight
//                through to that segment in /mkt. tried_cancelled is
//                a SUBSET of never_ordered (deliberate overlap), so
//                the two counts answer different questions over the
//                same rows.
//   * methodSplit: cash / upi / cash_upi (split) / other / unrecorded
//   * sourceSplit: online / offline / manual
//   * jar:    current-week revenue + the configured weekly target
//
// Why we fetch the WHOLE history, not just the last 30/90 days:
//
// LIFETIME REPEAT and NEW-THIS-WEEK both need the earliest order per
// customer across their entire history. A 90-day window would read
// every customer whose first order was >90 days ago as "new this
// week" when they returned. The order table carries ~1.2 k rows
// today, so the pull is cheap (one or two .range() pages); the
// alternative — a per-customer "earliest order" view/RPC — would be
// faster but adds a second surface to keep in sync for one screen.
//
// How this avoids the three bugs the brief named:
//   * Cancellations are filtered by status, not by cancelled_at.
//     cancelled_at IS NEVER WRITTEN in prod (0 of 1207 rows have it
//     set; status says 130 are cancelled). Using the dead column
//     would overstate revenue and the returning/lifetime splits;
//     using isCancelled() from lib/mkt-money matches the orders-
//     board rule.
//   * Money accumulates in PAISE all the way through the fold —
//     Math.round(total_amount * 100) per row, divide by 100 only at
//     render time. orders.total_amount is rupees but sometimes
//     fractional (delivery fee), and a float-rupee accumulator
//     drifts.
//   * Orders / customers / subscriptions all fetched in 1000-row
//     .range() pages so PostgREST's silent truncation cannot hide
//     the tail. Today each table clears a single page, but the loop
//     is the only way to be safe as the business grows.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { mktServerClient } from "@/lib/mkt-auth";
import {
  buildDayBuckets,
  buildWeekBuckets,
  computeJar,
  computeLifetimeRepeat,
  computeReturningMetrics,
  computeSegmentCounts,
  splitByPaymentMethod,
  splitBySource,
  type MoneyOrderRow,
} from "@/lib/mkt-money";

const DAYS = 30;
const WEEKS = 12;
const RETURNING_WINDOW_DAYS = 7;

// Service-role client — orders RLS is service-role-only in this
// project, and /api/mkt/money gates on isAdmin at the route layer
// above (not via RLS). Keeps the route callable from one surface
// without widening orders' own policies.
function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

async function requireAdmin() {
  const sb = mktServerClient();
  const { data: userRes } = await sb.auth.getUser();
  if (!userRes?.user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const { data: me } = await sb
    .from("profiles")
    .select("role, status")
    .eq("id", userRes.user.id)
    .maybeSingle();
  if (!me || me.role !== "admin" || me.status !== "active") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true };
}

// Paginated .range() loop — PostgREST silently truncates no-limit
// SELECTs at 1000, so we loop until a short page confirms the tail.
async function paginateAll<T>(
  build: (from: number, size: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<{ rows: T[]; error: string | null }> {
  const rows: T[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await build(from, pageSize);
    if (error) return { rows, error: error.message };
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }
  return { rows, error: null };
}

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const svc = service();
  const today = new Date();

  // ── Orders — the whole non-cancelled history ────────────────────
  //
  // We pull ALL orders (newest first), not a dated window. Lifetime
  // repeat and "first ever order" both need every row; buildDay-
  // Buckets / buildWeekBuckets ignore anything outside their own
  // window anyway, so passing the full set to them is cheap.
  const PAGE = 1000;
  const ordersRes = await paginateAll<MoneyOrderRow>((from, size) =>
    svc
      .from("orders")
      .select("customer_id, total_amount, created_at, status, cod_settled_method, source")
      .order("created_at", { ascending: false })
      .range(from, from + size - 1),
    PAGE,
  );
  if (ordersRes.error) {
    return NextResponse.json({ error: ordersRes.error }, { status: 500 });
  }
  const orders = ordersRes.rows;

  // ── Customers — for the never_ordered denominator ───────────────
  //
  // never_ordered needs the full customer table (not just rows that
  // appear in orders). The CRM's segment count reads this same table
  // through /api/admin/customers; mirroring it here keeps the Money
  // screen's count and the CRM chip in agreement.
  const customersRes = await paginateAll<{ id: string }>((from, size) =>
    svc.from("customers").select("id").range(from, from + size - 1),
    PAGE,
  );
  if (customersRes.error) {
    return NextResponse.json({ error: customersRes.error }, { status: 500 });
  }
  const customerIds = customersRes.rows.map((c) => c.id);

  // ── Subscription holders — disqualifies a row from never_ordered.
  const subsRes = await paginateAll<{ customer_id: string | null }>((from, size) =>
    svc.from("subscriptions").select("customer_id").range(from, from + size - 1),
    PAGE,
  );
  if (subsRes.error) {
    return NextResponse.json({ error: subsRes.error }, { status: 500 });
  }
  const subscriberIds = new Set<string>();
  for (const r of subsRes.rows) {
    if (r.customer_id) subscriberIds.add(r.customer_id);
  }

  // ── Weekly target ──────────────────────────────────────────────
  const { data: cfg } = await svc
    .from("app_config")
    .select("value")
    .eq("key", "weekly_breakeven_target_paise")
    .maybeSingle();
  const parsed = cfg?.value != null ? Number(cfg.value) : NaN;
  const targetPaise = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  const days = buildDayBuckets(orders, DAYS, today);
  const weeks = buildWeekBuckets(orders, WEEKS, today);
  const returning = computeReturningMetrics(orders, RETURNING_WINDOW_DAYS, today);
  const lifetime = computeLifetimeRepeat(orders);
  const segments = computeSegmentCounts(customerIds, orders, subscriberIds, today);
  const methodSplit = splitByPaymentMethod(orders);
  const sourceSplit = splitBySource(orders);
  const jar = computeJar(orders, targetPaise, today);

  return NextResponse.json({
    days,
    weeks,
    returning,
    lifetime,
    segments,
    methodSplit,
    sourceSplit,
    jar,
    window: {
      returning_window_days: RETURNING_WINDOW_DAYS,
      customers: customerIds.length,
      orders: orders.length,
      subscribers: subscriberIds.size,
    },
  });
}
