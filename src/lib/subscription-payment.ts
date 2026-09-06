// Razorpay plumbing for PREPAID subscriptions.
//
// Subscriptions are prepaid-only — the whole plan is paid up front before
// the first delivery. There is no COD path (enforced in code here and by
// the `subscriptions_no_cod` CHECK constraint in the DB).
//
// Mirrors the one-time order pair /api/create-order + /api/verify-payment
// exactly: the row is inserted with payment_status='created' and the
// razorpay_order_id, and is ONLY flipped to 'paid' after the HMAC
// signature is verified server-side AND Razorpay independently confirms
// the payment is captured for the exact server-stored amount.

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import { toPaise } from "@/lib/subscription-delivery-fee";

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

export type VerifyResult =
  | { ok: true; subscription_id: string; already?: true }
  | { ok: false; status: number; error: string; code?: string };

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
    .select("id, total_amount, razorpay_order_id, payment_status, customer_id")
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
