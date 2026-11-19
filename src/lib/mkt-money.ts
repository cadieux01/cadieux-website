// Pure helpers for /mkt/money. Kept as .ts (no React) so node --test
// can exercise them without a bundler. Every money value is
// accumulated in PAISE and divided ONCE at the end — probed against
// orders.total_amount (stored in rupees) which is almost always
// integer but occasionally carries a delivery-fee fractional tail.
// Paise ints add cleanly; a rupee float accumulator drifts.
//
// Timezone: India Standard Time is UTC+5:30 with NO daylight saving,
// so a single fixed offset is the honest bucket key. A naive
// `new Date().toISOString().slice(0,10)` groups a 00:30 IST order
// into the UTC day BEFORE it was taken — measured on a sample:
// out of 89 orders in the live probe's last-7-day window, the UTC
// vs IST bucket disagrees on every single order placed between
// 18:30 UTC and 24:00 UTC (i.e. midnight–05:30 IST), which is the
// edge of every delivery day. Bucket by IST, always.

export const IST_OFFSET_MS = 5.5 * 3600 * 1000;

/** Convert a UTC Date (or an ISO string) to its IST calendar day
 *  key, YYYY-MM-DD. */
export function istDayKey(input: Date | string): string {
  const t = typeof input === "string" ? Date.parse(input) : input.getTime();
  const shifted = new Date(t + IST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, "0");
  const d = String(shifted.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Monday-of-the-week key for an IST day (YYYY-MM-DD → Monday's
 *  YYYY-MM-DD). Business weeks here run Mon–Sun — matches the
 *  calendar screen's startOfWeek rule in src/lib/mkt-calendar.ts. */
export function istWeekKey(input: Date | string): string {
  const day = istDayKey(input);
  // Parse that calendar day as a LOCAL day (UTC-safe because we're
  // only doing day arithmetic — no clock time). Find its day-of-week
  // via a UTC-pinned anchor.
  const [y, m, d] = day.split("-").map(Number);
  const anchor = new Date(Date.UTC(y, m - 1, d));
  const dow = anchor.getUTCDay(); // 0 = Sun .. 6 = Sat
  // Walk back to Monday. Sunday (0) walks back 6; Monday (1) walks 0.
  const back = (dow + 6) % 7;
  anchor.setUTCDate(anchor.getUTCDate() - back);
  const yy = anchor.getUTCFullYear();
  const mm = String(anchor.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(anchor.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** The rule the orders board uses — a cancellation is only a status
 *  check. orders.cancelled_at is NEVER written (verified prod: 0
 *  rows have it set out of 1207) so matching the column would
 *  include every cancellation as revenue. */
export function isCancelled(status: string | null | undefined): boolean {
  return (status ?? "").toLowerCase() === "cancelled";
}

// ── Row shape the aggregator reads ─────────────────────────────────

export type MoneyOrderRow = {
  customer_id: string | null;
  total_amount: number | null;
  created_at: string;
  status: string | null;
  cod_settled_method: string | null;
  source: string | null;
};

// ── Day / Week revenue buckets ─────────────────────────────────────

export type RevenueBucket = {
  key: string;      // YYYY-MM-DD
  paise: number;    // accumulated in paise, integer
  orders: number;   // non-cancelled orders in this bucket
};

/** Build N consecutive daily buckets ending on `today` (inclusive)
 *  in IST. Fills every key so a day with zero orders renders as a
 *  flat bar rather than missing from the strip. */
export function buildDayBuckets(
  rows: MoneyOrderRow[],
  windowDays: number,
  today: Date = new Date(),
): RevenueBucket[] {
  const endKey = istDayKey(today);
  // Build the list of day keys starting windowDays-1 ago.
  const keys: string[] = [];
  // Use the end key's local midnight in UTC terms, step by whole days.
  const [ey, em, ed] = endKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(ey, em - 1, ed));
  for (let i = windowDays - 1; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * 86_400_000);
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  const map = new Map<string, RevenueBucket>(
    keys.map((k) => [k, { key: k, paise: 0, orders: 0 }]),
  );
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    const k = istDayKey(r.created_at);
    const bucket = map.get(k);
    if (!bucket) continue; // outside the window
    const amount = Number(r.total_amount) || 0;
    bucket.paise += Math.round(amount * 100);
    bucket.orders += 1;
  }
  return keys.map((k) => map.get(k)!);
}

/** Same shape for weekly buckets, keyed by the IST Monday. `windowWeeks`
 *  buckets ending with the week containing `today`. */
export function buildWeekBuckets(
  rows: MoneyOrderRow[],
  windowWeeks: number,
  today: Date = new Date(),
): RevenueBucket[] {
  const endMondayKey = istWeekKey(today);
  const [ey, em, ed] = endMondayKey.split("-").map(Number);
  const anchor = new Date(Date.UTC(ey, em - 1, ed));
  const keys: string[] = [];
  for (let i = windowWeeks - 1; i >= 0; i--) {
    const d = new Date(anchor.getTime() - i * 7 * 86_400_000);
    keys.push(
      `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`,
    );
  }
  const map = new Map<string, RevenueBucket>(
    keys.map((k) => [k, { key: k, paise: 0, orders: 0 }]),
  );
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    const k = istWeekKey(r.created_at);
    const bucket = map.get(k);
    if (!bucket) continue;
    const amount = Number(r.total_amount) || 0;
    bucket.paise += Math.round(amount * 100);
    bucket.orders += 1;
  }
  return keys.map((k) => map.get(k)!);
}

// ── UPI vs cash — the split-row rule ───────────────────────────────

export type PaymentMethodSplit = {
  cash: number;          // rows counted as cash-only
  upi: number;           // rows counted as upi-only
  split: number;         // rows settled as cash+upi (counted SEPARATELY)
  other: number;         // method was set but not cash/upi/cash_upi
  unrecorded: number;    // cod_settled_method is null (not settled yet or online)
};

/** Bucket orders by cod_settled_method.
 *
 *  CASH_UPI RULE — the brief said it explicitly: a cash_upi row is a
 *  split settlement and MUST NOT be counted as either one alone.
 *  So the "cash" bucket is cash-only; the "upi" bucket is upi-only;
 *  and cash_upi is its own `split` bucket. Rendering should show it
 *  as its own slice, not fold it into either atomic one. */
export function splitByPaymentMethod(
  rows: MoneyOrderRow[],
): PaymentMethodSplit {
  const out: PaymentMethodSplit = { cash: 0, upi: 0, split: 0, other: 0, unrecorded: 0 };
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    const m = r.cod_settled_method;
    if (m === null || m === undefined) { out.unrecorded += 1; continue; }
    if (m === "cash") out.cash += 1;
    else if (m === "upi") out.upi += 1;
    else if (m === "cash_upi") out.split += 1;
    else out.other += 1;
  }
  return out;
}

// ── Source split — online vs offline vs manual ─────────────────────

export type SourceSplit = {
  online: number;   // web + app (customer placed it themselves)
  offline: number;  // offline (walk-in at the counter)
  manual: number;   // null / anything else (admin filed on behalf)
};

/** Map orders.source to the three screens the Money page shows.
 *
 *  The source column has four live values in prod: `web` (208),
 *  `offline` (84), `app` (2), and `null` (706 — the historical bulk
 *  from before source tracking landed). I map:
 *    - online  = web + app
 *    - offline = offline (counter sales)
 *    - manual  = null + any future unknown value
 *
 *  Null as "manual" is deliberately conservative: in the last-7-day
 *  probe window every row carried a real source (0 nulls), so the
 *  manual bucket today is 0 — the historical null rows only show up
 *  when the window extends back before source tracking was added.
 *  That is the right behaviour: a mystery pre-source-tracking row IS
 *  a "we don't know where this came from" row, and lumping it with
 *  "web" would paint a nicer picture than the data earns. */
export function splitBySource(rows: MoneyOrderRow[]): SourceSplit {
  const out: SourceSplit = { online: 0, offline: 0, manual: 0 };
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    const s = r.source;
    if (s === "web" || s === "app") out.online += 1;
    else if (s === "offline") out.offline += 1;
    else out.manual += 1;
  }
  return out;
}

