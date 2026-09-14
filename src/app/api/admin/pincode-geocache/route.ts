import { NextRequest, NextResponse } from "next/server";

import { isAdmin, supabaseAdmin } from "@/lib/admin-auth";

// GET /api/admin/pincode-geocache
//
// Returns { pincode, latitude, longitude }[] for every geocoded pincode.
// Powers the pincode-fallback branch of the "nearest from area" sort on
// /admin/orders — a client-side lookup table small enough (~263 rows,
// well under 20 KB) to hydrate once on page mount rather than call
// per row.
//
// The service_role read is intentional. This table has RLS enabled
// with zero policies (deny-all), same as the other geo tables.

type Row = {
  pincode: string;
  latitude: number;
  longitude: number;
};

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { data, error } = await supabaseAdmin
    .from("pincode_geocache")
    .select("pincode, latitude, longitude")
    .not("latitude", "is", null)
    .not("longitude", "is", null);

  if (error) {
    console.error("[pincode-geocache] fetch failed:", error.message);
    return NextResponse.json({ error: "Fetch failed" }, { status: 500 });
  }

  const rows = ((data ?? []) as Row[]).filter(
    (r) =>
      typeof r.pincode === "string" &&
      /^\d{6}$/.test(r.pincode) &&
      typeof r.latitude === "number" &&
      typeof r.longitude === "number",
  );

  return NextResponse.json({ rows });
}
