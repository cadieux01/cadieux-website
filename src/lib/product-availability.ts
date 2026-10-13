// Per-product delivery days — which calendar dates a loaf can be delivered on.
//
// A product with a restriction is still VISIBLE, BROWSABLE and SELLABLE. The
// only thing it cannot do is be delivered on a day the kitchen is not baking
// it. This is deliberately NOT `in_stock`: that column means "never sell" and
// gates seven server paths plus the subscription plan list. The two live side
// by side and mean different things.
//
// ── THE SET, AND WHY IT IS NOT A FLOOR ────────────────────────────────────
//
// `products.available_from` is a RAY: one date, and every day from it onward.
// That is the right shape for "stock lands on the 24th" and the wrong shape
// for "we bake this on Thursday, and then daily from the 19th". Raja's
// multigrain schedule is two discrete days plus a ray, and no single date can
// express it: 19 Oct closes the 16th he is baking, 13 Oct opens the 14th,
// 15th, 17th and 18th he is not.
//
// So a product's deliverable days are a SET, and the set is a UNION:
//
//     bookable(product, date)  ==  date IN product_open_dates(product)
//                               OR date >= products.available_from
//
// A product with no `product_open_dates` rows is therefore exactly what it
// was before that table existed — the first clause is simply never true for
// it. Nothing in here changes behaviour for the five products that have no
// rows, which is what made the table safe to apply ahead of this code.
//
// EVERY date in here comes from the database. There is no hardcoded
// 2026-10-16 or 2026-10-19 anywhere in the codebase by design — changing a
// baking schedule is an INSERT and an UPDATE with no deploy, and a literal in
// application code would silently outlive it.
//
// ── WHAT THIS MODULE DOES NOT DECIDE ──────────────────────────────────────
//
// Whether a day can still be BOOKED. That is the 12-hour lead time, it lives
// in delivery-slots.ts, and it is a different question with a different
// answer: an open day is only reachable until roughly 12 h before the slot
// wanted (04:00 IST for a 16:00 slot), so a day can be OPEN and UNREACHABLE
// at the same time. 13 Oct is in the table for the multigrain trio and is not
// selectable this afternoon, and both of those facts are correct.
//
// The two predicates are ANDed, never substituted:
//
//     deliverable(date) == dateHasAnyBookable(date, now)   // lead time
//                       && openSetHas(set, date)           // baking schedule
//
// Only the AND may drive a calendar cell, a chip or a sentence. Reading the
// raw open-date set and printing it is how you promise a day that the lead
// time has already taken away.
//
// Pure: no I/O, no clock read beyond the injected `now`.

import { dateHasAnyBookable, todayIst } from "@/lib/delivery-slots";

/** Response `code` for a delivery date the kitchen is not baking on.
 *
 *  NAME IS HISTORICAL AND THE STRING IS A WIRE PROTOCOL — do not "correct"
 *  either. It is deliberately NOT `product_unavailable`: the Android app's
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
  /** Discrete open days (yyyy-mm-dd) from `product_open_dates`, in ADDITION
   *  to the ray `available_from` starts. Order and duplicates do not matter.
   *
   *  `undefined` and `[]` are NOT the same thing, and the difference decides
   *  which way a missing read fails:
   *    • `undefined` — this caller does not read open days at all. The row is
   *      treated as ray-only, i.e. exactly as it behaved before this column
   *      existed. Every server path DOES read them; see productOpenSet.
   *    • `[]` — read, and there are none. With no ray either, the product has
   *      no deliverable day at all, and the storefront says so.
   *  An empty read therefore cannot silently open a closed day, which is the
   *  one direction that matters. */
  open_dates?: string[] | null;
};

/** The PostgREST embed that brings a product's open days along with its row,
 *  and the flattener for it.
 *
 *  A string and a two-line map, kept here rather than inlined at each of the
 *  nine select lists that need them, because the failure mode of forgetting
 *  one is SILENT: the row parses, `open_dates` is undefined, the product
 *  reads as ray-only, and that path alone starts accepting closed days. There
 *  is no error to notice. Grep for this constant to enumerate every reader.
 *
 *  Note these are a DB shape in an otherwise pure module. That is deliberate:
 *  the invariant being protected is "every reader of a product row reads its
 *  open days too", and the only place that invariant is stated is here. */
export const OPEN_DATES_SELECT = "product_open_dates(open_date)";