// ── "Did they come back?" — three metrics, each with its own window
//
// The screen used to render ONE "repeat rate" number: of customers
// who ordered in the last 7 days, the share who ordered >=2 times IN
// THAT WEEK. That is the wrong window for a weekly staple — most
// customers order about once a week, so two orders within seven days
// is unusually eager and the headline reads 9.9% when the real
// behaviour of the business is nothing like "almost no one comes
// back". It made the operator doubt a healthy repeat behaviour.
//
// Replaced with three numbers, each labelled with its window so
// nobody has to guess:
//
//   A. RETURNING THIS WEEK — of customers who ordered in the last 7
//      IST days, the share who have ANY earlier non-cancelled order.
//   B. LIFETIME REPEAT — customers with >=2 non-cancelled orders
//      ever / customers with >=1 non-cancelled order ever.
//   C. NEW THIS WEEK — among this-week customers, those whose FIRST
//      ever non-cancelled order fell in the window. Returning + new
//      must equal this_week_customers (same denominator, disjoint).

/** Lower bound of the "last N IST days" window — inclusive. The
 *  window ends at end-of-today IST and spans N days back from there,
 *  which means the window starts at IST-midnight (N-1) days ago. */
export function windowStartIso(windowDays: number, today: Date = new Date()): string {
  const istMidnightUtc = Math.floor(
    (today.getTime() + IST_OFFSET_MS) / 86_400_000,
  ) * 86_400_000 - IST_OFFSET_MS;
  const startMs = istMidnightUtc - (windowDays - 1) * 86_400_000;
  return new Date(startMs).toISOString();
}

