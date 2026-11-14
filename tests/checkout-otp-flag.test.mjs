// /checkout — the verified-phone state machine.
//
// HISTORY, because two of these tests replace earlier ones and the reason
// matters:
//
//   * before 2713404 the flag could only turn ON. A sessionStorage seed set
//     it true with no credential check, and the server's answer was read as
//     permission to verify but never as a reason to stop, so a 401 left
//     whatever the flag already held. 2713404 removed the seed and added the
//     else.
//   * that left a second defect of the opposite kind. The flag was a boolean,
//     so it had to answer "is this phone verified?" before anyone had asked.
//     It answered false — indistinguishable from "we asked and the answer was
//     no" — which showed the OTP form and the "Please verify your phone
//     number" error to a customer holding a perfectly valid cookie, for as
//     long as the check was in flight and FOREVER if the request failed.
//
// So the state is now three-valued: unknown / verified / unverified. The two
// tests 2713404 added pinned `setOtpVerified(true)` and an `else
// setOtpVerified(false)` inside the prefill. Those exact shapes are gone by
// design — the prefill now writes setVerifiedState("verified") /
// ("unverified") — and the tests below pin the three-way shape in their
// place. The two 2713404 tests that are still about live behaviour (the
// absent storage seed, and the saved-address shortcut's load-bearing
// ordering) are kept verbatim.
//
// These are source-shape assertions, not a rendered-component test: this page
// is a ~3800-line client component and the harness has no React renderer. The
// limits are real and worth stating — they prove the code has the right
// shape, not that the browser behaves. Every assertion therefore reads
// comment-stripped source, so no claim here can be satisfied by prose.

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
 *  Sliced rather than searched whole-file: the state setters appear in
 *  several unrelated handlers (changing the phone, deleting saved details),
 *  so a whole-file match would pass with the fix absent. */
function prefillBlock(src) {
  // ANCHORED ON THE WRAPPER, NOT ON THE FETCH URL. `recheckVerification` (the
  // retry button's handler) is declared earlier in the file and issues the
  // same request to the same URL, so slicing from the first
  // "/api/checkout?phone=" matched THAT and let assertions about the prefill
  // be satisfied by the retry handler's code instead. The mutation run caught
  // it: deleting the prefill's no-saved-phone resolution failed nothing.
  const start = src.indexOf("const runVerificationCheck");
  assert.notEqual(start, -1, "the retrying prefill wrapper is gone");
  const end = src.indexOf("runVerificationCheck(0)", start);
  assert.notEqual(end, -1, "the prefill no longer kicks off a checked fetch");
  return src.slice(start, end);
}

/** The prefill effect's own no-saved-phone guard. Found by the one marker
 *  that distinguishes it from `recheckVerification`'s identical-looking
 *  guard: only the prefill goes on to seed the phone field. */
function prefillSavedGuard(src) {
  const needle = 'localStorage.getItem("cadieux_phone")';
  let at = src.indexOf(needle);
  while (at !== -1) {
    const window_ = src.slice(at, at + 500);
    if (window_.includes("setPhone(saved)")) return window_;
    at = src.indexOf(needle, at + 1);
  }
  assert.fail(
    "no saved-phone read is followed by setPhone(saved) — the prefill effect " +
      "cannot be located, so its guard cannot be checked",
  );
}

