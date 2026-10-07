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

import { NextResponse } from "next/server";

import { getActiveLocations } from "@/lib/pickup-locations";

export async function GET() {
  // NO route-level rate limit here, deliberately. middleware.ts matches
  // `/api/:path*` and already applies apiRateLimit to this request on the same
  // IP key and the same bucket, so a call here was the same control run twice:
  // two Redis round-trips and two tokens off a 30/min budget. See the RUN THIS
  // ONCE note on apiRateLimit in lib/ratelimit.ts before re-adding it.
  //
  // Nothing on this route needs a fail-CLOSED limiter either, which is what
  // the exceptions keep theirs for. getActiveLocations() is an
  // unstable_cache'd read of our own `pickup_locations` table — no Google call
  // despite the geocoding this directory's coordinates came from, and no
  // write. The billed geocoder lives behind /api/service-areas/check and
  // /api/delivery-quote, not here, which is why this route and its neighbours
  // are treated differently.

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