export type ReturningMetrics = {
  window_days: number;
  this_week_customers: number;
  returning_count: number;
  returning_pct: number;   // one decimal
  new_count: number;
  new_pct: number;         // one decimal
};

/** Compute the RETURNING-THIS-WEEK + NEW-THIS-WEEK metrics in one
 *  pass. They share a denominator (customers who ordered in the
 *  window) and must stay disjoint, which is why they live in one
 *  function. */
export function computeReturningMetrics(
  rows: MoneyOrderRow[],
  windowDays: number,
  today: Date = new Date(),
): ReturningMetrics {
  const start = windowStartIso(windowDays, today);
  // First-order time per customer, across the entire history.
  const firstOrderAt = new Map<string, string>();
  // Latest in-window time per customer, so we can confirm they ordered this week.
  const orderedInWindow = new Set<string>();
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    if (!r.customer_id) continue;
    const prior = firstOrderAt.get(r.customer_id);
    if (!prior || r.created_at < prior) firstOrderAt.set(r.customer_id, r.created_at);
    if (r.created_at >= start) orderedInWindow.add(r.customer_id);
  }
  let returning = 0;
  let newThisWeek = 0;
  orderedInWindow.forEach((cid) => {
    const first = firstOrderAt.get(cid)!;
    if (first < start) returning += 1;
    else newThisWeek += 1;
  });
  const total = orderedInWindow.size;
  const pct = (n: number) =>
    total === 0 ? 0 : Math.round((n / total) * 1000) / 10;
  return {
    window_days: windowDays,
    this_week_customers: total,
    returning_count: returning,
    returning_pct: pct(returning),
    new_count: newThisWeek,
    new_pct: pct(newThisWeek),
  };
}

export type LifetimeRepeat = {
  ever_ordered: number;     // customers with >=1 non-cancelled order
  repeat_customers: number; // customers with >=2 non-cancelled orders
  repeat_pct: number;       // one decimal
};

/** Share of customers who have ever ordered more than once. */
export function computeLifetimeRepeat(rows: MoneyOrderRow[]): LifetimeRepeat {
  const perCustomer = new Map<string, number>();
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    if (!r.customer_id) continue;
    perCustomer.set(r.customer_id, (perCustomer.get(r.customer_id) ?? 0) + 1);
  }
  let repeat = 0;
  perCustomer.forEach((n) => { if (n >= 2) repeat += 1; });
  const ever = perCustomer.size;
  const pct = ever === 0 ? 0 : Math.round((repeat / ever) * 1000) / 10;
  return { ever_ordered: ever, repeat_customers: repeat, repeat_pct: pct };
}