test("the initial verified state is unknown, not false", () => {
  // The whole fix rests on this. A boolean initial value cannot express
  // "nobody has asked yet", and false is read as "not verified" by every
  // gate and every render site downstream.
  const src = code(PAGE);

  assert.match(
    src,
    /useState<VerifiedState>\(\s*"unknown"\s*\)/,
    'the verified state no longer initialises to "unknown"',
  );
  assert.equal(
    /const \[otpVerified, setOtpVerified\] = useState\(/.test(src),
    false,
    "otpVerified is a useState again — it must be DERIVED from verifiedState, " +
      "or the two can disagree",
  );
});

test("a missing saved phone resolves to unverified instead of staying unknown", () => {
  // Load-bearing and easy to lose. The prefill effect returns early when
  // there is no saved phone, and the fetch — the only other thing that ever
  // leaves "unknown" — is downstream of that return. Without an explicit
  // resolution here, a first-time visitor sits on the checking strip forever
  // and can never reach the OTP form: checkout is dead for every new
  // customer, which is a worse bug than the one this commit fixes.
  const guard = prefillSavedGuard(code(PAGE));
  assert.match(
    guard,
    /if\s*\(\s*!saved\s*\)\s*\{[^}]*setVerifiedState\(\s*"unverified"\s*\)/,
    'the no-saved-phone early return does not resolve out of "unknown" — a ' +
      "first-time visitor would be stranded on the checking state",
  );
});

test("the server's yes sets verified and its no sets unverified", () => {
  const block = prefillBlock(code(PAGE));

  assert.match(
    block,
    /setVerifiedState\(\s*"verified"\s*\)/,
    "the prefill no longer verifies on a good server answer",
  );
  assert.match(
    block,
    /setVerifiedState\(\s*"unverified"\s*\)/,
    "the prefill no longer records an explicit no — a 401 would leave the " +
      "state at whatever it already held",
  );
});

test("verified and unverified are the two arms of the same check", () => {
  // Direction is the point, as it was for the else this replaces. An
  // unverified write sitting anywhere else in the block would satisfy the
  // test above while fixing nothing.
  const block = prefillBlock(code(PAGE));

  assert.match(
    block,
    /if\s*\(\s*d\.phone_verified\s*\|\|\s*d\.customer\s*\)\s*\{[^}]*setVerifiedState\(\s*"verified"\s*\)[^}]*\}\s*else\s*\{[^}]*setVerifiedState\(\s*"unverified"\s*\)/,
    "the verified check's two outcomes are no longer the if/else of one test",
  );
});

test("a failed check lands in unknown, never in unverified", () => {
  // A network failure is not evidence about a cookie. Writing "unverified"
  // here is the bug in its original form: it spends one of the customer's
  // 3-per-hour OTP sends to recover from OUR blip.
  const src = code(PAGE);
  const start = src.indexOf("const runVerificationCheck");
  assert.notEqual(start, -1, "the retrying check wrapper is gone");
  const catchAt = src.indexOf(".catch(", start);
  assert.notEqual(catchAt, -1, "the prefill chain no longer ends in a .catch");
  const body = src.slice(catchAt, src.indexOf("runVerificationCheck(0)", start));

  assert.match(
    body,
    /setVerifiedState\(\s*"unknown"\s*\)/,
    'a failed check no longer returns the state to "unknown"',
  );
  assert.equal(
    /setVerifiedState\(\s*"(verified|unverified)"\s*\)/.test(body),
    false,
    "the failure path is deciding the customer's verification status from a " +
      "request that never answered",
  );
});

