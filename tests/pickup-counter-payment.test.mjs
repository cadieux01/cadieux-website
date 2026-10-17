// Pickup is paid at the counter — and the 153 pickup orders that predate that
// rule keep the payment door they were given.
//
// Those two requirements pull in opposite directions, and the thing holding
// them apart is a DATE inside a business rule. That is unusual enough to be
// worth testing on both sides of, because the failure modes are silent in
// opposite ways:
//
//   • cutoff too late  → a new pickup order can still be paid online. Visible:
//                        money arrives, row says paid.
//   • cutoff too early → Pay Now vanishes from an unpaid order of a customer
//                        who was offered it. INVISIBLE. They cannot tell us
//                        the button is missing, and 116 rows are in range.
//
// So the boundary cases below are not pedantry, and `movedEarlier` at the
// bottom is a tripwire rather than a test of behaviour.

import { test } from "node:test";
import assert from "node:assert/strict";

import "./_alias-hook.mjs";

// order-payable.ts imports nothing (deliberately — see its header), so a
// static import resolves without the alias hook.
import {
  PICKUP_ONLINE_PAYMENT_CUTOFF_ISO,
  isPayableOnline,
} from "../src/lib/order-payable.ts";

// cod-settlement.ts imports @/lib/payment-label, so this MUST be a top-level
// `await import`: Node links the whole static graph before evaluating any
// module body, so the hook above has not run yet when static imports resolve.
// The failure reads as ERR_MODULE_NOT_FOUND — a missing file, not an ordering
// problem — which is why this is spelled out rather than left to be rediscovered.
const { settlementWording, codMethodLabel } = await import(
  "../src/lib/cod-settlement.ts"
);

const CUTOFF_MS = Date.parse(PICKUP_ONLINE_PAYMENT_CUTOFF_ISO);

const iso = (ms) => new Date(ms).toISOString();
/** A row from the grandfathered set: one of the 116 unpaid pickup orders. */
const OLD_PICKUP = {
  payment_method: "cod",
  payment_status: "pending",
  fulfillment_type: "pickup",
  created_at: iso(CUTOFF_MS - 7 * 24 * 60 * 60 * 1000),
};
/** A pickup order placed under the new rule. */
const NEW_PICKUP = { ...OLD_PICKUP, created_at: iso(CUTOFF_MS + 60_000) };

test("the cutoff is a parseable instant", () => {
  assert.ok(Number.isFinite(CUTOFF_MS), PICKUP_ONLINE_PAYMENT_CUTOFF_ISO);
});

test("the 116: an unpaid pickup order from before the cutoff KEEPS Pay Now", () => {
  assert.equal(isPayableOnline(OLD_PICKUP), true);
});

test("a pickup order placed under the new rule is not payable online", () => {
  assert.equal(isPayableOnline(NEW_PICKUP), false);
});

test("the razorpay/created pickup shape is refused too, not just cod", () => {
  // The 4 mid-payment rows are this shape. They are all older than the cutoff,
  // so they keep their resume door; a NEW one would not get one.
  assert.equal(
    isPayableOnline({
      ...OLD_PICKUP,
      payment_method: "razorpay",
      payment_status: "created",
    }),
    true,
  );
  assert.equal(
    isPayableOnline({
      ...NEW_PICKUP,
      payment_method: "razorpay",
      payment_status: "created",
    }),
    false,
  );
});

test("the boundary: at the cutoff instant refused, one ms before allowed", () => {
  assert.equal(
    isPayableOnline({ ...OLD_PICKUP, created_at: iso(CUTOFF_MS) }),
    false,
  );
  assert.equal(
    isPayableOnline({ ...OLD_PICKUP, created_at: iso(CUTOFF_MS - 1) }),
    true,
  );
});

test("delivery orders are untouched on both sides of the cutoff", () => {
  for (const created_at of [OLD_PICKUP.created_at, NEW_PICKUP.created_at]) {
    assert.equal(
      isPayableOnline({ ...OLD_PICKUP, fulfillment_type: "delivery", created_at }),
      true,
    );
    // Legacy rows carry NULL and mean delivery.
    assert.equal(
      isPayableOnline({ ...OLD_PICKUP, fulfillment_type: null, created_at }),
      true,
    );
    // And a caller that does not project the column at all.
    assert.equal(
      isPayableOnline({
        payment_method: "cod",
        payment_status: "pending",
        created_at,
      }),
      true,
    );
  }
});

