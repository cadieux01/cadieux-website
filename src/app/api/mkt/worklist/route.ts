// GET /api/mkt/worklist?segment=<name>
//
// Returns the customers in a segment PLUS the per-person previous
// outreach rows and a top-of-page summary (how many have been worked,
// outcome counts). This is what /mkt/worklist renders — one card at a
// time — and what the segment chip summary reads.
//
// GATE: any authenticated profile with status='active'. The worklist
// is for the team to work, so this is NOT admin-only.
//
// HOW IT AVOIDS THE RULES THAT HAVE BITTEN:
//   * status <> 'cancelled' is the only cancellation check; the dead
//     orders.cancelled_at column is NEVER read here.
//   * Orders and outreach are fetched in 1000-row .range() pages so
//     PostgREST's silent truncation cannot hide the tail.
//   * Money accumulates in PAISE; divide once at the end.
//   * Phone normalisation (wa.me href) lives in the client; this
//     route projects the bare 10-digit phone exactly as the customers
//     table stores it and lets src/lib/admin-formatting.whatsAppHref
//     do the 91-prefix. No join against whatsapp_conversations.phone,
//     which is NULL-customer_id and would need an ilike.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

import { readMktSession } from "@/lib/mkt-auth";
import { matchesSegment, SEGMENTS, type Segment } from "@/lib/mkt-crm";
import { isCancelled } from "@/lib/order-stages";

// Shape of the customer card the worklist renders.
export type WorklistCustomer = {
  id: string;
  full_name: string | null;
  phone: string | null;
  city: string | null;
  total_orders: number;
  cancelled_orders: number;
  total_spent_rupees: number;
  last_order_at: string | null;
  last_cancelled_status_at: string | null;
  has_subscription: boolean;
  last_touch_at: string | null;
  last_touch_body: string | null;
  last_touch_kind: "note" | "whatsapp" | null;
  previous_outreach: Array<{
    id: string;
    channel: string;
    outcome: string;
    note: string | null;
    created_at: string;
    created_by: string;
  }>;
  recently_contacted: boolean; // any outreach in the last 14 days
};

export type WorklistResponse = {
  segment: Segment;
  summary: {
    total_in_segment: number;
    customers_contacted: number;
    outcomes: Record<string, number>;
  };
  customers: WorklistCustomer[];
};

// Public-schema service-role client. Needed for the orders+customers
// read because those tables' RLS is service-role-only.
function service() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Logistics-schema service-role client — the outreach table is there,
// and the default (public) client cannot see it.
function logisticsService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: { autoRefreshToken: false, persistSession: false },
      db: { schema: "logistics" },
    },
  );
}

const PAGE = 1000;
const RECENTLY_CONTACTED_WINDOW_DAYS = 14;

