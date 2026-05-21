// One-time backfill: populate latitude/longitude for service_areas rows
// that were inserted before geocoding existed. Without coords, the
// proximity auto-approve check (see lib/service-areas + lib/geocode)
// silently skips those rows, so the 52 legacy pincodes (530001-530052,
// mostly area_name "General") never trigger proximity.
//
// Behavior:
//   * isAdmin-gated POST.
//   * Selects every row where latitude IS NULL OR longitude IS NULL —
//     rows that already have coords are skipped so re-running is safe.
//   * For each row: try geocodeArea(area_name, pincode). If that returns
//     null, fall back to geocodeArea("", pincode) — the helper drops
//     empty parts so the request becomes "<pincode>, Visakhapatnam,
//     India" which resolves the postcode centroid. This rescues generic
//     "General" rows whose area_name carries no geographic signal.
//   * 150ms pause between Google calls to stay under the default
//     Geocoding API QPS limit.
//   * Returns { processed, geocoded, failed, failed_rows } so the
//     operator can see exactly which (pincode, area_name) pairs didn't
//     resolve.

import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";
import { recordAuditEvent } from "@/lib/audit-log";
import { geocodeArea } from "@/lib/geocode";
import { SERVICE_AREAS_TAG } from "@/lib/service-areas";

const DELAY_MS = 150;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data: pending, error: selErr } = await supabaseAdmin
    .from("service_areas")
    .select("pincode, area_name, latitude, longitude")
    .or("latitude.is.null,longitude.is.null")
    .order("pincode", { ascending: true });

  if (selErr) {
    console.error("[backfill-geocodes] select failed:", selErr.message);
    return NextResponse.json({ error: selErr.message }, { status: 500 });
  }

  const rows = pending ?? [];
  const failed_rows: { pincode: string; area_name: string }[] = [];
  let geocoded = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Try area-specific first; fall back to pincode-only for generic
    // names like "General" that don't carry geo signal on their own.
    let geo = await geocodeArea(row.area_name, row.pincode);
    if (!geo) {
      await sleep(DELAY_MS);
      geo = await geocodeArea("", row.pincode);
    }

    if (geo) {
      const { error: updErr } = await supabaseAdmin
        .from("service_areas")
        .update({
          latitude: geo.latitude,
          longitude: geo.longitude,
          geocoded_at: new Date().toISOString(),
        })
        .eq("pincode", row.pincode)
        .eq("area_name", row.area_name);
      if (updErr) {
        console.warn(
          `[backfill-geocodes] update failed for ${row.pincode}/${row.area_name}:`,
          updErr.message,
        );
        failed_rows.push({ pincode: row.pincode, area_name: row.area_name });
      } else {
        geocoded++;
      }
    } else {
      console.warn(
        `[backfill-geocodes] no geocode for ${row.pincode}/${row.area_name}`,
      );
      failed_rows.push({ pincode: row.pincode, area_name: row.area_name });
    }

    if (i < rows.length - 1) {
      await sleep(DELAY_MS);
    }
  }

  if (geocoded > 0) {
    revalidateTag(SERVICE_AREAS_TAG);
  }

  const summary = {
    processed: rows.length,
    geocoded,
    failed: failed_rows.length,
    failed_rows,
  };

  void recordAuditEvent({
    req,
    entity: "service_area",
    action: "update",
    targetId: "backfill",
    targetLabel: "Backfill geocodes",
    context: `Backfilled coords for ${geocoded}/${rows.length} legacy rows`,
    meta: summary,
  });

  return NextResponse.json(summary);
}
