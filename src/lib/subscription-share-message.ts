// Composer for the WhatsApp handoff message the /admin/subscriptions
// "Share" button sends to a delivery partner. Sibling to
// order-share-message.ts (which is left byte-identical) — the two share
// ONE popover (PartnerShareButton) but each has its own composer.
//
// Coord-aware Maps link, same rule as the order message:
//   - lat/lng present → https://www.google.com/maps?q=<lat>,<lng>  (pinned)
//   - no coords       → https://www.google.com/maps/search/?api=1&query=<address>

import type { AdminSubscriptionRow } from "@/lib/admin-shared";
import {
  describeSubscriptionPlan,
  resolveSubscriptionAddress,
  formatAddressFull,
} from "@/lib/subscription-display";

export type SubscriptionShareContext = {
  /** Real subscription_deliveries count (list: total_deliveries;
   *  detail: deliveries.length). Feeds the plan sentence. */
  deliveryCount: number | null | undefined;
  /** Earliest upcoming delivery, when known (detail page). */
  nextDeliveryDate?: string | null;
  nextDeliverySlot?: string | null;
};

export function composeSubscriptionShareMessage(
  sub: AdminSubscriptionRow,
  ctx: SubscriptionShareContext,
): string {
  const label = sub.product_name?.trim() || "Subscription";
  const addr = resolveSubscriptionAddress(sub);
  const customerName = addr.name || sub.customer?.full_name?.trim() || "Customer";
  const customerPhone =
    addr.phone || sub.customer?.phone?.trim() || sub.customer_phone?.trim() || "—";

  const plan = describeSubscriptionPlan(sub, ctx.deliveryCount);
  const addressStr = formatAddressFull(addr);

  const lat = sub.latitude;
  const lng = sub.longitude;
  const hasCoords =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);

  const mapsLink = hasCoords
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(addressStr)}`;

  const locationLine = hasCoords
    ? `Location: ${mapsLink}`
    : `Location (address search — no GPS on file): ${mapsLink}`;

  const lines = [
    `Cadieux subscription — ${label}`,
    `Customer: ${customerName}`,
    `Phone: ${customerPhone}`,
    `Plan: ${plan}`,
  ];

  const nextParts = [ctx.nextDeliveryDate, ctx.nextDeliverySlot]
    .map((s) => (s ? String(s).trim() : ""))
    .filter(Boolean);
  if (nextParts.length > 0) {
    lines.push(`Next delivery: ${nextParts.join(" · ")}`);
  }

  lines.push(`Address: ${addressStr}`, locationLine);

  return lines.join("\n");
}
