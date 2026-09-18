// The ONE share-message format. Every "Share" button in admin — orders
// list, order detail, subscriptions list, subscription detail — sends this
// exact shape, so a rider always reads the same things in the same order:
//
//   OLF71
//   COLLECT ₹280
//   Customer name
//   Phone number
//   Address
//   <Google Maps link>
//   Multigrain x2
//   Plain x1
//
//   Cash to collect on this run: ₹280
//
// PAYMENT WAS DELIBERATELY ABSENT UNTIL 2026-09-16, and the note that used
// to sit here argued for keeping it that way: a rider holding a bag needs
// the door and the loaves, and every extra line pushes those down the
// WhatsApp preview. That reasoning was sound about *slots and totals* and
// wrong about payment. A rider who does not know whether to take money
// either collects on a prepaid order or leaves without collecting on a COD
// one, and both of those cost real money on the day. So payment now sits on
// line two, above the address — the one place it cannot be scrolled past.
//
// Nothing else was added. No slot, no grand total, no plan cadence.

import { formatOrderNumber } from "@/lib/order-number";
import {
  isPaidStatus,
  paymentLabel,
  rupees,
  type PaymentFacts,
} from "@/lib/payment-label";
import type { AdminOrderRow, AdminOrderItemSnapshot } from "@/lib/admin-shared";
import {
  EMPTY_RULE_SET,
  ZONE_LABELS,
  resolveZoneWithSource,
  type ZoneRuleSet,
} from "@/lib/delivery-zones";

export type { PaymentFacts };

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

/** "Multigrain x2" per line — the whole point of the message.
 *  Shared with the customer-facing composer (@/lib/order-share-customer):
 *  the two messages order their fields differently but a bread line is a
 *  bread line, and "2 loaves" must never appear in either. */
export function itemLines(items: AdminOrderItemSnapshot[] | null | undefined): string[] {
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

/* ------------------------------------------------------------------ *
 * MULTI-STOP ROUTE
 *
 * A per-stop pin costs ~90 chars each; fourteen of them is ~1,260 chars
 * of a message WhatsApp was already cutting short. One route link at the
 * end replaces all of them and is more useful besides — the rider gets
 * turn-by-turn through the whole run instead of fourteen separate pins
 * he has to re-open one at a time.
 * ------------------------------------------------------------------ */

/**
 * Consumer Google Maps refuses a route with more than ten points. A run
 * longer than that is split into legs that OVERLAP by one stop, so leg 2
 * starts where leg 1 ended and the rider never has to work out where he
 * was.
 */
const MAX_ROUTE_POINTS = 10;

/** One stop as a route point: coordinates when we have them, else the
 *  address text, which Maps geocodes the same way the pin link did.
 *
 *  The leading `[Home]` / `[Work]` label is stripped off the address
 *  form. It is a label the customer picked for their own benefit, it is
 *  not part of any address, and handing Maps a bracketed word to
 *  geocode makes the match worse, not better. It stays on the stop's
 *  own address line, where the rider reads it. */
export function waypointFor(
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
  return hasCoords ? `${lat},${lng}` : address.replace(/^\s*\[[^\]]*\]\s*/, "");
}

/**
 * One `/maps/dir/` link per leg. The path form is used rather than
 * `?api=1&destination=…&waypoints=…` because it is far shorter — a coord
 * stop costs ~20 chars instead of ~30 — and shortening the message is the
 * whole point of this function.
 *
 * A single stop gets no route link at all: `composeShareStop` already
 * carries its pin, and "directions to one place" is just that pin.
 */
export function routeLinksFor(waypoints: readonly string[]): string[] {
  const points = waypoints.map((w) => w.trim()).filter(Boolean);
  if (points.length < 2) return [];

  const links: string[] = [];
  for (let i = 0; i < points.length - 1; i += MAX_ROUTE_POINTS - 1) {
    const leg = points.slice(i, i + MAX_ROUTE_POINTS);
    links.push(
      `https://www.google.com/maps/dir/${leg.map(encodeURIComponent).join("/")}`,
    );
  }
  return links;
}

/* ------------------------------------------------------------------ *
 * PAYMENT
 *
 * The word itself lives in @/lib/payment-label so the packing list and
 * the receipts say it the same way. Only the "what does that cost us"
 * side is here.
 * ------------------------------------------------------------------ */

