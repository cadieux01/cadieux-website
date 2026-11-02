// The two subscriber receipts, and the four ways they fail SILENTLY.
//
// Every fixture below is a REAL production row, copied verbatim on
// 2026-11-02, because each of these failures is invisible against invented
// data — a synthetic row has no stale snapshot name, no rescheduled stop and
// no legacy column disagreeing with its successor.
//
//   1. SOMEONE ELSE'S SUBSCRIPTION. The documents carry name and phone.
//      subscriptionBelongsToCustomer is the ownership rule, and the brief's
//      explicit ask — another customer's subscription must 404, never 403.
//      Tested here because the routes' own checks need a database.
//
//   2. A PROJECTION THAT QUIETLY SHRANK. PostgREST does not error on an
//      unselected column: the key is simply ABSENT, and a reader that
//      coerces it prints a confident wrong number. That is how 130 orders
//      got the wrong COD label and how 18 orders understated ₹525 of
//      delivery fees. The tripwires below hold each load-bearing column in
//      its projection, and then prove the tripwire is worth having by
//      deleting the column and showing what the receipt does.
//
//   3. THE WRONG COLUMN OF A PAIR. `scheduled_date` beats `delivery_date`,
//      `scheduled_time_slot` beats `slot`, and `subscription_items` beats
//      the legacy product trio. Reading the older half is silent and wrong.
//      OLS36 seq 2 is the gold fixture: all three traps on one row.
//
//   4. A WEEKDAY THAT CONTRADICTS ITS OWN DATE. `day_key` is stamped at
//      creation and never rewritten on a move — stale on 11 of 451 prod
//      rows. OLS36 seq 2 says "wed" and falls on a Monday. The column is
//      not projected at all, and one test asserts that ABSENCE.
//
// There is also a content guard: both documents are receipts, not tax
// invoices, and no money appears on the per-delivery note.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./_alias-hook.mjs";

// MUST be a top-level `await import`, not a static one: Node links the whole
// static graph before evaluating any module body, so the alias hook above has
// not installed yet when a static import is resolved, and subscription-receipt
// imports `@/lib/*`. The failure reads as ERR_MODULE_NOT_FOUND naming a file
// that does exist. Same reason as the note in tests/order-receipt.test.mjs.
const {
  DELIVERY_RECEIPT_TITLE,
  SUBSCRIPTION_DELIVERY_RECEIPT_COLUMNS,
  SUBSCRIPTION_DELIVERY_RECEIPT_SELECT,
  SUBSCRIPTION_ITEM_RECEIPT_COLUMNS,
  SUBSCRIPTION_ITEM_RECEIPT_SELECT,
  SUBSCRIPTION_RECEIPT_COLUMNS,
  SUBSCRIPTION_RECEIPT_SELECT,
  SUBSCRIPTION_RECEIPT_TITLE,
  buildDeliveryReceipt,
  buildSubscriptionReceipt,
  deliveryDayLabel,
  effectiveDeliverySlot,
  subscriptionBelongsToCustomer,
} = await import("../src/lib/subscription-receipt.ts");

const { orderBelongsToCustomer, RECEIPT_FSSAI } = await import(
  "../src/lib/order-receipt.ts"
);

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const SUMMARY_PAGE = path.join(
  ROOT,
  "src/app/subscriptions/[id]/receipt/page.tsx",
);
const NOTE_PAGE = path.join(
  ROOT,
  "src/app/subscriptions/[id]/deliveries/[deliveryId]/receipt/page.tsx",
);

/**
 * Source with comments removed, for assertions about what a route DOES.
 *
 * Needed because this codebase explains its decisions in prose next to them:
 * both route headers say "404 and not 403", so a bare search for 403 matches
 * the comment that exists to say it is never returned.
 */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trimStart();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

const read = (p) => fs.readFileSync(p, "utf8");

/* ── FIXTURES, copied from prod on 2026-11-02 ───────────────────────── */

const CUSTOMER = {
  id: "f9f77d58-25e4-4713-af5b-5d0fdc65b697",
  full_name: "Test Customer",
  phone: "9876543210",
};
const OTHER_CUSTOMER_ID = "e7b3a9c7-ba44-4627-af41-1dbf60b2210e";

// OLS118 — a MIXED plan, and the fixture for trap 3. Its legacy columns say
// `multigrain` × 2 @ 144; subscription_items says one Multigrain @ 144 AND
// one Plain @ 108. Reading the legacy trio would label both lines Multigrain
// and price one delivery at 288 instead of 252.
const OLS118 = {
  id: "091c5466-d888-45bd-ad9b-2b06f5788a27",
  subscription_number: "OLS118",
  customer_id: "f9f77d58-25e4-4713-af5b-5d0fdc65b697",
  created_at: "2026-11-01T05:18:14.157057+00:00",
  start_date: "2026-11-03",
  weeks: 2,
  total_weeks: 2,
  days: ["tue", "thu", "sat", "mon"],
  payment_status: "paid",
  payment_method: "cash",
  total_amount: "1128.00",
  delivery_fee_inr: "30.00",
  product_slug: "multigrain",
  product_name: "Multigrain Protein Bread",
  quantity_per_delivery: 2,
  bread_price: "144.00",
};

// `product_name` here is the SNAPSHOT written at signup. "Protein Rich Bread"
// is what Plain was called then; the catalogue name is "Protein Bread". The
// receipt must print the catalogue name, resolved from the slug.
const OLS118_ITEMS = [
  {
    product_slug: "high-protein",
    product_name: "Protein Rich Bread",
    quantity_per_delivery: 1,
    price_snapshot_inr: 108,
  },
  {
    product_slug: "multigrain",
    product_name: "Multigrain Protein Bread",
    quantity_per_delivery: 1,
    price_snapshot_inr: 144,
  },
];

