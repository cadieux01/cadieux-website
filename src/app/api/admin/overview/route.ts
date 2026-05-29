import { NextRequest, NextResponse } from "next/server";
import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// Analytics overview endpoint. All aggregations happen in this route so
// the dashboard can render off a single network round-trip.
//
// Query params:
//   ?from=YYYY-MM-DD  inclusive start of range (defaults to 30 days ago)
//   ?to=YYYY-MM-DD    inclusive end of range  (defaults to today)
//
// Response shape: see OverviewResponse type below.

type CountByKey = { key: string; count: number }[];
type RevenuePoint = { date: string; revenue: number; orders: number };
type TopProduct = { name: string; subscriptions: number; revenue: number };
type CohortPoint = { month: string; new_customers: number };
type MonthlySalesPoint = { month: string; revenue: number; orders: number };

export type OverviewResponse = {
  range: { from: string; to: string };
  kpis: {
    revenue_today: number;
    revenue_week: number;
    revenue_month: number;
    revenue_range: number;
    orders_range: number;
    new_customers_range: number;
    active_subs: number;
    paused_subs: number;
    cancelled_subs: number;
    aov_range: number;
    churn_rate: number;
  };
  daily_revenue: RevenuePoint[];
  orders_by_status: CountByKey;
  top_products: TopProduct[];
  sub_lifecycle: CountByKey;
  customer_cohorts: CohortPoint[];
  monthly_sales: MonthlySalesPoint[];
};

