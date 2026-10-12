// ONE DAY. The admin boards filter by a single calendar date, not a range.
//
// This module is the whole of that decision: which column the date is read
// from (the basis), how a stored value is reduced to an IST calendar day,
// and the membership test. Four surfaces import it — the orders board, the
// packing list it links to, the subscriptions board, and the production
// strip that sits under the orders table — because the one thing this
// filter must never do is mean different things on the screen and on the
// sheet that walks into the kitchen. That has happened: the print view once
// listed 60 orders while the screen showed 9.
//
// WHY A DAY AND NOT A RANGE. The previous control was From + To. A range
// carries state a single day does not: which end is which, what to do when
// they are reversed, what a half-filled pair means, and a preset menu whose
// label can disagree with the boxes under it. Every operational question
// asked on these boards — what do we bake, what do we route, who do we call
// — is asked about ONE day. The range existed to answer a question nobody
// was asking, and cost four kinds of ambiguity to do it.

import { istIsoDate } from "@/lib/delivery-slots";

// ---------------------------------------------------------------------------
// Basis — WHICH column the day applies to
//
// Moved here from order-filter.ts, which now owns only the status predicate.
// The basis and the day are one decision and belong in one file: reading the
// right column on the wrong day and the wrong column on the right day are
// the same bug, and both boards plus the packing list have to agree.
// ---------------------------------------------------------------------------

export type DateBasis = "delivery" | "order";

/** The default everywhere. Baking, routing and calling are all decided on
 *  the delivery date; the order date is a bookkeeping fact. Sunny verified
 *  in prod that the 12h booking lead makes these two sets barely intersect
 *  — 20 placed, 27 being delivered, zero overlap on the same day — so
 *  defaulting to the wrong one is not a near miss, it is a different list. */
export const DEFAULT_BASIS: DateBasis = "delivery";

/** Narrow an untrusted `?basis=`, falling back to the default so an older
 *  link that predates the param shows what today's screen shows. */
export function parseBasis(raw: string | null | undefined): DateBasis {
  return raw === "delivery" || raw === "order" ? raw : DEFAULT_BASIS;
}

// ---------------------------------------------------------------------------
// The day itself
// ---------------------------------------------------------------------------

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Is this a real calendar date, and not merely digits in the right shape?
 *
 * `YMD_RE` alone accepts "2026-13-45". The round-trip through `Date.UTC`
 * rejects it. UTC is used deliberately and is safe HERE precisely because
 * nothing is read back except the same UTC fields that went in — this is a
 * validity check, never a conversion, and it cannot shift a day.
 */
