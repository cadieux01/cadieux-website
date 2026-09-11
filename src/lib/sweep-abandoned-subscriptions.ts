// Sweeping unpaid subscription shells.
//
// This used to be its own cron route. It was folded into
// /api/cron/daily-housekeeping because Vercel Hobby allows two cron entries
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
// RECONCILE BEFORE ABANDON
// There is no Razorpay webhook for subscriptions. The app's verify call is
// the only path from 'created' to 'paid'. If a customer pays and the app
// dies before verify, this sweep is the last line of defence against
// abandoning a subscription Razorpay has already collected money for.
//
// So for every stale 'created' row that has a razorpay_order_id, this
// asks Razorpay directly (GET /v1/orders/{id}) whether that order was
// paid. If it was, the row is marked paid AND reconciled_at is stamped
// — that timestamp is the durable receipt saying "the sweeper found this,
// not the verify path". The abandon branch only runs for rows Razorpay
// confirms were never paid. A Razorpay API failure leaves the row alone
// for the next sweep (a subscription with real money against it is worth
// waiting a day for; the cost is one extra unresolved row in logs).
//
// SAFETY
//   • Only touches rows that have a razorpay_order_id and NO
//     razorpay_payment_id — i.e. we raised an order and nothing came back.
//   • Every UPDATE re-asserts payment_status='created' AND
//     razorpay_payment_id IS NULL as a compare-and-swap, so a payment that
//     verifies in the same instant wins and is never overwritten.
//   • 120 minutes was chosen after 30 min flagged legitimate UPI
//     completions (bank OTP, PIN retries, an interrupting phone call). It
//     is still far longer than a Razorpay checkout session, so a customer
//     still staring at the sheet cannot be swept mid-payment.
//
// IT NEVER THROWS. It shares a cron route with the abandoned-payment
// digest, and a bookkeeping sweep must never be the reason an owner stops
// receiving the list of customers who nearly bought something. Failures
// come back in `error` and are logged under this module's own tag so a
// broken sweep is still visible in a run that otherwise reports success.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Resend } from "resend";

/**
 * How long an unpaid shell is given before it's written off.
 *
 * WHY 120: at 30 min the sweeper was killing legitimate UPI payments that
 * were still completing (bank OTP, PIN retries, a phone call). 120 covers
 * the long tail without holding inventory in limbo. Note that the sweep
 * only runs once a day at 09:00 IST, so this is a MINIMUM age, not a
 * deadline — a row created at 09:30 waits ~23.5 h before it's even
 * considered. The client-side "resume payment" surface reads server
 * status; it is not gated on this constant.
 */
export const ABANDON_AFTER_MINUTES = 120;

/** Cap per run so one sweep can't stall on a backlog. */
const BATCH_LIMIT = 200;

const LOG = "[cron/daily-housekeeping:sweep]";

/** One row's worth of reconciliation record, used for the alert email. */
export type ReconciledRow = {
  subscription_id: string;
  razorpay_order_id: string;
  amount_paise: number;
  customer_id: string | null;
};

export type SweepResult = {
  /** Subscriptions moved 'created' → 'abandoned' this run. */
  swept: number;
  /**
   * Subscriptions moved 'created' → 'paid' this run because Razorpay said
   * so even though the app never verified. These are the "app died
   * mid-payment" recoveries; the row's reconciled_at timestamp is the
   * durable marker.
   */
  reconciled: number;
  /** Child deliveries cancelled as a consequence of the abandon branch. */
  deliveriesCancelled: number;
  /** The age line rows had to be older than to qualify. */
  cutoff: string;
  /**
   * Rows Razorpay could not be asked about this run (network / 5xx). They
   * were left completely alone and will be reconsidered next sweep.
   */
  skipped: number;
  /** Present only on failure. The caller continues regardless. */
  error?: string;
};

/**
 * GET https://api.razorpay.com/v1/orders/{id}
 *
 * Returns:
 *   { paid: true, amountPaise }   — Razorpay says the order was paid
 *   { paid: false }               — Razorpay says the order was not paid
 *   { paid: null }                — network / auth / 5xx; sweeper must NOT act on this row
 */