function pad2(n: number) {
  return n < 10 ? `0${n}` : `${n}`;
}
function isoDay(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}
function isoMonth(s: string) {
  return s.slice(0, 7);
}
function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + days);
  return isoDay(d);
}
function startOfMonth(iso: string) {
  return `${iso.slice(0, 7)}-01`;
}
function dayBetween(day: string, from: string, to: string) {
  return day >= from && day <= to;
}

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const today = isoDay(new Date());
  const to = url.searchParams.get("to") || today;
  const from = url.searchParams.get("from") || addDays(today, -29);

  // We pull a slightly wider window than the requested range for the
  // KPIs (today / this week / this month always need their own ranges
  // independent of the operator's chosen filter). Strategy:
  //   - Always fetch orders since min(from, startOfMonth(today)).
  //   - Always fetch subscriptions full table (it's small).
  //   - Always fetch customers since min(from, startOfMonth(today)).
  const monthStart = startOfMonth(today);
  const weekStart = addDays(today, -6);
  const lowerBound = from < monthStart ? from : monthStart;

  const ordersP = supabaseAdmin
    .from("orders")
    .select("id, customer_id, total_amount, status, created_at")
    .gte("created_at", `${lowerBound}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(5000);

  const subsP = supabaseAdmin
    .from("subscriptions")
    .select(
      "id, product_name, product_slug, total_amount, status, created_at",
    )
    .order("created_at", { ascending: false })
    .limit(5000);

  const customersP = supabaseAdmin
    .from("customers")
    .select("id, created_at")
    .gte("created_at", `${lowerBound}T00:00:00Z`)
    .order("created_at", { ascending: false })
    .limit(5000);

  // Customer cohorts pull a longer history (12 months back from today)
  // independent of the range filter so the cohort chart isn't empty
  // for short ranges.
  const cohortStart = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setMonth(d.getMonth() - 11);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
  })();
  const cohortsP = supabaseAdmin
    .from("customers")
    .select("id, created_at")
    .gte("created_at", `${cohortStart}T00:00:00Z`)
    .limit(20000);

  // Monthly sales & turnover pulls the last 6 calendar months of orders
  // (independent of the range filter) so the monthly trend isn't empty
  // for short ranges. Kept separate from `ordersP` to avoid widening the
  // KPI/daily-revenue window.
  const sixMonthStart = (() => {
    const d = new Date(`${today}T00:00:00`);
    d.setMonth(d.getMonth() - 5);
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-01`;
  })();
  const monthlyOrdersP = supabaseAdmin
    .from("orders")
    .select("total_amount, status, created_at")
    .gte("created_at", `${sixMonthStart}T00:00:00Z`)
    .limit(20000);

  const [oRes, sRes, cRes, cohRes, moRes] = await Promise.all([
    ordersP,
    subsP,
    customersP,
    cohortsP,
    monthlyOrdersP,
  ]);

  if (oRes.error) {
    return NextResponse.json({ error: oRes.error.message }, { status: 500 });
  }
  if (sRes.error) {
    return NextResponse.json({ error: sRes.error.message }, { status: 500 });
  }
  if (cRes.error) {
    return NextResponse.json({ error: cRes.error.message }, { status: 500 });
  }

  type OrderRow = {
    id: string;
    customer_id: string | null;
    total_amount: number | null;
    status: string | null;
    created_at: string;
  };
  type SubRow = {
    id: string;
    product_name: string | null;
    product_slug: string | null;
    total_amount: number | null;
    status: string | null;
    created_at: string;
  };
  type CustomerRow = { id: string; created_at: string };

  const allOrders = (oRes.data ?? []) as OrderRow[];
  const allSubs = (sRes.data ?? []) as SubRow[];
  const recentCustomers = (cRes.data ?? []) as CustomerRow[];
  const cohortCustomers = ((cohRes.data ?? []) as CustomerRow[]) ?? [];

  // ---------- KPIs ----------
  const nonCancelled = (o: OrderRow) =>
    (o.status ?? "").toLowerCase() !== "cancelled";

  const sumRevenue = (orders: OrderRow[]) =>
    orders
      .filter(nonCancelled)
      .reduce((acc, o) => acc + (Number(o.total_amount) || 0), 0);

  const ordersOn = (day: string) =>
    allOrders.filter((o) => o.created_at.slice(0, 10) === day);
  const ordersSince = (start: string) =>
    allOrders.filter((o) => o.created_at.slice(0, 10) >= start);
  const ordersInRange = allOrders.filter((o) =>
    dayBetween(o.created_at.slice(0, 10), from, to),
  );

  const revenue_today = sumRevenue(ordersOn(today));
  const revenue_week = sumRevenue(ordersSince(weekStart));
  const revenue_month = sumRevenue(ordersSince(monthStart));
  const revenue_range = sumRevenue(ordersInRange);
  const orders_range = ordersInRange.length;
  const paidRangeOrders = ordersInRange.filter(nonCancelled);
  const aov_range =
    paidRangeOrders.length > 0
      ? revenue_range / paidRangeOrders.length
      : 0;

  const new_customers_range = recentCustomers.filter((c) =>
    dayBetween(c.created_at.slice(0, 10), from, to),
  ).length;

  const subStatusCounts = (() => {
    const c: Record<string, number> = {};
    for (const s of allSubs) {
      const k = (s.status ?? "unknown").toLowerCase();
      c[k] = (c[k] ?? 0) + 1;
    }
    return c;
  })();

  const active_subs = subStatusCounts["active"] ?? 0;
  const paused_subs = subStatusCounts["paused"] ?? 0;
  const cancelled_subs = subStatusCounts["cancelled"] ?? 0;
  // Simple churn rate: cancelled / (active + paused + cancelled + completed).
  // Anything with no subs returns 0 (rather than NaN).
  const totalSubs = allSubs.length;
  const churn_rate = totalSubs > 0 ? cancelled_subs / totalSubs : 0;

  // ---------- daily revenue ----------
  const dayBuckets = new Map<string, RevenuePoint>();
  for (let d = from; d <= to; d = addDays(d, 1)) {
    dayBuckets.set(d, { date: d, revenue: 0, orders: 0 });
  }
  for (const o of ordersInRange) {
    const day = o.created_at.slice(0, 10);
    const b = dayBuckets.get(day);
    if (!b) continue;
    b.orders += 1;
    if (nonCancelled(o)) b.revenue += Number(o.total_amount) || 0;
  }
  const daily_revenue = Array.from(dayBuckets.values()).sort((a, b) =>
    a.date.localeCompare(b.date),
  );

  // ---------- orders by status ----------
  const statusMap = new Map<string, number>();
  for (const o of ordersInRange) {
    const k = (o.status ?? "unknown").toLowerCase();
    statusMap.set(k, (statusMap.get(k) ?? 0) + 1);
  }
  const orders_by_status: CountByKey = Array.from(statusMap.entries())
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  // ---------- top products (from subs in range) ----------
  const subsInRange = allSubs.filter((s) =>
    dayBetween(s.created_at.slice(0, 10), from, to),
  );
  const productMap = new Map<string, { subscriptions: number; revenue: number }>();
  for (const s of subsInRange) {
    const name = s.product_name ?? s.product_slug ?? "Unknown";
    const cur = productMap.get(name) ?? { subscriptions: 0, revenue: 0 };
    cur.subscriptions += 1;
    cur.revenue += Number(s.total_amount) || 0;
    productMap.set(name, cur);
  }
  const top_products: TopProduct[] = Array.from(productMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.subscriptions - a.subscriptions)
    .slice(0, 5);

  // ---------- sub lifecycle ----------
  const sub_lifecycle: CountByKey = Object.entries(subStatusCounts)
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);

  // ---------- customer cohorts (12 months of signups) ----------
  const cohortMap = new Map<string, number>();
  // Pre-seed last 12 months so the chart isn't sparse.
  {
    const start = new Date(`${cohortStart}T00:00:00`);
    for (let i = 0; i < 12; i++) {
      const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
      cohortMap.set(
        `${m.getFullYear()}-${pad2(m.getMonth() + 1)}`,
        0,
      );
    }
  }
  for (const c of cohortCustomers) {
    const m = isoMonth(c.created_at);
    if (cohortMap.has(m)) cohortMap.set(m, (cohortMap.get(m) ?? 0) + 1);
  }
  const customer_cohorts: CohortPoint[] = Array.from(cohortMap.entries())
    .map(([month, new_customers]) => ({ month, new_customers }))
    .sort((a, b) => a.month.localeCompare(b.month));

  // ---------- monthly sales & turnover (last 6 months) ----------
  type MonthlyOrderRow = {
    total_amount: number | null;
    status: string | null;
    created_at: string;
  };
  const monthlyOrders = ((moRes.data ?? []) as MonthlyOrderRow[]) ?? [];
  const monthlyMap = new Map<string, MonthlySalesPoint>();
  {
    const start = new Date(`${sixMonthStart}T00:00:00`);
    for (let i = 0; i < 6; i++) {
      const m = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const key = `${m.getFullYear()}-${pad2(m.getMonth() + 1)}`;
      monthlyMap.set(key, { month: key, revenue: 0, orders: 0 });
    }
  }
  for (const o of monthlyOrders) {
    const key = isoMonth(o.created_at);
    const bucket = monthlyMap.get(key);
    if (!bucket) continue;
    bucket.orders += 1;
    if ((o.status ?? "").toLowerCase() !== "cancelled") {
      bucket.revenue += Number(o.total_amount) || 0;
    }
  }
  const monthly_sales: MonthlySalesPoint[] = Array.from(monthlyMap.values())
    .sort((a, b) => a.month.localeCompare(b.month));

  const response: OverviewResponse = {
    range: { from, to },
    kpis: {
      revenue_today,
      revenue_week,
      revenue_month,
      revenue_range,
      orders_range,
      new_customers_range,
      active_subs,
      paused_subs,
      cancelled_subs,
      aov_range,
      churn_rate,
    },
    daily_revenue,
    orders_by_status,
    top_products,
    sub_lifecycle,
    customer_cohorts,
    monthly_sales,
  };

  return NextResponse.json(response);
}
