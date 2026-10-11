// The outbound WhatsApp/SMS prefill (src/lib/phone-utils.ts).
//
// BOTH halves of the greeting are routinely absent in prod, which is why
// this has four cases rather than one template:
//
//   - 74 of the customers rows have a null/blank full_name AND a phone, so
//     the admin can message them and there is no name to greet them by.
//   - Six of the ten ContactActions call sites are about a CUSTOMER, not an
//     order (the customers list, the customer detail, serviceability
//     requests), so there is no OLF/OLS to quote.
//
// EVERY STORED NAME BELOW IS COPIED VERBATIM FROM A PRODUCTION `customers`
// ROW unless marked [synthetic], including the double space inside
// "Avinash  Polamarasetty" and the phone number somebody typed into
// `full_name`. Counts quoted in the test names were measured over all 900
// named rows.
//
// ── the harness ──
// Every name case is a fixture that DECLARES the name it expects, and
// `check()` asserts two things about the rendered message:
//   1. it opens with exactly that name — full-string equality, so a
//      fixture expecting "Srinivas" is not satisfied by "Srinivasan";
//   2. no OTHER token of the stored name reaches the text, case-blind.
// (2) catches the regression (1) would wave through: a change that leaks
// the surname still "opens with" the right name. `leakedTokens` has its
// own negative controls at the bottom, because a leak detector that
// cannot fail proves nothing.

import { test } from "node:test";
import assert from "node:assert/strict";

import "./_alias-hook.mjs";

const { defaultContactMessage } = await import("../src/lib/phone-utils.ts");

const MID = "I'm messaging from Cadieux.";
const ORDER_ASK = "Do you have a minute to help me out with your order?";
const SPEAK_ASK = "Do you have a minute to speak?";

/** How the test reads a stored name — deliberately its own splitter, so a
 *  change to the implementation's tokeniser cannot silently agree with it. */
function storedTokens(stored) {
  return String(stored ?? "")
    .trim()
    .split(/[\s.]+/)
    .filter(Boolean);
}

/**
 * Tokens of `stored` that appear in `text` but are not part of `expected`.
 *
 * Single-character tokens are skipped: an initial "A" or "I" cannot be
 * told apart from the English in "a minute" or "I'm messaging", so
 * including them would report a leak on every message. Two characters and
 * up is checked, which keeps "Dr" and "KK" honest.
 */
function leakedTokens(stored, expected, text) {
  const kept = new Set(
    String(expected).toLowerCase().split(/\s+/).filter(Boolean),
  );
  return storedTokens(stored).filter((token) => {
    if (token.length < 2) return false;
    if (kept.has(token.toLowerCase())) return false;
    const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(text);
  });
}

/** Render, assert the exact text, assert nothing else of the name leaked. */
function check(stored, expected, orderCode = null) {
  const out = defaultContactMessage({ customerName: stored, orderCode });
  const lead = [expected, orderCode].filter(Boolean).join(" ");
  const ask = orderCode ? ORDER_ASK : SPEAK_ASK;
  assert.equal(
    out,
    `Hi${lead ? ` ${lead}` : ""}, ${MID} ${ask}`,
    `stored ${JSON.stringify(stored)}`,
  );
  assert.deepEqual(
    leakedTokens(stored, expected, out),
    [],
    `tokens of ${JSON.stringify(stored)} leaked into ${JSON.stringify(out)}`,
  );
  return out;
}

// ── the four cases ────────────────────────────────────────────────────

test("name + code — /admin/orders, prod row OLF741", () => {
  assert.equal(
    check("J Murali Krishna", "Murali", "OLF741"),
    `Hi Murali OLF741, ${MID} ${ORDER_ASK}`,
  );
});

test("name + code — /admin/subscriptions, prod row OLS96", () => {
  assert.equal(
    check("M SRINIVAS RAO", "Srinivas", "OLS96"),
    `Hi Srinivas OLS96, ${MID} ${ORDER_ASK}`,
  );
});

test("name only — customer screens pass no code, so the ask changes", () => {
  assert.equal(
    check("Venkata Baby Sai Upendra Puppala", "Venkata"),
    `Hi Venkata, ${MID} ${SPEAK_ASK}`,
  );
});

