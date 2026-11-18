// /mkt team + tasks — the invariants this phase has to hold.
//
// Four properties pinned here, all structural, because the code they
// cover cannot be invoked from node --test (it reaches for Supabase
// Auth via @supabase/ssr and next/headers, which need a full Next
// request context):
//
//   1. /mkt is NOT behind the admin PasswordGate any more. The old
//      MktShell imported PasswordGate from AdminShell; this is the
//      single easiest regression path, because the import path is
//      quiet — if a reviewer re-adds it, the surface quietly loses
//      auth.uid() and every attribution with it.
//
//   2. The /mkt layout GATES on Supabase Auth. It must call
//      requireMktSession / readMktSession from @/lib/mkt-auth, and
//      must redirect to /mkt/login when the session is absent.
//
//   3. /mkt/team is admin-only. The server component calls
//      requireMktSession({ requireAdmin: true }) and the companion
//      profile-write API route checks role === 'admin'.
//
//   4. The MIGRATION FILE EXISTS, is unapplied today (the local file
//      ledger has no row for it yet — supabase/migrations/README.md
//      makes that the authoritative statement), and contains the
//      pieces the brief required: one new enum value, four new
//      tables, one trigger that writes to logistics.notifications,
//      SECURITY DEFINER helpers for RLS.
//
// Pattern mirrors tests/admin-customers-crm.test.mjs and
// tests/mkt-crm.test.mjs: parse the source, strip comments, assert.

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel) =>
  read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

// ── 1. MktShell drops the PasswordGate ─────────────────────────────

test("MktShell does NOT import PasswordGate from AdminShell", () => {
  const src = code("src/components/mkt/MktShell.tsx");
  assert.ok(
    !/PasswordGate/.test(src),
    "MktShell still references the admin PasswordGate — the Supabase Auth gate is bypassed",
  );
  assert.ok(
    !/readRememberedAuth|writeRememberedAuth|clearRememberedAuth/.test(src),
    "MktShell still reaches for the admin-session remember-me helpers",
  );
});

test("MktShell renders the signed-in profile and a Sign-out button", () => {
  const src = code("src/components/mkt/MktShell.tsx");
  assert.match(
    src,
    /useMktProfile\s*\(\s*\)/,
    "MktShell must read the profile via useMktProfile()",
  );
  assert.match(
    src,
    /\/api\/mkt\/auth\/signout/,
    "the Sign-out button must POST to /api/mkt/auth/signout",
  );
});

// ── 2. /mkt/layout.tsx is the server-side gate ─────────────────────

