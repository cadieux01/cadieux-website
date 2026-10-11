// The audit log's Target column, over the four row shapes that are actually
// on prod.
//
// `audit_log.target_label` is a snapshot written at event time, and it CANNOT
// be corrected: the table is append-only at the database level (triggers
// audit_log_no_update / audit_log_no_delete raise P0001), so the backfill was
// abandoned — see docs/audit-log-relabel-WONTRUN.md. The code is instead
// resolved from `target_id` on every read by GET /api/admin/audit-log, which
// sets `target_code`, and targetDisplay() combines the two.
//
// Every row below was fetched from prod (uejagupcwevadfhfuadv) on 2026-10-10,
// `target_code` included as the live route returned it. A hand-written
// fixture would only prove that the test agrees with itself.

import { test } from "node:test";
import assert from "node:assert/strict";

import { targetDisplay } from "../src/lib/audit-target.ts";

test("an order row shows the code, not the UUID slice it stored", () => {
  // All 10 audit events for order 5fa927fd-… stored '#5fa927fd'. The slice is
  // noise once the code is known, and the full target_id is rendered beneath
  // the cell anyway.
  assert.equal(
    targetDisplay({ target_label: "#5fa927fd", target_code: "OLF55" }),
    "OLF55",
  );
});

test("a subscription row keeps the product name the code cannot carry", () => {
  // 128 of the 131 relabellable subscription rows carry a product name and
  // nothing else on the row does. This is the approved prefix variant's exact
  // output, produced on render instead of by an UPDATE.
  assert.equal(
    targetDisplay({
      target_label: "Protein Rich Bread",
      target_code: "OLS66",
    }),
    "OLS66 — Protein Rich Bread",
  );
  // ...and the 3 that carry a slice instead drop it, like the order rows.
  assert.equal(
    targetDisplay({ target_label: "sub f2eaaadd", target_code: "OLS66" }),
    "OLS66",
  );
});

test("an orphan keeps its stored label — the slice is all that is known", () => {
  // 155 order and 8 subscription rows point at a target that no longer
  // exists, so nothing resolves and target_code is null. Falling back to the
  // stored label is the honest answer; inventing 'Unknown' would not be.
  assert.equal(
    targetDisplay({ target_label: "#00000000", target_code: null }),
    "#00000000",
  );
  // Nothing stored and nothing resolved: empty, and the cell renders "—".
  assert.equal(targetDisplay({ target_label: null, target_code: null }), "");
});

test("a row written since the writer fix is not labelled twice", () => {
  // New rows store the code themselves, so the stored label already begins
  // with it. 'OLF55 — OLF55' would be the bug.
  assert.equal(
    targetDisplay({ target_label: "OLF55", target_code: "OLF55" }),
    "OLF55",
  );
  assert.equal(
    targetDisplay({
      target_label: "OLS66 — Protein Rich Bread",
      target_code: "OLS66",
    }),
    "OLS66 — Protein Rich Bread",
  );
});
