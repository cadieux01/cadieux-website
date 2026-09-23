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
// carries the sandwich in whatever they walked in with. Dine-in will be
// exempt too, for the same reason, when dine-in exists: the rule is
// "packaging is charged when the sandwich leaves in our packaging", which
// today means fulfillment_type === "delivery" and nothing else. Any new
// fulfilment value is EXEMPT until someone decides otherwise — so gate on
// `=== "delivery"`, never on `!== "pickup"`.
//
// The fulfilment value driving this is a SINGLE value for the whole group:
// admin_create_split_orders takes it as one argument and stamps both rows
// (migration 20260923115206 — the LEDGER version. The file was written as
// 20260923043000 and renamed to match after the apply, so do not go hunting
// for the old prefix). There is no reading it off the OLW row and getting a
// different answer than the OLF row.

/** Flat packaging fee added to any sandwich order fulfilled by delivery. */
export const SANDWICH_PACKAGING_INR = 10;
