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
import { ORDER_EXPIRY_MS, computeOrderState } from "../src/lib/order-state.ts";
import {
  confirmNeedsPaymentOverride,
  isRiderBoundStatus,
} from "../src/lib/order-confirm-guard.ts";

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

// THE TIMESTAMP TRAP THAT COST A 13x UNDERCOUNT.
//
// computeOrderState answers "expired" on an unparseable created_at — deliberately,
// but indistinguishably from a real expiry. No throw, no log. So a date bug in a
// harness reads as a finding, and a Pay Now fix got reported as worth one order
// when it was worth thirteen.
//
// The guessable version of this lesson is wrong, which is why it is pinned in code
// instead of prose. Postgres's raw `2026-10-04 06:12:33.91+00` PARSES — V8's
// lenient non-ISO path accepts a two-digit offset. What breaks it is
// HALF-NORMALISING: add the `T` and you are in strict ISO-8601, where `+00` is not
// a legal offset, and you have converted a working string into NaN. Strip the
// offset instead and it parses as LOCAL time, silently moving the instant by 5.5 h
// here. Convert the offset too, or leave the string alone.
console.log("\nTIMESTAMP SHAPES — the failure is half-normalising, not Postgres:");

function checkParse(label: string, raw: string, shouldParse: boolean) {
  const ok = Number.isFinite(Date.parse(raw)) === shouldParse;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(52)} ` +
      `${shouldParse ? "parses" : "NaN   "}${ok ? "" : `  ← Date.parse disagrees`}`,
  );
}

checkParse("raw Postgres 'YYYY-MM-DD hh:mm:ss.sss+00'", "2026-10-04 06:12:33.91+00", true);
checkParse("same but with 'T' — strict ISO rejects '+00'", "2026-10-04T06:12:33.91+00", false);
checkParse("'T' with a full '+00:00' offset", "2026-10-04T06:12:33.91+00:00", true);
checkParse("'T' with 'Z'", "2026-10-04T06:12:33.91Z", true);

// Offset dropped → parsed as local time. Not NaN, just the wrong instant, which is
// the harder failure to notice. Asserted as a real inequality rather than a
// hard-coded 5.5 h so this still means something on a UTC machine.
{
  const naive = Date.parse("2026-10-04 06:12:33.91");
  const utc = Date.parse("2026-10-04T06:12:33.91Z");
  const offsetMin = new Date("2026-10-04T06:12:33.91Z").getTimezoneOffset();
  const ok = naive - utc === offsetMin * 60_000;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${"offset dropped → read as LOCAL time".padEnd(52)} ` +
      `${(naive - utc) / 60_000} min from UTC`,
  );
}

// And the consequence, through the real function: a 2-day-old pending order is
// live, but fed the half-normalised string computeOrderState calls it expired.
const twoDays = new Date(NOW - 2 * 86_400_000).toISOString();
const broken = twoDays.replace(/\.\d+Z$/, ".91+00"); // 'T' kept, offset left 2-digit
for (const [label, got, want] of [
  ["2-day pending, half-normalised → MISREAD as expired", computeOrderState({ status: "pending", created_at: broken }, NOW), "expired"],
  ["2-day pending, proper ISO → pending", computeOrderState({ status: "pending", created_at: twoDays }, NOW), "pending"],
  ["2-day pending, raw Postgres form → pending", computeOrderState({ status: "pending", created_at: twoDays.replace("T", " ").replace(/\.\d+Z$/, ".91+00") }, NOW), "pending"],
] as const) {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${label.padEnd(52)} ${got}${ok ? "" : `  ← expected ${want}`}`);
}

// WHICH ARROWS THE ADMIN GUARD REFUSES. Same file, because the two decisions share
// the same prod evidence and a reader checking one will want the other. The matrix
// matters more than either predicate alone: the first cut of the guard covered
// `confirmed` only, and a dropdown made that a suggestion.
console.log("\nADMIN GUARD — which target statuses are refused on an unpaid online order:");
for (const [status, want] of [
  ["confirmed", true],
  ["preparing", true],
  ["out_for_delivery", true],
  ["OUT_FOR_DELIVERY", true],
  [" preparing ", true],
  // Never refused: recording a delivery that happened, or cancelling a dead order.
  ["delivered", false],
  ["cancelled", false],
  ["placed", false],
  ["ready_for_pickup", false],
  ["picked_up", false],
  // Legacy alias — both routes normalise it to out_for_delivery BEFORE asking, so
  // this must answer false and the normalisation must stay.
  ["dispatched", false],
  ["", false],
  [null, false],
] as const) {
  const got = isRiderBoundStatus(status);
  const ok = got === want;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${`→ ${status === null ? "null" : `"${status}"`}`.padEnd(52)} ` +
      `${got ? "REFUSE " : "allow  "}${ok ? "" : `  ← expected ${want}`}`,
  );
}

console.log("\nAND ON WHICH PAYMENT STATES — the method must be online too:");
for (const [method, status, want] of [
  ["razorpay", "created", true],
  ["razorpay", "abandoned", true],
  ["razorpay", "failed", true],
  ["RAZORPAY", " Created ", true],
  // The case the whole business runs on. Must never ask a question.
  ["cod", "pending", false],
  ["cod", "created", false],
  // razorpay+pending has never existed on prod; treated as ordinary, not blocked.
  ["razorpay", "pending", false],
  ["razorpay", "paid", false],
  ["razorpay", "paid_orphaned", false],
  [null, null, false],
] as const) {
  const got = confirmNeedsPaymentOverride({ payment_method: method, payment_status: status });
  const ok = got === want;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "ok  " : "FAIL"}  ${`${method ?? "null"} / ${status ?? "null"}`.padEnd(52)} ` +
      `${got ? "REFUSE " : "allow  "}${ok ? "" : `  ← expected ${want}`}`,
  );
}

console.log(
  failures === 0
    ? "\nAll cases as expected.\n"
    : `\n${failures} CASE(S) WRONG — do not ship.\n`,
);
process.exit(failures === 0 ? 0 : 1);
