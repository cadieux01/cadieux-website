// An admin order edit must only post `total_amount` when the operator moved
// something the total is made of.
//
// The incident these cases are drawn from: the orders-list projection omitted
// `delivery_fee`, so EditOrderPanel opened with a fee input of 0 (an absent
// column and a genuine zero are indistinguishable after `?? 0`), derived an
// items-only total, and the old gate — `effectiveTotal !== oldTotal` — posted
// it on saves where only the delivery date had changed. The fee column itself
// was never sent, because the panel compared its zero against the same absent
// column and found them equal, so the row ended up disagreeing with itself:
// right fee, total missing the fee.
//
// Both halves are fixed (the projection and this gate). These cases pin the
// gate, because the projection is the kind of thing a future refactor trims
// without noticing, and `delivery_fee?: number | null` means tsc will not say
// a word when it does.

import { test } from "node:test";
import assert from "node:assert/strict";

import { totalAmountToPost } from "../src/lib/order-edit-total.ts";

// OLF631 — the case that must keep working. Items AND date changed in one
// save: 2 x 60 = 120 of bread plus the order's real 30 fee. The total has to
// land on 150, not on the 120 subtotal and not on the stored figure.
test("items and date changed in one save posts subtotal + fee", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: true,
      feeChanged: false,
      totalOverridden: false,
      effectiveTotal: 150, // 120 items + 30 fee
      storedTotal: 180,
    }),
    150,
  );
});

// The 22 corrupting edits, in one assertion. OLF470's 9 Oct save: a 150 order
// (120 + 30 fee) edited from the board, fee input defaulted to 0, so the panel
// offered 120 against a stored 150. The old gate saw a difference and posted;
// this one must decline, because nothing about the money was touched.
test("a date-only save does not post a total, even a differing one", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: false,
      feeChanged: false,
      totalOverridden: false,
      effectiveTotal: 120, // fee missing from the draft
      storedTotal: 150,
    }),
    null,
  );
});

// Same save once the projection carries the fee: the draft now agrees with the
// row, so this is null for two independent reasons. Worth pinning separately —
// it is what proves the two fixes do not depend on each other.
test("a date-only save with the fee loaded posts nothing", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: false,
      feeChanged: false,
      totalOverridden: false,
      effectiveTotal: 150,
      storedTotal: 150,
    }),
    null,
  );
});

test("changing the fee alone posts the new total", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: false,
      feeChanged: true,
      totalOverridden: false,
      effectiveTotal: 165, // fee 30 -> 45
      storedTotal: 150,
    }),
    165,
  );
});

// The override is the one path allowed to move money with no items or fee
// change behind it: the operator ticked the box and typed the figure.
test("an explicit total override posts on its own", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: false,
      feeChanged: false,
      totalOverridden: true,
      effectiveTotal: 140,
      storedTotal: 150,
    }),
    140,
  );
});

// Swapping two equally-priced loaves is a real items edit that owes no money
// movement. Suppressed so the server's money-delta note cannot fire on it.
test("an items edit that nets to the same total posts nothing", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: true,
      feeChanged: false,
      totalOverridden: false,
      effectiveTotal: 150,
      storedTotal: 150,
    }),
    null,
  );
});

// A paid order holds a draft whose item inputs are disabled, and the save
// handler drops `items` from the body. `itemsPosted` carries that decision, so
// a stale draft cannot re-price a captured order through the back door.
test("a locked paid order cannot move money via its stale items draft", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: false, // changed, but locked -> not posted
      feeChanged: false,
      totalOverridden: false,
      effectiveTotal: 120,
      storedTotal: 150,
    }),
    null,
  );
});

// Rounding: the gate must not post a figure that differs only below the paisa.
test("a sub-paisa difference is not a change", () => {
  assert.equal(
    totalAmountToPost({
      itemsPosted: true,
      feeChanged: false,
      totalOverridden: false,
      effectiveTotal: 150.001,
      storedTotal: 150,
    }),
    null,
  );
});
