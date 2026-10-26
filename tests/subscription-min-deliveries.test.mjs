// The subscription minimum-deliveries rule.
//
// History, because it explains every test below: the rule was "2 distinct
// weekdays", then "4 distinct weekdays PER WEEK" (21 Oct 2026), and is now
// "4 deliveries IN TOTAL across the whole plan" (27 Oct 2026). The per-week
// form refused a once-a-week plan running for a month, which is a better
// subscription than four days crammed into a single week.
//
// Loaded through the alias hook with a top-level dynamic import: a static
// `import` resolves the whole graph before the hook installs, which fails
// with ERR_MODULE_NOT_FOUND naming a file that does exist.
import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const {
  MIN_SUBSCRIPTION_DELIVERIES,
  MIN_DELIVERIES_ERROR_CODE,
  MIN_DELIVERIES_ERROR_MESSAGE,
  hasMinSubscriptionDeliveries,
  patternDeliveryCount,
  countDeliveryDates,
  distinctDayCount,
} = await import("../src/lib/subscription-min-deliveries.ts");

const { MIN_ONE_TIME_UNITS } = await import("../src/lib/order-minimum.ts");
const { generateDeliveries } = await import("../src/lib/subscription-dates.ts");

// ── The rule itself: a TOTAL, not a weekly rate ──────────────────────────

test("the constant is 4 and names a total, not a rate", () => {
  assert.equal(MIN_SUBSCRIPTION_DELIVERIES, 4);
});

test("the four cases Raja named: 1x4, 2x2 and 4x1 pass; 1x3 fails", () => {
  // The whole point of the change, stated as the gate sees it.
  const pass = (days, weeks) =>
    hasMinSubscriptionDeliveries(patternDeliveryCount(days, weeks));

  // 1 day a week for 4 weeks — the plan the old per-week rule wrongly refused.
  assert.equal(pass(["mon"], 4), true, "1x4 must pass");
  // 2 days a week for 2 weeks.
  assert.equal(pass(["mon", "thu"], 2), true, "2x2 must pass");
  // 4 days in a single week — what the old rule required.
  assert.equal(pass(["mon", "tue", "wed", "thu"], 1), true, "4x1 must pass");
  // 1 day a week for 3 weeks — three deliveries, still short.
  assert.equal(pass(["mon"], 3), false, "1x3 must fail");
});

test("the gate is days x weeks, swept across the whole grid", () => {
  // Every combination up to 6x6 must agree with the product rule exactly.
  // This is what stops a future edit from reintroducing a per-week floor:
  // a days-only rule disagrees with this table in 9 of the 36 cells.
  const week = ["mon", "tue", "wed", "thu", "fri", "sat"];
  for (let days = 1; days <= 6; days += 1) {
    for (let weeks = 1; weeks <= 6; weeks += 1) {
      const expected = days * weeks >= MIN_SUBSCRIPTION_DELIVERIES;
      assert.equal(
        hasMinSubscriptionDeliveries(
          patternDeliveryCount(week.slice(0, days), weeks),
        ),
        expected,
        `${days} days x ${weeks} weeks should be ${expected}`,
      );
    }
  }
});

test("a single week of 3 days fails, where 3 weeks of 2 days passes", () => {
  // The asymmetry the rename exists to make legible: the old name would
  // have predicted the opposite verdict for the second plan.
  assert.equal(
    hasMinSubscriptionDeliveries(patternDeliveryCount(["mon", "tue", "wed"], 1)),
    false,
  );
  assert.equal(
    hasMinSubscriptionDeliveries(patternDeliveryCount(["mon", "tue"], 3)),
    true,
  );
});

// ── Counting pattern plans ───────────────────────────────────────────────

test("patternDeliveryCount multiplies DISTINCT valid days by weeks", () => {
  assert.equal(patternDeliveryCount(["mon", "tue"], 3), 6);
  // Repeats and casing collapse to one day — they do not inflate the total.
  assert.equal(patternDeliveryCount(["mon", "MON", "Mon"], 4), 4);
  // Unknown keys are ignored, matching how the routes filter to DAY_KEYS.
  assert.equal(patternDeliveryCount(["mon", "funday", "whenever"], 4), 4);
  assert.equal(distinctDayCount(["mon", "MON", "sat"]), 2);
});

