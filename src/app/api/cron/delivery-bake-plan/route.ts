// GET /api/cron/delivery-bake-plan
//
// Vercel Cron entry point. Runs daily at 12:30 UTC (18:00 IST). See vercel.json.
//
// Auth: Bearer ${CRON_SECRET}. Same auth block every cron in this project
// uses (missing secret → 500; wrong header → 401) so a silently misconfigured
// cron is distinguishable from a probe.
//
// PURPOSE
// Emails admin@cadieux.in a single digest of EVERYTHING due tomorrow —
// one-time orders + subscription deliveries — grouped by delivery slot,
// with a rolled-up "bake totals" table. The bake starts the night before;
// this is the last read the baker takes before firing the oven.
//
// TWO LEGS
//   1. orders                    — status NOT IN ('delivered','cancelled')
//   2. subscription_deliveries   — status NOT IN ('delivered','cancelled')
// Each leg runs in its own try/catch. A failing leg is reported but does
// not stop the other. If both fail we still send the empty-state email
// with error context so the operator gets a heartbeat.
//
// EMPTY IS STILL SENT. A silent inbox would look identical to a broken
// cron; a delivered "Nothing scheduled for tomorrow" says the cron ran.
//
// IDEMPOTENCY
// A row is inserted into public.bake_plan_sent BEFORE the email is sent,
// with the delivery date as primary key. A retry same-day therefore fails
// the insert and the send is skipped. The insert-before-send ordering is
// deliberate: at most one email per delivery date, even if Resend times
// out and Vercel retries.

import { NextRequest, NextResponse } from "next/server";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  buildBakePlan,
  type BakePlanLine,
  type StaleDeliveryLine,
} from "@/lib/email/bake-plan";
import { loadStaleDeliveries } from "@/lib/cron/stale-deliveries";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "Cadieux <hello@cadieux.in>";

// Single recipient by design — this is the baker's inbox, not the alert
// list used by the abandoned-payments digest. Repointing here would
// silently move an operational document to the wrong human.
const BAKE_PLAN_EMAIL =
  process.env.BAKE_PLAN_EMAIL || "admin@cadieux.in";

// ── IST helpers ──────────────────────────────────────────────────────────

/** Tomorrow's date in IST as YYYY-MM-DD. Cron fires at 12:30 UTC = 18:00
 *  IST, so "now + 24h" and "today+1 IST" both resolve to the same next
 *  calendar day. We compute in UTC after shifting +5:30 to be timezone-
 *  neutral without a tz lib. */
