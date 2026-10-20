// The 2-item floor on new one-time orders.
//
// Loaded through the alias hook with a top-level dynamic import: a static
// `import` resolves the whole graph before the hook installs, which fails
// with ERR_MODULE_NOT_FOUND naming a file that does exist.
import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";

const {
  MIN_ONE_TIME_UNITS,
  ONE_TIME_MINIMUM_CODE,
  ONE_TIME_MINIMUM_MESSAGE,
  belowOneTimeMinimum,
  carriesSubscriptionLine,
  totalCartUnits,
} = await import("../src/lib/order-minimum.ts");

/** A website request line: `quantity` + `kind`. */
const web = (quantity, kind = "once") => ({
  slug: "high-protein",
  quantity,
  kind,
  line_total_inr: 99 * quantity,
});

/** A website STORED line: `qty`, the other quantity key. */
const stored = (qty, kind = "once") => ({
  slug: "high-protein",
  name: "High Protein",
  qty,
  kind,
  price_inr: 99,
  line_total: 99 * qty,
});

/** An Android app request line: `product_id` + `quantity`, no `kind`. */
const app = (quantity) => ({
  product_id: "high-protein",
  quantity,
  price_snapshot_inr: 99,
});

// ── The floor itself ──────────────────────────────────────────────────────

test("two units pass; one unit is refused", () => {
  assert.equal(belowOneTimeMinimum([web(2)]), null);
  assert.ok(belowOneTimeMinimum([web(1)]));
});

test("TWO OF THE SAME loaf counts — the floor is units, not lines", () => {
  // The whole point of summing quantity rather than counting the array.
  assert.equal(belowOneTimeMinimum([web(2)]), null);
  assert.equal(totalCartUnits([web(2)]), 2);
});

test("two different single-unit lines pass", () => {
  const cart = [web(1), { ...web(1), slug: "burger-bun" }];
  assert.equal(belowOneTimeMinimum(cart), null);
});

test("the refusal carries the agreed message and code", () => {
  const failure = belowOneTimeMinimum([web(1)]);
  assert.equal(failure.status, 400);
  assert.equal(failure.code, ONE_TIME_MINIMUM_CODE);
  assert.equal(failure.error, ONE_TIME_MINIMUM_MESSAGE);
});

test("the message is pinned byte-for-byte, remedy included", () => {
  // Pinned because it reaches the customer with no UI help around it: on
  // Android it renders in the payment-step banner verbatim, and the app
  // cannot be given a friendlier version without a Play release. Raising
  // MIN_ONE_TIME_UNITS fails HERE, which is intended — "Add one more" stops
  // being true the moment the shortfall can exceed one.
  assert.equal(
    ONE_TIME_MINIMUM_MESSAGE,
    "One-time orders need at least 2 items. Add one more to your cart to continue.",
  );
  assert.equal(MIN_ONE_TIME_UNITS, 2);
  assert.equal(ONE_TIME_MINIMUM_CODE, "one_time_minimum_units");
});

test("no exclamation mark anywhere in the customer copy", () => {
  assert.ok(!ONE_TIME_MINIMUM_MESSAGE.includes("!"), ONE_TIME_MINIMUM_MESSAGE);
});

test("the copy says items, not loaves — buns and bases count", () => {
  assert.ok(ONE_TIME_MINIMUM_MESSAGE.includes("items"));
  assert.ok(!/loaf|loaves/i.test(ONE_TIME_MINIMUM_MESSAGE));
});

// ── Mixed carts: a subscription line exempts the whole cart ───────────────

test("1 one-time + 3 subscription units PASSES", () => {
  // The case that makes this an exemption rather than a filter. The website
  // posts the WHOLE cart to place_order and fans subscriptions out only
  // after that call returns, so refusing here would take the subscription
  // down with the loaf.
  const cart = [web(1, "once"), web(3, "sub")];
  assert.equal(belowOneTimeMinimum(cart), null);
});

test("1 one-time unit ALONE fails", () => {
  // Same single loaf, no subscription beside it. The pair of these two
  // tests is the rule.
  assert.ok(belowOneTimeMinimum([web(1, "once")]));
});

test("a subscription-only cart is never refused", () => {
  // placeOrderCOD calls place_order unconditionally, so a sub-only cart
  // reaches this gate with zero one-time units. Refusing it would break
  // subscription checkout outright.
  assert.equal(belowOneTimeMinimum([web(1, "sub")]), null);
  assert.equal(belowOneTimeMinimum([web(1, "sub"), web(1, "sub")]), null);
});

test("one subscription line exempts regardless of its position", () => {
  assert.equal(belowOneTimeMinimum([web(1, "sub"), web(1, "once")]), null);
  assert.equal(belowOneTimeMinimum([web(1, "once"), web(1, "sub")]), null);
});

test("carriesSubscriptionLine matches ONLY the exact literal", () => {
  assert.equal(carriesSubscriptionLine([web(1, "sub")]), true);
  assert.equal(carriesSubscriptionLine([web(1, "once")]), false);
  // A surprising value must NOT be read as a subscription — that would be a
  // silent way to opt out of the floor.
  assert.equal(carriesSubscriptionLine([web(1, "SUB")]), false);
  assert.equal(carriesSubscriptionLine([web(1, "subscription")]), false);
  assert.equal(carriesSubscriptionLine([app(1)]), false);
});

// ── Both quantity keys, because the clients disagree ─────────────────────

test("the app's `quantity` key is counted", () => {
  assert.ok(belowOneTimeMinimum([app(1)]));
  assert.equal(belowOneTimeMinimum([app(2)]), null);
});

test("the website's stored `qty` key is counted", () => {
  assert.ok(belowOneTimeMinimum([stored(1)]));
  assert.equal(belowOneTimeMinimum([stored(2)]), null);
});

test("a cart mixing the two quantity keys sums to 2 and passes", () => {
  // The failure this module exists to prevent: reading one key, counting 1,
  // and refusing a legitimate two-item order.
  assert.equal(totalCartUnits([stored(1), app(1)]), 2);
  assert.equal(belowOneTimeMinimum([stored(1), app(1)]), null);
});

test("an absent `kind` counts as one-time, not as an exemption", () => {
  // The app shape has no `kind` at all. If absence exempted, the floor
  // would be unenforced on every app order while reading as enforced.
  assert.ok(belowOneTimeMinimum([app(1)]));
});

test("units above the floor are unaffected", () => {
  for (const n of [2, 3, 10, 99]) {
    assert.equal(belowOneTimeMinimum([web(n)]), null, `n=${n}`);
  }
});

test("totalCartUnits ignores a line carrying no usable quantity", () => {
  // itemQty floors junk to 0 rather than poisoning the sum with NaN. Such a
  // line cannot reach the gate (both validators require an integer >= 1),
  // so this pins the reader's behaviour, not a live path.
  assert.equal(totalCartUnits([{ slug: "x" }]), 0);
  assert.equal(totalCartUnits([{ slug: "x", qty: "oops" }]), 0);
  assert.equal(totalCartUnits([{ slug: "x", qty: 2 }, { slug: "y" }]), 2);
});
