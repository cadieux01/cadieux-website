// Pure subscription money math. NO I/O, no server-only imports — safe to
// import from a "use client" component.
//
// This lives apart from @/lib/subscription-delivery-fee on purpose: that
// module reaches Google + Supabase (and so transitively pulls in the
// service-role client), which must never be dragged into a browser bundle
// just because the wizard wants to show a total. The wizard imports this;
// the API routes import both.

export type SubscriptionTotal = {
  /** Loaf value of one delivery, excluding the fee. */
  amountPerDelivery: number;
  /** Delivery fee charged on EACH delivery. */
  feePerDelivery: number;
  /** amountPerDelivery + feePerDelivery. */
  perDeliveryTotal: number;
  deliveryCount: number;
  /** Loaf value across the whole subscription. */
  breadTotal: number;
  /** Fee across the whole subscription. */
  feeTotal: number;
  /** What the customer pays up front. */
  grandTotal: number;
};

/**
 * The subscription total is counted by DELIVERY DAYS, not by loaves:
 *   ((loaves per delivery × price) + delivery fee) × number of deliveries
 *
 * Shared by the wizard and the server so the figure shown before payment
 * is the figure charged, by construction.
 */
export function computeSubscriptionTotal(
  amountPerDelivery: number,
  feePerDelivery: number,
  deliveryCount: number,
): SubscriptionTotal {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const perDeliveryTotal = round2(amountPerDelivery + feePerDelivery);
  return {
    amountPerDelivery: round2(amountPerDelivery),
    feePerDelivery: round2(feePerDelivery),
    perDeliveryTotal,
    deliveryCount,
    breadTotal: round2(amountPerDelivery * deliveryCount),
    feeTotal: round2(feePerDelivery * deliveryCount),
    grandTotal: round2(perDeliveryTotal * deliveryCount),
  };
}

/** Rupees → integer paise for Razorpay. */
export function toPaise(inr: number): number {
  return Math.round(inr * 100);
}
