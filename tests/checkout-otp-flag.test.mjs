// `otpVerified` on /checkout could only ever turn ON.
//
// THE DEFECT. Two things set the flag during the prefill effect, and neither
// could clear it:
//
//     const sessionPhone = sessionStorage.getItem("cadieux_verified_phone");
//     if (sessionPhone === saved) setOtpVerified(true);        // (1)
//     ...
//     if (d.phone_verified || d.customer) {                     // (2)
//       setOtpVerified(true);
//       sessionStorage.setItem("cadieux_verified_phone", saved);
//     }
//     // no else
//
// (1) set it true off a value THIS PAGE WROTE ITSELF, with no credential
// check of any kind. (2) asked the server, but read the answer only as
// permission to verify — never as a reason to stop.
//
// The two combine into the live bug. `cdx_phone_verified` is a signed cookie
// with a TTL; the sessionStorage entry has neither. A tab left open long
// enough for the cookie to expire, or one restored by the browser with session
// storage intact, seeded the flag true at mount, got a 401 with
// `{ phone_verified: false }` from /api/checkout, ignored it, and rendered
// "Phone verified" over no credential at all. The user then filled in the
// whole form and had the order refused at the end by the server-side gate.
//
// /api/checkout's own comment describes this same shape on /orders, from the
// same cause: "localStorage.cadieux_phone never expires while this cookie
// does, so the page could not tell the two apart from the body alone."
//
// THE FIX, asserted below:
//   - the server's "no" sets the flag FALSE (the missing else), and
//   - nothing seeds the flag from client-side storage any more.
//
// These are source assertions. /checkout is a ~3000-line client component
// with no render harness in this suite, so the convention here (see
// save-customer-auth.test.mjs) is to assert on its source with comments
// stripped — which matters doubly in this file, because the notes left at both
// fixed sites quote the very code they removed.

import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments removed, so no assertion can be satisfied by prose. */
const code = (rel) =>
  read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const PAGE = "src/app/checkout/page.tsx";

/** The prefill effect's request and everything it does with the response.
 *  Sliced rather than searched whole-file: `setOtpVerified(false)` appears in
 *  several unrelated handlers (changing the phone, deleting saved details), so
 *  a whole-file match would pass with the fix absent. */
function prefillBlock(src) {
  const start = src.indexOf("/api/checkout?phone=");
  assert.notEqual(start, -1, "the prefill fetch to /api/checkout is gone");
  const end = src.indexOf(".catch(", start);
  assert.notEqual(end, -1, "the prefill chain no longer ends in a .catch");
  return src.slice(start, end);
}

test("the server's answer can turn the flag OFF, not only ON", () => {
  const block = prefillBlock(code(PAGE));

  assert.match(
    block,
    /setOtpVerified\(true\)/,
    "the prefill no longer verifies on a good server answer",
  );
  assert.match(
    block,
    /setOtpVerified\(false\)/,
    "the prefill still treats the server's answer as one-way — a 401 leaves " +
      "the flag at whatever it already held",
  );
});

test("the FALSE is the else of the verified check, not an unrelated line", () => {
  // The direction is the whole point: false must be what happens when the
  // `phone_verified || customer` test does NOT pass. A setOtpVerified(false)
  // sitting anywhere else in the block (before the fetch resolves, say) would
  // satisfy the test above while fixing nothing.
  const block = prefillBlock(code(PAGE));

  assert.match(
    block,
    /if\s*\(\s*d\.phone_verified\s*\|\|\s*d\.customer\s*\)\s*\{[^}]*setOtpVerified\(true\)[^}]*\}\s*else\s*\{[^}]*setOtpVerified\(false\)/,
    "the verified check has no else branch clearing the flag",
  );
});

test("nothing seeds the verified flag from client-side storage", () => {
  // The seed is gone entirely rather than kept as an optimistic value. A
  // value this page writes itself is not evidence about a cookie it cannot
  // see, and the only thing that could have overturned it — the fetch above —
  // ends in an empty .catch, so an offline tab would have kept a stale
  // "verified" forever.
  const src = code(PAGE);

  assert.equal(
    /cadieux_verified_phone/.test(src),
    false,
    "the sessionStorage verified-phone key is back in the code",
  );
  // Nothing else may stand in for it either: no storage read may gate a
  // setOtpVerified(true).
  assert.equal(
    /(session|local)Storage\.getItem\([^)]*\)[^;]*;?\s*if[^\n]*setOtpVerified\(true\)/.test(src),
    false,
    "a storage read is gating setOtpVerified(true) again",
  );
});

test("the saved-address shortcut cannot re-grant verification on its own", () => {
  // onBackToSaved() calls setOtpVerified(true) unconditionally, which reads
  // like a third one-way setter. It is safe, but only because savedCustomer
  // is unreachable unless the server already verified: it is assigned from
  // `d.customer`, AFTER the `if (!d.customer) return` guard, and
  // /api/checkout returns `customer: null` whenever phone_verified is false.
  //
  // That is a load-bearing coincidence, so it is pinned here. If
  // setSavedCustomer ever moves above the guard, this shortcut becomes a way
  // to verify yourself with one click.
  const block = prefillBlock(code(PAGE));
  const guard = block.indexOf("if (!d.customer) return");
  const assign = block.indexOf("setSavedCustomer(");

  assert.notEqual(guard, -1, "the !d.customer guard is gone from the prefill");
  assert.notEqual(assign, -1, "savedCustomer is no longer set in the prefill");
  assert.ok(
    guard < assign,
    "savedCustomer is now set BEFORE the !d.customer guard, so an unverified " +
      "response can populate it and onBackToSaved can re-grant verification",
  );
});
