// The OTP gate on the order-create path, and the rule that creating an
// order may never ISSUE a session.
//
// TWO DEFECTS ON MAIN, both closed here, both of which a passing test suite
// and a type-checking build were perfectly happy with.
//
// 1. THE GATE THAT COULD NOT FAIL.
//
//        const effective = verified?.phone ?? normalizePhone(cust.phone);
//        if (normalizePhone(cust.phone) !== effective) { ...401 }
//
//    `getVerifiedPhone` returns null when there is no cookie and no bearer.
//    `??` then took the phone off the customer row, and the line compared
//    `cust.phone` to ITSELF — true for every input, so the 401 was
//    unreachable. The only server-side OTP check on the order path passed
//    for an unauthenticated POST carrying any `customer_id`. An independent
//    copy of the same construct sat in the place_subscription branch.
//
// 2. THE ESCALATION. Both order routes then signed a REAL `cdx_phone_verified`
//    cookie from `prepared.custPhone` — a number off a row the caller named,
//    not off any proven session. So an unverified order did not merely get
//    placed: it handed back a genuine verified session for whatever phone was
//    typed in, which every other route in the app honours.
//
// WHY A `??` IS THE SHAPE TO WATCH FOR. Both halves read as a safe default.
// A fallback is only safe when the fallback value is INDEPENDENT of the
// thing being checked; here it was the other side of the comparison, so the
// "default" silently became the answer. The tests below therefore assert
// the REFUSAL, not the comparison — a refusal cannot be satisfied by a
// value that defaults into agreement.
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

// PLACEHOLDERS, not credentials, and deliberately pointed at nothing. One of
// order-checkout's transitive imports (lib/admin-auth) calls `createClient` at
// MODULE scope, and @supabase/supabase-js throws "supabaseUrl is required."
// during the import rather than at first use — so the file cannot be loaded at
// all without these two names being set.
//
// Nothing in these tests reaches that client: every query runs through the
// stub passed into prepareOneTimeOrder below. The URL is a loopback port
// nothing listens on, so if a real request were ever attempted it would fail
// loudly instead of quietly talking to production.
process.env.NEXT_PUBLIC_SUPABASE_URL ??= "http://127.0.0.1:1";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "test-not-a-real-key";

const { prepareOneTimeOrder } = await import("../src/lib/order-checkout.ts");
const { signPhoneCookie, PHONE_COOKIE_NAME, PHONE_COOKIE_TTL_MS } =
  await import("../src/lib/phone-cookie.ts");

// ── Fixtures ──────────────────────────────────────────────────────────────

const CUSTOMER_ID = "11111111-2222-3333-4444-555555555555";
/** The phone stored on the customers row the request names. */
const STORED_PHONE = "9876543210";
/** A real customer who is NOT the one being ordered for. */
const OTHER_PHONE = "9123456789";
const PICKUP_LOCATION_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/** Pickup, so the gate is reached without Google distance or slot checks. */
const ORDER_BODY = {
  customer_id: CUSTOMER_ID,
  fulfillment_type: "pickup",
  pickup_location_id: PICKUP_LOCATION_ID,
  items: [{ slug: "high-protein", quantity: 2, kind: "once", line_total_inr: 216 }],
  total_amount: 216,
};

/**
 * Minimal stand-in for the three tables prepareOneTimeOrder reads. Only the
 * call shapes it actually uses are implemented, so an added query fails
 * loudly here rather than returning a confident undefined.
 */
