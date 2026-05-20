// Public GET /api/locations — pickup-point directory used by the
// mobile app's Find Us screen and the public /find-us page.
//
// Pulls live from the `pickup_locations` table via getActiveLocations()
// so the admin can add/edit/archive without a deploy. Only non-archived
// rows are returned, sorted by sort_order then name.
//
// Shape:
//   { locations: Array<{
//       id, name, type, area, latitude, longitude, address, notes?
//     }> }
//
// Cached at the edge AND in Next's data cache (the lib helper uses
// unstable_cache with the "pickup-locations" tag, which admin writes
// invalidate on every change).

import { NextRequest, NextResponse } from "next/server";

import { getActiveLocations } from "@/lib/pickup-locations";
import { apiRateLimit, getClientIP } from "@/lib/ratelimit";

export async function GET(req: NextRequest) {
  const { success: ok } = await apiRateLimit.limit(getClientIP(req));
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  const rows = await getActiveLocations();
  const locations = rows.map((r) => ({
    id: r.id,
    name: r.name,
    type: r.type,
    area: r.area,
    latitude: r.latitude,
    longitude: r.longitude,
    address: r.address,
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.pincode ? { pincode: r.pincode } : {}),
    ...(r.google_place_id ? { google_place_id: r.google_place_id } : {}),
  }));

  return NextResponse.json(
    { locations },
    {
      headers: {
        // Long edge cache — admin writes call revalidateTag which
        // also nudges the CDN on next request.
        "Cache-Control":
          "public, s-maxage=3600, stale-while-revalidate=86400",
      },
    },
  );
}
