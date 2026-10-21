// The subscription minimum-days rule, raised 2 → 4 on 21 Oct 2026.
//
// Loaded through the alias hook with a top-level dynamic import: a static
// `import` resolves the whole graph before the hook installs, which fails
// with ERR_MODULE_NOT_FOUND naming a file that does exist.
import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const {
  MIN_SUBSCRIPTION_DAYS_PER_WEEK,
  MIN_DAYS_ERROR_CODE,
  MIN_DAYS_ERROR_MESSAGE,
  hasMinSubscriptionDays,
  distinctWeekdaysFromDates,
} = await import("../src/lib/subscription-min-days.ts");

const { MIN_ONE_TIME_UNITS } = await import("../src/lib/order-minimum.ts");
const { generateDeliveries } = await import("../src/lib/subscription-dates.ts");

// ── The rule itself ───────────────────────────────────────────────────────

test("the minimum is 4", () => {
  assert.equal(MIN_SUBSCRIPTION_DAYS_PER_WEEK, 4);
});

test("4 distinct weekdays PASSES", () => {
  assert.equal(hasMinSubscriptionDays(["mon", "tue", "wed", "thu"]), true);
});

test("3 distinct weekdays is REFUSED", () => {
  // The pair of these two tests is the new rule. Three was acceptable
  // before 21 Oct 2026 and is not any more.
  assert.equal(hasMinSubscriptionDays(["mon", "tue", "wed"]), false);
});

test("every count below 4 is refused, every count at or above it passes", () => {
  const week = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];
  for (let n = 0; n <= 7; n++) {
    assert.equal(
      hasMinSubscriptionDays(week.slice(0, n)),
      n >= MIN_SUBSCRIPTION_DAYS_PER_WEEK,
      `n=${n}`,
    );
  }
});

test("DISTINCT, not count — four picks on two weekdays is refused", () => {
  // The defect this helper exists to prevent: a customer picking four
  // dates that are all Mondays and Thursdays has two delivery days.
  assert.equal(
    hasMinSubscriptionDays(["mon", "mon", "thu", "thu"]),
    false,
  );
  assert.equal(
    hasMinSubscriptionDays(["mon", "MON", "thu", "Thu", "fri", "sat"]),
    true,
  );
});

test("junk day keys are ignored rather than counted", () => {
  // Matches how the checkout routes filter dayKeys down to DAY_KEYS. If
  // junk counted, four bad strings would buy a subscription.
  assert.equal(
    hasMinSubscriptionDays(["mon", "funday", "someday", "whenever"]),
    false,
  );
  assert.equal(hasMinSubscriptionDays(null), false);
  assert.equal(hasMinSubscriptionDays(undefined), false);
  assert.equal(hasMinSubscriptionDays("mon,tue,wed,thu"), false);
});

test("distinctWeekdaysFromDates counts weekday identity, not dates", () => {
  // Four consecutive Mondays are ONE delivery day.
  const mondays = ["2026-10-26", "2026-11-02", "2026-11-09", "2026-11-16"];
  assert.equal(distinctWeekdaysFromDates(mondays), 1);
  // Mon/Tue/Wed/Thu of one week are four.
  const fourDays = ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29"];
  assert.equal(distinctWeekdaysFromDates(fourDays), 4);
  assert.ok(distinctWeekdaysFromDates(fourDays) >= MIN_SUBSCRIPTION_DAYS_PER_WEEK);
  assert.ok(distinctWeekdaysFromDates(mondays) < MIN_SUBSCRIPTION_DAYS_PER_WEEK);
});

// ── The customer-facing sentence ──────────────────────────────────────────

test("the message is pinned byte-for-byte, with BOTH numbers interpolated", () => {
  // Pinned because it reaches the customer with no UI help around it: on
  // Android `min_days_per_week` is not a code the app branches on, so this
  // sentence renders verbatim in the error banner and is the entire
  // explanation. Changing EITHER constant fails here, which is the point —
  // it names the one-time item floor as the alternative, so it goes stale
  // if MIN_ONE_TIME_UNITS moves and nobody re-reads this copy.
  assert.equal(
    MIN_DAYS_ERROR_MESSAGE,
    "A subscription needs at least 4 delivery days per week. Add more days, " +
      "or place a one-time order instead — one-time deliveries need at least " +
      "2 items.",
  );
  assert.equal(MIN_DAYS_ERROR_CODE, "min_days_per_week");
});

