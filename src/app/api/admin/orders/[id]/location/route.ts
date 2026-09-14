import { NextRequest, NextResponse } from "next/server";

import { isAdmin } from "@/lib/admin-auth";
import { getDrivingDistanceKm } from "@/lib/distanceMatrix";
import { parseLocationPaste } from "@/lib/parse-location-paste";

// Admin-only PREVIEW endpoint. Parses a paste (raw pair, Google Maps
// URL, or maps.app.goo.gl short link) into { latitude, longitude } and
// recomputes distance_km via the existing driving-distance helper so
// the modal can show the operator what will land BEFORE they save.
//
// This endpoint DOES NOT persist. The modal calls PATCH
// /api/admin/orders/[id] with the accepted coordinates once the
// operator confirms — that PATCH re-recomputes distance_km on the
// server anyway (never trust the client), so the value returned here
// is purely for UI reassurance.
//
// Anything unparseable returns 400. We never guess coordinates from a
// place name; a name-only paste is rejected loudly.

export async function POST(
  req: NextRequest,
  { params: _params }: { params: { id: string } },
) {
  if (!isAdmin(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => ({}))) as {
    paste?: unknown;
  };

  if (typeof body.paste !== "string" || body.paste.trim().length === 0) {
    return NextResponse.json({ error: "Empty paste" }, { status: 400 });
  }

  const coords = await parseLocationPaste(body.paste);
  if (!coords) {
    return NextResponse.json(
      {
        error:
          "Could not read coordinates. Paste a Google Maps link, a maps.app.goo.gl short link, or a raw 'lat, lng' pair.",
      },
      { status: 400 },
    );
  }

  // Driving distance to the nearest configured pickup. Returns null if
  // no pickups are configured or the Distance Matrix call falls through
  // to its haversine fallback which itself returned nothing usable —
  // the UI just hides the distance line in that case.
  const distance_km = await getDrivingDistanceKm(
    coords.latitude,
    coords.longitude,
  );

  return NextResponse.json({
    latitude: coords.latitude,
    longitude: coords.longitude,
    distance_km,
  });
}
