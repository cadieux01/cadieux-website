// Sandwich-side pricing constants. Kept separate from src/lib/deliveryFee.ts
// so the "delivery" file stays about delivery, and a reader hunting for a
// sandwich number does not have to know it lives inside a delivery module.
//
// Grep target for "every fee we charge": `INR = ` in src/lib/*.ts.
//
// SERVER-AUTHORITATIVE. Never read from the client; never trusted from a
// request body. The split-cart pricing path adds this on the server when it
// detects a sandwich line AND fulfillment_type === "delivery", exactly the
// same posture as DELIVERY_FEE_FLAT_INR.
//
// LANDS ON THE OLW ROW ONLY. A mixed cart splits into OLF (bread) + OLW
// (sandwich); packaging is a sandwich cost, so it goes on the OLW row's
// total_amount. The OLF row is unaffected. See the OLF/OLW split plan §5.
//
// Pickup is exempt. There is no packaging line on pickup — the customer
// carries the sandwich in whatever they walked in with.

/** Flat packaging fee added to any sandwich order fulfilled by delivery. */
export const SANDWICH_PACKAGING_INR = 10;
