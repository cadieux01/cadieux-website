// Subscription side of the ONE share format. The shape (reference, name,
// phone, address, maps link, item lines) and the formatting both live in
// order-share-message.ts — this module only maps a subscription row onto
// those six slots, so orders and subscriptions can never drift apart.
//
// A subscription has no OLF number, so the reference line is its short id;
// the "items" are one line, the plan's loaves per delivery.

import type { AdminSubscriptionRow } from "@/lib/admin-shared";
import {
  composeShareMessageFromParts,
  mapsLinkFor,
  variantLabel,
} from "@/lib/order-share-message";
import {
  resolveSubscriptionAddress,
  formatAddressFull,
} from "@/lib/subscription-display";

export function composeSubscriptionShareMessage(
  sub: AdminSubscriptionRow,
): string {
  const addr = resolveSubscriptionAddress(sub);
  const addressStr = formatAddressFull(addr);
  const qty = Number(sub.quantity_per_delivery ?? 0);

  return composeShareMessageFromParts({
    reference: `Subscription ${String(sub.id).slice(0, 8).toUpperCase()}`,
    customerName:
      addr.name || sub.customer?.full_name?.trim() || "Customer",
    customerPhone:
      addr.phone ||
      sub.customer?.phone?.trim() ||
      sub.customer_phone?.trim() ||
      "—",
    address: addressStr,
    mapsLink: mapsLinkFor(addressStr, sub.latitude, sub.longitude),
    itemLines:
      qty > 0 ? [`${variantLabel(sub.product_name)} x${qty}`] : [],
  });
}
