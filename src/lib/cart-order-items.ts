// The ONE derivation of the `items` array the checkout posts, lifted out of
// checkout/page.tsx so the cart page can ask questions about the same lines
// the server will be asked to price.
//
// WHY THIS IS NOT "just map over the cart". `CartItem.kind` is
// "loaf" | "sandwich" — a DIFFERENT AXIS from the posted `kind`, which is
// "once" | "sub" and comes from `CartItem.orderType`. Any predicate that
// reads the cart directly and tests `kind === "sub"` — which is exactly what
// carriesSubscriptionLine in order-minimum.ts does — silently never matches,
// so the subscription exemption would be dead code that looks live. Going
// through this function is what keeps the client's answer and the server's
// answer the same answer.
//
// TEMPORARY SCAFFOLDING (SANDWICH_CHECKOUT_BLOCK_CODE) — remove with the
// OLF/OLW cart-split. The sandwich filter moved here WITH the mapping and
// must stay attached to it: PRODUCTS[-1] is undefined, so dropping the filter
// crashes every caller on a sandwich line. It is still PAIRED with the loud
// guards in placeOrderCOD / payOnline and both server routes — this function
// drops the line from the payload, those guards are what tell the customer.

import { PRODUCTS, type CartItem } from "./data";

export type OrderItemPayload = {
  slug: string;
  quantity: number;
  /** "once" | "sub" — from CartItem.orderType, never CartItem.kind. */
  kind: CartItem["orderType"];
  line_total_inr: number;
};

export function cartToOrderItems(
  cart: readonly CartItem[],
): OrderItemPayload[] {
  return cart
    .filter((c) => c.kind !== "sandwich")
    .map((c) => ({
      slug: PRODUCTS[c.productIndex].slug,
      quantity: c.qty,
      kind: c.orderType,
      line_total_inr: c.price * c.qty,
    }));
}
