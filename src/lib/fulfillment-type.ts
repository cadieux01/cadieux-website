// How a REQUEST BODY's `fulfillment_type` becomes a decision.
//
// This is `prepareOneTimeOrder`'s own derivation, lifted out unchanged so
// that more than one gate can share it. It exists because the 2-item cart
// floor (order-minimum.ts) exempts pickup, and an exemption decided by a
// SECOND, looser reading of the same field is not an exemption, it is a
// hole: a client sending "Pickup" would skip the floor while still being
// routed down the delivery branch. One derivation, read once per request,
// makes that mismatch impossible rather than merely unlikely.
//
// Not to be confused with order-fulfillment.ts, which answers "is this
// order DONE" (`delivered` / `picked_up`) from the status column. This file
// answers "how is it being handed over", from the request.
//
// SCOPE IS DELIBERATELY THE REQUEST BODY, NOT A STORED ROW. The readers in
// order-payable.ts (`isCounterPayPickup`) and cod-settlement.ts
// (`settlementWording`) normalise `orders.fulfillment_type` as it came back
// from Postgres, where the value was written by this codebase and the
// interesting case is a legacy NULL. They are left alone on purpose:
// folding them in here would change a money path to serve a checkout gate.
//
// Strictness is NOT widened from what the checkout path has always done —
// no `.trim()`, because trimming would make `" pickup "` a pickup order and
// therefore floor-exempt, and widening the pickup path is not what this
// change is for. Unrecognised spellings fall to "delivery", which is the
// recoverable direction: the floor applies and the customer is told how to
// proceed. The unrecoverable direction is a spelling that exempts.

/** The pickup literal for the request-handling path. */
export const PICKUP_FULFILLMENT = "pickup";

export type FulfillmentType = "delivery" | "pickup";

/**
 * Canonicalises a client-supplied `fulfillment_type`.
 *
 * Absent / non-string / anything but a case-insensitive "pickup" reads as
 * "delivery", so pre-pickup clients (every app build, and the website
 * before the pickup UI) keep the exact code path they always had.
 *
 * Callers must derive BOTH the stored column value and any pickup-only
 * branch from this one call. Comparing the result against
 * `PICKUP_FULFILLMENT` is safe where comparing a raw body field is not:
 * the return type is a union, so a mistyped literal fails type-checking.
 */
export function canonicalFulfillment(raw: unknown): FulfillmentType {
  const lowered = typeof raw === "string" ? raw.toLowerCase() : "delivery";
  return lowered === PICKUP_FULFILLMENT ? "pickup" : "delivery";
}
