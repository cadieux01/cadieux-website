// Fulfilment predicates for admin rows.
//
// Kept in ONE place because the tick beside OLF/OLS and the "N of M
// fulfilled" ratio in the summary strip must agree exactly — the ratio
// is nothing more than the tick count over the row count, and if the
// two definitions ever drift Sunny sees a "10 of 12 fulfilled" strip
// above a table with 11 ticks.
//
// Both predicates are purely DERIVED from the status columns already on
// the row. Nothing is written back — do NOT add a `fulfilled` column,
// that reopens the same drift the derivation was designed to close.

/**
 * An order is fulfilled when it has reached its terminal-success state.
 *
 * `delivered` (delivery lane) and `picked_up` (pickup lane) are the two
 * ways an order can end successfully — see the sort-rank note in
 * lib/admin-shared.ts, where both sit at rank 5. `cancelled` is
 * terminal but NOT fulfilled; every other status is still live work.
 */
export function isOrderFulfilled(o: { status?: string | null }): boolean {
  const s = (o.status ?? "").toLowerCase();
  return s === "delivered" || s === "picked_up";
}

/**
 * A subscription is fulfilled when either:
 *   (a) status === 'completed' — the parent row has been flipped, OR
 *   (b) it has delivery rows and every one of them is 'delivered'.
 *
 * (b) is a safety net rather than a backfill: as of 2026-09-16 zero
 * subscriptions are fully delivered without being marked completed, so
 * the branch is unreachable today. Include it anyway — a subscription
 * whose last delivery is marked delivered before the parent status is
 * flipped is exactly the gap that would open the moment deliveries run
 * ahead of the status column. A single cancelled delivery among an
 * otherwise-delivered plan is NOT fulfilled ("every one is delivered"
 * means every one, not every non-cancelled one) — reads
 * `delivered_deliveries === total_deliveries`, not `remaining === 0`.
 *
 * `delivered_deliveries` and `total_deliveries` are attached by the
 * ?enrich=1 admin list route only. On a payload that omits them the
 * safety net evaluates to false and this collapses to (a) alone — the
 * old behaviour, which is safe.
 */
export function isSubscriptionFulfilled(s: {
  status?: string | null;
  total_deliveries?: number;
  delivered_deliveries?: number;
}): boolean {
  if ((s.status ?? "").toLowerCase() === "completed") return true;
  const total = s.total_deliveries ?? 0;
  const delivered = s.delivered_deliveries ?? 0;
  return total > 0 && delivered === total;
}
