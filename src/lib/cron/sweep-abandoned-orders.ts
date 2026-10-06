// Phase 7 of /api/cron/daily-housekeeping — the orders half of the sweep.
//
// WHY THIS EXISTS. /api/create-order writes the orders row BEFORE the Razorpay
// modal opens, because /api/verify-payment and /api/razorpay-webhook need a
// concrete row to attribute money to. Subscriptions do the same thing and have
// had a sweeper since day one (@/lib/sweep-abandoned-subscriptions). ORDERS NEVER
// GOT ONE. All time on prod: 46 rows at payment_method='razorpay' +
// payment_status='created', ₹11,088, 5 Sep → 5 Oct 2026, and not one of them was
// ever touched by anything automatic. Every change on those rows was an operator
// editing them by hand.
//
// TWO BRANCHES, AND THE FIRST ONE IS THE IMPORTANT ONE.
//
//   RECONCILE — Razorpay says the order was paid while our row still says
//               `created`. The money is already out of the customer's account.
//               This marks the row paid, stamps paid_at, and fires the same admin
//               notification a normal online payment fires.
//
//               This is the only server-side backstop orders have. The webhook
//               was supposed to be it, but `mark_paid` and /api/verify-payment
//               write identical rows, so none of the 246 paid orders on prod is
//               evidence that a webhook was ever delivered at all — and
//               `payment_status='failed'`, which ONLY the webhook's `mark_failed`
//               branch can write, has never been written once in 292 razorpay
//               orders. A cron that asks Razorpay directly does not depend on a
//               delivery we cannot prove ever happens.
//
//   ABANDON   — Razorpay confirms the order was never paid, and nobody can pay it
//               any more. Writes payment_status='abandoned' so the state is
//               explicit instead of merely stale.
//
// WHO MAY BE ABANDONED — the rule, the prod evidence behind it and the reason it
// is NOT the subscriptions sweeper's 120 minutes all live with the predicate, in
// @/lib/order-abandonable. Read that before widening it; it is the decision that
// says money stopped being owed. Walk it with:
//
//   node scripts/abandonable-check.ts
//
// The 120 minutes below is a different question — the minimum age for LOOKING at
// a row — and stays here.
//
// IT NEVER DELETES AND IT NEVER TOUCHES `status`. Cancelling an order is a
// human's call; this only ever writes the payment columns. An abandoned row is
// therefore still on the admin board — the point is that its payment state now
// says what happened rather than implying a checkout is still open.
//
// IT NEVER THROWS. It shares a route with five other phases, including the email
// ones, and a bookkeeping sweep must not be the reason an owner stops receiving
// their digest. Failures come back in `error`.

import type { SupabaseClient } from "@supabase/supabase-js";

import { fetchRazorpayOrderPaidState } from "@/lib/razorpay-order-state";
import { ORDER_EXPIRY_MS } from "@/lib/order-state";
// The who-may-be-written-off rule lives in its own module so it can be walked
// through directly by scripts/abandonable-check.ts. It decides whether money
// stops being owed, which is too consequential to be only reachable by running
// the whole cron against Razorpay.
import { mayAbandon } from "@/lib/order-abandonable";
import { queueOrderNotification } from "@/lib/order-notification";

const LOG = "[cron/daily-housekeeping:orders-sweep]";

/**
 * Minimum age before a row is even looked at.
 *
 * Same 120 as the subscriptions sweeper, for the same reason: at 30 minutes it
 * was flagging legitimate UPI payments that were still completing (bank OTP, PIN
 * retries, an interrupting phone call). It also keeps the reconcile branch from
 * racing an in-flight /api/verify-payment, which would mark the row paid without
 * the razorpay_payment_id that verify is about to write.
 */
export const ORDER_SWEEP_MIN_AGE_MINUTES = 120;

/**
 * Rows older than this are not asked about at all.
 *
 * Without it, the 24 rows the abandon branch refuses to touch would be
 * re-queried at Razorpay every single day until the end of time, for an answer
 * that cannot change anything. A month is past Razorpay's own settlement
 * horizon; anything older is a person's reconciliation, not a cron's.
 */
const RECONCILE_WINDOW_DAYS = 30;

/** Cap per run. Newest first — recovery matters most where it is still fresh. */
const BATCH_LIMIT = 25;

/**
 * Wall-clock budget for the Razorpay calls.
 *
 * The route is capped at maxDuration = 60s and shares it with five other phases.
 * Each probe can take up to 15s if Razorpay hangs, so without a budget three bad
 * responses could eat the whole run. Rows not reached are simply reconsidered
 * tomorrow — this phase is idempotent and nothing it skips degrades.
 */
const BUDGET_MS = 20_000;

export type OrderSweepResult = {
  /** Rows asked about at Razorpay this run. */
  checked: number;
  /** Rows moved 'created' → 'paid' because Razorpay said they were paid. */
  reconciled: number;
  /** Rows moved 'created' → 'abandoned'. */
  abandoned: number;
  /**
   * Rows Razorpay confirmed were never paid but which this cron refuses to write
   * off, because they reached `confirmed` or beyond. These are the ones a person
   * has to settle; the count is here so the daily run states it out loud.
   */
  heldForReview: number;
  /** Rows Razorpay could not be asked about (network / 5xx). Left alone. */
  skipped: number;
  /** True when BUDGET_MS or BATCH_LIMIT cut the run short. */
  truncated: boolean;
  /** The age line a row had to be older than to qualify. */
  cutoff: string;
  /** Present only on failure. The caller continues regardless. */
  error?: string;
};

