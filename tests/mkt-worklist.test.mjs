// /mkt worklist + outreach — invariants pinned so future changes
// cannot silently regress what the brief named:
//
//   1. logistics.outreach migration has the full shape, every
//      brief-named column, the two indexes, idempotent + RLS on
//      from the first statement.
//   2. RLS: admin sees all, leader sees team rows (via a dedicated
//      helper), member sees own. INSERT pins created_by to
//      auth.uid() + active profile check. DELETE is admin-only.
//   3. API routes:
//      - GET /api/mkt/worklist gates on active profile (NOT admin),
//        paginates orders/customers/subs/outreach, uses isCancelled
//        (not cancelled_at), sorts never-contacted to the front,
//        flags 14-day recently_contacted.
//      - POST /api/mkt/outreach gates on active, pins created_by
//        server-side, validates channel + outcome against the
//        allowed lists.
//   4. UI:
//      - "Work this list" button appears on /mkt when a segment
//        other than 'all' is selected and the list is non-empty.
//      - /mkt/worklist renders the three brief-required actions
//        (WhatsApp, Call, outcome buttons) and the recently-
//        contacted warning ribbon.
//      - /mkt/worklist page is gated by requireMktSession (any
//        active profile; NOT requireAdmin).
//      - Phone →wa.me prefixes 91 via whatsAppHref — a plain
//        10-digit phone must not land in the href bare.

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

const MIGRATION = "supabase/migrations/20261121120000_mkt_outreach.sql";

// ── 1. Migration shape ────────────────────────────────────────────

test("migration creates logistics.outreach with every brief-named column", () => {
  const src = read(MIGRATION);
  // The create statement is idempotent — same shape the mkt team
  // migration uses — so re-applying is a no-op.
  assert.match(src, /create table if not exists logistics\.outreach/);
  for (const col of [
    /customer_id\s+uuid\s+not null/,
    /segment\s+text/,
    /channel\s+text\s+not null/,
    /outcome\s+text\s+not null/,
    /note\s+text/,
    /assigned_to\s+uuid/,
    /created_by\s+uuid\s+not null/,
    /created_at\s+timestamptz\s+not null\s+default\s+now\(\)/,
    /updated_at\s+timestamptz\s+not null\s+default\s+now\(\)/,
  ]) {
    assert.match(src, col, `missing column pattern ${col}`);
  }
});

test("channel + outcome are CHECK-constrained to the brief's enum lists", () => {
  const src = read(MIGRATION);
  // Channels
  for (const v of ["whatsapp", "call", "visit", "other"]) {
    assert.match(src, new RegExp(`'${v}'`), `channel value ${v} missing`);
  }
  // Outcomes
  for (const v of [
    "contacted",
    "no_answer",
    "not_interested",
    "ordered",
    "wrong_number",
    "callback",
  ]) {
    assert.match(src, new RegExp(`'${v}'`), `outcome value ${v} missing`);
  }
});

test("migration enables RLS before any INSERT could reach the table", () => {
  const src = read(MIGRATION);
  const createIdx = src.search(/create table if not exists logistics\.outreach/);
  const rlsIdx = src.search(/alter table logistics\.outreach enable row level security/);
  assert.ok(createIdx >= 0 && rlsIdx > createIdx, "RLS enable must follow table create");
});

test("migration has both brief-named indexes", () => {
  const src = read(MIGRATION);
  assert.match(
    src,
    /on logistics\.outreach \(customer_id, created_at desc\)/,
  );
  assert.match(
    src,
    /on logistics\.outreach \(outcome, created_at desc\)/,
  );
});

test("RLS helpers: new my_led_team_member_ids + reuses is_admin + my_led_team_ids", () => {
  const src = read(MIGRATION);
  // The new helper signature + SECURITY DEFINER + frozen search_path.
  assert.match(
    src,
    /function logistics\.my_led_team_member_ids\(\)\s+returns setof uuid/,
  );
  assert.match(src, /security definer/);
  assert.match(src, /set search_path to ''/);
  // Reuses, not reinvents.
  assert.match(src, /logistics\.my_led_team_ids\(\)/);
  assert.match(src, /logistics\.is_admin\(\)/);
});

