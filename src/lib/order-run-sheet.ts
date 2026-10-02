// The RUN SHEET — the filtered order list as it leaves the building.
//
// Seven fields, in this order, settled with Sunny and not negotiable here:
//
//   Order ID · Name · Number · Address · Total · Payment status · Date
//
// It is NOT the packing list. /admin/orders/print groups by zone → date →
// slot and prints items, loaf subtotals and the notes strip, because the
// kitchen packs by route slot. This document answers a different question —
// "who am I visiting, and do I take money" — for a delivery partner reading
// it on paper or in a WhatsApp thread. Two documents, two layouts; merging
// them would mean one of the two audiences reads a sheet aimed at the other.
//
// ONE COMPOSER, TWO SURFACES. The print route and the WhatsApp text both
// call `runSheetFields`, so a field cannot say one thing on paper and
// another in the chat. Only the arrangement differs: a table on the page,
// four wrapped lines in the message.
//
// WHAT IS DELIBERATELY ABSENT, and must stay absent:
//   • NO delivery fee. • NO serviceability or distance claim.
// The WhatsApp bot is forbidden from quoting either (a fee depends on a
// resolved distance the sheet does not carry, and "we deliver there" is a
// promise nobody holding this sheet is authorised to make). Nothing here
// reads delivery_fee or distance_km at all, so the rule holds by
// construction rather than by review.
//
// WHICH PAYMENT VOCABULARY. `paymentLabel` — the RIDER's binary
// instruction, PAID or COD. Not `paymentView`, which is the admin's
// four-outcome diagnosis. See the contract at the top of payment-label.ts:
// the 34 live `razorpay` + `created` rows read "Awaiting" on the board and
// COD here ON PURPOSE, because no money has arrived and whoever carries
// this sheet must collect. The header names the payment FILTER in the
// admin's words, so that divergence is visible on the sheet rather than
// hidden by it.

import { formatDate, formatINR } from "@/lib/admin-formatting";
import { orderDateForBasis, type DateBasis } from "@/lib/day-filter";
import { formatOrderNumber } from "@/lib/order-number";
import { paymentLabel } from "@/lib/payment-label";

/** The fields the sheet reads. Structural, so AdminOrderRow satisfies it
 *  without a cast and without this module importing the board's types. */
export type RunSheetOrder = {
  id: string;
  order_number?: string | null;
  customers?: { full_name?: string | null; phone?: string | null } | null;
  delivery_address?: string | null;
  total_amount?: number | null;
  payment_status?: string | null;
  /** Read through orderDateForBasis, never directly — the sheet must be
   *  dated on the same column the screen was filtered by. */
  delivery_date?: string | null;
  created_at: string;
};

/** The seven fields, already rendered. The missing-value placeholder is the
 *  house em dash in BOTH surfaces: a field that reads "—" on the printout
 *  and something else in the chat is the same drift this file exists to
 *  prevent, one size smaller. */
export type RunSheetFields = {
  orderId: string;
  name: string;
  phone: string;
  address: string;
  total: string;
  payment: string;
  date: string;
};

const DASH = "—";

export function runSheetFields(
  o: RunSheetOrder,
  basis: DateBasis,
): RunSheetFields {
  return {
    orderId: formatOrderNumber(o),
    name: o.customers?.full_name?.trim() || DASH,
    phone: o.customers?.phone?.trim() || DASH,
    address: o.delivery_address?.trim() || DASH,
    total: formatINR(o.total_amount),
    // amountDue is deliberately null: the Total field is already standing
    // next to this one, and "COD ₹280 · ₹280" invites the reader to think
    // two different numbers are in play.
    payment: paymentLabel({ payment_status: o.payment_status }),
    date: formatDate(orderDateForBasis(o, basis)),
  };
}

/**
 * One order as ONE block, wrapped over four lines.
 *
 * The wrapping is not decoration. A single pipe-joined line of seven
 * fields soft-wraps unpredictably in a WhatsApp bubble on a phone, and the
 * address — the longest field and the one that must be read correctly — is
 * what ends up broken across the fold. Grouping it as identity / contact /
 * where / money keeps each line short enough to survive the bubble:
 *
 *   OLF71
 *   Ravi Kumar · 9876543210
 *   12-3-4 Beach Road, Vizag
 *   ₹280 · COD · 2 Oct 2026
 */
export function composeRunSheetBlock(f: RunSheetFields): string {
  return [
    f.orderId,
    `${f.name} · ${f.phone}`,
    f.address,
    `${f.total} · ${f.payment} · ${f.date}`,
  ].join("\n");
}

/** What the sheet was cut from, for the header line. Every field is a
 *  sentence fragment the operator already recognises from the screen. */
export type RunSheetSlice = {
  /** "2 Oct 2026 (by delivery date)" or "all dates". */
  dayLabel: string;
  /** The joined filter groups, or "all". Built by the caller from the same
   *  labels the dropdown shows, in the admin's vocabulary. */
  filterLabel: string;
  /** The search box, verbatim. Empty means it was not narrowing anything. */
  query?: string;
};

/**
 * The whole run sheet as WhatsApp text.
 *
 * EACH ORDER IS ITS OWN `\n\n`-SEPARATED BLOCK, and that is the load-bearing
 * detail. `splitShareMessage` (share-chunks.ts) cuts a long message only on
 * blank-line boundaries, so this shape guarantees a cut can never land in
 * the middle of a stop — a half-printed address is worse than a second
 * message. A 179-row list is far past the wa.me ceiling and WILL be split
 * into parts; the header is block 0, so only part 1 carries it, which is
 * why the parts are numbered.
 */
export function composeRunSheet(
  orders: readonly RunSheetOrder[],
  basis: DateBasis,
  slice: RunSheetSlice,
): string {
  const header = [
    `CADIEUX — RUN SHEET`,
    `${slice.dayLabel} · ${orders.length} order${orders.length === 1 ? "" : "s"}`,
    `Filter: ${slice.filterLabel}`,
    ...(slice.query?.trim() ? [`Search: ${slice.query.trim()}`] : []),
  ].join("\n");

  const blocks = orders.map((o) =>
    composeRunSheetBlock(runSheetFields(o, basis)),
  );
  return [header, ...blocks].join("\n\n");
}
