// When does a subscription plan end? ONE rule, and it had two
// implementations reading two different database columns.
//
// THE RULE:
//   the latest date any of the plan's delivery rows lands on
//   └─ fallback, ONLY for a plan with no delivery rows at all:
//      created_at + weeks × 7d
//
// WHY THIS FILE EXISTS. The rule was written twice — once in
// src/lib/cron/subscription-reminders-phase.ts (which decides when the
// "your plan is ending" emails go out) and once in
// src/lib/admin-subscription-derive.ts (which produces derived_end_date
// for the admin board's "expiring in 7 days" filter). The two copies read
// DIFFERENT columns for the fallback: `weeks` and `total_weeks`
// respectively. Nothing in the database makes those two agree, so the
// board and the email could have disagreed about the same plan while both
// looked right in isolation. They never did diverge — but only because
// every insert site happens to mirror the two by hand.
//
// AND THE FORK WAS IN THE ERROR PATH, which is the worst place for it.
// The fallback only runs for a subscription with zero delivery rows, and
// insertMultiVariantSubscription (src/lib/subscription-checkout.ts) is
// three separate inserts with NO enclosing transaction — parent first,
// deliveries third. So a plan with no deliveries is what a half-failed
// write leaves behind. Prod has 0 such rows out of 101 today, meaning
// these lines have never executed; a divergence would therefore have
// first appeared on the day something else already went wrong.
//
// ─────────────────────────────────────────────────────────────────────
// WHICH WEEKS COLUMN IS AUTHORITATIVE: `weeks`.
//
// `subscriptions` carries two integer week counts and no constraint ties
// them together.
//
//   • `weeks` — the original column (src/lib/database.sql). THE SOURCE OF
//     TRUTH, because it is the one we cannot stop writing: the Android app
//     reads it and installed builds cannot be patched. `SubscriptionListItem
//     .weeks` is NON-optional and three screens render
//     `weeks > 0 ? "N weeks" : "Custom dates"`, so even the 0 is
//     load-bearing UI (0 marks a calendar-mode plan — see
//     api/mobile/subscriptions). The app contains zero references to
//     `total_weeks`.
//
//   • `total_weeks` — added later by sql/subscription-tracking.sql for the
//     per-week tracking model. A WRITE-TIME MIRROR: every insert site sets
//     both fields from the same single variable, and no UPDATE anywhere can
//     move one without the other (the only dynamic one,
//     api/admin/subscriptions/[id] PATCH, is allow-listed to status /
//     payment_status / updated_at). It is read by the website and admin for
//     DISPLAY — which is fine, because those surfaces are patchable.
//
// Neither column is vestigial, so neither can simply be deleted. What was
// removable is the second independent READ of them for the same
// derivation, which is what planWeeks() below collapses.

import { addDaysISO } from "@/lib/admin-formatting";

/** Whichever week columns the caller's projection happened to include. */
export type PlanWeeksFacts = {
  weeks?: number | null;
  total_weeks?: number | null;
};

/**
 * The week columns for a `subscriptions` INSERT — the mirror derived from
 * the source rather than typed out beside it.
 *
 * Every insert site previously wrote `weeks` and `total_weeks` as two
 * separate properties from the same local variable, twenty-five lines
 * apart in the same object literal. That is how the two columns have
 * stayed equal across 101 rows, and it is also the only thing keeping them
 * equal: a fourth insert site, or an edit that touches one line and not
 * the other, silently forks the data. There is no CHECK constraint and no
 * trigger. Spreading this makes the mirror impossible to forget.
 *
 * Pass the plan's week count, or 0 for a calendar-mode plan whose dates
 * were picked individually — the app renders 0 as "Custom dates".
 */
export function weekColumns(weeks: number): {
  weeks: number;
  total_weeks: number;
} {
  return { weeks, total_weeks: weeks };
}

/**
 * The plan's week count, or null when it cannot drive a date.
 *
 * Reads the authoritative `weeks`. It consults the `total_weeks` mirror
 * ONLY when `weeks` is absent from the projection — `undefined`, not
 * `null`. That distinction is the whole point: a row that genuinely has no
 * week count must not silently fall through to the other column and get a
 * different answer, but a route that selected only the mirror still works.
 *
 * ZERO AND NEGATIVE ARE null, NOT A DATE. `weeks = 0` marks a
 * calendar-mode plan whose dates were picked individually; created_at + 0
 * would declare such a plan to have ended the day it was bought. Both
 * original copies guarded this and both guards are preserved here.
 */
export function planWeeks(sub: PlanWeeksFacts): number | null {
  const n = sub.weeks === undefined ? sub.total_weeks : sub.weeks;
  if (typeof n !== "number" || !Number.isFinite(n) || n <= 0) return null;
  return n;
}

/** The two date columns a delivery row carries. */
export type PlanDelivery = {
  delivery_date?: string | null;
  scheduled_date?: string | null;
};

/**
 * The date a stop ACTUALLY lands on.
 *
 * `scheduled_date` is the admin-editable copy and it wins. Reading the raw
 * `delivery_date` instead puts a rescheduled stop under its ORIGINAL date
 * while every other surface — the row itself, the board's day filter, the
 * next-delivery pick — shows the new one.
 *
 * This is the precedence the rest of admin-subscription-derive.ts already
 * documented and used; the end-date accumulator was the one place that
 * read the raw column, and it disagreed with the comment eight lines below
 * it. Live example: OLS36 has a stop moved from 2026-09-23 to 2026-09-21,
 * so its derived_end_date read two days late.
 */
export function effectiveDeliveryDate(row: PlanDelivery): string | null {
  return row.scheduled_date ?? row.delivery_date ?? null;
}

/**
 * Resolve the plan's end date.
 *
 * `lastDeliveryDate` is MAX(effectiveDeliveryDate) over the plan's
 * delivery rows, or null/undefined when it has none. Callers accumulate it
 * themselves because they stream deliveries for many plans at once.
 *
 * CANCELLED STOPS ARE INCLUDED in that max, and that is deliberately
 * UNCHANGED here. Excluding them is arguable — `delivery_dates` and
 * `remaining_deliveries` both treat cancelled as gone — but it is a
 * product decision with real blast radius, not a tidy-up: 27 of 101 live
 * plans have a cancelled last stop, and 23 have every stop cancelled,
 * which would push them onto the weeks fallback and change when the
 * ending-soon emails fire. It does not belong in a commit about
 * de-duplicating a rule.
 */
export function resolveEndDate(
  sub: PlanWeeksFacts & { created_at: string },
  lastDeliveryDate: string | null | undefined,
): string | null {
  if (lastDeliveryDate) return lastDeliveryDate;
  const weeks = planWeeks(sub);
  if (weeks === null) return null;
  return addDaysISO(sub.created_at.slice(0, 10), weeks * 7);
}
