// The order receipt — one order, rendered for the customer who placed it.
//
// WHAT THIS DOCUMENT IS, AND IS NOT. It is a RECEIPT: proof of what was
// bought and what was charged. It is NOT a tax invoice, and the difference
// is not cosmetic:
//
//   • Title is "Order Receipt". Never "Invoice", never "Tax Invoice".
//   • NO GSTIN, NO tax line, NO HSN codes. Printing a tax breakdown on a
//     document that is not a tax invoice misstates what was collected.
//   • NO new numbering series. A tax invoice needs its own gapless series;
//     a receipt does not, so this reuses `order_number` (the OLF series)
//     and mints nothing. See lib/order-number.ts — the counters are split
//     OLF/OLS and must never be renumbered.
//
// The FSSAI licence IS printed, because it is a food-business disclosure and
// true of every order. The GST registration is deliberately absent.
//
// WHY A SEPARATE MODULE FROM THE ROUTE. Everything here is pure, so the two
// failure modes that matter can be tested without a database:
//
//   1. A receipt with a total and NO LINE ITEMS. `orders.items` has two live
//      shapes and a reader that handles one silently drops every line of the
//      other — see the header of lib/order-items.ts. The receipt still shows
//      a grand total, so the page looks fine and is wrong.
//   2. A delivery fee read as zero because the column was never projected.
//      ORDER_RECEIPT_SELECT below is the single projection and
//      tests/order-receipt.test.mjs asserts delivery_fee is still in it.

import {
  itemLineTotal,
  itemName,
  itemQty,
  itemSlug,
  itemUnitPrice,
  type OrderItemLike,
} from "@/lib/order-items";
import { customerPaymentLabel } from "@/lib/customer-payment-wording";
import { PRODUCTS } from "@/lib/data";
import { PICKUP_FULFILLMENT } from "@/lib/fulfillment-type";
import { formatOrderNumber } from "@/lib/order-number";

/** Printed at the top of every receipt. Not an invoice title — see header. */
export const RECEIPT_TITLE = "Order Receipt";

export const RECEIPT_BUSINESS_NAME = "Cadieux";

/**
 * FSSAI licence number, printed as a food-business disclosure.
 *
 * There is intentionally no GSTIN constant in this file. If one is ever
 * added, it does not belong on this document — see the header.
 */
export const RECEIPT_FSSAI = "20126051001081";

/**
 * Every `orders` column the receipt reads, and the ONLY place they are
 * named. The route must project this constant rather than its own string:
 * a second projection is how a column goes missing from one caller.
 *
 * `delivery_fee` IS IN THIS LIST AND MUST STAY. A dropped projection does
 * not throw — Postgres simply does not return the key, the row object has
 * `undefined`, and a reader that coerces it would print a ₹0 delivery fee
 * on an order that was charged one. That bug class has already cost ₹525
 * across 18 orders. readDeliveryFee() below returns null rather than 0 for
 * exactly this reason, and the tripwire test asserts the column's presence
 * here so the projection cannot quietly shrink.
 */
export const RECEIPT_ORDER_COLUMNS = [
  "id",
  "order_number",
  "created_at",
  "delivery_address",
  "items",
  "delivery_fee",
  "total_amount",
  "payment_method",
  "payment_status",
  "fulfillment_type",
  "customer_id",
] as const;

export const ORDER_RECEIPT_SELECT = RECEIPT_ORDER_COLUMNS.join(", ");

/** The `customers` columns the receipt reads. Name and phone are PII — the
 *  ownership check is the only thing keeping them private. */
export const RECEIPT_CUSTOMER_SELECT = "id, full_name, phone";

export type ReceiptOrderRow = {
  id?: string | null;
  /** Already carries the prefix ("OLF504") — the column is text. */
  order_number?: string | null;
  created_at?: string | null;
  delivery_address?: string | null;
  items?: unknown;
  /** Absent when the projection dropped it — NOT the same as 0. */
  delivery_fee?: number | string | null;
  total_amount?: number | string | null;
  payment_method?: string | null;
  payment_status?: string | null;
  fulfillment_type?: string | null;
  customer_id?: string | null;
};

export type ReceiptCustomer = {
  id?: string | null;
  full_name?: string | null;
  phone?: string | null;
};

export type ReceiptLine = {
  /** Identity, for a stable key. Null on a line carrying neither id column. */
  slug: string | null;
  /** What the customer saw. Never blank — falls back to the slug. */
  name: string;
  qty: number;
  /** Null when the stored line carried no unit price. Renders as "—". */
  unitPrice: number | null;
  /** Null when the stored line carried no money at all. Renders as "—". */
  lineTotal: number | null;
};

export type Receipt = {
  title: string;
  businessName: string;
  fssai: string;
  /** "OLF504" — the existing series, reused. Null on a pre-trigger row. */
  orderNumber: string | null;
  placedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /** Null for a pickup order, which has no delivery address. */
  deliveryAddress: string | null;
  fulfillment: "delivery" | "pickup";
  lines: ReceiptLine[];
  /** Sum of the line totals that carried money. Informational. */
  itemsSubtotal: number;
  /** Null when unknown. NEVER silently 0 — see RECEIPT_ORDER_COLUMNS. */
  deliveryFee: number | null;
  /** The stored `total_amount` — what was actually charged. */
  grandTotal: number | null;
  /** "Paid" · "Cash on Delivery" · "Pay at Pickup" · "Awaiting payment". */
  paymentLabel: string;
};