test("code only — nameless customer on an order screen, still greeted", () => {
  const out = defaultContactMessage({
    customerName: null,
    orderCode: "OLF741",
  });
  assert.equal(out, `Hi OLF741, ${MID} ${ORDER_ASK}`);
  // The two shapes this must never take.
  assert.ok(!out.startsWith("Hi,"), `bare comma greeting: ${out}`);
  assert.ok(out.startsWith("Hi "), `no greeting at all: ${out}`);
});

test("neither — one of the 74 nameless customers, on the customers list", () => {
  const expected = `Hi, ${MID} ${SPEAK_ASK}`;
  assert.equal(defaultContactMessage({}), expected);
  assert.equal(defaultContactMessage({ customerName: null }), expected);
});

test("the closing question follows the CODE, not the name", () => {
  const withCode = defaultContactMessage({
    customerName: "Priya Sharma",
    orderCode: "OLF470",
  });
  const without = defaultContactMessage({ customerName: "Priya Sharma" });
  assert.ok(withCode.endsWith(ORDER_ASK), withCode);
  assert.ok(without.endsWith(SPEAK_ASK), without);
  // A nameless customer on an order screen still gets the order ask.
  assert.ok(defaultContactMessage({ orderCode: "OLF470" }).endsWith(ORDER_ASK));
  // And a named customer on a customer screen never mentions an order.
  assert.ok(!without.includes("order"), without);
});

test("always greets, never a dangling or doubled separator, no em-dash", () => {
  const names = [null, undefined, "", "   ", "\t\n", ".", " . . ", "A S G"];
  for (const name of names) {
    for (const code of [null, undefined, "", "   ", "OLF741"]) {
      const out = defaultContactMessage({
        customerName: name,
        orderCode: code,
      });
      assert.ok(out.startsWith("Hi"), `no greeting: ${JSON.stringify(out)}`);
      assert.ok(!out.includes("  "), `double space: ${JSON.stringify(out)}`);
      assert.ok(
        !out.includes(" ,"),
        `space before comma: ${JSON.stringify(out)}`,
      );
      assert.ok(!out.includes("—"), `em-dash survived: ${JSON.stringify(out)}`);
      assert.ok(!/bakery/i.test(out), `bakery wording: ${JSON.stringify(out)}`);
    }
  }
});

// ── 1. the leading initial is not the given name ──────────────────────
// 59 of 900 named rows have a single-letter first token and 79 have a
// first token of two characters or fewer. "Hi J" is not a greeting.
test("skips a bare initial and greets the first token over two characters", () => {
  const rows = [
    ["J Murali Krishna", "Murali"],
    ["M SRINIVAS RAO", "Srinivas"],
    ["P Swati", "Swati"],
    ["K Satya murty", "Satya"],
    ["K Shanthi", "Shanthi"],
    ["k Eeswanth", "Eeswanth"],
    ["p sadhana", "Sadhana"],
    ["K CHITTI BABU", "Chitti"],
    ["V Demullu", "Demullu"],
    ["J kaushik", "Kaushik"],
    // Two-letter prefixes count as initials too, which is why the cut is
    // "longer than 2" and not "longer than 1".
    ["Ch Srinu", "Srinu"],
    ["SP Sriram Anand Varma", "Sriram"],
    ["M V L.VIJAYA BHASKAR", "Vijaya"],
  ];
  for (const [stored, expected] of rows) check(stored, expected);
});

// Honorifics need no stop-list: all 9 in the table are "Dr", which is two
// characters, so the length rule has already dropped it.
test("an honorific is dropped by the length rule, with no stop-list", () => {
  const rows = [
    ["Dr Harita", "Harita"],
    ["Dr K Ramakrishna", "Ramakrishna"],
    ["Dr Pavan Kumar", "Pavan"],
    ["Dr. Rajendra Kumar", "Rajendra"],
    ["Dr.Teja Praveen", "Teja"],
    // Single-case normalisation reaches the token the honorific was hiding.
    ["Dr uma sankar", "Uma"],
  ];
  for (const [stored, expected] of rows) {
    const out = check(stored, expected);
    assert.ok(!/\bDr\b/i.test(out), `greeted a title: ${stored}`);
  }
});