function istTomorrowISO(): string {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  ist.setUTCDate(ist.getUTCDate() + 1);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

// ── Row types ────────────────────────────────────────────────────────────

interface OrderRow {
  id: string;
  order_number: string | null;
  delivery_slot: string | null;
  delivery_address: string | null;
  total_amount: number | null;
  fulfillment_type: string | null;
  items: unknown;
  customers: { full_name: string | null; phone: string | null } | null;
}

interface OrderItem {
  qty: number;
  name: string;
}

interface SubDeliveryRow {
  id: string;
  subscription_id: string;
  slot: string | null;
  scheduled_time_slot: string | null;
  items_override: unknown;
  subscriptions: {
    id: string;
    subscription_number: string | null;
    customer_name: string | null;
    customer_phone: string | null;
    delivery_address: unknown;
  } | null;
}

interface SubItemRow {
  subscription_id: string;
  product_name: string | null;
  quantity_per_delivery: number | null;
}

interface OverrideItem {
  name?: string;
  product_name?: string;
  qty?: number;
  quantity?: number;
  quantity_per_delivery?: number;
}

interface SubAddress {
  name?: string | null;
  line1?: string | null;
  line2?: string | null;
  city?: string | null;
  pincode?: string | null;
  phone?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────

function orderRef(o: OrderRow): string {
  return o.order_number || `#${o.id.slice(0, 8).toUpperCase()}`;
}

function subRef(sub: SubDeliveryRow["subscriptions"]): string {
  if (!sub) return "SUB —";
  return sub.subscription_number
    ? `SUB ${sub.subscription_number}`
    : `SUB #${sub.id.slice(0, 8).toUpperCase()}`;
}

function orderItems(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  const out: string[] = [];
  for (const raw of items as OrderItem[]) {
    const name = String(raw?.name ?? "").trim();
    const qty = Number(raw?.qty ?? 0);
    if (!name || !isFinite(qty) || qty <= 0) continue;
    out.push(`${qty} × ${name}`);
  }
  return out;
}

function flattenSubAddress(addr: unknown): string {
  if (!addr || typeof addr !== "object") return "";
  const a = addr as SubAddress;
  const parts = [a.line1, a.line2, a.city, a.pincode]
    .map((p) => (typeof p === "string" ? p.trim() : ""))
    .filter(Boolean);
  return parts.join(", ");
}

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Data legs ────────────────────────────────────────────────────────────

async function loadOrderLines(
  supabase: SupabaseClient,
  dateIso: string,
): Promise<BakePlanLine[]> {
  const { data, error } = await supabase
    .from("orders")
    .select(
      "id, order_number, delivery_slot, delivery_address, total_amount, fulfillment_type, items, customers(full_name, phone)",
    )
    .eq("delivery_date", dateIso)
    .not("status", "in", "(delivered,cancelled)");

  if (error) throw new Error(`orders leg: ${error.message}`);

  const rows = (data || []) as unknown as OrderRow[];
  return rows.map((o) => ({
    ref: orderRef(o),
    kind: "order" as const,
    slot: o.delivery_slot,
    customerName: (o.customers?.full_name || "Unknown").trim(),
    customerPhone: o.customers?.phone || "no phone",
    address:
      (o.delivery_address || "").trim() ||
      (o.fulfillment_type === "pickup" ? "PICKUP" : ""),
    items: orderItems(o.items),
    amountInr:
      typeof o.total_amount === "number" ? Math.round(o.total_amount) : 0,
  }));
}

async function loadSubscriptionLines(
  supabase: SupabaseClient,
  dateIso: string,
): Promise<BakePlanLine[]> {
  const { data: dels, error } = await supabase
    .from("subscription_deliveries")
    .select(
      "id, subscription_id, slot, scheduled_time_slot, items_override, subscriptions(id, subscription_number, customer_name, customer_phone, delivery_address)",
    )
    .eq("delivery_date", dateIso)
    .not("status", "in", "(delivered,cancelled)");

  if (error) throw new Error(`subscription_deliveries leg: ${error.message}`);

  const deliveries = (dels || []) as unknown as SubDeliveryRow[];
  if (deliveries.length === 0) return [];

  // Bulk-fetch item defaults for every subscription in one query so we
  // don't fan out one lookup per delivery.
  const subIds = Array.from(
    new Set(deliveries.map((d) => d.subscription_id).filter(Boolean)),
  );
  const itemsBySub = new Map<string, string[]>();
  if (subIds.length > 0) {
    const { data: items, error: iErr } = await supabase
      .from("subscription_items")
      .select("subscription_id, product_name, quantity_per_delivery")
      .in("subscription_id", subIds);
    if (iErr) throw new Error(`subscription_items lookup: ${iErr.message}`);
    for (const row of (items || []) as SubItemRow[]) {
      const name = (row.product_name || "").trim();
      const qty = Number(row.quantity_per_delivery ?? 0);
      if (!name || qty <= 0) continue;
      const list = itemsBySub.get(row.subscription_id) || [];
      list.push(`${qty} × ${name}`);
      itemsBySub.set(row.subscription_id, list);
    }
  }

  return deliveries.map((d) => {
    // Per-delivery override wins if present, else fall back to the
    // subscription's default item list (subscription_items).
    let itemLines: string[] = [];
    const ov = d.items_override;
    if (Array.isArray(ov) && ov.length > 0) {
      for (const raw of ov as OverrideItem[]) {
        const name = String(raw?.name ?? raw?.product_name ?? "").trim();
        const qty = Number(
          raw?.qty ?? raw?.quantity ?? raw?.quantity_per_delivery ?? 0,
        );
        if (!name || qty <= 0) continue;
        itemLines.push(`${qty} × ${name}`);
      }
    }
    if (itemLines.length === 0) {
      itemLines = itemsBySub.get(d.subscription_id) || [];
    }

    const sub = d.subscriptions;
    const addr = flattenSubAddress(sub?.delivery_address);
    // Prefer the address's name/phone (edited per delivery) with a
    // subscription-level fallback (denormalised copy).
    const parsedAddr =
      sub?.delivery_address && typeof sub.delivery_address === "object"
        ? (sub.delivery_address as SubAddress)
        : {};

    return {
      ref: subRef(sub),
      kind: "subscription" as const,
      slot: d.slot || d.scheduled_time_slot,
      customerName: (
        parsedAddr.name ||
        sub?.customer_name ||
        "Unknown"
      ).trim(),
      customerPhone:
        parsedAddr.phone || sub?.customer_phone || "no phone",
      address: addr,
      items: itemLines,
      amountInr: 0,
    };
  });
}

// ── Route ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/delivery-bake-plan] CRON_SECRET is not set — this cron cannot run.",
    );
    return NextResponse.json(
      { error: "cron secret not configured" },
      { status: 500 },
    );
  }

  const auth = req.headers.get("authorization") || "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const resendKey = process.env.RESEND_API_KEY;
  if (!resendKey) {
    console.error(
      "[cron/delivery-bake-plan] RESEND_API_KEY not set — cannot send bake plan.",
    );
    return NextResponse.json(
      { error: "resend not configured" },
      { status: 500 },
    );
  }
  const resend = new Resend(resendKey);

  // A `?date=YYYY-MM-DD` override is accepted so an operator can re-run
  // the plan for a specific day (past testing, forgotten cron, etc.) —
  // still governed by the same auth header + idempotency table.
  const url = new URL(req.url);
  const overrideDate = url.searchParams.get("date");
  const targetDate =
    overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)
      ? overrideDate
      : istTomorrowISO();

  // Two legs, independent try/catch. A failing leg contributes its error
  // to the response body but must never abort the other or block the send.
  let orderLines: BakePlanLine[] = [];
  let orderError: string | null = null;
  try {
    orderLines = await loadOrderLines(supabaseAdmin, targetDate);
  } catch (e) {
    orderError = errMessage(e);
    console.error("[cron/delivery-bake-plan] orders leg failed:", orderError);
  }

  let subLines: BakePlanLine[] = [];
  let subError: string | null = null;
  try {
    subLines = await loadSubscriptionLines(supabaseAdmin, targetDate);
  } catch (e) {
    subError = errMessage(e);
    console.error(
      "[cron/delivery-bake-plan] subscription_deliveries leg failed:",
      subError,
    );
  }

  const lines = [...orderLines, ...subLines];

  // Third leg: unresolved stale deliveries (>7d past date, still open,
  // parent not cancelled). Read-only surface — the email lists them so
  // Sunny sees them once a day. Failure here must not block the send;
  // a stale-load error just omits the section (same rule as the two
  // primary legs).
  let staleLines: StaleDeliveryLine[] = [];
  let staleError: string | null = null;
  try {
    const stale = await loadStaleDeliveries(supabaseAdmin);
    if (stale.error) {
      staleError = stale.error;
    } else {
      staleLines = stale.rows.map((r) => ({
        subscriptionNumber:
          r.subscription_number || `#${r.subscription_id.slice(0, 8).toUpperCase()}`,
        // Booking-time snapshot only — never the joined customers row.
        customerName: (r.customer_name || "Unknown").trim(),
        customerPhone: (r.customer_phone || "").trim(),
        daysOverdue: r.days_overdue,
        deliveryStatus: r.delivery_status,
        parentStatus: r.parent_status,
      }));
    }
  } catch (e) {
    staleError = errMessage(e);
    console.error(
      "[cron/delivery-bake-plan] stale leg failed:",
      staleError,
    );
  }

  const email = buildBakePlan(targetDate, lines, staleLines);

  // Idempotency: reserve the day BEFORE sending. A retry same-day fails
  // the primary-key insert and skips the send. `?force=1` bypasses the
  // reservation for manual re-tests (still auth-gated).
  const force = url.searchParams.get("force") === "1";
  let reserved = false;
  if (!force) {
    const { error: insErr } = await supabaseAdmin
      .from("bake_plan_sent")
      .insert({
        delivery_date: targetDate,
        email_to: BAKE_PLAN_EMAIL,
        order_count: orderLines.length,
        subscription_count: subLines.length,
      });
    if (insErr) {
      // Unique violation = already sent today. Return the summary the
      // operator would have seen without re-sending.
      const alreadySent =
        insErr.code === "23505" ||
        /duplicate|already exists/i.test(insErr.message);
      return NextResponse.json({
        targetDate,
        skipped: true,
        reason: alreadySent ? "already_sent_today" : "reservation_failed",
        details: alreadySent ? undefined : insErr.message,
        counts: {
          orders: orderLines.length,
          subscriptions: subLines.length,
          total: lines.length,
        },
        errors: {
          orders: orderError,
          subscriptions: subError,
          stale: staleError,
        },
        stale_count: staleLines.length,
      });
    }
    reserved = true;
  }

  const { error: sendErr } = await resend.emails.send({
    from: FROM_EMAIL,
    to: BAKE_PLAN_EMAIL,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  if (sendErr) {
    // Roll back the reservation so tomorrow's retry (or a manual re-run)
    // can send. Without this a Resend hiccup would suppress the plan.
    if (reserved) {
      await supabaseAdmin
        .from("bake_plan_sent")
        .delete()
        .eq("delivery_date", targetDate);
    }
    console.error(
      "[cron/delivery-bake-plan] send failed:",
      sendErr.message,
    );
    return NextResponse.json(
      {
        targetDate,
        sent: false,
        error: sendErr.message,
        counts: {
          orders: orderLines.length,
          subscriptions: subLines.length,
          total: lines.length,
        },
        errors: {
          orders: orderError,
          subscriptions: subError,
          stale: staleError,
        },
        stale_count: staleLines.length,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    targetDate,
    sent: true,
    empty: lines.length === 0,
    to: BAKE_PLAN_EMAIL,
    counts: {
      orders: orderLines.length,
      subscriptions: subLines.length,
      total: lines.length,
    },
    errors: { orders: orderError, subscriptions: subError },
  });
}
