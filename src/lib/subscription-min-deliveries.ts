// Subscription minimum-deliveries rule — the SINGLE SOURCE OF TRUTH for the
// "a subscription must schedule at least N deliveries in total" invariant.
//
// Rationale: a subscription is a commitment to repeat deliveries. A customer
// wanting fewer deliveries than this is placing one-time orders, not
// subscribing — the 10% subscription discount only ever applies when this
// rule is met (enforcement lives at the server insert boundary; there is no
// per-delivery discount arithmetic to change because `subscriptionUnitPrice`
// is invoked ONLY on subscription writes and those writes are gated below).
//
// WHAT CHANGED (Raja, 27 Oct 2026): the rule used to be "at least 4 distinct
// weekdays PER WEEK", which refused a plan that delivers once a week for a
// month — a perfectly good subscription worth more than four days in a single
// week. The rule is now a TOTAL across the whole plan:
//
//     (delivery days per week) x (weeks) >= MIN_SUBSCRIPTION_DELIVERIES
//
// So 1x4, 2x2 and 4x1 all pass; 1x3 does not. The old constant name said
// "per week" while the gate it fed was about to stop meaning that, which is
// the same class of bug as `delivery_fee`, `AvailabilityRow` and
// `fulfillment_type` — the name is now `MIN_SUBSCRIPTION_DELIVERIES` and it
// names a total, not a weekly rate.
//
// NEW SUBSCRIPTIONS ONLY. Existing rows are never re-validated against this
// rule, deliberately: there are live plans that predate every revision of
// this minimum, and a rule applied retroactively would cancel deliveries
// customers have already paid for. Nothing outside the creation paths below
// may call these helpers — in particular NOT delivery generation, NOT
// reactivation, NOT the admin PATCH. A plan below the current minimum is
// grandfathered, not broken.
//
// The server creation paths that MUST gate before writing:
//   • POST /api/checkout             (action="place_subscription")
//   • POST /api/mobile/subscriptions (pattern + calendar + multi-variant)
//   • POST /api/admin/subscriptions/create
//
// Client wizards (web + mobile) should also gate their "Next" / submit
// buttons so the customer sees the reason before the network round-trip.
// The server rejection is the real gate.
//
// COUNTING, AND WHY THERE ARE TWO ENTRY POINTS. Every creation path produces
// one of two shapes, and the honest total differs between them:
//
//   • PATTERN shape — {days, weeks}, expanded server-side into deliveries.
//     Total = distinct valid weekdays x weeks. Use `patternDeliveryCount`.
//
//   • EXPLICIT-DATE shape — the customer picked individual dates (the web
//     wizard's calendar, the mobile calendar mode, the admin per-date form).
//     Total = how many dates they picked. Use that length directly.
//
// Multiplying days x weeks on an explicit-date plan OVER-COUNTS and is a
// hole: a plan of {Mon of week 1, Tue of week 2} has 2 distinct weekdays and
// 2 distinct week numbers, so the product is 4 — it would pass a 4-delivery
// minimum while scheduling two deliveries. Always count the rows when the
// rows exist. `hasMinSubscriptionDeliveries` therefore takes a COUNT, not a
// plan, so the call site is forced to say which total it means.

import { MIN_ONE_TIME_UNITS } from "@/lib/order-minimum";
import { DAY_KEYS, type DayKey } from "@/lib/subscription-dates";

/**
 * Minimum number of deliveries a new subscription must schedule IN TOTAL,
 * across the whole plan — not per week.
 */
export const MIN_SUBSCRIPTION_DELIVERIES = 4;

/** Stable error code for API responses — clients may branch on this
 *  to render a tailored message instead of the raw `.error` string.
 *
 *  Renamed with the rule: the old value `min_days_per_week` described a
 *  weekly rate this gate no longer enforces. Safe to change because nothing
 *  branches on it — neither the website nor the Android app reads this code
 *  (verified by grep across both repos, 27 Oct 2026); the app falls through
 *  to its generic handler and renders `.error` verbatim. */
export const MIN_DELIVERIES_ERROR_CODE = "min_subscription_deliveries";

