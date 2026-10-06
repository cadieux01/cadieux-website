// Did Razorpay take the money for this order, yes or no?
//
// Lifted verbatim out of sweep-abandoned-subscriptions.ts, where it was private,
// because the orders sweeper (@/lib/cron/sweep-abandoned-orders) needs the exact
// same answer and a second copy of a money-reading HTTP client is how two
// sweepers come to disagree about what "paid" means.
//
// THE THIRD STATE IS THE WHOLE POINT. `paid: null` means "we could not get an
// answer", and it is not a synonym for `paid: false`. Every caller must leave
// such a row completely alone and reconsider it next run: writing a row off
// because Razorpay had a bad minute is how a real payment gets abandoned.
//
// Distinct from razorpayOrderIsReusable() in razorpay-order-reuse.ts, which hits
// the same endpoint to answer a different question — "may I hand this checkout
// window back to a customer who is waiting right now" — and so refuses on
// anything unexpected and uses a much shorter timeout. Same URL, opposite
// defaults; do not merge them.

export type RazorpayOrderPaidState =
  | { paid: true; amountPaise: number }
  | { paid: false }
  | { paid: null; reason: string };

/**
 * GET https://api.razorpay.com/v1/orders/{id}
 *
 * Returns:
 *   { paid: true, amountPaise }   — Razorpay says the order was paid
 *   { paid: false }               — Razorpay says the order was not paid
 *   { paid: null }                — network / auth / 5xx; the caller must NOT act
 */
export async function fetchRazorpayOrderPaidState(
  razorpayOrderId: string,
): Promise<RazorpayOrderPaidState> {
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
