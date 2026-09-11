// Razorpay plumbing for PREPAID subscriptions.
//
// Subscriptions are prepaid-only — the whole plan is paid up front before
// the first delivery. There is no COD path. Enforced in code here AND in the
// database by the BEFORE INSERT trigger `tg_subscriptions_assert_not_cod` on
// public.subscriptions, which raises
// 'Subscriptions are prepaid; payment_method must not be cod'.
//
// Note for anyone verifying that claim: it is a TRIGGER, not a CHECK
// constraint, so `pg_constraint` comes back empty for it. Query `pg_trigger`
// as well before concluding the database is unprotected.
//
// Mirrors the one-time order pair /api/create-order + /api/verify-payment
// exactly: the row is inserted with payment_status='created' and the
// razorpay_order_id, and is ONLY flipped to 'paid' after the HMAC
// signature is verified server-side AND Razorpay independently confirms
// the payment is captured for the exact server-stored amount.

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { toPaise } from "@/lib/subscription-delivery-fee";
import { ADMIN_PHONE } from "@/lib/delivery-slots";
import { queueOrphanedPaymentAlert } from "@/lib/orphaned-payment-alert";

export type RazorpayOrder = {
  id: string;
  amount: number; // paise
  currency: string;
};

export type RazorpayOrderResult =
  | { ok: true; order: RazorpayOrder }
  | { ok: false; status: number; error: string };

function credentials(): { key: string; secret: string } | null {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) return null;
  return { key, secret };
}

/**
 * Create a Razorpay order for the server-authoritative subscription total.
 * The amount is derived on the server; the client cannot influence it.
 */
export async function createSubscriptionRazorpayOrder(
  grandTotalInr: number,
): Promise<RazorpayOrderResult> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, status: 503, error: "Razorpay not configured" };
  }
  const amount = toPaise(grandTotalInr);
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, status: 400, error: "Invalid subscription amount." };
  }

  const auth = Buffer.from(`${creds.key}:${creds.secret}`).toString("base64");
  const res = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount,
      currency: "INR",
      receipt: `cadieux_sub_${Date.now()}`,
      notes: { kind: "subscription" },
    }),
  });
  const rzp = (await res.json()) as {
    id?: string;
    amount?: number;
    currency?: string;
    error?: { description?: string };
  };
  if (!res.ok || !rzp.id) {
    return {
      ok: false,
      status: 500,
      error: rzp.error?.description ?? "Razorpay error",
    };
  }
  return {
    ok: true,
    order: {
      id: rzp.id,
      amount: rzp.amount ?? amount,
      currency: rzp.currency ?? "INR",
    },
  };
}

