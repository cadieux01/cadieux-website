// /mkt — gates, read-only guarantee, and the two pure helpers the
// three-pane CRM rides on.
//
// Five properties pinned, and why each matters:
//
//   1. The /mkt page runs behind the ADMIN gate, not the shared PIN.
//      Concretely: /mkt/page.tsx wraps its content in <AdminShell>,
//      the same component /admin/* uses. AdminShell runs the
//      PasswordGate, which calls POST /api/admin/login — a team-order
//      bearer cannot satisfy it because verifyAdminSessionToken
//      rejects any payload whose `p` field is not "admin" (see
//      src/lib/admin-session). Swapping to a lighter wrapper that does
//      not gate on admin would silently open /mkt to the counter PIN.
//
//   2. The list route's new with_touch=1 block is admin-only. The
//      early isTeam return must stay AHEAD of the with_touch read —
//      if a PIN caller ever reached the block, note bodies and WA
//      message bodies (which are sensitive content) would end up in
//      their response.
//
//   3. Nothing under /mkt writes. Neither the /mkt page nor the
//      extended list route calls .insert / .update / .upsert /
//      .delete. The merged timeline is read-only by charter.
//
//   4. matchesSegment is the one place segment membership is decided.
//      The bug this test guards against is subtle: "never ordered"
//      must exclude plan-holders (a subscriber with no ad-hoc orders
//      is not a stranger) AND "lapsed" must be disjoint from "never
//      ordered" (a customer with no last order has no lapse to
//      measure). Both are easy to lose in a rewrite.
//
//   5. buildTimeline merges and sorts correctly — the right-pane
//      stream is one interleaved list across four source kinds
//      (orders / notes / whatsapp / reviews), newest first. A sort
//      bug here is the kind that silently hides recent activity.
//
// Pattern mirrors tests/admin-customers-crm.test.mjs: structural
// assertions over the route/page source (comments stripped so no
// claim can be satisfied by prose) + direct unit tests of the pure
// helpers imported out of src/app/mkt/page.tsx.

import "./_alias-hook.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel) =>
  read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const PAGE = "src/app/mkt/page.tsx";
const LAYOUT = "src/app/mkt/layout.tsx";
const LIST_ROUTE = "src/app/api/admin/customers/route.ts";