test("patternDeliveryCount fails CLOSED on a bad or missing week count", () => {
  // Direction matters: a garbage `weeks` must not satisfy the minimum. The
  // recoverable error is refusing a plan the customer can resubmit; the
  // unrecoverable one is discounting a plan that never met the rule.
  for (const bad of [0, -1, 1.5, NaN, Infinity, null, undefined, "", "four", {}, []]) {
    assert.equal(
      patternDeliveryCount(["mon", "tue", "wed", "thu"], bad),
      0,
      `weeks=${JSON.stringify(bad)} must count 0`,
    );
    assert.equal(
      hasMinSubscriptionDeliveries(
        patternDeliveryCount(["mon", "tue", "wed", "thu"], bad),
      ),
      false,
    );
  }
  // And no valid days is zero however many weeks are claimed.
  assert.equal(patternDeliveryCount([], 52), 0);
  assert.equal(patternDeliveryCount(null, 52), 0);
  assert.equal(patternDeliveryCount("mon,tue,wed,thu", 52), 0);
});

test("hasMinSubscriptionDeliveries fails CLOSED on non-numbers", () => {
  for (const bad of [NaN, null, undefined, "", "many", {}, [], () => 9]) {
    assert.equal(hasMinSubscriptionDeliveries(bad), false, String(bad));
  }
  // Boundary, explicitly: one short fails, exactly the minimum passes.
  assert.equal(hasMinSubscriptionDeliveries(MIN_SUBSCRIPTION_DELIVERIES - 1), false);
  assert.equal(hasMinSubscriptionDeliveries(MIN_SUBSCRIPTION_DELIVERIES), true);
  assert.equal(hasMinSubscriptionDeliveries(MIN_SUBSCRIPTION_DELIVERIES + 1), true);
});

// ── Counting explicit-date plans, and the over-count hole ────────────────

test("an explicit-date plan counts DATES, one date one delivery", () => {
  const fourMondays = ["2026-11-02", "2026-11-09", "2026-11-16", "2026-11-23"];
  assert.equal(countDeliveryDates(fourMondays), 4);
  // Four Mondays is four deliveries — the old rule called this ONE day and
  // refused it. This is the 1x4 case as the web wizard actually sends it.
  assert.equal(hasMinSubscriptionDeliveries(countDeliveryDates(fourMondays)), true);

  const threeMondays = ["2026-11-02", "2026-11-09", "2026-11-16"];
  assert.equal(countDeliveryDates(threeMondays), 3);
  assert.equal(hasMinSubscriptionDeliveries(countDeliveryDates(threeMondays)), false);
});

test("multiplying days x weeks on an explicit-date plan would be a HOLE", () => {
  // The hazard the two-entry-point design exists to prevent. A plan of
  // {Mon of week 1, Tue of week 2} has 2 distinct weekdays and spans 2
  // week numbers, so days x weeks reads 4 and would pass — while
  // scheduling exactly 2 deliveries at the subscription discount.
  const sparse = ["2026-11-02", "2026-11-10"]; // a Monday, then the next Tuesday
  assert.equal(distinctDayCount(["mon", "tue"]), 2);
  assert.equal(patternDeliveryCount(["mon", "tue"], 2), 4, "the over-count, demonstrated");
  assert.ok(hasMinSubscriptionDeliveries(4), "which would have passed");

  // Counting the dates is the honest total, and it refuses.
  assert.equal(countDeliveryDates(sparse), 2);
  assert.equal(hasMinSubscriptionDeliveries(countDeliveryDates(sparse)), false);
});

