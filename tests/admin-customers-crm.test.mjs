// CRM Phase 1 — the gates and the read-only guarantee on the two
// customer admin routes.
//
// Four properties this file pins down, and the reason each matters:
//
//   1. GET /api/admin/customers is still opened by
//      verifyAdminOrTeamOrder, NOT isAdmin. It is one of exactly four
//      endpoints the /register PIN unlocks, so flipping it to isAdmin
//      locks the shared counter-staff PIN out of customer lookup — the
//      /register form can no longer resolve a phone to a customer_id
//      and every walk-in order the team takes at the counter would fail
//      silently. The PIN flow is why the list stays dual-auth even as
//      the aggregates are added on top.
//
//   2. The team-PIN caller sees a BARE customer row — no total_spent,
//      no outstanding_cod, no has_subscription. Omitted, not zeroed:
//      zeroing would leak the signal "a real customer exists here with
//      no spend / no debt / no plan", which is a lookup oracle. The
//      early return branch keeps the response shape honest.
//
//   3. GET /api/admin/customers/[id] is isAdmin-only. The detail page
//      runs the CRM panels (notes, whatsapp thread, reviews) which read
//      content the team-PIN has no business seeing. No dual-auth here,
//      ever.
//
//   4. NEITHER GET HANDLER calls .insert / .update / .upsert / .delete
//      anywhere. The CRM phase is read-only by charter — a writer
//      slipping in via a convenience call (e.g. "touch last_seen_at
//      when the detail loads") must break this test before it lands.
//      Scoped to the GET branch of each file — the detail route's
//      pre-existing PATCH handler legitimately calls .update().
//
// The assertions parse the ROUTE SOURCE directly. We cannot invoke the
// handlers from node --test — `NextRequest` ships no `exports` map and
// supabaseAdmin is a module-scoped client that would need a live DB —
// so the properties above are verified against the code, not the live
// response. Same shape as tests/save-customer-auth.test.mjs.

import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
/** Source with comments stripped — no assertion can be satisfied by
 *  prose. Matches the stripping approach in save-customer-auth. */
const code = (rel) =>
  read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const LIST_ROUTE = "src/app/api/admin/customers/route.ts";
const DETAIL_ROUTE = "src/app/api/admin/customers/[id]/route.ts";

// ── Helpers that slice a single export handler out of a route file.
// The detail route has GET + PATCH in the same module; the read-only
// assertion must only inspect GET, so the slicer is the shared
// primitive those checks all stand on.

function handlerSlice(src, which) {
  // `export async function GET(` or `export async function PATCH(`.
  // Supports the `export function` spelling too in case a handler is
  // ever converted away from async.
  const re = new RegExp(
    `export\\s+(?:async\\s+)?function\\s+${which}\\s*\\(`,
  );
  const start = src.search(re);
  if (start === -1) return null;

  // Walk past the PARAMETER LIST first. The handlers here take a
  // destructured arg (`{ params }: { params: { id: string } }`) so a
  // naive "first `{` after the signature" picks up the destructuring,
  // not the function body. Count parens from `(` to its matching `)`
  // THEN scan from there for the body's opening brace.
  const parenOpen = src.indexOf("(", start);
  if (parenOpen === -1) return null;
  let parenDepth = 0;
  let parenClose = -1;
  for (let i = parenOpen; i < src.length; i++) {
    const ch = src[i];
    if (ch === "(") parenDepth += 1;
    else if (ch === ")") {
      parenDepth -= 1;
      if (parenDepth === 0) { parenClose = i; break; }
    }
  }
  if (parenClose === -1) return null;

  const openAt = src.indexOf("{", parenClose);
  if (openAt === -1) return null;
  let depth = 0;
  for (let i = openAt; i < src.length; i++) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(start, i + 1);
    }
  }
  return null;
}

// ── 1. The list route is still dual-auth ─────────────────────────────

test("list route is gated by verifyAdminOrTeamOrder (NOT isAdmin)", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get, "GET handler for the list route is gone");

  assert.match(
    get,
    /verifyAdminOrTeamOrder\s*\(\s*req\s*\)/,
    "the list route must verify admin OR team-order — this is what the /register PIN rides on",
  );

  // isAdmin() IS allowed to appear in the handler (to compute isTeam),
  // but NOT as the single gate. So: no `if (!isAdmin(req))` guarding
  // the whole response.
  assert.doesNotMatch(
    get,
    /if\s*\(\s*!\s*isAdmin\s*\(\s*req\s*\)\s*\)\s*\{\s*return\s+NextResponse\s*\.\s*json\s*\(\s*\{\s*error\s*:\s*"Unauthorized"/,
    "the list route must not be swapped to an isAdmin-only gate — see the four-endpoint rule",
  );
});

// ── 2. Team-PIN omits aggregates entirely ───────────────────────────

test("list route computes isTeam from isAdmin + isTeamOrderToken", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // The gate admits two kinds of caller; the body has to tell them
  // apart, because the response shape differs by caller type.
  assert.match(
    get,
    /isTeam\s*=\s*!\s*isAdmin\s*\(\s*req\s*\)\s*&&\s*isTeamOrderToken\s*\(\s*req\s*\)/,
  );
});

