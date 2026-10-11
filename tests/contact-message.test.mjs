// The outbound WhatsApp/SMS prefill (src/lib/phone-utils.ts).
//
// BOTH halves of the lead are routinely absent in prod, which is the whole
// reason this has four branches rather than one template:
//
//   - 72 of the customers rows have a null/blank full_name AND a phone, so
//     the admin can message them and there is no name to greet them by.
//     The old body emitted a bare "Hi," for those.
//   - Six of the ten ContactActions call sites are about a CUSTOMER, not an
//     order (the customers list, the customer detail, serviceability
//     requests), so there is no OLF/OLS to quote.
//
// The separators belong to the parts, not to the template. A template with
// the dashes baked in is exactly how you ship "Hi  — " to a customer.
//
// Names are copied VERBATIM from prod, including the double space inside
// "Avinash  Polamarasetty" — a real row, and the reason the first-name split
// is /\s+/ and not " ".

import { test } from "node:test";
import assert from "node:assert/strict";

import "./_alias-hook.mjs";

const { defaultContactMessage } = await import("../src/lib/phone-utils.ts");

const BODY =
  "I'm messaging from Cadieux. Do you have a minute to help me with your order?";

test("name + code — /admin/orders, prod row OLF741", () => {
  assert.equal(
    defaultContactMessage({
      customerName: "J Murali Krishna",
      orderCode: "OLF741",
    }),
    `Hi J — OLF741 — ${BODY}`,
  );
});

test("name + code — /admin/subscriptions, prod row OLS96", () => {
  assert.equal(
    defaultContactMessage({
      customerName: "M SRINIVAS RAO",
      orderCode: "OLS96",
    }),
    `Hi M — OLS96 — ${BODY}`,
  );
});

test("name only — customer screens pass no code at all", () => {
  assert.equal(
    defaultContactMessage({ customerName: "Venkata Baby Sai Upendra Puppala" }),
    `Hi Venkata — ${BODY}`,
  );
});

test("code only — nameless customer on an order screen", () => {
  assert.equal(
    defaultContactMessage({ customerName: null, orderCode: "OLF741" }),
    `OLF741 — ${BODY}`,
  );
});

test("neither — one of the 72 nameless customers, on the customers list", () => {
  assert.equal(defaultContactMessage({}), BODY);
  assert.equal(defaultContactMessage({ customerName: null }), BODY);
});

test("never emits a dangling greeting or a leading separator", () => {
  for (const name of [null, undefined, "", "   ", "\t\n"]) {
    for (const code of [null, undefined, "", "   "]) {
      const out = defaultContactMessage({
        customerName: name,
        orderCode: code,
      });
      assert.equal(out, BODY);
      assert.ok(!out.includes("Hi "), `greeted nobody: ${JSON.stringify(out)}`);
      assert.ok(!out.startsWith("—"), `leading dash: ${JSON.stringify(out)}`);
      assert.ok(!out.includes("  "), `double space: ${JSON.stringify(out)}`);
    }
  }
});

test("first name only, and a double space inside a prod name is one separator", () => {
  // "Avinash  Polamarasetty" is stored with two spaces.
  assert.equal(
    defaultContactMessage({
      customerName: "Avinash  Polamarasetty",
      orderCode: "OLF740",
    }),
    `Hi Avinash — OLF740 — ${BODY}`,
  );
  // Surrounding whitespace must not survive into the greeting either.
  assert.equal(
    defaultContactMessage({ customerName: "  Priya Sharma Reddy  " }),
    `Hi Priya — ${BODY}`,
  );
});

test("no bakery wording, and the full name never reaches the message", () => {
  const out = defaultContactMessage({
    customerName: "J Murali Krishna",
    orderCode: "OLF741",
  });
  assert.ok(!/bakery/i.test(out));
  assert.ok(!out.includes("Murali"));
  assert.ok(!out.includes("Krishna"));
});
