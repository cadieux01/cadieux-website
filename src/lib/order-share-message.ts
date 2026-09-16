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
 */
export type ShareStop = { text: string; cashDue: number };

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
 */
export function composeRun(stops: ShareStop[]): string {
  const total = stops.reduce((n, s) => n + (Number.isFinite(s.cashDue) ? s.cashDue : 0), 0);
  return [
    ...stops.map((s) => s.text),
    `Cash to collect on this run: ${rupees(total)}`,
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

  return {
    text: composeShareMessageFromParts({
      reference: formatOrderNumber(order),
      payment: paymentLine(facts),
      customerName: order.customers?.full_name?.trim() || "Customer",
      customerPhone: order.customers?.phone?.trim() || "—",
      address,
      mapsLink: mapsLinkFor(address, order.latitude, order.longitude),
      itemLines: itemLines(order.items),
    }),
    cashDue: cashDueFor(facts),
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
