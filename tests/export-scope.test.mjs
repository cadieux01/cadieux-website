// Regression tests for the admin CSV export's scope.
//
// Runs on Node's built-in test runner with no framework and no new
// devDependencies: `npm test`. Node strips the types off the imported
// .ts module at load time, which is why src/lib/export-scope.ts must
// stay free of "@/…" imports — an alias in there would need a bundler
// and these tests would quietly stop being runnable.
//
// THE BUG BEING PINNED. The orders board shows at most DEFAULT_LIMIT
// (250) of 718 rows. Both export buttons passed the board's rows
// straight to the CSV builder, so Export produced a 250-row file and
// said nothing about the 468 it dropped. The first test below is the
// one that fails against that wiring.

import { test } from "node:test";
import assert from "node:assert/strict";

import { resolveExportScope, exportScopeNote } from "../src/lib/export-scope.ts";

const DEFAULT_LIMIT = 250;
const TOTAL_ORDERS = 718;

const rowsUpTo = (n) => Array.from({ length: n }, (_, i) => ({ id: `o${i}` }));

test("bounded board exports the whole table, not DEFAULT_LIMIT", async () => {
  const board = rowsUpTo(DEFAULT_LIMIT);
  let fetchedAll = false;

  const scope = await resolveExportScope({
    loaded: board,
    total: TOTAL_ORDERS,
    truncated: true,
    label: "orders",
    fetchAll: async () => {
      fetchedAll = true;
      return rowsUpTo(TOTAL_ORDERS);
    },
    applyFilters: (rows) => rows,
  });

  // The assertion the old wiring fails: it would hand back the board's
  // 250 rows and never call fetchAll at all.
  assert.equal(scope.rows.length, TOTAL_ORDERS);
  assert.notEqual(scope.rows.length, DEFAULT_LIMIT);
  assert.equal(fetchedAll, true);
  assert.match(scope.note, /^All 718 orders \(complete/);
});

test("unbounded board exports what it holds without a second fetch", async () => {
  const board = rowsUpTo(TOTAL_ORDERS);
  let calls = 0;

  const scope = await resolveExportScope({
    loaded: board,
    total: TOTAL_ORDERS,
    truncated: false,
    label: "orders",
    fetchAll: async () => {
      calls += 1;
      return [];
    },
    applyFilters: (rows) => rows,
  });

  assert.equal(scope.rows.length, TOTAL_ORDERS);
  assert.equal(calls, 0, "must not re-fetch when the board already has it all");
});

test("the operator's filters still narrow the file, and are named in it", async () => {
  const scope = await resolveExportScope({
    loaded: rowsUpTo(DEFAULT_LIMIT),
    total: TOTAL_ORDERS,
    truncated: true,
    label: "orders",
    fetchAll: async () => rowsUpTo(TOTAL_ORDERS),
    // Stands in for the board's status/day/zone/query predicates.
    applyFilters: (rows) => rows.slice(0, 43),
  });

  assert.equal(scope.rows.length, 43);
  // A 43-row file must not be readable as "that is all there ever was".
  assert.equal(
    scope.note,
    "43 of 718 orders — current filters applied, board limit NOT applied",
  );
});

test("a failed full fetch writes nothing rather than a partial file", async () => {
  await assert.rejects(
    resolveExportScope({
      loaded: rowsUpTo(DEFAULT_LIMIT),
      total: TOTAL_ORDERS,
      truncated: true,
      label: "orders",
      fetchAll: async () => {
        throw new Error("network");
      },
      applyFilters: (rows) => rows,
    }),
    /network/,
  );
});

test("exportScopeNote distinguishes complete from filtered", () => {
  assert.match(
    exportScopeNote({ written: 718, total: 718, label: "orders" }),
    /complete/,
  );
  assert.match(
    exportScopeNote({ written: 12, total: 1942, label: "subscriptions" }),
    /^12 of 1942 subscriptions/,
  );
});
