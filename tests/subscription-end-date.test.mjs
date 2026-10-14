// The one rule for "when does this plan end", and the two-column fork it
// replaced.
//
// `subscriptions` carries TWO integer week counts, `weeks` and
// `total_weeks`, with no CHECK constraint and no trigger tying them
// together. Two copies of the end-date rule used to read one column each:
// the reminder cron read `weeks`, the admin board read `total_weeks`. They
// have never disagreed on live data — 101 rows, 0 divergent — but only
// because three separate insert sites happened to mirror the two by hand.
//
// These tests are the thing that now holds the equality, so they assert
// the WRITE produces one value in both columns and the READ consults a
// single authority. Nothing else in the stack checks it.
//
// subscription-end-date.ts imports addDaysISO via the `@/` alias, so this
// file registers the alias hook and then dynamically imports — the static
// form would resolve the whole graph before the hook was installed.

import { test } from "node:test";
import assert from "node:assert/strict";

import "./_alias-hook.mjs";

const { planWeeks, weekColumns, effectiveDeliveryDate, resolveEndDate } =
  await import("../src/lib/subscription-end-date.ts");

// ── the write: one value, both columns ──────────────────────────────

test("weekColumns writes the SAME number to both columns", () => {
  // The invariant the database does not enforce. If this ever fails, the
  // admin board and the reminder cron are free to answer differently for
  // the same plan.
  for (const n of [1, 2, 4, 6, 12, 26]) {
    const row = weekColumns(n);
    assert.equal(row.weeks, n);
    assert.equal(row.total_weeks, n);
    assert.equal(row.weeks, row.total_weeks);
  }
});

test("weekColumns carries the calendar-mode 0 into both columns", () => {
  // 0 is not "no weeks", it is "dates were picked individually". The
  // Android app renders `weeks > 0 ? "N weeks" : "Custom dates"`, so the
  // zero must land in `weeks` specifically — installed builds read that
  // column and cannot be patched.
  assert.deepEqual(weekColumns(0), { weeks: 0, total_weeks: 0 });
});

test("weekColumns emits exactly the two week keys and nothing else", () => {
  // It is spread into an insert literal; an extra key would become an
  // unexpected column write.
  assert.deepEqual(Object.keys(weekColumns(3)).sort(), [
    "total_weeks",
    "weeks",
  ]);
});

// ── the read: one authority ─────────────────────────────────────────

test("planWeeks reads `weeks`, the authoritative column", () => {
  assert.equal(planWeeks({ weeks: 4, total_weeks: 4 }), 4);
});

test("planWeeks prefers `weeks` even when the mirror disagrees", () => {
  // Divergence is currently impossible to create, but if it ever happens
  // every surface must resolve it the SAME way rather than each picking
  // the column its own projection happened to select. `weeks` wins because
  // it is the column installed app builds read.
  assert.equal(planWeeks({ weeks: 4, total_weeks: 9 }), 4);
  assert.equal(planWeeks({ weeks: 9, total_weeks: 4 }), 9);
});

test("the mirror is used ONLY when `weeks` is absent from the projection", () => {
  // undefined means "this route did not select the column" — fall back.
  assert.equal(planWeeks({ total_weeks: 6 }), 6);
  // null means "the column was selected and it is empty" — do NOT fall
  // through to the other column and manufacture a different answer. This
  // is the distinction that keeps a legitimate fallback from becoming a
  // second fork.
  assert.equal(planWeeks({ weeks: null, total_weeks: 6 }), null);
});

test("zero and negative week counts produce no date", () => {
  // created_at + 0 would declare a calendar-mode plan to have ended on the
  // day it was bought. Both original copies guarded this.
  assert.equal(planWeeks({ weeks: 0, total_weeks: 0 }), null);
  assert.equal(planWeeks({ weeks: -1 }), null);
  assert.equal(planWeeks({}), null);
  assert.equal(planWeeks({ weeks: null, total_weeks: null }), null);
});

// ── the delivery date precedence ────────────────────────────────────

test("scheduled_date wins over delivery_date", () => {
  // OLS36 in production: a stop written for 2026-09-23 and rescheduled to
  // 2026-09-21. Reading the raw column put the plan's end two days after
  // it actually finished, while the delivery row itself showed the new
  // date — one file disagreeing with itself.
  assert.equal(
    effectiveDeliveryDate({
      delivery_date: "2026-09-23",
      scheduled_date: "2026-09-21",
    }),
    "2026-09-21",
  );
});

test("delivery_date is the fallback, and a row with neither is skippable", () => {
  assert.equal(
    effectiveDeliveryDate({ delivery_date: "2026-09-23", scheduled_date: null }),
    "2026-09-23",
  );
  assert.equal(effectiveDeliveryDate({ delivery_date: "2026-09-23" }), "2026-09-23");
  assert.equal(effectiveDeliveryDate({}), null);
  assert.equal(
    effectiveDeliveryDate({ delivery_date: null, scheduled_date: null }),
    null,
  );
});

// ── resolveEndDate: deliveries win, weeks are the safety net ────────

const SUB = { created_at: "2026-09-01T06:30:00.000Z", weeks: 2, total_weeks: 2 };

test("a plan with deliveries ends on its last one — weeks are ignored", () => {
  // The weeks fallback would say 2026-09-15; the deliveries say otherwise
  // and the deliveries are the truth.
  assert.equal(resolveEndDate(SUB, "2026-09-21"), "2026-09-21");
});

test("a plan with NO delivery rows falls back to created_at + weeks * 7", () => {
  // This branch only runs for a subscription that has no deliveries at
  // all, which insertMultiVariantSubscription can leave behind because its
  // three inserts share no transaction — parent first, deliveries third.
  // Prod has 0 such rows out of 101, so this is the half-failed-write
  // path and has never executed. It is also exactly where the two copies
  // of the rule used to read different columns, meaning a divergence would
  // have surfaced on a day something else had already gone wrong.
  assert.equal(resolveEndDate(SUB, null), "2026-09-15");
  assert.equal(resolveEndDate(SUB, undefined), "2026-09-15");
});

test("the fallback uses the IST calendar date, not the timestamp", () => {
  assert.equal(
    resolveEndDate({ created_at: "2026-09-01T23:59:59.000Z", weeks: 1 }, null),
    "2026-09-08",
  );
});

test("no deliveries AND no usable week count yields null, not a date", () => {
  // A calendar-mode plan that lost its deliveries cannot have its end date
  // guessed. null is the honest answer; the board shows no end date and
  // the cron skips the row rather than emailing against a made-up day.
  assert.equal(resolveEndDate({ created_at: SUB.created_at, weeks: 0 }, null), null);
  assert.equal(resolveEndDate({ created_at: SUB.created_at }, null), null);
});

test("both callers of the rule now agree by construction", () => {
  // The reminder cron projects `weeks`; the admin routes SELECT * and pass
  // both. Previously the admin side read `total_weeks` only, so these two
  // shapes were resolved by two different functions against two different
  // columns. Same input, same answer, one function.
  const cronShape = { created_at: SUB.created_at, weeks: 2 };
  const adminShape = { created_at: SUB.created_at, weeks: 2, total_weeks: 2 };
  assert.equal(resolveEndDate(cronShape, null), resolveEndDate(adminShape, null));
  assert.equal(
    resolveEndDate(cronShape, "2026-09-21"),
    resolveEndDate(adminShape, "2026-09-21"),
  );
});
