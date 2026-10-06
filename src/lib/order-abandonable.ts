// May this unpaid online order be written off as `abandoned`?
//
// Lifted out of @/lib/cron/sweep-abandoned-orders so it can be exercised
// directly. It decides whether money stops being owed, which is the one
// decision in that sweeper a reader should be able to check without reading the
// sweeper — and the repo's harness idiom (scripts/*-check.ts, run by node's own
// type stripping) can only import modules that have no `@/` imports. Hence this
// file imports nothing at all.
//
// WHY expiryMs IS A PARAMETER rather than an import. ORDER_EXPIRY_MS lives in
// @/lib/order-state, which is a declared mirror of the WhatsApp bot's
// classifyOrder; importing it here would both break the no-imports property
// above and invite someone to mirror this policy into the bot, where it does not
// belong. Passing it keeps ONE copy of the 7-day number and lets the harness sit
// exactly on the boundary instead of waiting a week to see it.
//
// WHAT THIS REFUSES, AND WHY THAT IS THE POINT. On prod, 24 of the 46 unpaid
// razorpay orders reached `confirmed` or beyond, 15 of them `delivered`, and
// cod_settled_method is NULL on every one: bread went out against a payment that
// never completed and no cash was ever recorded. Writing `abandoned` on those
// would state "nothing is owed here" on precisely the rows where something
// probably is. So anything past pending is refused forever and left for a
// person. Only two shapes qualify:
//
//   • status='cancelled' — dead by a human's decision; nothing to collect.
//   • status pending/placed AND older than the expiry window — computeOrderState
//     already calls these `expired` and every customer surface already refuses
//     them, so writing them off removes nothing a customer could still do.
//
// The window is the FULL 7 days and not the subscriptions sweeper's 120 minutes
// because /api/orders/[id]/pay now lets a customer finish an abandoned Razorpay
// checkout for that whole period (see @/lib/order-payable). 120 minutes is the
// minimum age for LOOKING at a row, which is a different question and stays in
// the sweeper.

/** Statuses that mean "placed but not yet acted on". Same set, same reason, as
 *  PENDINGISH_STATUSES in @/lib/order-state — kept here rather than imported so
 *  this module stays importable by the harness. If one changes, change both. */
const ABANDONABLE_PENDING_STATUSES = new Set(["pending", "placed"]);

export type AbandonableFacts = {
  status?: string | null;
  created_at?: string | null;
};

/**
 * True iff this row may be written off, GIVEN that Razorpay has already
 * confirmed it was never paid. The caller owns that confirmation; this function
 * never asks anyone anything.
 *
 * @param nowMs    the run's clock, passed in so a run is self-consistent
 * @param expiryMs ORDER_EXPIRY_MS at the call site
 */
export function mayAbandon(
  row: AbandonableFacts,
  nowMs: number,
  expiryMs: number,
): boolean {
  const status = (row.status ?? "").trim().toLowerCase();
  if (status === "cancelled") return true;
  if (!ABANDONABLE_PENDING_STATUSES.has(status)) return false;
  const createdMs = row.created_at ? Date.parse(row.created_at) : NaN;
  // An unparseable created_at cannot be SHOWN to be past the resume window, so
  // it is not written off. Leaving a row alone is always the recoverable error.
  if (!Number.isFinite(createdMs)) return false;
  return nowMs - createdMs > expiryMs;
}
