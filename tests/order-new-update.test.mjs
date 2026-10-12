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

import {
  NEW_UPDATE_STATUS,
  boardStatus,
  hasNewUpdate,
} from "../src/lib/order-new-update.ts";

const T0 = "2026-10-12T09:00:00.000Z";
const T1 = "2026-10-12T10:00:00.000Z";

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