function supabaseStub({ customerPhone = STORED_PHONE } = {}) {
  return {
    from(table) {
      if (table === "pickup_locations") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: {
                  id: PICKUP_LOCATION_ID,
                  name: "Cadieux Stall",
                  area: "Dwaraka Nagar",
                  address: "Dwaraka Nagar, Visakhapatnam 530016",
                  pincode: "530016",
                  is_archived: false,
                },
                error: null,
              }),
            }),
          }),
        };
      }
      if (table === "products") {
        return {
          select: () => ({
            in: async () => ({
              data: [
                {
                  slug: "high-protein",
                  name: "Protein Bread",
                  price_inr: 108,
                  is_active: true,
                  is_archived: false,
                  in_stock: true,
                  available_from: null,
                  stock_message: null,
                },
              ],
              error: null,
            }),
          }),
        };
      }
      if (table === "customers") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: { id: CUSTOMER_ID, phone: customerPhone },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table read: ${table}`);
    },
  };
}

/** A NextRequest as far as getVerifiedPhone is concerned. */
function requestWith({ cookie, bearer } = {}) {
  return {
    headers: { get: (n) => (n.toLowerCase() === "authorization" ? bearer ?? null : null) },
    cookies: { get: (n) => (n === PHONE_COOKIE_NAME && cookie ? { value: cookie } : undefined) },
  };
}

const liveCookieFor = (phone) =>
  signPhoneCookie(phone, Date.now() + PHONE_COOKIE_TTL_MS);

const prepare = (req, opts = {}, stubOpts = {}) =>
  prepareOneTimeOrder(ORDER_BODY, req, supabaseStub(stubOpts), opts);

// ── THE REFUSAL — defect 1 ────────────────────────────────────────────────

test("NO COOKIE is refused 401, not quietly accepted", async () => {
  const res = await prepare(requestWith());

  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
  assert.equal(res.body.code, "phone_not_verified");
});

test("an EXPIRED cookie is refused — a dead session is not a session", async () => {
  const expired = signPhoneCookie(STORED_PHONE, Date.now() - 1000);
  const res = await prepare(requestWith({ cookie: expired }));

  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test("a FORGED cookie for the right phone is refused — the HMAC is the check", async () => {
  // Correct shape, correct phone, a signature nobody computed.
  const forged = `${STORED_PHONE}:${Date.now() + 60_000}:${"0".repeat(64)}`;
  const res = await prepare(requestWith({ cookie: forged }));

  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test("a VALID cookie for somebody else's phone is refused", async () => {
  const res = await prepare(requestWith({ cookie: liveCookieFor(OTHER_PHONE) }));

  assert.equal(res.ok, false);
  assert.equal(res.status, 401);
});

test("a VALID cookie for the customer's own phone passes", async () => {
  const res = await prepare(requestWith({ cookie: liveCookieFor(STORED_PHONE) }));

  assert.equal(res.ok, true, JSON.stringify(res.body));
  assert.equal(res.data.customerId, CUSTOMER_ID);
});

test("a mobile BEARER token is honoured — the app has no cookie", async () => {
  const res = await prepare(
    requestWith({ bearer: `Bearer ${liveCookieFor(STORED_PHONE)}` }),
  );

  assert.equal(res.ok, true, JSON.stringify(res.body));
});

// ── The one exemption, which must stay narrow ─────────────────────────────

test("operatorAuthenticated lets an admin place an order with no customer session", async () => {
  // The admin/offline entry path. The operator is on the phone or at the
  // counter, so there is no customer cookie and never can be. Before the
  // fix this worked by ACCIDENT — the comment in /api/admin/orders said in
  // so many words that it relied on the gate being soft.
  const res = await prepare(requestWith(), { operatorAuthenticated: true });

  assert.equal(res.ok, true, JSON.stringify(res.body));
});

test("ONLY the admin route sets operatorAuthenticated", () => {
  // The exemption is the whole hole, re-opened on purpose and kept behind
  // one door. If it ever appears on a customer-reachable route, defect 1
  // is back with a flag on it.
  const hits = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        if (/operatorAuthenticated:\s*true/.test(fs.readFileSync(full, "utf8"))) {
          hits.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));

  assert.deepEqual(hits, ["src/app/api/admin/orders/route.ts"]);
});

// ── THE ESCALATION — defect 2 ─────────────────────────────────────────────

/**
 * Every file that can mint a session, by name. A set rather than a loop
 * over the order routes: the question is not "do these two still behave",
 * it is "has a THIRD place learned to issue credentials".
 */
/**
 * Does this file import the signer? Reads the BRACES of each
 * `@/lib/phone-cookie` import and asks whether the signer is named in them.
 *
 * `[^}]*` and not `[\s\S]*?`: the first draft of this check was
 *
 *     /^import[\s\S]*?\bsignPhoneCookie\b[\s\S]*?from "@\/lib\/phone-cookie"/m
 *
 * and it reported /api/checkout as a minter when the only two occurrences of
 * the name in that file were the COMMENTS explaining its removal. A lazy
 * `[\s\S]*?` still crosses newlines, so the match ran from the file's first
 * `import` through 480 lines of body to a later import, and anything in
 * between counted. A false POSITIVE here is the benign direction, but the
 * same looseness would have hidden a real import behind an earlier one — so
 * strip comments first and never let the scan leave the brace list.
 */
function importsSigner(src) {
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const imports = code.matchAll(
    /import\s*\{([^}]*)\}\s*from\s*["']@\/lib\/phone-cookie["']/g,
  );
  for (const [, specifiers] of imports) {
    if (/\bsignPhoneCookie\b/.test(specifiers)) return true;
  }
  return false;
}

test("only /api/verify/check and the mobile token endpoints can sign a session", () => {
  const minters = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) {
        // The import is the capability. A route that cannot name the
        // signer cannot mint, whatever its body does.
        if (importsSigner(fs.readFileSync(full, "utf8"))) {
          minters.push(path.relative(ROOT, full));
        }
      }
    }
  };
  walk(path.join(ROOT, "src"));

  // The scan has to find the legitimate minters, or it is matching nothing
  // and the two assertions below are vacuous. /api/verify/check is the OTP
  // check itself — the one place a session may be born.
  assert.ok(
    minters.includes("src/app/api/verify/check/route.ts"),
    `the import scan matched nothing it should: ${JSON.stringify(minters)}`,
  );

  assert.ok(
    !minters.includes("src/app/api/checkout/route.ts"),
    "placing an order must not be able to issue a verified session",
  );
  assert.ok(
    !minters.includes("src/app/api/create-order/route.ts"),
    "creating a Razorpay order must not be able to issue a verified session",
  );
});

test("neither order route sets the phone cookie on any response", () => {
  // The import test above proves the capability is gone; this proves the
  // call site is gone too, so a re-added import cannot quietly revive it.
  for (const rel of [
    "src/app/api/checkout/route.ts",
    "src/app/api/create-order/route.ts",
  ]) {
    const code = read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

    assert.ok(
      !/cookies\.set\(\s*PHONE_COOKIE_NAME/.test(code),
      `${rel} sets the phone cookie directly — only /api/verify/check may`,
    );
    assert.ok(
      !/signPhoneCookie\s*\(/.test(code),
      `${rel} signs a phone cookie`,
    );
  }
});

test("the order routes still EXTEND a session they were given", () => {
  // Removing the mint must not log a real customer out mid-checkout.
  // rollPhoneCookieOnWebRequest re-signs from the INBOUND cookie and
  // no-ops without a valid one, so it cannot issue what OTP did not.
  for (const rel of [
    "src/app/api/checkout/route.ts",
    "src/app/api/create-order/route.ts",
  ]) {
    assert.match(read(rel), /rollPhoneCookieOnWebRequest\(req, res\)/);
  }
});

// ── The subscription copy, which no unit test can reach ───────────────────

test("place_subscription refuses a missing session instead of defaulting", () => {
  // This branch is inline in the route and needs a live Supabase client to
  // execute, so it is asserted on the source. The construct, not the
  // behaviour: the defect WAS a construct.
  const src = read("src/app/api/checkout/route.ts");
  const code = src.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

  assert.match(
    code,
    /if\s*\(!verified\)\s*\{[\s\S]{0,400}?status:\s*401/,
    "a missing session must be refused outright",
  );
  assert.ok(
    !/verified\?\.phone\s*\?\?/.test(code),
    "the fallback-to-stored-phone construct is back in the subscription branch",
  );
});

test("the fallback construct is gone from BOTH files", () => {
  for (const rel of [
    "src/lib/order-checkout.ts",
    "src/app/api/checkout/route.ts",
  ]) {
    const code = read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

    assert.ok(
      !/verified\?\.phone\s*\?\?/.test(code),
      `${rel} still defaults a missing verified phone to the stored one`,
    );
  }
});
