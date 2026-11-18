// /mkt/campaigns — the migration shape + the API routes auth posture +
// the upload path's egress guard.

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

const MIGRATION = "supabase/migrations/20261118193300_mkt_campaigns.sql";

test("migration file carries NOT YET APPLIED banner", () => {
  const src = read(MIGRATION);
  assert.match(src.slice(0, 1500), /NOT YET APPLIED/i);
});

test("migration creates both tables and enables RLS", () => {
  const src = read(MIGRATION);
  assert.match(src, /create table if not exists logistics\.campaigns/);
  assert.match(src, /create table if not exists logistics\.campaign_assets/);
  assert.match(src, /alter table logistics\.campaigns enable row level security/);
  assert.match(src, /alter table logistics\.campaign_assets enable row level security/);
});

test("RLS helpers are SECURITY DEFINER with frozen search_path", () => {
  const src = read(MIGRATION);
  for (const fn of ["my_campaign_ids", "my_led_campaign_ids"]) {
    const re = new RegExp(
      `create or replace function logistics\\.${fn}\\(\\)[\\s\\S]*?security definer[\\s\\S]*?set search_path to ''`,
    );
    assert.match(src, re, `${fn} must be SECURITY DEFINER with a frozen search_path`);
  }
});

test("migration creates a PRIVATE storage bucket campaign-assets", () => {
  const src = read(MIGRATION);
  // public=false in the insert.
  assert.match(
    src,
    /insert into storage\.buckets[\s\S]*?'campaign-assets'[\s\S]*?false/,
  );
  // allowed_mime_types: images + pdf, NOT video.
  assert.match(src, /'application\/pdf'/);
  assert.ok(!/'video\/mp4'/.test(src), "campaign-assets must not allow video");
});

test("storage.objects policies for bucket scope the inserts to campaign-assets", () => {
  const src = read(MIGRATION);
  assert.match(src, /bucket_id = 'campaign-assets'/);
  // SELECT policy is INTENTIONALLY OMITTED — private bucket, reads
  // happen via signed URL only. Pin that we did NOT add a SELECT to
  // `authenticated` for this bucket.
  const selectForBucket = src.match(
    /create policy[^\n]+on storage\.objects for select to authenticated[\s\S]+?bucket_id = 'campaign-assets'/,
  );
  assert.ok(
    !selectForBucket,
    "campaign-assets must NOT have an authenticated SELECT policy — reads go through signed URLs",
  );
});

test("all /api/mkt/campaigns routes read auth.getUser before any query", () => {
  const files = [
    "src/app/api/mkt/campaigns/route.ts",
    "src/app/api/mkt/campaigns/[id]/route.ts",
    "src/app/api/mkt/campaigns/[id]/clone/route.ts",
    "src/app/api/mkt/campaigns/[id]/assets/route.ts",
    "src/app/api/mkt/uploads/signed-url/route.ts",
  ];
  for (const f of files) {
    const src = code(f);
    assert.match(src, /sb\.auth\.getUser\s*\(/, `${f} must check auth`);
  }
});

test("mkt-upload reuses maybeResizeImageForUpload from admin-upload", () => {
  const src = code("src/lib/mkt-upload.ts");
  assert.match(src, /maybeResizeImageForUpload/);
  assert.match(src, /from\s+["']@\/lib\/admin-upload["']/);
});

test("campaign asset upload is wired to mktUploadViaSignedUrl", () => {
  const src = code("src/app/mkt/campaigns/[id]/CampaignDetailClient.tsx");
  assert.match(src, /mktUploadViaSignedUrl/);
  assert.match(src, /bucket:\s*["']campaign-assets["']/);
});

test("uploads route restricts bucket + mimes server-side", () => {
  const src = code("src/app/api/mkt/uploads/signed-url/route.ts");
  assert.match(src, /ALLOWED_BUCKETS[\s\S]*?campaign-assets/);
  // video mimes must NOT appear in the allowed set.
  assert.ok(!/video\/mp4/.test(src));
});
