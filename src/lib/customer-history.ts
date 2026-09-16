// Repeat-customer history + retention, derived from the orders list.
//
// KEYED ON PHONE, NOT customer_id. The same human can hold more than one
// `customers` row — a second checkout typed with a different name or
// email mints a fresh row — so counting by customer_id silently reports
// a returning customer as brand new. The last 10 digits of the phone are
// the stable identity (rows carry both "+919…" and bare "9…" forms).
//
// CANCELLED ORDERS ARE EXCLUDED EVERYWHERE. A cancelled order is not a
// purchase; counting it would put a star on a customer who never
// actually bought twice.
//
// Everything here is pure and computed in ONE pass over the rows the
// list endpoint already fetched — there is no per-row query.

export type HistoryOrder = {
  id?: string | null;
  status?: string | null;
  created_at?: string | null;
  total_amount?: number | string | null;
  customers?: { phone?: string | null } | null;
};

/** Last 10 digits of a phone, or null when there aren't 10. */
export function phoneKey(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const digits = raw.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : null;
}

function isCancelled(status: unknown): boolean {
  return typeof status === "string" && status.toLowerCase() === "cancelled";
}

function amountOf(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : typeof raw === "number" ? raw : 0;
  return Number.isFinite(n) ? n : 0;
}

/** Per-order repeat facts, attached by the list endpoint. */
export type RepeatInfo = {
  /** 1-based position of THIS order among that phone's non-cancelled
   *  orders, oldest first. 2+ means the customer had ordered before. */
  repeat_seq: number;
  /** Total non-cancelled orders that phone has placed, all time. */
  customer_order_count: number;
  /** created_at of that phone's FIRST non-cancelled order. */
  customer_first_order_at: string;
};

type PhoneBucket = {
  orders: { id: string; created_at: string; amount: number }[];
};

/** Group the passed rows by phone, oldest-first, skipping cancelled rows
 *  and rows with no usable phone or timestamp. */
function bucketByPhone(rows: readonly HistoryOrder[]): Map<string, PhoneBucket> {
  const byPhone = new Map<string, PhoneBucket>();
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    const key = phoneKey(r.customers?.phone);
    if (!key) continue;
    const id = typeof r.id === "string" ? r.id : null;
    const created = typeof r.created_at === "string" ? r.created_at : null;
    if (!id || !created) continue;
    const bucket = byPhone.get(key) ?? { orders: [] };
    bucket.orders.push({ id, created_at: created, amount: amountOf(r.total_amount) });
    byPhone.set(key, bucket);
  }
  byPhone.forEach((bucket) => {
    // created_at is an ISO timestamp, so lexical compare IS chronological.
    // Tie-break on id so the ordinals are stable across reloads.
    bucket.orders.sort(
      (a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id),
    );
  });
  return byPhone;
}

/**
 * order id → RepeatInfo, for every non-cancelled order with a phone.
 * Cancelled rows are absent from the map and therefore never starred.
 */
export function buildRepeatIndex(
  rows: readonly HistoryOrder[],
): Map<string, RepeatInfo> {
  const out = new Map<string, RepeatInfo>();
  bucketByPhone(rows).forEach((bucket) => {
    const first = bucket.orders[0];
    bucket.orders.forEach((o, i) => {
      out.set(o.id, {
        repeat_seq: i + 1,
        customer_order_count: bucket.orders.length,
        customer_first_order_at: first.created_at,
      });
    });
  });
  return out;
}

export type RetentionCohort = {
  key: "14_plus" | "7_14" | "under_7";
  label: string;
  customers: number;
  returned: number;
  /** null when the cohort is empty. */
  pct: number | null;
};

export type RetentionSummary = {
  /** Distinct phones with at least one non-cancelled order. */
  customers: number;
  /** …of which have 2+ orders. */
  ordered_again: number;
  ordered_again_pct: number | null;
  three_plus: number;
  /** Revenue from customers with 2+ orders, as a share of all
   *  non-cancelled revenue. null when there is no revenue. */
  repeat_revenue_pct: number | null;
  /** Bucketed by days since the customer's FIRST order, so customers who
   *  have not yet had time to come back don't drag the headline down. */
  cohorts: RetentionCohort[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function pct(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 100);
}

export function computeRetention(
  rows: readonly HistoryOrder[],
  nowMs: number = Date.now(),
): RetentionSummary {
  const byPhone = bucketByPhone(rows);

  let orderedAgain = 0;
  let threePlus = 0;
  let revenueTotal = 0;
  let revenueRepeat = 0;

  const cohorts: Record<RetentionCohort["key"], { customers: number; returned: number }> = {
    "14_plus": { customers: 0, returned: 0 },
    "7_14": { customers: 0, returned: 0 },
    under_7: { customers: 0, returned: 0 },
  };

  byPhone.forEach((bucket) => {
    const count = bucket.orders.length;
    const repeat = count >= 2;
    if (repeat) orderedAgain += 1;
    if (count >= 3) threePlus += 1;

    for (const o of bucket.orders) {
      revenueTotal += o.amount;
      if (repeat) revenueRepeat += o.amount;
    }

    const firstMs = new Date(bucket.orders[0].created_at).getTime();
    if (!Number.isFinite(firstMs)) return;
    const days = (nowMs - firstMs) / DAY_MS;
    const key: RetentionCohort["key"] =
      days >= 14 ? "14_plus" : days >= 7 ? "7_14" : "under_7";
    cohorts[key].customers += 1;
    if (repeat) cohorts[key].returned += 1;
  });

  const customers = byPhone.size;

  return {
    customers,
    ordered_again: orderedAgain,
    ordered_again_pct: pct(orderedAgain, customers),
    three_plus: threePlus,
    repeat_revenue_pct: pct(revenueRepeat, revenueTotal),
    cohorts: [
      {
        key: "14_plus",
        label: "First order 14+ days ago",
        ...cohorts["14_plus"],
        pct: pct(cohorts["14_plus"].returned, cohorts["14_plus"].customers),
      },
      {
        key: "7_14",
        label: "First order 7–14 days ago",
        ...cohorts["7_14"],
        pct: pct(cohorts["7_14"].returned, cohorts["7_14"].customers),
      },
      {
        key: "under_7",
        label: "First order under 7 days ago",
        ...cohorts.under_7,
        pct: pct(cohorts.under_7.returned, cohorts.under_7.customers),
      },
    ],
  };
}

// --- display helpers (used by the star tooltip) ----------------------------

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

/** "5 Sep", in IST. Deliberately NOT Intl month:"short" — current ICU
 *  renders September as "Sept" for en-IN, which reads as a typo. */
export function formatShortISTDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "numeric",
  }).formatToParts(d);
  // day:"numeric" + month:"numeric" makes en-GB pick its 2-digit dd/mm
  // pattern, so the day arrives as "05". Strip the pad — "5 Sep", not
  // "05 Sep".
  const day = String(Number(parts.find((p) => p.type === "day")?.value ?? "0"));
  const monthNum = Number(parts.find((p) => p.type === "month")?.value ?? "0");
  const month = MONTHS_SHORT[monthNum - 1] ?? "";
  return month ? `${day} ${month}` : day;
}

/** 1 → "1st", 2 → "2nd", 3 → "3rd", 11 → "11th". */
export function ordinal(n: number): string {
  const rem100 = n % 100;
  if (rem100 >= 11 && rem100 <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

/** "3rd order · first on 5 Sep" — the star's tooltip. */
export function repeatTooltip(info: RepeatInfo): string {
  return `${ordinal(info.repeat_seq)} order · first on ${formatShortISTDate(
    info.customer_first_order_at,
  )}`;
}
