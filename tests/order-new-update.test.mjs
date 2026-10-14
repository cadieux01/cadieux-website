// The New Update rule, which is the only status on the admin board that is
// decided by a COMPARISON rather than read out of a column.
//
// The rule in one line: a note was written AFTER the status was last set.
// Not "this order has a note" — that version has no off switch, so an order
// touched once would read New Update forever and the operator would learn to
// ignore the word. Every test below is really defending that distinction.
//
// src/lib/order-new-update.ts has no imports, which is what lets this file
// load it through the @/ alias hook without dragging in Supabase.

import { test } from "node:test";
import assert from "node:assert/strict";

import "./_alias-hook.mjs";

// order-new-update.ts imports nothing, so a static import of it resolves
// without help.
import {
  NEW_UPDATE_STATUS,
  boardStatus,
  hasNewUpdate,
} from "../src/lib/order-new-update.ts";

// admin-shared.ts does use the `@/` alias, and this MUST be a top-level
// `await import` rather than a static one. Node resolves and links the whole
// static graph BEFORE evaluating any module body, so the hook above would not
// have run yet and the alias would still be unresolvable — the failure is
// ERR_MODULE_NOT_FOUND on the import, which reads like a missing file rather
// than an ordering problem. Deferring it to a dynamic import is what lets the
// hook be registered first.
const { SETTABLE_ORDER_STATUSES, orderStatusSelectModel } = await import(
  "../src/lib/admin-shared.ts"
);

const T0 = "2026-10-12T09:00:00.000Z";
const T1 = "2026-10-12T10:00:00.000Z";
const T2 = "2026-10-12T11:00:00.000Z";
const T3 = "2026-10-12T12:00:00.000Z";

test("no note is not a new update", () => {
  assert.equal(hasNewUpdate({ status_updated_at: T0 }), false);
  assert.equal(hasNewUpdate({ status_updated_at: T0, last_team_note: null }), false);
});

test("a note written after the status was set flips it", () => {
  assert.equal(
    hasNewUpdate({
      status_updated_at: T0,
      last_team_note: { created_at: T1 },
    }),
    true,
  );
});

test("a note written BEFORE the status was set does not", () => {
  // This is the self-cancelling half of the rule and the reason the flag is
  // usable at all: the operator opens a flagged order, sets it back to
  // Delivered, the PATCH stamps status_updated_at past the note, and the row
  // goes back to Delivered on its own. No "mark as read" button, no second
  // piece of state that can desync from the first.
  assert.equal(
    hasNewUpdate({
      status_updated_at: T1,
      last_team_note: { created_at: T0 },
    }),
    false,
  );
});

test("equal timestamps do not flip it — the comparison is STRICTLY after", () => {
  // Writing a note and setting a status in the same millisecond is not a
  // real sequence of events; it is a clock collision. Treating it as a new
  // update would make a row the operator just finished with re-flag itself.
  assert.equal(
    hasNewUpdate({
      status_updated_at: T0,
      last_team_note: { created_at: T0 },
    }),
    false,
  );
});

test("a missing status stamp with a note present FAILS OPEN", () => {
  // Deliberate, and the direction matters. status_updated_at is nullable and
  // backfilled; a null there means we do not know when the status was set.
  // Showing New Update on a row nobody needs to look at wastes a glance.
  // Hiding it on a row somebody wrote a note about loses the note. So the
  // unknown case shows the flag.
  assert.equal(hasNewUpdate({ last_team_note: { created_at: T0 } }), true);
  assert.equal(
    hasNewUpdate({ status_updated_at: null, last_team_note: { created_at: T0 } }),
    true,
  );
});

test("an unparseable timestamp is treated as absent, not as epoch 0", () => {
  // Date.parse returns NaN rather than throwing, and NaN loses every
  // comparison silently. A junk note stamp must read as "no note", not as a
  // note from 1970 that beats every status stamp ever written.
  assert.equal(
    hasNewUpdate({ status_updated_at: T0, last_team_note: { created_at: "" } }),
    false,
  );
  assert.equal(
    hasNewUpdate({
      status_updated_at: T0,
      last_team_note: { created_at: "not a date" },
    }),
    false,
  );
  // Junk in the STATUS stamp falls back to the same fail-open rule as null.
  assert.equal(
    hasNewUpdate({
      status_updated_at: "not a date",
      last_team_note: { created_at: T0 },
    }),
    true,
  );
});

