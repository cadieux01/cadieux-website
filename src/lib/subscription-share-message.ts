// Subscription side of the ONE share format. The shape (reference, payment,
// name, phone, address, maps link, item lines) and the formatting both live
// in order-share-message.ts — this module only maps a subscription row onto
// those slots, so orders and subscriptions can never drift apart.
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
  composeRun,
  cashDueFor,
  mapsLinkFor,
  variantLabel,
  type ShareStop,
} from "@/lib/order-share-message";
import { paymentLabel, type PaymentFacts } from "@/lib/payment-label";
import {
  resolveSubscriptionAddress,
  formatAddressFull,
  subscriptionItems,
  describeSubscriptionCadence,
} from "@/lib/subscription-display";
import { formatDate } from "@/lib/admin-formatting";
import { formatSubscriptionNumber } from "@/lib/order-number";

/** "Multigrain x1", "Plain x1" — one line per variant, never a bare total. */
function itemLinesFor(sub: AdminSubscriptionRow): string[] {
  return subscriptionItems(sub).map(
    (i) => `${variantLabel(i.product_name)} x${i.quantity_per_delivery}`,
  );
}

/**
 * What ONE stop on this plan is worth.
 *
 * ⚠️  NEVER print `subscriptions.total_amount` as a collectable. It is the
 * whole plan. OLS10 is a live COD subscription whose total_amount is 1440
 * across 5 deliveries — a rider told to collect 1440 at one door would ask
 * for five times the money owed.
 *
 * Derived as total ÷ delivery count rather than rebuilt from bread_price ×
 * quantity, because the price columns have drifted from what was actually
 * charged: OLS11 stores bread_price 144 and quantity 2 but a total of 252,
 * so the multiplication says 288 and the customer agreed to 252. The
 * division reproduces the agreed figure exactly on all 14 live COD plans.
 *
 * Returns null when the count is missing (an un-enriched row), which the
 * payment label renders as a bare "COD" rather than as a guessed figure.
 */
export function perDeliveryAmount(sub: AdminSubscriptionRow): number | null {
  const total = Number(sub.total_amount);
  const n = sub.total_deliveries ?? 0;
  if (!Number.isFinite(total) || n <= 0) return null;
  return Math.round((total / n) * 100) / 100;
}

/**
 * Payment facts for a subscription stop.
 *
 * Payment lives on `subscriptions`, not on `subscription_deliveries` —
 * there is no per-delivery payment state in the schema — so every stop on a
 * plan reports the plan's status. The AMOUNT, however, is always per-stop.
 */
function paymentFactsFor(sub: AdminSubscriptionRow): PaymentFacts {
  return {
    payment_status: sub.payment_status,
    amountDue: perDeliveryAmount(sub),
  };
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

/** One subscription stop. Use this when building a multi-stop run. */
export function composeNextDeliveryShareStop(
  sub: AdminSubscriptionRow,
): ShareStop {
  const facts = paymentFactsFor(sub);
  const next = sub.next_delivery;

  const when = next
    ? [formatDate(next.date), next.slot].filter(Boolean).join(", ")
    : "";
  const cadence = describeSubscriptionCadence(sub);

  // No next delivery left → fall back to naming the plan, so the button is
  // never dead. The payment line is identical either way.
  const reference = next
    ? `Subscription ${formatSubscriptionNumber(sub)} · next delivery ${when}`
    : `Subscription ${formatSubscriptionNumber(sub)}${cadence ? ` · ${cadence}` : ""}`;

  return {
    text: composeShareMessageFromParts({
      reference,
      payment: paymentLabel(facts),
      ...commonParts(sub),
      itemLines: itemLinesFor(sub),
    }),
    cashDue: cashDueFor(facts),
  };
}

/** The standing plan and its cadence — the second option. */
export function composeSubscriptionShareStop(
  sub: AdminSubscriptionRow,
): ShareStop {
  const facts = paymentFactsFor(sub);
  const cadence = describeSubscriptionCadence(sub);

  return {
    text: composeShareMessageFromParts({
      reference: `Subscription ${formatSubscriptionNumber(sub)}${cadence ? ` · ${cadence}` : ""}`,
      // Still the PER-STOP figure, even on the whole-plan share. This scope
      // describes the plan, but the money is always handed over one door at
      // a time, and a COD line must never state more than is due there.
      payment: paymentLabel(facts),
      ...commonParts(sub),
      itemLines: itemLinesFor(sub),
    }),
    cashDue: cashDueFor(facts),
  };
}

/**
 * The next delivery only — the default share.
 *
 *   "Subscription OLS12 · next delivery Sun, 7 Sep, 07:30"
 */
export function composeNextDeliveryShareMessage(
  sub: AdminSubscriptionRow,
): string {
  return composeRun([composeNextDeliveryShareStop(sub)]);
}

/** The standing plan and its cadence — the second option. */
export function composeSubscriptionShareMessage(
  sub: AdminSubscriptionRow,
): string {
  return composeRun([composeSubscriptionShareStop(sub)]);
}
