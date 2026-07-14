// GA4 ecommerce event helpers. Fires the standard recommended events through
// the gtag/dataLayer bridge set up in the root layout (next/script). The
// Measurement ID lives only in that layout — these helpers never reference it.

import { PRODUCTS, type CartItem } from "@/lib/data";

const CURRENCY = "INR";

// Push a GA4 event. Prefers the real `gtag` once the deferred loader has
// run; before that (rare — events fire on user interaction, after load) it
// queues straight onto dataLayer, which gtag.js drains when it initialises.
function gaEvent(name: string, params: Record<string, unknown>) {
  if (typeof window === "undefined") return;
  const w = window as unknown as {
    gtag?: (...args: unknown[]) => void;
    dataLayer?: unknown[];
  };
  if (typeof w.gtag === "function") {
    w.gtag("event", name, params);
  } else {
    (w.dataLayer = w.dataLayer || []).push(["event", name, params]);
  }
}

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
  gaEvent("add_to_cart", {
    currency: CURRENCY,
    value: item.price * item.qty,
    items: [cartItemToGaItem(item)],
  });
}

export function trackBeginCheckout(cart: CartItem[], value: number) {
  if (cart.length === 0) return;
  gaEvent("begin_checkout", {
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
  gaEvent("purchase", {
    transaction_id: args.transactionId,
    currency: CURRENCY,
    value: args.value,
    items: args.items,
  });
}