const OLS118_DELIVERIES = [
  { id: "d1", subscription_id: OLS118.id, sequence: 1, week_number: 1, delivery_date: "2026-10-30", scheduled_date: "2026-10-30", slot: "16:00-21:00", scheduled_time_slot: "16:00-21:00", status: "delivered", items_override: null },
  { id: "d2", subscription_id: OLS118.id, sequence: 2, week_number: 1, delivery_date: "2026-11-01", scheduled_date: "2026-11-01", slot: "10:00-14:00", scheduled_time_slot: "10:00-14:00", status: "delivered", items_override: null },
  { id: "d3", subscription_id: OLS118.id, sequence: 3, week_number: 1, delivery_date: "2026-11-03", scheduled_date: "2026-11-03", slot: "10:00-14:00", scheduled_time_slot: "10:00-14:00", status: "confirmed", items_override: null },
  { id: "d4", subscription_id: OLS118.id, sequence: 4, week_number: 2, delivery_date: "2026-11-05", scheduled_date: "2026-11-05", slot: "10:00-14:00", scheduled_time_slot: "10:00-14:00", status: "confirmed", items_override: null },
];

// OLS36 — THE GOLD FIXTURE. Stop 2 was moved, and all three column pairs
// disagree on that one row: the date by two days, the slot from an evening
// window to a morning one, and `day_key` says "wed" on a Monday.
const OLS36 = {
  id: "6e28d5f6-f18c-42b1-aa1d-b9a860c0cfa2",
  subscription_number: "OLS36",
  customer_id: "e7b3a9c7-ba44-4627-af41-1dbf60b2210e",
  created_at: "2026-09-16T17:09:36.436209+00:00",
  start_date: "2026-09-17",
  weeks: 2,
  total_weeks: 2,
  days: ["thu", "wed"],
  payment_status: "paid",
  payment_method: "razorpay",
  total_amount: "312.00",
  delivery_fee_inr: "12.00",
  product_slug: "multigrain",
  product_name: "Protein Bread — Multigrain",
  quantity_per_delivery: 1,
  bread_price: "144.00",
};

const OLS36_ITEMS = [
  {
    product_slug: "multigrain",
    product_name: "Protein Bread — Multigrain",
    quantity_per_delivery: 1,
    price_snapshot_inr: "144",
  },
];

const OLS36_SEQ2 = {
  id: "95ce3024-8289-4a9a-b589-04c9d50d7111",
  subscription_id: OLS36.id,
  sequence: 2,
  week_number: 2,
  delivery_date: "2026-09-23", // Wednesday — the ORIGINAL date
  scheduled_date: "2026-09-21", // Monday — where it actually went
  slot: "16:00-21:00", // the original evening window
  scheduled_time_slot: "06:00-10:00", // where it actually went
  status: "delivered",
  items_override: null,
};

// OLS4 seq 1 — `slot` NULL with a populated `scheduled_time_slot`, which is
// the shape on 8 of 451 prod rows, and a legacy single-time slot value.
const OLS4_SEQ1 = {
  id: "9f4414b6-5d82-49c6-a860-137b99298264",
  subscription_id: "25dd783e-54d8-495e-bdee-d1d14c286962",
  sequence: 1,
  week_number: 1,
  delivery_date: "2026-07-14",
  scheduled_date: "2026-07-14",
  slot: null,
  scheduled_time_slot: "08:00",
  status: "cancelled",
  items_override: null,
};

// OLS1 — the FIRST subscription ever taken, and the `not_charged` fixture:
// `delivery_fee_inr` is 12 but total_amount is bread alone (109 × 2). Both
// its stops are cancelled, which is what makes it the proof that
// cancellations stay in the count — drop them and 109 × 0 stops
// reconciling against the 218 the customer was quoted.
const OLS1 = {
  id: "f01ad381-60e1-4417-b3b7-239cca333498",
  subscription_number: "OLS1",
  customer_id: "f46e0f95-27aa-416a-9416-a029f9cd2c50",
  created_at: "2026-07-04T05:45:38.814908+00:00",
  start_date: "2026-07-05",
  weeks: 1,
  total_weeks: 1,
  days: ["sun", "mon"],
  payment_status: "pending",
  payment_method: "cod",
  total_amount: "218.00",
  delivery_fee_inr: "12.00",
  product_slug: "high-protein",
  product_name: "Protein Rich Bread — Plain",
  quantity_per_delivery: 1,
  bread_price: "109.00",
};

const OLS1_ITEMS = [
  {
    product_slug: "high-protein",
    product_name: "Protein Rich Bread — Plain",
    quantity_per_delivery: 1,
    price_snapshot_inr: 109,
  },
];

const OLS1_DELIVERIES = [
  { id: "77630e3f-136e-4e4f-9856-3b05e4c6446a", subscription_id: OLS1.id, sequence: 1, week_number: 1, delivery_date: "2026-07-05", scheduled_date: "2026-07-05", slot: "10:30", scheduled_time_slot: "10:30", status: "cancelled", items_override: null },
  { id: "0aad42d2-a843-4039-8a22-48c82900328d", subscription_id: OLS1.id, sequence: 2, week_number: 1, delivery_date: "2026-07-06", scheduled_date: "2026-07-06", slot: "10:30", scheduled_time_slot: "10:30", status: "cancelled", items_override: null },
];

