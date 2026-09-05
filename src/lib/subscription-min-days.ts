// Subscription minimum-days rule — the SINGLE SOURCE OF TRUTH for the
// "a subscription must span at least N distinct weekdays" invariant.
//
// Rationale: a subscription is multi-day by definition. If a customer
// only wants one delivery day, that is a single order at full price,
// not a subscription — the 10% subscription discount only ever applies
// when this rule is met (enforcement lives at the server insert
// boundary; there is no per-day discount arithmetic to change because
// `subscriptionUnitPrice` is invoked ONLY on subscription writes and
// those writes are now gated below).
//
// Existing subscriptions in the database are untouched — this rule is
// enforced at creation time only.
//
// The three server creation paths that MUST call this before writing:
//   • POST /api/checkout             (action="place_subscription")
//   • POST /api/mobile/subscriptions (pattern + calendar + multi-variant)
//   • POST /api/admin/subscriptions/create
//
// Client wizards (web + mobile) should also gate their "Next" / submit
// buttons with `hasMinSubscriptionDays` so the customer sees the reason
// before the network round-trip. The server rejection is the real gate.

import { DAY_KEYS, type DayKey } from "@/lib/subscription-dates";

/** Minimum number of DISTINCT weekdays a subscription must cover. */
export const MIN_SUBSCRIPTION_DAYS_PER_WEEK = 2;

/** Stable error code for API responses — clients may branch on this
 *  to render a tailored message instead of the raw `.error` string. */
export const MIN_DAYS_ERROR_CODE = "min_days_per_week";

/** Customer-facing rejection message. Kept short + explicit about the
 *  alternative so the same text can appear in server 400 payloads and
 *  in the wizard's inline hint. */
export const MIN_DAYS_ERROR_MESSAGE =
  "A subscription needs at least 2 delivery days per week. For a single day, place a one-time order instead.";

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
 *  dates. Used by the wizard's Next-button gate on the calendar step
 *  so we can enforce ≥2 different weekdays regardless of how many
 *  individual dates the customer has picked. */
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