export function flattenOpenDates<T>(
  row: T & { product_open_dates?: { open_date: string }[] | null },
): T & { open_dates: string[] } {
  const { product_open_dates: joined, ...rest } = row;
  return { ...(rest as T), open_dates: (joined ?? []).map((d) => d.open_date) };
}

/** Narrow a Postgres `date` (or anything else the column yields) to a bare
 *  yyyy-mm-dd, or null. Supabase returns `date` as a string, but a widened
 *  SELECT elsewhere could hand us a timestamp — take the date part and never
 *  throw. */
function asIsoDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const head = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(head) ? head : null;
}

// ── The set ────────────────────────────────────────────────────────────────

/** A product's deliverable days, relative to today.
 *
 *  `restricted: false` means every date from today onward — the shape of a
 *  product with no open-day rows and no live ray, which is five of the six
 *  products in the catalogue and every product that ever existed before this
 *  module grew a set.
 *
 *  `restricted: true` is the union of `days` (discrete, ascending, today or
 *  later, all strictly before `from` when there is a `from`) and the ray
 *  `[from, ∞)` when `from` is non-null.
 *
 *  `{ restricted: true, days: [], from: null }` is legal and means NOTHING is
 *  deliverable. It is what a product whose open days have all passed looks
 *  like, and it is why `days` is filtered rather than the whole restriction
 *  being dropped — see productOpenSet. */
export type OpenSet =
  | { restricted: false }
  | { restricted: true; days: string[]; from: string | null };

const UNRESTRICTED: OpenSet = { restricted: false };

/** Resolve a row to its set of deliverable days.
 *
 *  THE EXPIRY RULES, both of which fail in the safe direction:
 *
 *  1. A ray whose start has PASSED is spent and the whole product becomes
 *     unrestricted — nobody clears the column on the day, and this is the
 *     reason every such restriction clears itself with no deploy. Its
 *     discrete days are all
 *     strictly earlier than the ray start, so they are all in the past too
 *     and there is nothing left to lose.
 *
 *  2. A discrete day that has passed is dropped, but a product that HAD open
 *     days stays restricted even when every one of them is gone. That is the
 *     load-bearing asymmetry with rule 1: dropping the restriction instead
 *     would make a product with a finite, exhausted schedule deliverable on
 *     every day of the year. Open days fail CLOSED; that is the entire reason
 *     the table is a list of open days rather than a list of blackouts. */
export function productOpenSet(
  row: AvailabilityRow,
  now: Date = new Date(),
): OpenSet {
  const today = todayIst(now);
  const from = asIsoDate(row.available_from);

  // Rule 1. This is the ONLY place the ray start is compared to today, so the
  // admin warning and the customer calendar cannot drift apart.
  if (from && from <= today) return UNRESTRICTED;

  const raw: string[] = [];
  for (const d of row.open_dates ?? []) {
    const iso = asIsoDate(d);
    if (iso && !raw.includes(iso)) raw.push(iso);
  }

  // No open days were supplied at all, and no live ray: unrestricted. This is
  // also the `open_dates: undefined` case — a caller that does not read the
  // column behaves exactly as it did before the column existed.
  if (raw.length === 0 && !from) return UNRESTRICTED;

  // Rule 2.
  const days = raw
    .filter((d) => d >= today && (from === null || d < from))
    .sort();
  return { restricted: true, days, from };
}

/** Is `iso` in the set? Baking schedule ONLY — says nothing about whether the
 *  12-hour lead still allows booking it. See the module header. */
export function openSetHas(set: OpenSet, iso: string): boolean {
  if (!set.restricted) return true;
  if (set.from !== null && iso >= set.from) return true;
  return set.days.includes(iso);
}

/** True iff the product cannot be delivered on every day from today — i.e. it
 *  has a baking schedule worth printing. */
export function isPreorder(row: AvailabilityRow, now: Date = new Date()): boolean {
  return productOpenSet(row, now).restricted;
}