test("team-PIN response path returns BEFORE the orders aggregate runs", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // A plain `if (isTeam) return` short-circuit, and it must land AHEAD
  // of the orders.in() fan-out. If this moves below the fan-out, the
  // team-PIN starts touching the orders table for nothing — and worse,
  // the response starts leaking aggregates.
  const guard = get.search(/if\s*\(\s*isTeam\s*\)\s*\{[^}]*return\s+NextResponse/);
  assert.notEqual(guard, -1, "the isTeam early-return is missing — aggregates would leak to PIN");

  const ordersFan = get.search(/\.\s*from\s*\(\s*"orders"\s*\)/);
  assert.notEqual(ordersFan, -1, "the orders fan-out is gone");
  assert.ok(
    guard < ordersFan,
    "the isTeam early-return must precede the orders fan-out",
  );
});

test("team-PIN response does NOT project the CRM aggregate keys", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // Isolate the isTeam branch — the response shape there is what
  // matters. End-of-branch is marked by the next `}` at the enclosing
  // depth; a simple capture of everything from `if (isTeam)` up to the
  // next `NextResponse.json` is enough, since the branch is only a
  // couple of lines.
  const idx = get.search(/if\s*\(\s*isTeam\s*\)\s*\{/);
  assert.notEqual(idx, -1);
  const tail = get.slice(idx);
  const endOfResp = tail.indexOf("NextResponse.json");
  const after = tail.slice(endOfResp, endOfResp + 200);

  for (const field of [
    "total_spent",
    "outstanding_cod",
    "has_subscription",
  ]) {
    assert.ok(
      !after.includes(field),
      `team-PIN branch leaks ${field} — the whole point of the branch is to omit aggregates`,
    );
  }
});

// ── 3. Admin path adds the CRM aggregates ───────────────────────────

test("admin path accumulates money in PAISE, divides once at the end", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);

  // The accumulator is the paise key, not a float rupee key.
  assert.match(get, /total_spent_paise/);
  assert.match(get, /outstanding_cod_paise/);

  // Rupees are the Math.round(amt * 100) coming in…
  assert.match(get, /Math\.round\s*\(\s*amt\s*\*\s*100\s*\)/);
  // …and the division happens once, when the response row is built.
  assert.match(get, /total_spent_paise\s*\/\s*100/);
  assert.match(get, /outstanding_cod_paise\s*\/\s*100/);
});

test("admin path uses isCancelled() for the cancelled filter — not cancelled_at", () => {
  const src = code(LIST_ROUTE);
  // cancelled_at is NEVER WRITTEN in prod — matching it would include every
  // cancelled order in both total_spent and outstanding_cod.
  assert.ok(
    !/cancelled_at/.test(src),
    "the dead cancelled_at column must not appear in the list route",
  );
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  assert.match(get, /isCancelled\s*\(\s*row\.status\s*\)/);
});

test("outstanding_cod uses method='cod' AND payment_status not like 'paid%'", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // Two conjuncts, in either order. Spelled 'cod' lowercase (the
  // normalise-and-compare pattern the route uses).
  assert.match(get, /method\s*===\s*"cod"/);
  // "not like 'paid%'" is expressed in JS as `!pay.startsWith("paid")`.
  assert.match(get, /!\s*pay\.startsWith\s*\(\s*"paid"\s*\)/);
});

test("admin path projects cancelled_orders + last_cancelled_status_at — tried_cancelled rides on them", () => {
  // The chip's whole point is a phone-call list, and the row needs to
  // show when the cancellation happened so the operator knows which
  // conversation to open. If these two fields stop being projected,
  // the CRM row loses the signal AND the tried_cancelled segment
  // silently empties (matchesSegment keys on cancelled_orders).
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // The agg bumps a counter on every cancelled row.
  assert.match(get, /cur\.cancelled_orders\s*\+=\s*1/);
  // And the response row projects BOTH keys.
  assert.match(get, /cancelled_orders:\s*a\?\.cancelled_orders\s*\?\?\s*0/);
  assert.match(
    get,
    /last_cancelled_status_at:\s*a\?\.last_cancelled_status_at\s*\?\?\s*null/,
  );
});