test("boardStatus REPLACES the stored status, it does not sit beside it", () => {
  // The whole reason New Update could be added without breaking the Status
  // dropdown's counts: every row still resolves to exactly ONE value, so the
  // buckets still partition. `expired` is the counter-example — it sits
  // beside the stored status and double-counts, which is why it needs its
  // own arm in matchesOrderFilter and this does not.
  assert.equal(
    boardStatus({ status: "delivered", status_updated_at: T0, last_team_note: { created_at: T1 } }),
    NEW_UPDATE_STATUS,
  );
  assert.notEqual(
    boardStatus({ status: "delivered", status_updated_at: T0, last_team_note: { created_at: T1 } }),
    "delivered",
  );
});

test("boardStatus passes the stored status through, lowercased", () => {
  assert.equal(boardStatus({ status: "Confirmed", status_updated_at: T0 }), "confirmed");
  assert.equal(boardStatus({ status: "ready_for_pickup", status_updated_at: T0 }), "ready_for_pickup");
  // A row with no status at all resolves to "" rather than throwing or
  // inventing one. The board's Select treats that as "not in the options"
  // and falls through to its escape hatch.
  assert.equal(boardStatus({ status_updated_at: T0 }), "");
  assert.equal(boardStatus({ status: null, status_updated_at: T0 }), "");
});

test("a cancelled order with an older note stays cancelled", () => {
  // The case that made the mobile self-cancel route a blocker. That path
  // wrote `cancelled` without stamping status_updated_at, so a customer
  // cancelling an order that already carried a note left the stamp days in
  // the past and the board lit the row up as New Update — pointing at a note
  // nobody had just written. The fix is at the WRITE; this asserts the read
  // behaves correctly once the write is honest.
  assert.equal(
    boardStatus({
      status: "cancelled",
      status_updated_at: T1,
      last_team_note: { created_at: T0 },
    }),
    "cancelled",
  );
});

test("the escape hatch: re-setting the status a row ALREADY holds clears it", () => {
  // Raja's report — "once a note exists I cannot set Delivered, it stays on
  // New Update" — and the half of the original spec that was never built:
  // "if somebody deliberately changes the New Update status to Delivered, it
  // will stay as Delivered."
  //
  // There is no new column and no acknowledge button. The deliberate status
  // change IS the acknowledgement, because it moves status_updated_at past
  // the note. This test is the loop, in order:
  const order = {
    status: "delivered",
    status_updated_at: T0,
    last_team_note: { created_at: T1 },
  };

  // 1. delivered, note written after the status was set -> flagged.
  assert.equal(boardStatus(order), NEW_UPDATE_STATUS);

  // 2. the operator picks Delivered again. The row is ALREADY delivered, so
  //    `status` does not change and the stamp is the ONLY thing that moves.
  //    That is precisely why the board must carry status_updated_at through
  //    its optimistic update: flipping `status` alone would be a no-op here
  //    and the row would not appear to respond at all.
  const acknowledged = { ...order, status_updated_at: T2 };

  // 3. it STAYS Delivered. The note is untouched and still on the order.
  assert.equal(boardStatus(acknowledged), "delivered");
  assert.equal(hasNewUpdate(acknowledged), false);
  assert.equal(acknowledged.last_team_note.created_at, T1);

  // 4. and the flag can come back — acknowledging is not suppressing.
  assert.equal(
    boardStatus({ ...acknowledged, last_team_note: { created_at: T3 } }),
    NEW_UPDATE_STATUS,
  );
});

// ── The row's status dropdown, as data ──────────────────────────────────────
//
// Raja: "add new update in dropdown, don't remove." It had been moved to the
// badge only, which made the control disagree with the word he reads the row
// by. These assert the version that puts it back WITHOUT re-opening the defect
// that caused the move — see orderStatusSelectModel in src/lib/admin-shared.ts.

const labelsOf = (m) => m.options.map((o) => o.label);
const valuesOf = (m) => m.options.map((o) => o.value);

test("flagged row: the dropdown READS New Update and OFFERS it", () => {
  const flagged = {
    status: "delivered",
    status_updated_at: T0,
    last_team_note: { created_at: T1 },
  };
  const m = orderStatusSelectModel(flagged);

  // Displays "New Update". Not Delivered, not blank. Blank is the failure
  // mode worth naming: components/ui/Select falls back to its PLACEHOLDER
  // when the bound value is absent from the options, so "offered" and
  // "displayed" are the same requirement here, not two.
  assert.equal(m.value, NEW_UPDATE_STATUS);
  assert.ok(valuesOf(m).includes(NEW_UPDATE_STATUS));
  assert.ok(labelsOf(m).includes("New Update"));

  // Visibly, and first — it is the current value, so it heads the menu.
  assert.equal(valuesOf(m)[0], NEW_UPDATE_STATUS);

  // The four real statuses remain selectable below it.
  for (const s of SETTABLE_ORDER_STATUSES) {
    assert.ok(valuesOf(m).includes(s), `${s} must stay selectable`);
  }

  // And the row's REAL status is still legible, which is the one thing
  // showing New Update in the trigger would otherwise cost.
  assert.ok(labelsOf(m).includes("Delivered (current)"));
});

