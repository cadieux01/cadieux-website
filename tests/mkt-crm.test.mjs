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

// ── 1. /mkt is gated server-side by Supabase Auth ──────────────────
//
// This block replaces a prior admin-PasswordGate assertion. The gate
// has MOVED from MktShell (client-side) into /mkt/layout.tsx
// (server-side) — see tests/mkt-team-tasks.test.mjs for the broader
// pins on the new auth surface. The assertions here are the slice
// that belongs with the /mkt CRM: the page still wraps content in
// MktShell, the shell is pure chrome, and the layout is where the
// gate lives.

test("/mkt page wraps content in MktShell", () => {
  const src = read(PAGE);
  assert.match(
    src,
    /from\s+["']@\/components\/mkt\/MktShell["']/,
    "the /mkt page must import MktShell — the lighter, on-brand chrome",
  );
  assert.match(src, /<MktShell[\s>]/);
});

test("/mkt gate runs in the server-side layout, not MktShell", () => {
  // MktShell MUST NOT carry the gate any more. If it does, every
  // page renders chrome and then immediately swaps for a password
  // form — which was the prior design and bypassed Supabase Auth.
  // Comments are stripped so a docstring explaining the rule can't
  // satisfy it.
  const shell = code("src/components/mkt/MktShell.tsx");
  assert.ok(
    !/PasswordGate/.test(shell),
    "MktShell must be pure chrome — the gate now lives in /mkt/layout.tsx",
  );

  // The layout is the gate.
  const layout = code("src/app/mkt/layout.tsx");
  assert.match(
    layout,
    /readMktSession/,
    "the /mkt layout must call readMktSession to run the server-side gate",
  );
  assert.match(layout, /redirect\(\s*["']\/mkt\/login["']/);
});

test("/mkt does NOT open to verifyAdminOrTeamOrder", () => {
  // The whole file tree under /mkt must never reach for the PIN gate.
  // The layout is intentionally minimal; the page uses MktShell,
  // which gates on the admin session via PasswordGate. If any file
  // in the /mkt tree OR its dedicated shell imports the PIN helpers,
  // the surface is open to counter staff. Comments are stripped
  // before the check so a block-comment explaining the rule doesn't
  // satisfy it.
  const files = [PAGE, LAYOUT, "src/components/mkt/MktShell.tsx"];
  for (const rel of files) {
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

// ── Storefront cart bubble must not render on /mkt ─────────────────

test("TimelineRow middle column carries minWidth:0 — the overlap fix", () => {
  // The symptom the operator reported before this phase: "OLF192"
  // colliding with the row's rupee meta (e.g. ₹7,418), and note
  // bodies sitting on top of their own timestamps in the detail
  // pane.
  //
  // Root cause: the <li> was a 3-column grid
  // (28px · minmax(0,1fr) · auto), and the middle grid cell held a
  // <div> whose content (the title row + body paragraph) had its
  // own intrinsic min-content. Without min-width:0 on that child
  // div, long tokens (an order's whole-rupee amount, an un-broken
  // single-word note body) stretched past the cell edge and
  // visually overlapped the auto-sized right cell (the timestamp).
  //
  // The fix is one declaration; pin it so a future refactor can't
  // silently remove it and reintroduce the overlap.
  const src = read(PAGE);
  // Find the TimelineRow slice; inside, assert there IS a
  // minWidth: 0 on the middle div.
  const slice = src.slice(
    src.indexOf("function TimelineRow"),
    src.indexOf("function SkeletonList") > -1
      ? src.indexOf("function SkeletonList")
      : src.length,
  );
  assert.ok(
    /minWidth\s*:\s*0/.test(slice),
    "TimelineRow's middle grid cell is missing minWidth: 0 — the overlap will come back",
  );
});

test("FloatingCartButton hides on /mkt — not just /admin", () => {
  // The cart bubble is mounted in the root layout and renders on
  // every route that isn't in HIDDEN_PREFIXES. /admin was already
  // excluded; /mkt must be too — the operator is not a customer,
  // and the bubble was both nonsensical here and visually crashing
  // into the detail pane's bottom buttons. This is a structural
  // pin: adding a new operator surface in future means adding it
  // here too.
  const src = read("src/components/FloatingCartButton.tsx");
  // The constant definition carries the literal list.
  const match = src.match(/HIDDEN_PREFIXES\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, "HIDDEN_PREFIXES is gone from FloatingCartButton");
  const items = match[1]
    .split(",")
    .map((s) => s.trim().replace(/^["']|["']$/g, ""));
  assert.ok(
    items.includes("/mkt"),
    `/mkt is not in HIDDEN_PREFIXES — the bubble would render on the marketing workspace. Got: ${items.join(", ")}`,
  );
  assert.ok(items.includes("/admin"), "/admin still in HIDDEN_PREFIXES");
});

test("/mkt page performs NO writes", () => {
  const src = code(PAGE);
  // `.insert(` / `.update(` / `.upsert(` are unambiguous — the only
  // things in this codebase that name them are supabase query
  // builders. `.delete(` is deliberately NOT in this list because
  // Map.prototype.delete is a legitimate client-side API and the
  // row-element ref registry uses it. The real network-write check
  // is the method-regex below — anything that would issue a delete
  // call has to go through adminFetch, which travels under a POST /
  // PUT / PATCH / DELETE method the regex catches.
  for (const verb of [".insert(", ".update(", ".upsert("]) {
    assert.ok(
      !src.includes(verb),
      `/mkt page contains ${verb} — the mkt phase is READ-ONLY`,
    );
  }
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

test("never_ordered means 'never received bread' — a cancel-only row still fits", () => {
  // Measured in prod: 48 of the 470 never-ordered rows have only
  // cancelled orders. The user's rule: never_ordered describes "no
  // bread delivered", regardless of whether an attempt was cancelled.
  // Those 48 appear in BOTH never_ordered AND tried_cancelled by
  // design; see the test below for the subset rule.
  const cancelOnly = row({ total_orders: 0, cancelled_orders: 2 });
  assert.equal(matchesSegment(cancelOnly, "never_ordered"), true);
});

test("tried_cancelled is a SUBSET of never_ordered — 0 live orders, >=1 cancelled, no sub", () => {
  // A ≥ 1 cancelled, no live order, no subscription → tried_cancelled.
  assert.equal(
    matchesSegment(
      row({ total_orders: 0, cancelled_orders: 1, has_subscription: false }),
      "tried_cancelled",
    ),
    true,
  );
  // Zero cancellations → not tried_cancelled, but still never_ordered.
  assert.equal(
    matchesSegment(
      row({ total_orders: 0, cancelled_orders: 0 }),
      "tried_cancelled",
    ),
    false,
  );
  // Any live order disqualifies, however many cancellations.
  assert.equal(
    matchesSegment(
      row({ total_orders: 1, cancelled_orders: 5 }),
      "tried_cancelled",
    ),
    false,
  );
  // Subscribers never appear here (same reason as never_ordered — not
  // strangers, don't call them "tried, cancelled").
  assert.equal(
    matchesSegment(
      row({ total_orders: 0, cancelled_orders: 2, has_subscription: true }),
      "tried_cancelled",
    ),
    false,
  );
});

test("tried_cancelled ⊂ never_ordered — a cancel-only row satisfies BOTH", () => {
  const r = row({ total_orders: 0, cancelled_orders: 1, has_subscription: false });
  assert.equal(matchesSegment(r, "never_ordered"), true);
  assert.equal(matchesSegment(r, "tried_cancelled"), true);
});

test("SEGMENTS + SEGMENT_LABEL both carry tried_cancelled and relabel never_ordered", () => {
  assert.ok(libMod.SEGMENTS.includes("tried_cancelled"));
  assert.equal(libMod.SEGMENT_LABEL.tried_cancelled, "Tried, cancelled");
  // Re-label is the whole point — the old "Never ordered" lumped two
  // populations together.
  assert.equal(libMod.SEGMENT_LABEL.never_ordered, "Never received bread");
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

test("the CRM row surfaces 'Cancelled N · {date}' when there are no live orders", () => {
  // Pinning the surface so an operator opening /mkt?segment=tried_cancelled
  // immediately sees HOW MANY cancelled orders and WHEN — the two
  // things that tell them which conversation to open. The condition
  // intentionally fires for ANY row with total_orders=0 and >=1
  // cancelled, not just when the tried_cancelled chip is active, so
  // the signal travels with the row wherever it is viewed.
  const pageSrc = fs.readFileSync(
    path.join(ROOT, "src/app/mkt/page.tsx"),
    "utf8",
  );
  assert.match(
    pageSrc,
    /row\.total_orders\s*===\s*0\s*&&\s*row\.cancelled_orders\s*>\s*0/,
  );
  assert.match(
    pageSrc,
    /Cancelled \{row\.cancelled_orders\}[\s\S]*?formatDate\(row\.last_cancellation_at\)/,
  );
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

// ── 12-week activity strip bucketing ────────────────────────────────

const buildWeekBuckets = libMod.buildWeekBuckets;
const countTimelineLines = libMod.countTimelineLines;
const WEEKS = libMod.WEEKS;

test("buildWeekBuckets returns exactly 12 buckets in oldest-first order", () => {
  const buckets = buildWeekBuckets(
    [],
    new Date("2026-11-18T12:00:00+05:30"),
  );
  assert.equal(buckets.length, 12);
  assert.equal(WEEKS, 12);
  // Oldest first — bucket[0].start precedes bucket[11].start.
  for (let i = 1; i < buckets.length; i++) {
    assert.ok(
      buckets[i - 1].start.getTime() < buckets[i].start.getTime(),
      `bucket ${i - 1} must precede bucket ${i}`,
    );
  }
  // Empty input — every count is zero.
  assert.ok(buckets.every((b) => b.count === 0));
});

test("buildWeekBuckets drops rows older than the 12-week window", () => {
  const now = new Date("2026-11-18T12:00:00+05:30");
  // 13 weeks ago is outside; a bucket count of 1 would mean the
  // window silently widened.
  const thirteen = new Date(now.getTime() - 13 * 7 * 86_400_000).toISOString();
  const buckets = buildWeekBuckets([{ created_at: thirteen }], now);
  assert.equal(
    buckets.reduce((s, b) => s + b.count, 0),
    0,
    "a 13-week-old row must not land in any of the 12 buckets",
  );
});

test("buildWeekBuckets lands today's order in the newest bucket", () => {
  const now = new Date("2026-11-18T12:00:00+05:30");
  const today = new Date(now.getTime() - 60 * 1000).toISOString();
  const buckets = buildWeekBuckets([{ created_at: today }], now);
  assert.equal(buckets[buckets.length - 1].count, 1);
  // And nowhere else.
  assert.equal(
    buckets.slice(0, -1).reduce((s, b) => s + b.count, 0),
    0,
  );
});

test("buildWeekBuckets — malformed dates are skipped, never crash", () => {
  const now = new Date("2026-11-18T12:00:00+05:30");
  const buckets = buildWeekBuckets(
    [
      { created_at: "not a date" },
      { created_at: "" },
      { created_at: now.toISOString() },
    ],
    now,
  );
  assert.equal(
    buckets.reduce((s, b) => s + b.count, 0),
    1,
    "only the valid date counts",
  );
});

// ── Timeline body line-counting ────────────────────────────────────

test("countTimelineLines — short body is 1 line, long body wraps", () => {
  assert.equal(countTimelineLines("hello"), 1);
  // 180 characters wraps to 2 at wrapAt=90.
  assert.equal(countTimelineLines("x".repeat(180)), 2);
  // Three lines of hard breaks is 3.
  assert.equal(countTimelineLines("a\nb\nc"), 3);
});

test("countTimelineLines — the >3 threshold that drives the 'more' toggle", () => {
  // The page uses countTimelineLines(body) > 3 to show "more". Pin
  // both sides of that boundary so a refactor can't silently flip.
  const threeLines = "a\nb\nc";
  const fourLines = "a\nb\nc\nd";
  assert.ok(!(countTimelineLines(threeLines) > 3), "3 lines must NOT trigger 'more'");
  assert.ok(countTimelineLines(fourLines) > 3, "4 lines MUST trigger 'more'");
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
