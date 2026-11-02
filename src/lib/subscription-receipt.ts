// Subscriber receipts — the two documents a subscription produces.
//
//   1. SUBSCRIPTION SUMMARY   one per subscription. The OLS number, when it
//      starts, the days and weeks it runs, what was charged, and the list of
//      delivery dates it covers.
//   2. PER-DELIVERY NOTE      one per subscription_deliveries row. The date,
//      the slot, what is in that bag, and which subscription it belongs to.
//
// WHAT THESE ARE, AND ARE NOT. Both are RECEIPTS, titled as such, and the
// rules from the order receipt carry over verbatim — see the header of
// lib/order-receipt.ts, which this module reuses rather than restates:
// never "Invoice" or "Tax Invoice", no GSTIN, no tax line, no HSN, FSSAI
// only. NO NEW NUMBERING SERIES: `subscription_number` (the OLS series) is
// reused and nothing is minted. The delivery note carries its parent's OLS
// number rather than a reference of its own.
//
// NO MONEY ON THE DELIVERY NOTE, deliberately. One payment covers the whole
// plan, and per-delivery figures on a document the customer receives at the
// door read as a second amount due. The money lives on the summary, once,
// where `total_amount` can be reconciled against the lines. The note is a
// packing document that happens to be printable.
//
// EVERYTHING HERE IS PURE. The two failure modes worth testing are both
// data-shaped, and neither needs a database:
//
//   1. A PROJECTION THAT QUIETLY SHRANK. PostgREST does not error on an
//      unselected column — the key is simply absent, and a reader that
//      coerces it prints a confident wrong number. That is how 130 orders
//      got the wrong COD label. The three *_COLUMNS arrays below are the
//      only place these column names are written, and
//      tests/subscription-receipt.test.mjs asserts the load-bearing ones
//      are still in them.
//   2. THE WRONG COLUMN OF A PAIR. Three columns on these tables have a
//      newer sibling that wins, and reading the older one is silent:
//         scheduled_date      beats delivery_date        (1 row differs)
//         scheduled_time_slot beats slot                 (9 rows differ,
//                                                         8 have slot NULL)
//         subscription_items  beats product_name/qty     (9 mixed plans are
//                                                         mis-attributed)
//      and `day_key` is stale on 11 of 451 rows, so it is NOT PROJECTED at
//      all — the weekday is derived from the date. All four counts measured
//      on prod 2026-11-02.

import {
  RECEIPT_BUSINESS_NAME,
  RECEIPT_FSSAI,
  orderBelongsToCustomer,
  type ReceiptCustomer,
} from "@/lib/order-receipt";
import { customerPaymentLabel } from "@/lib/customer-payment-wording";
import { formatSubscriptionNumber } from "@/lib/order-number";
import { productDisplayName } from "@/lib/product-names";
import { DAY_LABEL, DELIVERY_STATUS_LABEL } from "@/lib/subscription-ui";
import { dayKeyForIsoDate } from "@/lib/subscription-dates";
import { effectiveDeliveryDate, planWeeks } from "@/lib/subscription-end-date";
import { deliveryItems, isCancelledDelivery } from "@/lib/subscription-counts";
import { planItemsOf } from "@/lib/subscription-counts";
import { subscriptionDays } from "@/lib/subscription-display";
import {
  buildSubscriptionMoney,
  type SubscriptionFeeStatus,
} from "@/lib/subscription-money";
import type { AdminSubscriptionItem } from "@/lib/admin-shared";

/** Titles. Both end in "Receipt" — see the header. */
export const SUBSCRIPTION_RECEIPT_TITLE = "Subscription Receipt";
export const DELIVERY_RECEIPT_TITLE = "Delivery Receipt";

export { RECEIPT_BUSINESS_NAME, RECEIPT_FSSAI };

/**
 * The ownership predicate, REUSED not re-implemented.
 *
 * This is a binding to the order receipt's own function, so there is exactly
 * one copy of the rule in the codebase: a missing id on EITHER side is
 * false, and the comparison is on trimmed `customer_id`. The test asserts
 * the two names are the SAME FUNCTION OBJECT, which is what makes a future
 * copy-paste fail loudly.
 *
 * Measured on prod 2026-11-02 before choosing `customer_id` as the key: all
 * 118 subscriptions carry one, none dangles, and on every row it resolves to
 * the same customer as the stored phone — so this is never stricter than the
 * phone match /api/subscriptions/[id] uses.
 */
export const subscriptionBelongsToCustomer = orderBelongsToCustomer;

// ── Projections ─────────────────────────────────────────────────────

