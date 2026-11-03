// The authentication gate on /api/checkout action `save_customer`.
//
// THE DEFECT. `save_customer` is the only action on that route which writes
// the customers table, and it keys on a phone number out of the REQUEST BODY.
// It ran for anyone:
//
//     const { data: existing } = await supabaseAdmin
//       .from("customers").select("id").eq("phone", phone).maybeSingle();
//     if (existing) {
//       await supabaseAdmin.from("customers")
//         .update({ full_name, city }).eq("id", existing.id);
//       customerId = existing.id;
//     }
//     ...
//     return NextResponse.json({ customer: { id: customerId, ... } });
//
// Two separate holes in those few lines. Knowing a phone number was enough to
// (1) OVERWRITE that customer's name and city, and (2) read back their real
// UUID — the id every order and subscription path keys on. The second is the
// worse of the two: it is a lookup oracle that converts a phone number into
// the identifier the rest of the system trusts.
//
// Note what was ALREADY there and did not help: an `isValidIndianMobile`
// format check. A format check establishes that a number is well-formed, not
// that the caller owns it. Validation is not authentication.
//
// WHAT THE LEGITIMATE FLOW NEEDS, and all that is kept: the caller must have
// PROVED the number being saved. Every real call site already OTPs first, and
// the returning-customer path skips the action entirely, so the gate costs
// nothing — see the assertions on the call sites at the end of this file.
//
// Loaded through the alias hook with a top-level dynamic import: a static
// `import` resolves the whole graph before the hook installs.
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

const ROUTE = "src/app/api/checkout/route.ts";

const {
  getVerifiedPhone,
  normalizePhone,
  signPhoneCookie,
  PHONE_COOKIE_NAME,
  PHONE_COOKIE_TTL_MS,
} = await import("../src/lib/phone-cookie.ts");

// ── Fixtures ──────────────────────────────────────────────────────────────

/** What the checkout form puts in the body: bare ten digits. */
const BODY_PHONE = "9876543210";
/** What the OTP cookie carries for the same human: E.164. */
const COOKIE_PHONE = "+919876543210";
/** A different real number. */
const OTHER_PHONE = "9123456789";

/** A NextRequest as far as getVerifiedPhone is concerned. */
function requestWith({ cookie, bearer } = {}) {
  return {
    headers: { get: (n) => (n.toLowerCase() === "authorization" ? bearer ?? null : null) },
    cookies: { get: (n) => (n === PHONE_COOKIE_NAME && cookie ? { value: cookie } : undefined) },
  };
}

const liveCookieFor = (phone) =>
  signPhoneCookie(phone, Date.now() + PHONE_COOKIE_TTL_MS);

/**
 * The gate's decision, composed from the SAME two exported primitives the
 * route calls, in the same order.
 *
 * This is not the route — the `save_customer` branch is inline in a 1300-line
 * POST behind a module-scope Supabase client, so it cannot be invoked without
 * a live database, exactly like the place_subscription branch in
 * tests/order-create-auth.test.mjs. What it DOES test is real: that
 * getVerifiedPhone refuses what it should, and that the normalised comparison
 * admits the real web request shape. The structural assertions further down
 * then pin the route to this construct, so the pair cannot drift silently.
 */
function gateDecision(req, bodyPhone) {
  const verified = getVerifiedPhone(req);
  if (!verified) return 401;
  if (normalizePhone(verified.phone) !== normalizePhone(bodyPhone)) return 401;
  return 200;
}

// ── The refusals ──────────────────────────────────────────────────────────

test("NO session is refused — a format check is not a credential", () => {
  assert.equal(gateDecision(requestWith(), BODY_PHONE), 401);
});

test("an EXPIRED cookie is refused", () => {
  const expired = signPhoneCookie(COOKIE_PHONE, Date.now() - 1000);
  assert.equal(gateDecision(requestWith({ cookie: expired }), BODY_PHONE), 401);
});

test("a FORGED cookie for the right phone is refused — the HMAC is the check", () => {
  const forged = `${COOKIE_PHONE}:${Date.now() + 60_000}:${"0".repeat(64)}`;
  assert.equal(gateDecision(requestWith({ cookie: forged }), BODY_PHONE), 401);
});

test("verified as one number, saving ANOTHER, is refused", () => {
  // The whole shape of the hole: the caller is a real verified customer, and
  // the number in the body is somebody else's.
  const req = requestWith({ cookie: liveCookieFor(COOKIE_PHONE) });
  assert.equal(gateDecision(req, OTHER_PHONE), 401);
});

// ── What must still work ──────────────────────────────────────────────────