/**
 * Customer-facing rejection message, served by every server gate and reused
 * as the wizard's inline hint so there is exactly one wording.
 *
 * NO BARE DIGIT APPEARS IN THIS PROSE. Both numbers are interpolated, and
 * the second is imported rather than typed, so grepping either constant
 * finds every place its number is shown to a customer. A literal here would
 * silently start lying the day a constant moves. A test reads this module's
 * own source and fails if a digit appears outside an interpolation.
 *
 * "deliveries in total" and "across any mix of days and weeks" are the whole
 * point of the wording: the previous sentence said "per week", which told a
 * customer who wanted one delivery a week for a month that their plan was
 * invalid when it now is not. The sentence must state the dimension being
 * measured, because the shortfall can be fixed by adding days OR weeks.
 *
 * "one-time deliveries", not "one-time orders": pickup is EXEMPT from the
 * item floor (order-minimum.ts — Raja, 20 Oct 2026), so promising that every
 * one-time order needs two items would be wrong at the counter.
 *
 * Rendered VERBATIM on Android — `MIN_DELIVERIES_ERROR_CODE` is not a code
 * the app branches on, so this sentence is the entire explanation the
 * customer gets. It must stand alone.
 */
export const MIN_DELIVERIES_ERROR_MESSAGE =
  `A subscription needs at least ${MIN_SUBSCRIPTION_DELIVERIES} deliveries in total, across any mix of days and weeks. Add more delivery days or more weeks, or place a one-time order instead — one-time deliveries need at least ${MIN_ONE_TIME_UNITS} items.`;

/**
 * Count of distinct valid weekdays in `dayKeys`. Invalid entries are ignored
 * (matches how the checkout routes filter `dayKeys` down to `DAY_KEYS`).
 * Exported because the wizards render "n of N" and because
 * `patternDeliveryCount` is defined in terms of it.
 */
export function distinctDayCount(
  dayKeys: readonly string[] | null | undefined,
): number {
  if (!Array.isArray(dayKeys)) return 0;
  const distinct = new Set<DayKey>();
  for (const raw of dayKeys) {
    const key = String(raw).toLowerCase();
    if ((DAY_KEYS as readonly string[]).includes(key)) {
      distinct.add(key as DayKey);
    }
  }
  return distinct.size;
}

/**
 * Total deliveries a PATTERN plan will schedule: distinct valid weekdays x
 * weeks. Returns 0 — i.e. fails closed — for any non-integer, non-positive
 * or non-finite `weeks`, so a missing or garbage week count can never
 * satisfy the minimum.
 *
 * Do NOT use this on an explicit-date plan; count the dates instead. See the
 * over-counting note in this file's header.
 */
export function patternDeliveryCount(
  dayKeys: readonly string[] | null | undefined,
  weeks: unknown,
): number {
  const days = distinctDayCount(dayKeys);
  if (days <= 0) return 0;
  const n = typeof weeks === "number" ? weeks : Number(weeks);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return 0;
  return days * n;
}

/**
 * The rule itself. Takes a TOTAL DELIVERY COUNT — deliberately not a plan,
 * so each call site states which of the two totals it means (see header).
 * Fails closed on anything that is not a positive finite number.
 */
export function hasMinSubscriptionDeliveries(
  totalDeliveries: unknown,
): boolean {
  const n = typeof totalDeliveries === "number" ? totalDeliveries : Number(totalDeliveries);
  if (!Number.isFinite(n)) return false;
  return n >= MIN_SUBSCRIPTION_DELIVERIES;
}

/** Count of valid ISO yyyy-mm-dd dates — the delivery total for an
 *  EXPLICIT-DATE plan. Duplicates are counted once: two deliveries cannot
 *  land on the same date, and a client that repeats one must not buy its way
 *  past the minimum with it. */
export function countDeliveryDates(
  dates: readonly string[] | null | undefined,
): number {
  if (!Array.isArray(dates)) return 0;
  const seen = new Set<string>();
  for (const iso of dates) {
    if (typeof iso !== "string") continue;
    const parts = iso.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) continue;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(d.getTime())) continue;
    seen.add(iso);
  }
  return seen.size;
}
