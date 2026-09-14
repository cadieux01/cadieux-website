// The customer-facing share message — what someone sends when they share
// THEIR OWN order:
//
//   Anuradha Vaddi
//   OLF412
//   9848489677
//   Confirmed
//   Paid online
//   Plain x1
//   Mon 15 Sep, 6 - 10 AM
//   Flat 4B, Sagar Nagar, Visakhapatnam 530045
//   https://www.google.com/maps?q=<lat>,<lng>
//
// STATUS + PAYMENT were deliberately absent until 2026-09-14, on the
// argument that every extra line pushes the address and the loaves further
// down a WhatsApp preview. Sunny asked for "the entire details" and
// overruled it: the customer sharing this is usually answering "is it paid
// and when is it coming?", and making them type that back by hand cost more
// than two lines of preview. Totals are still out — the person fetching the
// bread does not need the price, and on a COD order it reads like a demand.
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
// THE REFERENCE IS order_number (OLF<n>) as of 2026-09-14. It replaced
// public_ref here along with every other customer surface — deliberately,
// with the volume disclosure understood and accepted. See the decision note
// in @/lib/order-number for who decided and why.
//
// This was the strongest single argument for the old rule: a share message
// is built to be forwarded, so the number travels past the customer to
// whoever is fetching the bread. That is exactly why it has to be the same
// number as everywhere else — the person standing at the door reading this
// message is the person most likely to ring up and quote it.

import { itemLines, mapsLinkFor } from "@/lib/order-share-message";
import { formatSlotWindow } from "@/lib/delivery-slots";
import { STAGE_LABEL, toStage } from "@/lib/order-stages";
import type { AdminOrderItemSnapshot } from "@/lib/admin-shared";

/** Address labels are stored inline as a leading bracketed tag —
 *  "[Home] Pidaparthivari Street, …". That tag is a UI affordance from the
 *  address picker; to someone reading the message it is noise in front of
 *  the only line that matters. */
export function stripAddressLabel(address: string): string {
  return address.replace(/^\s*\[[^\]]*\]\s*/, "").trim();
}

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "Mon 15 Sep". The weekday is the point: the message is read within days of
 *  being sent, and "Mon" answers "which day is that?" without the reader
 *  counting dates. No year, for the same reason — nobody shares an order
 *  eleven months out.
 *
 *  Spelled out from fixed arrays rather than `toLocaleDateString`, which is
 *  ICU-dependent: en-IN renders September as "Sept" on current Node and
 *  Chrome and "Sep" on older ones, so the same order would read differently
 *  depending on the phone it was shared from.
 *
 *  `delivery_date` is stored as an IST calendar date ("2026-09-15"), not an
 *  instant, so it is parsed as UTC and read back in UTC. Going through a
 *  timezone here would be the bug, not the fix — it is the one way to land a
 *  day early. */
export function shareDateLabel(dateIso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((dateIso ?? "").trim());
  if (!m) return "";
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const d = new Date(Date.UTC(year, month - 1, day));
  if (Number.isNaN(d.getTime())) return "";
  return `${WEEKDAY_SHORT[d.getUTCDay()]} ${day} ${MONTH_SHORT[month - 1]}`;
}

/** Order status in plain words: "Confirmed", "Out for Delivery".
 *
 *  Reuses the tracker's STAGE_LABEL so the share message can never disagree
 *  with the status the customer is looking at on /orders/[id].
 *
 *  `toStage` returns null for the states that are not points on the
 *  progression — `cancelled` and `pending_payment`. Those matter MORE in a
 *  share, not less: someone forwarding a cancelled order to the person
 *  fetching the bread must not have that line silently disappear. */
export function shareStatusLabel(order: CustomerShareOrder): string {
  const raw = (order.status ?? "").trim().toLowerCase();
  if (!raw) return "";
  const stage = toStage(raw, order.fulfillment_type);
  if (stage) return STAGE_LABEL[stage];
  if (raw === "cancelled") return "Cancelled";
  if (raw === "pending_payment") return "Awaiting payment";
  return "";
}

/** Payment in plain words, from method + status together.
 *
 *  Neither field says enough alone: `payment_status = 'pending'` is normal
 *  and unalarming on a COD order and means money is owed on an online one.
 *  Reading them as a pair is the only way to avoid telling a customer their
 *  paid order is "pending" — and, in the other direction, `paid` alone is not
 *  "Paid online": admin marks a COD order paid once the rider has the cash,
 *  and telling the customer they paid online is how you get charged twice.
 *
 *  Deliberately NOT shared with `paymentLabel` in /orders/[id]/page.tsx. That
 *  one fills a coloured pill sitting under a "Payment" heading, so "Paid" is
 *  a complete sentence there; a line in a forwarded message has no heading
 *  and has to say what was paid and how. */
export function sharePaymentLabel(order: CustomerShareOrder): string {
  const method = (order.payment_method ?? "").trim().toLowerCase();
  const status = (order.payment_status ?? "").trim().toLowerCase();
  // Nobody delivers anything on a pickup order, so "cash on delivery" there
  // is a small lie that reads as a promise to come to the door.
  const cash =
    order.fulfillment_type === "pickup" ? "Cash on pickup" : "Cash on delivery";

  if (status === "refunded") return "Refunded";
  if (status === "paid") {
    return method === "cod" ? `Paid, ${cash.toLowerCase()}` : "Paid online";
  }
  if (status === "failed") return "Payment failed";
  if (method === "cod") return cash;
  if (method === "razorpay") return "Payment pending";
  return "";
}

export type CustomerShareOrder = {
  order_number?: string | null;
  // No `public_ref`. The field was declared here and left unread after the
  // switch to OLF, which is an invitation: the next person adding a line to
  // this message finds a customer-facing reference already in the type. It is
  // not customer-facing. It is an admin search key.
  status?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
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
    order.order_number?.trim() || "",
    order.customer?.phone?.trim() || "",
    shareStatusLabel(order),
    sharePaymentLabel(order),
    ...itemLines(order.items),
    whenLine(order, isPickup),
    ...placeLines(order, isPickup),
  ]
    .filter(Boolean)
    .join("\n");
}
