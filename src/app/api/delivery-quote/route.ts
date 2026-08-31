// GET /api/delivery-quote?lat=&lng= (primary)
// GET /api/delivery-quote?pincode=  (fallback when no GPS)
//
// Returns a delivery fee quote based on driving distance from the
// customer to the NEAREST active pickup_location.
// Used by the checkout UI to show the fee BEFORE the order is placed.
// The server independently re-computes the same fee at place_order time —
// the client MUST NOT pass back this fee; the server is authoritative.
//
// Response shapes:
//   200  { serviceable: true,  feeInr: number, distanceKm: number }
//   200  { serviceable: false, feeInr: 0,      distanceKm: number }   > 20 km
//   200  { serviceable: null,  feeInr: null,   distanceKm: null,
//          message: "..." }                                             no coords
//   503  { error: "..." }                                               no active pickups

import { NextRequest, NextResponse } from "next/server";

import { computeDeliveryFee } from "@/lib/deliveryFee";
import { getDrivingDistanceKm, hasActivePickups } from "@/lib/distanceMatrix";
import { geocodePincode } from "@/lib/geocode";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const rawLat = searchParams.get("lat");
  const rawLng = searchParams.get("lng");
  const pincode = (searchParams.get("pincode") ?? "").replace(/\D/g, "");

  if (!(await hasActivePickups())) {
    return NextResponse.json(
      {
        error:
          "Delivery fee calculation is not yet configured. " +
          "Add at least one active pickup location in /admin/locations.",
      },
      { status: 503 },
    );
  }

  const lat = Number(rawLat);
  const lng = Number(rawLng);

  let distanceKm: number | null = null;

  // Primary: GPS coordinates
  if (
    rawLat !== null && rawLng !== null &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  ) {
    distanceKm = await getDrivingDistanceKm(lat, lng);
  }

  // Fallback: pincode centroid
  if (distanceKm === null && /^\d{6}$/.test(pincode)) {
    const centroid = await geocodePincode(pincode);
    if (centroid) {
      distanceKm = await getDrivingDistanceKm(
        centroid.latitude,
        centroid.longitude,
      );
    }
  }

  // No usable location at all
  if (distanceKm === null) {
    return NextResponse.json({
      serviceable: null,
      feeInr: null,
      distanceKm: null,
      message:
        "Share your location or enter a full address to see the delivery fee.",
    });
  }

  // Fee is computed off the RAW distance; only the returned display value
  // is rounded. 2 decimals (not 1) because the sub-1 km bands are priced on
  // the raw value — at 1 decimal both 0.95 km (₹10) and 1.04 km (₹22) render
  // as "1 km", so two customers would see the same distance at different fees.
  const { serviceable, feeInr } = computeDeliveryFee(distanceKm);
  return NextResponse.json({
    serviceable,
    feeInr,
    distanceKm: Math.round(distanceKm * 100) / 100,
  });
}
