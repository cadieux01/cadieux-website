// Shared order_placed message builders.
//
// SINGLE SOURCE of the SMS + WhatsApp confirmation copy for every path
// that creates an order: web checkout (client), mobile checkout (server),
// admin manual-entry (server), and any future path. Keeping this in one
// place guarantees admin-created and customer-created orders receive
// byte-identical wording forever.
//
// Both builders inject a tracking link that lands the customer on their
// order detail page (/orders/[id]). If the customer isn't signed in the
// page triggers the standard OTP flow; after verify the phone-linked
// customer_id already matches the admin-created order, so the tracker
// loads without any manual claim step.
//
// Pure — no next/react imports — safe to call from client OR server.

export type OrderPlacedInput = {
  name: string | null | undefined;
  orderId: string;
  /** Customer-facing reference (`orders.public_ref`, e.g. 'CX-7K4M2P').
   *  NEVER the OLF number — that is internal and leaks order volume.
   *  Falls back to a UUID slice for display if somehow absent. */
  publicRef?: string | null;
  total: number | string;
  address: string;
  /** Adds the "date TBD, we'll confirm" closing when true. */
  preorder?: boolean;
  /** Base site origin, e.g. "https://www.cadieux.in". */
  siteUrl: string;
};

/** UUID-based tracker URL. `/orders/[id]` route param is the raw UUID —
 *  DO NOT substitute the OLF number here, the page won't resolve it. */
export function orderTrackingUrl(siteUrl: string, orderId: string): string {
  const base = siteUrl.replace(/\/+$/, "");
  return `${base}/orders/${orderId}`;
}

/** public_ref (preferred) → falls back to a UUID hex slice. */
function orderLabel(orderId: string, publicRef?: string | null): string {
  const r = (publicRef ?? "").trim();
  if (r) return r;
  return "#" + orderId.slice(0, 8).toUpperCase();
}

export function buildOrderPlacedSms(input: OrderPlacedInput): string {
  const name = (input.name ?? "").trim() || "Customer";
  const label = orderLabel(input.orderId, input.publicRef);
  const closing = input.preorder
    ? "This is a pre-order. We will confirm your delivery date by SMS + WhatsApp shortly. Thank you!"
    : "We will confirm shortly. Thank you!";
  const track = orderTrackingUrl(input.siteUrl, input.orderId);
  return (
    `Hi ${name}! Your Cadieux order ${label} has been placed.\n` +
    `Total: Rs.${input.total}\n` +
    `Delivery to: ${input.address}\n` +
    `Track: ${track}\n` +
    closing
  );
}

export function buildOrderPlacedWhatsApp(input: OrderPlacedInput): string {
  const name = (input.name ?? "").trim() || "there";
  const label = orderLabel(input.orderId, input.publicRef);
  const closing = input.preorder
    ? `This is a pre-order — we will confirm your delivery date by SMS + WhatsApp shortly. Thank you for choosing Cadieux!`
    : `We will confirm your order shortly. Thank you for choosing Cadieux!`;
  const track = orderTrackingUrl(input.siteUrl, input.orderId);
  return (
    `Hi ${name}! 🍞 Your Cadieux order has been placed successfully!\n\n` +
    `Order ID: ${label}\n` +
    `Total: ₹${input.total}\n` +
    `Delivery to: ${input.address}\n\n` +
    `Track your order: ${track}\n\n` +
    closing
  );
}