/** Intersect sets — what a WHOLE order can be delivered on.
 *
 *  An order carries ONE `delivery_date` and there is no split-fulfilment
 *  concept anywhere in the schema, so a date has to work for every line in
 *  the box. INTERSECTION, not MAX(available_from): a max is a ray, and a ray
 *  cannot express `{16 Oct} ∪ [19 Oct, ∞)`. Taking the max of 19 Oct and
 *  16 Oct would hand the customer 19 Oct and quietly delete the 16th, which
 *  is a day the kitchen is baking both.
 *
 *  THE SHAPE IS CLOSED UNDER INTERSECTION, which is why the result is another
 *  OpenSet rather than something weaker. With S_i = D_i ∪ [f_i, ∞) and
 *  F = max f_i: every d >= F is in every S_i, and a d < F is in the
 *  intersection iff every member admits it individually. So
 *  ∩ S_i = D ∪ [F, ∞) with D = { d < F : ∀i openSetHas(S_i, d) }.
 *
 *  One member with NO ray collapses the result's ray: that member is finite,
 *  so past its last day nothing in the order is deliverable, however open
 *  everything else is. */
export function intersectOpenSets(sets: OpenSet[]): OpenSet {
  const restricted = sets.filter(
    (s): s is Extract<OpenSet, { restricted: true }> => s.restricted,
  );
  if (restricted.length === 0) return UNRESTRICTED;

  let from: string | null = null;
  let finite = false;
  for (const s of restricted) {
    if (s.from === null) finite = true;
    else if (from === null || s.from > from) from = s.from;
  }
  const resultFrom = finite ? null : from;

  // Candidates are the UNION of every member's discrete days. The result can
  // contain no other date below the ray: a date in no member's day list is
  // only ever admitted by a member's ray, and a date below every member's ray
  // start is below the max.
  const candidates: string[] = [];
  for (const s of restricted) {
    for (const d of s.days) if (!candidates.includes(d)) candidates.push(d);
  }
  const days = candidates
    .filter(
      (d) =>
        (resultFrom === null || d < resultFrom) &&
        restricted.every((s) => openSetHas(s, d)),
    )
    .sort();

  return { restricted: true, days, from: resultFrom };
}

/** Narrow a set to the days a customer can STILL BOOK, by ANDing in the
 *  12-hour lead time. This is the only thing allowed to drive a chip, a
 *  calendar cell or a sentence — see the module header.
 *
 *  Only `days` is filtered. A live ray starts strictly after today, so its
 *  first day is at least tomorrow, and tomorrow's evening slot is always more
 *  than 12 h away from any moment today — a ray start is reachable by
 *  construction. The scan is kept anyway rather than asserted, because it
 *  costs nothing and the lead time is a constant someone may raise. */
export function reachableOpenSet(set: OpenSet, now: Date = new Date()): OpenSet {
  if (!set.restricted) return set;
  const days = set.days.filter((d) => dateHasAnyBookable(d, now));
  const from =
    set.from !== null && !dateHasAnyBookable(set.from, now)
      ? nextBookableFrom(set.from, now)
      : set.from;
  return { restricted: true, days, from };
}

/** First date at or after `iso` with a bookable slot, scanning a bounded
 *  window. Null only if the lead time has swallowed a fortnight, which cannot
 *  happen with a 12-hour lead and three daily slots. */
function nextBookableFrom(iso: string, now: Date): string | null {
  const [y, m, d] = iso.split("-").map((s) => parseInt(s, 10));
  for (let i = 0; i < 14; i++) {
    const probe = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (dateHasAnyBookable(probe, now)) return probe;
  }
  return null;
}

/** The deliverable dates inside a window, lead time AND schedule applied.
 *  `[]` means there is no day the customer can take this order on — which the
 *  caller must SAY, never render as an empty calendar. */
export function deliverableDates(
  set: OpenSet,
  windowDays: number = 30,
  now: Date = new Date(),
): string[] {
  const today = todayIst(now);
  const [y, m, d] = today.split("-").map((s) => parseInt(s, 10));
  const out: string[] = [];
  for (let i = 0; i < windowDays; i++) {
    const iso = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10);
    if (dateHasAnyBookable(iso, now) && openSetHas(set, iso)) out.push(iso);
  }
  return out;
}

/** Earliest deliverable date inside the window, or null. */
export function earliestDeliverable(
  set: OpenSet,
  windowDays: number = 30,
  now: Date = new Date(),
): string | null {
  return deliverableDates(set, windowDays, now)[0] ?? null;
}

// ── Carts and orders ───────────────────────────────────────────────────────

export type CartOpenDays = {
  /** The intersection across every line. */
  set: OpenSet;
  /** Names of the lines that restrict anything, cart order, deduped. Drives
   *  "Your cart contains X, so …". */
  names: string[];
  /** True when the cart also holds at least one unrestricted product. This is
   *  the mixed cart, and the only case where "remove X to get the earlier
   *  dates" is true advice rather than a dead end. */
  mixed: boolean;
};

