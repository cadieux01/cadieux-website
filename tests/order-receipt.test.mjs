// The order receipt, and the three ways it fails SILENTLY.
//
// Every assertion here is against one of those, not against formatting:
//
//   1. A RECEIPT WITH A TOTAL AND NO LINE ITEMS. `orders.items` has two live
//      shapes (see lib/order-items.ts). A reader that knows only the website
//      shape returns an empty array for an app-placed order — and because the
//      grand total comes from `total_amount`, the page still renders a
//      plausible receipt with nothing on it. OLF504 is a real shape-B order,
//      copied verbatim from prod, and is the fixture for that case.
//
//   2. A DELIVERY FEE OF ₹0 THAT WAS NEVER ZERO. An unprojected column comes
//      back `undefined`, and a reader that coerces prints "₹0" on an order
//      that was charged a fee. That bug class cost ₹525 across 18 orders.
//      Two guards: readDeliveryFee keeps null distinct from 0, and the
//      projection tripwire asserts the column is still in the select.
//
//   3. SOMEONE ELSE'S RECEIPT. The document carries name, phone and address.
//      orderBelongsToCustomer is the ownership rule, tested here because the
//      route's own check cannot be unit-tested without a database.
//
// There is also a content guard: a receipt is NOT a tax invoice, and the
// words that would make it look like one must not appear in the source.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import "./_alias-hook.mjs";

// MUST be a top-level `await import`, not a static one: Node links the whole
// static graph before evaluating any module body, so the hook above has not
// installed yet when a static import is resolved, and order-receipt.ts imports
// `@/lib/*`. The failure reads as ERR_MODULE_NOT_FOUND naming a file that does
// exist. Same reason as the note in tests/pickup-counter-payment.test.mjs.
const {
  ORDER_RECEIPT_SELECT,
  RECEIPT_FSSAI,
  RECEIPT_ORDER_COLUMNS,
  RECEIPT_TITLE,
  buildReceipt,
  orderBelongsToCustomer,
  readDeliveryFee,
  receiptLines,
} = await import("../src/lib/order-receipt.ts");

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RECEIPT_PAGE = path.join(
  ROOT,
  "src/app/orders/[id]/receipt/page.tsx",
);

/**
 * Source with comments removed, for the assertions about what the route DOES.
 *
 * Needed because this codebase explains its decisions in prose next to them:
 * the receipt route's own header says "404 and not 403", so a bare search for
 * 403 matches the comment that exists to say it is never returned. Strips
 * line comments and block/JSDoc bodies, leaving code and JSX text.
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

const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_CUSTOMER_ID = "22222222-2222-4222-8222-222222222222";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";

// select items from orders where order_number = 'OLF470' — shape A (website).
const OLF470_ITEMS = [
  { qty: 1, kind: "once", name: "Multigrain Protein Bread", slug: "multigrain", price_inr: 160, line_total: 160 },
  { qty: 1, kind: "once", name: "Protein Rich Bread", slug: "high-protein", price_inr: 120, line_total: 120 },
];

// select items from orders where order_number = 'OLF504' — shape B (app).
const OLF504_ITEMS = [
  { name: "Protein Rich Bread", quantity: 1, product_id: "high-protein", line_total_inr: 120, unit_price_inr: 120 },
  { name: "Multigrain Protein Bread", quantity: 1, product_id: "multigrain", line_total_inr: 160, unit_price_inr: 160 },
];

function order(overrides = {}) {
  return {
    id: ORDER_ID,
    order_number: "OLF504",
    created_at: "2026-10-20T06:30:00.000Z",
    delivery_address: "12 Beach Road, Visakhapatnam",
    items: OLF504_ITEMS,
    delivery_fee: 40,
    total_amount: 320,
    payment_method: "razorpay",
    payment_status: "paid",
    fulfillment_type: "delivery",
    customer_id: CUSTOMER_ID,
    ...overrides,
  };
}

const CUSTOMER = {
  id: CUSTOMER_ID,
  full_name: "Test Customer",
  phone: "9876543210",
};

/* ── 1. THE SHAPE TRAP ──────────────────────────────────────────────── */

