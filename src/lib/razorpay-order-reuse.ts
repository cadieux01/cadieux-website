// Should the Razorpay order already stamped on an order row be handed back to
// the customer, instead of minting a second one?
//
// WHY THIS EXISTS. /api/orders/[id]/pay used to create a fresh Razorpay order
// on every press and overwrite orders.razorpay_order_id unconditionally. Two
// presses — a second tap, a slow network, a back-and-forward — orphaned the
// first Razorpay order: its id was gone from every row we own, while its
// checkout window was still open and still able to take money. Completing that
// first window captured real money against an id nothing could be found by,
// which is the /api/razorpay-webhook "unattributed" branch and the reason
// payment_exceptions exists.
//
// THE DECISION IS SPLIT FROM THE FETCH ON PURPOSE. A part-paid Razorpay order,
// or one whose amount moved after the id was minted, cannot be produced on
// demand — same problem as the unattributed capture in the webhook, and the
// same answer: make the discrimination a pure function over the response body
// so it can be walked over every shape that matters. scripts/reuse-check.ts
// does exactly that.
//
// REUSE IS THE NARROW CASE. It requires Razorpay to affirmatively say the order
// is unpaid, untouched, and for the same amount in the same currency. EVERY
// other answer — including every failure — refuses, and the caller falls
// through to minting, which is precisely what the route did before. A Razorpay
// outage therefore costs us the improvement, never the payment: the customer
// still gets a working checkout.

/** The fields of a Razorpay order this decision reads. */
export type RazorpayOrderBody = {
  status?: string;
  amount?: number;
  amount_paid?: number;
  currency?: string;
};

export type ReuseDecision =
  | { reuse: true; amountPaise: number; currency: string }
  /**
   * `why` exists so the log says which condition stopped it. Without it,
   * "we minted a new one" and "we minted a new one because Razorpay timed out"
   * are the same line, and the second is worth knowing about.
   */
  | { reuse: false; why: string; loud?: true };

/**
 * Pure. Takes what Razorpay said about the order and what we believe is owed.
 *
 * `loud` marks the one refusal that is not routine: Razorpay reporting the
 * order paid while our row still says it is not. Minting a second order is
 * still the right response (this route must never flip payment_status — only a
 * verified signature does that), but it means money was captured and never
 * reconciled. That is the same orphaned-money shape payment_exceptions was
 * built for, and nobody would ever see it from inside the happy path.
 */
export function decideReuse(
  body: RazorpayOrderBody | null,
  expectedPaise: number,
): ReuseDecision {
  if (!body || typeof body.status !== "string") {
    return { reuse: false, why: "razorpay_bad_response" };
  }
  if (body.status === "paid") {
    return { reuse: false, why: "razorpay_says_paid", loud: true };
  }
  // Belt and braces for a partial capture, which no current Razorpay flow
  // produces but which `status` alone would not reveal. Any money against this
  // order at all disqualifies it.
  if (typeof body.amount_paid === "number" && body.amount_paid > 0) {
    return { reuse: false, why: "amount_paid_nonzero", loud: true };
  }
  // The point of the whole check: the total may have moved since the id was
  // minted (an admin edit, a re-quoted delivery fee). A stale window for the
  // old total must not be handed back, or the customer pays yesterday's price.
  if (body.amount !== expectedPaise) return { reuse: false, why: "amount_changed" };
  if (body.currency !== "INR") return { reuse: false, why: "currency_changed" };

  return { reuse: true, amountPaise: body.amount, currency: body.currency };
}

/**
 * GET https://api.razorpay.com/v1/orders/{id}, then decide.
 *
 * Only Razorpay can answer this. Our row records which id we last created; it
 * does NOT record whether that checkout window was used, and the webhook only
 * hears about ids it can attribute — which is the loop this closes. So we ask
 * the source of truth, and treat every failure to get an answer as a refusal.
 */
export async function razorpayOrderIsReusable(
  razorpayOrderId: string,
  expectedPaise: number,
  auth: string,
): Promise<ReuseDecision> {
  let res: Response;
  try {
    res = await fetch(
      `https://api.razorpay.com/v1/orders/${encodeURIComponent(razorpayOrderId)}`,
      {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
        // A customer is waiting on this press. If Razorpay is slow, give up and
        // mint — a fresh order is worse than a reused one, and far better than
        // a spinner.
        signal: AbortSignal.timeout(8_000),
      },
    );
  } catch (e) {
    return { reuse: false, why: e instanceof Error ? e.message : String(e) };
  }
  if (!res.ok) return { reuse: false, why: `razorpay_http_${res.status}` };

  const body = (await res.json().catch(() => null)) as RazorpayOrderBody | null;
  return decideReuse(body, expectedPaise);
}
