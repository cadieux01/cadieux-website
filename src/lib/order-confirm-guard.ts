// Should confirming this order require the operator to say so out loud?
//
// THE HAZARD, WHICH IS HISTORY AND NOT A FORECAST. 46 orders on prod were left at
// payment_method='razorpay' + payment_status='created' — an online checkout that
// opened and never completed. 24 of them were confirmed anyway, 15 reached
// `delivered`, and cod_settled_method is NULL on every single one. Bread went out
// against a payment that never happened and no cash was ever recorded against it.
//
// NOTHING IN THE OFFICE SAID "STOP". The orders board shows such a row as
// "Awaiting", which reads like a wait rather than a decision, and the rider's
// sheet prints "COD ₹340" via paymentLabel() — correct by its own doctrine (no
// money has arrived, so someone must collect) but it is an instruction to a rider,
// delivered long after the only person who could have asked the customer
// "did your payment go through?" had already clicked Confirm.
//
// THE DAILY SWEEP MAKES THIS SHARPER, NOT SOFTER. @/lib/cron/sweep-abandoned-orders
// now writes payment_status='abandoned' on rows Razorpay confirms were never paid.
// `abandoned` is not `paid*`, so paymentLabel() still prints "COD ₹340" on it —
// confirmed in @/lib/payment-label, whose own header lists `abandoned` among the
// schema words it deliberately collapses into COD. So the sweep's write can itself
// produce a rider sheet asking for cash on an order the customer abandoned and
// never agreed to pay in cash. THE FIX IS NOT TO CHANGE THAT LABEL: binary
// PAID/COD at the door is load-bearing, and a third word there is the exact bug
// that once sent a rider out with nothing to collect against. The fix is to stop
// the row entering the delivery pipeline unnoticed in the first place.
//
// SO: REFUSE, WITH AN EXPLICIT OVERRIDE. Not a warning — a warning is what
// "Awaiting" already was. The operator must restate the intent, which turns an
// accidental click into a recorded decision (the override lands in audit_log).
// Overriding is a perfectly ordinary thing to do: ring the customer, agree cash on
// delivery, override, and the rider's "COD ₹340" is then exactly right.
//
// EVERY TRANSITION THAT CAN PUT A RIDER ON THE ROAD, NOT JUST `confirmed`. The
// first cut of this guard covered the confirm arrow alone, which was not a guard:
// the status control is a dropdown, so an operator who hits the refusal can pick
// `preparing` or `out_for_delivery` instead and reach the same place. Prod proves
// the walk-around is the normal route, not a clever one — 10 unpaid online orders
// (₹2,374) are sitting at confirmed/preparing/out_for_delivery right now and every
// one of them got there without anyone being asked. So all three arrows refuse.
//
// EXCEPT `delivered`, WHICH IS NEVER REFUSED. Refusing to record a delivery that
// has physically happened would make the board lie, and a lying board is how these
// rows got past everyone in the first place. `delivered` instead writes an audit
// entry saying the order was unpaid when it was delivered: no refusal, no dialog,
// just the record. See the `unpaid_at_delivery` branch in the two admin routes.

/** Methods where the money was supposed to arrive before delivery. */
const ONLINE_METHODS = new Set(["razorpay"]);

/**
 * Payment states that mean an ONLINE attempt did not complete.
 *
 *   created   — row written, Razorpay order raised, customer never finished
 *   abandoned — the daily sweep asked Razorpay and was told it was never paid
 *   failed    — the webhook's mark_failed branch
 *
 * `pending` is deliberately absent: it is the ordinary COD resting state, and a
 * razorpay+pending row has never existed on prod.
 */
const UNCOMPLETED_ONLINE_STATUSES = new Set([
  "created",
  "abandoned",
  "failed",
]);

export type ConfirmPaymentFacts = {
  payment_method?: string | null;
  payment_status?: string | null;
};

/**
 * True iff confirming this order should be refused unless the operator overrides.
 *
 * Reads BOTH columns on purpose. A `cod` order at `pending` is the normal case the
 * whole business runs on and must confirm without friction; this fires only where
 * an online payment was expected and did not land.
 */
export function confirmNeedsPaymentOverride(
  order: ConfirmPaymentFacts,
): boolean {
  const method = (order.payment_method ?? "").trim().toLowerCase();
  const status = (order.payment_status ?? "").trim().toLowerCase();
  return (
    ONLINE_METHODS.has(method) && UNCOMPLETED_ONLINE_STATUSES.has(status)
  );
}

/**
 * Target statuses that are refused on an unpaid online order.
 *
 * These are the transitions that put the order on a rider's sheet. `delivered` is
 * deliberately NOT here (see the header): it is recorded, then annotated.
 * `cancelled` is not here either — cancelling an unpaid order is the right answer,
 * never something to argue with.
 *
 * Canonical values only. Both routes normalise the legacy `dispatched` alias to
 * `out_for_delivery` BEFORE this is consulted, so there is no alias to carry here.
 */
const RIDER_BOUND_STATUSES = new Set([
  "confirmed",
  "preparing",
  "out_for_delivery",
]);

/** True iff moving an order INTO this status should be gated. */
export function isRiderBoundStatus(status: string | null | undefined): boolean {
  return RIDER_BOUND_STATUSES.has((status ?? "").trim().toLowerCase());
}

/** The request field that carries the override. One name, both routes. */
export const CONFIRM_OVERRIDE_FIELD = "allow_unpaid_confirm";

/** The response `code` both routes answer with. The admin board keys on it. */
export const CONFIRM_OVERRIDE_CODE = "unpaid_online_confirm";

/**
 * The refusal sentence. Written as finished operator copy because it is shown
 * verbatim — it has to say what is wrong, what the consequence is, and what the
 * operator should do, in the two lines an alert() will actually be read in.
 */
export function confirmOverrideMessage(
  order: ConfirmPaymentFacts & { order_number?: string | null },
  /**
   * The status being moved to. Only changes the verb — the hazard, and therefore
   * the rest of the sentence, is identical for all three. Defaults to `confirmed`
   * so the common call reads plainly.
   */
  nextStatus: string = "confirmed",
): string {
  const status = (order.payment_status ?? "").trim().toLowerCase();
  const which = order.order_number ? `${order.order_number}: ` : "";
  const state =
    status === "abandoned"
      ? "the customer abandoned this online payment"
      : status === "failed"
        ? "this online payment failed"
        : "this online payment was started but never completed";
  const act =
    nextStatus === "preparing"
      ? "Moving it to preparing"
      : nextStatus === "out_for_delivery"
        ? "Sending it out for delivery"
        : "Confirming it";
  return (
    `${which}${state}, so no money has arrived. ${act} puts the order ` +
    `on the rider's sheet as "COD" and a rider will ask for cash the customer ` +
    `has not agreed to pay. Check with the customer first — then repeat the same ` +
    `change to go ahead on cash on delivery.`
  );
}