function isRealYmd(s: string): boolean {
  if (!YMD_RE.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

/** Narrow an untrusted `?date=`. Anything that is not a real YYYY-MM-DD —
 *  absent, malformed, or 2026-02-31 — means NO day filter, which shows all
 *  rows. A bad link must never silently show a different day. */
export function parseDayParam(raw: string | null | undefined): string | null {
  return raw && isRealYmd(raw) ? raw : null;
}

/**
 * Reduce a stored value to the IST calendar day it belongs to.
 *
 * ⚠️ THE TRAP THIS EXISTS TO AVOID. `new Date("2026-09-20")` is parsed as
 * UTC midnight, which is 05:30 IST — so any comparison built on it silently
 * drops the first five and a half hours of the Indian day. `created_at` is a
 * UTC timestamp, and orders ARE placed between midnight and 05:30 IST; under
 * the naive parse (or under `created_at.slice(0, 10)`, which is the same
 * mistake wearing a different hat) those orders report the PREVIOUS day and
 * vanish from the sheet for the day they were actually placed.
 *
 * Two shapes arrive here and they must be treated differently:
 *
 *   • `delivery_date` is a DATE column — "2026-09-20" is already an IST
 *     calendar day. It is returned verbatim. Putting it through a Date at
 *     all would re-introduce exactly the shift described above.
 *   • `created_at` is a TIMESTAMP — it is converted through Asia/Kolkata,
 *     so 2026-09-19T23:00:00Z becomes "2026-09-20" (04:30 IST), which is
 *     the day the customer experienced.
 */
export function toIstDay(value: string | null | undefined): string | null {
  if (!value) return null;
  // Already a calendar date. Return it untouched — see above.
  if (YMD_RE.test(value)) return value;
  const t = new Date(value);
  if (Number.isNaN(t.getTime())) return null;
  return istIsoDate(t);
}

/**
 * Does this row's date fall on the selected day?
 *
 * A null `day` means no day is selected, which shows everything — that is
 * what the Clear affordance produces. A row with no value on the chosen
 * basis drops out whenever a day IS selected: a row with no delivery_date
 * has nothing to deliver on the operator's chosen day.
 */
export function matchesDay(
  value: string | null | undefined,
  day: string | null,
): boolean {
  if (!day) return true;
  return toIstDay(value) === day;
}

/** The subscriptions form: a plan has many delivery dates and matches the
 *  day if ANY of them lands on it. Same null-day semantics. */
export function matchesAnyDay(
  values: readonly (string | null | undefined)[] | null | undefined,
  day: string | null,
): boolean {
  if (!day) return true;
  return (values ?? []).some((v) => toIstDay(v) === day);
}

// ---------------------------------------------------------------------------
// Per-board basis resolvers
// ---------------------------------------------------------------------------

/** The fields the orders basis selector reads. */
export type DatedOrder = {
  created_at: string;
  delivery_date?: string | null;
};

/** The column the day is applied to on the orders board and its packing list. */
export function orderDateForBasis(
  o: DatedOrder,
  basis: DateBasis,
): string | null | undefined {
  return basis === "delivery" ? o.delivery_date : o.created_at;
}

/** The fields the subscriptions basis selector reads. */
export type DatedSubscription = {
  created_at: string;
  /** Every still-meaningful delivery date on the plan, IST calendar dates.
   *  Server-computed; see buildDerivations. */
  delivery_dates?: string[] | null;
};

/**
 * The dates the day is matched against on the subscriptions board.
 *
 * A subscription is not one delivery, so "delivering on 20 Sep" is a
 * question about a SET. Returning the whole set — rather than, say,
 * `next_delivery` — is the difference between a correct sheet and a
 * plausible one: a plan that delivers on the 18th and the 20th has a
 * `next_delivery` of the 18th and would disappear from the 20th entirely.
 */
export function subscriptionDatesForBasis(
  s: DatedSubscription,
  basis: DateBasis,
): (string | null | undefined)[] {
  return basis === "delivery" ? s.delivery_dates ?? [] : [s.created_at];
}

// ---------------------------------------------------------------------------
// Optional range — OPT-IN. The single day above remains the default.
//
// Read the header of this file first: From+To was REMOVED from these boards on
// purpose, because every question asked on them is asked about ONE day, and a
// range brought four kinds of ambiguity to answer a question nobody had. None
// of that is retracted. The orders and subscriptions boards pass no selection
// type at all and keep exactly today's behaviour — `matchesDay` and
// `matchesAnyDay` are untouched and still the only thing those boards call.
//
// What changed is that a caller appeared with the question a range does answer:
// a delivery partner planning a run across several days. That screen opts in.
// The four ambiguities are closed here rather than reintroduced:
//   • which end is which — named `from`/`to`, never positional;
//   • a reversed pair    — normalised once here, not at each call site;
//   • a half-filled pair — an open end means unbounded on that side, stated;
//   • a preset label contradicting the boxes — see "Duration presets" below,
//     where the label IS the only input and no boxes exist to disagree with.
//
// If a third caller wants this, make it opt in too. Do NOT flip the default:
// the moment the kitchen sheet can span days it can disagree with the screen
// again, which is the 60-orders-vs-9 failure the header records.
// ---------------------------------------------------------------------------

/** A single day, or a bounded / half-open range. */
export type DaySelection =
  | { mode: "day"; day: string | null }
  | { mode: "range"; from: string | null; to: string | null };

/** The selection that shows every row. */
export const ALL_DAYS: DaySelection = { mode: "day", day: null };

/** Narrow an untrusted `?from=`/`?to=` pair exactly as `parseDayParam`
 *  narrows a single date: anything that is not a real YYYY-MM-DD becomes an
 *  OPEN end — never an error, never silently "today". */
export function parseRangeParams(
  rawFrom: string | null | undefined,
  rawTo: string | null | undefined,
): { from: string | null; to: string | null } {
  return { from: parseDayParam(rawFrom), to: parseDayParam(rawTo) };
}

/**
 * Put a range the right way round.
 *
 * A reversed pair is the operator's likeliest slip and was the old control's
 * worst behaviour: it matched nothing, which looks identical to a real day
 * with no deliveries. Swapping is the only reading that is never wrong —
 * both ends were chosen deliberately, only their order was not.
 */
export function normaliseRange(
  from: string | null,
  to: string | null,
): { from: string | null; to: string | null } {
  if (from && to && from > to) return { from: to, to: from };
  return { from, to };
}

/** Does one date value satisfy the selection? Mirrors `matchesDay` in day
 *  mode, so switching modes cannot change what the day case means. */
export function matchesSelection(
  value: string | null | undefined,
  sel: DaySelection,
): boolean {
  if (sel.mode === "day") return matchesDay(value, sel.day);
  const { from, to } = normaliseRange(sel.from, sel.to);
  if (!from && !to) return true;
  const d = toIstDay(value);
  // A row with no date drops out as soon as a bound is set — the same rule
  // matchesDay applies: nothing to deliver inside a window you can't place
  // it in. Comparison is lexicographic, which is exact for YYYY-MM-DD.
  if (!d) return false;
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

/** The subscriptions form: a plan matches if ANY of its dates does. */
export function matchesAnySelection(
  values: readonly (string | null | undefined)[] | null | undefined,
  sel: DaySelection,
): boolean {
  if (sel.mode === "day") return matchesAnyDay(values, sel.day);
  return (values ?? []).some((v) => matchesSelection(v, sel));
}

/**
 * Every IST day the selection admits, for bucketing per-date maps such as
 * `loaf_counts_by_date`.
 *
 * Returns null when the selection is unbounded on either side — the caller
 * must then take every key rather than try to enumerate an open interval.
 */
export function selectionDays(sel: DaySelection): string[] | null {
  if (sel.mode === "day") return sel.day ? [sel.day] : null;
  const { from, to } = normaliseRange(sel.from, sel.to);
  if (!from || !to) return null;

  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  const cur = new Date(Date.UTC(fy, fm - 1, fd));
  const end = Date.UTC(ty, tm - 1, td);

  // UTC throughout and only the same fields are read back out, so this
  // cannot shift a day — the same reason isRealYmd's round-trip is safe.
  // The iteration cap is a guard against a pathological span, not a limit
  // anyone should hit: a year of routing is 365.
  const out: string[] = [];
  for (let i = 0; cur.getTime() <= end && i < 400; i += 1) {
    out.push(
      `${cur.getUTCFullYear()}-${String(cur.getUTCMonth() + 1).padStart(2, "0")}-${String(cur.getUTCDate()).padStart(2, "0")}`,
    );
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Duration presets — WHY THESE ARE ALLOWED WHERE A RANGE WAS NOT
//
// The header above retired From + To for four ambiguities. A preset gives
// back the one thing a range was wanted for — "how did this week go" — and
// pays none of them:
//   • which end is which   — the caller never types an end; both are derived;
//   • a reversed pair      — unreachable, `from` is computed before `to`;
//   • a half-filled pair   — unreachable, both ends always come together;
//   • a label contradicting the boxes — THE LABEL IS THE ONLY INPUT. There
//     are no boxes. "This week" cannot disagree with itself.
//
// So this is deliberately NOT the range control returning under a new name.
// It is two named windows, each with exactly one way to be expressed.
//
// The preset is still OPT-IN per surface, for the reason the header gives:
// the kitchen sheet and the screen must not be able to disagree, which is
// the 60-orders-vs-9 failure. A span belongs on a board someone is reading;
// it does not belong on a sheet someone is packing from.
// ---------------------------------------------------------------------------

/** A whole period, named. Not a range — see the block above. */
export type DurationPreset = "week" | "month";

/** Narrow an untrusted `?span=`. Anything else is "no preset", never an
 *  error and never silently "this week". */
export function parseSpanParam(
  raw: string | null | undefined,
): DurationPreset | null {
  return raw === "week" || raw === "month" ? raw : null;
}

/** The button text, and the only input the operator gives. */
export function spanLabel(preset: DurationPreset): string {
  return preset === "week" ? "This week" : "This month";
}

function ymdToUtc(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function utcToYmd(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Expand a preset into the range it names.
 *
 * ORDER MATTERS AND IT IS THE 05:30 TRAP. The IST calendar day is
 * established FIRST, by `istIsoDate` — the same function every other date
 * in this module goes through — and only then is calendar arithmetic done,
 * in UTC, on those Y-M-D fields. Doing it the other way round (add days to
 * a UTC instant, then convert) puts the boundary 5h30m out: between 00:00
 * and 05:30 IST it would compute last week.
 *
 * Weeks start MONDAY, because the bakery's does. `getUTCDay()` calls Sunday
 * 0, so the offset back to Monday is `(day + 6) % 7`, which maps Sunday to
 * 6 rather than to -1.
 *
 * `Date.UTC(y, m, 0)` is the last day of month `m - 1`, so February, the
 * 30-day months and leap years all fall out with no special case.
 */
export function presetSelection(
  preset: DurationPreset,
  now: Date = new Date(),
): DaySelection {
  const today = istIsoDate(now);
  if (preset === "week") {
    const start = ymdToUtc(today);
    start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);
    return { mode: "range", from: utcToYmd(start), to: utcToYmd(end) };
  }
  const [y, m] = today.split("-").map(Number);
  return {
    mode: "range",
    from: utcToYmd(new Date(Date.UTC(y, m - 1, 1))),
    to: utcToYmd(new Date(Date.UTC(y, m, 0))),
  };
}

/**
 * The one place a board turns its two URL params into a selection.
 *
 * THE DAY WINS. If a link somehow carries both `?day=` and `?span=`, the
 * narrower, explicitly-typed one is honoured and the span is ignored. The
 * alternative — showing a month because a stale param rode along — is the
 * failure this module exists to prevent, and it would be silent. The UI
 * also clears one when the other is set, so both arriving together means a
 * hand-edited or stale URL, and the safe reading of that is the day.
 */
export function boardSelection(
  span: DurationPreset | null,
  day: string | null,
  now: Date = new Date(),
): DaySelection {
  if (day) return { mode: "day", day };
  return span ? presetSelection(span, now) : ALL_DAYS;
}