test("E.164 cookie vs BARE-DIGIT body is accepted — the real web shape", () => {
  // The cookie carries +91… and checkout's body carries ten digits, so a raw
  // `verified.phone !== phone` would have refused every genuine caller while
  // looking like a tightening. Both sides are normalised.
  const req = requestWith({ cookie: liveCookieFor(COOKIE_PHONE) });

  assert.notEqual(COOKIE_PHONE, BODY_PHONE, "fixtures must differ as strings");
  assert.equal(gateDecision(req, BODY_PHONE), 200);
});

test("all three accepted phone spellings resolve to the same identity", () => {
  // isValidIndianMobile accepts these three forms, so the gate must treat
  // them as one number or it is a bypass on one spelling and a lockout on
  // another.
  const req = requestWith({ cookie: liveCookieFor(COOKIE_PHONE) });
  for (const spelling of ["9876543210", "919876543210", "+919876543210"]) {
    assert.equal(gateDecision(req, spelling), 200, `refused ${spelling}`);
  }
});

test("a mobile BEARER token is honoured — the app has no cookie", () => {
  const req = requestWith({ bearer: `Bearer ${liveCookieFor(COOKIE_PHONE)}` });
  assert.equal(gateDecision(req, BODY_PHONE), 200);
});

// ── The route is wired to that construct ──────────────────────────────────

/** Just the `save_customer` branch, so no assertion can be satisfied by the
 *  order or subscription gates elsewhere in the same file. */
function saveCustomerBranch() {
  const src = code(ROUTE);
  const start = src.indexOf('body.action === "save_customer"');
  assert.notEqual(start, -1, "the save_customer branch has moved or been renamed");
  const end = src.indexOf('body.action === "place_order"', start);
  assert.notEqual(end, -1, "could not find the end of the save_customer branch");
  return src.slice(start, end);
}

test("save_customer refuses a missing session outright", () => {
  assert.match(
    saveCustomerBranch(),
    /if\s*\(!verified\)\s*\{[\s\S]{0,400}?status:\s*401/,
    "a missing session must be refused, not defaulted around",
  );
});

test("save_customer compares NORMALISED phones, both sides", () => {
  assert.match(
    saveCustomerBranch(),
    /normalizePhone\(verified\.phone\)\s*!==\s*normalizePhone\(phone\)/,
  );
});

test("the gate runs BEFORE the customers lookup — no existence oracle", () => {
  // Order is the property, not mere presence. If the gate sat after the
  // lookup, an unverified caller's refusal would still depend on whether the
  // row was found, and the route would answer "is this number on file?".
  const branch = saveCustomerBranch();
  const gate = branch.search(/getVerifiedPhone\(req\)/);
  const lookup = branch.search(/\.from\("customers"\)/);

  assert.notEqual(gate, -1, "the gate is gone");
  assert.notEqual(lookup, -1, "the customers lookup is gone");
  assert.ok(
    gate < lookup,
    "getVerifiedPhone must be called before the customers table is read",
  );
});

test("neither the UPDATE nor the UUID response is reachable before the gate", () => {
  const branch = saveCustomerBranch();
  const gate = branch.search(/getVerifiedPhone\(req\)/);

  for (const [what, re] of [
    ["the update", /\.update\(\{\s*full_name/],
    ["the insert", /\.insert\(\{\s*full_name/],
    ["the UUID response", /customer:\s*\{\s*id:\s*customerId/],
  ]) {
    const at = branch.search(re);
    assert.notEqual(at, -1, `${what} has moved — this test is no longer looking at it`);
    assert.ok(at > gate, `${what} precedes the verification gate`);
  }
});

// ── The call sites, which is why the gate costs nothing ───────────────────

test("every save_customer caller already verifies first", () => {
  // The claim in the route's comment, asserted rather than trusted: no call
  // site posts this action without an OTP ahead of it. If a fourth call site
  // appears without one, it will 401 in production — this fails first.
  const callers = [
    "src/app/checkout/page.tsx",
    "src/app/subscriptions/setup/checkout/page.tsx",
  ];

  const found = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        const rel = path.relative(ROOT, full);
        if (rel === ROUTE) continue; // the handler, not a caller
        if (/action:\s*"save_customer"/.test(fs.readFileSync(full, "utf8"))) {
          found.push(rel);
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));

  assert.deepEqual(
    found.sort(),
    callers,
    "a new save_customer call site appeared — confirm it OTPs before posting",
  );

  for (const rel of found) {
    assert.match(
      read(rel),
      /!otpVerified/,
      `${rel} posts save_customer without gating on otpVerified`,
    );
  }
});