/** Display names for slugs, so a line that stored no `name` still reads as
 *  words. Built once; PRODUCTS is a bundled constant. */
const NAME_BY_SLUG: Record<string, string> = Object.fromEntries(
  PRODUCTS.map((p) => [p.slug, p.name]),
);

function readMoney(raw: number | string | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * The delivery fee, or null when the row does not carry one.
 *
 * NULL IS NOT ZERO AND MUST NOT BECOME ZERO. Three different situations
 * reach here and only one of them is a free delivery:
 *   • a real 0        — pickup, or a waived fee. Prints "₹0".
 *   • a real number   — prints it.
 *   • absent / null   — the column was not projected, or predates it.
 *                       Prints "—", which is honest; a "₹0" would be a
 *                       claim about money that nobody made.
 */
export function readDeliveryFee(row: ReceiptOrderRow): number | null {
  return readMoney(row.delivery_fee);
}

/**
 * Does this order belong to this customer?
 *
 * Extracted as its own predicate so the ownership rule is testable without a
 * database, which is the only way the "another customer's order" case gets a
 * regression test at all. A missing id on EITHER side is false — an
 * unauthenticated caller must never match an order whose customer_id is null.
 */
export function orderBelongsToCustomer(
  order: Pick<ReceiptOrderRow, "customer_id"> | null | undefined,
  customerId: string | null | undefined,
): boolean {
  const owner = (order?.customer_id ?? "").trim();
  const asking = (customerId ?? "").trim();
  if (!owner || !asking) return false;
  return owner === asking;
}

/**
 * One receipt line per stored item, in stored order.
 *
 * SHAPE-TOLERANT THROUGHOUT — every field goes through lib/order-items.ts,
 * which coalesces shape A (`slug`/`qty`/`price_inr`/`line_total`) and shape B
 * (`product_id`/`quantity`/`unit_price_inr`/`line_total_inr`). Reading shape
 * A's key names alone would return an empty list for an app-placed order
 * while the grand total still printed: a receipt with a total and no items,
 * which is the silent failure this is written against. OLF504 is a real
 * shape-B order and is the fixture in the test.
 *
 * Lines with zero units are dropped — they were not baked and not charged.
 */
export function receiptLines(items: unknown): ReceiptLine[] {
  if (!Array.isArray(items)) return [];
  return items
    .map((raw) => {
      const it = (raw ?? {}) as OrderItemLike;
      const slug = itemSlug(it);
      const name =
        itemName(it) ?? (slug ? NAME_BY_SLUG[slug] ?? slug : null) ?? "Item";
      return {
        slug,
        name,
        qty: itemQty(it),
        unitPrice: itemUnitPrice(it),
        lineTotal: itemLineTotal(it),
      };
    })
    .filter((l) => l.qty > 0);
}

/**
 * The whole receipt, from an order row and its customer.
 *
 * GRAND TOTAL IS THE STORED `total_amount`, never a re-addition of the
 * lines. The stored figure is what the customer was actually charged; a
 * recomputed one would quietly disagree with their bank statement on any
 * order that was edited, discounted, or carries a fee the lines don't show.
 * `itemsSubtotal` is offered alongside it precisely so the two can be read
 * against each other instead of one being invented from the other.
 */
export function buildReceipt(input: {
  order: ReceiptOrderRow;
  customer?: ReceiptCustomer | null;
}): Receipt {
  const { order, customer } = input;
  const lines = receiptLines(order.items);
  const isPickup =
    (order.fulfillment_type ?? "").trim().toLowerCase() === PICKUP_FULFILLMENT;

  // formatOrderNumber owns this string, including the "#<id slice>" fallback
  // for pre-trigger rows. Reused rather than respelled: the OLF/OLS counters
  // must never be renumbered or reformatted in a second place.
  const orderNumber = order.id
    ? formatOrderNumber({ id: order.id, order_number: order.order_number })
    : order.order_number?.trim() || null;

  return {
    title: RECEIPT_TITLE,
    businessName: RECEIPT_BUSINESS_NAME,
    fssai: RECEIPT_FSSAI,
    orderNumber,
    placedAt: order.created_at ?? null,
    customerName: customer?.full_name?.trim() || null,
    customerPhone: customer?.phone?.trim() || null,
    deliveryAddress: isPickup ? null : order.delivery_address?.trim() || null,
    fulfillment: isPickup ? "pickup" : "delivery",
    lines,
    itemsSubtotal: lines.reduce((sum, l) => sum + (l.lineTotal ?? 0), 0),
    deliveryFee: readDeliveryFee(order),
    grandTotal: readMoney(order.total_amount),
    paymentLabel: customerPaymentLabel({
      payment_status: order.payment_status,
      payment_method: order.payment_method,
      fulfillmentType: order.fulfillment_type,
    }),
  };
}