test("SELECT policy: admin all, leader team rows, member own; INSERT pins created_by+active", () => {
  const src = read(MIGRATION);
  // The SELECT policy stacks the three conditions.
  const selMatch = src.match(
    /create policy outreach_select[\s\S]+?using \(([\s\S]+?)\);/,
  );
  assert.ok(selMatch, "outreach_select policy missing");
  const sel = selMatch[1];
  assert.match(sel, /logistics\.is_admin\(\)/);
  assert.match(sel, /created_by\s*=\s*auth\.uid\(\)/);
  assert.match(sel, /logistics\.my_led_team_member_ids\(\)/);

  // INSERT WITH CHECK enforces created_by = auth.uid() + active row.
  const insMatch = src.match(
    /create policy outreach_insert[\s\S]+?with check \(([\s\S]+?)\);/,
  );
  assert.ok(insMatch, "outreach_insert policy missing");
  const ins = insMatch[1];
  assert.match(ins, /created_by\s*=\s*auth\.uid\(\)/);
  assert.match(ins, /logistics\.profiles[\s\S]*status\s*=\s*'active'/);
});

test("DELETE policy is admin-only — outreach rows are the audit trail", () => {
  const src = read(MIGRATION);
  const delMatch = src.match(
    /create policy outreach_delete[\s\S]+?using \(([\s\S]+?)\);/,
  );
  assert.ok(delMatch);
  // Only the admin predicate — no created_by branch, no leader branch.
  assert.match(delMatch[1], /logistics\.is_admin\(\)/);
  assert.doesNotMatch(delMatch[1], /created_by/);
  assert.doesNotMatch(delMatch[1], /my_led_team/);
});

test("migration never bare-authenticates — every policy names TO authenticated", () => {
  // Brief: "Never bare `authenticated`". Each policy MUST scope to
  // the authenticated role explicitly (as opposed to leaving it open
  // to PUBLIC which would include anon).
  const src = read(MIGRATION);
  const policyBlocks = src.match(/create policy[\s\S]+?;/g) ?? [];
  assert.ok(policyBlocks.length >= 4, "fewer than 4 policies — missing one");
  for (const p of policyBlocks) {
    assert.match(p, /to authenticated/i, `policy lacks TO authenticated:\n${p}`);
  }
});

test("helper EXECUTE is revoked from public, granted to authenticated + service_role", () => {
  const src = read(MIGRATION);
  assert.match(
    src,
    /revoke all on function logistics\.my_led_team_member_ids\(\) from public/,
  );
  assert.match(
    src,
    /grant execute on function logistics\.my_led_team_member_ids\(\)\s+to authenticated, service_role/,
  );
});

// ── 2. /api/mkt/worklist — gates + pagination + rules ────────────

test("/api/mkt/worklist gates on active profile, NOT admin", () => {
  const src = code("src/app/api/mkt/worklist/route.ts");
  // readMktSession returns kind:"ok" only when profile.status==='active'.
  assert.match(src, /readMktSession/);
  assert.match(src, /state\.kind\s*!==\s*"ok"/);
  // No requireAdmin anywhere — the worklist is for the team.
  assert.doesNotMatch(src, /requireAdmin/);
  assert.doesNotMatch(src, /role\s*!==\s*"admin"/);
});

test("/api/mkt/worklist paginates orders + customers + subs + outreach", () => {
  const src = code("src/app/api/mkt/worklist/route.ts");
  // The shared paginator + the four tables it is called on.
  assert.match(src, /paginateAll[\s\S]*?\.from\("orders"\)/);
  assert.match(src, /paginateAll[\s\S]*?\.from\("customers"\)/);
  assert.match(src, /paginateAll[\s\S]*?\.from\("subscriptions"\)/);
  assert.match(src, /paginateAll[\s\S]*?\.from\("outreach"\)/);
  // Page size is 1000 (the PostgREST truncation point), range covers it.
  assert.match(src, /PAGE\s*=\s*1000/);
  assert.match(src, /\.range\(\s*from\s*,\s*from\s*\+\s*size\s*-\s*1\s*\)/);
});