test("a shape-B order (OLF504, from the app) renders its line items", () => {
  const r = buildReceipt({ order: order(), customer: CUSTOMER });

  // The failure this exists for: lines.length === 0 while grandTotal is set.
  assert.equal(r.lines.length, 2, "shape-B lines were dropped");
  assert.notEqual(r.grandTotal, null);

  assert.deepEqual(
    r.lines.map((l) => [l.name, l.qty, l.unitPrice, l.lineTotal]),
    [
      ["Protein Rich Bread", 1, 120, 120],
      ["Multigrain Protein Bread", 1, 160, 160],
    ],
  );
  assert.equal(r.itemsSubtotal, 280);
});

test("a shape-A order (OLF470, from the website) renders its line items", () => {
  const r = buildReceipt({
    order: order({ order_number: "OLF470", items: OLF470_ITEMS }),
    customer: CUSTOMER,
  });
  assert.equal(r.lines.length, 2);
  assert.deepEqual(
    r.lines.map((l) => [l.name, l.qty, l.unitPrice, l.lineTotal]),
    [
      ["Multigrain Protein Bread", 1, 160, 160],
      ["Protein Rich Bread", 1, 120, 120],
    ],
  );
});

test("both shapes produce the IDENTICAL receipt lines for the same basket", () => {
  // OLF470 and OLF504 are the same two loaves written by the two clients.
  // Sorted, because the two orders stored them in opposite order — the
  // point is that no field is lost, not that the rows line up.
  const key = (l) => `${l.slug}|${l.qty}|${l.unitPrice}|${l.lineTotal}`;
  const a = receiptLines(OLF470_ITEMS).map(key).sort();
  const b = receiptLines(OLF504_ITEMS).map(key).sort();
  assert.deepEqual(a, b);
});

test("a line with no stored name still reads as words, from its slug", () => {
  const [line] = receiptLines([
    { product_id: "multigrain", quantity: 2, unit_price_inr: 160, line_total_inr: 320 },
  ]);
  assert.equal(line.name, "Multigrain Protein Bread");
});

test("a zero-quantity line is dropped, and a non-array items column is empty", () => {
  assert.equal(receiptLines([{ slug: "multigrain", qty: 0 }]).length, 0);
  assert.deepEqual(receiptLines(null), []);
  assert.deepEqual(receiptLines(undefined), []);
  assert.deepEqual(receiptLines("not an array"), []);
});

/* ── 2. THE DELIVERY FEE ────────────────────────────────────────────── */

test("PROJECTION TRIPWIRE: delivery_fee is still in the receipt's select", () => {
  assert.ok(
    RECEIPT_ORDER_COLUMNS.includes("delivery_fee"),
    "delivery_fee was removed from RECEIPT_ORDER_COLUMNS — an absent column " +
      "is read as no fee, and the receipt would understate what was charged",
  );
  assert.match(ORDER_RECEIPT_SELECT, /\bdelivery_fee\b/);

  // Every column the receipt reads, not just the fee. Any field dropped from
  // the projection renders as an em dash with no error anywhere.
  for (const col of [
    "order_number",
    "created_at",
    "delivery_address",
    "items",
    "total_amount",
    "payment_method",
    "payment_status",
    "fulfillment_type",
    "customer_id",
  ]) {
    assert.match(
      ORDER_RECEIPT_SELECT,
      new RegExp(`\\b${col}\\b`),
      `${col} missing from ORDER_RECEIPT_SELECT`,
    );
  }
});

test("the route projects the shared constant, not its own select string", () => {
  const src = fs.readFileSync(RECEIPT_PAGE, "utf8");
  assert.match(
    src,
    /\.select\(ORDER_RECEIPT_SELECT\)/,
    "the receipt page must project ORDER_RECEIPT_SELECT — a second inline " +
      "select string is how delivery_fee goes missing from one caller",
  );
});