test("a failed check retries exactly once", () => {
  // Once, not zero (a single dropped request shouldn't cost a re-verify) and
  // not unbounded (a real outage shouldn't become a retry storm from every
  // open checkout tab).
  const src = code(PAGE);
  const start = src.indexOf("const runVerificationCheck");
  const body = src.slice(start, src.indexOf("runVerificationCheck(0)", start));

  assert.match(
    body,
    /if\s*\(\s*attempt\s*===\s*0\s*\)\s*\{[^}]*runVerificationCheck\(\s*1\s*\)/,
    "the retry is no longer guarded by the attempt counter — this is either " +
      "no retry at all or an unbounded loop",
  );
  assert.match(
    src,
    /runVerificationCheck\(\s*0\s*\)\s*;/,
    "the first attempt is no longer started at attempt 0",
  );
  const calls = body.match(/runVerificationCheck\(/g) ?? [];
  assert.equal(
    calls.length,
    1,
    `the check body calls itself ${calls.length} times; exactly one guarded ` +
      "recursive call is allowed",
  );
});

test("unknown never renders the OTP form", () => {
  // Showing the OTP form while we are still asking is the user-visible half
  // of the bug: it invites a customer who is already verified to spend an
  // SMS proving it again.
  const src = code(PAGE);

  // Every OTP entry block is gated on an EXPLICIT unverified, never on the
  // negation of the derived boolean (which is true while unknown).
  assert.equal(
    /otpSent\s*&&\s*!otpVerified/.test(src),
    false,
    "an OTP entry block is gated on !otpVerified, which is also true while " +
      "the check is still in flight",
  );
  assert.equal(
    /\{\s*!otpVerified\s*&&\s*\(\s*<SavedCustomerOtpBlock/.test(src),
    false,
    "the saved-customer OTP block is gated on !otpVerified again",
  );
  // EVERY site, not "some site". A whole-file regex that only needs one
  // match is satisfied by the other render sites while one is broken — the
  // mutation run proved it: disabling the strip in the saved-customer card
  // failed nothing, because AddressForm and PickupSection still matched.
  const sites = (needle, gate, min) => {
    let at = src.indexOf(needle);
    let n = 0;
    while (at !== -1) {
      const before = src.slice(Math.max(0, at - 220), at);
      assert.match(
        before,
        gate,
        `the ${needle} at offset ${at} is not gated on ${gate} — that one ` +
          "render site is wrong even if the others are right",
      );
      n += 1;
      at = src.indexOf(needle, at + 1);
    }
    assert.ok(n >= min, `expected at least ${min} ${needle} sites, found ${n}`);
  };

  sites("<SavedCustomerOtpBlock", /verifiedState === "unverified"/, 2);

  // And unknown has something of its own to show, at every one of those
  // same places.
  assert.match(
    src,
    /function VerificationStatusStrip\(/,
    "the checking/retry strip is gone, so unknown renders nothing at all",
  );
  sites("<VerificationStatusStrip", /verifiedState === "unknown"/, 3);
});

test("unknown never tells the customer to verify", () => {
  // The submit gates are the other half. "Please verify your phone number"
  // in response to our own unfinished request is a false accusation, and the
  // customer's only way to clear it is an OTP they do not need.
  const src = code(PAGE);
  const needle = 'setError("Please verify your phone number';
  let at = src.indexOf(needle);
  assert.notEqual(at, -1, "the verify-your-phone gates are gone entirely");

  let checked = 0;
  while (at !== -1) {
    const before = src.slice(Math.max(0, at - 320), at);
    assert.match(
      before,
      /verifiedState === "unknown"/,
      `a "Please verify your phone number" gate at offset ${at} is not ` +
        "preceded by an unknown check, so it fires while the check is in flight",
    );
    checked += 1;
    at = src.indexOf(needle, at + 1);
  }
  assert.ok(checked >= 4, `expected at least 4 such gates, found ${checked}`);
});

test("nothing seeds the verified flag from client-side storage", () => {
  // Kept verbatim from 2713404. A value this page writes itself is not
  // evidence about a cookie it cannot see.
  const src = code(PAGE);

  assert.equal(
    /cadieux_verified_phone/.test(src),
    false,
    "the sessionStorage verified-phone key is back in the code",
  );
  assert.equal(
    /(session|local)Storage\.getItem\([^)]*\)[^;]*;?\s*if[^\n]*setVerifiedState\(\s*"verified"\s*\)/.test(src),
    false,
    "a storage read is gating a verified write again",
  );
});

test("the saved-address shortcut cannot re-grant verification on its own", () => {
  // Kept from 2713404. onBackToSaved() calls setOtpVerified(true)
  // unconditionally, which reads like a one-way setter. It is safe only
  // because savedCustomer is assigned from `d.customer` AFTER the
  // `if (!d.customer) return` guard, and /api/checkout returns
  // `customer: null` whenever phone_verified is false. That is a
  // load-bearing coincidence, so it stays pinned.
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
