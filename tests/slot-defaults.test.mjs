// What a picker may OFFER vs what it may PRE-SELECT.
//
// SLOTS is ordered Morning, Midday, Evening, and the first two are paused —
// so `SLOTS[0]` is a window nobody delivers in. Three pickers in
// RegisterOrderForm defaulted to it: the subscription bulk selector (via an
// unfiltered admin slot list) and the one-time slot field (whose admin branch
// forces every slot enabled, so "first enabled" meant "first", i.e. Morning).
//
// Nothing failed when that happened. The admin write paths gate on
// isValidSlotValue, which is pause-blind BY DESIGN so an operator can re-book
// a live row onto a paused window — so a paused default would have been
// accepted and stored silently. These tests are the only thing standing
// between SLOTS' display order and what a picker hands an operator.
//
// subscription-setup.ts imports via the `@/` alias, so this file registers
// the alias hook and then dynamically imports — a static import would resolve
// the whole graph before the hook was installed.

import { test } from "node:test";
import assert from "node:assert/strict";

import "./_alias-hook.mjs";

const { SLOTS, PAUSED_SLOTS, firstUnpausedSlot, isSlotPaused, isValidSlotValue } =
  await import("../src/lib/delivery-slots.ts");
const { TIME_SLOTS } = await import("../src/lib/subscription-setup.ts");

test("firstUnpausedSlot never returns a paused window", () => {
  assert.equal(isSlotPaused(firstUnpausedSlot()), false);
});

test("firstUnpausedSlot returns a storable slot value", () => {
  assert.equal(isValidSlotValue(firstUnpausedSlot()), true);
});

test("firstUnpausedSlot is DERIVED from PAUSED_SLOTS, not hardcoded", () => {
  // Recomputed here from first principles rather than compared to a literal:
  // a literal would still pass if the function were pinned to the evening
  // value, which is exactly the shape we are refusing.
  const expected = SLOTS.find((s) => !PAUSED_SLOTS.includes(s.value));
  assert.ok(expected, "every slot is paused — the fixture itself is wrong");
  assert.equal(firstUnpausedSlot(), expected.value);
});

test("the regression: it is NOT SLOTS[0] while SLOTS[0] is paused", () => {
  // Guarded so this test stays correct after an un-pause rather than
  // becoming a false failure.
  if (!isSlotPaused(SLOTS[0].value)) return;
  assert.notEqual(firstUnpausedSlot(), SLOTS[0].value);
});

test("the morning window is the specific value that used to be handed out", () => {
  // Pins the live configuration this fix was written against, so a change to
  // PAUSED_SLOTS surfaces here as a deliberate decision rather than silently
  // altering three defaults.
  assert.equal(SLOTS[0].value, "06:00-10:00");
  assert.equal(isSlotPaused("06:00-10:00"), true);
  assert.equal(isSlotPaused("10:00-14:00"), true);
  assert.equal(isSlotPaused("16:00-21:00"), false);
});

test("TIME_SLOTS[0] IS firstUnpausedSlot — the invariant the shared default rests on", () => {
  // RegisterOrderForm uses ONE default for both auth modes on the strength of
  // this equality. If TIME_SLOTS ever stops being SLOTS-minus-paused in SLOTS
  // order, the team-PIN branch silently changes behaviour.
  assert.equal(TIME_SLOTS[0], firstUnpausedSlot());
});

test("TIME_SLOTS contains no paused window", () => {
  for (const value of TIME_SLOTS) {
    assert.equal(isSlotPaused(value), false, `${value} is paused but offered`);
  }
});

test("TIME_SLOTS is exactly SLOTS minus the paused ones, in SLOTS order", () => {
  // The deny-list risk documented on PAUSED_SLOTS: a slot added to SLOTS and
  // not added to PAUSED_SLOTS becomes bookable silently. This pins the
  // relationship so the two lists cannot drift apart unnoticed.
  assert.deepEqual(
    TIME_SLOTS,
    SLOTS.filter((s) => !PAUSED_SLOTS.includes(s.value)).map((s) => s.value),
  );
});

test("every paused value is still a VALID value", () => {
  // Pausing must never become deletion: live rows hold these, and the admin
  // re-book path checks validity, not bookability.
  for (const value of PAUSED_SLOTS) {
    assert.equal(isValidSlotValue(value), true, `${value} is no longer storable`);
  }
});