/** Constant-time hex compare; false on any length/format mismatch. */
function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  if (ab.length === 0 || ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

export type VerifyInput = {
  subscription_id: string;
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
};

/**
 * Customer-facing copy for a payment that landed after the subscription was
 * already written off. Exported so the website and the app say exactly the
 * same thing — this is the one message where drift would be expensive.
 *
 * It must do five things: confirm the money arrived (it did), state plainly
 * that nothing is scheduled, commit to a callback, stop them paying twice, and
 * give them a number so they are never stuck waiting on us to call first.
 *
 * ADMIN_PHONE is the single NAP-consistent number used everywhere else on the
 * site — do not inline a literal here.
 */
export const ORPHANED_PAYMENT_MESSAGE =
  `Your payment went through — thank you. This subscription had already ` +
  `expired before the payment reached us, so nothing is scheduled yet. ` +
  `We'll call you within 24 hours to restart it or refund you in full. ` +
  `Please don't pay again. If you'd rather not wait, call us at ${ADMIN_PHONE}.`;

export type VerifyResult =
  | { ok: true; subscription_id: string; already?: true }
  | {
      ok: false;
      status: number;
      error: string;
      code?: string;
      subscription_id?: string;
    };

/**
 * Verify a subscription payment and mark it paid.
 *
 * Chain (any failure → NOT marked paid):
 *   1. HMAC_SHA256(order_id|payment_id, KEY_SECRET) === signature
 *   2. the subscription row exists and its stored razorpay_order_id matches
 *   3. Razorpay's own record is `captured`, for this order, for the exact
 *      server-stored total_amount
 *
 * Idempotent — a row already 'paid' returns success without re-writing.
 *
 * `scope` narrows the row lookup (e.g. to the calling customer) so one
 * customer can never mark another customer's subscription paid.
 */
export async function verifySubscriptionPayment(
  supabase: SupabaseClient,
  input: VerifyInput,
  scope?: { customer_id?: string },
): Promise<VerifyResult> {
  const creds = credentials();
  if (!creds) {
    return { ok: false, status: 503, error: "Razorpay not configured" };
  }

  const { subscription_id, razorpay_order_id, razorpay_payment_id, razorpay_signature } =
    input;
  if (
    !subscription_id ||
    !razorpay_order_id ||
    !razorpay_payment_id ||
    !razorpay_signature
  ) {
    return { ok: false, status: 400, error: "Missing fields" };
  }

  // 1. Signature — proves the payload came from Razorpay.
  const expected = crypto
    .createHmac("sha256", creds.secret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");
  if (!safeEqualHex(expected, razorpay_signature)) {
    console.warn("⚠️  subscription verify signature mismatch", {
      subscription_id,
      razorpay_order_id,
    });
    return {
      ok: false,
      status: 400,
      error: "Payment verification failed.",
      code: "signature_invalid",
    };
  }

  // 2. Bind the razorpay order to OUR row.
  let query = supabase
    .from("subscriptions")
    // subscription_number / customer_name / customer_phone are read only so
    // the orphan alert below can identify the row and the human to call
    // without a second round trip on the unhappy path.
    .select(
      "id, total_amount, razorpay_order_id, payment_status, customer_id, subscription_number, customer_name, customer_phone",
    )
    .eq("id", subscription_id);
  if (scope?.customer_id) query = query.eq("customer_id", scope.customer_id);

  const { data: sub, error: subErr } = await query.maybeSingle();
  if (subErr) {
    console.error("[subscription verify] fetch failed:", subErr.message);
    return { ok: false, status: 500, error: "Failed to verify subscription" };
  }
  if (!sub) {
    return { ok: false, status: 404, error: "Subscription not found." };
  }
  if (sub.razorpay_order_id !== razorpay_order_id) {
    console.warn("⚠️  subscription verify order id mismatch", {
      subscription_id,
      stored: sub.razorpay_order_id,
      sent: razorpay_order_id,
    });
    return {
      ok: false,
      status: 400,
      error: "Payment verification failed.",
      code: "order_mismatch",
    };
  }

  if (sub.payment_status === "paid") {
    return { ok: true, subscription_id: sub.id as string, already: true };
  }

  // Already orphaned — this is a RETRY of a verify we have already recorded.
  //
  // This return is load-bearing, not defensive padding. Without it the row is
  // no longer 'abandoned', so the orphan guard below would not fire, and the
  // final mark-paid update would: its CAS is only `.neq(payment_status,
  // 'paid')`, which 'paid_orphaned' satisfies. A single refresh or an app
  // retry would silently launder an orphan into an ordinary paid subscription
  // whose deliveries are all cancelled — precisely the failure this guard
  // exists to prevent, reintroduced through the back door.
  //
  // Returns the same 409 as the first attempt so the customer sees the same
  // copy, but does NOT re-write the row and does NOT re-ring the doorbell:
  // one orphan is one email, however many times the client retries.
  if (sub.payment_status === "paid_orphaned") {
    return {
      ok: false,
      status: 409,
      error: ORPHANED_PAYMENT_MESSAGE,
      code: "subscription_orphaned",
      subscription_id: sub.id as string,
    };
  }

  // 3. Independently confirm capture + amount with Razorpay.
  const auth = Buffer.from(`${creds.key}:${creds.secret}`).toString("base64");
  const payRes = await fetch(
    `https://api.razorpay.com/v1/payments/${encodeURIComponent(razorpay_payment_id)}`,
    { headers: { Authorization: `Basic ${auth}` } },
  );
  const payment = (await payRes.json()) as {
    status?: string;
    order_id?: string;
    amount?: number;
    error?: { description?: string };
  };
  if (!payRes.ok) {
    return {
      ok: false,
      status: 502,
      error: payment.error?.description ?? "Razorpay lookup failed",
    };
  }

  const expectedAmount = toPaise(Number(sub.total_amount));
  if (
    payment.status !== "captured" ||
    payment.order_id !== razorpay_order_id ||
    payment.amount !== expectedAmount
  ) {
    console.warn("⚠️  subscription verify payment state mismatch", {
      subscription_id,
      status: payment.status,
      payment_order: payment.order_id,
      amount: payment.amount,
      expectedAmount,
    });
    return {
      ok: false,
      status: 400,
      error: "Payment not captured.",
      code: "not_captured",
    };
  }

  // ── Orphan guard ────────────────────────────────────────────────────────
  //
  // The payment is real and captured — but the sweeper already wrote this row
  // off as 'abandoned' and CASCADED its deliveries to 'cancelled' (see
  // @/lib/sweep-abandoned-subscriptions). Marking it plainly 'paid' here would
  // produce a subscription that looks active and has nothing to deliver:
  // money taken, bread not baked, and nothing surfacing it.
  //
  // We do NOT restore the deliveries. Their dates are very likely in the past
  // by now, and reinstating them would manufacture bake commitments Sunny
  // never agreed to. We do NOT auto-refund either — the customer may well
  // prefer their bread on new dates. That decision is his, not the code's.
  //
  // So: record the money against the row in a state that cannot be mistaken
  // for an activation, tell him, and stop.
  //
  // This is the backstop for payments landing AFTER the reconcile window.
  // Reconcile-before-abandon catches the common case earlier and turns those
  // into ordinary paid subscriptions; the two cover different time ranges of
  // the same failure and must not be collapsed into one another.
  if (sub.payment_status === "abandoned") {
    // Compare-and-swap on 'abandoned' so a concurrent writer (a reconcile run
    // rescuing the same row) cannot be clobbered — whoever lands first wins.
    const { data: orphaned, error: orphanErr } = await supabase
      .from("subscriptions")
      .update({
        payment_status: "paid_orphaned",
        payment_method: "razorpay",
        razorpay_payment_id,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        // `status` is deliberately NOT written — it stays pending_confirmation.
        // `reconciled_at` is deliberately NOT written — that column means
        // "auto-rescued, now a normal subscription", which is the opposite of
        // this. Confusing the two would hide an orphan inside the rescue path.
      })
      .eq("id", sub.id)
      .eq("payment_status", "abandoned")
      .select("id");

    if (orphanErr) {
      console.error("[subscription verify] orphan record failed:", orphanErr.message);
      return { ok: false, status: 500, error: "Failed to record payment" };
    }

    // Zero rows means the CAS lost — something else moved the row between our
    // read and this write. Re-read rather than guess which state it landed in.
    if (!orphaned || orphaned.length === 0) {
      const { data: fresh } = await supabase
        .from("subscriptions")
        .select("payment_status")
        .eq("id", sub.id)
        .maybeSingle();
      if (fresh?.payment_status === "paid") {
        return { ok: true, subscription_id: sub.id as string, already: true };
      }
      console.warn("[subscription verify] orphan CAS lost", {
        subscription_id: sub.id,
        now: fresh?.payment_status,
      });
    } else {
      console.warn("[subscription verify] ORPHANED PAYMENT", {
        subscription_id: sub.id,
        razorpay_payment_id,
        amount: sub.total_amount,
      });
      // Doorbell only. The durable surfaces are the row's own status on the
      // admin board and the daily orphaned-payments phase.
      queueOrphanedPaymentAlert({
        id: sub.id as string,
        subscription_number: sub.subscription_number as string | null,
        customer_name: sub.customer_name as string | null,
        customer_phone: sub.customer_phone as string | null,
        total_amount: sub.total_amount as number | null,
        razorpay_payment_id,
        razorpay_order_id,
      });
    }

    // ok:false ON PURPOSE, even though the payment succeeded.
    //
    // Any client that checks only `ok` then gets the fail-safe default. With
    // ok:true a naive caller would tell the customer "confirmed" and they
    // would wait for bread that is never coming. With ok:false the worst case
    // is an alarmed customer who phones us — recoverable. Clients that know
    // this code render ORPHANED_PAYMENT_MESSAGE instead of a generic failure.
    return {
      ok: false,
      status: 409,
      error: ORPHANED_PAYMENT_MESSAGE,
      code: "subscription_orphaned",
      subscription_id: sub.id as string,
    };
  }

  // Verified. Only the payment fields move — `status` stays whatever the
  // creation path set (pending_confirmation) so the existing admin
  // confirm-then-activate workflow is unchanged by prepayment.
  const { error: updErr } = await supabase
    .from("subscriptions")
    .update({
      payment_status: "paid",
      payment_method: "razorpay",
      razorpay_payment_id,
      paid_at: new Date().toISOString(),
    })
    .eq("id", sub.id)
    .neq("payment_status", "paid");
  if (updErr) {
    console.error("[subscription verify] mark-paid failed:", updErr.message);
    return { ok: false, status: 500, error: "Failed to mark subscription paid" };
  }

  return { ok: true, subscription_id: sub.id as string };
}