// OLS108 — `weeks` 0, which is a MODE MARKER for a calendar-mode plan whose
// dates were picked individually (4 prod rows), NOT a zero-week plan.
const OLS108 = {
  id: "ae26799a-4251-4fb0-91d8-4def12c59327",
  subscription_number: "OLS108",
  customer_id: "2ea70990-4611-4340-89cd-4714ecbd506d",
  created_at: "2026-10-20T05:41:07.261866+00:00",
  start_date: "2026-10-23",
  weeks: 0,
  total_weeks: 0,
  days: ["mon", "fri"],
  payment_status: "paid",
  payment_method: "razorpay",
  total_amount: "576.00",
  delivery_fee_inr: "15.00",
  product_slug: "multigrain",
  product_name: "Multigrain Protein Bread",
  quantity_per_delivery: 2,
  bread_price: "144.00",
};

const OLS108_ITEMS = [
  { product_slug: "multigrain", product_name: "Multigrain Protein Bread", quantity_per_delivery: 1, price_snapshot_inr: "144" },
  { product_slug: "multigrain-bun", product_name: "Multigrain Protein Burger Bun", quantity_per_delivery: 1, price_snapshot_inr: "129" },
];

const OLS108_DELIVERIES = [
  { id: "db84327c-ba0a-4abe-91b1-e7df8902e48c", subscription_id: OLS108.id, sequence: 1, week_number: 1, delivery_date: "2026-10-23", scheduled_date: "2026-10-23", slot: null, scheduled_time_slot: "16:00-21:00", status: "delivered", items_override: null },
  { id: "271f8316-b59e-4e45-a3e8-2dd22c59ef0a", subscription_id: OLS108.id, sequence: 2, week_number: 1, delivery_date: "2026-10-26", scheduled_date: "2026-10-26", slot: null, scheduled_time_slot: "16:00-21:00", status: "delivered", items_override: null },
];

// OLS113 — the only plan in prod whose SEQUENCE order is not its DATE order:
// stop 1 was pushed from the start of the plan to the end of it.
const OLS113_DELIVERIES = [
  { id: "p1", subscription_id: "0681b44a-9bb2-4a8d-8c0a-06599b418b45", sequence: 1, week_number: 1, delivery_date: "2026-11-26", scheduled_date: "2026-11-26", slot: "16:00-21:00", scheduled_time_slot: "16:00-21:00", status: "confirmed", items_override: null },
  { id: "p2", subscription_id: "0681b44a-9bb2-4a8d-8c0a-06599b418b45", sequence: 2, week_number: 1, delivery_date: "2026-11-05", scheduled_date: "2026-11-05", slot: "16:00-21:00", scheduled_time_slot: "16:00-21:00", status: "pending_confirmation", items_override: null },
  { id: "p3", subscription_id: "0681b44a-9bb2-4a8d-8c0a-06599b418b45", sequence: 3, week_number: 1, delivery_date: "2026-11-12", scheduled_date: "2026-11-12", slot: "16:00-21:00", scheduled_time_slot: "16:00-21:00", status: "pending_confirmation", items_override: null },
  { id: "p4", subscription_id: "0681b44a-9bb2-4a8d-8c0a-06599b418b45", sequence: 4, week_number: 2, delivery_date: "2026-11-19", scheduled_date: "2026-11-19", slot: "16:00-21:00", scheduled_time_slot: "16:00-21:00", status: "pending_confirmation", items_override: null },
];

/* ── 1. OWNERSHIP ───────────────────────────────────────────────────── */

test("ANOTHER customer's subscription does not belong to the asker", () => {
  // The brief's explicit ask. This predicate returning false is what makes
  // both routes call notFound() — see the source assertions below.
  assert.equal(
    subscriptionBelongsToCustomer({ customer_id: OTHER_CUSTOMER_ID }, CUSTOMER.id),
    false,
  );
  assert.equal(
    subscriptionBelongsToCustomer(OLS36, CUSTOMER.id),
    false,
    "OLS36 belongs to a different real customer and must not resolve",
  );
});

test("the owner's own subscription does belong to them", () => {
  assert.equal(subscriptionBelongsToCustomer(OLS118, CUSTOMER.id), true);
});

test("a missing id on EITHER side never matches", () => {
  for (const args of [
    [{ customer_id: null }, null],
    [{ customer_id: null }, CUSTOMER.id],
    [{ customer_id: CUSTOMER.id }, null],
    [{ customer_id: "" }, ""],
    [null, CUSTOMER.id],
    [undefined, CUSTOMER.id],
  ]) {
    assert.equal(subscriptionBelongsToCustomer(...args), false);
  }
});

test("the ownership rule is the ORDER receipt's function, not a second copy", () => {
  // Function identity, not behavioural equivalence. Two implementations that
  // agree today are two implementations that can drift; this fails loudly
  // the moment someone re-implements the rule under the new name.
  assert.equal(subscriptionBelongsToCustomer, orderBelongsToCustomer);
});

test("BOTH routes gate on ownership and answer 404, not 403", () => {
  for (const [name, file] of [
    ["summary", SUMMARY_PAGE],
    ["delivery note", NOTE_PAGE],
  ]) {
    const code = codeOnly(read(file));
    assert.match(
      code,
      /subscriptionBelongsToCustomer\(subscription,\s*customer\.id\)/,
      `the ownership check is gone from the ${name} route`,
    );
    assert.match(code, /notFound\(\)/);
    // A 403 would confirm that someone else's subscription exists, which is
    // itself the disclosure.
    assert.doesNotMatch(code, /\b403\b/, `${name} route can emit a 403`);
  }
});

