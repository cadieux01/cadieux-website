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

/** Order statuses where a customer cancel is still permitted. */
export const CANCELLABLE_STATUSES: ReadonlySet<string> = new Set([
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
