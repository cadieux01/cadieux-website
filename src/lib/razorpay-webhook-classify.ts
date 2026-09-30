// WHICH BRANCH DOES A RAZORPAY WEBHOOK EVENT LAND IN?
//
// Pulled out of /api/razorpay-webhook as a pure function for one reason: you
// cannot make a real unattributed capture happen on demand. Razorpay will not
// send you a payment for an order that does not exist just because you would
// like to test one. So the decision is separated from the I/O and exercised
// over real prod-shaped payloads instead — see scripts/classify-check.ts.
//
// THE LADDER, in order. Each rung is checked only if every rung above it missed.
//
//   1. no razorpay order id on the event      QUIET  nothing to reconcile
//   2. the id matches one of our ORDERS       → the existing order branches
//   3. the id matches one of our SUBSCRIPTIONS QUIET  handled elsewhere entirely
//   4. the event did not capture money        QUIET  nothing was taken
//   5. anything left                           LOUD  money we cannot attribute
//
// RUNG 3 IS THE WHOLE REASON THIS IS A LADDER AND NOT AN `if (!order)`.
// This endpoint only ever queries `orders`, so every subscription payment
// already falls out of the order lookup empty-handed — 46 rows on prod, 37 of
// them paid. Making the miss loud without rung 3 would alarm on every single
// one, and an alert channel that cries wolf 37 times is not an alert channel
// when the real one arrives. Quiet here is not indifference: subscriptions are
// reconciled by their own verify path and their own daily sweeper.
//
// RUNG 4 is the same argument for failures. A `payment.failed` for an id we do
// not know means no money moved, so there is nothing to lose and nobody to
// wake.
//
// `loud` is the output that matters. It means: write a payment_exceptions row
// and ring the doorbell. Everything else returns 200 and says nothing.

export type RzpEntity = {
  id?: string;
  order_id?: string;
  amount?: number;
  status?: string;
};

export type RzpEvent = {
  event?: string;
  payload?: {
    payment?: { entity?: RzpEntity };
    order?: { entity?: RzpEntity };
  };
};

/** What the event's razorpay order id turned out to belong to, if anything. */
export type Parent =
  | {
      kind: "order";
      id: string;
      total_amount: number | string | null;
      payment_status: string | null;
      payment_group_id: string | null;
    }
  | { kind: "subscription" }
  | { kind: "none" };

export type Outcome =
  /** Nothing to do, and nothing was at stake. */
  | {
      branch: "ignored";
      loud: false;
      why: "no_order_id" | "unmapped_event" | "not_captured";
    }
  /** Ours, and the payment failed — flip the row to `failed`. */
  | { branch: "mark_failed"; loud: false }
  /** Ours, and already reconciled by /api/verify-payment. */
  | { branch: "already_paid"; loud: false }
  /** Ours, and the amount owed. Mark it paid. */
  | { branch: "mark_paid"; loud: false }
  /** A subscription's payment. Not this endpoint's job, and not a problem. */
  | { branch: "subscription"; loud: false }
  /** LOUD. Ours, but not for the amount owed. Never auto-marked paid. */
  | {
      branch: "amount_mismatch";
      loud: true;
      capturedPaise: number;
      expectedPaise: number;
    }
  /** LOUD. Money captured for something we cannot identify at all. */
  | { branch: "unattributed"; loud: true; capturedPaise: number | null };

/** `payment.*` carry the payment entity whose order_id points at ours;
 *  `order.paid` carries the order entity itself. */
export function extractRzpOrderId(event: RzpEvent): string | null {
  return (
    event.payload?.payment?.entity?.order_id ??
    event.payload?.order?.entity?.id ??
    null
  );
}

/** Paise actually taken, or null when the event does not state an amount. */
export function extractCapturedPaise(event: RzpEvent): number | null {
  const n = Number(
    event.payload?.payment?.entity?.amount ??
      event.payload?.order?.entity?.amount,
  );
  return Number.isFinite(n) ? n : null;
}

function capturesMoney(eventName: string | undefined): boolean {
  return eventName === "payment.captured" || eventName === "order.paid";
}

export function classifyRazorpayEvent(
  event: RzpEvent,
  parent: Parent,
): Outcome {
  // Rung 1.
  if (!extractRzpOrderId(event)) {
    return { branch: "ignored", loud: false, why: "no_order_id" };
  }

  const captured = extractCapturedPaise(event);

  // Rung 2 — ours. Unchanged behaviour except that a mismatch now says so
  // out loud instead of returning a bare {ok:true}.
  if (parent.kind === "order") {
    if (event.event === "payment.failed") {
      return { branch: "mark_failed", loud: false };
    }
    if (!capturesMoney(event.event)) {
      return { branch: "ignored", loud: false, why: "unmapped_event" };
    }
    if (parent.payment_status === "paid") {
      return { branch: "already_paid", loud: false };
    }
    const expectedPaise = Math.round(Number(parent.total_amount) * 100);
    // A missing amount is NOT a mismatch, and is treated exactly as it was
    // before this ladder existed: fall through and mark paid. Razorpay always
    // states an amount on these two events; inventing a refusal for a case
    // that has never occurred would block real money on a hypothesis.
    if (captured !== null && captured !== expectedPaise) {
      return {
        branch: "amount_mismatch",
        loud: true,
        capturedPaise: captured,
        expectedPaise,
      };
    }
    return { branch: "mark_paid", loud: false };
  }

  // Rung 3 — a subscription's payment. Quiet, deliberately. See the header.
  if (parent.kind === "subscription") {
    return { branch: "subscription", loud: false };
  }

  // Rung 4 — unknown id, but nothing was taken.
  if (!capturesMoney(event.event)) {
    return { branch: "ignored", loud: false, why: "not_captured" };
  }

  // Rung 5 — money arrived for something we cannot name.
  return { branch: "unattributed", loud: true, capturedPaise: captured };
}