/**
 * Rupees expected back from this stop.
 *
 * MUST agree with paymentLabel(): anything it calls COD is money someone
 * hands over, so the same rows that print "COD ₹340" are the rows that
 * add 340 to the run total. Keying this off payment_method (as it once
 * did) broke that — an `online` + `pending` row printed COD and counted
 * zero.
 */
export function cashDueFor(p: PaymentFacts): number {
  if (isPaidStatus(p.payment_status)) return 0;
  const due = p.amountDue;
  return typeof due === "number" && Number.isFinite(due) ? due : 0;
}

/* ------------------------------------------------------------------ *
 * SHAPE
 * ------------------------------------------------------------------ */

export type ShareMessageParts = {
  /** Top line: "OLF71" for an order, "Subscription OLS12 · …" for a plan. */
  reference: string;
  /** Line two: "PAID" or "COD ₹340". See @/lib/payment-label. */
  payment: string;
  /** Line three (optional): the resolved zone, e.g. "Zone 2". Derived at
   *  read time from delivery-zones.ts; omitted when the caller could not
   *  resolve one, so the message never carries a fake "Unzoned" label the
   *  rider then has to interpret. */
  zone?: string;
  customerName: string;
  customerPhone: string;
  address: string;
  /** Omitted on a multi-stop run, where ONE route link at the end of the
   *  message replaces every per-stop pin. */
  mapsLink?: string;
  /** Already short-form, e.g. ["Multigrain x2", "Plain x1"]. */
  itemLines: string[];
};

/**
 * One stop, plus what it owes. Kept together so the run total below can
 * never disagree with the COLLECT lines above it — the sum is derived from
 * the same values that were printed, not recomputed from the rows.
 */
export type ShareStop = {
  text: string;
  cashDue: number;
  /**
   * True when the customer collects from the counter themselves. Such a
   * stop still gets a block — the operator selected it — but its cash is
   * NOT the rider's, so it is kept out of his total. Optional because
   * every subscription stop is delivered; omitted means delivered.
   */
  pickup?: boolean;
};

