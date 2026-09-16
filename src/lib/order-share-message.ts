// The ONE share-message format. Every "Share" button in admin — orders
// list, order detail, subscriptions list, subscription detail — sends this
// exact shape, so a rider always reads the same things in the same order:
//
//   OLF71
//   COLLECT Rs280
//   Customer name
//   Phone number
//   Address
//   <Google Maps link>
//   Multigrain x2
//   Plain x1
//
//   Cash to collect on this run: Rs280
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

/** "Multigrain x2" per line — the whole point of the message.
 *  Shared with the customer-facing composer (@/lib/order-share-customer):
 *  the two messages order their fields differently but a bread line is a
 *  bread line, and "2 loaves" must never appear in either. */
export function itemLines(items: AdminOrderItemSnapshot[] | null | undefined): string[] {
  if (!items || items.length === 0) return [];
  return items.map((it) => `${variantLabel(it.name)} x${lineQty(it)}`);
}

/** True when lat/lng are usable. (0,0) is Null Island, not Visakhapatnam —
 *  it is what a failed geocode leaves behind, so it is treated as absent. */
function hasCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): boolean {
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  );
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
  return hasCoords(lat, lng)
    ? `https://www.google.com/maps?q=${lat},${lng}`
    : `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/**
 * One stop as a path segment for a multi-stop route URL. Coords win over
 * the address string for the same reason they do in mapsLinkFor: a pin is
 * unambiguous and an address typed by a customer is not.
 */
export function routeWaypoint(
  address: string,
  lat: number | null | undefined,
  lng: number | null | undefined,
): string {
  return hasCoords(lat, lng) ? `${lat},${lng}` : address;
}

/**
 * ONE link covering the whole run, instead of one link per stop.
 *
 * Why the `/maps/dir/a/b/c` PATH form and not `dir/?api=1&waypoints=`:
 * the documented api=1 form caps waypoints at 9, and a 14-stop day is
 * ordinary here — it would silently drop the tail of the run, which is the
 * exact class of bug this change exists to remove. The path form has no
 * such cap.
 *
 * The FIRST segment is the origin, so Maps routes stop 1 → stop 2 → … in
 * the order given. That is the order the table was sorted in, which for a
 * "nearest from area" sort is the intended driving sequence. It does NOT
 * route from the rider's current position to stop 1; the rider is leaving
 * from the bakery and already knows how to reach the first door.
 */
export function routeLinkFor(waypoints: string[]): string {
  const segs = waypoints
    .map((w) => w.trim())
    .filter((w) => w.length > 0)
    // Encode, then put the commas back. A comma is a legal sub-delimiter in
    // a path segment, and "17.74,83.33" reads as a coordinate to anyone
    // glancing at the link, where "17.74%2C83.33" reads as line noise — and
    // costs two extra characters per stop in a message that is being
    // shortened precisely because length is what broke it.
    .map((w) => encodeURIComponent(w).replace(/%2C/g, ","));
  return `https://www.google.com/maps/dir/${segs.join("/")}`;
}

/* ------------------------------------------------------------------ *
 * PAYMENT
 * ------------------------------------------------------------------ */

/**
 * "Rs1,440". Deliberately NOT formatINR() — that emits "₹", and the rupee
 * glyph still renders as a box on some of the cheap Android handsets our
 * riders carry. An unreadable amount is worse than an ugly one.
 */
function rupees(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const whole = Math.round(safe * 100) / 100;
  const body = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: 2,
  }).format(whole);
  return `Rs${body}`;
}

export type PaymentFacts = {
  payment_method?: string | null;
  payment_status?: string | null;
  /**
   * Cash due AT THIS STOP, in rupees.
   *
   * For a subscription this is ONE delivery's share of the plan, never the
   * plan total — see subscription-share-message.ts. `null` means "we could
   * not establish the figure", which prints as a instruction to check
   * rather than as a number. Never pass a guess: a rider reads this at a
   * door and asks for exactly what it says.
   */
  amountDue: number | null;
};

/**
 * The payment line. Four states, four fixed strings — riders learn the
 * shapes, so the wording must not drift.
 *
 * Status is read BEFORE method, because status is the settled fact and
 * method is only how it was meant to be settled. A row that says
 * `cod` + `paid` has been paid (Pay Now converts COD orders online and
 * leaves payment_method alone), and reading method first would have told
 * the rider to collect a second time.
 *
 * Anything unrecognised falls through to "check" — the only safe default.
 * Claiming PAID risks never collecting; naming a figure risks collecting
 * the wrong one. "Check" costs a phone call.
 */
export function paymentLine(p: PaymentFacts): string {
  const status = (p.payment_status ?? "").trim().toLowerCase();
  const method = (p.payment_method ?? "").trim().toLowerCase();

  if (status === "paid") return "PAID - collect nothing";
  if (status === "abandoned") return "NOT PAID - do not deliver";
  if (status === "created") return "PAYMENT UNCONFIRMED - check";

  if (method === "cod" && status === "pending") {
    return p.amountDue === null || !Number.isFinite(p.amountDue)
      ? "COLLECT - confirm amount with office"
      : `COLLECT ${rupees(p.amountDue)}`;
  }

  return "PAYMENT UNCONFIRMED - check";
}