/**
 * Every `subscriptions` column either receipt reads, and the ONLY place they
 * are named.
 *
 * `delivery_fee_inr`, `total_amount` and `payment_status` ARE IN THIS LIST
 * AND MUST STAY. The fee and the total are what `buildSubscriptionMoney`
 * reconciles — without the fee it cannot tell a plan that was charged for
 * delivery from one that was not, and it would report `feeStatus: "unknown"`
 * on every row. `payment_status` does double duty: the payment wording, and
 * the `isHiddenSubscription` gate that keeps an unpaid shell from rendering
 * as a real subscription.
 *
 * The legacy single-product trio (`product_slug`, `product_name`,
 * `quantity_per_delivery`) and `bread_price` are projected ONLY to feed
 * buildSubscriptionMoney's legacy fallback. They are never read for labels:
 * on the nine two-bread plans they book everything to Multigrain and read
 * Plain as zero. All 118 prod rows have subscription_items, so the fallback
 * is unreachable today.
 *
 * `day_key` IS ABSENT ON PURPOSE — it is on the deliveries table, and stale
 * there. See the note on SUBSCRIPTION_DELIVERY_RECEIPT_COLUMNS.
 */
export const SUBSCRIPTION_RECEIPT_COLUMNS = [
  "id",
  "subscription_number",
  "customer_id",
  "created_at",
  "start_date",
  "weeks",
  "total_weeks",
  "days",
  "payment_status",
  "payment_method",
  "total_amount",
  "delivery_fee_inr",
  "product_slug",
  "product_name",
  "quantity_per_delivery",
  "bread_price",
] as const;

export const SUBSCRIPTION_RECEIPT_SELECT =
  SUBSCRIPTION_RECEIPT_COLUMNS.join(", ");

/**
 * Every `subscription_deliveries` column either receipt reads.
 *
 * BOTH HALVES OF BOTH PAIRS ARE PROJECTED, because the reader needs to see
 * the newer column to prefer it and the older one to fall back to:
 * `scheduled_date` / `delivery_date` and `scheduled_time_slot` / `slot`.
 *
 * `day_key` IS DELIBERATELY NOT HERE, and the tripwire test asserts its
 * ABSENCE. It is a weekday denormalised at creation and never rewritten on
 * a move, so it is stale on 11 of 451 prod rows — a Friday stop moved to
 * Monday still says "fri". The weekday is derived from the effective date
 * with dayKeyForIsoDate instead. Adding the column back would hand the next
 * reader a plausible wrong answer.
 */
export const SUBSCRIPTION_DELIVERY_RECEIPT_COLUMNS = [
  "id",
  "subscription_id",
  "sequence",
  "week_number",
  "delivery_date",
  "scheduled_date",
  "slot",
  "scheduled_time_slot",
  "status",
  "items_override",
] as const;

export const SUBSCRIPTION_DELIVERY_RECEIPT_SELECT =
  SUBSCRIPTION_DELIVERY_RECEIPT_COLUMNS.join(", ");

/**
 * Every `subscription_items` column either receipt reads.
 *
 * `price_snapshot_inr` IS IN THIS LIST AND MUST STAY — it is the per-loaf
 * price captured at signup, and the only honest source for a line total. A
 * receipt re-priced from today's catalogue would print a figure the customer
 * never agreed to; a receipt with the column missing would print "—" against
 * every line while still showing a grand total.
 */
export const SUBSCRIPTION_ITEM_RECEIPT_COLUMNS = [
  "product_slug",
  "product_name",
  "quantity_per_delivery",
  "price_snapshot_inr",
] as const;

export const SUBSCRIPTION_ITEM_RECEIPT_SELECT =
  SUBSCRIPTION_ITEM_RECEIPT_COLUMNS.join(", ");

// ── Row shapes ──────────────────────────────────────────────────────

export type SubscriptionReceiptRow = {
  id?: string | null;
  /** Already carries the prefix ("OLS94") — the column is text. */
  subscription_number?: string | null;
  customer_id?: string | null;
  created_at?: string | null;
  /** NULL on 3 of 118 prod rows — the first delivery stands in. */
  start_date?: string | null;
  /** 0 is a MODE MARKER for a calendar-mode plan, not a zero-week plan. */
  weeks?: number | null;
  total_weeks?: number | null;
  days?: string[] | null;
  payment_status?: string | null;
  payment_method?: string | null;
  total_amount?: number | string | null;
  /** Absent when the projection dropped it — NOT the same as 0. */
  delivery_fee_inr?: number | string | null;
  product_slug?: string | null;
  product_name?: string | null;
  quantity_per_delivery?: number | null;
  bread_price?: number | string | null;
};