test("a pickup row with no usable created_at reads as grandfathered", () => {
  // Deliberate asymmetry, not an oversight: leaving the button on is the
  // recoverable error. A caller that forgets to project created_at makes the
  // guard stop firing, never misfire. Both spellings of "no value" — absent
  // from the projection, and present-but-null — must land the same way.
  assert.equal(
    isPayableOnline({ ...OLD_PICKUP, created_at: undefined }),
    true,
  );
  assert.equal(isPayableOnline({ ...OLD_PICKUP, created_at: null }), true);
  assert.equal(isPayableOnline({ ...OLD_PICKUP, created_at: "" }), true);
  assert.equal(isPayableOnline({ ...OLD_PICKUP, created_at: "soon" }), true);
});

test("fulfillment_type is matched case- and whitespace-insensitively", () => {
  for (const v of ["Pickup", "PICKUP", "  pickup  "]) {
    assert.equal(
      isPayableOnline({ ...NEW_PICKUP, fulfillment_type: v }),
      false,
      v,
    );
  }
});

test("the payment-status and method gates still come first", () => {
  // The pickup rule is a veto on top of the existing allowlists, so it must not
  // make anything payable that was not payable before.
  assert.equal(isPayableOnline({ ...OLD_PICKUP, payment_status: "paid" }), false);
  assert.equal(
    isPayableOnline({ ...OLD_PICKUP, payment_status: "abandoned" }),
    false,
  );
  assert.equal(
    isPayableOnline({ ...OLD_PICKUP, payment_method: "counter" }),
    false,
  );
});

test("the tripwire: the cutoff may be moved later, never earlier", () => {
  // Moving it earlier retroactively strips Pay Now from real unpaid orders —
  // the one change to this file that cannot be noticed from the outside. The
  // floor is IST midnight on the day the rule was made (18 Oct 2026); no row
  // created before then was placed under it.
  const RULE_MADE_MS = Date.parse("2026-10-18T00:00:00+05:30");
  assert.ok(
    CUTOFF_MS >= RULE_MADE_MS,
    `cutoff ${PICKUP_ONLINE_PAYMENT_CUTOFF_ISO} predates the decision it encodes`,
  );
});

/* ── The wording ──────────────────────────────────────────────────────── */

test("settlementWording: pickup says counter, delivery is left exactly as it was", () => {
  const pickup = settlementWording("pickup");
  assert.match(pickup.auditSubject, /[Pp]ickup/);
  assert.match(pickup.tooltipSubject, /pickup/);
  assert.doesNotMatch(pickup.auditSubject, /COD/);
  assert.doesNotMatch(pickup.tooltipSubject, /COD/);

  // The delivery strings are a REGRESSION assertion, byte-for-byte: the audit
  // line "COD settled by Cash" is what months of existing audit_log rows read,
  // and operators grep it.
  for (const v of ["delivery", null, undefined, "", "DELIVERY"]) {
    const w = settlementWording(v);
    assert.equal(w.auditSubject, "COD settled", String(v));
    assert.equal(w.tooltipSubject, "this COD order's cash", String(v));
  }
});

test("the composed audit line reads correctly for both fulfillments", () => {
  // The route builds `${auditSubject} by ${codMethodLabel(m)}`. Compose it here
  // the same way rather than predicting the result from memory.
  const line = (f, m) => `${settlementWording(f).auditSubject} by ${codMethodLabel(m)}`;
  assert.equal(line("delivery", "cash"), "COD settled by Cash");
  assert.equal(line(null, "cash_upi"), "COD settled by Cash and UPI");
  assert.equal(
    line("pickup", "cash"),
    "Pickup counter payment settled by Cash",
  );
  assert.equal(
    line("pickup", "upi"),
    "Pickup counter payment settled by UPI",
  );
});
