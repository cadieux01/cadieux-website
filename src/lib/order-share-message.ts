// The ONE share-message format. Every "Share" button in admin — orders
// list, order detail, subscriptions list, subscription detail — sends this
// exact shape, so a rider always reads the same six things in the same
// order:
//
//   OLF71
//   Customer name
//   Phone number
//   Address
//   <Google Maps link>
//   Multigrain x2
//   Plain x1
//
// Nothing else. No totals, no payment status, no slot — a rider holding a
// bag needs the door and the loaves, and every extra line pushed those
// down the WhatsApp preview.

import { formatOrderNumber } from "@/lib/order-number";
import type { AdminOrderRow, AdminOrderItemSnapshot } from "@/lib/admin-shared";

/** Quantity for one line, respecting both `quantity` and legacy `qty`. */
function lineQty(it: AdminOrderItemSnapshot): number {
  const q = Number(it.quantity ?? it.qty ?? 0);
  return Number.isFinite(q) ? q : 0;
}

/**
 * Short variant name for a rider, e.g. "Protein Bread — Multigrain" →
 * "Multigrain". Every stored name so far is "<product> — <variant>"; if a
 * name has no em dash we fall back to the whole thing rather than guess.
 */
export function variantLabel(name: string | null | undefined): string {
  const full = String(name ?? "").trim();
  if (!full) return "Item";
  const parts = full.split("—");
  const tail = parts[parts.length - 1].trim();
  return tail || full;
}

/** "Multigrain x2" per line — the whole point of the message. */
function itemLines(items: AdminOrderItemSnapshot[] | null | undefined): string[] {
  if (!items || items.length === 0) return [];
  return items.map((it) => `${variantLabel(it.name)} x${lineQty(it)}`);
}

/**
 * Coord-aware Maps link:
 *   - lat/lng present → https://www.google.com/maps?q=<lat>,<lng>  (pinned)
 *   - no coords       → https://www.google.com/maps/search/?api=1&query=<address>
 */
export function mapsLinkFor(
  address: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
): string {
  const hasCoords =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);

  return hasCoords
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

export type ShareMessageParts = {
  /** Top line: "OLF71" for an order, the plan name for a subscription. */
  reference: string;
  customerName: string;
  customerPhone: string;
  address: string;
  mapsLink: string;
  /** Already short-form, e.g. ["Multigrain x2", "Plain x1"]. */
  itemLines: string[];
};

/** The single formatter. Both composers below funnel through this. */
export function composeShareMessageFromParts(parts: ShareMessageParts): string {
  return [
    parts.reference,
    parts.customerName,
    parts.customerPhone,
    parts.address,
    parts.mapsLink,
    ...parts.itemLines,
  ]
    .filter(Boolean)
    .join("\n");
}

export function composeShareMessage(order: AdminOrderRow): string {
  const address = order.delivery_address?.trim() || "—";

  return composeShareMessageFromParts({
    reference: formatOrderNumber(order),
    customerName: order.customers?.full_name?.trim() || "Customer",
    customerPhone: order.customers?.phone?.trim() || "—",
    address,
    mapsLink: mapsLinkFor(address, order.latitude, order.longitude),
    itemLines: itemLines(order.items),
  });
}

/** Returns true if the Share button should be shown for this order. */
export function isShareable(order: AdminOrderRow): boolean {
  // Pickup orders don't get delivered by a rider → hide the button.
  if (order.fulfillment_type === "pickup") return false;
  return true;
}