// ── 2. a dot separates as surely as a space ───────────────────────────
// 20 rows change because of this. Without it the initial stays welded to
// the name ("S.kiran"), or a title does ("Dr.Teja" — there is no
// whitespace anywhere near that dot, so /\s+/ can never reach it).
test("a dot is a separator, so initials and titles do not survive it", () => {
  const rows = [
    ["S.kiran", "Kiran"],
    ["T P.Nalini", "Nalini"],
    ["P.sairam", "Sairam"],
    ["B.Devi", "Devi"],
    ["B.Venkatesh", "Venkatesh"],
    ["V.Victor James", "Victor"],
    ["K.Srivalli", "Srivalli"],
    ["N.Anbapurna", "Anbapurna"],
    ["M.Sampath Babu", "Sampath"],
    ["B.Dinesh kumar", "Dinesh"],
    ["S.v.raman", "Raman"],
    ["Y.V.V.S.N.MURTHY", "Murthy"],
    // A TRAILING dot must not reach the message either.
    ["Ramathirtha. B", "Ramathirtha"],
    ["Anuradha. Vaddi", "Anuradha"],
    ["Janardhanarao. K", "Janardhanarao"],
  ];
  for (const [stored, expected] of rows) check(stored, expected);
});

// ── 3. single case is an artefact; mixed case is a spelling ───────────
test("normalises a single-case token and leaves every mixed-case one alone", () => {
  // ALL CAPS — 59 picks in the table.
  const shouted = [
    ["SADAY PRAVALLIKA", "Saday"],
    ["RAPAKA BHULAKSHMI", "Rapaka"],
    ["DINESH MADABATTULA", "Dinesh"],
    ["RUPPA CHANDRASEKHAR", "Ruppa"],
    ["VANI VARA PRASAD", "Vani"],
    ["KADIVETI BHAVYA", "Kadiveti"],
    ["RAYALA JASWANTH", "Rayala"],
    ["VELISETTI BHANU SRI VENKATA SRIKANTH", "Velisetti"],
    ["K SARVALAKSHMI", "Sarvalakshmi"],
    ["PRASAD MOOGI", "Prasad"],
    ["T. VANI", "Vani"],
  ];
  for (const [stored, expected] of shouted) check(stored, expected);

  // all lowercase — 90 picks in the table, and the SAME rule widened
  // rather than a second rule bolted on.
  const quiet = [
    ["santosh gannawarapu", "Santosh"],
    ["kiran alla", "Kiran"],
    ["p sadhana", "Sadhana"],
    ["k Eeswanth", "Eeswanth"],
  ];
  for (const [stored, expected] of quiet) check(stored, expected);

  // MIXED CASE IS PASSED THROUGH BYTE FOR BYTE. These are the fixtures
  // that prove rule 2 is scoped correctly — the pick IS the mixed-case
  // token, so a blanket title-case would mangle it.
  const untouched = [
    ["R McDonald", "McDonald"], // [synthetic] edge fixture
    ["K d'Souza", "d'Souza"], // [synthetic] edge fixture
    ["S DeSouza", "DeSouza"], // [synthetic]
    ["SriManikanta", "SriManikanta"], // prod row — one token, not "Sri"
    ["MOHIT Sai", "Mohit"], // prod row: the CAPS token is the one picked
    ["Ronan McDonald", "Ronan"], // [synthetic] first token already qualifies
    ["Maria d'Souza Fernandes", "Maria"], // [synthetic]
  ];
  for (const [stored, expected] of untouched) check(stored, expected);

  // Spelled out, because this is the regression that would be easy to ship.
  assert.ok(check("R McDonald", "McDonald").includes("McDonald"));
  assert.ok(!check("R McDonald", "McDonald").includes("Mcdonald"));
  assert.ok(check("K d'Souza", "d'Souza").includes("d'Souza"));
  assert.ok(!check("K d'Souza", "d'Souza").includes("D'souza"));
});

