// Subscription side of the ONE share format. The shape (reference, name,
// phone, address, maps link, item lines) and the formatting both live in
// order-share-message.ts — this module only maps a subscription row onto
// those six slots, so orders and subscriptions can never drift apart.
//
// Two scopes, because a rider and an office need different things:
//   - NEXT DELIVERY (the default): the one drop still owed, dated. This is
//     what you hand a rider today.
//   - WHOLE SUBSCRIPTION: the standing plan and its cadence.
//
// Item lines come from subscription_items in both cases. The subscriptions
// row sums the variants into one product_name and a quantity of 2, which
// would tell the rider "Multigrain x2" for a Multigrain 1 + Plain 1 plan.

import type { AdminSubscriptionRow } from "@/lib/admin-shared";
import {
  composeShareMessageFromParts,
  mapsLinkFor,
  variantLabel,
} from "@/lib/order-share-message";
import {
  resolveSubscriptionAddress,
  formatAddressFull,
  subscriptionItems,
  describeSubscriptionCadence,
} from "@/lib/subscription-display";
import { formatDate } from "@/lib/admin-formatting";

/** "Multigrain x1", "Plain x1" — one line per variant, never a bare total. */
function itemLinesFor(sub: AdminSubscriptionRow): string[] {
  return subscriptionItems(sub).map(
    (i) => `${variantLabel(i.product_name)} x${i.quantity_per_delivery}`,
  );
}

/** The four slots that never change between the two scopes. */
function commonParts(sub: AdminSubscriptionRow) {
  const addr = resolveSubscriptionAddress(sub);
  const addressStr = formatAddressFull(addr);
  return {
    customerName: addr.name || sub.customer?.full_name?.trim() || "Customer",
    customerPhone:
      addr.phone ||
      sub.customer?.phone?.trim() ||
      sub.customer_phone?.trim() ||
      "—",
    address: addressStr,
    mapsLink: mapsLinkFor(addressStr, sub.latitude, sub.longitude),
  };
}

const shortId = (id: string) => String(id).slice(0, 8).toUpperCase();

/**
 * The next delivery only — the default share.
 *
 *   "Subscription 3F2A91B0 · next delivery Sun, 7 Sep, 07:30"
 *
 * Falls back to the plan-wide message when every delivery is done or
 * cancelled, so the button is never dead.
 */
export function composeNextDeliveryShareMessage(
  sub: AdminSubscriptionRow,
): string {
  const next = sub.next_delivery;
  if (!next) return composeSubscriptionShareMessage(sub);

  const when = [formatDate(next.date), next.slot].filter(Boolean).join(", ");
  return composeShareMessageFromParts({
    reference: `Subscription ${shortId(sub.id)} · next delivery ${when}`,
    ...commonParts(sub),
    itemLines: itemLinesFor(sub),
  });
}

/** The standing plan and its cadence — the second option. */
export function composeSubscriptionShareMessage(
  sub: AdminSubscriptionRow,
): string {
  const cadence = describeSubscriptionCadence(sub);
  return composeShareMessageFromParts({
    reference: `Subscription ${shortId(sub.id)}${cadence ? ` · ${cadence}` : ""}`,
    ...commonParts(sub),
    itemLines: itemLinesFor(sub),
  });
}
