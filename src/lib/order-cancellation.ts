// Order cancellation policy.
//
// Mirrors the live Return Policy at /refunds:
//   "Full refund if the order is cancelled within 1 hour of order placement.
//    After 1 hour, the order proceeds."
//
// Pure functions — no DB, no I/O. The cancel API route and any client-side
// affordance share these constants so the rule is defined in exactly one
// place.

/** Minutes from `orders.created_at` during which a full refund is allowed. */
export const CANCELLATION_WINDOW_MINUTES = 60;

/** Order statuses where a customer cancel is still permitted.
 *  `pending_payment` is included so a customer who abandoned the payment
 *  step can free up the placeholder order. No refund is needed in that
 *  case — see the cancel route, which nulls refund_status accordingly. */
export const CANCELLABLE_STATUSES: ReadonlySet<string> = new Set([
  "pending_payment",
  "paid",
  "confirmed",
]);

/** Terminal statuses that already represent an end-state. */
export const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  "cancelled",
  "refunded",
  "delivered",
]);

/**
 * Returns true when `now` is strictly within `CANCELLATION_WINDOW_MINUTES`
 * of `createdAt`. Both inputs are interpreted as absolute UTC instants —
 * the delta is timezone-agnostic so IST vs UTC does not affect the math.
 */
export function isWithinCancellationWindow(
  createdAt: string | Date,
  now: Date = new Date(),
): boolean {
  const placedAt =
    createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(placedAt.getTime())) return false;
  const elapsedMs = now.getTime() - placedAt.getTime();
  if (elapsedMs < 0) return false; // clock skew — treat as still inside window
  return elapsedMs < CANCELLATION_WINDOW_MINUTES * 60_000;
}

/** The subset of an order needed to decide whether an auto-refund is allowed. */
export type RefundGateOrder = {
  payment_status: string | null;
  razorpay_payment_id: string | null;
  refund_status: string | null;
  refund_id: string | null;
};

/**
 * The paid-only refund gate. Returns true ONLY when it is safe to issue a
 * full auto-refund for a cancelled order. This is the single source of truth —
 * it SUPERSEDES the old `requiresRefund = status !== 'pending_payment'` logic
 * that lived inline in the mobile cancel route (which wrongly flagged COD
 * orders as needing a refund).
 *
 * Refund is permitted iff ALL hold:
 *   • payment_status === 'paid'                (online money was captured)
 *   • razorpay_payment_id is a 'pay_' id       (a real captured payment exists)
 *   • refund_status is empty                   (not already processing/refunded/failed)
 *   • refund_id is empty                       (no refund already issued)
 *
 * COD / unpaid orders (payment_status !== 'paid' OR no razorpay_payment_id)
 * can NEVER pass this gate, so no money is ever sent for them.
 */
export function canAutoRefund(order: RefundGateOrder): boolean {
  if (order.payment_status !== "paid") return false;
  const pid = order.razorpay_payment_id;
  if (typeof pid !== "string" || !pid.startsWith("pay_")) return false;
  // Already refunding/refunded/failed → do not touch again (idempotency).
  if (order.refund_status) return false;
  if (order.refund_id) return false;
  return true;
}

/**
 * Milliseconds remaining in the cancellation window. Returns 0 once the
 * window has closed. Useful for UI countdown displays.
 */
export function cancellationMsRemaining(
  createdAt: string | Date,
  now: Date = new Date(),
): number {
  const placedAt =
    createdAt instanceof Date ? createdAt : new Date(createdAt);
  if (Number.isNaN(placedAt.getTime())) return 0;
  const deadline = placedAt.getTime() + CANCELLATION_WINDOW_MINUTES * 60_000;
  return Math.max(0, deadline - now.getTime());
}
