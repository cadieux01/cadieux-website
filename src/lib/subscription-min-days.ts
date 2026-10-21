// Subscription minimum-days rule — the SINGLE SOURCE OF TRUTH for the
// "a subscription must span at least N distinct weekdays" invariant.
//
// Rationale: a subscription is multi-day by definition. A customer wanting
// fewer delivery days than this is placing one-time orders, not subscribing
// — the 10% subscription discount only ever applies when this rule is met
// (enforcement lives at the server insert boundary; there is no per-day
// discount arithmetic to change because `subscriptionUnitPrice` is invoked
// ONLY on subscription writes and those writes are now gated below).
//
// NEW SUBSCRIPTIONS ONLY. Existing rows are never re-validated against this
// rule, deliberately: when the minimum went 2 → 4 (Raja, 21 Oct 2026) there
// were live plans running on two days, and a rule applied retroactively
// would have cancelled deliveries customers had already paid for. Nothing
// outside the three creation paths below may call `hasMinSubscriptionDays`
// — in particular NOT delivery generation, NOT reactivation, NOT the admin
// PATCH. A plan below the current minimum is grandfathered, not broken.
//
// The three server creation paths that MUST call this before writing:
//   • POST /api/checkout             (action="place_subscription")
//   • POST /api/mobile/subscriptions (pattern + calendar + multi-variant)
//   • POST /api/admin/subscriptions/create
//
// Client wizards (web + mobile) should also gate their "Next" / submit
// buttons with `hasMinSubscriptionDays` so the customer sees the reason
// before the network round-trip. The server rejection is the real gate.

import { MIN_ONE_TIME_UNITS } from "@/lib/order-minimum";
import { DAY_KEYS, type DayKey } from "@/lib/subscription-dates";

/** Minimum number of DISTINCT weekdays a subscription must cover. */
export const MIN_SUBSCRIPTION_DAYS_PER_WEEK = 4;

/** Stable error code for API responses — clients may branch on this
 *  to render a tailored message instead of the raw `.error` string. */
export const MIN_DAYS_ERROR_CODE = "min_days_per_week";

/**
 * Customer-facing rejection message, served by all five server gates and
 * reused as the wizard's inline hint so there is exactly one wording.
 *
 * BOTH NUMBERS ARE INTERPOLATED, and the second one is imported rather
 * than typed: this sentence names the one-time floor as the alternative, so
 * a literal here would silently start lying the day `MIN_ONE_TIME_UNITS`
 * moves. A test pins the rendered string, so changing either constant fails
 * loudly instead of shipping stale copy.
 *
 * "Add more days" rather than "add one more": at a minimum of 4 the
 * shortfall can be three, so the old phrasing stopped being true.
 *
 * "one-time deliveries", not "one-time orders": pickup is EXEMPT from the
 * item floor (order-minimum.ts — Raja, 20 Oct 2026), so promising that
 * every one-time order needs two items would be wrong at the counter.
 *
 * Rendered VERBATIM on Android — `MIN_DAYS_ERROR_CODE` is not a code the
 * app branches on, so it falls through to the generic handler and this
 * sentence is the entire explanation the customer gets. It must stand alone.
 */
export const MIN_DAYS_ERROR_MESSAGE =
  `A subscription needs at least ${MIN_SUBSCRIPTION_DAYS_PER_WEEK} delivery days per week. Add more days, or place a one-time order instead — one-time deliveries need at least ${MIN_ONE_TIME_UNITS} items.`;

/** True when `dayKeys` covers ≥ MIN_SUBSCRIPTION_DAYS_PER_WEEK distinct
 *  weekdays. Invalid entries are ignored (matches how the checkout
 *  routes filter `dayKeys` down to `DAY_KEYS`). */
export function hasMinSubscriptionDays(
  dayKeys: readonly string[] | null | undefined,
): boolean {
  if (!Array.isArray(dayKeys)) return false;
  const distinct = new Set<DayKey>();
  for (const raw of dayKeys) {
    const key = String(raw).toLowerCase();
    if ((DAY_KEYS as readonly string[]).includes(key)) {
      distinct.add(key as DayKey);
    }
  }
  return distinct.size >= MIN_SUBSCRIPTION_DAYS_PER_WEEK;
}

/** Count of distinct valid weekdays across a set of ISO yyyy-mm-dd
 *  dates. Used by the wizard's Next-button gate on the calendar step so we
 *  can enforce MIN_SUBSCRIPTION_DAYS_PER_WEEK different weekdays regardless
 *  of how many individual dates the customer has picked. Returns the COUNT,
 *  not a verdict, because the wizard renders "n of N required". */
export function distinctWeekdaysFromDates(
  dates: readonly string[] | null | undefined,
): number {
  if (!Array.isArray(dates)) return 0;
  const distinct = new Set<number>();
  for (const iso of dates) {
    if (typeof iso !== "string") continue;
    // yyyy-mm-dd → local Date (mirrors parseLocalDate in mobile route)
    const parts = iso.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) continue;
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    if (Number.isNaN(d.getTime())) continue;
    distinct.add(d.getDay()); // JS getDay: 0=Sun..6=Sat, weekday identity only
  }
  return distinct.size;
}
