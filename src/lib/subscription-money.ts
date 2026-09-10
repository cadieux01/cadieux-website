// Reconstructing what a subscription actually cost, from stored rows only.
//
// Pure. No I/O. Every number here is either read from the database or
// derived from numbers read from the database — nothing is recomputed from
// today's prices or today's delivery fee. A subscription signed in July at
// ₹139 a loaf with a ₹42 fee must keep reporting ₹139 and ₹42 forever, so
// re-pricing from the live products table would print a total the customer
// never saw.
//
// THE AWKWARD BIT — `subscriptions.delivery_fee_inr` means two different
// things depending on when the row was written:
//
//   • Rows created once subscriptions started charging for delivery: the
//     fee is real, was charged, and is inside `total_amount`.
//     total_amount === bread + fee × deliveries
//
//   • Rows that predate it: the column was backfilled afterwards for
//     reporting. The customer was quoted and billed bread only.
//     total_amount === bread
//
// We decide which by ARITHMETIC, never by `payment_status`. Payment status
// happens to separate the two today only because every pre-fee row is also
// unpaid; the writer now stores the fee in `total_amount` for COD as well,
// so the very next unpaid COD subscription would be misread by a
// status-based rule. The arithmetic keeps holding after that.
//
// `total_amount` is never adjusted here. It is what the customer was
// quoted, and `subscription-payment.ts` verifies the Razorpay capture
// against it — a "tidier" total would fail live payment verification.

/** Money columns arrive from PostgREST as either number or numeric-string. */
function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Tolerance for comparing two rupee amounts. Prices carry 2 decimals. */
const EPSILON = 0.01;

export type SubscriptionMoneyItem = {
  product_slug?: string | null;
  product_name?: string | null;
  quantity_per_delivery?: number | null;
  price_snapshot_inr?: number | string | null;
};

export type SubscriptionMoneyLine = {
  key: string;
  name: string | null;
  qtyPerDelivery: number;
  unitPrice: number | null;
  /** unitPrice × qty for ONE delivery. */
  lineTotalPerDelivery: number | null;
};

/**
 * • `charged`      — the fee is inside total_amount. Show it and sum it.
 * • `not_charged`  — recorded only. Show it as excluded (admin) or hide it
 *                    entirely (customer); never add it to the total.
 * • `none`         — no fee on the row at all.
 * • `unreconciled` — the parts don't add up either way. Say so rather than
 *                    picking whichever story looks tidier.
 * • `unknown`      — not enough stored data to judge (no prices at all).
 */
export type SubscriptionFeeStatus =
  | "charged"
  | "not_charged"
  | "none"
  | "unreconciled"
  | "unknown";

export type SubscriptionMoney = {
  lines: SubscriptionMoneyLine[];
  /** True when `lines` came from the legacy single-product columns rather
   *  than subscription_items. See buildSubscriptionMoney. */
  usedLegacyFallback: boolean;
  /** Bread value of ONE delivery. null when no line carries a price. */
  breadPerDelivery: number | null;
  /** Delivery rows as purchased, INCLUDING cancelled ones — the customer
   *  paid for the schedule they bought, and excluding cancellations would
   *  stop the breakdown reconciling against total_amount. */
  deliveryCount: number;
  breadTotal: number | null;
  feePerDelivery: number | null;
  /** feePerDelivery × deliveryCount. Present even when not charged, since
   *  the admin view reports it. */
  feeTotal: number | null;
  /** subscriptions.total_amount, verbatim. */
  storedTotal: number | null;
  feeStatus: SubscriptionFeeStatus;
};

/**
 * @param items         rows from subscription_items (preferred)
 * @param deliveryCount COUNT of subscription_deliveries rows, all statuses
 * @param legacy        single-product columns off the subscriptions row,
 *                      used only when `items` is empty
 */
export function buildSubscriptionMoney({
  items,
  deliveryCount,
  storedTotal,
  feePerDelivery,
  legacy,
}: {
  items: SubscriptionMoneyItem[] | null | undefined;
  deliveryCount: number;
  storedTotal: number | string | null | undefined;
  feePerDelivery: number | string | null | undefined;
  legacy: {
    product_name?: string | null;
    product_slug?: string | null;
    quantity_per_delivery?: number | null;
    bread_price?: number | string | null;
  };
}): SubscriptionMoney {
  const source: SubscriptionMoneyItem[] =
    items && items.length > 0
      ? items
      : // UNTESTED IN PRODUCTION. Every subscription that exists today has
        // subscription_items rows, so this branch has never run against real
        // data. It mirrors what the rest of the page already does for legacy
        // rows (product_name × quantity_per_delivery @ bread_price) and is
        // here so a pre-items row renders something truthful rather than an
        // empty table — but treat any bug report touching it as unexplored
        // ground, not as a regression in this code.
        [
          {
            product_slug: legacy.product_slug,
            product_name: legacy.product_name,
            quantity_per_delivery: legacy.quantity_per_delivery,
            price_snapshot_inr: legacy.bread_price,
          },
        ];

  const usedLegacyFallback = !(items && items.length > 0);

  const lines: SubscriptionMoneyLine[] = source.map((it, i) => {
    const qty = toNum(it.quantity_per_delivery) ?? 0;
    const unit = toNum(it.price_snapshot_inr);
    return {
      key: `${it.product_slug ?? "item"}-${i}`,
      name: it.product_name ?? null,
      qtyPerDelivery: qty,
      unitPrice: unit,
      lineTotalPerDelivery: unit === null ? null : round2(unit * qty),
    };
  });

  const priced = lines.filter((l) => l.lineTotalPerDelivery !== null);
  const breadPerDelivery =
    priced.length === 0
      ? null
      : round2(
          priced.reduce((sum, l) => sum + (l.lineTotalPerDelivery ?? 0), 0),
        );

  const breadTotal =
    breadPerDelivery === null ? null : round2(breadPerDelivery * deliveryCount);

  const fee = toNum(feePerDelivery);
  const feeTotal = fee === null ? null : round2(fee * deliveryCount);
  const total = toNum(storedTotal);

  return {
    lines,
    usedLegacyFallback,
    breadPerDelivery,
    deliveryCount,
    breadTotal,
    feeTotal,
    feePerDelivery: fee,
    storedTotal: total,
    feeStatus: classifyFee({ breadTotal, feeTotal, total, fee }),
  };
}

function classifyFee({
  breadTotal,
  feeTotal,
  total,
  fee,
}: {
  breadTotal: number | null;
  feeTotal: number | null;
  total: number | null;
  fee: number | null;
}): SubscriptionFeeStatus {
  if (fee === null || fee === 0) return "none";
  if (breadTotal === null || total === null || feeTotal === null) {
    return "unknown";
  }
  // Checked first: when a fee was genuinely charged this is the only
  // branch that can match, because bread alone would be short by feeTotal.
  if (Math.abs(total - (breadTotal + feeTotal)) < EPSILON) return "charged";
  if (Math.abs(total - breadTotal) < EPSILON) return "not_charged";
  return "unreconciled";
}