test("countDeliveryDates ignores junk and counts a repeated date once", () => {
  // A duplicate must not buy its way past the minimum: two deliveries
  // cannot land on the same date.
  assert.equal(countDeliveryDates(["2026-11-02", "2026-11-02", "2026-11-02", "2026-11-02"]), 1);
  assert.equal(countDeliveryDates(["2026-11-02", "not-a-date", null, 7, undefined, {}]), 1);
  assert.equal(countDeliveryDates([]), 0);
  assert.equal(countDeliveryDates(null), 0);
  assert.equal(countDeliveryDates(undefined), 0);
  assert.equal(countDeliveryDates("2026-11-02"), 0);
});

// ── The customer-facing message ──────────────────────────────────────────

test("the message interpolates BOTH numbers and names the right dimension", () => {
  assert.ok(
    MIN_DELIVERIES_ERROR_MESSAGE.includes(`at least ${MIN_SUBSCRIPTION_DELIVERIES} deliveries`),
    MIN_DELIVERIES_ERROR_MESSAGE,
  );
  assert.ok(
    MIN_DELIVERIES_ERROR_MESSAGE.includes(`at least ${MIN_ONE_TIME_UNITS} items`),
    MIN_DELIVERIES_ERROR_MESSAGE,
  );
  // It must say TOTAL, not per week — the old sentence's exact lie.
  assert.ok(/in total/i.test(MIN_DELIVERIES_ERROR_MESSAGE), MIN_DELIVERIES_ERROR_MESSAGE);
  assert.ok(!/per week/i.test(MIN_DELIVERIES_ERROR_MESSAGE), MIN_DELIVERIES_ERROR_MESSAGE);
});