async function paginateAll<T>(
  build: (from: number, size: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = PAGE,
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

export async function GET(req: NextRequest) {
  const state = await readMktSession();
  if (state.kind !== "ok") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const raw = req.nextUrl.searchParams.get("segment") ?? "all";
  if (!(SEGMENTS as readonly string[]).includes(raw)) {
    return NextResponse.json({ error: "Unknown segment" }, { status: 400 });
  }
  const segment = raw as Segment;

  const svc = service();
  const logSvc = logisticsService();

  // ── Customers ──────────────────────────────────────────────────
  const customersRes = await paginateAll<{
    id: string;
    full_name: string | null;
    phone: string | null;
    city: string | null;
  }>((from, size) =>
    svc
      .from("customers")
      .select("id, full_name, phone, city")
      .order("created_at", { ascending: false })
      .range(from, from + size - 1),
  );
  if (customersRes.error) {
    return NextResponse.json({ error: customersRes.error }, { status: 500 });
  }

  // ── Orders ─────────────────────────────────────────────────────
  //
  // Full non-cancelled history. The segment rules need lifetime
  // signals (total_orders ever, last_order_at ever, cancelled_orders
  // ever) — a windowed select would read a long-dormant customer as
  // "never ordered", so paginate without a date bound.
  const ordersRes = await paginateAll<{
    customer_id: string | null;
    total_amount: number | null;
    status: string | null;
    status_updated_at: string | null;
    created_at: string;
    payment_method: string | null;
    payment_status: string | null;
  }>((from, size) =>
    svc
      .from("orders")
      .select(
        "customer_id, total_amount, status, status_updated_at, created_at, payment_method, payment_status",
      )
      .order("created_at", { ascending: false })
      .range(from, from + size - 1),
  );
  if (ordersRes.error) {
    return NextResponse.json({ error: ordersRes.error }, { status: 500 });
  }

  // ── Subscriptions (holder set) ─────────────────────────────────
  const subsRes = await paginateAll<{ customer_id: string | null }>((from, size) =>
    svc.from("subscriptions").select("customer_id").range(from, from + size - 1),
  );
  if (subsRes.error) {
    return NextResponse.json({ error: subsRes.error }, { status: 500 });
  }
  const subscriberIds = new Set<string>();
  for (const r of subsRes.rows) {
    if (r.customer_id) subscriberIds.add(r.customer_id);
  }

  // ── Outreach ───────────────────────────────────────────────────
  //
  // All outreach rows. We will group by customer_id below so the
  // worklist card can show previous attempts and the summary can
  // count outcomes within the segment.
  const outreachRes = await paginateAll<{
    id: string;
    customer_id: string;
    channel: string;
    outcome: string;
    note: string | null;
    created_at: string;
    created_by: string;
    segment: string | null;
  }>((from, size) =>
    logSvc
      .from("outreach")
      .select("id, customer_id, channel, outcome, note, created_at, created_by, segment")
      .order("created_at", { ascending: false })
      .range(from, from + size - 1),
  );
  // If outreach table does not yet exist (migration not applied), fall
  // through with an empty set. The worklist is still useful before
  // anything has been logged — it just has no history to show.
  const outreachByCust = new Map<
    string,
    WorklistCustomer["previous_outreach"]
  >();
  if (!outreachRes.error) {
    for (const r of outreachRes.rows) {
      const list = outreachByCust.get(r.customer_id) ?? [];
      list.push({
        id: r.id,
        channel: r.channel,
        outcome: r.outcome,
        note: r.note,
        created_at: r.created_at,
        created_by: r.created_by,
      });
      outreachByCust.set(r.customer_id, list);
    }
  }

  // ── Notes / WhatsApp for the "last touch" line (admin-only sign).
  //
  // Mirrors the existing /api/admin/customers with_touch block (notes
  // + whatsapp latest body), but kept narrow — this route runs for
  // any active profile, not admin-only. The body text is an operator
  // signal (a reminder of what was said last); it is not PII we want
  // to withhold from the team that would call these customers.
  //
  // For speed, we read NOTES only (WhatsApp messages here would need
  // the phone-digits-tail join already documented in the detail route,
  // which is heavier than the worklist needs for an at-a-glance line).
  const notesRes = await paginateAll<{
    body: string;
    created_at: string;
    customer_id: string | null;
  }>((from, size) =>
    svc
      .from("order_notes")
      .select("body, created_at, customer_id")
      .not("customer_id", "is", null)
      .order("created_at", { ascending: false })
      .range(from, from + size - 1),
  );
  const lastNoteByCust = new Map<
    string,
    { at: string; body: string }
  >();
  if (!notesRes.error) {
    for (const n of notesRes.rows) {
      if (!n.customer_id) continue;
      const prev = lastNoteByCust.get(n.customer_id);
      if (!prev || n.created_at > prev.at) {
        lastNoteByCust.set(n.customer_id, { at: n.created_at, body: n.body });
      }
    }
  }

  // ── Per-customer aggregates ────────────────────────────────────
  //
  // Money in paise; divide once. status <> 'cancelled' is the only
  // cancellation check (status_updated_at carries the honest
  // cancellation timestamp — see /api/admin/customers for why).
  type Agg = {
    total_orders: number;
    total_spent_paise: number;
    last_order_at: string | null;
    cancelled_orders: number;
    last_cancelled_status_at: string | null;
  };
  const agg = new Map<string, Agg>();
  const ensure = (cid: string): Agg => {
    const cur = agg.get(cid);
    if (cur) return cur;
    const fresh: Agg = {
      total_orders: 0,
      total_spent_paise: 0,
      last_order_at: null,
      cancelled_orders: 0,
      last_cancelled_status_at: null,
    };
    agg.set(cid, fresh);
    return fresh;
  };
  for (const row of ordersRes.rows) {
    if (!row.customer_id) continue;
    if (isCancelled(row.status)) {
      const cur = ensure(row.customer_id);
      cur.cancelled_orders += 1;
      const at = row.status_updated_at ?? row.created_at;
      if (!cur.last_cancelled_status_at || at > cur.last_cancelled_status_at) {
        cur.last_cancelled_status_at = at;
      }
      continue;
    }
    const cur = ensure(row.customer_id);
    cur.total_orders += 1;
    const amt = Number(row.total_amount) || 0;
    cur.total_spent_paise += Math.round(amt * 100);
    if (!cur.last_order_at || row.created_at > cur.last_order_at) {
      cur.last_order_at = row.created_at;
    }
  }

  // ── Compose segment queue + summary ────────────────────────────
  const nowMs = Date.now();
  const recentCutoff = new Date(
    nowMs - RECENTLY_CONTACTED_WINDOW_DAYS * 86_400_000,
  ).toISOString();

  const customers: WorklistCustomer[] = [];
  const outcomes: Record<string, number> = {};
  let customersContacted = 0;

  for (const c of customersRes.rows) {
    const a = agg.get(c.id);
    const segRow = {
      total_orders: a?.total_orders ?? 0,
      has_subscription: subscriberIds.has(c.id),
      last_order_at: a?.last_order_at ?? null,
      outstanding_cod: 0, // not used by any segment that reaches here
      cancelled_orders: a?.cancelled_orders ?? 0,
    };
    if (!matchesSegment(segRow, segment)) continue;

    const history = outreachByCust.get(c.id) ?? [];
    const note = lastNoteByCust.get(c.id);
    customers.push({
      id: c.id,
      full_name: c.full_name,
      phone: c.phone,
      city: c.city,
      total_orders: segRow.total_orders,
      cancelled_orders: segRow.cancelled_orders,
      total_spent_rupees: (a?.total_spent_paise ?? 0) / 100,
      last_order_at: segRow.last_order_at,
      last_cancelled_status_at: a?.last_cancelled_status_at ?? null,
      has_subscription: segRow.has_subscription,
      last_touch_at: note?.at ?? null,
      last_touch_body: note?.body ?? null,
      last_touch_kind: note ? "note" : null,
      previous_outreach: history,
      recently_contacted: history.some((o) => o.created_at >= recentCutoff),
    });

    if (history.length > 0) customersContacted += 1;
    for (const o of history) {
      outcomes[o.outcome] = (outcomes[o.outcome] ?? 0) + 1;
    }
  }

  // Sort: never-contacted first, then oldest-last-order first (the
  // longer the drought, the higher the priority). Carries the queue
  // feel the worklist page runs on — the top of the list is who to
  // ring next.
  customers.sort((a, b) => {
    if (a.recently_contacted !== b.recently_contacted) {
      return a.recently_contacted ? 1 : -1;
    }
    if (a.previous_outreach.length !== b.previous_outreach.length) {
      return a.previous_outreach.length - b.previous_outreach.length;
    }
    const la = a.last_order_at ?? a.last_cancelled_status_at ?? "";
    const lb = b.last_order_at ?? b.last_cancelled_status_at ?? "";
    return la.localeCompare(lb); // oldest first
  });

  const body: WorklistResponse = {
    segment,
    summary: {
      total_in_segment: customers.length,
      customers_contacted: customersContacted,
      outcomes,
    },
    customers,
  };
  return NextResponse.json(body);
}
