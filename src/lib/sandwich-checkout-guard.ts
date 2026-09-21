// TEMPORARY SCAFFOLDING — remove when the OLF/OLW cart-split lands.
//
// Between the storefront ship and the OLW checkout split, a customer with the
// kitchen switch ON could add a sandwich to the cart. Neither the client
// checkout button nor the server order-create paths know how to turn a
// sandwich line into an order row today, so allowing them through would
// either 500 (client crashes on PRODUCTS[-1]) or silently drop the sandwich
// value from the total.
//
// This module is the single source of the refusal message + the shape check.
// Every caller — the checkout button, /api/checkout `place_order`, and
// /api/create-order — imports both. When the OLW work lands the callers get
// deleted and this file with them; grep for SANDWICH_CHECKOUT_BLOCK_CODE to
// find every scaffold point in one pass.

export const SANDWICH_CHECKOUT_BLOCK_CODE = "sandwich_checkout_blocked";

export const SANDWICH_CHECKOUT_BLOCK_MESSAGE =
  "Sandwich ordering isn't open yet. Remove the sandwich to check out your bread.";

/** True when ANY cart line has `kind === "sandwich"`. Loaf lines (no `kind`,
 *  or `kind === "loaf"`) pass through. Safe against arbitrary shapes because
 *  a stale client cart from localStorage could send anything. */
export function hasSandwichItems(items: unknown): boolean {
  if (!Array.isArray(items)) return false;
  for (const item of items) {
    if (item && typeof item === "object" && "kind" in item) {
      const kind = (item as { kind?: unknown }).kind;
      if (kind === "sandwich") return true;
    }
  }
  return false;
}
