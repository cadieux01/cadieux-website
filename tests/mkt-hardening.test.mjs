// Hardening pass — invariants pinned so a future change cannot
// silently regress the four fixes this branch landed:
//
//   1. /api/admin/customers paginates with .range() in 1000-row pages
//      (PostgREST truncates no-limit SELECTs at 1000).
//   2. Every /mkt client fetches /api/mkt/* through mkt-fetch, which
//      bounds every request with an AbortSignal.timeout() — no
//      forever-spinner on a dead connection.
//   3. Inline task edits roll back when the PATCH fails.
//   4. Login + scoped-CSS inputs are ≥ 16px to prevent iOS zoom-on-
//      focus.
//
// Mobile DOM assertions (horizontal scroll, tap-target sizes) live in
// scripts/playwright-audit.mjs — not run as a unit test because they
// require a browser. The hardening pass's screenshots are committed
// under tmp/phone-audit/ for review.

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

// ── 1. /api/admin/customers paginates ───────────────────────────────

test("/api/admin/customers uses .range() pagination in 1000-row pages", () => {
  const src = code("src/app/api/admin/customers/route.ts");
  // The old single SELECT no-limit shape must be gone.
  assert.ok(
    !/let\s+custQ\s*=\s*supabaseAdmin[\s\S]*?const\s*\{\s*data:\s*customers,\s*error\s*\}\s*=\s*await\s+custQ/.test(src),
    "old no-pagination code path still present",
  );
  // The new paginator carries a PAGE_SIZE and a .range() call.
  assert.match(src, /PAGE_SIZE\s*=\s*1000/);
  assert.match(src, /\.range\(pageFrom,\s*pageFrom\s*\+\s*PAGE_SIZE\s*-\s*1\)/);
  // And stops only when a short page confirms completion.
  assert.match(src, /if\s*\(\s*rows\.length\s*<\s*PAGE_SIZE\s*\)\s*break/);
});

// ── 2. Every /mkt client uses mkt-fetch ─────────────────────────────

test("no raw fetch(\"/api/mkt/\") under src/app/mkt or src/components/mkt", () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(tsx?|mjs|js)$/.test(entry.name)) {
        const rel = path.relative(ROOT, full);
        // The lib itself legitimately names the helper functions.
        if (rel === "src/lib/mkt-fetch.ts") continue;
        const src = code(rel);
        if (/\bfetch\(\s*["'`]\/api\/mkt\//.test(src)) {
          offenders.push(rel);
        }
      }
    }
  };
  walk(path.join(ROOT, "src", "app", "mkt"));
  walk(path.join(ROOT, "src", "components", "mkt"));
  assert.deepEqual(
    offenders,
    [],
    `raw /api/mkt/ fetches without timeout: ${offenders.join(", ")}`,
  );
});

test("mkt-fetch wraps requests in AbortSignal + readable timeout error", () => {
  const src = code("src/lib/mkt-fetch.ts");
  assert.match(src, /AbortController/);
  assert.match(src, /setTimeout\(\s*\(\)\s*=>\s*controller\.abort/);
  assert.match(src, /Request timed out after/);
});

test("adminFetch also carries a request timeout now", () => {
  const src = code("src/lib/admin-client.ts");
  assert.match(src, /timeoutMs/);
  assert.match(src, /AbortController/);
});

// ── 3. Inline task edits roll back on failure ──────────────────────

test("TasksClient.patchTask snapshots + rolls back the task list on failure", () => {
  const src = code("src/app/mkt/tasks/TasksClient.tsx");
  // The optimistic update: set the new state before awaiting.
  // Then the rollback: catch → setTasks(previous).
  assert.match(src, /const\s+previous\s*=\s*tasks/);
  const patchFn = src.slice(
    src.indexOf("const patchTask"),
    src.indexOf("const [newTitle"),
  );
  assert.match(patchFn, /setTasks\(previous\)/, "rollback must restore the snapshot");
});

// ── 4. iOS zoom-on-focus prevention ─────────────────────────────────

test("MktShell's scoped CSS pins input font-size to >= 1rem", () => {
  const src = read("src/components/mkt/MktShell.tsx");
  // The scoped CSS rule for inputs.
  const inputRule = src.match(
    /\.mkt-scope input,[^{]*\{[\s\S]*?font-size:\s*1rem/,
  );
  assert.ok(inputRule, "mkt-scope input CSS must set font-size: 1rem (iOS zoom guard)");
  // min-height 44 for tap target.
  assert.match(src, /min-height:\s*44px/);
});

test("mkt login inputs are 1rem / min-height 44px (no iOS zoom)", () => {
  const src = read("src/app/(mkt-public)/mkt/login/page.tsx");
  // inputStyle definition.
  assert.match(src, /fontSize:\s*"1rem"/);
  assert.match(src, /minHeight:\s*44/);
});

// ── 5. Double-click guards on every mkt Create button ──────────────

test("Create/submit paths have double-click guards (busy||!valid)", () => {
  // Each client file must EITHER use a busy flag on its create
  // button OR ride on a parent `busy` already guarded elsewhere. We
  // check that every client that has a `const createX = async()`
  // function has a busy check at the top. A regression would be
  // `const createX = async () => { if (!x) return; ...` without the
  // busy conjunct.
  const checks = [
    { file: "src/app/mkt/tasks/TasksClient.tsx", fn: "createTask", busy: "creatingTask" },
    { file: "src/app/mkt/tasks/TasksClient.tsx", fn: "createGoal", busy: "creatingGoal" },
    { file: "src/app/mkt/team/TeamClient.tsx", fn: "createTeam", busy: "busy" },
    { file: "src/app/mkt/campaigns/CampaignsClient.tsx", fn: "createCampaign", busy: "busy" },
    { file: "src/app/mkt/campaigns/CampaignsClient.tsx", fn: "runAgain", busy: "busy" },
  ];
  for (const { file, fn, busy } of checks) {
    const src = code(file);
    const idx = src.indexOf(`const ${fn} = async`);
    assert.ok(idx >= 0, `${file} has no ${fn}`);
    const body = src.slice(idx, idx + 300);
    // First return-early must reference the busy flag.
    const re = new RegExp(`if\\s*\\(\\s*${busy}\\b`);
    assert.match(
      body,
      re,
      `${file} ${fn} is missing a '${busy}' double-click guard`,
    );
  }
});