test("the sentence carries both live numbers, not a stale literal", () => {
  assert.ok(
    MIN_DAYS_ERROR_MESSAGE.includes(`at least ${MIN_SUBSCRIPTION_DAYS_PER_WEEK} delivery days`),
    MIN_DAYS_ERROR_MESSAGE,
  );
  assert.ok(
    MIN_DAYS_ERROR_MESSAGE.includes(`at least ${MIN_ONE_TIME_UNITS} items`),
    MIN_DAYS_ERROR_MESSAGE,
  );
});

test("the old copy's two false claims are gone", () => {
  // "For a single day, place a one-time order instead" was wrong twice over
  // at a minimum of 4: the shortfall is no longer always one day, and a
  // one-time DELIVERY now needs two items, so "place a one-time order" is
  // not by itself a route to buying one loaf.
  assert.ok(!/single day/i.test(MIN_DAYS_ERROR_MESSAGE), MIN_DAYS_ERROR_MESSAGE);
  assert.ok(!/one more day/i.test(MIN_DAYS_ERROR_MESSAGE), MIN_DAYS_ERROR_MESSAGE);
});

test("the sentence says DELIVERIES, because pickup is exempt from the item floor", () => {
  // order-minimum.ts exempts pickup (Raja, 20 Oct 2026). Promising that
  // every one-time order needs two items would be wrong at the counter.
  assert.ok(
    MIN_DAYS_ERROR_MESSAGE.includes("one-time deliveries"),
    MIN_DAYS_ERROR_MESSAGE,
  );
  assert.ok(!/one-time orders need/i.test(MIN_DAYS_ERROR_MESSAGE), MIN_DAYS_ERROR_MESSAGE);
});

test("no exclamation mark anywhere in the customer copy", () => {
  assert.ok(!MIN_DAYS_ERROR_MESSAGE.includes("!"), MIN_DAYS_ERROR_MESSAGE);
});

// ── NEW SUBSCRIPTIONS ONLY — the grandfathering guarantee ────────────────

test("an existing 2-day plan WOULD fail the gate, which is why it is never asked", () => {
  // Establishes the hazard the next two tests rule out. There were live
  // plans on two days when the minimum rose; if anything re-validated
  // them, they would be refused.
  assert.equal(hasMinSubscriptionDays(["mon", "thu"]), false);
});

test("delivery GENERATION never consults the minimum", () => {
  // The path that keeps an existing plan running. generateDeliveries is
  // handed the stored day keys and must produce deliveries for a 2-day
  // template exactly as it did before the rule changed — 2 days × 4 weeks
  // = 8 deliveries, no refusal, no empty result.
  const out = generateDeliveries(new Date("2026-10-21T00:00:00Z"), ["mon", "thu"], 4);
  assert.equal(out.length, 8);
  assert.deepEqual(
    [...new Set(out.map((d) => d.day_key))].sort(),
    ["mon", "thu"],
  );
  // And a single-day template, below even the OLD minimum, still generates.
  assert.equal(
    generateDeliveries(new Date("2026-10-21T00:00:00Z"), ["mon"], 3).length,
    3,
  );
});

test("the gate is imported ONLY by the three creation paths", async () => {
  // The structural half of the guarantee. A call to hasMinSubscriptionDays
  // from delivery generation, reactivation, the admin PATCH or a cron sweep
  // would retroactively refuse plans that predate the current minimum —
  // exactly what raising the number must not do. If this list grows, that
  // is the review conversation, not a silent pass.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = new URL("..", import.meta.url).pathname;

  const { stdout } = await promisify(execFile)(
    "grep",
    ["-rl", "hasMinSubscriptionDays\\|MIN_SUBSCRIPTION_DAYS_PER_WEEK", "src"],
    { cwd: root },
  );
  const files = stdout.trim().split("\n").sort();

  assert.deepEqual(files, [
    // The gate's own definition.
    "src/lib/subscription-min-days.ts",
    // The three server creation paths.
    "src/app/api/admin/subscriptions/create/route.ts",
    "src/app/api/checkout/route.ts",
    "src/app/api/mobile/subscriptions/route.ts",
    // The web wizard, which only pre-empts the server's refusal.
    "src/app/subscriptions/setup/page.tsx",
    "src/app/subscriptions/setup/payment/page.tsx",
  ].sort());
});
