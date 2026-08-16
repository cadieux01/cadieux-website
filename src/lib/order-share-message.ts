// Pure composer for the WhatsApp handoff message the /admin/orders
// "Share" button sends to a saved delivery partner. Kept in its own
// module so the copy button + the wa.me anchor + tests can all reuse
// the same string.

import { formatOrderNumber } from "@/lib/order-number";
import type { AdminOrderRow, AdminOrderItemSnapshot } from "@/lib/admin-shared";

/** Sum of item quantities (respecting both `quantity` and legacy `qty`). */
function totalUnits(items: AdminOrderItemSnapshot[] | null | undefined): number {
  if (!items || items.length === 0) return 0;
  let sum = 0;
  for (const it of items) {
    const q = Number(it.quantity ?? it.qty ?? 0);
    if (Number.isFinite(q)) sum += q;
  }
  return sum;
}

function formatINR(paise: number | null | undefined): string {
  if (paise == null || !Number.isFinite(paise)) return "—";
  return `₹${Math.round(paise).toLocaleString("en-IN")}`;
}

function slotLabel(slot: string | null | undefined): string {
  if (!slot) return "";
  // slot values look like "9-11" or "17-19"; render as "9-11".
  return String(slot).trim();
}

function dateLabel(date: string | null | undefined): string {
  if (!date) return "";
  // Show as YYYY-MM-DD (server already returns this shape) — the rider
  // just needs an unambiguous date, not a locale-formatted one.
  return String(date).trim();
}

/**
 * Compose the WhatsApp message a rider sees.
 *
 * Coord-aware Maps link:
 *   - lat/lng present → https://www.google.com/maps?q=<lat>,<lng>  (pinned)
 *   - no coords       → https://www.google.com/maps/search/?api=1&query=<address>
 *                       + note that the customer didn't share GPS
 */
export function composeShareMessage(order: AdminOrderRow): string {
  const orderLabel = formatOrderNumber(order);
  const customerName = order.customers?.full_name?.trim() || "Customer";
  const customerPhone = order.customers?.phone?.trim() || "—";

  const units = totalUnits(order.items);
  const totalStr = formatINR(order.total_amount);

  const paid = order.payment_status === "paid";
  const paymentLine = paid
    ? "PAID (do not collect)"
    : `UNPAID — COLLECT ${totalStr}`;

  const date = dateLabel(order.delivery_date);
  const slot = slotLabel(order.delivery_slot);
  const deliveryLine = [date, slot].filter(Boolean).join(" · ") || "—";

  const address = order.delivery_address?.trim() || "—";

  const lat = order.latitude;
  const lng = order.longitude;
  const hasCoords =
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0);

  const mapsLink = hasCoords
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

  const locationLine = hasCoords
    ? `Location: ${mapsLink}`
    : `Location (address search — customer did not share GPS): ${mapsLink}`;

  const lines = [
    `Cadieux delivery — ${orderLabel}`,
    `Customer: ${customerName}`,
    `Phone: ${customerPhone}`,
    `Units: ${units}`,
    `Total: ${totalStr}`,
    paymentLine,
    `Delivery: ${deliveryLine}`,
    `Address: ${address}`,
    locationLine,
  ];

  return lines.join("\n");
}

/** Returns true if the Share button should be shown for this order. */
export function isShareable(order: AdminOrderRow): boolean {
  // Pickup orders don't get delivered by a rider → hide the button.
  if (order.fulfillment_type === "pickup") return false;
  return true;
}
