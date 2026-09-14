import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// POST /api/admin/areas/resolve
//
// Body: { query: string }
// Response: { area_name, pincode, latitude, longitude, matched_via } or 404.
//
// Powers the "nearest from area" sort on /admin/orders. Sunny types an
// area or a pincode and this returns the best geocoded match from
// public.service_areas so the client can sort orders by distance from
// that point. This never writes and never leaves service_areas.
//
// Match ranking (best → worst):
//   1. exact area_name (case-insensitive)
//   2. exact pincode (when the query is 6 digits)
//   3. area_name starts with the query
//   4. area_name contains the query
// Only rows with non-null latitude/longitude are considered — un-geocoded
// service_areas rows (currently 1 of 128) can't anchor a distance sort.

type AreaRow = {
  area_name: string | null;
  pincode: string | null;
  latitude: number | null;
  longitude: number | null;
};

export async function POST(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as { query?: unknown };
  const q = typeof body.query === "string" ? body.query.trim() : "";
  if (!q) {
    return NextResponse.json({ error: "Empty query" }, { status: 400 });
  }

  const isPincode = /^\d{6}$/.test(q);
  const qLower = q.toLowerCase();

  const { data, error } = await supabaseAdmin
    .from("service_areas")
    .select("area_name, pincode, latitude, longitude")
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (error) {
    console.error("[areas/resolve] fetch failed:", error.message);
    return NextResponse.json({ error: "Lookup failed" }, { status: 500 });
  }

  const rows = ((data ?? []) as AreaRow[]).filter(
    (r): r is AreaRow & { latitude: number; longitude: number } =>
      typeof r.latitude === "number" && typeof r.longitude === "number",
  );

  // Rank the candidates. Stops at the first non-empty bucket so an
  // exact area_name always wins over a pincode substring.
  let best: (AreaRow & { latitude: number; longitude: number }) | null = null;
  let matched_via: "exact" | "pincode" | "prefix" | "contains" | null = null;

  for (const r of rows) {
    if ((r.area_name ?? "").toLowerCase() === qLower) {
      best = r;
      matched_via = "exact";
      break;
    }
  }
  if (!best && isPincode) {
    best = rows.find((r) => (r.pincode ?? "") === q) ?? null;
    if (best) matched_via = "pincode";
  }
  if (!best) {
    best =
      rows.find((r) => (r.area_name ?? "").toLowerCase().startsWith(qLower)) ??
      null;
    if (best) matched_via = "prefix";
  }
  if (!best) {
    best =
      rows.find((r) => (r.area_name ?? "").toLowerCase().includes(qLower)) ??
      null;
    if (best) matched_via = "contains";
  }

  if (!best) {
    return NextResponse.json({ error: "No match" }, { status: 404 });
  }

  return NextResponse.json({
    area_name: best.area_name,
    pincode: best.pincode,
    latitude: best.latitude,
    longitude: best.longitude,
    matched_via,
  });
}
