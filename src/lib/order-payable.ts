// Can this order's payment still be finished online?
//
// ONE RULE, TWO CALLERS, AND THEY MUST NOT DIVERGE. The customer's "Pay Now"
// button (src/app/orders/[id]/page.tsx) and the route behind it
// (/api/orders/[id]/pay) have to answer this identically — a button the route
// then 409s is worse than no button, because the customer has already been told
// they can pay.
//
// WHY THIS FILE EXISTS AT ALL. Both callers used to ask `payment_method ===
// "cod"`, and that is what made a dismissed Razorpay window unrecoverable.
// /api/create-order writes the orders row BEFORE the checkout modal opens — it
// has to, so /api/verify-payment and /api/razorpay-webhook have a concrete row to
// attribute money to — so a customer who closes the sheet, loses signal, or fails
// a bank OTP is left holding a live order at `razorpay` + `created`, and the only
// button that could have rescued it said "not a Cash-on-Delivery order". All time
// on prod: 46 such rows, ₹11,088, 5 Sep → 5 Oct 2026.
//
// /api/orders/[id]/pay/verify never had a cod gate — it reconciles any unpaid row
// owned by the verified customer whose stored razorpay_order_id matches what
// Razorpay signed. The second half of the resume path already worked. Only the
// door was locked.
//
// ALLOWLISTS, NOT DENYLISTS — on purpose. A method or payment_status nobody has
// named here is refused, so a row written off by a sweeper cannot become payable
// again merely by sitting outside an `!== "paid"` test. prod has only ever held
// two methods and, counting `paid`, three payment_statuses, so these sets are
// exhaustive today rather than defensive guesses.
//
// SCOPE. This answers the payment question ONLY. Whether the order is cancelled,
// expired, or has a delivery change pending is each caller's own business and is
// deliberately not folded in here: the route refuses a cancelled order with its
// own `cancelled` code, and the page additionally hides the button on expiry
// (see order-state.ts) and while a change-request is open.

const PAYABLE_METHODS = new Set(["cod", "razorpay"]);

/**
 * `pending` — the COD default, 364 rows on prod.
 * `created` — a Razorpay checkout that opened and never completed. THIS is the
 *             one the cod-only gate used to lock out.
 * `failed`  — one Razorpay declined. Retrying is the entire point; nothing has
 *             ever been written to this value yet (see the webhook's
 *             `mark_failed`), but it is the correct answer when something is.
 *
 * `paid` and `paid_*` are absent, and so is anything a sweeper writes off.
 */
const PAYABLE_PAYMENT_STATUSES = new Set(["pending", "created", "failed"]);

export type PayableFacts = {
  payment_method?: string | null;
  payment_status?: string | null;
};

/** True iff the money has not arrived and this row is one we will take it on. */
export function isPayableOnline(order: PayableFacts): boolean {
  const method = (order.payment_method ?? "").trim().toLowerCase();
  const status = (order.payment_status ?? "").trim().toLowerCase();
  return PAYABLE_METHODS.has(method) && PAYABLE_PAYMENT_STATUSES.has(status);
}