/** The single formatter. Every composer funnels through this. */
export function composeShareMessageFromParts(parts: ShareMessageParts): string {
  return [
    parts.reference,
    parts.payment,
    parts.zone,
    parts.customerName,
    parts.customerPhone,
    parts.address,
    parts.mapsLink,
    ...parts.itemLines,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * A run: one or more stops, then anything that belongs to the run as a
 * whole (the route links), then the cash total.
 *
 * The total goes LAST so it is the thing a rider scrolls to and the thing
 * a glance at the bottom of the message lands on. It is always printed,
 * including "₹0" — a rider who sees a figure every time knows the line
 * was not simply omitted, and "₹0" is a positive statement that this run
 * is fully prepaid.
 *
 * PICKUP CASH IS NOT IN THAT TOTAL. A pickup customer pays at the
 * counter, so counting their COD told the rider to come back with money
 * nobody was ever going to hand him — on a recent 14-stop day that was
 * ₹720 of a ₹2,324 figure, and the gap reads as a rider who is short.
 * It gets its own line, and only when there is some, so the common
 * all-delivery run is unchanged.
 */
export function composeRun(stops: ShareStop[], trailer: readonly string[] = []): string {
  const sum = (keep: (s: ShareStop) => boolean) =>
    stops.reduce(
      (n, s) => n + (keep(s) && Number.isFinite(s.cashDue) ? s.cashDue : 0),
      0,
    );
  const riderCash = sum((s) => !s.pickup);
  const counterCash = sum((s) => Boolean(s.pickup));

  return [
    ...stops.map((s) => s.text),
    ...trailer,
    `Cash to collect: ${rupees(riderCash)}`,
    ...(counterCash > 0
      ? [`Pickup, paid at the counter (NOT yours to collect): ${rupees(counterCash)}`]
      : []),
  ].join("\n\n");
}

/* ------------------------------------------------------------------ *
 * ORDERS
 * ------------------------------------------------------------------ */

/** One order as a stop. `includePin` is false on a multi-stop run, where
 *  the route links at the end of the message carry the navigation. */
function shareStop(
  order: AdminOrderRow,
  includePin: boolean,
  rules: ZoneRuleSet = EMPTY_RULE_SET,
): ShareStop {
  const address = order.delivery_address?.trim() || "—";
  const facts: PaymentFacts = {
    payment_status: order.payment_status,
    // An order's total IS its one stop's total, so unlike a subscription
    // there is nothing to divide.
    amountDue: typeof order.total_amount === "number" ? order.total_amount : null,
  };
  // Zone comes from the ONE map — see src/lib/delivery-zones.ts. The label
  // sits between payment and customer name so the rider sees "COD Rs280 /
  // Zone 2 / Ravi Kumar" — one glance names the run, the money and the
  // door in that order. `rules` is the learned override bundle the board
  // fetched; when the caller passed no rules, EMPTY_RULE_SET falls the
  // resolver back to the built-in map (identical to the pre-rules
  // behaviour, so old call sites keep working).
  const zoneKey = resolveZoneWithSource(
    {
      address: order.delivery_address,
      isPickup: order.fulfillment_type === "pickup",
      orderId: order.id,
    },
    rules,
  ).zone;

  return {
    text: composeShareMessageFromParts({
      reference: formatOrderNumber(order),
      payment: paymentLabel(facts),
      zone: ZONE_LABELS[zoneKey],
      customerName: order.customers?.full_name?.trim() || "Customer",
      customerPhone: order.customers?.phone?.trim() || "—",
      address,
      mapsLink: includePin
        ? mapsLinkFor(address, order.latitude, order.longitude)
        : undefined,
      itemLines: itemLines(order.items),
    }),
    cashDue: cashDueFor(facts),
    pickup: !isShareable(order),
  };
}

/** One order as a stop, pin included. Used by callers that assemble their
 *  own runs (subscriptions) and still want a pin on every stop. `rules` is
 *  the learned-override bundle the board fetched; omit to fall back to the
 *  built-in map. */
export function composeShareStop(
  order: AdminOrderRow,
  rules: ZoneRuleSet = EMPTY_RULE_SET,
): ShareStop {
  return shareStop(order, true, rules);
}

/** A single order, shared on its own — a run of one. */
export function composeShareMessage(
  order: AdminOrderRow,
  rules: ZoneRuleSet = EMPTY_RULE_SET,
): string {
  return composeRun([composeShareStop(order, rules)]);
}

/**
 * Several orders as one rider run, in the order given. Per-stop pins are
 * dropped in favour of route links at the end — see MAX_ROUTE_POINTS.
 * A run of one falls through to the single-order message, pin and all.
 */
export function composeShareRun(
  orders: AdminOrderRow[],
  rules: ZoneRuleSet = EMPTY_RULE_SET,
): string {
  if (orders.length <= 1) {
    return orders.length === 1
      ? composeShareMessage(orders[0], rules)
      : composeRun([]);
  }

  // Pickup orders still get a block — the operator selected them and the
  // details may be why — but they are NOT route points. Nobody rides to
  // a pickup order, so routing the rider through the dark store would
  // send him somewhere he has no reason to go.
  const routed = orders.filter(isShareable);
  const links = routeLinksFor(
    routed.map((o) =>
      waypointFor(o.delivery_address?.trim() || "—", o.latitude, o.longitude),
    ),
  );

  // THE INVARIANT: every stop is either on the route or carries its own
  // pin. A pin is only dropped when a route link demonstrably replaces
  // it. Two stops of which one is a pickup leaves a single route point,
  // `routeLinksFor` returns nothing, and without this the one real
  // delivery would have gone out with no map link at all.
  const onRoute = (o: AdminOrderRow) => links.length > 0 && routed.includes(o);
  const stops = orders.map((o) => shareStop(o, !onRoute(o), rules));

  const trailer =
    links.length === 0
      ? []
      : links.length === 1
        ? [`Route: ${links[0]}`]
        : links.map((l, i) => `Route ${i + 1} of ${links.length}: ${l}`);

  return composeRun(stops, trailer);
}

/** Returns true if the Share button should be shown for this order. */
export function isShareable(order: AdminOrderRow): boolean {
  // Pickup orders don't get delivered by a rider → hide the button.
  if (order.fulfillment_type === "pickup") return false;
  return true;
}
