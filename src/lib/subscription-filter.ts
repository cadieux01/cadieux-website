// Subscription-board filter semantics. Deliberately the SAME SHAPE as
// src/lib/order-filter.ts — one flat selection, groups OR'd internally and
// AND'd against each other, an empty group meaning "no constraint" — so the
// two boards behave identically under the operator's fingers.
//
// It is a separate module, not a second copy: the generic pieces
// (ALL_VALUE, the menu builders in filter-menu.ts) are imported, and only
// the two axes that orders does not have live here.
//
// WHY A SUBSCRIPTION NEEDS TWO EXTRA AXES
//
//  1. PAYMENT. `subscriptions.payment_status` is a separate column from
//     `status`, so an unpaid plan still carries a real status. Until now the
//     board answered that question by DELETING the rows server-side (see the
//     comment at the head of api/admin/subscriptions/route.ts) — six live
//     rows were invisible. They are now rows like any other, reachable by an
//     explicit filter.
//
//  2. EXPIRY. "Expiring in 7 days" is computed from derived_end_date. It is
//     NOT a status and must never be listed beside them: the 7 expiring rows
//     are 3 pending_confirmation + 2 active + 2 completed, every one of which
//     is ALSO counted in its own status. Listing it as a status breaks the
//     "status counts sum to the row count" invariant, which is exactly what
//     assertStatusCountsPartition exists to catch.

import { ALL_VALUE } from "@/lib/order-filter";

/** Marks a filter value as a `payment_status`, not a `status`. */
export const PAY_PREFIX = "pay:";

/** The one computed filter. Prefixed so it can never be mistaken for a
 *  column value by anything reading the flat selection. */
export const EXPIRING_7D = "computed:expiring_7d";

/** The two payment states the board names explicitly. Both were previously
 *  hidden; the wording is the operator's question, not the column value —
 *  "abandoned" and "created" mean nothing to someone deciding whether to
 *  bake a loaf. */
export const PAYMENT_FILTERS: { value: string; label: string }[] = [
  { value: `${PAY_PREFIX}abandoned`, label: "Payment not completed" },
  { value: `${PAY_PREFIX}created`, label: "Checkout in progress" },
];

/** The fields the predicate reads. Structural, so both AdminSubscriptionRow
 *  and any lighter row type satisfy it without a cast. */
export type FilterableSubscription = {
  status?: string | null;
  payment_status?: string | null;
  /** Read only by the caller's `isExpiring`, but declared here so that
   *  predicate can be typed structurally too. */
  derived_end_date?: string | null;
};

export type SubscriptionSelection = {
  statuses: string[];
  payments: string[];
  expiring: boolean;
};

/** Split the flat dropdown selection into its groups. `"all"` is dropped: an
 *  empty status list IS "all", so the two can never disagree. */
export function splitSubscriptionFilterValues(
  values: readonly string[],
): SubscriptionSelection {
  const statuses: string[] = [];
  const payments: string[] = [];
  let expiring = false;
  for (const v of values) {
    if (v === ALL_VALUE) continue;
    if (v === EXPIRING_7D) expiring = true;
    else if (v.startsWith(PAY_PREFIX)) payments.push(v.slice(PAY_PREFIX.length));
    else statuses.push(v);
  }
  return { statuses, payments, expiring };
}

/**
 * OR within each group, AND across the groups.
 *
 * `isExpiring` is injected rather than computed here because it depends on
 * today's date and on `derived_end_date`, which is a SERVER-computed field —
 * keeping the clock out of this module is what makes it testable.
 */
export function matchesSubscriptionFilter(
  s: FilterableSubscription,
  sel: SubscriptionSelection,
  isExpiring: (s: FilterableSubscription) => boolean,
): boolean {
  if (sel.statuses.length > 0) {
    const v = (s.status ?? "").trim().toLowerCase();
    if (!sel.statuses.includes(v)) return false;
  }
  if (sel.payments.length > 0) {
    const v = (s.payment_status ?? "").trim().toLowerCase();
    if (!sel.payments.includes(v)) return false;
  }
  if (sel.expiring && !isExpiring(s)) return false;
  return true;
}