async function fetchRazorpayOrderPaidState(
  razorpayOrderId: string,
): Promise<{ paid: true; amountPaise: number } | { paid: false } | { paid: null; reason: string }> {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) return { paid: null, reason: "razorpay_credentials_missing" };

  const auth = Buffer.from(`${key}:${secret}`).toString("base64");
  let res: Response;
  try {
    res = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        // Razorpay is normally fast; a slow response here shouldn't stall
        // the whole cron. AbortSignal.timeout is Node 18+, safe on Vercel.
        signal: AbortSignal.timeout(15_000),
      },
    );
  } catch (e) {
    return { paid: null, reason: e instanceof Error ? e.message : String(e) };
  }

  // 404 from Razorpay: the id we stored doesn't exist there. Treat as
  // "confirmed never paid" so it can be abandoned — the alternative is
  // holding a phantom order in limbo forever.
  if (res.status === 404) return { paid: false };
  if (!res.ok) return { paid: null, reason: `razorpay_http_${res.status}` };

  const body = (await res.json().catch(() => null)) as
    | { status?: string; amount?: number; amount_paid?: number }
    | null;
  if (!body || typeof body.status !== "string") {
    return { paid: null, reason: "razorpay_bad_response" };
  }

  // Authoritative signal is status='paid'. amount_paid>=amount catches a
  // corner case where a partial-capture flow ever left status behind, but
  // status is the source of truth in the current API.
  const isPaid =
    body.status === "paid" ||
    (typeof body.amount === "number" &&
      typeof body.amount_paid === "number" &&
      body.amount > 0 &&
      body.amount_paid >= body.amount);

  if (!isPaid) return { paid: false };
  return {
    paid: true,
    amountPaise:
      typeof body.amount_paid === "number" && body.amount_paid > 0
        ? body.amount_paid
        : typeof body.amount === "number"
          ? body.amount
          : 0,
  };
}