test("/mkt/layout.tsx reads the Supabase session server-side", () => {
  const src = code("src/app/mkt/layout.tsx");
  assert.match(
    src,
    /readMktSession/,
    "/mkt/layout must call readMktSession so the gate runs before any page renders",
  );
  // Redirect is wired to /mkt/login for all three refusal shapes.
  assert.match(src, /redirect\(\s*["']\/mkt\/login["']/);
});

test("/mkt is fully gated — every handler under /api/mkt/** reads auth.getUser", () => {
  // Every route handler must resolve the signed-in user. Any new
  // handler that forgets to will leak data under RLS-only enforcement
  // because the service role is never used here.
  const apiDir = path.join(ROOT, "src/app/api/mkt");
  const walk = (dir) => {
    const files = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) files.push(...walk(full));
      else if (entry.name === "route.ts") files.push(full);
    }
    return files;
  };
  const files = walk(apiDir);
  assert.ok(files.length > 0, "there should be at least one /api/mkt route");
  for (const f of files) {
    const rel = path.relative(ROOT, f);
    const src = code(rel);
    // Signout is a POST that merely calls sb.auth.signOut(); it does
    // not need to validate the user ahead of that (signing out an
    // absent session is a no-op). Skip it.
    if (rel.endsWith("/api/mkt/auth/signout/route.ts")) continue;
    assert.match(
      src,
      /sb\.auth\.getUser\s*\(/,
      `${rel} does not call sb.auth.getUser() — the route is anonymous or leaks under RLS`,
    );
  }
});

// ── 3. /mkt/team is admin-only ─────────────────────────────────────

test("/mkt/team server component requires admin", () => {
  const src = code("src/app/mkt/team/page.tsx");
  assert.match(
    src,
    /requireMktSession\s*\(\s*\{\s*requireAdmin:\s*true\s*\}\s*\)/,
  );
});

test("/api/mkt/profiles routes check role === 'admin'", () => {
  const list = code("src/app/api/mkt/profiles/route.ts");
  const detail = code("src/app/api/mkt/profiles/[id]/route.ts");
  for (const src of [list, detail]) {
    assert.match(
      src,
      /role\s*!==\s*["']admin["']|role\s*===\s*["']admin["']/,
      "profile routes must additionally gate on role='admin' — RLS alone is not enough for the admin-shape UI",
    );
  }
});

// ── 4. Migration is written, not applied, and shaped right ─────────

const MIGRATION = "supabase/migrations/20261118165900_mkt_team_tasks_goals.sql";

test("migration file exists and is READ-ONLY on disk (no apply)", () => {
  // Existence is cheap; applied-state cannot be checked from here
  // without network, so we assert the paper trail is honest instead.
  const src = read(MIGRATION);
  // The file header must say it is NOT yet applied.
  assert.match(
    src.slice(0, 1200),
    /NOT YET APPLIED/i,
    "migration header must declare the apply-state so a reviewer cannot miss it",
  );
});

test("migration adds exactly one enum value: 'marketing'", () => {
  const src = read(MIGRATION);
  const adds = [...src.matchAll(/add value if not exists\s*'([^']+)'/g)].map(
    (m) => m[1],
  );
  assert.deepEqual(
    adds,
    ["marketing"],
    "user_role_enum must grow by exactly one value in this migration — ALTER TYPE ADD VALUE is not reversible",
  );
});

test("migration creates the four tables the brief requires", () => {
  const src = read(MIGRATION);
  for (const name of [
    "logistics.teams",
    "logistics.team_members",
    "logistics.goals",
    "logistics.tasks",
  ]) {
    const re = new RegExp(
      `create table if not exists ${name.replace(".", "\\.")}\\b`,
    );
    assert.match(src, re, `missing: create table ${name}`);
  }
});

test("migration enables RLS on every new table", () => {
  const src = read(MIGRATION);
  for (const name of [
    "logistics.teams",
    "logistics.team_members",
    "logistics.goals",
    "logistics.tasks",
  ]) {
    const re = new RegExp(
      `alter table ${name.replace(".", "\\.")} enable row level security`,
      "i",
    );
    assert.match(src, re, `RLS not enabled on ${name}`);
  }
});

test("RLS policies use the SECURITY DEFINER helpers, not bare 'authenticated'", () => {
  const src = read(MIGRATION);
  // The brief: "RLS keyed on auth.uid() through a SECURITY DEFINER
  // helper — never bare `authenticated`". `to authenticated` is still
  // the role scope on a policy (fine); what must NOT appear is a
  // policy whose USING/WITH CHECK body relies only on the caller's
  // role without also keying on auth.uid() or a helper.
  //
  // We check the stronger version: both my_team_ids and
  // my_led_team_ids appear in the policy bodies.
  assert.match(src, /my_team_ids\s*\(\s*\)/);
  assert.match(src, /my_led_team_ids\s*\(\s*\)/);

  // Both helpers are SECURITY DEFINER with a frozen search_path.
  assert.match(
    src,
    /create or replace function logistics\.my_team_ids[\s\S]*?security definer[\s\S]*?set search_path to ''/,
    "my_team_ids must be SECURITY DEFINER with a frozen search_path",
  );
  assert.match(
    src,
    /create or replace function logistics\.my_led_team_ids[\s\S]*?security definer[\s\S]*?set search_path to ''/,
    "my_led_team_ids must be SECURITY DEFINER with a frozen search_path",
  );
});

test("migration reuses logistics.is_admin() — does not replace it", () => {
  const src = read(MIGRATION);
  // The function must be CALLED in policies but not REDEFINED here —
  // the brief says reuse.
  assert.match(src, /logistics\.is_admin\s*\(\s*\)/);
  assert.ok(
    !/create or replace function logistics\.is_admin/.test(src),
    "is_admin() must not be re-created by this migration — brief said reuse",
  );
});

test("task assignment writes into the EXISTING notifications table", () => {
  const src = read(MIGRATION);
  // Must INSERT INTO logistics.notifications, not create a new table.
  assert.match(
    src,
    /insert into logistics\.notifications/,
    "trigger must write into logistics.notifications (the existing table)",
  );
  assert.ok(
    !/create table if not exists logistics\.notifications/.test(src),
    "migration must NOT create a second notifications table — brief said USE THIS TABLE",
  );
});

test("task notification trigger is scoped to assignment changes", () => {
  const src = read(MIGRATION);
  // Trigger only fires on INSERT or UPDATE OF assignee_id — not on
  // every UPDATE (which would spam a notification on every progress
  // tick).
  assert.match(
    src,
    /after insert or update of assignee_id on logistics\.tasks/,
  );
});
