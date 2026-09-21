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
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import {
  buildBakePlan,
  type SendSlot,
  type StaleDeliveryLine,
} from "@/lib/email/bake-plan";
import {
  loadOrderLines,
  loadSubscriptionLines,
  type BakePlanLine,
} from "@/lib/bake-plan-lines";
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

/** IST calendar date shifted by `dayOffset` from "now", as YYYY-MM-DD.
 *  We compute in UTC after shifting +5:30 to be timezone-neutral without
 *  a tz lib. Two callers today:
 *   • istTomorrowISO() for the two SENDS FOR TOMORROW (d1_1800, d1_2215)
 *   • istTodayISO() for the pre-dawn TODAY send (d0_0445 — after the
 *     Evening-slot cutoff, the day it fires IS the delivery day). */
function istDateISO(dayOffset: number): string {
  const now = new Date();
  const istMs = now.getTime() + 5.5 * 60 * 60 * 1000;
  const ist = new Date(istMs);
  ist.setUTCDate(ist.getUTCDate() + dayOffset);
  const y = ist.getUTCFullYear();
  const m = String(ist.getUTCMonth() + 1).padStart(2, "0");
  const d = String(ist.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function istTomorrowISO(): string {
  return istDateISO(1);
}

function istTodayISO(): string {
  return istDateISO(0);
}

// The three known sends. Anything else in `?slot=` is a typo and gets a
// 400, not a silent fallback — a mistyped slot writing a `d1_1800` row
// on a `d0_0445` schedule would fool the idempotency table.
const SEND_SLOTS: readonly SendSlot[] = ["d1_1800", "d1_2215", "d0_0445"] as const;

function isSendSlot(v: string): v is SendSlot {
  return (SEND_SLOTS as readonly string[]).includes(v);
}

// Row types, item parsing and the two data legs used to live here. They
// moved to @/lib/bake-plan-lines when the production strip above
// /admin/orders needed the same subscription leg: one query, two readers,
// so the screen and the 18:00 email cannot count different loaves for the
// same day.

function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
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
  //
  // `?slot=` selects which of the three daily sends this call represents:
  //   d1_1800  — 18:00 IST send for TOMORROW  (default; original behaviour)
  //   d1_2215  — 22:15 IST send for TOMORROW  (after Midday-slot cutoff)
  //   d0_0445  — 04:45 IST send for TODAY     (after Evening-slot cutoff)
  //
  // The three-row composite PK on bake_plan_sent (delivery_date, send_slot)
  // is why an unknown slot MUST 400 rather than default silently — a typo
  // that wrote d1_1800 on a d0_0445 run would swallow one of the day's
  // three emails and there would be no trace.
  const url = new URL(req.url);
  const overrideDate = url.searchParams.get("date");
  const rawSlot = url.searchParams.get("slot");
  let sendSlot: SendSlot = "d1_1800";
  if (rawSlot !== null) {
    if (!isSendSlot(rawSlot)) {
      return NextResponse.json(
        {
          error: "unknown slot",
          hint: `slot must be one of ${SEND_SLOTS.join(", ")}`,
        },
        { status: 400 },
      );
    }
    sendSlot = rawSlot;
  }
  const defaultDate = sendSlot === "d0_0445" ? istTodayISO() : istTomorrowISO();
  const targetDate =
    overrideDate && /^\d{4}-\d{2}-\d{2}$/.test(overrideDate)
      ? overrideDate
      : defaultDate;

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

  // A FAILED LEG MUST NEVER BE SENT AS A ZERO.
  //
  // `orderLines` initialises to [] and the catch above only records the
  // message, so a leg that threw reaches the reservation as `length === 0`
  // and writes order_count = 0 — byte-identical to a day with genuinely no
  // orders. On 2026-09-18 the 22:15 send recorded 0 against 15 real orders
  // and nothing in the email or the table said anything was wrong.
  //
  // A missing email is recoverable; an authoritative "0 orders" at 04:45 is
  // not. So bail BEFORE reserving: no row is burned, the cron shows red in
  // Vercel, and the next scheduled run can still deliver the real plan.
  // The stale leg is excluded deliberately — it is a read-only appendix and
  // its absence cannot mis-state what to bake.
  if (orderError || subError) {
    console.error(
      "[cron/delivery-bake-plan] refusing to send: a data leg failed",
      { targetDate, sendSlot, orderError, subError },
    );
    return NextResponse.json(
      {
        targetDate,
        sendSlot,
        sent: false,
        reason: "leg_failed_refusing_to_send_zero",
        errors: { orders: orderError, subscriptions: subError },
        counts: {
          orders: orderLines.length,
          subscriptions: subLines.length,
          total: lines.length,
        },
      },
      { status: 500 },
    );
  }

  const email = buildBakePlan(targetDate, lines, staleLines, sendSlot);

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
        send_slot: sendSlot,
        email_to: BAKE_PLAN_EMAIL,
        // ROWS LOADED, not loaves baked. `subscription_count` counts every
        // delivery due that day including ones on unpaid plans, which the
        // email segregates under "UNPAID — DO NOT BAKE" and leaves out of
        // its own totals. The two numbers can therefore differ on purpose;
        // this column's job is "did the legs return data", which is what
        // the false-zero guard above depends on.
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
        sendSlot,
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
        .eq("delivery_date", targetDate)
        .eq("send_slot", sendSlot);
    }
    console.error(
      "[cron/delivery-bake-plan] send failed:",
      sendErr.message,
    );
    return NextResponse.json(
      {
        targetDate,
        sendSlot,
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
    sendSlot,
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
