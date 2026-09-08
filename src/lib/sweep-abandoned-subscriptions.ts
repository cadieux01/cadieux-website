// Sweeping unpaid subscription shells.
//
// This used to be its own cron route. It was folded into
// /api/cron/abandoned-payments because Vercel Hobby allows two cron entries
// per project and we already had two — a third would have been dropped or
// failed the deploy silently, which is the exact invisible failure the
// 500-vs-401 auth split exists to prevent.
//
// WHY THIS EXISTS
// A prepaid subscription row is written BEFORE the customer pays (see the
// comment above createSubscriptionRazorpayOrder in /api/checkout). That
// ordering is deliberate — the alternative can take money and then lose the
// record of what was ordered. Its cost is that closing the Razorpay sheet
// leaves an unpaid shell behind, at payment_status='created'.
//
// Those shells are already invisible (see @/lib/subscription-visibility),
// but invisible is not the same as resolved. This gives up on them after
// ABANDON_AFTER_MINUTES and marks them 'abandoned' so the state is explicit
// rather than merely filtered.
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
// IT NEVER THROWS. It shares a cron route with the abandoned-payment digest,
// and a bookkeeping sweep must never be the reason an owner stops receiving
// the list of customers who nearly bought something. Failures come back in
// `error` and are logged under this module's own tag so a broken sweep is
// still visible in a run that otherwise reports success.

import type { SupabaseClient } from "@supabase/supabase-js";

/** How long an unpaid shell is given before it's written off. */
export const ABANDON_AFTER_MINUTES = 30;

/** Cap per run so one sweep can't stall on a backlog. */
const BATCH_LIMIT = 200;

const LOG = "[cron/abandoned-payments:sweep]";

export type SweepResult = {
  /** Subscriptions moved 'created' → 'abandoned' this run. */
  swept: number;
  /** Child deliveries cancelled as a consequence. */
  deliveriesCancelled: number;
  /** The age line rows had to be older than to qualify. */
  cutoff: string;
  /** Present only on failure. The caller continues regardless. */
  error?: string;
};

export async function sweepAbandonedSubscriptions(
  supabase: SupabaseClient,
): Promise<SweepResult> {
  const cutoff = new Date(
    Date.now() - ABANDON_AFTER_MINUTES * 60 * 1000,
  ).toISOString();
  const empty: SweepResult = { swept: 0, deliveriesCancelled: 0, cutoff };

  try {
    const { data: stale, error: findErr } = await supabase
      .from("subscriptions")
      .select("id")
      .eq("payment_status", "created")
      .not("razorpay_order_id", "is", null)
      .is("razorpay_payment_id", null)
      .lt("created_at", cutoff)
      .limit(BATCH_LIMIT);

    if (findErr) {
      console.error(`${LOG} find failed:`, findErr.message);
      return { ...empty, error: findErr.message };
    }
    if (!stale || stale.length === 0) return empty;

    // Compare-and-swap: re-assert the unpaid conditions inside the UPDATE.
    // Only rows still unpaid at write time are returned, so a payment that
    // verified between the SELECT and here is left completely alone.
    const { data: swept, error: sweepErr } = await supabase
      .from("subscriptions")
      .update({
        payment_status: "abandoned",
        updated_at: new Date().toISOString(),
      })
      .in(
        "id",
        stale.map((s) => s.id),
      )
      .eq("payment_status", "created")
      .is("razorpay_payment_id", null)
      .select("id");

    if (sweepErr) {
      console.error(`${LOG} update failed:`, sweepErr.message);
      return { ...empty, error: sweepErr.message };
    }

    const sweptIds = (swept || []).map((s) => s.id);
    if (sweptIds.length === 0) return empty;

    // Cancel the child deliveries too. Nothing in this repo reads them
    // outside a subscription-scoped query, but the logistics dashboard is a
    // separate app — leaving live delivery rows attached to a dead
    // subscription is how bread gets baked for a customer who never paid.
    const { data: cancelled, error: delErr } = await supabase
      .from("subscription_deliveries")
      .update({
        status: "cancelled",
        status_updated_at: new Date().toISOString(),
      })
      .in("subscription_id", sweptIds)
      .not("status", "in", "(delivered,cancelled)")
      .select("id");

    if (delErr) {
      // The subscriptions ARE swept — report the partial win, don't discard it.
      console.error(`${LOG} delivery cascade failed:`, delErr.message);
      return {
        swept: sweptIds.length,
        deliveriesCancelled: 0,
        cutoff,
        error: delErr.message,
      };
    }

    console.log(
      `${LOG} swept ${sweptIds.length} unpaid shell(s) older than ${ABANDON_AFTER_MINUTES}m, cancelled ${(cancelled || []).length} delivery(ies)`,
    );

    return {
      swept: sweptIds.length,
      deliveriesCancelled: (cancelled || []).length,
      cutoff,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} threw:`, message);
    return { ...empty, error: message };
  }
}
