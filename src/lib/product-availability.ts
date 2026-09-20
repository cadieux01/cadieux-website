// Per-product delivery floor — the "pre-order until stock lands" rule.
//
// A product with `products.available_from` set is still VISIBLE, BROWSABLE and
// SELLABLE. The only thing it cannot do is be delivered before that date. This
// is deliberately NOT `in_stock`: that column means "never sell" and gates
// seven server paths plus the subscription plan list. The two live side by
// side and mean different things.
//
// EVERY date in here comes from the database. There is no hardcoded
// 2026-09-24 anywhere in the codebase by design — lifting the pre-order is a
// single UPDATE with no deploy, and a literal in application code would
// silently outlive it.
//
// Pure: no I/O, no clock read beyond the injected `now`.

import { todayIst } from "@/lib/delivery-slots";

/** Response `code` for a delivery date below a product's floor.
 *
 *  Deliberately NOT `product_unavailable`: the Android app's
 *  `handleOrderApiError` appends ". Please return to the cart to refresh
 *  prices." to that branch, which is the wrong instruction here — the cart is
 *  fine, the date is not. An unrecognised code falls through to the app's
 *  final `else`, which renders the server's `error` string verbatim. That is
 *  the only way to put an accurate sentence in front of an app customer
 *  without a Play release, so this string must stay unknown to the app. */
export const PREORDER_FLOOR_CODE = "preorder_floor";

/** The subset of a products row this module needs. Structurally compatible
 *  with lib/products.ProductRow, order-validation.ProductRow and
 *  order-validation.WebProductRow, so callers pass their existing rows. */
export type AvailabilityRow = {
  name: string;
  available_from?: string | null;
  stock_message?: string | null;
};

/** Narrow a Postgres `date` (or anything else the column yields) to a bare
 *  yyyy-mm-dd, or null. Supabase returns `date` as a string, but a widened
 *  SELECT elsewhere could hand us a timestamp — take the date part and never
 *  throw. */
function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const head = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

/** The product's floor, or null if it has none or the floor has already
 *  passed. A floor in the past is spent — stock landed and nobody cleared the
 *  column — and must not keep blocking dates. */
export function productFloor(
  row: AvailabilityRow,
  now: Date = new Date(),
): string | null {
  const iso = asIsoDate(row.available_from);
  if (!iso) return null;
  return iso > todayIst(now) ? iso : null;
}

/** Everything a customer-facing surface needs to render the pre-order state,
 *  resolved server-side. Lives here rather than in lib/products so client
 *  components can import the type without reaching into a server module. */
export type PreorderInfo = {
  /** Earliest deliverable date, yyyy-mm-dd. */
  date: string;
  /** "Back in stock Thursday 24 September." */
  line: string;
  /** "Pre-order now — delivery from Thursday 24 September." */
  buttonNote: string;
};

/** True iff this product is currently pre-order-only. */
export function isPreorder(row: AvailabilityRow, now: Date = new Date()): boolean {
  return productFloor(row, now) !== null;
}

export type CartFloor = {
  /** The earliest date the WHOLE order can be delivered, or null if
   *  unrestricted. */
  date: string | null;
  /** Names of the lines that set the floor — i.e. those whose own floor
   *  equals `date`. Drives "Your cart contains X, so …". */
  names: string[];
  /** True when the cart also holds at least one unrestricted product. This is
   *  the mixed cart, and the only case where "remove X to get delivery
   *  tomorrow" is true advice rather than a dead end. */
  mixed: boolean;
};

/** Floor for a whole order: MAX(available_from) across its lines.
 *
 *  An order carries ONE `delivery_date` and there is no split-fulfilment
 *  concept anywhere in the schema, so the latest loaf sets the date for
 *  everything in the box. Deliberately not MIN and deliberately not per-line:
 *  either would promise a delivery the kitchen cannot make. */
export function cartFloor(
  rows: AvailabilityRow[],
  now: Date = new Date(),
): CartFloor {
  let date: string | null = null;
  let hasUnrestricted = false;
  for (const row of rows) {
    const floor = productFloor(row, now);
    if (!floor) {
      hasUnrestricted = true;
      continue;
    }
    if (date === null || floor > date) date = floor;
  }
  if (date === null) return { date: null, names: [], mixed: false };
  const names: string[] = [];
  for (const row of rows) {
    if (productFloor(row, now) === date && !names.includes(row.name)) {
      names.push(row.name);
    }
  }
  return { date, names, mixed: hasUnrestricted };
}

// ── Formatting ─────────────────────────────────────────────────────────────
// ISO dates are calendar dates, not instants. Every formatter below parses to
// a UTC midnight and formats in UTC, so the rendered day can never drift by
// one in another timezone.

function parseIso(iso: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  return new Date(Date.UTC(y, m - 1, d));
}

const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
];

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** "Thursday 24 September" — the customer-facing long form. No year: the
 *  floor is always within days, and a year reads like a warehouse date.
 *
 *  Spelled out rather than via `toLocaleDateString`, which under `en-IN`
 *  renders "Thursday, 24 September" — a comma the approved copy does not
 *  have. More importantly the ICU output varies with the runtime's locale
 *  data, and this exact sentence is also stored in `products.stock_message`
 *  and shipped verbatim to the Android app in an error body, so the two must
 *  not be able to disagree. */