export function cartOpenDays(
  rows: AvailabilityRow[],
  now: Date = new Date(),
): CartOpenDays {
  const sets: OpenSet[] = [];
  const names: string[] = [];
  let mixed = false;
  for (const row of rows) {
    const set = productOpenSet(row, now);
    sets.push(set);
    if (set.restricted) {
      if (!names.includes(row.name)) names.push(row.name);
    } else {
      mixed = true;
    }
  }
  return { set: intersectOpenSets(sets), names, mixed };
}

/** Which lines close `iso`, by name. This is what lets the picker say
 *  "Multigrain Pizza Base isn't baked on this day" instead of greying a cell
 *  out and leaving the customer to guess which loaf did it. */
export function closedBy(
  rows: AvailabilityRow[],
  iso: string,
  now: Date = new Date(),
): string[] {
  const names: string[] = [];
  for (const row of rows) {
    if (!openSetHas(productOpenSet(row, now), iso) && !names.includes(row.name)) {
      names.push(row.name);
    }
  }
  return names;
}

/** Dates in the window that the lead time allows and that ONLY the restricted
 *  lines are closing — i.e. exactly what the customer would gain by removing
 *  them. Drives the mixed-cart escape hint, and keeps it from naming a date
 *  that removal would not actually open. */
export function datesOpenedByDropping(
  cart: CartOpenDays,
  windowDays: number = 30,
  now: Date = new Date(),
): string[] {
  if (!cart.set.restricted || !cart.mixed) return [];
  const all = deliverableDates(UNRESTRICTED, windowDays, now);
  return all.filter((iso) => !openSetHas(cart.set, iso));
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

/** "Thursday 24 September" — the customer-facing long form. No year: these
 *  dates are always within days, and a year reads like a warehouse date.
 *
 *  Spelled out rather than via `toLocaleDateString`, which under `en-IN`
 *  renders "Thursday, 24 September" — a comma the approved copy does not
 *  have. More importantly the ICU output varies with the runtime's locale
 *  data, and these sentences are shipped verbatim to the Android app in an
 *  error body, so the forms must not be able to disagree. */
export function formatFloorLong(iso: string): string {
  const dt = parseIso(iso);
  if (!dt) return iso;
  return `${WEEKDAYS[dt.getUTCDay()]} ${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

/** "Thu 24 Sep" — the weekday-abbreviated inline form, and the one every
 *  baking-day sentence uses. A weekday is informative here because the days
 *  are a schedule rather than a single restock: "Thu 16 Oct, then daily from
 *  Mon 19 Oct" is read as a rhythm. Same UTC parse + hand-spelled tables as
 *  its siblings so the three forms can never disagree on the day. */
export function formatFloorMedium(iso: string): string {
  const dt = parseIso(iso);
  if (!dt) return iso;
  const wk = WEEKDAYS[dt.getUTCDay()].slice(0, 3);
  const mo = MONTHS[dt.getUTCMonth()].slice(0, 3);
  return `${wk} ${dt.getUTCDate()} ${mo}`;
}

/** "24 September" — day + month, no weekday. For places where a weekday
 *  would read as the delivery day of a recurring plan rather than a date.
 *  Same hand-spelled MONTHS table, same UTC parse. */
export function formatFloorShort(iso: string): string {
  const dt = parseIso(iso);
  if (!dt) return iso;
  return `${dt.getUTCDate()} ${MONTHS[dt.getUTCMonth()]}`;
}

function joinList(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

/** The set as a phrase: "Thu 16 Oct, then any day from Mon 19 Oct",
 *  "any day from Fri 16 Oct", "Thu 16 Oct". Empty string for an unrestricted
 *  set (there is nothing to say) and for a set with nothing left in it (the
 *  caller owes the customer a different sentence entirely — see
 *  `noDeliveryDayMessage`).
 *
 *  Takes the REACHABLE set, so a day the 12-hour lead has already taken away
 *  never appears. Callers pass `now`; they must not hand this the raw set. */
export function formatOpenDays(set: OpenSet, now: Date = new Date()): string {
  if (!set.restricted) return "";
  const live = reachableOpenSet(set, now);
  if (!live.restricted) return "";
  const dayPhrases = live.days.map(formatFloorMedium);
  const rayPhrase =
    live.from !== null ? `any day from ${formatFloorMedium(live.from)}` : null;
  if (dayPhrases.length === 0) return rayPhrase ?? "";
  if (!rayPhrase) return joinList(dayPhrases);
  return `${joinList(dayPhrases)}, then ${rayPhrase}`;
}

/** The product-tile / PDP availability line: "Baking Thu 16 Oct, then any day
 *  from Mon 19 Oct." Null when unrestricted or when nothing is left.
 *
 *  `stock_message` is honoured as a TONE OVERRIDE for the ray-only case only.
 *  It is a single sentence written by hand ("Back in stock Friday 16
 *  October.") and there is no way for it to describe a set of discrete days
 *  without going stale the moment the days change, so a product with open
 *  days derives its line and ignores the column. */
export function availabilityLine(
  row: AvailabilityRow,
  now: Date = new Date(),
): string | null {
  const set = productOpenSet(row, now);
  if (!set.restricted) return null;
  const live = reachableOpenSet(set, now);
  if (!live.restricted) return null;
  if (live.days.length === 0 && live.from !== null) {
    const custom = (row.stock_message ?? "").trim();
    if (custom) return custom;
  }
  const phrase = formatOpenDays(set, now);
  if (!phrase) return null;
  return `Baking ${phrase}.`;
}

/** Under the order button. Always derived — there is no override, because
 *  this sentence is a promise about delivery, not a description of stock. */
export function preorderButtonNote(
  row: AvailabilityRow,
  now: Date = new Date(),
): string | null {
  const set = productOpenSet(row, now);
  if (!set.restricted) return null;
  const phrase = formatOpenDays(set, now);
  if (!phrase) return null;
  return `Order now — pick ${phrase}.`;
}

/** Everything a customer-facing surface needs to render the baking-days
 *  state, resolved server-side. Lives here rather than in lib/products so
 *  client components can import the type without reaching into a server
 *  module. */
export type PreorderInfo = {
  /** Earliest deliverable date, yyyy-mm-dd, lead time included. Empty string
   *  when there is none — a product whose schedule is exhausted. */
  date: string;
  /** "Baking Thu 16 Oct, then any day from Mon 19 Oct." */
  line: string;
  /** "Order now — pick Thu 16 Oct, then any day from Mon 19 Oct." */
  buttonNote: string;
  /** The RAW halves of the set, passed through rather than resolved to a
   *  boolean or a single date.
   *
   *  This DTO is cached for 60 s and served to the browser, and the client
   *  re-derives the set at render time. A flag resolved at 23:59:30 would
   *  still be claiming a day was open half a minute into the next one, and a
   *  single date cannot represent `{16} ∪ [19, ∞)` at all — which is the
   *  whole reason this module stopped being a floor. */
  openDates: string[];
  from: string | null;
};

/** Build the DTO for a row, or null when there is nothing to say. */
export function preorderInfo(
  row: AvailabilityRow,
  now: Date = new Date(),
): PreorderInfo | null {
  const set = productOpenSet(row, now);
  if (!set.restricted) return null;
  return {
    date: earliestDeliverable(set, 60, now) ?? "",
    line: availabilityLine(row, now) ?? "",
    buttonNote: preorderButtonNote(row, now) ?? "",
    openDates: set.days,
    from: set.from,
  };
}

/** Plan-tile informational line: "Available Thu 16 Oct, then any day from
 *  Mon 19 Oct.", or null when the product can be delivered any day. Renders
 *  ALONGSIDE the qty stepper — this is a promise about when the plan's
 *  deliveries can land, not a block on selection. */
export function subscriptionAvailabilityLine(
  row: AvailabilityRow,
  now: Date = new Date(),
): string | null {
  const set = productOpenSet(row, now);
  if (!set.restricted) return null;
  const phrase = formatOpenDays(set, now);
  if (!phrase) return null;
  return `Available ${phrase}.`;
}

/** Which flow a banner is being rendered in. The subscription builder has no
 *  cart, so "Your cart contains…" is simply untrue there. */
export type FloorContext = "cart" | "subscription";

/** The banner. Shown BEFORE the date is chosen — the date is never moved
 *  silently, so the customer learns the constraint while they can still act
 *  on it. */
export function cartOpenDaysMessage(
  cart: CartOpenDays,
  context: FloorContext = "cart",
  now: Date = new Date(),
): string | null {
  if (!cart.set.restricted) return null;
  const phrase = formatOpenDays(cart.set, now);
  if (!phrase) return null;
  const lead =
    context === "subscription" ? "Your subscription includes" : "Your cart contains";
  const verb = context === "subscription" ? "deliveries are" : "delivery is";
  return `${lead} ${joinList(cart.names)}, so ${verb} ${phrase}.`;
}

/** The dead end, and the one case R2 singles out: the lines in this order
 *  have NO day in common, so there is no date to offer and the calendar must
 *  not simply come up empty — an empty calendar reads as a loading failure
 *  and the customer refreshes rather than splitting the order.
 *
 *  Reachable in two ways. Either a product's finite schedule is exhausted, or
 *  two products' schedules genuinely do not meet — a one-day-only special
 *  plus a loaf that is not baked that day. Neither is the shape any of the
 *  six current products use, all of which end in a ray, so today this
 *  returns null; it is here because the moment a product is given open days
 *  without an `available_from` it becomes reachable, and the failure would
 *  otherwise be a blank month. */
export function noDeliveryDayMessage(
  cart: CartOpenDays,
  windowDays: number = 30,
  now: Date = new Date(),
): string | null {
  if (!cart.set.restricted) return null;
  if (deliverableDates(cart.set, windowDays, now).length > 0) return null;
  const names = joinList(cart.names);
  if (cart.names.length > 1) {
    return `${names} aren't baked on any of the same days in the next ${windowDays} days. Please order them separately.`;
  }
  return `${names} has no delivery day left in the next ${windowDays} days. Please remove it, or call us and we'll sort it out.`;
}

