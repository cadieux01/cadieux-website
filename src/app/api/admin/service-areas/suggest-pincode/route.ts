// Admin-only: given an area name (e.g. "MVP Colony"), look up its
// approximate pincode via Google Geocoding. Used to pre-fill the
// "Add new pincode" form in /admin/service-areas so the operator
// doesn't have to remember it.
//
// Returns:
//   { pincode: string|null, latitude?, longitude? }
//
// Failures resolve to { pincode: null } so the UI can fall back silently.

import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin-auth";
import { geocodeArea, reverseGeocodePincode } from "@/lib/geocode";

export async function GET(req: NextRequest) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const area = req.nextUrl.searchParams.get("area")?.trim() ?? "";
  if (!area || area.length > 120) {
    return NextResponse.json(
      { error: "area is required (max 120 chars)" },
      { status: 400 },
    );
  }

  const geo = await geocodeArea(area);
  if (!geo) {
    return NextResponse.json({ pincode: null });
  }

  // Many neighborhood/locality results omit `postal_code` from
  // address_components even though Google clearly knows the coords.
  // When that happens, reverse-geocode the coords — that response
  // almost always contains a postal_code in one of the result rows.
  let pincode = geo.postal_code;
  if (!pincode || !/^\d{6}$/.test(pincode)) {
    pincode = await reverseGeocodePincode(geo.latitude, geo.longitude);
  }

  return NextResponse.json({
    pincode: pincode && /^\d{6}$/.test(pincode) ? pincode : null,
    latitude: geo.latitude,
    longitude: geo.longitude,
  });
}