// ── Segment counts — "what do I do about this?" links ──────────────
//
// Three counts the admin reads off the Money screen and clicks
// straight into the CRM to act on. Each one describes a DIFFERENT
// action, which is why they are three chips and not one:
//
//   * never_ordered (= "never received bread") — customers with 0
//     non-cancelled orders AND no subscription. This INCLUDES the
//     tried_cancelled group below by construction: a cancel-only
//     customer has never received bread. The action here is a
//     first-time offer or a welcome message.
//   * tried_cancelled — the SUBSET of never_ordered whose record
//     shows at least one CANCELLED order. The action is a phone
//     call: find out what went wrong on the one attempt they made.
//   * lapsed >21d — customers whose most recent non-cancelled order
//     is more than 21 days old. Disjoint from both of the above by
//     construction: no last_order_at → no lapsed membership.
//
// The chip rule is deliberately the same rule as matchesSegment() in
// src/lib/mkt-crm.ts, so what the Money screen shows and what /mkt's
// chip filter renders cannot drift apart.

const LAPSED_DAYS = 21;

export type SegmentCounts = {
  never_ordered: number;      // includes tried_cancelled
  tried_cancelled: number;    // subset of never_ordered
  lapsed_over_21d: number;
};

export function computeSegmentCounts(
  customerIds: string[],
  rows: MoneyOrderRow[],
  subscriberIds: Set<string>,
  today: Date = new Date(),
): SegmentCounts {
  // Per-customer: non-cancelled count, cancelled count, last non-
  // cancelled order ISO. All three are keyed on customer_id, so a
  // single pass over rows builds them.
  const totalOrders = new Map<string, number>();
  const cancelledOrders = new Map<string, number>();
  const lastOrderAt = new Map<string, string>();
  for (const r of rows) {
    if (!r.customer_id) continue;
    if (isCancelled(r.status)) {
      cancelledOrders.set(r.customer_id, (cancelledOrders.get(r.customer_id) ?? 0) + 1);
      continue;
    }
    totalOrders.set(r.customer_id, (totalOrders.get(r.customer_id) ?? 0) + 1);
    const prev = lastOrderAt.get(r.customer_id);
    if (!prev || r.created_at > prev) lastOrderAt.set(r.customer_id, r.created_at);
  }
  let never = 0;
  let tried = 0;
  let lapsed = 0;
  const nowMs = today.getTime();
  const lapsedThresholdMs = LAPSED_DAYS * 86_400_000;
  for (const cid of customerIds) {
    const n = totalOrders.get(cid) ?? 0;
    if (n === 0) {
      if (subscriberIds.has(cid)) continue;
      never += 1;
      if ((cancelledOrders.get(cid) ?? 0) >= 1) tried += 1;
      continue;
    }
    const last = lastOrderAt.get(cid);
    if (last && nowMs - Date.parse(last) > lapsedThresholdMs) lapsed += 1;
  }
  return {
    never_ordered: never,
    tried_cancelled: tried,
    lapsed_over_21d: lapsed,
  };
}

// ── Break-even jar ─────────────────────────────────────────────────

export type BreakEvenJar = {
  target_paise: number | null;    // null = not yet set by admin
  current_week_paise: number;      // revenue IN the current IST week
  current_week_key: string;        // Monday YYYY-MM-DD
  pct_of_target: number;          // 0..100, or 0 when target null
};

/** Jar fill = current IST week's revenue / target. When target is
 *  null the screen must show "set your weekly target" rather than
 *  a zero jar — the UI does that by checking target_paise === null. */
export function computeJar(
  rows: MoneyOrderRow[],
  targetPaise: number | null,
  today: Date = new Date(),
): BreakEvenJar {
  const thisMon = istWeekKey(today);
  let paise = 0;
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    if (istWeekKey(r.created_at) !== thisMon) continue;
    paise += Math.round((Number(r.total_amount) || 0) * 100);
  }
  const pct =
    targetPaise && targetPaise > 0
      ? Math.max(0, Math.min(100, Math.round((paise / targetPaise) * 100)))
      : 0;
  return {
    target_paise: targetPaise,
    current_week_paise: paise,
    current_week_key: thisMon,
    pct_of_target: pct,
  };
}
