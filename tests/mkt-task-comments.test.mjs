import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel) =>
  read(rel).replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");

const MIGRATION = "supabase/migrations/20261118194700_task_comments.sql";

test("migration file carries NOT YET APPLIED banner", () => {
  assert.match(read(MIGRATION).slice(0, 1500), /NOT YET APPLIED/i);
});

test("migration creates logistics.task_comments and enables RLS", () => {
  const src = read(MIGRATION);
  assert.match(src, /create table if not exists logistics\.task_comments/);
  assert.match(src, /alter table logistics\.task_comments enable row level security/);
});

test("RLS visibility piggybacks on tasks — the subquery is 'select id from logistics.tasks'", () => {
  const src = read(MIGRATION);
  // SELECT policy uses tasks visibility.
  assert.match(
    src,
    /create policy task_comments_select[\s\S]+?task_id in \(select id from logistics\.tasks\)/,
    "comments SELECT must filter on tasks visible to the caller",
  );
  // INSERT policy requires author = caller AND task visible.
  assert.match(
    src,
    /create policy task_comments_insert[\s\S]+?author_id = auth\.uid\(\)[\s\S]+?task_id\s+in \(select id from logistics\.tasks\)/,
  );
});

test("comments are append-only — no UPDATE policy", () => {
  const src = read(MIGRATION);
  assert.ok(
    !/create policy[^\n]+on logistics\.task_comments for update/.test(src),
    "task_comments must not have an UPDATE policy",
  );
});

test("DELETE is author OR admin — not team-leader", () => {
  const src = read(MIGRATION);
  assert.match(
    src,
    /task_comments[\s\S]+?for delete[\s\S]+?logistics\.is_admin\(\)[\s\S]+?author_id = auth\.uid\(\)/,
  );
  // Team-leader must NOT be able to delete someone else's comment.
  const delBlock = src.match(/for delete to authenticated[\s\S]+?using[\s\S]+?;/);
  assert.ok(delBlock, "could not isolate delete policy");
  assert.ok(
    !/my_led_team_ids/.test(delBlock[0]),
    "team leaders must not be able to delete other authors' comments",
  );
});

test("API route reads auth.getUser before any query", () => {
  const src = code("src/app/api/mkt/tasks/[id]/comments/route.ts");
  assert.match(src, /sb\.auth\.getUser\s*\(/);
});

test("API route orders newest-LAST (chat convention)", () => {
  const src = code("src/app/api/mkt/tasks/[id]/comments/route.ts");
  assert.match(src, /\.order\(\s*["']created_at["']\s*,\s*\{\s*ascending:\s*true\s*\}/);
});
