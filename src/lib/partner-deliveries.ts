// Orders and subscriptions, flattened into ONE row shape for the partner
// deliveries board (/admin/deliveries).
//
// WHY A SEPARATE MODULE. The board asks one question of two tables that
// answer it differently — orders carry a TEXT address and one delivery
// date, subscriptions carry a jsonb address and a SET of dates. Doing that
// flattening inside the page component would put the two shapes' quirks
// next to the JSX, which is where they get quietly simplified away. Here
// they are the subject.
//
// THIS MODULE NEVER RESOLVES A ZONE ITSELF. It calls
// `resolveZoneWithSource` with exactly the arguments /admin/orders and
// /admin/subscriptions already pass. If this board re-derived zones the
// two would disagree and the partner would drive the wrong list.
//
// Stages 2 and 3 (zone assignment, notes) are not built here, but nothing
// below designs them out: `zoneSource` is carried so a row override can be
// shown as provenance, `orderId`/`subscriptionId` are kept so an override
// can be written against the right parent, and `note` is on the row type
// already, always null for now.

import {
  flattenSubscriptionAddress,
  resolveZoneWithSource,
  type ZoneKey,
  type ZoneRuleSet,
  type ZoneSource,
} from "@/lib/delivery-zones";
import { matchesSelection, toIstDay, type DaySelection } from "@/lib/day-filter";
import { itemQty, itemSlug } from "@/lib/order-items";
import { formatOrderNumber, formatSubscriptionNumber } from "@/lib/order-number";
import type { AdminOrderRow, AdminSubscriptionRow } from "@/lib/admin-shared";

export type DeliverySource = "orders" | "subscriptions";

export type DeliveryRow = {
  /** Unique across both sources — the id is prefixed, because an order and
   *  a subscription id are drawn from different tables and nothing stops
   *  them colliding as React keys. */
  key: string;
  source: DeliverySource;
  /** OLF… / OLS…, via the shared formatters. */
  ref: string;
  /** Parent ids, carried for stage 2's row overrides. Exactly one is set. */
  orderId: string | null;
  subscriptionId: string | null;
  customerName: string | null;
  /** Doubles as the WhatsApp number — there is only one number on a row. */
  phone: string | null;
  /** Orders: `delivery_address` verbatim. Subscriptions: the jsonb
   *  flattened by the shared helper the subscriptions board uses. */
  address: string;
  /** Present on orders placed after the share-location feature and on
   *  subscriptions whose customer has a saved address with coords. Null
   *  everywhere else, which is why the Map action is a SEARCH by default. */
  latitude: number | null;
  longitude: number | null;
  zone: ZoneKey;
  zoneSource: ZoneSource;
  paymentMode: string;
  totalInr: number | null;
  /** Every IST calendar day this row delivers on. One entry for an order,
   *  possibly many for a subscription. */
  dates: string[];
  /** slug -> loaves, for the whole row. */
  counts: Record<string, number>;
  /** date -> slug -> loaves. Subscriptions only; null for orders, whose
   *  single date makes `counts` already per-date. */
  countsByDate: Record<string, Record<string, number>> | null;
  /** Stage 3. Rendered as an empty cell today, deliberately. */
  note: string | null;
  /** Lowercased haystack for the search box, built once per row. */
  haystack: string;
};

function sumCounts(items: AdminOrderRow["items"]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const it of items ?? []) {
    // itemSlug/itemQty because orders.items has two live jsonb shapes —
    // web writes slug/qty, the app writes product_id/quantity. Reading
    // one of them alone silently loses the other client's lines.
    const slug = itemSlug(it);
    const qty = itemQty(it);
    if (!slug || qty <= 0) continue;
    out[slug] = (out[slug] ?? 0) + qty;
  }
  return out;
}

