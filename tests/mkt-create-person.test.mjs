// /mkt/team — person-creation path, deactivate contract, and the
// products.image_url rewrite migration.

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

const PROFILES_ROUTE = "src/app/api/mkt/profiles/route.ts";

// ── Create-person route ───────────────────────────────────────────

test("POST /api/mkt/profiles exists and is the new create path", () => {
  const src = code(PROFILES_ROUTE);
  assert.match(src, /export async function POST\(/);
});

test("POST requires admin — role === 'admin' AND status === 'active'", () => {
  const src = code(PROFILES_ROUTE);
  // The requireAdminServer helper gates POST.
  assert.match(src, /requireAdminServer\s*\(\s*sb\s*\)/);
  assert.match(src, /me\.role !== ["']admin["']/);
  assert.match(src, /me\.status !== ["']active["']/);
});

test("POST refuses on duplicate email OR phone — one query, two guards", () => {
  const src = code(PROFILES_ROUTE);
  // One query that matches either side with an .or() builder call.
  assert.match(
    src,
    /\.or\(\s*`email\.eq\.\$\{emailRaw\},phone\.eq\.\$\{phone\}`\s*\)/,
  );
  // 409 response on hit.
  assert.match(src, /status:\s*409/);
  assert.match(src, /code:\s*["']duplicate_profile["']/);
});

test("POST uses the service-role admin API to create the auth user", () => {
  const src = code(PROFILES_ROUTE);
  assert.match(src, /svc\.auth\.admin\.createUser/);
  // email_confirm=true because the admin is handing over the password
  // out-of-band — don't require an email round-trip that depends on
  // SMTP config.
  assert.match(src, /email_confirm:\s*true/);
});

test("POST rolls back the auth user when the profile insert fails", () => {
  const src = code(PROFILES_ROUTE);
  // The rollback deletes the just-created auth user. Without this, a
  // partial failure leaves an orphan auth row and a retry 422s on
  // "user already exists".
  assert.match(
    src,
    /profileErr[\s\S]+?svc\.auth\.admin\.deleteUser\(\s*created\.user\.id\s*\)/,
  );
});

test("POST returns a one-time password but NEVER logs it", () => {
  const src = code(PROFILES_ROUTE);
  assert.match(src, /one_time_password:\s*password/);
  // Pin that the generated password never appears in a console call.
  // The substring `console.` must not sit on the same line as the
  // variable `password`.
  const lines = src.split("\n");
  for (const line of lines) {
    if (line.includes("console.") && /\bpassword\b/.test(line)) {
      assert.fail(`password reaches the console at: ${line.trim()}`);
    }
  }
});

test("password generator uses crypto.randomBytes, not Math.random", () => {
  const src = code(PROFILES_ROUTE);
  assert.match(src, /randomBytes\(/);
  assert.ok(
    !/Math\.random\s*\(/.test(src),
    "Math.random must not generate the one-time password",
  );
});

// ── TeamClient — Add-person UI + no hard delete ───────────────────

test("TeamClient renders AddPersonCard above the People table", () => {
  const src = code("src/app/mkt/team/TeamClient.tsx");
  assert.match(src, /<AddPersonCard\s/);
  assert.match(src, /function AddPersonCard/);
});

test("TeamClient has NO hard-delete UI — status is the only way out", () => {
  const src = code("src/app/mkt/team/TeamClient.tsx");
  // No DELETE method on the client → no hard delete of profiles.
  assert.ok(
    !/method\s*:\s*["']DELETE["'][\s\S]{0,400}?profiles/.test(src),
    "TeamClient issued a DELETE for a profile — status should be the only soft-delete path",
  );
});

test("/api/mkt/profiles/[id] exposes NO DELETE handler", () => {
  const src = code("src/app/api/mkt/profiles/[id]/route.ts");
  assert.ok(
    !/export async function DELETE/.test(src),
    "the profile route must not expose a hard-delete handler",
  );
});

// ── products.image_url migration ──────────────────────────────────

const MIGRATION = "supabase/migrations/20261119125400_products_image_url_rewrite.sql";

test("migration file is present and carries the NOT YET APPLIED banner", () => {
  const src = read(MIGRATION);
  assert.match(src.slice(0, 2500), /NOT YET APPLIED/i);
});

test("migration backs up before writing", () => {
  const src = read(MIGRATION);
  const backupAt = src.indexOf(
    "create table if not exists public.zz_products_image_url_20261119",
  );
  const updateAt = src.indexOf("update public.products");
  assert.notEqual(backupAt, -1, "backup table statement is missing");
  assert.notEqual(updateAt, -1, "UPDATE is missing");
  assert.ok(backupAt < updateAt, "backup must come BEFORE the UPDATE");
});

test("migration UPDATE is guarded on the prior shape — re-running is a no-op", () => {
  const src = read(MIGRATION);
  // Two WHERE conjuncts: the target (/object/public/) AND the
  // idempotence guard (no existing query string).
  assert.match(src, /where image_url like '%\/storage\/v1\/object\/public\/%'/);
  assert.match(src, /and image_url not like '%\?%'/);
});

test("migration RLS-locks the backup — same posture as other zz_* tables", () => {
  const src = read(MIGRATION);
  assert.match(
    src,
    /alter table public\.zz_products_image_url_20261119 enable row level security/,
  );
  // Absence check: no policy is added to the backup. anon/authenticated
  // cannot read; service role bypasses RLS.
  assert.ok(
    !/create policy[^\n]+on public\.zz_products_image_url_20261119/.test(src),
    "the backup must have RLS enabled with NO policies",
  );
});

test("migration appends ?width=1600&quality=80 verbatim", () => {
  const src = read(MIGRATION);
  assert.match(src, /\?width=1600&quality=80/);
});
