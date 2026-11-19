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

// ── Repeat rate ────────────────────────────────────────────────────

export type RepeatRate = {
  window_days: number;
  orders: number;
  distinct_customers: number;
  repeat_customers: number;      // customers with >= 2 orders in-window
  repeat_rate_pct: number;       // repeat_customers / distinct, rounded to 1 dp
};

/** Compute the "almost nobody orders twice" number over the last
 *  `windowDays` IST days ending today (inclusive). */
export function computeRepeatRate(
  rows: MoneyOrderRow[],
  windowDays: number,
  today: Date = new Date(),
): RepeatRate {
  const buckets = buildDayBuckets(rows, windowDays, today);
  const keep = new Set(buckets.map((b) => b.key));
  const perCustomer = new Map<string, number>();
  let orders = 0;
  for (const r of rows) {
    if (isCancelled(r.status)) continue;
    if (!r.customer_id) continue;
    const k = istDayKey(r.created_at);
    if (!keep.has(k)) continue;
    perCustomer.set(r.customer_id, (perCustomer.get(r.customer_id) ?? 0) + 1);
    orders += 1;
  }
  let repeaters = 0;
  perCustomer.forEach((n) => { if (n >= 2) repeaters += 1; });
  const distinct = perCustomer.size;
  const pct = distinct === 0 ? 0 : Math.round((repeaters / distinct) * 1000) / 10;
  return {
    window_days: windowDays,
    orders,
    distinct_customers: distinct,
    repeat_customers: repeaters,
    repeat_rate_pct: pct,
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