/** Rupees the rider is expected to come back with from this stop. */
export function cashDueFor(p: PaymentFacts): number {
  const status = (p.payment_status ?? "").trim().toLowerCase();
  const method = (p.payment_method ?? "").trim().toLowerCase();
  if (method !== "cod" || status !== "pending") return 0;
  return p.amountDue !== null && Number.isFinite(p.amountDue) ? p.amountDue : 0;
}

/* ------------------------------------------------------------------ *
 * SHAPE
 * ------------------------------------------------------------------ */

export type ShareMessageParts = {
  /** Top line: "OLF71" for an order, "Subscription OLS12 · …" for a plan. */
  reference: string;
  /** Line two. One of the four fixed strings from paymentLine(). */
  payment: string;
  customerName: string;
  customerPhone: string;
  address: string;
  mapsLink: string;
  /** Already short-form, e.g. ["Multigrain x2", "Plain x1"]. */
  itemLines: string[];
};

/**
 * One stop, plus what it owes. Kept together so the run total below can
 * never disagree with the COLLECT lines above it — the sum is derived from
 * the same values that were printed, not recomputed from the rows.
 *
 * `parts` and `waypoint` are OPTIONAL and additive. A caller that supplies
 * them lets composeRun collapse the per-stop map links into one route link
 * (see below); a caller that does not — subscription-share-message.ts only
 * ever builds runs of one — keeps today's behaviour exactly.
 */
export type ShareStop = {
  text: string;
  cashDue: number;
  /** The same fields `text` was rendered from, so a multi-stop run can
   *  re-render this stop WITHOUT its map link. */
  parts?: ShareMessageParts;
  /** This stop's segment for the run's single route link. */
  waypoint?: string;
};

/** The single formatter. Every composer funnels through this. */
export function composeShareMessageFromParts(parts: ShareMessageParts): string {
  return [
    parts.reference,
    parts.payment,
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
 * A run: one or more stops, then the cash total.
 *
 * The total is always printed, including "Rs0". A rider who sees a figure
 * every time knows the line was not simply omitted, and "Rs0" is a positive
 * statement that this run is fully prepaid.
 *
 * MULTI-STOP RUNS CARRY ONE ROUTE LINK, NOT ONE LINK PER STOP. A Google
 * Maps URL is 45–110 characters; on a 14-stop day that was over a kilobyte
 * of the message spent restating the same journey, and length is not
 * cosmetic here — it is what was getting the run truncated on the way into
 * WhatsApp. One `/maps/dir/` link is both shorter and more useful: it is
 * the actual route rather than 14 unrelated pins.
 *
 * A run of ONE keeps its inline link. A single order shared on its own is
 * not a journey, and every other Share button in admin (order detail,
 * subscriptions) is a run of one — this rule leaves all of them byte-for-
 * byte unchanged.
 */
export function composeRun(stops: ShareStop[]): string {
  const total = stops.reduce((n, s) => n + (Number.isFinite(s.cashDue) ? s.cashDue : 0), 0);
  const cashLine = `Cash to collect on this run: ${rupees(total)}`;

  // Only collapse when EVERY stop supplied the data to do it. A partial
  // collapse would drop the map link from some stops and keep it on others,
  // leaving the rider with no way to reach the ones that lost it.
  const collapsible =
    stops.length > 1 && stops.every((s) => s.parts && s.waypoint);

  if (!collapsible) {
    return [...stops.map((s) => s.text), cashLine].join("\n\n");
  }

  const bodies = stops.map((s) =>
    composeShareMessageFromParts({ ...s.parts!, mapsLink: "" }),
  );
  const route = routeLinkFor(stops.map((s) => s.waypoint!));
  return [
    ...bodies,
    `Route, ${stops.length} stops in this order:\n${route}\n${cashLine}`,
  ].join("\n\n");
}

/* ------------------------------------------------------------------ *
 * ORDERS
 * ------------------------------------------------------------------ */

/** One order as a stop. Use this when building a multi-stop run. */
export function composeShareStop(order: AdminOrderRow): ShareStop {
  const address = order.delivery_address?.trim() || "—";
  const facts: PaymentFacts = {
    payment_method: order.payment_method,
    payment_status: order.payment_status,
    // An order's total IS its one stop's total, so unlike a subscription
    // there is nothing to divide.
    amountDue: typeof order.total_amount === "number" ? order.total_amount : null,
  };

  const parts: ShareMessageParts = {
    reference: formatOrderNumber(order),
    payment: paymentLine(facts),
    customerName: order.customers?.full_name?.trim() || "Customer",
    customerPhone: order.customers?.phone?.trim() || "—",
    address,
    mapsLink: mapsLinkFor(address, order.latitude, order.longitude),
    itemLines: itemLines(order.items),
  };

  return {
    text: composeShareMessageFromParts(parts),
    cashDue: cashDueFor(facts),
    parts,
    waypoint: routeWaypoint(address, order.latitude, order.longitude),
  };
}

/** A single order, shared on its own — a run of one. */
export function composeShareMessage(order: AdminOrderRow): string {
  return composeRun([composeShareStop(order)]);
}

/** Returns true if the Share button should be shown for this order. */
export function isShareable(order: AdminOrderRow): boolean {
  // Pickup orders don't get delivered by a rider → hide the button.
  if (order.fulfillment_type === "pickup") return false;
  return true;
}