export type SubscriptionDeliveryReceiptRow = {
  id?: string | null;
  subscription_id?: string | null;
  sequence?: number | null;
  week_number?: number | null;
  delivery_date?: string | null;
  scheduled_date?: string | null;
  slot?: string | null;
  scheduled_time_slot?: string | null;
  status?: string | null;
  items_override?: unknown;
};

export type SubscriptionItemReceiptRow = {
  product_slug?: string | null;
  product_name?: string | null;
  quantity_per_delivery?: number | null;
  price_snapshot_inr?: number | string | null;
};

// ── Column readers ──────────────────────────────────────────────────

/**
 * The slot a stop ACTUALLY runs in.
 *
 * `scheduled_time_slot` is the admin-editable copy and it wins — the same
 * precedence admin-subscription-derive.ts and the admin detail page already
 * use. Reading the raw `slot` instead prints a rescheduled stop's ORIGINAL
 * time: measured on prod 2026-11-02, the two columns disagree on 9 of 451
 * rows and `slot` is NULL on 8 while `scheduled_time_slot` is populated on
 * all 451. Returns the RAW stored value; formatting is the page's job.
 *
 * (`/api/checkout` writes the pair in the opposite order, which is safe only
 * because it mints both at once. Do not copy that precedence to a reader.)
 */
export function effectiveDeliverySlot(
  row: Pick<SubscriptionDeliveryReceiptRow, "slot" | "scheduled_time_slot">,
): string | null {
  const scheduled = (row.scheduled_time_slot ?? "").trim();
  if (scheduled) return scheduled;
  const stored = (row.slot ?? "").trim();
  return stored || null;
}

/** "Monday" for a stop, DERIVED from its effective date.
 *
 *  Never from the stored `day_key` — see the note on the delivery
 *  projection. Null when the date is missing or malformed; this never
 *  guesses a weekday. */
export function deliveryDayLabel(
  row: Pick<SubscriptionDeliveryReceiptRow, "delivery_date" | "scheduled_date">,
): string | null {
  const key = dayKeyForIsoDate(effectiveDeliveryDate(row));
  return key ? DAY_LABEL[key] ?? null : null;
}

// ── View models ─────────────────────────────────────────────────────

export type SubscriptionReceiptLine = {
  /** Identity, for a stable key. Null on the legacy fallback, which has none. */
  slug: string | null;
  name: string;
  qtyPerDelivery: number;
  unitPrice: number | null;
  /** unitPrice × qty for ONE delivery. */
  perDelivery: number | null;
};

export type SubscriptionReceiptStop = {
  id: string | null;
  sequence: number | null;
  /** The effective date, raw ISO. Formatting is the page's job. */
  date: string | null;
  dayLabel: string | null;
  /** Raw stored slot value, newer column preferred. */
  slot: string | null;
  statusLabel: string;
  cancelled: boolean;
};

export type SubscriptionReceipt = {
  title: string;
  businessName: string;
  fssai: string;
  /** "OLS94" — the existing series, reused. */
  subscriptionNumber: string | null;
  placedAt: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /** Raw ISO. Falls back to the first stop when the column is null. */
  startDate: string | null;
  /** True when startDate came from the first stop, not the column. */
  startDateFromFirstStop: boolean;
  /** Day names the plan runs on, in week order. */
  days: string[];
  /** Null for a calendar-mode plan (`weeks` 0) — NOT "0 weeks". */
  weeks: number | null;
  /** Stops as purchased, cancellations INCLUDED — see the money module. */
  deliveryCount: number;
  cancelledCount: number;
  lines: SubscriptionReceiptLine[];
  /** True when the lines came from the legacy columns. Unreachable on prod. */
  usedLegacyFallback: boolean;
  breadPerDelivery: number | null;
  breadTotal: number | null;
  feePerDelivery: number | null;
  feeTotal: number | null;
  feeStatus: SubscriptionFeeStatus;
  /** `subscriptions.total_amount`, verbatim — what was actually charged. */
  grandTotal: number | null;
  paymentLabel: string;
  stops: SubscriptionReceiptStop[];
};

function stopOf(d: SubscriptionDeliveryReceiptRow): SubscriptionReceiptStop {
  const status = (d.status ?? "").trim();
  return {
    id: d.id ?? null,
    sequence: typeof d.sequence === "number" ? d.sequence : null,
    date: effectiveDeliveryDate(d),
    dayLabel: deliveryDayLabel(d),
    slot: effectiveDeliverySlot(d),
    statusLabel: DELIVERY_STATUS_LABEL[status] ?? (status || "—"),
    cancelled: isCancelledDelivery(d),
  };
}