// Mirrors tests/admin-customers-crm.test.mjs — walk past the parameter
// list, then brace-count the handler body.
function handlerSlice(src, which) {
  const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${which}\\s*\\(`);
  const start = src.search(re);
  if (start === -1) return null;
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

// ── 1. /mkt rides the admin password gate ───────────────────────────

test("/mkt page wraps content in AdminShell — the admin-session gate", () => {
  const src = read(PAGE);
  assert.match(
    src,
    /from\s+["']@\/components\/admin\/AdminShell["']/,
    "the /mkt page must import AdminShell — it is the gate",
  );
  assert.match(src, /<AdminShell[\s>]/);
});

test("/mkt does NOT open to verifyAdminOrTeamOrder", () => {
  // The whole file tree under /mkt must never reach for the PIN gate.
  // The layout is intentionally minimal; the page uses AdminShell. If
  // either file ever imports verifyAdminOrTeamOrder, the surface is
  // open to the counter staff. Comments are stripped before the check
  // so a block-comment explaining the rule doesn't satisfy it.
  for (const rel of [PAGE, LAYOUT]) {
    assert.ok(
      !/verifyAdminOrTeamOrder|isTeamOrderToken/.test(code(rel)),
      `${rel} refers to the PIN gate — /mkt must be isAdmin only`,
    );
  }
});

// ── 2. Admin-only with_touch, PIN-safe early return ────────────────

test("list route's with_touch block sits AFTER the isTeam early return", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get, "GET handler missing");

  const teamReturn = get.search(/if\s*\(\s*isTeam\s*\)\s*\{[^}]*return\s+NextResponse/);
  assert.notEqual(teamReturn, -1, "the isTeam early-return is gone — aggregates would leak to PIN");

  const touchGate = get.search(/wantTouch\s*=\s*req\.nextUrl\.searchParams\.get\(\s*"with_touch"\s*\)/);
  assert.notEqual(touchGate, -1, "wantTouch flag is gone");

  assert.ok(
    teamReturn < touchGate,
    "the isTeam early return must fire BEFORE the with_touch block reads bodies",
  );
});

test("list route projects last_touch fields ONLY when wantTouch is truthy", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  // Conditional spread on the response row — absent fields when
  // wantTouch is false, nulled fields when true but no touch found.
  assert.match(
    get,
    /\.\.\.\(wantTouch[\s\S]*?last_touch_at:[\s\S]*?last_touch_body:[\s\S]*?last_touch_kind:/,
    "last_touch_* must be conditionally spread onto the row — never unconditional",
  );
});

test("list route projects touch_error ONLY under wantTouch", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  assert.match(
    get,
    /\.\.\.\(wantTouch\s*\?\s*\{\s*touch_error\s*\}\s*:\s*\{\s*\}\s*\)/,
  );
});

// ── 3. Read-only guarantee across the new surface ──────────────────

test("list route GET performs NO writes — .insert/.update/.upsert/.delete", () => {
  const src = code(LIST_ROUTE);
  const get = handlerSlice(src, "GET");
  assert.ok(get);
  for (const verb of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.ok(
      !get.includes(verb),
      `list GET contains ${verb} — the mkt phase is READ-ONLY`,
    );
  }
});

test("/mkt page performs NO writes", () => {
  const src = code(PAGE);
  for (const verb of [".insert(", ".update(", ".upsert(", ".delete("]) {
    assert.ok(
      !src.includes(verb),
      `/mkt page contains ${verb} — the mkt phase is READ-ONLY`,
    );
  }
  // adminFetch defaults to GET; if a future method:"POST" or "PATCH"
  // sneaks in through adminFetch it should break this test.
  assert.ok(
    !/method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(src),
    "the /mkt page issues a non-GET adminFetch — READ-ONLY is the rule",
  );
});

// ── 4 & 5. Pure helpers ────────────────────────────────────────────

// Lifted out of the .tsx page into @/lib/mkt-crm so `node --test`
// can import them without a bundler. The page imports from there.
const libMod = await import("../src/lib/mkt-crm.ts");
const matchesSegment = libMod.matchesSegment;
const buildTimeline = libMod.buildTimeline;

function row(partial) {
  // Minimal SegmentableRow shape, with the UI-only fields mirrored
  // so a future tightening of the SegmentableRow type to require
  // them (e.g. for a typed test harness) will still compile.
  return {
    total_orders: 0,
    has_subscription: false,
    last_order_at: null,
    outstanding_cod: 0,
    ...partial,
  };
}

test("never_ordered excludes subscribers — a plan-holder is not a stranger", () => {
  // The whole point of the AND clause: a subscriber with 0 ad-hoc
  // orders has been served, so they must NOT appear in win-back.
  const stranger = row({ total_orders: 0, has_subscription: false });
  const subscriber = row({ total_orders: 0, has_subscription: true });
  assert.equal(matchesSegment(stranger, "never_ordered"), true);
  assert.equal(matchesSegment(subscriber, "never_ordered"), false);
});

test("lapsed requires a last order — never-ordered customers are NOT lapsed", () => {
  // The two sets must be disjoint: "never ordered" and "lapsed"
  // measure different things and must not overlap.
  const long = new Date(Date.now() - 40 * 86_400_000).toISOString();
  assert.equal(
    matchesSegment(row({ last_order_at: long }), "lapsed"),
    true,
    "a 40-day-old order should read as lapsed",
  );
  assert.equal(
    matchesSegment(row({ last_order_at: null }), "lapsed"),
    false,
    "a customer with no last order must NOT be lapsed",
  );
});

test("lapsed boundary — 21 days EXACTLY is not yet lapsed", () => {
  // The rule is strictly > 21 days, matching the SEGMENT_LABEL "Lapsed >21d".
  const twentyOne = new Date(Date.now() - 21 * 86_400_000).toISOString();
  const twentyTwo = new Date(Date.now() - 22 * 86_400_000).toISOString();
  assert.equal(matchesSegment(row({ last_order_at: twentyOne }), "lapsed"), false);
  assert.equal(matchesSegment(row({ last_order_at: twentyTwo }), "lapsed"), true);
});

test("owes_cod fires only on a positive outstanding balance", () => {
  assert.equal(matchesSegment(row({ outstanding_cod: 0 }), "owes_cod"), false);
  assert.equal(matchesSegment(row({ outstanding_cod: 42 }), "owes_cod"), true);
});

test("buildTimeline interleaves ALL four sources and sorts newest first", () => {
  const data = {
    customer: row(),
    orders: [
      {
        id: "o1",
        order_number: "OLF1",
        total_amount: 300,
        status: "delivered",
        payment_method: "cod",
        payment_status: "paid",
        delivery_address: "x",
        created_at: "2026-10-01T10:00:00Z",
      },
    ],
    subscriptions: [],
    notes: [
      {
        id: "n1",
        kind: "call",
        body: "left voicemail",
        author: "raja",
        created_at: "2026-10-02T09:00:00Z",
        order_id: "o1",
        subscription_id: null,
      },
    ],
    notes_error: null,
    whatsapp: {
      conversations: [],
      messages: [
        {
          id: "m1",
          conversation_id: "c1",
          direction: "in",
          body: "pls deliver tomorrow",
          created_at: "2026-10-03T08:00:00Z",
        },
      ],
    },
    whatsapp_error: null,
    reviews: [
      {
        id: "r1",
        product_slug: "high-protein",
        author_name: "arjun",
        rating: 5,
        body: "great",
        created_at: "2026-10-04T07:00:00Z",
        is_deleted: false,
      },
    ],
    reviews_error: null,
  };

  const items = buildTimeline(data);
  assert.equal(items.length, 4, "every source row must appear exactly once");

  // Newest first — the review, then whatsapp, then call, then order.
  const kinds = items.map((i) => i.kind);
  assert.deepEqual(kinds, ["review", "whatsapp_in", "call", "order"]);

  // Each id is prefixed by its source so a review id colliding with
  // an order id (uuids don't, but the prefix also serves as a React
  // key safety net) still produces distinct timeline rows.
  assert.ok(items.every((i) => /^[onwr]-/.test(i.id)));
});

test("buildTimeline — empty detail yields an empty timeline", () => {
  const items = buildTimeline({
    customer: row(),
    orders: [],
    subscriptions: [],
    notes: [],
    notes_error: null,
    whatsapp: { conversations: [], messages: [] },
    whatsapp_error: null,
    reviews: [],
    reviews_error: null,
  });
  assert.deepEqual(items, []);
});
