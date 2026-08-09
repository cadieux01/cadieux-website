// Server-side Razorpay refund helper.
//
// LIVE MONEY. This module issues a real refund against a captured payment.
// It is invoked ONLY from cancel routes, and ONLY after the caller has:
//   1. passed the canAutoRefund() gate (see order-cancellation.ts), and
//   2. won the DB compare-and-swap that reserves refund_status='processing'
//      (the true idempotency guard — see the cancel routes).
//
// Credentials are the SAME server-only pair used by /api/verify-payment
// (RAZORPAY_KEY_ID + RAZORPAY_KEY_SECRET). They are NEVER exposed to a client.
//
// This function does NOT throw — it always resolves to a RefundResult so the
// caller can record 'processing' vs 'failed' and keep the order cancelled
// regardless of the refund outcome.

const RAZORPAY_API = "https://api.razorpay.com/v1";

export type RefundResult =
  | { ok: true; refundId: string; status: string | null; amount: number }
  | { ok: false; error: string; httpStatus?: number; code?: string };

type RazorpayRefundResponse = {
  id?: string;
  status?: string;
  amount?: number;
  error?: { code?: string; description?: string };
};

/**
 * Issues a FULL refund of `amountPaise` against `paymentId`.
 *
 * @param paymentId   Razorpay payment id (must start with 'pay_').
 * @param amountPaise Amount in the smallest currency unit (INR paise). Derived
 *                    server-side from order.total_amount × 100 — never client.
 * @param idempotencyKey  Stable per-order key (the order id). Sent to Razorpay
 *                    as a best-effort idempotency header AND recorded in notes.
 *                    NOTE: the authoritative double-refund guard is the DB
 *                    compare-and-swap in the caller; this header is defence in
 *                    depth only.
 */
export async function issueRazorpayRefund(
  paymentId: string,
  amountPaise: number,
  idempotencyKey: string,
): Promise<RefundResult> {
  const key = process.env.RAZORPAY_KEY_ID;
  const secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) {
    return { ok: false, error: "Razorpay not configured" };
  }

  // Hard guards — never issue a refund on a malformed payment id or amount.
  if (typeof paymentId !== "string" || !paymentId.startsWith("pay_")) {
    return { ok: false, error: "Invalid payment id", code: "bad_payment_id" };
  }
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    return { ok: false, error: "Invalid refund amount", code: "bad_amount" };
  }

  const authHeader = Buffer.from(`${key}:${secret}`).toString("base64");

  let res: Response;
  try {
    res = await fetch(
      `${RAZORPAY_API}/payments/${encodeURIComponent(paymentId)}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Basic ${authHeader}`,
          "Content-Type": "application/json",
          // Best-effort idempotency signal (Razorpay ignores unknown headers).
          "X-Razorpay-Idempotency-Key": idempotencyKey,
        },
        body: JSON.stringify({
          amount: amountPaise,
          speed: "normal",
          notes: {
            reason: "order_cancelled_auto_refund",
            idempotency_basis: idempotencyKey,
          },
        }),
      },
    );
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Refund request failed",
      code: "network",
    };
  }

  let body: RazorpayRefundResponse;
  try {
    body = (await res.json()) as RazorpayRefundResponse;
  } catch {
    return { ok: false, error: "Bad refund response", httpStatus: res.status };
  }

  if (!res.ok || !body.id) {
    return {
      ok: false,
      error: body.error?.description ?? "Razorpay refund failed",
      httpStatus: res.status,
      code: body.error?.code,
    };
  }

  return {
    ok: true,
    refundId: body.id,
    status: body.status ?? null,
    amount: Number(body.amount ?? amountPaise),
  };
}
