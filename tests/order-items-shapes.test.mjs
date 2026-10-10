// The CSV export's per-product columns must read BOTH live shapes of
// `orders.items`.
//
// `orders.items` is jsonb with no constraint and two writers that name the
// same two facts differently (see src/lib/order-items.ts for the full
// account and the prod measurements):
//
//   A — website checkout   { slug,       qty,      price_inr,      line_total     }
//   B — mobile app         { product_id, quantity, unit_price_inr, line_total_inr }
//
// Measured on prod 2026-10-10: 700 orders / 1036 lines in shape A, and
// 23 orders / 42 lines in shape B. Shape B is NOT legacy — it is whatever
// the installed app builds are writing, so it persists until those age out.
//
// WHAT WOULD BREAK WITHOUT THE COALESCE. The orders export's product
// columns come from unitsBySlug() (src/app/admin/orders/page.tsx:3202),
// which keys on itemSlug(it) and sums itemQty(it). A reader that took
// `slug` and `qty` alone would see undefined for both on every shape-B
// line, drop all 42 of them, and export those 23 orders with 0 in every
// product column — silently, because a 0 is indistinguishable from an
// order that genuinely contained none of that product.
//
// The two payloads below are copied VERBATIM from prod, which is the point:
// a hand-written fixture would only prove that the test agrees with itself.

import { test } from "node:test";
import assert from "node:assert/strict";

import { itemSlug, itemQty } from "../src/lib/order-items.ts";

// select items from orders where order_number = 'OLF470' — shape A.
const OLF470 = [
  { qty: 1, kind: "once", name: "Multigrain Protein Bread", slug: "multigrain", price_inr: 160, line_total: 160 },
  { qty: 1, kind: "once", name: "Protein Rich Bread", slug: "high-protein", price_inr: 120, line_total: 120 },
];

// select items from orders where order_number = 'OLF504' — shape B.
const OLF504 = [
  { name: "Protein Rich Bread", quantity: 1, product_id: "high-protein", line_total_inr: 120, unit_price_inr: 120 },
  { name: "Multigrain Protein Bread", quantity: 1, product_id: "multigrain", line_total_inr: 160, unit_price_inr: 160 },
];

/** Verbatim copy of unitsBySlug() at src/app/admin/orders/page.tsx:3202 —
 *  the function the export's product columns are built from. It cannot be
 *  imported here because page.tsx is a client component full of "@/"
 *  aliases, so the loop is restated and the logic under test (the two
 *  readers) is imported for real. */
function unitsBySlug(items) {
  const m = new Map();
  for (const it of items ?? []) {
    const slug = itemSlug(it);
    if (!slug) continue;
    const q = itemQty(it);
    if (q === 0) continue;
    m.set(slug, (m.get(slug) ?? 0) + q);
  }
  return m;
}

test("a shape-B order exports the same product cells as the shape-A order beside it", () => {
  // Both orders really are one of each bread, so the exported product
  // columns have to be identical. Anything else means the shape leaked
  // into the output.
  const expected = new Map([
    ["high-protein", 1],
    ["multigrain", 1],
  ]);

  assert.deepEqual(unitsBySlug(OLF470), expected, "OLF470 (shape A)");
  assert.deepEqual(unitsBySlug(OLF504), expected, "OLF504 (shape B)");
});

test("a slug-only / qty-only reader would drop every shape-B line", () => {
  // The failure this pins, stated as the bug rather than the fix: read the
  // shape-A key names directly and shape B vanishes.
  const naive = (items) => {
    const m = new Map();
    for (const it of items) {
      if (!it.slug) continue;
      m.set(it.slug, (m.get(it.slug) ?? 0) + (it.qty ?? 0));
    }
    return m;
  };

  assert.equal(naive(OLF470).size, 2, "shape A survives a naive reader");
  assert.equal(naive(OLF504).size, 0, "shape B does not — hence the coalesce");
});

test("each reader coalesces its own pair of key names", () => {
  assert.equal(itemSlug({ slug: "multigrain" }), "multigrain");
  assert.equal(itemSlug({ product_id: "multigrain" }), "multigrain");
  assert.equal(itemQty({ qty: 3 }), 3);
  assert.equal(itemQty({ quantity: 3 }), 3);

  // A line carrying neither identity is unknown, not guessed into a bucket.
  assert.equal(itemSlug({ name: "Protein Rich Bread" }), null);
});