test("BOTH routes verify the cookie and never trust a phone or id from the URL", () => {
  for (const file of [SUMMARY_PAGE, NOTE_PAGE]) {
    const src = read(file);
    assert.match(src, /verifyPhoneCookie\(/);
    assert.doesNotMatch(
      src,
      /searchParams[\s\S]{0,40}phone/,
      "a phone from the URL is not proof of ownership",
    );
    // The URL is the UUID. A route that accepted an OLS number would be
    // enumerable over every subscriber, since the series is dense from 1.
    assert.match(src, /UUID_RE\.test\(/);
    assert.doesNotMatch(
      codeOnly(src),
      /\.eq\("subscription_number"/,
      "the receipt must never be addressed by its OLS number",
    );
  }
});

test("the delivery note filters on the PARENT too, so a foreign stop is never read", () => {
  const code = codeOnly(read(NOTE_PAGE));
  // Both filters, on the same query. Filtering on the delivery id alone and
  // checking its parent afterwards would also be correct, but it reads the
  // row first; this way the database never returns it.
  assert.match(code, /\.eq\("id",\s*deliveryId\)/);
  assert.match(code, /\.eq\("subscription_id",\s*id\)/);
});

test("an unpaid shell 404s too — a receipt for money nobody sent", () => {
  // 20 of 118 prod rows are abandoned Razorpay sheets. The ownership gate
  // alone would happily render one for its own owner.
  const code = codeOnly(read(SUMMARY_PAGE));
  assert.match(code, /isHiddenSubscription\(subscription\)/);
  assert.match(codeOnly(read(NOTE_PAGE)), /isHiddenSubscription\(subscription\)/);
});

/* ── 2. PROJECTION TRIPWIRES ────────────────────────────────────────── */

test("PROJECTION TRIPWIRE: the money columns are still in the subscription select", () => {
  // Without the fee, buildSubscriptionMoney cannot tell a plan that was
  // charged for delivery from one that was not, and reports "unknown" on
  // every row. Without payment_status, the unpaid-shell gate is blind.
  for (const col of [
    "id",
    "subscription_number",
    "customer_id",
    "created_at",
    "start_date",
    "weeks",
    "total_weeks",
    "days",
    "payment_status",
    "payment_method",
    "total_amount",
    "delivery_fee_inr",
  ]) {
    assert.ok(
      SUBSCRIPTION_RECEIPT_COLUMNS.includes(col),
      `${col} was removed from SUBSCRIPTION_RECEIPT_COLUMNS`,
    );
    assert.match(SUBSCRIPTION_RECEIPT_SELECT, new RegExp(`\\b${col}\\b`));
  }
});

test("PROJECTION TRIPWIRE: price_snapshot_inr is still in the item select", () => {
  // The per-loaf price agreed at signup, and the only honest source for a
  // line total. A receipt re-priced from today's catalogue would print a
  // figure the customer never agreed to.
  for (const col of [
    "product_slug",
    "product_name",
    "quantity_per_delivery",
    "price_snapshot_inr",
  ]) {
    assert.ok(
      SUBSCRIPTION_ITEM_RECEIPT_COLUMNS.includes(col),
      `${col} was removed from SUBSCRIPTION_ITEM_RECEIPT_COLUMNS`,
    );
    assert.match(SUBSCRIPTION_ITEM_RECEIPT_SELECT, new RegExp(`\\b${col}\\b`));
  }
});

test("PROJECTION TRIPWIRE: BOTH halves of both delivery column pairs are projected", () => {
  // The reader needs the newer column to prefer it and the older one to fall
  // back to. Dropping either half silently changes which date or slot prints.
  for (const col of [
    "delivery_date",
    "scheduled_date",
    "slot",
    "scheduled_time_slot",
    "sequence",
    "week_number",
    "status",
    "items_override",
  ]) {
    assert.ok(
      SUBSCRIPTION_DELIVERY_RECEIPT_COLUMNS.includes(col),
      `${col} was removed from SUBSCRIPTION_DELIVERY_RECEIPT_COLUMNS`,
    );
  }
});

test("PROJECTION TRIPWIRE: day_key is NOT projected, and must stay unprojected", () => {
  // The one column whose ABSENCE is the guarantee. It is a weekday stamped
  // at creation and never rewritten on a move, so it is stale on 11 of 451
  // prod rows. Projecting it again would hand the next reader a plausible
  // wrong answer where today there is nothing to read.
  assert.ok(
    !SUBSCRIPTION_DELIVERY_RECEIPT_COLUMNS.includes("day_key"),
    "day_key is back in the delivery projection — the weekday is DERIVED " +
      "from the effective date, and the stored column contradicts it on 11 " +
      "prod rows",
  );
  assert.doesNotMatch(SUBSCRIPTION_DELIVERY_RECEIPT_SELECT, /\bday_key\b/);
});

test("both routes project the shared constants, not their own select strings", () => {
  const summary = read(SUMMARY_PAGE);
  assert.match(summary, /\.select\(SUBSCRIPTION_RECEIPT_SELECT\)/);
  assert.match(summary, /\.select\(SUBSCRIPTION_ITEM_RECEIPT_SELECT\)/);
  assert.match(summary, /\.select\(SUBSCRIPTION_DELIVERY_RECEIPT_SELECT\)/);

  const note = read(NOTE_PAGE);
  assert.match(note, /\.select\(SUBSCRIPTION_RECEIPT_SELECT\)/);
  assert.match(note, /\.select\(SUBSCRIPTION_ITEM_RECEIPT_SELECT\)/);
  assert.match(note, /\.select\(SUBSCRIPTION_DELIVERY_RECEIPT_SELECT\)/);

  // A second inline select string is how a column goes missing from one
  // caller while the constant still lists it.
  for (const src of [summary, note]) {
    assert.doesNotMatch(codeOnly(src), /\.select\("[^"]*,/);
  }
});

test("FALSIFIABLE: an UNPROJECTED delivery fee reports unknown, never a fee of ₹0", () => {
  // The tripwire above is only worth having if its absence is visible. This
  // injects the exact shape PostgREST returns when the column was not
  // selected — the key simply missing — and shows the receipt declines to
  // claim a figure rather than printing a cheerful zero.
  const row = { ...OLS118 };
  delete row.delivery_fee_inr;

  const r = buildSubscriptionReceipt({
    subscription: row,
    items: OLS118_ITEMS,
    deliveries: OLS118_DELIVERIES,
    customer: CUSTOMER,
  });
  assert.equal(r.feePerDelivery, null);
  assert.equal(r.feeTotal, null);
  assert.equal(r.feeStatus, "none");
  // And the total stays the stored one, so nothing silently shrinks.
  assert.equal(r.grandTotal, 1128);
});

test("FALSIFIABLE: an UNPROJECTED price_snapshot_inr leaves the line unpriced, not free", () => {
  const items = OLS118_ITEMS.map((i) => {
    const copy = { ...i };
    delete copy.price_snapshot_inr;
    return copy;
  });
  const r = buildSubscriptionReceipt({
    subscription: OLS118,
    items,
    deliveries: OLS118_DELIVERIES,
    customer: CUSTOMER,
  });
  // The lines are still there and still named — what is gone is the price.
  assert.equal(r.lines.length, 2);
  assert.deepEqual(r.lines.map((l) => l.unitPrice), [null, null]);
  assert.deepEqual(r.lines.map((l) => l.perDelivery), [null, null]);
  assert.equal(r.breadPerDelivery, null);
  assert.equal(r.breadTotal, null);
  assert.equal(r.feeStatus, "unknown", "no prices at all is 'unknown'");
});

/* ── 3. THE WRONG COLUMN OF A PAIR ──────────────────────────────────── */

test("the SLOT is the scheduled one — OLS36 seq 2 moved from an evening to a morning", () => {
  assert.equal(effectiveDeliverySlot(OLS36_SEQ2), "06:00-10:00");
  assert.notEqual(
    effectiveDeliverySlot(OLS36_SEQ2),
    OLS36_SEQ2.slot,
    "reading `slot` prints a rescheduled stop's ORIGINAL time",
  );
});

test("a NULL slot falls back to the older column, and vice versa", () => {
  // 8 of 451 prod rows have slot NULL with scheduled_time_slot populated.
  assert.equal(effectiveDeliverySlot(OLS4_SEQ1), "08:00");
  assert.equal(effectiveDeliverySlot(OLS108_DELIVERIES[0]), "16:00-21:00");
  // The other direction: the newer column empty, the older one populated.
  assert.equal(
    effectiveDeliverySlot({ slot: "16:00-21:00", scheduled_time_slot: null }),
    "16:00-21:00",
  );
  assert.equal(
    effectiveDeliverySlot({ slot: "  ", scheduled_time_slot: "  " }),
    null,
    "whitespace is not a slot",
  );
  assert.equal(effectiveDeliverySlot({}), null);
});

test("the DATE is the scheduled one, and the WEEKDAY is derived from it", () => {
  // OLS36 seq 2: delivery_date is Wednesday 2026-09-23, scheduled_date is
  // Monday 2026-09-21, and the stored day_key says "wed". All three
  // disagree, and only one of them is where the bread went.
  assert.equal(deliveryDayLabel(OLS36_SEQ2), "Monday");
  assert.notEqual(
    deliveryDayLabel(OLS36_SEQ2),
    "Wednesday",
    "the weekday came from delivery_date or from the stale day_key",
  );

  const r = buildDeliveryReceipt({
    subscription: OLS36,
    items: OLS36_ITEMS,
    delivery: OLS36_SEQ2,
    customer: CUSTOMER,
  });
  assert.equal(r.date, "2026-09-21");
  assert.equal(r.dayLabel, "Monday");
  assert.equal(r.slot, "06:00-10:00");
});

test("a day_key on the row is IGNORED even when it is handed over", () => {
  // Belt and braces for the projection tripwire: if the column ever comes
  // back, nothing reads it. A stale value must not be able to win.
  const withStaleKey = { ...OLS36_SEQ2, day_key: "wed" };
  assert.equal(deliveryDayLabel(withStaleKey), "Monday");
});

test("a missing or malformed date yields NO weekday, never a guess", () => {
  assert.equal(deliveryDayLabel({ delivery_date: null, scheduled_date: null }), null);
  assert.equal(deliveryDayLabel({ scheduled_date: "2026-02-31" }), null);
  assert.equal(deliveryDayLabel({ scheduled_date: "not a date" }), null);
});

test("LINES COME FROM subscription_items — OLS118's legacy columns are wrong", () => {
  const r = buildSubscriptionReceipt({
    subscription: OLS118,
    items: OLS118_ITEMS,
    deliveries: OLS118_DELIVERIES,
    customer: CUSTOMER,
  });

  assert.equal(r.usedLegacyFallback, false);
  assert.deepEqual(
    r.lines.map((l) => [l.slug, l.name, l.qtyPerDelivery, l.unitPrice, l.perDelivery]),
    [
      // Resolved from the SLUG: the stored snapshot says "Protein Rich
      // Bread", which is what Plain was called at signup.
      ["high-protein", "Protein Bread", 1, 108, 108],
      ["multigrain", "Multigrain Protein Bread", 1, 144, 144],
    ],
  );
  // The legacy trio would have said Multigrain × 2 @ 144 = 288.
  assert.equal(r.breadPerDelivery, 252);
  assert.notEqual(r.breadPerDelivery, 288);
});

test("a stale snapshot name is replaced by the catalogue name on both documents", () => {
  // OLS36's item is still stored as "Protein Bread — Multigrain", the name
  // from before the 2026-09-23 rename. 396 rows across three tables carry
  // old names like it; none of them is a label.
  const note = buildDeliveryReceipt({
    subscription: OLS36,
    items: OLS36_ITEMS,
    delivery: OLS36_SEQ2,
    customer: CUSTOMER,
  });
  assert.deepEqual(
    note.lines.map((l) => [l.slug, l.name, l.qty]),
    [["multigrain", "Multigrain Protein Bread", 1]],
  );
});

/* ── 4. THE SUMMARY ─────────────────────────────────────────────────── */

test("OLS118 — the whole summary, against the row as it stands in prod", () => {
  const r = buildSubscriptionReceipt({
    subscription: OLS118,
    items: OLS118_ITEMS,
    deliveries: OLS118_DELIVERIES,
    customer: CUSTOMER,
  });

  assert.equal(r.title, "Subscription Receipt");
  assert.equal(r.subscriptionNumber, "OLS118", "the OLS series is reused as-is");
  assert.equal(r.fssai, RECEIPT_FSSAI);
  assert.equal(r.placedAt, OLS118.created_at);
  assert.equal(r.customerName, "Test Customer");
  assert.equal(r.customerPhone, "9876543210");

  assert.equal(r.startDate, "2026-11-03");
  assert.equal(r.startDateFromFirstStop, false);
  assert.equal(r.weeks, 2);
  assert.equal(r.deliveryCount, 4);
  assert.equal(r.cancelledCount, 0);
  // Stored in pick order, printed in week order.
  assert.deepEqual(r.days, ["Monday", "Tuesday", "Thursday", "Saturday"]);

  assert.equal(r.breadTotal, 1008);
  assert.equal(r.feePerDelivery, 30);
  assert.equal(r.feeTotal, 120);
  assert.equal(r.feeStatus, "charged");
  assert.equal(r.grandTotal, 1128);
  // 1008 + 120 = 1128 exactly, which is WHY the classifier says "charged".
  assert.equal(r.breadTotal + r.feeTotal, r.grandTotal);

  // `cash` is not `cod`, and paid is tested before method anyway.
  assert.equal(r.paymentLabel, "Paid");

  assert.deepEqual(
    r.stops.map((s) => [s.date, s.dayLabel, s.slot, s.statusLabel]),
    [
      ["2026-10-30", "Friday", "16:00-21:00", "Delivered"],
      ["2026-11-01", "Sunday", "10:00-14:00", "Delivered"],
      ["2026-11-03", "Tuesday", "10:00-14:00", "Confirmed"],
      ["2026-11-05", "Thursday", "10:00-14:00", "Confirmed"],
    ],
  );
});

test("the grand total is the STORED total_amount, never a re-addition", () => {
  // Same rule and same reason as the order receipt: the stored figure is
  // what the customer was charged, and subscription-payment.ts verifies the
  // Razorpay capture against it. A "tidier" total would contradict their
  // bank statement AND fail live payment verification.
  const r = buildSubscriptionReceipt({
    subscription: { ...OLS118, total_amount: "1100.00" },
    items: OLS118_ITEMS,
    deliveries: OLS118_DELIVERIES,
    customer: CUSTOMER,
  });
  assert.equal(r.grandTotal, 1100);
  assert.equal(r.breadTotal, 1008);
  // And the mismatch is DECLARED, not smoothed over.
  assert.equal(r.feeStatus, "unreconciled");
});

test("OLS1 — a recorded-but-uncharged fee, and two cancelled stops that still count", () => {
  const r = buildSubscriptionReceipt({
    subscription: OLS1,
    items: OLS1_ITEMS,
    deliveries: OLS1_DELIVERIES,
    customer: { ...CUSTOMER, id: OLS1.customer_id },
  });

  // 109 × 1 loaf × 2 stops = 218 = total_amount. The ₹12 fee was backfilled
  // for reporting; the customer was quoted bread alone. 15 prod rows are
  // like this, and the page hides the fee line on all of them.
  assert.equal(r.breadPerDelivery, 109);
  assert.equal(r.breadTotal, 218);
  assert.equal(r.grandTotal, 218);
  assert.equal(r.feePerDelivery, 12);
  assert.equal(r.feeStatus, "not_charged");

  // THE CANCELLATIONS STAY IN THE COUNT. Excluding them would make
  // deliveryCount 0 and breadTotal 0 against a quoted 218.
  assert.equal(r.deliveryCount, 2);
  assert.equal(r.cancelledCount, 2);
  assert.deepEqual(r.stops.map((s) => s.cancelled), [true, true]);
  assert.deepEqual(r.stops.map((s) => s.statusLabel), ["Cancelled", "Cancelled"]);

  // cod + pending, and a subscription has no pickup branch.
  assert.equal(r.paymentLabel, "Cash on Delivery");
});

test("OLS108 — `weeks` 0 is a calendar-mode plan, NOT a zero-week plan", () => {
  const r = buildSubscriptionReceipt({
    subscription: OLS108,
    items: OLS108_ITEMS,
    deliveries: OLS108_DELIVERIES,
    customer: { ...CUSTOMER, id: OLS108.customer_id },
  });
  assert.equal(
    r.weeks,
    null,
    "0 must not reach the page as a number — '0 weeks' describes a plan " +
      "that ended before it began",
  );
  assert.equal(r.deliveryCount, 2);
  // The page says "Chosen dates · 2 deliveries" for exactly this.
  assert.match(read(SUMMARY_PAGE), /Chosen dates/);

  assert.equal(r.breadPerDelivery, 273);
  assert.equal(r.breadTotal, 546);
  assert.equal(r.feeStatus, "charged");
  assert.equal(r.grandTotal, 576);
  assert.deepEqual(
    r.lines.map((l) => l.name),
    ["Multigrain Protein Bread", "Multigrain Protein Burger Bun"],
  );
  // Both stops have slot NULL; the scheduled column carries the window.
  assert.deepEqual(r.stops.map((s) => s.slot), ["16:00-21:00", "16:00-21:00"]);
});

test("OLS17 — a NULL start_date falls back to the first stop, and SAYS SO", () => {
  const sub = {
    ...OLS118,
    id: "4b788f5f-0222-4d84-aec4-6cdcf1744e89",
    subscription_number: "OLS17",
    start_date: null,
  };
  const deliveries = [
    { id: "s1", sequence: 1, delivery_date: "2026-09-11", scheduled_date: "2026-09-11", slot: "06:00-10:00", scheduled_time_slot: "06:00-10:00", status: "delivered" },
    { id: "s2", sequence: 2, delivery_date: "2026-09-12", scheduled_date: "2026-09-12", slot: "06:00-10:00", scheduled_time_slot: "06:00-10:00", status: "delivered" },
  ];
  const r = buildSubscriptionReceipt({
    subscription: sub,
    items: OLS118_ITEMS,
    deliveries,
    customer: CUSTOMER,
  });
  // 3 prod rows have no start_date. The first stop IS the day the plan
  // started, so it stands in — and the flag is what lets the page print
  // "(first delivery)" instead of inventing certainty.
  assert.equal(r.startDate, "2026-09-11");
  assert.equal(r.startDateFromFirstStop, true);
  assert.match(read(SUMMARY_PAGE), /\(first delivery\)/);
});

test("stops print in DATE order, not sequence order — OLS113's stop 1 was pushed last", () => {
  const r = buildSubscriptionReceipt({
    subscription: { ...OLS118, id: "0681b44a-9bb2-4a8d-8c0a-06599b418b45", subscription_number: "OLS113" },
    items: OLS118_ITEMS,
    deliveries: OLS113_DELIVERIES,
    customer: CUSTOMER,
  });
  // A rescheduled stop keeps its original sequence number, so sequence order
  // prints a moved delivery out of chronological place. This is the only
  // plan in prod where the two orders differ, and it differs on stop 1.
  assert.deepEqual(r.stops.map((s) => s.date), [
    "2026-11-05",
    "2026-11-12",
    "2026-11-19",
    "2026-11-26",
  ]);
  assert.deepEqual(r.stops.map((s) => s.sequence), [2, 3, 4, 1]);
});

test("a stop with no date sorts LAST rather than to the top", () => {
  const r = buildSubscriptionReceipt({
    subscription: OLS118,
    items: OLS118_ITEMS,
    deliveries: [
      { id: "x", sequence: 9, delivery_date: null, scheduled_date: null, status: "confirmed" },
      ...OLS118_DELIVERIES,
    ],
    customer: CUSTOMER,
  });
  assert.equal(r.stops[0].date, "2026-10-30");
  assert.equal(r.stops[4].date, null);
  assert.equal(r.deliveryCount, 5);
});

test("a plan with no items renders no lines and still shows what was charged", () => {
  // The order receipt's "total with no items" failure, reached from the
  // other side. The money is still the stored figure; what is absent is
  // absent, and the page prints "No items recorded".
  const r = buildSubscriptionReceipt({
    subscription: { ...OLS118, product_slug: null, product_name: null, quantity_per_delivery: null, bread_price: null },
    items: [],
    deliveries: OLS118_DELIVERIES,
    customer: CUSTOMER,
  });
  assert.equal(r.grandTotal, 1128);
  assert.equal(r.breadPerDelivery, null);
  assert.equal(r.usedLegacyFallback, true);
  assert.match(read(SUMMARY_PAGE), /No items recorded on this subscription/);
});

test("a missing customer renders nulls, not 'undefined'", () => {
  const r = buildSubscriptionReceipt({
    subscription: OLS118,
    items: OLS118_ITEMS,
    deliveries: OLS118_DELIVERIES,
    customer: null,
  });
  assert.equal(r.customerName, null);
  assert.equal(r.customerPhone, null);
});

/* ── 5. THE PER-DELIVERY NOTE ───────────────────────────────────────── */

test("OLS36 seq 2 — the whole note, against the row as it stands in prod", () => {
  const r = buildDeliveryReceipt({
    subscription: OLS36,
    items: OLS36_ITEMS,
    delivery: OLS36_SEQ2,
    customer: { ...CUSTOMER, id: OLS36.customer_id },
  });

  assert.equal(r.title, "Delivery Receipt");
  assert.equal(r.fssai, RECEIPT_FSSAI);
  // The PARENT's OLS number. No series of its own — nothing is minted.
  assert.equal(r.subscriptionNumber, "OLS36");
  assert.equal(r.sequence, 2);
  assert.equal(r.weekNumber, 2);
  assert.equal(r.statusLabel, "Delivered");
  assert.equal(r.cancelled, false);
  assert.deepEqual(r.lines, [
    { slug: "multigrain", name: "Multigrain Protein Bread", qty: 1 },
  ]);
});

test("NO MONEY ON THE NOTE — not a field, not a figure, not an import", () => {
  const r = buildDeliveryReceipt({
    subscription: OLS36,
    items: OLS36_ITEMS,
    delivery: OLS36_SEQ2,
    customer: CUSTOMER,
  });
  // One payment covers the whole plan. A per-delivery figure on a document
  // handed over at the door reads as a second amount due.
  for (const key of Object.keys(r)) {
    assert.doesNotMatch(
      key,
      /price|total|amount|fee|unit/i,
      `the delivery note view model grew a money field: ${key}`,
    );
  }
  for (const line of r.lines) {
    assert.deepEqual(Object.keys(line).sort(), ["name", "qty", "slug"]);
  }
  // And the page cannot print one even by accident: it does not import the
  // currency formatter.
  const src = read(NOTE_PAGE);
  assert.doesNotMatch(src, /\brupees\b/);
  assert.doesNotMatch(src, /payment-label/);
  assert.match(
    src,
    /covered by the subscription/,
    "the note must say where the money is, or it reads as unpaid",
  );
});

test("A CANCELLED STOP STILL LISTS ITS ITEMS, and says it was cancelled", () => {
  const r = buildDeliveryReceipt({
    subscription: OLS1,
    items: OLS1_ITEMS,
    delivery: OLS1_DELIVERIES[0],
    customer: { ...CUSTOMER, id: OLS1.customer_id },
  });
  assert.equal(r.cancelled, true);
  assert.equal(r.statusLabel, "Cancelled");
  // The counting helpers zero a cancellation because they total loaves to
  // bake. This is a record of one stop; blanking it would leave a note that
  // says nothing about what was cancelled.
  assert.deepEqual(r.lines, [
    { slug: "high-protein", name: "Protein Bread", qty: 1 },
  ]);
  assert.match(read(NOTE_PAGE), /This delivery was cancelled\./);
});

test("an items_override on the stop wins over the plan's lines", () => {
  // NULL on all 451 prod rows, so this branch is unexercised by real data.
  // Same precedence as the bake plan, which is the point: the two must never
  // disagree about what a stop contains.
  const r = buildDeliveryReceipt({
    subscription: OLS36,
    items: OLS36_ITEMS,
    delivery: {
      ...OLS36_SEQ2,
      items_override: [{ product_slug: "burger-bun", qty: 4 }],
    },
    customer: CUSTOMER,
  });
  assert.deepEqual(r.lines, [
    { slug: "burger-bun", name: "Protein Burger Bun", qty: 4 },
  ]);
});

test("an override that parses to nothing falls back to the plan, never to empty", () => {
  // A shape we do not understand is not "this stop is empty" — dropping the
  // items would leave a packing note with no bread on it.
  const r = buildDeliveryReceipt({
    subscription: OLS36,
    items: OLS36_ITEMS,
    delivery: { ...OLS36_SEQ2, items_override: [{ nonsense: true }] },
    customer: CUSTOMER,
  });
  assert.deepEqual(r.lines.map((l) => l.slug), ["multigrain"]);
});

test("a stop with no week_number reads null, not 0", () => {
  const r = buildDeliveryReceipt({
    subscription: OLS36,
    items: OLS36_ITEMS,
    delivery: { ...OLS36_SEQ2, week_number: null },
    customer: CUSTOMER,
  });
  assert.equal(r.weekNumber, null);
});

/* ── 6. RECEIPTS, NOT TAX INVOICES ──────────────────────────────────── */

test("both titles end in Receipt, and the FSSAI licence is the only licence", () => {
  assert.equal(SUBSCRIPTION_RECEIPT_TITLE, "Subscription Receipt");
  assert.equal(DELIVERY_RECEIPT_TITLE, "Delivery Receipt");
  assert.equal(RECEIPT_FSSAI, "20126051001081");
  for (const t of [SUBSCRIPTION_RECEIPT_TITLE, DELIVERY_RECEIPT_TITLE]) {
    assert.doesNotMatch(t, /invoice/i);
  }
});

test("no GSTIN, no tax line, no HSN, and never the word Invoice", () => {
  for (const [file, disclaimer] of [
    [SUMMARY_PAGE, "This is a subscription receipt, not a tax invoice."],
    [
      NOTE_PAGE,
      "This is a delivery receipt, not a tax invoice. Payment for this delivery is covered by the subscription above.",
    ],
  ]) {
    const src = read(file);
    // Only the RENDERED surface is asserted clean: the headers discuss these
    // words in prose explaining why they are absent.
    const rendered = codeOnly(src);
    for (const banned of [/GSTIN/i, /\bHSN\b/i, /\bCGST\b/i, /\bSGST\b/i, /\bIGST\b/i]) {
      assert.ok(
        !banned.test(rendered),
        `${banned} must not appear on a receipt — it is not a tax document`,
      );
    }

    // THE DISCLAIMER IS THE ONE ALLOWED MENTION, and it is required rather
    // than tolerated: it is what stops a customer filing this as a tax
    // invoice. Asserted present, then removed before checking the word
    // appears nowhere else.
    assert.ok(src.includes(disclaimer), `${file} lost its disclaimer`);
    assert.ok(
      !/invoice/i.test(rendered.replace(disclaimer, "")),
      `the word 'invoice' appears outside the disclaimer in ${file}`,
    );
  }
});

test("neither receipt is cacheable or indexable", () => {
  for (const file of [SUMMARY_PAGE, NOTE_PAGE]) {
    const src = read(file);
    // Per-customer documents. A prerendered or ISR copy would be served to
    // whoever asked next.
    assert.match(src, /export const dynamic = "force-dynamic"/);
    assert.match(src, /robots:\s*\{\s*index:\s*false/);
  }
});