/** Stops in date order, so the printed list reads as a calendar.
 *
 *  Sorted on the EFFECTIVE date, not `sequence`: a rescheduled stop keeps
 *  its original sequence number, so sequence order can print a moved
 *  delivery out of chronological place. Ties and missing dates fall back to
 *  sequence, which keeps the order stable rather than arbitrary. */
function sortStops(stops: SubscriptionReceiptStop[]): SubscriptionReceiptStop[] {
  return [...stops].sort((a, b) => {
    const da = a.date ?? "";
    const db = b.date ?? "";
    if (da !== db) {
      if (!da) return 1;
      if (!db) return -1;
      return da < db ? -1 : 1;
    }
    return (a.sequence ?? 0) - (b.sequence ?? 0);
  });
}

/**
 * The subscription summary.
 *
 * GRAND TOTAL IS THE STORED `total_amount`, never a re-addition of the
 * lines — same rule and same reason as the order receipt. The bread and fee
 * breakdown is offered alongside it precisely so the two can be read against
 * each other, and `feeStatus` says out loud when they do not reconcile
 * rather than picking whichever story looks tidier.
 */
export function buildSubscriptionReceipt(input: {
  subscription: SubscriptionReceiptRow;
  items: SubscriptionItemReceiptRow[] | null | undefined;
  deliveries: SubscriptionDeliveryReceiptRow[] | null | undefined;
  customer?: ReceiptCustomer | null;
}): SubscriptionReceipt {
  const { subscription: sub, items, deliveries, customer } = input;
  const rows = deliveries ?? [];
  const stops = sortStops(rows.map(stopOf));

  const money = buildSubscriptionMoney({
    items,
    // Cancellations are INCLUDED on purpose: the customer paid for the
    // schedule they bought, and excluding them would stop the breakdown
    // reconciling against total_amount.
    deliveryCount: rows.length,
    storedTotal: sub.total_amount,
    feePerDelivery: sub.delivery_fee_inr,
    legacy: {
      product_slug: sub.product_slug,
      product_name: sub.product_name,
      quantity_per_delivery: sub.quantity_per_delivery,
      bread_price: sub.bread_price,
    },
  });

  // buildSubscriptionMoney maps `items` in order, index for index, whenever
  // `items` is non-empty — which `usedLegacyFallback` reports. So the slug
  // for a line is items[i]'s, and the label resolves from the SLUG via the
  // catalogue rather than from the stored snapshot name. On the legacy
  // branch there is no slug to resolve and the stored name is the only
  // description that exists.
  const lines: SubscriptionReceiptLine[] = money.lines.map((l, i) => {
    const source = money.usedLegacyFallback ? null : items?.[i] ?? null;
    const slug = (source?.product_slug ?? "").trim() || null;
    return {
      slug,
      name: productDisplayName(slug, null, source?.product_name ?? l.name),
      qtyPerDelivery: l.qtyPerDelivery,
      unitPrice: l.unitPrice,
      perDelivery: l.lineTotalPerDelivery,
    };
  });

  const storedStart = (sub.start_date ?? "").trim() || null;
  const firstStop = stops.find((s) => s.date)?.date ?? null;

  return {
    title: SUBSCRIPTION_RECEIPT_TITLE,
    businessName: RECEIPT_BUSINESS_NAME,
    fssai: RECEIPT_FSSAI,
    subscriptionNumber: sub.id
      ? formatSubscriptionNumber({
          id: sub.id,
          subscription_number: sub.subscription_number,
        })
      : sub.subscription_number?.trim() || null,
    placedAt: sub.created_at ?? null,
    customerName: customer?.full_name?.trim() || null,
    customerPhone: customer?.phone?.trim() || null,
    // `start_date` is NULL on 3 of 118 prod rows. The first stop IS the day
    // the plan starts, so it stands in rather than printing "—" — and the
    // flag lets the page say which it is instead of inventing certainty.
    startDate: storedStart ?? firstStop,
    startDateFromFirstStop: !storedStart && !!firstStop,
    days: subscriptionDays(sub).map((d) => DAY_LABEL[d] ?? d),
    // planWeeks returns null for 0 and for negatives. `weeks = 0` marks a
    // calendar-mode plan whose dates were picked individually (4 prod rows);
    // printing "0 weeks" would describe a plan that ended before it began.
    weeks: planWeeks(sub),
    deliveryCount: rows.length,
    cancelledCount: stops.filter((s) => s.cancelled).length,
    lines,
    usedLegacyFallback: money.usedLegacyFallback,
    breadPerDelivery: money.breadPerDelivery,
    breadTotal: money.breadTotal,
    feePerDelivery: money.feePerDelivery,
    feeTotal: money.feeTotal,
    feeStatus: money.feeStatus,
    grandTotal: money.storedTotal,
    // The customer-facing wording, owned by lib/customer-payment-wording.ts.
    // `fulfillmentType` is null because a subscription has no such column —
    // every stop is a delivery, never a counter pickup — and null is the
    // delivery branch, which is what "Cash on Delivery" should say here.
    paymentLabel: customerPaymentLabel({
      payment_status: sub.payment_status,
      payment_method: sub.payment_method,
      fulfillmentType: null,
    }),
    stops,
  };
}

