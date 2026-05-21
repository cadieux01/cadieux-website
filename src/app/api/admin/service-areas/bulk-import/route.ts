// Bulk-import service_areas from a flat list of {pincode, area_name?}
// entries pasted by an admin. Mirrors the single-pincode POST in
// ../route.ts but optimized for batch operations:
//
//   * Skips entries whose (pincode, area_name) pair already exists so
//     re-running the same paste is safe.
//   * Defaults missing area_name to "Vizag" — keeps coverage tied to
//     the city centroid when the operator doesn't have a finer label.
//   * Geocodes each new row with a 150ms throttle (Google Geocoding
//     QPS ceiling). Falls back to pincode-only geocoding for generic
//     names so "Vizag" rows still resolve.
//   * Treats invalid lines (bad pincode, etc.) as the caller's
//     responsibility — they're filtered upstream by the modal, but we
//     re-validate here in case the API is hit directly.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { geocodeArea } from "@/lib/geocode";
import { SERVICE_AREAS_TAG, normalizePincode } from "@/lib/service-areas";

const DELAY_MS = 150;
const DEFAULT_AREA = "Vizag";
const MAX_ENTRIES = 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type IncomingEntry = { pincode?: unknown; area_name?: unknown };

type ParsedEntry = { pincode: string; area_name: string };

function parseEntries(raw: unknown): {
  valid: ParsedEntry[];
  invalid: number;
} {
  if (!Array.isArray(raw)) return { valid: [], invalid: 0 };
  let invalid = 0;
  const seen = new Set<string>();
  const valid: ParsedEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") {
      invalid++;
      continue;
    }
    const entry = item as IncomingEntry;
    const pincode = normalizePincode(entry.pincode);
    if (!pincode) {
      invalid++;
      continue;
    }
    const rawArea = String(entry.area_name ?? "").trim();
    const area_name = (rawArea || DEFAULT_AREA).slice(0, 80);
    const key = `${pincode}|${area_name.toLowerCase()}`;
    // de-dupe within the same paste to avoid spamming the upsert
    if (seen.has(key)) continue;
    seen.add(key);
    valid.push({ pincode, area_name });
  }
  return { valid, invalid };
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { entries?: unknown };
  const rawEntries = Array.isArray(body.entries) ? body.entries : [];
  if (rawEntries.length > MAX_ENTRIES) {
    return NextResponse.json(
      { error: `Too many entries (${rawEntries.length}). Max ${MAX_ENTRIES} per batch.` },
      { status: 400 },
    );
  }

  const { valid, invalid } = parseEntries(rawEntries);

  if (valid.length === 0) {
    return NextResponse.json({
      added: 0,
      geocoded: 0,
      geocode_failed: 0,
      skipped_existing: 0,
      invalid,
    });
  }

  // Pull every existing (pincode, area_name) pair touched by this batch
  // so we can skip duplicates without firing a doomed upsert per row.
  const pincodes = Array.from(new Set(valid.map((v) => v.pincode)));
  const { data: existing, error: selErr } = await supabaseAdmin
    .from("service_areas")
    .select("pincode, area_name")
    .in("pincode", pincodes);

  if (selErr) {
    console.error("[bulk-import] dedupe select failed:", selErr.message);
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  const existingKeys = new Set(
    (existing ?? []).map(
      (r) => `${r.pincode}|${String(r.area_name).toLowerCase()}`,
    ),
  );

  const toInsert: ParsedEntry[] = [];
  let skipped_existing = 0;
  for (const entry of valid) {
    const key = `${entry.pincode}|${entry.area_name.toLowerCase()}`;
    if (existingKeys.has(key)) {
      skipped_existing++;
      continue;
    }
    toInsert.push(entry);
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      added: 0,
      geocoded: 0,
      geocode_failed: 0,
      skipped_existing,
      invalid,
    });
  }

  // Geocode each new row with a throttle. Failures are non-fatal —
  // the row still gets inserted, just without coords, mirroring the
  // single-pincode POST. The backfill route can clean those up later.
  const geocodedAt = new Date().toISOString();
  const rows: {
    pincode: string;
    area_name: string;
    is_active: boolean;
    added_by: string;
    latitude: number | null;
    longitude: number | null;
    geocoded_at: string | null;
  }[] = [];

  let geocoded = 0;
  for (let i = 0; i < toInsert.length; i++) {
    const entry = toInsert[i];
    let geo = await geocodeArea(entry.area_name, entry.pincode);
    if (!geo) {
      await sleep(DELAY_MS);
      // Pincode-only fallback for generic labels (e.g. default "Vizag").
      geo = await geocodeArea("", entry.pincode);
    }
    rows.push({
      pincode: entry.pincode,
      area_name: entry.area_name,
      is_active: true,
      added_by: "admin",
      latitude: geo?.latitude ?? null,
      longitude: geo?.longitude ?? null,
      geocoded_at: geo ? geocodedAt : null,
    });
    if (geo) geocoded++;
    if (i < toInsert.length - 1) await sleep(DELAY_MS);
  }

  // Composite-PK upsert keeps the call idempotent if a row sneaks in
  // between the dedupe SELECT and now (unlikely but cheap to guard).
  const { error: upsertErr } = await supabaseAdmin
    .from("service_areas")
    .upsert(rows, { onConflict: "pincode,area_name" });

  if (upsertErr) {
    console.error("[bulk-import] upsert failed:", upsertErr.message);
    return NextResponse.json({ error: upsertErr.message }, { status: 500 });
  }

  revalidateTag(SERVICE_AREAS_TAG);

  const summary = {
    added: rows.length,
    geocoded,
    geocode_failed: rows.length - geocoded,
    skipped_existing,
    invalid,
  };

  void recordAuditEvent({
    req,
    entity: "service_area",
    action: "create",
    targetId: "bulk-import",
    targetLabel: `Bulk import (${summary.added} areas)`,
    context: `Bulk imported ${summary.added} areas (${geocoded} geocoded, ${summary.geocode_failed} pending coords, ${skipped_existing} already existed)`,
    meta: summary,
  });

  return NextResponse.json(summary);
}