test("an UNPROJECTED delivery fee is null, never 0", () => {
  // The exact shape Postgres returns when the column was not selected.
  const row = order();
  delete row.delivery_fee;
  assert.equal(readDeliveryFee(row), null);
  assert.equal(buildReceipt({ order: row, customer: CUSTOMER }).deliveryFee, null);

  assert.equal(readDeliveryFee(order({ delivery_fee: null })), null);
});

test("a GENUINE zero fee stays 0, and is not confused with unknown", () => {
  assert.equal(readDeliveryFee(order({ delivery_fee: 0 })), 0);
  assert.equal(readDeliveryFee(order({ delivery_fee: "0" })), 0);
  assert.equal(readDeliveryFee(order({ delivery_fee: 40 })), 40);
  assert.equal(readDeliveryFee(order({ delivery_fee: "40" })), 40);
});

test("the grand total is the STORED total_amount, never a re-addition", () => {
  // Lines sum to 280 + 40 fee = 320, but the stored total says 300. The
  // stored figure is what the customer was charged and must win: a
  // recomputed total would contradict their bank statement.
  const r = buildReceipt({
    order: order({ total_amount: 300 }),
    customer: CUSTOMER,
  });
  assert.equal(r.grandTotal, 300);
  assert.equal(r.itemsSubtotal, 280);
});

/* ── 3. OWNERSHIP ───────────────────────────────────────────────────── */

test("ANOTHER customer's order does not belong to the asker", () => {
  assert.equal(
    orderBelongsToCustomer({ customer_id: OTHER_CUSTOMER_ID }, CUSTOMER_ID),
    false,
  );
});

test("the owner's own order does belong to them", () => {
  assert.equal(
    orderBelongsToCustomer({ customer_id: CUSTOMER_ID }, CUSTOMER_ID),
    true,
  );
});

test("a missing id on EITHER side never matches", () => {
  // An order with no customer_id must not be readable by a caller with no
  // customer id — two blanks must not compare equal.
  assert.equal(orderBelongsToCustomer({ customer_id: null }, null), false);
  assert.equal(orderBelongsToCustomer({ customer_id: null }, CUSTOMER_ID), false);
  assert.equal(orderBelongsToCustomer({ customer_id: CUSTOMER_ID }, null), false);
  assert.equal(orderBelongsToCustomer({ customer_id: "" }, ""), false);
  assert.equal(orderBelongsToCustomer(null, CUSTOMER_ID), false);
  assert.equal(orderBelongsToCustomer(undefined, CUSTOMER_ID), false);
});

test("the route gates on ownership and answers 404, not 403", () => {
  const code = codeOnly(fs.readFileSync(RECEIPT_PAGE, "utf8"));
  assert.match(
    code,
    /orderBelongsToCustomer\(order,\s*customer\.id\)/,
    "the ownership check is gone from the receipt route",
  );
  assert.match(code, /notFound\(\)/);
  // A 403 would confirm that an order belonging to someone else exists, so
  // the route must never emit one.
  assert.doesNotMatch(code, /\b403\b/);
});