/** The escape hatch, shown only for a MIXED selection. A customer who wanted
 *  a plain loaf tomorrow and is silently pushed six days out is a lost sale;
 *  for a selection that is entirely restricted this sentence would be a lie,
 *  hence the `mixed` gate inside `datesOpenedByDropping`.
 *
 *  Names the dates when there are one or two of them, because "Tue 14 and
 *  Wed 15 Oct" is something a customer can weigh against the loaf. Past that
 *  it says "the earlier dates": a list of six is not read, and this sentence
 *  has to survive a schedule nobody has thought of yet. */
export function cartOpenDaysEscapeHint(
  cart: CartOpenDays,
  windowDays: number = 30,
  now: Date = new Date(),
): string | null {
  const opened = datesOpenedByDropping(cart, windowDays, now);
  if (opened.length === 0) return null;
  const what =
    opened.length <= 2
      ? joinList(opened.map(formatFloorMedium))
      : "the earlier dates";
  return `Remove ${joinList(cart.names)} to open up ${what}.`;
}

/** The per-cell note in a date picker, for a day that IS closed. Null when
 *  the day is fine.
 *
 *  NAMES THE LOAF. A greyed cell with no explanation is the failure R2 calls
 *  out: the customer cannot tell a day the kitchen is shut from a day the
 *  lead time has taken, and has no way to know which of three loaves in the
 *  basket did it. */
