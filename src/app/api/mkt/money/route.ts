// GET /api/mkt/money — the aggregated numbers behind /mkt/money.
//
// Admin only. Returns:
//   * days:   last 30 IST-bucketed daily revenue buckets
//   * weeks:  last 12 IST Monday-week revenue buckets
//   * repeat: distinct customers + repeaters across the last 7 days
//   * methodSplit: cash / upi / cash_upi (split) / other / unrecorded
//   * sourceSplit: online / offline / manual
//   * jar:    current-week revenue + the configured weekly target
//
// How this avoids the three bugs the brief named:
//   * Cancellations are filtered by status, not by cancelled_at.
//     cancelled_at IS NEVER WRITTEN in prod (0 of 1207 rows have it
//     set; status says 130 are cancelled). Using the dead column
//     would overstate revenue; using isCancelled() from lib/mkt-money
//     matches the orders-board rule.
//   * Money accumulates in PAISE all the way through the fold —
//     Math.round(total_amount * 100) per row, divide by 100 only at
//     render time. orders.total_amount is rupees but sometimes
//     fractional (delivery fee), and a float-rupee accumulator
//     drifts over 90 days of data.
//   * Orders are fetched in 1000-row .range() pages so PostgREST's
//     silent truncation cannot hide the tail of the window. The
//     last-12-weeks window is ~800 orders at today's volume, so a
//     single page suffices — but we loop anyway because it is the
//     only way to be safe as the business grows.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { mktServerClient } from "@/lib/mkt-auth";
import {
  buildDayBuckets,
  buildWeekBuckets,
  computeJar,
  computeRepeatRate,
  splitByPaymentMethod,
  splitBySource,
  type MoneyOrderRow,
} from "@/lib/mkt-money";

const DAYS = 30;
const WEEKS = 12;
const REPEAT_WINDOW_DAYS = 7;

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

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const svc = service();
  const today = new Date();

  // Fetch a window wide enough to cover both the 30-day and the
  // 12-week asks. 12 weeks = 84 days — go with 90 for a day of
  // margin either side of the IST boundary.
  const WINDOW_DAYS = Math.max(90, DAYS, WEEKS * 7);
  const fromIso = new Date(today.getTime() - WINDOW_DAYS * 86_400_000).toISOString();

  // PAGINATE. PostgREST caps at 1000 rows and does not raise. The
  // 90-day window holds ~800 orders at today's volume — one page
  // today, but the business grows.
  const PAGE = 1000;
  const rows: MoneyOrderRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await svc
      .from("orders")
      .select("customer_id, total_amount, created_at, status, cod_settled_method, source")
      .gte("created_at", fromIso)
      .order("created_at", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const page = (data ?? []) as MoneyOrderRow[];
    rows.push(...page);
    if (page.length < PAGE) break;
    from += PAGE;
  }

  // Jar needs the current week's revenue, which is INSIDE the
  // window. Target lives in app_config.
  const { data: cfg } = await svc
    .from("app_config")
    .select("value")
    .eq("key", "weekly_breakeven_target_paise")
    .maybeSingle();
  const parsed = cfg?.value != null ? Number(cfg.value) : NaN;
  const targetPaise = Number.isFinite(parsed) && parsed > 0 ? parsed : null;

  const days = buildDayBuckets(rows, DAYS, today);
  const weeks = buildWeekBuckets(rows, WEEKS, today);
  const repeat = computeRepeatRate(rows, REPEAT_WINDOW_DAYS, today);
  const methodSplit = splitByPaymentMethod(rows);
  const sourceSplit = splitBySource(rows);
  const jar = computeJar(rows, targetPaise, today);

  return NextResponse.json({
    days,
    weeks,
    repeat,
    methodSplit,
    sourceSplit,
    jar,
    window: { from: fromIso, days: WINDOW_DAYS, rows_fetched: rows.length },
  });
}