test("flagged row -> pick Delivered -> writes, flag clears, stays Delivered", () => {
  const order = {
    status: "delivered",
    status_updated_at: T0,
    last_team_note: { created_at: T1 },
  };

  // 1. Flagged: the dropdown reads New Update.
  assert.equal(orderStatusSelectModel(order).value, NEW_UPDATE_STATUS);

  // 2. The operator picks Delivered. It is a SETTABLE status, so the row's
  //    onChange does not refuse it and the PATCH goes out — the refusal
  //    keys on NEW_UPDATE_STATUS, which this is not.
  assert.ok(SETTABLE_ORDER_STATUSES.includes("delivered"));
  assert.ok(!SETTABLE_ORDER_STATUSES.includes(NEW_UPDATE_STATUS));

  // 3. The write stamps status_updated_at past the note. `status` itself does
  //    not move — the row was already delivered — so the stamp is the entire
  //    effect, which is why the board must carry it through its optimistic
  //    update or nothing on screen responds.
  const written = { ...order, status_updated_at: T2 };

  // 4. Flag cleared, and it STAYS Delivered. New Update is gone from the menu
  //    entirely, so it cannot be re-picked on a row that no longer has one.
  const after = orderStatusSelectModel(written);
  assert.equal(after.value, "delivered");
  assert.ok(!valuesOf(after).includes(NEW_UPDATE_STATUS));
  assert.deepEqual(labelsOf(after), [
    "Pending",
    "Confirmed",
    "Delivered",
    "Cancelled",
  ]);
  // The suffix is a flagged-row affordance only; unflagged, the checkmark
  // already says which one is current.
  assert.ok(!labelsOf(after).some((l) => l.includes("(current)")));
  // The note is untouched — acknowledging is not deleting.
  assert.equal(written.last_team_note.created_at, T1);
});

test("New Update NEVER arrives through the stored-value fallback", () => {
  // The original defect in one assertion. The fallback appends the CURRENT
  // value when the four settable ones do not cover it; pointed at a computed
  // value it silently taught the menu an unstorable status AND hid the real
  // one. It must key on the stored column, which can never hold "new_update".
  //
  // The proof that it does: a row flagged AND carrying an unlisted stored
  // status gets BOTH entries. If the fallback were reading the displayed
  // value it would see new_update already present and skip — and
  // ready_for_pickup would vanish from the menu of the row that holds it.
  const m = orderStatusSelectModel({
    status: "ready_for_pickup",
    status_updated_at: T0,
    last_team_note: { created_at: T1 },
  });
  assert.equal(m.value, NEW_UPDATE_STATUS);
  assert.deepEqual(valuesOf(m), [
    NEW_UPDATE_STATUS,
    "pending",
    "confirmed",
    "delivered",
    "cancelled",
    "ready_for_pickup",
  ]);
  assert.ok(labelsOf(m).includes("Ready for pickup (current)"));

  // Exactly one New Update row. A second would mean both paths fired.
  assert.equal(
    valuesOf(m).filter((v) => v === NEW_UPDATE_STATUS).length,
    1,
  );
});

test("the fallback still works for unlisted stored statuses, unflagged", () => {
  // The job it was actually there for. Without it the Select is handed a value
  // absent from its own options and renders the placeholder, so the board goes
  // blank about a row it is about to overwrite.
  const m = orderStatusSelectModel({
    status: "picked_up",
    status_updated_at: T1,
    last_team_note: { created_at: T0 },
  });
  assert.equal(m.value, "picked_up");
  assert.ok(valuesOf(m).includes("picked_up"));
  assert.ok(!valuesOf(m).includes(NEW_UPDATE_STATUS));
});

test("a row with no stored status at all gets no empty option", () => {
  // boardStatus returns "" here. An option with value "" would render as a
  // blank row in the menu that an operator can pick, so the fallback is
  // guarded on a non-empty string.
  const m = orderStatusSelectModel({ status: null, status_updated_at: T0 });
  assert.equal(m.value, "");
  assert.ok(!valuesOf(m).includes(""));
  assert.deepEqual(valuesOf(m), [
    "pending",
    "confirmed",
    "delivered",
    "cancelled",
  ]);
});
