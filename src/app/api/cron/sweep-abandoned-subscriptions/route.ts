// GET /api/cron/sweep-abandoned-subscriptions
//
// Vercel Cron entry point. Runs daily at 04:00 UTC (09:30 IST). See vercel.json.
//
// Auth: Bearer ${CRON_SECRET}, same as the other two crons.
//
// WHY DAILY IS ENOUGH
// Nothing user-facing waits on this. An unpaid shell is invisible to the
// customer and to the admin list from the instant it is written — that is
// @/lib/subscription-visibility's job, and it is synchronous. This cron only
// converts "filtered out" into "explicitly written off", which is bookkeeping.
//
// WHY THIS EXISTS
// A prepaid subscription row is written BEFORE the customer pays (see the
// comment above createSubscriptionRazorpayOrder in /api/checkout). That
// ordering is deliberate — the alternative can take money and then lose the
// record of what was ordered. Its cost is that closing the Razorpay sheet
// leaves an unpaid shell behind, at payment_status='created'.
//
// Those shells are already invisible (see @/lib/subscription-visibility),
// but invisible is not the same as resolved. This sweeper gives up on them
// after ABANDON_AFTER_MINUTES and marks them 'abandoned' so the state is
// explicit rather than merely filtered.
//
// IT NEVER DELETES. The audit trail is the point: if a payment turns up
// later in a Razorpay reconciliation, the row it belongs to is still here,
// with its razorpay_order_id intact to match on.
//
// SAFETY
//   • Only touches rows that have a razorpay_order_id and NO
//     razorpay_payment_id — i.e. we raised an order and nothing came back.
//   • The UPDATE re-asserts payment_status='created' AND
//     razorpay_payment_id IS NULL as a compare-and-swap, so a payment that
//     verifies in the same instant wins and is never overwritten.
//   • 30 minutes is far longer than a Razorpay checkout session, so a
//     customer still staring at the sheet cannot be swept mid-payment.
//
// Response shape: { swept: number, deliveriesCancelled: number, cutoff: string }

import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const supabaseAdmin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

/** How long an unpaid shell is given before it's written off. */
const ABANDON_AFTER_MINUTES = 30;

/** Cap per run so one sweep can't stall on a backlog. */
const BATCH_LIMIT = 200;

export async function GET(req: NextRequest) {
  // A missing CRON_SECRET and a wrong Authorization header are two different
  // problems and must not produce the same response. Collapsed into one 401,
  // a cron that has been silently dead since it shipped is indistinguishable
  // in the logs from someone probing the endpoint.
  //   500 = our configuration is broken, nothing is ever getting swept.
  //   401 = config is fine, that caller just isn't authorised.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    console.error(
      "[cron/sweep-abandoned-subscriptions] CRON_SECRET is not set — this cron cannot run.",
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

  const cutoff = new Date(
    Date.now() - ABANDON_AFTER_MINUTES * 60 * 1000,
  ).toISOString();

  const { data: stale, error: findErr } = await supabaseAdmin
    .from("subscriptions")
    .select("id")
    .eq("payment_status", "created")
    .not("razorpay_order_id", "is", null)
    .is("razorpay_payment_id", null)
    .lt("created_at", cutoff)
    .limit(BATCH_LIMIT);

  if (findErr) {
    console.error("[sweep-abandoned-subscriptions] find:", findErr.message);
    return NextResponse.json({ error: findErr.message }, { status: 500 });
  }

  if (!stale || stale.length === 0) {
    return NextResponse.json({ swept: 0, deliveriesCancelled: 0, cutoff });
  }

  const ids = stale.map((s) => s.id);

  // Compare-and-swap: re-assert the unpaid conditions inside the UPDATE.
  // Only rows still unpaid at write time are returned, so a payment that
  // verified between the SELECT and here is left completely alone.
  const { data: swept, error: sweepErr } = await supabaseAdmin
    .from("subscriptions")
    .update({ payment_status: "abandoned", updated_at: new Date().toISOString() })
    .in("id", ids)
    .eq("payment_status", "created")
    .is("razorpay_payment_id", null)
    .select("id");

  if (sweepErr) {
    console.error("[sweep-abandoned-subscriptions] update:", sweepErr.message);
    return NextResponse.json({ error: sweepErr.message }, { status: 500 });
  }

  const sweptIds = (swept || []).map((s) => s.id);
  if (sweptIds.length === 0) {
    return NextResponse.json({ swept: 0, deliveriesCancelled: 0, cutoff });
  }

  // Cancel the child deliveries too. Nothing in this repo reads them outside
  // a subscription-scoped query, but the logistics dashboard is a separate
  // app — leaving live delivery rows attached to a dead subscription is how
  // bread gets baked for a customer who never paid.
  const { data: cancelled, error: delErr } = await supabaseAdmin
    .from("subscription_deliveries")
    .update({
      status: "cancelled",
      status_updated_at: new Date().toISOString(),
    })
    .in("subscription_id", sweptIds)
    .not("status", "in", "(delivered,cancelled)")
    .select("id");

  if (delErr) {
    // The subscriptions ARE swept — don't fail the run over the cascade.
    console.error(
      "[sweep-abandoned-subscriptions] delivery cascade:",
      delErr.message,
    );
  }

  console.log(
    `[sweep-abandoned-subscriptions] swept ${sweptIds.length} unpaid shells older than ${ABANDON_AFTER_MINUTES}m`,
  );

  return NextResponse.json({
    swept: sweptIds.length,
    deliveriesCancelled: (cancelled || []).length,
    cutoff,
  });
}
