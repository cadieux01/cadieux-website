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

// PICKUP IS PAID AT THE COUNTER — AND THE RULE HAS A DATE IN IT.
//
// Raja's call, 18 Oct 2026: a pickup order must not offer online payment, and
// the 153 pickup orders that already exist are NOT to be touched. Those two
// sentences cannot both be satisfied by a plain `fulfillment_type !== 'pickup'`
// test — 116 of those rows are unpaid, and Pay Now is the only self-service
// door they have. A customer who was shown a Pay Online button when they
// ordered, and still owes the money, would find the door gone.
//
// WHY A DATE RATHER THAN A FLAG OR A COLUMN, which is the question a reader
// should be asking, because a date in a business rule is normally a smell:
//
//   • A FLAG would be flipped once and then take the button away from all 116
//     retroactively — the exact outcome being avoided. A flag expresses "the
//     rule is on now"; what is needed is "the rule applies to orders placed
//     from here on", and a flag cannot say that.
//   • A COLUMN (`online_payment_offered`) would need a backfill across 153
//     rows, and no-backfill was the instruction.
//   • `created_at` IS ALREADY THE RECORD OF WHICH RULE AN ORDER WAS PLACED
//     UNDER. It is immutable, so a given row's answer here can never change —
//     which is precisely the property grandfathering needs. Nothing to write,
//     nothing to migrate, nothing to keep in sync.
//
// So the cutoff is not a feature toggle and must not be used as one: moving it
// EARLIER retroactively removes a payment door from real unpaid orders. It is a
// historical fact about when the counter-payment rule started.
const PICKUP_FULFILLMENT = "pickup";

/**
 * Pickup orders created at or after this instant are not payable online.
 *
 * Set to IST midnight on the 19th rather than to the moment of the change: the
 * deploy time is not knowable from here, and dating it in the past would strip
 * the button from any pickup order placed earlier the same day — a row in the
 * grandfathered set, which is the one error that is not recoverable by waiting.
 * Erring the other way costs at most a few hours in which a pickup order that
 * the UI no longer offers Pay Online for could still resume one.
 */
export const PICKUP_ONLINE_PAYMENT_CUTOFF_ISO = "2026-10-19T00:00:00+05:30";

const PICKUP_CUTOFF_MS = Date.parse(PICKUP_ONLINE_PAYMENT_CUTOFF_ISO);

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
 *
 * `partially_paid` IS ABSENT ON PURPOSE, AND IT IS THE ONE THAT WILL TEMPT
 * YOU. It looks payable — money is still owed — but Pay Now charges
 * `total_amount`, not the outstanding balance, so adding it here would bill a
 * customer who has already part-paid for the WHOLE order a second time. The
 * gate is not the set membership, it is the amount: this value belongs here
 * the day the Pay Now flow charges the balance column instead of the total,
 * and not one commit before.
 */
const PAYABLE_PAYMENT_STATUSES = new Set(["pending", "created", "failed"]);

export type PayableFacts = {
  payment_method?: string | null;
  payment_status?: string | null;
  /** 'delivery' | 'pickup'. Read WITH created_at, never alone. */
  fulfillment_type?: string | null;
  /** Which rule this order was placed under. See the cutoff above. */
  created_at?: string | null;
};

/**
 * Is this a pickup order placed under the counter-payment rule?
 *
 * BOTH FIELDS MUST BE PROJECTED BY THE CALLER. An absent `created_at` is
 * treated as grandfathered — i.e. still payable — because the two errors are
 * not symmetrical. Wrongly keeping the button lets a customer pay online for an
 * order we would rather take cash for: the money arrives, the row is marked
 * paid, nobody is out of pocket. Wrongly removing it silently strips the only
 * self-service payment door from one of the 116 orders Raja ring-fenced, and
 * the customer has no way to tell us. So doubt resolves towards the old
 * behaviour. If a future caller forgets the projection, the guard quietly stops
 * firing rather than quietly misfiring.
 */
function isCounterPayPickup(order: PayableFacts): boolean {
  const fulfillment = (order.fulfillment_type ?? "").trim().toLowerCase();
  if (fulfillment !== PICKUP_FULFILLMENT) return false;
  const createdMs = order.created_at ? Date.parse(order.created_at) : NaN;
  if (!Number.isFinite(createdMs)) return false;
  return createdMs >= PICKUP_CUTOFF_MS;
}

/** True iff the money has not arrived and this row is one we will take it on. */
export function isPayableOnline(order: PayableFacts): boolean {
  const method = (order.payment_method ?? "").trim().toLowerCase();
  const status = (order.payment_status ?? "").trim().toLowerCase();
  if (!PAYABLE_METHODS.has(method)) return false;
  if (!PAYABLE_PAYMENT_STATUSES.has(status)) return false;
  // Last, and as a veto: the sets above answer "is money still owed on a row
  // we take money on", which stays true of a pickup order. What changes is
  // whether WE will take it online.
  return !isCounterPayPickup(order);
}
