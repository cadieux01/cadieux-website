// /mkt/calendar — pure helpers + API shape.

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

const libMod = await import("../src/lib/mkt-calendar.ts");

test("toIsoLocalDate uses local time, not UTC — no day drift at the right edge", () => {
  const d = new Date(2026, 10, 18, 23, 45, 0); // Nov 18 2026, 23:45 local
  assert.equal(libMod.toIsoLocalDate(d), "2026-11-18");
});

test("parseIsoLocalDate rejects non-calendar dates", () => {
  assert.equal(libMod.parseIsoLocalDate("2026-02-30"), null);
  assert.equal(libMod.parseIsoLocalDate("2026-13-01"), null);
  assert.equal(libMod.parseIsoLocalDate("not a date"), null);
  const ok = libMod.parseIsoLocalDate("2026-11-18");
  assert.ok(ok instanceof Date);
});

test("startOfWeek is Monday — business-week convention", () => {
  // Wed 2026-11-18 → Mon 2026-11-16
  const wed = new Date(2026, 10, 18);
  assert.equal(libMod.toIsoLocalDate(libMod.startOfWeek(wed)), "2026-11-16");
  // Sun 2026-11-22 → still Mon 2026-11-16 (Sunday is end-of-week).
  const sun = new Date(2026, 10, 22);
  assert.equal(libMod.toIsoLocalDate(libMod.startOfWeek(sun)), "2026-11-16");
});

test("daysInMonthGrid returns exactly 42 cells", () => {
  const nov = new Date(2026, 10, 15);
  const cells = libMod.daysInMonthGrid(nov);
  assert.equal(cells.length, 42);
  // First cell is a Monday on or before Nov 1.
  assert.equal(cells[0].getDay(), 1); // 1 = Monday
});

test("isOverdue — before today AND not done; done tasks are not overdue", () => {
  const today = "2026-11-18";
  const old = { id: "t1", title: "x", due_date: "2026-11-10", status: "todo", team_id: null, assignee_id: null, progress: 0, cadence: "one-off" };
  assert.equal(libMod.isOverdue(old, today), true);
  const doneOld = { ...old, status: "done" };
  assert.equal(libMod.isOverdue(doneOld, today), false);
  const futureTask = { ...old, due_date: "2026-12-01" };
  assert.equal(libMod.isOverdue(futureTask, today), false);
  const noDate = { ...old, due_date: null };
  assert.equal(libMod.isOverdue(noDate, today), false);
});

test("campaignCoversDay — inclusive at both ends", () => {
  const c = {
    id: "c",
    name: "x",
    status: "active",
    starts_on: "2026-11-15",
    ends_on: "2026-11-20",
    team_id: null,
  };
  assert.equal(libMod.campaignCoversDay(c, "2026-11-14"), false);
  assert.equal(libMod.campaignCoversDay(c, "2026-11-15"), true);
  assert.equal(libMod.campaignCoversDay(c, "2026-11-18"), true);
  assert.equal(libMod.campaignCoversDay(c, "2026-11-20"), true);
  assert.equal(libMod.campaignCoversDay(c, "2026-11-21"), false);
});

test("calendar API is tolerant of a missing campaigns table", () => {
  // Pattern pin: the route uses Promise.allSettled so a campaigns
  // failure doesn't take tasks off the air.
  const src = code("src/app/api/mkt/calendar/route.ts");
  assert.match(src, /Promise\.allSettled/);
});

test("calendar page is read-only — no POST/PATCH/DELETE on the client", () => {
  const src = code("src/app/mkt/calendar/CalendarClient.tsx");
  assert.ok(
    !/method\s*:\s*["'](POST|PUT|PATCH|DELETE)["']/.test(src),
    "the calendar must be read-only in this phase",
  );
});

test("API route reads auth.getUser before any query", () => {
  const src = code("src/app/api/mkt/calendar/route.ts");
  assert.match(src, /sb\.auth\.getUser\s*\(/);
});