export function formatFloorLong(iso: string): string {
  const dt = parseIso(iso);
  if (!dt) return iso;
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** "24 September" — day + month, no weekday.
 *
 *  The long form names the weekday, which is the right thing for a
 *  ONE-OFF delivery promise ("delivery from Thursday 24 September") and the
 *  wrong thing on a subscription plan tile, where the weekday reads like the
 *  delivery day of the plan rather than the restock date. Same hand-spelled
 *  MONTHS table, same UTC parse, so the two forms can never name different
 *  days. */
export function formatFloorShort(iso: string): string {
  const dt = parseIso(iso);
  if (!dt) return iso;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

// ── Subscriptions: a pre-order loaf cannot start a NEW plan ─────────────
//
// Stricter than the one-off rule on purpose. A one-off can simply be
// delivered on or after the floor — the customer waits once. A SUBSCRIPTION
// is a standing commitment whose whole schedule would have to be pushed,
// and the customer has already paid for every stop up front, so the honest
// answer is "not yet" rather than a rescheduled plan.
//
// EXISTING subscriptions are untouched. This gates creation only.

/** Response `code` for a new subscription containing a pre-order loaf.
 *
 *  Unknown to the Android app by design — its `handleOrderApiError` falls
 *  through to rendering the server's `error` string verbatim, which is the
 *  only way to put an accurate sentence in front of an app customer without
 *  a Play release. */
export const PREORDER_SUBSCRIPTION_CODE = "preorder_subscription";

/** The plan-tile line: "Out of stock — back 24 September", or null when the
 *  product can be subscribed to today. */
export function subscriptionBlockLine(
  row: AvailabilityRow,
  now: Date = new Date(),
): string | null {
  const floor = productFloor(row, now);
  if (!floor) return null;
  return `Out of stock — back ${formatFloorShort(floor)}.`;
}

/** Server gate for subscription CREATE. Returns null when every line can be
 *  subscribed to, else a ready-to-send rejection. */
export function subscriptionFloorError(
  rows: AvailabilityRow[],
  now: Date = new Date(),
): { status: number; error: string; code: string } | null {
  const blocked: string[] = [];
  let date: string | null = null;
  for (const row of rows) {
    const floor = productFloor(row, now);
    if (!floor) continue;
    if (!blocked.includes(row.name)) blocked.push(row.name);
    if (date === null || floor > date) date = floor;
  }
  if (!date) return null;
  return {
    status: 400,
    error: `${joinNames(blocked)} is out of stock — back ${formatFloorShort(date)}. Please subscribe to it after that date.`,
    code: PREORDER_SUBSCRIPTION_CODE,
  };
}

/** The line shown under the OUT OF STOCK badge.
 *
 *  `stock_message` is a tone override only. When it is null the sentence is
 *  derived from `available_from`, so the date stays the single source of
 *  truth and clearing the floor clears the copy with it. */
export function availabilityLine(
  row: AvailabilityRow,
  now: Date = new Date(),
): string | null {
  const floor = productFloor(row, now);
  if (!floor) return null;
  const custom = (row.stock_message ?? "").trim();
  if (custom) return custom;
  return `Back in stock ${formatFloorLong(floor)}.`;
}

/** Under the PRE-ORDER button. Always derived — there is no override,
 *  because this sentence is a promise about delivery, not a description of
 *  stock. */
export function preorderButtonNote(
  row: AvailabilityRow,
  now: Date = new Date(),
): string | null {
  const floor = productFloor(row, now);
  if (!floor) return null;
  return `Pre-order now — delivery from ${formatFloorLong(floor)}.`;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

/** Which flow the banner is being rendered in. The subscription builder has
 *  no cart, so "Your cart contains…" is simply untrue there. */
export type FloorContext = "cart" | "subscription";

/** The banner. Shown BEFORE the date is chosen — the date is never moved
 *  silently, so the customer learns the constraint while they can still act
 *  on it. */
export function cartFloorMessage(
  floor: CartFloor,
  context: FloorContext = "cart",
): string | null {
  if (!floor.date) return null;
  const lead =
    context === "subscription" ? "Your subscription includes" : "Your cart contains";
  return `${lead} ${joinNames(floor.names)}, so the earliest delivery is ${formatFloorLong(floor.date)}.`;
}

/** The escape hatch, shown only for a MIXED selection. A customer who wanted
 *  Plain tomorrow and is silently pushed six days out is a lost sale; for a
 *  selection that is entirely pre-order this sentence would be a lie, hence
 *  the `mixed` gate.
 *
 *  A subscription's first delivery is never "tomorrow" in the same sense —
 *  it is whichever date they pick — so the sentence is framed around the
 *  calendar rather than a specific day. */
export function cartFloorEscapeHint(
  floor: CartFloor,
  context: FloorContext = "cart",
): string | null {
  if (!floor.date || !floor.mixed) return null;
  const names = joinNames(floor.names);
  return context === "subscription"
    ? `Remove ${names} to open up the earlier dates.`
    : `Remove ${names} to get delivery tomorrow.`;
}

/** The server's rejection message. Reaches Android customers verbatim via
 *  `ApiError.message`, so it must read as finished copy, not a diagnostic. */
export function preorderFloorError(floor: CartFloor): string {
  const date = floor.date ? formatFloorLong(floor.date) : "a later date";
  return `${joinNames(floor.names)} is back in stock ${date}. Please pick ${date} or later for this order.`;
}