export function closedDayNote(
  rows: AvailabilityRow[],
  iso: string,
  now: Date = new Date(),
): string | null {
  const names = closedBy(rows, iso, now);
  if (names.length === 0) return null;
  return `We're not baking ${joinList(names)} on this day.`;
}

/** The server's rejection message. Reaches Android customers verbatim via
 *  `ApiError.message`, so it must read as finished copy, not a diagnostic.
 *
 *  Deliberately NOT built from `formatOpenDays`, which narrows to what is
 *  still bookable: this sentence answers "why was the date I sent refused",
 *  and the honest answer is the KITCHEN's schedule. A customer told "we bake
 *  it Thu 16 Oct" who then cannot select the 16th because of the lead time
 *  gets a second, different and accurate error from the slot validator. */
export function preorderFloorError(
  cart: CartOpenDays,
  now: Date = new Date(),
): string {
  const names = joinList(cart.names);
  if (!cart.set.restricted) {
    return `${names} cannot be delivered on that date. Please pick another day.`;
  }
  const dayPhrases = cart.set.days.map(formatFloorMedium);
  const rayPhrase =
    cart.set.from !== null
      ? `daily from ${formatFloorMedium(cart.set.from)}`
      : null;
  const parts = [...dayPhrases, ...(rayPhrase ? [rayPhrase] : [])];
  if (parts.length === 0) {
    return `We have no baking day left for ${names}. Please remove it from this order, or call us and we'll sort it out.`;
  }
  return `We bake ${names} on ${joinList(parts)}. Please pick one of those days for this order.`;
}