type Candidate = {
  id: string;
  order_number: string | null;
  status: string | null;
  razorpay_order_id: string | null;
  created_at: string | null;
};

export async function sweepAbandonedOrders(
  supabase: SupabaseClient,
): Promise<OrderSweepResult> {
  const startedMs = Date.now();
  const cutoff = new Date(
    startedMs - ORDER_SWEEP_MIN_AGE_MINUTES * 60 * 1000,
  ).toISOString();
  const floor = new Date(
    startedMs - RECONCILE_WINDOW_DAYS * 24 * 60 * 60 * 1000,
  ).toISOString();

  const empty: OrderSweepResult = {
    checked: 0,
    reconciled: 0,
    abandoned: 0,
    heldForReview: 0,
    skipped: 0,
    truncated: false,
    cutoff,
  };

  try {
    const { data: stale, error: findErr } = await supabase
      .from("orders")
      .select("id, order_number, status, razorpay_order_id, created_at")
      .eq("payment_method", "razorpay")
      .eq("payment_status", "created")
      .not("razorpay_order_id", "is", null)
      .is("razorpay_payment_id", null)
      .lt("created_at", cutoff)
      .gt("created_at", floor)
      .order("created_at", { ascending: false })
      .limit(BATCH_LIMIT);

    if (findErr) {
      console.error(`${LOG} find failed:`, findErr.message);
      return { ...empty, error: findErr.message };
    }
    if (!stale || stale.length === 0) return empty;

    const rows = stale as Candidate[];
    const toAbandon: string[] = [];
    let checked = 0;
    let reconciled = 0;
    let heldForReview = 0;
    let skipped = 0;
    let truncated = rows.length === BATCH_LIMIT;
    let firstError: string | undefined;

    for (const row of rows) {
      if (Date.now() - startedMs > BUDGET_MS) {
        truncated = true;
        console.warn(
          `${LOG} budget of ${BUDGET_MS}ms spent after ${checked} row(s) — the rest wait for tomorrow.`,
        );
        break;
      }
      const rzpId = row.razorpay_order_id;
      if (!rzpId) continue; // Defensive; the .not(...) filter excludes these.

      checked++;
      const state = await fetchRazorpayOrderPaidState(rzpId);

      if (state.paid === null) {
        skipped++;
        console.warn(
          `${LOG} skip order=${row.order_number ?? row.id} razorpay_order=${rzpId} (${state.reason}) — will reconsider next sweep.`,
        );
        continue;
      }

      if (state.paid === true) {
        // Compare-and-swap. If /api/verify-payment or the webhook landed between
        // the Razorpay read and this write, they win and this does nothing.
        const { data: updated, error: updErr } = await supabase
          .from("orders")
          .update({
            payment_status: "paid",
            paid_at: new Date().toISOString(),
          })
          .eq("id", row.id)
          .eq("payment_status", "created")
          .is("razorpay_payment_id", null)
          .select("id")
          .maybeSingle();

        if (updErr) {
          // Do NOT fall through to abandon — Razorpay says the customer paid.
          console.error(
            `${LOG} reconcile update failed for order=${row.order_number ?? row.id}:`,
            updErr.message,
          );
          firstError ??= updErr.message;
          skipped++;
          continue;
        }
        if (updated) {
          reconciled++;
          // The same admin alert a normal online payment fires. Deduped in
          // Postgres on (order, event), so this cannot double-send even if a
          // later run looks at the row again.
          queueOrderNotification(row.id, "paid");
          console.error(
            `${LOG} RECONCILED order=${row.order_number ?? row.id} razorpay_order=${rzpId} ` +
              `amount=${state.amountPaise} paise — Razorpay had the money and nothing in this ` +
              `system had noticed.`,
          );
        }
        // updated === null → the CAS lost to a concurrent write. Either way the
        // row is now someone else's correctly-written outcome. Leave it.
        continue;
      }

      // state.paid === false → confirmed never paid.
      if (mayAbandon(row, startedMs, ORDER_EXPIRY_MS)) {
        toAbandon.push(row.id);
      } else {
        heldForReview++;
      }
    }

    let abandoned = 0;
    if (toAbandon.length > 0) {
      const { data: swept, error: sweepErr } = await supabase
        .from("orders")
        .update({ payment_status: "abandoned" })
        .in("id", toAbandon)
        .eq("payment_status", "created")
        .is("razorpay_payment_id", null)
        .select("id");

      if (sweepErr) {
        console.error(`${LOG} abandon update failed:`, sweepErr.message);
        firstError ??= sweepErr.message;
      } else {
        abandoned = (swept ?? []).length;
      }
    }

    console.log(
      `${LOG} checked ${checked} · reconciled ${reconciled} · abandoned ${abandoned} · ` +
        `held for review ${heldForReview} · skipped ${skipped} · min age ${ORDER_SWEEP_MIN_AGE_MINUTES}m` +
        (truncated ? " · TRUNCATED" : ""),
    );

    return {
      checked,
      reconciled,
      abandoned,
      heldForReview,
      skipped,
      truncated,
      cutoff,
      error: firstError,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} threw:`, message);
    return { ...empty, error: message };
  }
}