/** Send the alert email listing rows this sweep reconciled. Never throws. */
async function sendReconciledAlert(
  resend: Resend | null,
  fromEmail: string,
  alertEmails: string[],
  rows: ReconciledRow[],
): Promise<void> {
  if (rows.length === 0) return;
  if (!resend) {
    console.error(
      `${LOG} reconciled ${rows.length} row(s) but RESEND_API_KEY not set — no alert sent.`,
    );
    return;
  }
  if (alertEmails.length === 0) {
    console.error(`${LOG} reconciled ${rows.length} row(s) but no ALERT_EMAILS configured.`);
    return;
  }

  const rupees = (paise: number) => (paise / 100).toFixed(2);

  const subject =
    rows.length === 1
      ? `1 subscription paid but never verified — sweeper found it`
      : `${rows.length} subscriptions paid but never verified — sweeper found them`;

  const textLines = [
    `Razorpay confirmed these subscription payments even though the app never called verify.`,
    `The rows have been marked paid and stamped reconciled_at.`,
    `Someone should reach out to each customer to confirm the delivery schedule.`,
    "",
    ...rows.map(
      (r) =>
        `subscription ${r.subscription_id}  order ${r.razorpay_order_id}  ₹${rupees(r.amount_paise)}`,
    ),
  ];

  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;color:#1a1a1a;max-width:560px">
      <p style="font-size:16px;margin:0 0 12px">
        <strong>${rows.length}</strong> subscription${rows.length === 1 ? "" : "s"}
        ${rows.length === 1 ? "was" : "were"} paid on Razorpay but the app never called verify.
      </p>
      <p style="font-size:14px;color:#333;margin:0 0 16px">
        The sweeper has marked ${rows.length === 1 ? "it" : "them"} paid and stamped
        <code>reconciled_at</code>. Please reach out to each customer to confirm the delivery
        schedule — they have not been sent the normal confirmation.
      </p>
      <table style="border-collapse:collapse;width:100%;font-size:13px">
        <tr style="text-align:left;color:#666">
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Subscription</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Razorpay order</th>
          <th style="padding:6px 8px;border-bottom:1px solid #ddd">Amount</th>
        </tr>
        ${rows
          .map(
            (r) => `
        <tr>
          <td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace">${escapeHtml(r.subscription_id)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace">${escapeHtml(r.razorpay_order_id)}</td>
          <td style="padding:8px;border-bottom:1px solid #eee">₹${escapeHtml(rupees(r.amount_paise))}</td>
        </tr>`,
          )
          .join("")}
      </table>
    </div>`;

  try {
    const { error: sendErr } = await resend.emails.send({
      from: fromEmail,
      to: alertEmails,
      subject,
      html,
      text: textLines.join("\n"),
    });
    if (sendErr) {
      console.error(`${LOG} reconcile alert send failed:`, sendErr.message);
    }
  } catch (e) {
    console.error(
      `${LOG} reconcile alert threw:`,
      e instanceof Error ? e.message : String(e),
    );
  }
}

export type SweeperEmailContext = {
  resend: Resend | null;
  fromEmail: string;
  alertEmails: string[];
};

export async function sweepAbandonedSubscriptions(
  supabase: SupabaseClient,
  email?: SweeperEmailContext,
): Promise<SweepResult> {
  const cutoff = new Date(
    Date.now() - ABANDON_AFTER_MINUTES * 60 * 1000,
  ).toISOString();
  const empty: SweepResult = {
    swept: 0,
    reconciled: 0,
    deliveriesCancelled: 0,
    skipped: 0,
    cutoff,
  };

  try {
    // razorpay_order_id and customer_id are new selects — the sweeper now
    // uses the order id to ask Razorpay directly, and carries customer_id
    // into the alert email so an operator has something to call.
    const { data: stale, error: findErr } = await supabase
      .from("subscriptions")
      .select("id, razorpay_order_id, customer_id")
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

    // Split the batch by asking Razorpay row-by-row. Sequential is fine —
    // BATCH_LIMIT is 200, Razorpay is fast, and it keeps errors isolated.
    const toAbandon: string[] = [];
    const reconciledRows: ReconciledRow[] = [];
    let skipped = 0;

    for (const row of stale) {
      const rzpId = row.razorpay_order_id as string | null;
      if (!rzpId) {
        // Defensive; the .not(...) filter already excludes these.
        continue;
      }
      const state = await fetchRazorpayOrderPaidState(rzpId);
      if (state.paid === null) {
        skipped++;
        console.warn(
          `${LOG} skip sub=${row.id} razorpay_order=${rzpId} (${state.reason}) — will reconsider next sweep.`,
        );
        continue;
      }
      if (state.paid === true) {
        // Compare-and-swap into paid. reconciled_at is the marker that
        // says "this went through the sweeper, not verify".
        const now = new Date().toISOString();
        const { data: updated, error: updErr } = await supabase
          .from("subscriptions")
          .update({
            payment_status: "paid",
            payment_method: "razorpay",
            paid_at: now,
            reconciled_at: now,
            updated_at: now,
          })
          .eq("id", row.id)
          .eq("payment_status", "created")
          .is("razorpay_payment_id", null)
          .select("id")
          .maybeSingle();

        if (updErr) {
          // Do NOT fall through to abandon — Razorpay says the customer paid.
          console.error(
            `${LOG} reconcile update failed for sub=${row.id}:`,
            updErr.message,
          );
          skipped++;
          continue;
        }
        if (updated) {
          reconciledRows.push({
            subscription_id: row.id as string,
            razorpay_order_id: rzpId,
            amount_paise: state.amountPaise,
            customer_id: (row.customer_id as string | null) ?? null,
          });
          console.log(
            `${LOG} reconciled sub=${row.id} razorpay_order=${rzpId} amount=${state.amountPaise} paise`,
          );
        }
        // If updated is null the CAS lost to a concurrent write — the row
        // is either already paid (verify won) or already abandoned by a
        // previous partial run. Either way, do nothing more with it.
        continue;
      }
      // state.paid === false → confirmed never paid, safe to abandon.
      toAbandon.push(row.id as string);
    }

    let sweptIds: string[] = [];
    let deliveriesCancelled = 0;
    let sweepError: string | undefined;

    if (toAbandon.length > 0) {
      // Compare-and-swap on the abandon branch too. If a payment verified
      // between the Razorpay check and this UPDATE (highly unlikely — we
      // already asked Razorpay and got 'not paid') the CAS drops the row.
      const { data: swept, error: sweepErr } = await supabase
        .from("subscriptions")
        .update({
          payment_status: "abandoned",
          updated_at: new Date().toISOString(),
        })
        .in("id", toAbandon)
        .eq("payment_status", "created")
        .is("razorpay_payment_id", null)
        .select("id");

      if (sweepErr) {
        console.error(`${LOG} update failed:`, sweepErr.message);
        sweepError = sweepErr.message;
      } else {
        sweptIds = (swept || []).map((s) => s.id as string);

        if (sweptIds.length > 0) {
          // Cancel the child deliveries too. Nothing in this repo reads
          // them outside a subscription-scoped query, but the logistics
          // dashboard is a separate app — leaving live delivery rows
          // attached to a dead subscription is how bread gets baked for a
          // customer who never paid.
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
            console.error(`${LOG} delivery cascade failed:`, delErr.message);
            sweepError = delErr.message;
          } else {
            deliveriesCancelled = (cancelled || []).length;
          }
        }
      }
    }

    // Alert email fires only when reconciliation happened. A pure-abandon
    // sweep is not surprising and doesn't need an alert (the digest
    // covers the "someone almost bought" story separately).
    if (reconciledRows.length > 0 && email) {
      await sendReconciledAlert(
        email.resend,
        email.fromEmail,
        email.alertEmails,
        reconciledRows,
      );
    }

    console.log(
      `${LOG} swept ${sweptIds.length} · reconciled ${reconciledRows.length} · deliveries cancelled ${deliveriesCancelled} · skipped ${skipped} · cutoff ${ABANDON_AFTER_MINUTES}m`,
    );

    return {
      swept: sweptIds.length,
      reconciled: reconciledRows.length,
      deliveriesCancelled,
      skipped,
      cutoff,
      error: sweepError,
    };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`${LOG} threw:`, message);
    return { ...empty, error: message };
  }
}
