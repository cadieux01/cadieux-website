// GA4 ecommerce event helpers. Fires the standard recommended events through
// the gtag/dataLayer bridge exposed by @next/third-parties (<GoogleAnalytics>
// in the root layout). The Measurement ID lives only in that component — these
// helpers never reference it.

import { sendGAEvent } from "@next/third-parties/google";
import { PRODUCTS, type CartItem } from "@/lib/data";

const CURRENCY = "INR";

type GaItem = {
  item_id?: string;
  item_name: string;
  price?: number;
  quantity: number;
};

function cartItemToGaItem(c: CartItem): GaItem {
  return {
    item_id: PRODUCTS[c.productIndex]?.slug,
    item_name: c.name,
    price: c.price,
    quantity: c.qty,
  };
}

export function trackAddToCart(item: CartItem) {
  sendGAEvent("event", "add_to_cart", {
    currency: CURRENCY,
    value: item.price * item.qty,
    items: [cartItemToGaItem(item)],
  });
}

export function trackBeginCheckout(cart: CartItem[], value: number) {
  if (cart.length === 0) return;
  sendGAEvent("event", "begin_checkout", {
    currency: CURRENCY,
    value,
    items: cart.map(cartItemToGaItem),
  });
}

export function trackPurchase(args: {
  transactionId: string;
  value: number;
  items: GaItem[];
}) {
  if (!args.transactionId) return;
  sendGAEvent("event", "purchase", {
    transaction_id: args.transactionId,
    currency: CURRENCY,
    value: args.value,
    items: args.items,
  });
}
