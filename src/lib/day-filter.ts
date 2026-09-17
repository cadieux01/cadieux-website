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