test("the message's prose contains NO hardcoded digit", async () => {
  // Read the module's own source, not the rendered string: the rendered
  // string of course contains digits — that is what interpolation is for.
  // What must not exist is a digit TYPED INTO THE PROSE, because grepping
  // the constant would then miss a place its number is shown to a customer.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL("../src/lib/subscription-min-deliveries.ts", import.meta.url),
    "utf8",
  );

  const m = src.match(/export const MIN_DELIVERIES_ERROR_MESSAGE\s*=\s*`([^`]*)`/);
  assert.ok(m, "could not locate the message template literal in the source");

  const template = m[1];
  // Strip every ${...} interpolation; whatever digits remain were typed.
  const prose = template.replace(/\$\{[^}]*\}/g, "");
  assert.ok(
    !/\d/.test(prose),
    `hardcoded digit in the message prose: ${JSON.stringify(prose)}`,
  );
  // Guard the guard: the template must actually interpolate, or a message
  // with no numbers at all would satisfy the check above vacuously.
  assert.ok(
    template.includes("${MIN_SUBSCRIPTION_DELIVERIES}"),
    "the message must interpolate MIN_SUBSCRIPTION_DELIVERIES",
  );
  assert.ok(
    template.includes("${MIN_ONE_TIME_UNITS}"),
    "the message must interpolate MIN_ONE_TIME_UNITS",
  );
});

test("the message tells the customer how to FIX it, both ways", () => {
  // The shortfall can be closed by adding days or by adding weeks, and at
  // a minimum of 4 it can be a shortfall of three — so neither "add one
  // more" nor a days-only instruction is true.
  assert.ok(/more weeks/i.test(MIN_DELIVERIES_ERROR_MESSAGE), MIN_DELIVERIES_ERROR_MESSAGE);
  assert.ok(!/one more day/i.test(MIN_DELIVERIES_ERROR_MESSAGE), MIN_DELIVERIES_ERROR_MESSAGE);
  assert.ok(!/single day/i.test(MIN_DELIVERIES_ERROR_MESSAGE), MIN_DELIVERIES_ERROR_MESSAGE);
});

test("the message says one-time DELIVERIES, because pickup is exempt", () => {
  // order-minimum.ts exempts pickup from the item floor, so "every one-time
  // order needs 2 items" would be wrong at the counter.
  assert.ok(
    MIN_DELIVERIES_ERROR_MESSAGE.includes("one-time deliveries"),
    MIN_DELIVERIES_ERROR_MESSAGE,
  );
  assert.ok(
    !/one-time orders need/i.test(MIN_DELIVERIES_ERROR_MESSAGE),
    MIN_DELIVERIES_ERROR_MESSAGE,
  );
});

test("the message stays a plain sentence — rendered verbatim on Android", () => {
  assert.ok(!MIN_DELIVERIES_ERROR_MESSAGE.includes("!"), MIN_DELIVERIES_ERROR_MESSAGE);
});

test("the error code no longer claims a weekly rate", () => {
  assert.equal(MIN_DELIVERIES_ERROR_CODE, "min_subscription_deliveries");
  // The old value described the rule this gate stopped enforcing. Nothing
  // branches on it in either repo, which is why it was safe to change.
  assert.ok(!/per_week/.test(MIN_DELIVERIES_ERROR_CODE), MIN_DELIVERIES_ERROR_CODE);
});

// ── NEW SUBSCRIPTIONS ONLY — the grandfathering guarantee ────────────────

test("an existing 3-delivery plan WOULD fail the gate, which is why it is never asked", () => {
  // Establishes the hazard the next two tests rule out. Live plans exist
  // below every revision of this minimum; if anything re-validated them,
  // they would be refused.
  assert.equal(hasMinSubscriptionDeliveries(patternDeliveryCount(["mon"], 3)), false);
  assert.equal(hasMinSubscriptionDeliveries(countDeliveryDates(["2026-11-02"])), false);
});

test("delivery GENERATION never consults the minimum", () => {
  // The path that keeps an existing plan running. generateDeliveries is
  // handed the stored day keys and must produce deliveries for a 2-day
  // template exactly as before — 2 days x 4 weeks = 8, no refusal.
  const out = generateDeliveries(new Date("2026-10-21T00:00:00Z"), ["mon", "thu"], 4);
  assert.equal(out.length, 8);
  assert.deepEqual([...new Set(out.map((d) => d.day_key))].sort(), ["mon", "thu"]);
  // And a 3-delivery template, below the current minimum, still generates.
  assert.equal(
    generateDeliveries(new Date("2026-10-21T00:00:00Z"), ["mon"], 3).length,
    3,
  );
});

test("the gate is imported ONLY by the creation paths and the wizard", async () => {
  // The structural half of the guarantee. A call from delivery generation,
  // reactivation, the admin PATCH or a cron sweep would retroactively
  // refuse plans that predate the current minimum — exactly what changing
  // the rule must not do. If this list grows, that is the review
  // conversation, not a silent pass.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = new URL("..", import.meta.url).pathname;

  const { stdout } = await promisify(execFile)(
    "grep",
    [
      "-rl",
      "hasMinSubscriptionDeliveries\\|MIN_SUBSCRIPTION_DELIVERIES\\|patternDeliveryCount\\|countDeliveryDates",
      "src",
    ],
    { cwd: root },
  );
  const files = stdout.trim().split("\n").sort();

  assert.deepEqual(
    files,
    [
      // The gate's own definition.
      "src/lib/subscription-min-deliveries.ts",
      // The three server creation paths.
      "src/app/api/admin/subscriptions/create/route.ts",
      "src/app/api/checkout/route.ts",
      "src/app/api/mobile/subscriptions/route.ts",
      // The web wizard, which only pre-empts the server's refusal.
      "src/app/subscriptions/setup/page.tsx",
      "src/app/subscriptions/setup/payment/page.tsx",
    ].sort(),
  );
});

test("no source file still references the old per-week names", async () => {
  // The rename is only worth anything if nothing kept the old name alive.
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const root = new URL("..", import.meta.url).pathname;

  let stdout = "";
  try {
    ({ stdout } = await promisify(execFile)(
      "grep",
      [
        "-rl",
        "MIN_SUBSCRIPTION_DAYS_PER_WEEK\\|hasMinSubscriptionDays\\|MIN_DAYS_ERROR_\\|subscription-min-days",
        "src",
      ],
      { cwd: root },
    ));
  } catch (err) {
    // grep exits 1 with no output when there are no matches — the pass case.
    assert.equal(err.code, 1, String(err));
    stdout = "";
  }
  assert.equal(stdout.trim(), "", `old per-week names still present in:\n${stdout}`);
});