test("/api/mkt/worklist uses isCancelled, never reads cancelled_at", () => {
  const src = code("src/app/api/mkt/worklist/route.ts");
  assert.match(src, /isCancelled\(/);
  assert.doesNotMatch(src, /cancelled_at/);
});

test("/api/mkt/worklist accumulates money in PAISE, divides once", () => {
  const src = code("src/app/api/mkt/worklist/route.ts");
  assert.match(src, /total_spent_paise/);
  assert.match(src, /Math\.round\(\s*amt\s*\*\s*100\s*\)/);
  // Divides at render time. The expression may be guarded with a
  // nullish fallback, so match "total_spent_paise ... / 100".
  assert.match(src, /total_spent_paise[^;]*?\/\s*100/);
});

test("/api/mkt/worklist sorts never-contacted to the top, flags 14-day recent", () => {
  const src = code("src/app/api/mkt/worklist/route.ts");
  // Flag: any outreach timestamp inside the 14-day cutoff.
  assert.match(src, /RECENTLY_CONTACTED_WINDOW_DAYS\s*=\s*14/);
  assert.match(src, /recently_contacted:\s*history\.some/);
  // Sort: uncontacted (recently_contacted=false) come first.
  assert.match(src, /a\.recently_contacted\s*!==\s*b\.recently_contacted/);
});

test("/api/mkt/worklist reads outreach from the logistics schema client", () => {
  // The logistics table is only reachable via a client pinned to
  // db:{schema:'logistics'}. A refactor that collapses the two
  // service() helpers back into one would silently miss outreach.
  const src = code("src/app/api/mkt/worklist/route.ts");
  assert.match(src, /db:\s*\{\s*schema:\s*"logistics"\s*\}/);
});

// ── 3. /api/mkt/outreach — write gate + validation ───────────────

test("/api/mkt/outreach POST gates on active, pins created_by to auth.uid()", () => {
  const src = code("src/app/api/mkt/outreach/route.ts");
  assert.match(src, /readMktSession/);
  assert.match(src, /state\.kind\s*!==\s*"ok"/);
  // created_by comes from the server-side session, not the body.
  assert.match(src, /created_by:\s*state\.profile\.id/);
  // No requireAdmin.
  assert.doesNotMatch(src, /requireAdmin/);
});

test("/api/mkt/outreach POST validates channel + outcome against the enum lists", () => {
  const src = code("src/app/api/mkt/outreach/route.ts");
  for (const v of ["whatsapp", "call", "visit", "other"]) {
    assert.match(src, new RegExp(`"${v}"`), `channel ${v} not validated`);
  }
  for (const v of [
    "contacted",
    "no_answer",
    "not_interested",
    "ordered",
    "wrong_number",
    "callback",
  ]) {
    assert.match(src, new RegExp(`"${v}"`), `outcome ${v} not validated`);
  }
  // A plain uuid-ish shape check prevents an obvious empty string.
  assert.match(src, /UUID_RE/);
});

// ── 4. UI surface ────────────────────────────────────────────────

test("/mkt renders 'Work this list' button when a segment is selected and non-empty", () => {
  const src = code("src/app/mkt/page.tsx");
  // Conditional on segment !== 'all' AND visible.length > 0.
  assert.match(
    src,
    /segment\s*!==\s*"all"\s*&&\s*visible\.length\s*>\s*0/,
  );
  // Button links to /mkt/worklist?segment=X.
  assert.match(src, /\/mkt\/worklist\?segment=/);
});

test("/mkt/worklist page uses requireMktSession WITHOUT requireAdmin", () => {
  const src = read("src/app/mkt/worklist/page.tsx");
  assert.match(src, /requireMktSession/);
  assert.doesNotMatch(src, /requireAdmin/);
});

test("WorklistClient wires WhatsApp + Call + outcome buttons, warns on 14-day re-contact", () => {
  const src = read("src/app/mkt/worklist/WorklistClient.tsx");
  // WhatsApp link goes through whatsAppHref (prepends 91). A bare
  // https://wa.me/${phone} would ship a 10-digit number and silently
  // fail to resolve the right account.
  assert.match(src, /whatsAppHref\(customer\.phone\)/);
  assert.match(src, /telHref\(customer\.phone\)/);
  // Six outcome values rendered.
  for (const v of [
    "contacted",
    "no_answer",
    "not_interested",
    "ordered",
    "wrong_number",
    "callback",
  ]) {
    assert.match(src, new RegExp(`value: "${v}"`), `outcome ${v} not wired`);
  }
  // Warning ribbon on a recently_contacted card.
  assert.match(src, /Already contacted in the last 14 days/);
});

test("whatsAppHref always yields the 91-prefixed wa.me href for a 10-digit input", async () => {
  const mod = await import("../src/lib/admin-formatting.ts");
  assert.equal(mod.whatsAppHref("9876543210"), "https://wa.me/919876543210");
  assert.equal(mod.whatsAppHref("+91 98765 43210"), "https://wa.me/919876543210");
  // A customer with no phone falls back to an empty href — the UI
  // reads the empty string as "no link to render" rather than
  // crashing with an undefined-phone target.
  assert.equal(mod.whatsAppHref(null), "");
});
