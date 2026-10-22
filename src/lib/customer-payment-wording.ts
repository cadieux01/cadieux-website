// How we tell A CUSTOMER that a `cod` order is paid with money, not a card.
//
//   delivery → "Cash on Delivery"
//   pickup   → "Pay at Pickup"
//
// ONE FACT, THREE SCREENS, AND THEY MUST NEVER DISAGREE:
//   1. app/checkout/page.tsx           — the button the customer presses
//   2. app/orders/[id]/page.tsx        — the status badge on the order
//   3. app/account/requests/page.tsx   — the badge in the Payments tab
//
// It was three hand-written copies of the same ternary until 22 Oct 2026, and
// (3) never got the pickup branch: it read `payment_method === "cod"` and said
// "Cash on Delivery" full stop, which was false for 123 live pickup orders
// sitting at cod/pending. A badge contradicting the button the customer just
// pressed is worse than clunky wording, so the words here are the ones that
// already shipped on (1) — "Pay at Pickup", not a fourth invention.
//
// WHY THIS IS ITS OWN FILE AND NOT A THIRD FUNCTION IN AN EXISTING ONE.
// There are three payment vocabularies in this codebase and they are
// deliberately separate — see the header of lib/payment-label.ts, which makes
// the same point about its own two functions:
//   • lib/payment-label.ts    rider / operator      "PAID" · "COD ₹340"
//   • lib/cod-settlement.ts   admin + audit_log     "COD settled" ·
//                                                   "Pickup counter payment settled"
//   • HERE                    customer-facing       "Cash on Delivery" ·
//                                                   "Pay at Pickup"
// Folding any of these into another would make one register's wording change
// when someone edited another's. They look like duplicates and are not.
//
// NOT EXTENDED TO lib/order-share-customer.ts:125, ON PURPOSE. That one is
// PROSE — a sentence inside a message the customer forwards — where "Cash on
// pickup" reads correctly and "Pay at Pickup" does not. It is a sentence, not
// a label; leave it alone.
//
// SCOPE IS THE `cod` BRANCH ONLY. The two badge sites also spell their other
// states differently ("Failed" vs "Payment failed"), and converging those
// would be a visible change to screens nobody complained about. This is the
// one string that is actually wrong.

import { PICKUP_FULFILLMENT } from "@/lib/fulfillment-type";

/**
 * The customer-facing name for payment on a `cod` order.
 *
 * `fulfillmentType` IS REQUIRED, deliberately — passing `null` is allowed but
 * forgetting the argument is a type error. This bug was not a wrong ternary,
 * it was an ABSENT COLUMN read as a blank: `fulfillment_type` was missing from
 * the orders projection in lib/my-requests.ts, so the page had nothing to
 * branch on and silently took the delivery path. A required parameter makes
 * the next caller answer the question instead of defaulting past it.
 *
 * Null / "" / an unrecognised spelling reads as DELIVERY, which is the only
 * safe default: rows predating the pickup UI carry NULL and every one of them
 * is a delivery. The guard against the projection bug recurring is the
 * required argument above and the tests in tests/pickup-counter-payment.test.mjs,
 * not the default.
 *
 * Matched with `.trim().toLowerCase()` — the convention every reader of the
 * STORED column uses (order-payable.ts `isCounterPayPickup`, cod-settlement.ts
 * `settlementWording`). `canonicalFulfillment` is NOT used here even though it
 * answers a similar question: its own header scopes it to the REQUEST BODY and
 * states that stored-row readers are left alone on purpose, because trimming
 * on the request path would let " pickup " skip the cart floor. Here trimming
 * only affects wording, and a stored `"Pickup "` should still read as pickup.
 */
export function codPaymentLabel(
  fulfillmentType: string | null | undefined,
): string {
  return (fulfillmentType ?? "").trim().toLowerCase() === PICKUP_FULFILLMENT
    ? "Pay at Pickup"
    : "Cash on Delivery";
}
