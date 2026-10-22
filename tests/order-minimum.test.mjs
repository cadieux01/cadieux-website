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
  CART_ONE_TIME_MINIMUM_HINT,
  belowOneTimeMinimum,
  carriesSubscriptionLine,
  totalCartUnits,
} = await import("../src/lib/order-minimum.ts");

const { canonicalFulfillment, PICKUP_FULFILLMENT } = await import(
  "../src/lib/fulfillment-type.ts"
);

/** How a route decides the exemption: ONE canonical read, reused. */
const ctxFor = (rawFulfillmentType) => ({
  isPickup: canonicalFulfillment(rawFulfillmentType) === PICKUP_FULFILLMENT,
});

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

// ── The cart's ADVISORY sentence ─────────────────────────────────────────

test("the cart hint is pinned byte-for-byte", () => {
  assert.equal(
    CART_ONE_TIME_MINIMUM_HINT,
    "One-time delivery orders need at least 2 items. Add one more, or " +
      "choose pickup at checkout to collect a single item.",
  );
});

test("the cart hint carries the live number, not a stale literal", () => {
  assert.ok(
    CART_ONE_TIME_MINIMUM_HINT.includes(`at least ${MIN_ONE_TIME_UNITS} items`),
    CART_ONE_TIME_MINIMUM_HINT,
  );
});

test("the cart hint says DELIVERY orders and names pickup as the way out", () => {
  // The cart does not know `isPickup` — fulfillment is chosen on the
  // checkout address step. Stating the floor flatly here would be a false
  // claim to a customer about to collect a single loaf, which the server
  // accepts. Hence "delivery orders" and an escape route in the sentence.
  assert.ok(/delivery orders/i.test(CART_ONE_TIME_MINIMUM_HINT), CART_ONE_TIME_MINIMUM_HINT);
  assert.ok(/pickup/i.test(CART_ONE_TIME_MINIMUM_HINT), CART_ONE_TIME_MINIMUM_HINT);
  // And it is NOT the server's flat refusal.
  assert.notEqual(CART_ONE_TIME_MINIMUM_HINT, ONE_TIME_MINIMUM_MESSAGE);
  assert.ok(!CART_ONE_TIME_MINIMUM_HINT.includes("!"), CART_ONE_TIME_MINIMUM_HINT);
});

test("the cart WARNS but never blocks — Proceed is not disabled", async () => {
  // The structural half of the advisory rule. A `disabled` on that button
  // dead-ends a one-loaf PICKUP order the server would accept, with no
  // explanation and no route onward, because this screen cannot evaluate the
  // pickup exemption. If this assertion ever fails, that is the review
  // conversation, not a silent regression.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL("../src/app/cart/page.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(!/disabled=\{belowMinimum\}/.test(src), "cart Proceed button is disabled");
  // Nor greyed out, which reads as disabled even when the click works.
  // `belowMinimum ?` on its own is fine — that is the banner's condition.
  assert.ok(!/cursor: belowMinimum/.test(src), "Proceed shows a not-allowed cursor");
  assert.ok(!/opacity: belowMinimum/.test(src), "Proceed is dimmed");
  // The banner still renders, and renders the imported sentence rather than
  // a retyped copy or the server's refusal.
  assert.ok(src.includes("{CART_ONE_TIME_MINIMUM_HINT}"), "cart banner text");
  assert.ok(!src.includes("minimumBlock!.error"), "cart shows the server refusal");
});

// ── Pickup is exempt, and only through the canonical reader ──────────────

test("pickup + 1 item PASSES", () => {
  // Raja, 20 Oct: the floor protects the cost of a delivery run. A customer
  // collecting at the stall imposes none of it.
  assert.equal(belowOneTimeMinimum([web(1)], ctxFor("pickup")), null);
});

test("delivery + 1 item FAILS", () => {
  // The pair of these two tests is the exemption.
  assert.ok(belowOneTimeMinimum([web(1)], ctxFor("delivery")));
});

test("an absent fulfillment_type is a delivery, so the floor applies", () => {
  // Every app build and every pre-pickup website build omits the field.
  assert.ok(belowOneTimeMinimum([web(1)], ctxFor(undefined)));
  // And a caller that passes no context at all gets the floor, never the
  // exemption — the default must fail closed.
  assert.ok(belowOneTimeMinimum([web(1)]));
  assert.ok(belowOneTimeMinimum([web(1)], {}));
});

test("a non-canonical CASING is exempted via the canonical reader", () => {
  // The trap this split exists for. `canonicalFulfillment` lowercases, so
  // "Pickup" IS a pickup order — it takes the pickup branch, the pickup
  // location gate and the ₹0 fee. The floor must agree with that, which it
  // does because it is handed the same derived boolean rather than reading
  // the field a second time.
  for (const spelling of ["Pickup", "PICKUP", "pIcKuP"]) {
    assert.equal(canonicalFulfillment(spelling), PICKUP_FULFILLMENT, spelling);
    assert.equal(belowOneTimeMinimum([web(1)], ctxFor(spelling)), null, spelling);
  }
});

test("a spelling the reader does NOT accept is refused, not exempted", () => {
  // "pick-up" / " pickup " are not pickup orders anywhere in the pipeline:
  // they route as delivery, get an address gate and a distance fee. So the
  // floor must apply to them. This is the direction that matters — an
  // unrecognised spelling that EXEMPTED would be a way to bypass the floor
  // while still taking a delivery.
  for (const spelling of ["pick-up", " pickup ", "pick up", "collect", 1, null]) {
    assert.equal(canonicalFulfillment(spelling), "delivery", String(spelling));
    assert.ok(belowOneTimeMinimum([web(1)], ctxFor(spelling)), String(spelling));
  }
});

test("the exemption does not raise the floor for a pickup cart of 2", () => {
  assert.equal(belowOneTimeMinimum([web(2)], ctxFor("pickup")), null);
});

test("order-minimum.ts holds no pickup literal of its own", async () => {
  // The structural half of the guarantee: if this module ever grows its own
  // `"pickup"` comparison, that is a second reading of fulfillment_type and
  // the hole is back. Keep the decision at the one canonical call site.
  const { readFile } = await import("node:fs/promises");
  const src = await readFile(
    new URL("../src/lib/order-minimum.ts", import.meta.url),
    "utf8",
  );
  const code = src
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join("\n");
  assert.ok(!/["']pickup["']/i.test(code), code);
  assert.ok(!/fulfillment/i.test(code), code);
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
