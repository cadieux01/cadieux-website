// Walks mayAbandon() over every order shape the orders sweep can hand it.
//
//   node scripts/abandonable-check.ts
//
// NO ENV, NO DB, NO NETWORK — unlike its neighbours here, this one takes no
// --env-file and reads nothing. The predicate is pure, and the shapes that matter
// most are ones prod cannot currently supply: an `abandoned` write only becomes
// dangerous at the 7-day boundary, and nobody is going to wait a week to watch it
// cross. So the boundary is constructed exactly.
//
// WHY THIS DECISION GETS A HARNESS AT ALL. Every other branch of the sweep is
// recoverable by running it again. This one is not symmetrical: writing
// `abandoned` asserts that money stopped being owed, and it lands on rows where
// bread may already have gone out. A wrong `true` here is the sweeper telling an
// operator not to chase a debt. Both failure directions are checked below, and
// the asymmetry is why every ambiguous case must answer false.

import { mayAbandon } from "../src/lib/order-abandonable.ts";
import { ORDER_EXPIRY_MS } from "../src/lib/order-state.ts";

const NOW = Date.parse("2026-10-06T12:00:00.000Z");

/** created_at for a row of a given age, in days. */
function agedDays(days: number): string {
  return new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();
}

let failures = 0;

function check(
  label: string,
  row: { status?: string | null; created_at?: string | null },
  expected: boolean,
) {
  const got = mayAbandon(row, NOW, ORDER_EXPIRY_MS);
  const ok = got === expected;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(52)} ` +
      `${got ? "ABANDON" : "leave  "}${ok ? "" : `  ← expected ${expected}`}`,
  );
}

console.log(
  `\nmayAbandon(row, now, ORDER_EXPIRY_MS=${ORDER_EXPIRY_MS}ms = ` +
    `${ORDER_EXPIRY_MS / 86_400_000}d)\n`,
);

console.log("CANCELLED — dead by a human's decision, nothing to collect:");
check("cancelled, 1 minute old", { status: "cancelled", created_at: agedDays(0.0007) }, true);
check("cancelled, 400 days old", { status: "cancelled", created_at: agedDays(400) }, true);
check("CANCELLED (upper case)", { status: "CANCELLED", created_at: agedDays(9) }, true);
check("' cancelled ' (padded)", { status: " cancelled ", created_at: agedDays(9) }, true);
check("cancelled, created_at missing entirely", { status: "cancelled" }, true);

console.log("\nPENDING-ISH — only once past the resume window:");
check("pending, 0 days", { status: "pending", created_at: agedDays(0) }, false);
check("pending, 6.99 days", { status: "pending", created_at: agedDays(6.99) }, false);
check("pending, EXACTLY 7 days (strict >)", { status: "pending", created_at: new Date(NOW - ORDER_EXPIRY_MS).toISOString() }, false);
check("pending, 7 days + 1 ms", { status: "pending", created_at: new Date(NOW - ORDER_EXPIRY_MS - 1).toISOString() }, true);
check("pending, 30 days", { status: "pending", created_at: agedDays(30) }, true);
check("placed, 30 days", { status: "placed", created_at: agedDays(30) }, true);
check("PLACED (upper case), 30 days", { status: "PLACED", created_at: agedDays(30) }, true);

console.log(
  "\nEVERYTHING PAST PENDING — refused FOREVER, however old. These are the 24\n" +
    "rows on prod with cod_settled_method NULL; 15 of them were delivered:",
);
for (const status of [
  "confirmed",
  "preparing",
  "out_for_delivery",
  "dispatched",
  "delivered",
  "ready_for_pickup",
  "picked_up",
]) {
  check(`${status}, 400 days old`, { status, created_at: agedDays(400) }, false);
}

console.log("\nMISSING OR UNREADABLE INPUT — must never write off:");
check("pending, created_at null", { status: "pending", created_at: null }, false);
check("pending, created_at missing", { status: "pending" }, false);
check("pending, created_at unparseable", { status: "pending", created_at: "not a date" }, false);
check("pending, created_at empty string", { status: "pending", created_at: "" }, false);
check("status null", { status: null, created_at: agedDays(400) }, false);
check("status missing", { created_at: agedDays(400) }, false);
check("status empty string", { status: "", created_at: agedDays(400) }, false);
check("status unknown word", { status: "frobnicated", created_at: agedDays(400) }, false);
check("created_at in the FUTURE", { status: "pending", created_at: agedDays(-5) }, false);

console.log(
  failures === 0
    ? "\nAll cases as expected.\n"
    : `\n${failures} CASE(S) WRONG — do not ship.\n`,
);
process.exit(failures === 0 ? 0 : 1);
