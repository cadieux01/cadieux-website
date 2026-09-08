// The customer-facing share message — what someone sends when they share
// THEIR OWN order:
//
//   Anuradha Vaddi
//   CX-8FNRJ9
//   9848489677
//   Plain x1
//   7 Sep, 6 - 10 AM
//   Flat 4B, Sagar Nagar, Visakhapatnam 530045
//   https://www.google.com/maps?q=<lat>,<lng>
//
// Nothing else. No totals, no payment status, no order status — this is
// sent to whoever is fetching the bread, and every extra line pushes the
// address and the loaves further down a WhatsApp preview.
//
// WHY THIS IS NOT @/lib/order-share-message
// That file is the ADMIN format and does not change. The two messages
// order their fields differently and always will: a rider opening an admin
// share needs the order reference first, a friend opening a customer share
// needs to know whose order it is. Forcing both through
// `composeShareMessageFromParts` would mean adding a `when` field the admin
// message never prints plus a flag to reorder the output — one composer
// that is worse at both jobs.
//
// What they DO share is every field-level primitive: `variantLabel`,
// `itemLines` and `mapsLinkFor` are imported from the admin module, so a
// bread line is a bread line in both and "2 loaves" can never appear in
// either.
//
// THE REFERENCE IS public_ref, NEVER order_number. The OLF number is
// sequential and is deliberately withheld from the browser (see the select
// in /api/orders/[id]) because it discloses order volume. A share message
// is built to be forwarded, so putting one here would leak that count to
// everyone downstream of the customer as well. `public_ref` is the
// customer-facing reference by design and admin can search on it.

import { itemLines, mapsLinkFor } from "@/lib/order-share-message";
import { formatSlotWindow } from "@/lib/delivery-slots";
import type { AdminOrderItemSnapshot } from "@/lib/admin-shared";

/** Address labels are stored inline as a leading bracketed tag —
 *  "[Home] Pidaparthivari Street, …". That tag is a UI affordance from the
 *  address picker; to someone reading the message it is noise in front of
 *  the only line that matters. */
export function stripAddressLabel(address: string): string {
  return address.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

/** "7 Sep" in IST. Deliberately no weekday and no year: the message is
 *  read within days of being sent, and the date line already carries the
 *  time window beside it. */
export function shareDateLabel(dateIso: string | null | undefined): string {
  if (!dateIso) return "";
  const d = new Date(`${dateIso}T00:00:00+05:30`);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  });
}

export type CustomerShareOrder = {
  public_ref?: string | null;
  delivery_address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  delivery_date?: string | null;
  delivery_slot?: string | null;
  items?: AdminOrderItemSnapshot[] | null;
  fulfillment_type?: string | null;
  customer?: { full_name?: string | null; phone?: string | null } | null;
  pickup_location?: {
    name?: string | null;
    area?: string | null;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
  } | null;
};

/**
 * The date/time line.
 *
 * Delivery: "7 Sep, 6 - 10 AM" — the readable window, never the stored
 * "06:00-10:00" and never a bare "07:30".
 *
 * Pickup: "7 Sep, pickup". There is no delivery window on a pickup order —
 * every pickup row in the table has delivery_slot NULL and pickup_ready_at
 * NULL — so inventing an hour range here would be promising a time nobody
 * committed to. The date is real; the rest is honestly absent.
 */
function whenLine(order: CustomerShareOrder, isPickup: boolean): string {
  const date = shareDateLabel(order.delivery_date);
  if (!date) return "";
  if (isPickup) return `${date}, pickup`;
  const window = formatSlotWindow(order.delivery_slot);
  return window ? `${date}, ${window}` : date;
}

/**
 * The place lines: address then map link, or for a pickup the store's name,
 * the store's address and a pin to the STORE. Prefixed "Pickup:" so nobody
 * reads a shop address as the customer's home and drives bread to it.
 */
function placeLines(order: CustomerShareOrder, isPickup: boolean): string[] {
  if (isPickup) {
    const loc = order.pickup_location;
    if (!loc) return [];
    const where = [loc.name, loc.area].filter(Boolean).join(", ");
    const address = (loc.address || "").trim();
    return [
      where ? `Pickup: ${where}` : "",
      address,
      address ? mapsLinkFor(address, loc.latitude, loc.longitude) : "",
    ].filter(Boolean);
  }

  const address = stripAddressLabel(order.delivery_address || "");
  if (!address) return [];
  return [address, mapsLinkFor(address, order.latitude, order.longitude)];
}

export function composeCustomerShareMessage(order: CustomerShareOrder): string {
  const isPickup = order.fulfillment_type === "pickup";

  return [
    order.customer?.full_name?.trim() || "",
    order.public_ref?.trim() || "",
    order.customer?.phone?.trim() || "",
    ...itemLines(order.items),
    whenLine(order, isPickup),
    ...placeLines(order, isPickup),
  ]
    .filter(Boolean)
    .join("\n");
}
