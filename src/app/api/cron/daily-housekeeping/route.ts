// GET /api/cron/daily-housekeeping
//
// Vercel Cron entry point. Runs daily at 03:30 UTC (09:00 IST). See vercel.json.
//
// Auth: Bearer ${CRON_SECRET}. Same block every cron in this project uses; a
// missing CRON_SECRET returns 500 and a wrong header returns 401 so a silently
// misconfigured cron is distinguishable from a probe.
//
// WHY ONE ROUTE FOR THREE JOBS
// Vercel Hobby allows two cron entries per project. This project needs one
// slot for the evening bake-plan email (/api/cron/delivery-bake-plan), which
// leaves one slot for all daily housekeeping. Combining three jobs behind a
// single entry point is the cost of staying on Hobby, and Sunny's explicit
// preference over splitting to pg_cron + pg_net.
//
// PHASES, RUN SEQUENTIALLY, EACH IN ITS OWN try/catch:
//   1. SWEEP    — mark unpaid subscription shells 'abandoned'
//   2. DIGEST   — email the owner the orders that reached payment and stopped
//   3. REMINDERS — email customers whose subscription is winding down
//   4. STALE    — surface unresolved deliveries >7 days past date (READ-ONLY,
//                 no auto-resolution; the database can't know whether the
//                 loaf was actually delivered — Sunny decides)
//
// One failing phase must NEVER abort the others. The response body reports
// each phase separately (a top-level `error` on any phase means that phase
// only) so an operator can look at a single run and tell which of the three
// worked. A failed phase does NOT change the HTTP status of the run — the
// response is 200 even if all three fail; individual `error` fields carry
// the story. If we returned 500 the moment one phase failed, a badly-timed
// digest failure would look like the whole cron is down.
//
// EXTENDING THIS ROUTE (for the other-window / future work)
// Add jobs as another `runXxx()` phase function under src/lib/cron/, call it
// here inside a try/catch that produces its own object, and merge that into
// the response. Do NOT add cron entries to vercel.json — the Hobby cap makes
// the registry-behind-one-route the load-bearing design.

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { sweepAbandonedSubscriptions } from "@/lib/sweep-abandoned-subscriptions";
import { runAbandonedPaymentsDigest } from "@/lib/cron/abandoned-payments-digest";
import { runSubscriptionReminders } from "@/lib/cron/subscription-reminders-phase";
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

// Deliberately NOT reusing HANDOFF_ALERT_EMAIL — that address belongs to the
// WhatsApp handoff subsystem and repointing it here would silently move those
// alerts too.
const ALERT_EMAILS = (
  process.env.ABANDONED_ALERT_EMAIL || "ceo@cadieux.in,admin@cadieux.in"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

/** Turn an unknown thrown value into a stable string for the response body. */
function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/daily-housekeeping] CRON_SECRET is not set — this cron cannot run.",
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

  // Resend is required by phases 2 and 3 but NOT by phase 1. We deliberately
  // do not gate the whole route on it — the sweep should run even when the
  // email key is missing, so bookkeeping keeps working during an email outage.
  const resendKey = process.env.RESEND_API_KEY;
  const resend = resendKey ? new Resend(resendKey) : null;

  // ── Phase 1: sweep ─────────────────────────────────────────────────────
  let sweep;
  try {
    sweep = await sweepAbandonedSubscriptions(supabaseAdmin);
  } catch (e) {
    const message = errMessage(e);
    console.error("[cron/daily-housekeeping:sweep] threw:", message);
    sweep = { swept: 0, deliveriesCancelled: 0, cutoff: "", error: message };
  }

  // ── Phase 2: abandoned-payments digest ─────────────────────────────────
  let digest;
  if (!resend) {
    console.error(
      "[cron/daily-housekeeping:digest] RESEND_API_KEY not set — digest skipped.",
    );
    digest = {
      abandoned: 0,
      lost: 0,
      sent: false,
      error: "RESEND_API_KEY not configured",
    };
  } else {
    try {
      digest = await runAbandonedPaymentsDigest(
        supabaseAdmin,
        resend,
        FROM_EMAIL,
        ALERT_EMAILS,
      );
    } catch (e) {
      const message = errMessage(e);
      console.error("[cron/daily-housekeeping:digest] threw:", message);
      digest = { abandoned: 0, lost: 0, sent: false, error: message };
    }
  }

  // ── Phase 3: subscription reminders ────────────────────────────────────
  let reminders;
  if (!resend) {
    console.error(
      "[cron/daily-housekeeping:reminders] RESEND_API_KEY not set — reminders skipped.",
    );
    reminders = {
      sent: 0,
      failed: 0,
      skipped: 0,
      error: "RESEND_API_KEY not configured",
    };
  } else {
    try {
      reminders = await runSubscriptionReminders(
        supabaseAdmin,
        resend,
        FROM_EMAIL,
      );
    } catch (e) {
      const message = errMessage(e);
      console.error("[cron/daily-housekeeping:reminders] threw:", message);
      reminders = { sent: 0, failed: 0, skipped: 0, error: message };
    }
  }

  // ── Phase 4: stale deliveries (READ-ONLY surface) ──────────────────────
  // No auto-resolution. Just a listing in the response so Sunny sees the
  // unresolved rows once a day (same list the bake-plan email carries).
  let stale;
  try {
    stale = await loadStaleDeliveries(supabaseAdmin);
  } catch (e) {
    const message = errMessage(e);
    console.error("[cron/daily-housekeeping:stale] threw:", message);
    stale = { count: 0, rows: [], error: message };
  }

  return NextResponse.json({ sweep, digest, reminders, stale });
}