test("admin path reads status_updated_at, NOT cancelled_at — cancelled_at is dead in prod", () => {
  // Pinning the source column. If a future refactor swaps this for
  // `row.cancelled_at` the tried_cancelled row will silently blank
  // out (prod has 0 non-null cancelled_at across 130 cancelled
  // orders). The select carries status_updated_at and the agg reads
  // it; the fallback to created_at only fires if a row has neither,
  // which no prod row does today.
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // Select must project status_updated_at so the agg can read it.
  assert.match(get, /\.select\(\s*"[^"]*status_updated_at/);
  // The aggregation uses status_updated_at (with created_at as a
  // defensive fallback) to populate last_cancelled_status_at.
  assert.match(
    get,
    /row\.status_updated_at\s*\?\?\s*row\.created_at/,
  );
});

// ── 4. Detail route is isAdmin-only ─────────────────────────────────

test("detail route GET is gated by isAdmin — no team-PIN opening", () => {
  const src = code(DETAIL_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get, "GET handler for the detail route is gone");
  assert.match(get, /if\s*\(\s*!\s*isAdmin\s*\(\s*req\s*\)\s*\)/);
  // verifyAdminOrTeamOrder MUST NOT be imported or used here — the
  // detail route reads content the counter PIN has no business seeing.
  assert.ok(
    !/verifyAdminOrTeamOrder/.test(src),
    "the detail route must not open to team-PIN — notes/WhatsApp/reviews are admin-only",
  );
});

// ── 5. CRM panels each carry their own *_error ──────────────────────

test("detail route exposes a *_error key for each CRM panel", () => {
  const src = code(DETAIL_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // Empty-vs-failed must not alias: a 500 on reviews should read as
  // "reviews failed to load", not as "no reviews".
  assert.match(get, /notes_error/);
  assert.match(get, /whatsapp_error/);
  assert.match(get, /reviews_error/);
});

test("detail route uses customer_phone (not phone) on reviews — 42703 guard", () => {
  const src = code(DETAIL_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // The reviews table's phone column is `customer_phone`; asking for
  // `phone` returns 42703 undefined_column.
  const reviewsSelect = get.match(/\.from\s*\(\s*"reviews"\s*\)[\s\S]{0,400}?\.select\s*\(([^)]*)\)/);
  assert.ok(reviewsSelect, "the reviews select on the detail route is gone");
  assert.match(reviewsSelect[1], /customer_phone/);
});

test("detail route joins WhatsApp via the trailing 10 digits — not customer_id", () => {
  const src = code(DETAIL_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // whatsapp_conversations.customer_id is 100% NULL in prod, so the
  // join must be on normalised phone.
  const wa = get.match(/\.from\s*\(\s*"whatsapp_conversations"\s*\)[\s\S]{0,400}?\.ilike\s*\(\s*"phone"\s*,\s*`%\$\{custTail10\}`\s*\)/);
  assert.ok(wa, "the whatsapp conversation join must be an ilike on trailing 10 digits — a plain eq('customer_id', …) returns 0 rows silently");
});

// ── 6. Read-only guarantee on both GET handlers ─────────────────────

test("list route GET performs NO writes — .insert/.update/.upsert/.delete", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  for (const verb of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.ok(
      !get.includes(verb),
      `list GET contains ${verb} — the CRM phase is READ-ONLY`,
    );
  }
});

test("detail route GET performs NO writes — .insert/.update/.upsert/.delete", () => {
  // The detail route's PATCH handler legitimately contains .update();
  // the scope of this test is strictly the GET branch.
  const src = code(DETAIL_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  for (const verb of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.ok(
      !get.includes(verb),
      `detail GET contains ${verb} — the CRM phase is READ-ONLY`,
    );
  }
});

// Final sanity — the slicer isolates ONE handler. If handlerSlice ever
// returned the whole file (e.g. because brace-counting went wrong), the
// read-only test above would silently cover the PATCH handler and pass
// on a broken premise. Pin that it does not.

test("handlerSlice stops at the handler boundary — it does not swallow the file", () => {
  const src = code(DETAIL_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // The GET slice MUST NOT contain the PATCH signature. If this fails,
  // every .update() in PATCH is in scope and the read-only test above
  // is passing for the wrong reason.
  assert.ok(
    !/export\s+(?:async\s+)?function\s+PATCH/.test(get),
    "handlerSlice leaked PATCH into the GET slice — the read-only assertion is unreliable until this is fixed",
  );
});