// ── 4. "Sri" is half a given name here, not a title ───────────────────
// 3 of 3 prod rows that start with it are compound given names, so the
// fix is the opposite of a stop-list: carry the next token with it.
test("carries the next token when the pick is Sri", () => {
  const rows = [
    ["Sri Harsha K", "Sri Harsha"],
    ["Sri Harshini", "Sri Harshini"],
    ["Sri Lakshmi myluru", "Sri Lakshmi"],
    ["SRI LAKSHMI", "Sri Lakshmi"], // [synthetic] normalise, then compare
    ["sri harsha", "Sri Harsha"], // [synthetic]
    ["K Sri Harsha", "Sri Harsha"], // [synthetic] after an initial
  ];
  for (const [stored, expected] of rows) check(stored, expected);

  // "Sri" alone is still greeted, and a "Sri" that is not the pick is not
  // a trigger.
  assert.equal(check("Sri", "Sri"), `Hi Sri, ${MID} ${SPEAK_ASK}`);
  check("VELISETTI BHANU SRI VENKATA SRIKANTH", "Velisetti");
});

// ── 5. when nothing is usable, greet without a name ───────────────────
test("drops the name entirely when no token is a usable one", () => {
  const unusable = [
    "KK", // prod row
    "ks", // prod row
    "7981040614", // prod row — a phone number typed into full_name
    "A S G", // [synthetic] edge fixture
    "A. S. G.", // [synthetic] edge fixture
    "J K",
    "M.",
    "...",
  ];
  for (const stored of unusable) {
    check(stored, "");
    assert.equal(
      defaultContactMessage({ customerName: stored }),
      `Hi, ${MID} ${SPEAK_ASK}`,
      stored,
    );
  }

  // With a code it collapses to the code-only form, never "Hi  OLF741".
  assert.equal(
    defaultContactMessage({ customerName: "A. S. G.", orderCode: "OLF741" }),
    `Hi OLF741, ${MID} ${ORDER_ASK}`,
  );
});

test("whitespace in a prod name is one separator and never reaches the text", () => {
  // "Avinash  Polamarasetty" is stored with two spaces.
  check("Avinash  Polamarasetty", "Avinash", "OLF740");
  check("  Priya Sharma Reddy  ", "Priya");
});

// ── negative controls: the harness must be able to fail ───────────────

test("control — a wrong expected name fails the fixture", () => {
  assert.throws(() => check("J Murali Krishna", "J"));
  assert.throws(() => check("M SRINIVAS RAO", "SRINIVAS"));
  // Not satisfied by a longer name that merely starts the same way.
  assert.throws(() => check("Srinivasan Iyer", "Srinivas"));
  // Nor by the full stored name.
  assert.throws(() => check("Priya Sharma Reddy", "Priya Sharma Reddy"));
  // Mixed case really is asserted, not compared case-blind.
  assert.throws(() => check("R McDonald", "Mcdonald"));
  assert.throws(() => check("K d'Souza", "D'Souza"));
  // A usable name must not pass as unusable.
  assert.throws(() => check("Dr Harita", ""));
  // The Sri pairing is asserted, not assumed.
  assert.throws(() => check("Sri Harsha K", "Sri"));
  assert.throws(() => check("Sri Harsha K", "Harsha"));
});

test("control — leakedTokens actually catches a leak, case-blind", () => {
  assert.deepEqual(
    leakedTokens("J Murali Krishna", "Murali", "Hi J Murali Krishna, hello"),
    ["Krishna"],
  );
  // Case-blind: the stored token is upper, the leak is lower.
  assert.deepEqual(
    leakedTokens("M SRINIVAS RAO", "Srinivas", "Hi Srinivas, rao here"),
    ["RAO"],
  );
  // An honorific leaking is caught too — "Dr" is two characters.
  assert.deepEqual(leakedTokens("Dr Harita", "Harita", "Hi Dr Harita"), ["Dr"]);
  // A token that is part of the expected name is not a leak.
  assert.deepEqual(
    leakedTokens("Sri Harsha K", "Sri Harsha", "Hi Sri Harsha, hello"),
    [],
  );
  // Substrings are not leaks — word boundaries, not indexOf.
  assert.deepEqual(
    leakedTokens("Ram Kumar", "Kumar", "Hi Kumar, programme starts"),
    [],
  );
  // And it is silent on a clean real message.
  assert.deepEqual(
    leakedTokens(
      "J Murali Krishna",
      "Murali",
      defaultContactMessage({
        customerName: "J Murali Krishna",
        orderCode: "OLF741",
      }),
    ),
    [],
  );
});