export type DeliveryReceiptLine = {
  slug: string | null;
  name: string;
  qty: number;
};

export type DeliveryReceipt = {
  title: string;
  businessName: string;
  fssai: string;
  /** The parent's OLS number. No series of its own — see the header. */
  subscriptionNumber: string | null;
  customerName: string | null;
  customerPhone: string | null;
  /** Raw ISO, newer column preferred. */
  date: string | null;
  dayLabel: string | null;
  /** Raw stored slot value, newer column preferred. */
  slot: string | null;
  sequence: number | null;
  weekNumber: number | null;
  statusLabel: string;
  cancelled: boolean;
  lines: DeliveryReceiptLine[];
};

/**
 * The per-delivery note.
 *
 * WHAT IS IN THE BAG comes from `deliveryItems`, which is the same
 * precedence the bake plan uses — the stop's `items_override` when it has
 * content, otherwise the plan's lines. The two must never disagree about
 * what a stop contains, which is why this reads that function instead of
 * the plan directly. (`items_override` is NULL on all 451 prod rows, so the
 * override branch is unexercised by real data.)
 *
 * A CANCELLED STOP STILL LISTS ITS ITEMS, and says it is cancelled. The
 * counting helpers zero a cancellation because they are totalling loaves to
 * bake; this document is a record of one stop, and blanking the items would
 * leave a note that says nothing about what was cancelled.
 */
export function buildDeliveryReceipt(input: {
  subscription: SubscriptionReceiptRow;
  items: SubscriptionItemReceiptRow[] | null | undefined;
  delivery: SubscriptionDeliveryReceiptRow;
  customer?: ReceiptCustomer | null;
}): DeliveryReceipt {
  const { subscription: sub, items, delivery, customer } = input;

  const planItems = planItemsOf({
    product_name: sub.product_name,
    quantity_per_delivery: sub.quantity_per_delivery,
    items: itemsForPlan(items),
  });
  const stop = stopOf(delivery);

  return {
    title: DELIVERY_RECEIPT_TITLE,
    businessName: RECEIPT_BUSINESS_NAME,
    fssai: RECEIPT_FSSAI,
    subscriptionNumber: sub.id
      ? formatSubscriptionNumber({
          id: sub.id,
          subscription_number: sub.subscription_number,
        })
      : sub.subscription_number?.trim() || null,
    customerName: customer?.full_name?.trim() || null,
    customerPhone: customer?.phone?.trim() || null,
    date: stop.date,
    dayLabel: stop.dayLabel,
    slot: stop.slot,
    sequence: stop.sequence,
    weekNumber:
      typeof delivery.week_number === "number" ? delivery.week_number : null,
    statusLabel: stop.statusLabel,
    cancelled: stop.cancelled,
    lines: deliveryItems(delivery, planItems).map((it) => {
      const slug = (it.product_slug ?? "").trim() || null;
      return {
        slug,
        name: productDisplayName(slug, null, it.product_name),
        qty: it.quantity_per_delivery,
      };
    }),
  };
}

/** subscription_items rows as the counting helpers want them.
 *
 *  Those helpers take the admin row shape, whose slug/name/qty are
 *  non-null; a projected row is typed nullable because PostgREST can omit a
 *  key entirely. Lines with no quantity are dropped here rather than
 *  coerced to 0, which `subscriptionItems` would then filter anyway. */
function itemsForPlan(
  items: SubscriptionItemReceiptRow[] | null | undefined,
): AdminSubscriptionItem[] {
  return (items ?? [])
    .map((it) => ({
      product_slug: (it.product_slug ?? "").trim(),
      product_name: (it.product_name ?? "").trim(),
      quantity_per_delivery: Number(it.quantity_per_delivery ?? 0),
    }))
    .filter(
      (it) =>
        Number.isFinite(it.quantity_per_delivery) &&
        it.quantity_per_delivery > 0 &&
        (it.product_slug !== "" || it.product_name !== ""),
    );
}