test("the route verifies the phone cookie and never trusts a phone param", () => {
  const src = fs.readFileSync(RECEIPT_PAGE, "utf8");
  assert.match(src, /verifyPhoneCookie\(/);
  assert.doesNotMatch(
    src,
    /searchParams[\s\S]{0,40}phone/,
    "a phone from the URL is not proof of ownership",
  );
});

/* ── 4. IT IS A RECEIPT, NOT A TAX INVOICE ──────────────────────────── */

test("the title is 'Order Receipt' and the FSSAI licence is present", () => {
  assert.equal(RECEIPT_TITLE, "Order Receipt");
  assert.equal(RECEIPT_FSSAI, "20126051001081");

  const r = buildReceipt({ order: order(), customer: CUSTOMER });
  assert.equal(r.title, "Order Receipt");
  assert.equal(r.fssai, "20126051001081");
  assert.equal(r.orderNumber, "OLF504", "the OLF series is reused as-is");
});

test("no GSTIN, no tax line, no HSN, and never the word Invoice", () => {
  const pageSrc = fs.readFileSync(RECEIPT_PAGE, "utf8");
  const libSrc = fs.readFileSync(
    path.join(ROOT, "src/lib/order-receipt.ts"),
    "utf8",
  );

  // Only the RENDERED surface is asserted clean. Both files discuss these
  // words in comments explaining why they are absent, so the check runs
  // against the page's JSX text and the module's string literals.
  const rendered = codeOnly(pageSrc);

  for (const banned of [/GSTIN/i, /\bHSN\b/i, /\bCGST\b/i, /\bSGST\b/i, /\bIGST\b/i]) {
    assert.ok(
      !banned.test(rendered),
      `${banned} must not appear on a receipt — it is not a tax document`,
    );
  }

  // THE DISCLAIMER IS THE ONE ALLOWED MENTION, and it is required rather
  // than merely tolerated: it is what stops a customer filing this as a tax
  // invoice. So it is asserted present, then removed before checking that
  // the words appear nowhere else.
  const DISCLAIMER = "This is an order receipt, not a tax invoice.";
  assert.ok(pageSrc.includes(DISCLAIMER), "the receipt lost its disclaimer");
  const withoutDisclaimer = rendered.replace(DISCLAIMER, "");
  assert.ok(
    !/invoice/i.test(withoutDisclaimer),
    "the word 'invoice' appears outside the disclaimer",
  );

  assert.ok(!/RECEIPT_TITLE\s*=\s*"[^"]*[Ii]nvoice/.test(libSrc));
});

/* ── 5. PICKUP AND PAYMENT WORDING ──────────────────────────────────── */

test("a pickup order shows no delivery address", () => {
  const r = buildReceipt({
    order: order({ fulfillment_type: "pickup", payment_method: "cod", payment_status: "pending" }),
    customer: CUSTOMER,
  });
  assert.equal(r.fulfillment, "pickup");
  assert.equal(r.deliveryAddress, null);
  // The customer register, shared with checkout and the order page.
  assert.equal(r.paymentLabel, "Pay at Pickup");
});

test("payment wording comes from the shared customer vocabulary", () => {
  const label = (o) => buildReceipt({ order: order(o), customer: CUSTOMER }).paymentLabel;

  assert.equal(label({ payment_status: "paid" }), "Paid");
  assert.equal(
    label({ payment_method: "cod", payment_status: "pending" }),
    "Cash on Delivery",
  );
  assert.equal(
    label({ payment_method: "razorpay", payment_status: "failed" }),
    "Payment failed",
  );
  assert.equal(
    label({ payment_method: "razorpay", payment_status: "created" }),
    "Awaiting payment",
  );
  // Pay Now settles a COD order online and leaves payment_method as 'cod'.
  // Reading method before status would tell a paid customer to pay cash.
  assert.equal(label({ payment_method: "cod", payment_status: "paid" }), "Paid");
});

test("a legacy row with no fulfillment_type reads as delivery", () => {
  const r = buildReceipt({
    order: order({ fulfillment_type: null }),
    customer: CUSTOMER,
  });
  assert.equal(r.fulfillment, "delivery");
  assert.equal(r.deliveryAddress, "12 Beach Road, Visakhapatnam");
});

test("a pre-trigger order with no order_number falls back to the id slice", () => {
  const r = buildReceipt({
    order: order({ order_number: null }),
    customer: CUSTOMER,
  });
  assert.equal(r.orderNumber, "#33333333");
});

test("a missing customer renders em dashes, not 'undefined'", () => {
  const r = buildReceipt({ order: order(), customer: null });
  assert.equal(r.customerName, null);
  assert.equal(r.customerPhone, null);
});
