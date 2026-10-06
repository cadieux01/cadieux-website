// Public pincode serviceability check. Used by the web checkout form
// and the mobile app to swap the CTA between "Proceed to Checkout" and
// "Send Request to Deliver at Your Location".
//
// No auth — anyone typing a pincode in the address form hits this.
// Results are cached by Next under the "service-areas" tag, which the
// admin writes invalidate.
//
// Two-stage resolution:
//   1. Exact pincode match in service_areas → serviceable via="exact"
//   2. Pincode geocode falls within PROXIMITY_RADIUS_KM of an active
//      area → serviceable via="proximity" (auto-approves nearby orders)
//   3. Explicit deactivation of a pincode wins over proximity — admins
//      can deliberately pause a pincode and proximity won't undo it.

import { NextRequest, NextResponse } from "next/server";

import { apiRateLimit, getClientIP } from "@/lib/ratelimit";
import { resolveServiceability } from "@/lib/service-areas";

export async function GET(req: NextRequest) {
  // DO NOT WRAP THIS IN allowedOrFailOpen. Every other public read route in
  // this app fails open, and this one must not.
  //
  // resolveServiceability() -> geocodePincode() (lib/service-areas.ts) ends in
  // a BILLED Google Geocoding call on a cache miss, plus a fire-and-forget
  // upsert into pincode_geocache. Worse, the cache is only written when
  // Google resolves the pincode: a well-formed but non-existent 6-digit
  // string returns ZERO_RESULTS, falls through to null and caches NOTHING, so
  // it is re-billed on every single request. Failing this route open during
  // an Upstash outage would leave the limiter — the only control in front of
  // that spend — switched off against a 900,000-value enumerable keyspace.
  // An outage here converts a 500 into a bill, so it stays fail-CLOSED.
  const { success: ok } = await apiRateLimit.limit(getClientIP(req));
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  const raw = req.nextUrl.searchParams.get("pincode");
  const result = await resolveServiceability(raw ?? "");

  if (!result.serviceable) {
    if (result.reason === "invalid_pincode") {
      return NextResponse.json(
        { serviceable: false, area_names: [], error: "Invalid pincode" },
        { status: 400 },
      );
    }
    return NextResponse.json({
      serviceable: false,
      area_names: [],
      reason: result.reason,
    });
  }

  if (result.via === "exact") {
    return NextResponse.json({
      serviceable: true,
      via: "exact",
      area_names: result.area_names,
    });
  }
  return NextResponse.json({
    serviceable: true,
    via: "proximity",
    nearest_area: result.nearest_area,
    distance_km: result.distance_km,
    // Keep area_names populated for older clients that key off it.
    area_names: [result.nearest_area],
  });
}