function haystackOf(parts: (string | null | undefined)[]): string {
  return parts
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/** Payment mode as the operator needs it: how the money arrives, which is
 *  the thing that decides whether they collect cash at the door. An absent
 *  method on a paid row is online (the column post-dates Razorpay-only
 *  ordering), so guessing "COD" there would send a partner to collect
 *  money that is already in the bank. */
function paymentModeOf(
  method: string | null | undefined,
  status: string | null | undefined,
): string {
  const m = (method ?? "").trim().toLowerCase();
  if (m === "cod" || m === "cash") return "COD";
  if (m) return m.toUpperCase();
  const s = (status ?? "").trim().toLowerCase();
  if (s === "paid" || s === "captured") return "ONLINE";
  return "—";
}

export function orderToDeliveryRow(
  o: AdminOrderRow,
  rules: ZoneRuleSet,
): DeliveryRow {
  // The argument shape is copied from /admin/orders/page.tsx, not invented.
  const { zone, source } = resolveZoneWithSource(
    {
      address: o.delivery_address,
      isPickup: o.fulfillment_type === "pickup",
      orderId: o.id,
    },
    rules,
  );
  const ref = formatOrderNumber(o);
  const address = (o.delivery_address ?? "").trim();
  const name = o.customers?.full_name ?? null;
  const phone = o.customers?.phone ?? null;
  const day = toIstDay(o.delivery_date);
  return {
    key: `order:${o.id}`,
    source: "orders",
    ref,
    orderId: o.id,
    subscriptionId: null,
    customerName: name,
    phone,
    address,
    latitude: o.latitude ?? null,
    longitude: o.longitude ?? null,
    zone,
    zoneSource: source,
    paymentMode: paymentModeOf(o.payment_method, o.payment_status),
    totalInr: o.total_amount,
    // A preorder with no date yet has NO delivery day, which is different
    // from delivering today. It drops out as soon as a day is selected,
    // which is the same rule matchesDay applies everywhere else.
    dates: day ? [day] : [],
    counts: sumCounts(o.items),
    countsByDate: null,
    note: null,
    haystack: haystackOf([ref, o.public_ref, name, phone, address]),
  };
}

export function subscriptionToDeliveryRow(
  s: AdminSubscriptionRow,
  rules: ZoneRuleSet,
): DeliveryRow {
  // Again copied from /admin/subscriptions/page.tsx: the jsonb address is
  // flattened by the shared helper and customer_pincode is passed as the
  // explicit pin, which is more trustworthy than a 6-digit run in the text.
  const address = flattenSubscriptionAddress({
    customer_address: s.customer_address,
    delivery_address: s.delivery_address,
  });
  const { zone, source } = resolveZoneWithSource(
    {
      address,
      pincode: s.customer_pincode ?? null,
      subscriptionId: s.id,
    },
    rules,
  );
  const ref = formatSubscriptionNumber(s);
  const name = s.customer_name ?? s.customer?.full_name ?? null;
  const phone = s.customer_phone ?? s.customer?.phone ?? null;
  return {
    key: `subscription:${s.id}`,
    source: "subscriptions",
    ref,
    orderId: null,
    subscriptionId: s.id,
    customerName: name,
    phone,
    address,
    latitude: s.latitude ?? null,
    longitude: s.longitude ?? null,
    zone,
    zoneSource: source,
    paymentMode: paymentModeOf(s.payment_method, s.payment_status),
    totalInr: s.total_amount,
    // SEE THE MODULE NOTE ON DATES BELOW. delivery_dates is server-built
    // from `scheduled_date ?? delivery_date`; it is not the booked date.
    dates: s.delivery_dates ?? [],
    counts: s.loaf_counts ?? {},
    countsByDate: s.loaf_counts_by_date ?? null,
    note: null,
    haystack: haystackOf([ref, name, phone, address]),
  };
}

// ---------------------------------------------------------------------------
// RECONCILING THE TWO DATE FIELDS
//
// `orders.delivery_date` is a DATE column: the day that order is delivered,
// full stop. A subscription has no such column — its stops live in
// `subscription_deliveries`, which carries BOTH `delivery_date` (the day the
// plan booked) and `scheduled_date` (the day it was moved to, when it was
// moved). Those are different questions, and a router must be told the
// second one: OLS36 was booked for the 23rd, moved to the 21st, and
// delivered on the 21st. Reading `delivery_date` would have routed it on a
// day nobody was home.
//
// So the reconciliation is `scheduled_date ?? delivery_date`, and this board
// does NOT implement that itself — it reads `delivery_dates` and
// `loaf_counts_by_date`, both of which the ?enrich=1 list route already
// builds with that precedence (see deliveryDayKey in lib/subscription-counts
// and the field comments in lib/admin-shared). Cancelled stops are excluded
// there too. Re-deriving it here would be a second implementation of a rule
// that has already produced one bug, and the subscriptions board filters on
// exactly these fields — matching a different set would mean the two boards
// disagree about who is being delivered to.
//
// Net: both sources are reduced to "the IST calendar days this row is
// delivered on", after which one selection filters both.
// ---------------------------------------------------------------------------

/** Does this row deliver within the selection? A row with no dates at all
 *  (an unscheduled preorder) is in scope only when nothing is selected. */
export function rowMatchesSelection(
  row: DeliveryRow,
  sel: DaySelection,
): boolean {
  if (sel.mode === "day" && !sel.day) return true;
  if (sel.mode === "range" && !sel.from && !sel.to) return true;
  return row.dates.some((d) => matchesSelection(d, sel));
}

/**
 * Loaves per slug for THIS row, counting only the days the selection admits.
 *
 * Orders are already per-date — one row, one day — so their whole `counts`
 * is the answer once the row is in scope. Subscriptions are not: a plan with
 * eight stops must contribute the loaves of the stops inside the window, not
 * all eight, or the baker's strip counts a month of bread for one morning.
 */
export function rowCountsForSelection(
  row: DeliveryRow,
  sel: DaySelection,
): Record<string, number> {
  if (!row.countsByDate) return row.counts;
  const unbounded =
    (sel.mode === "day" && !sel.day) ||
    (sel.mode === "range" && !sel.from && !sel.to);
  if (unbounded) return row.counts;
  const out: Record<string, number> = {};
  for (const [day, bySlug] of Object.entries(row.countsByDate)) {
    if (!matchesSelection(day, sel)) continue;
    for (const [slug, n] of Object.entries(bySlug)) {
      if (!Number.isFinite(n)) continue;
      out[slug] = (out[slug] ?? 0) + n;
    }
  }
  return out;
}

/** slug -> loaves across a set of rows, for the product totals strip. */
export function totalsForRows(
  rows: readonly DeliveryRow[],
  sel: DaySelection,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const row of rows) {
    for (const [slug, n] of Object.entries(rowCountsForSelection(row, sel))) {
      out[slug] = (out[slug] ?? 0) + n;
    }
  }
  return out;
}
