// GET /api/delivery-quote?lat=&lng= (primary)
// GET /api/delivery-quote?pincode=  (fallback when no GPS)
//
// Returns a delivery fee quote based on driving distance from the
// P.M. Palem kitchen to the customer.
// Used by the checkout UI to show the fee BEFORE the order is placed.
// The server independently re-computes the same fee at place_order time —
// the client MUST NOT pass back this fee; the server is authoritative.
//
// Response shapes:
//   200  { serviceable: true,  feeInr: number, distanceKm: number }
//   200  { serviceable: false, feeInr: 0,      distanceKm: number }   out of range
//   200  { serviceable: null,  feeInr: null,   distanceKm: null,
//          message: "..." }                                             no coords
//   429  { error: "..." }                                               rate limited
//   503  { error: "..." }                                               no pricing origin

import { NextRequest, NextResponse } from "next/server";

import { computeDeliveryFee } from "@/lib/deliveryFee";
import { getDrivingDistanceKm, hasPricingOrigin } from "@/lib/distanceMatrix";
import { geocodePincode } from "@/lib/geocode";
import { apiRateLimit, getClientIP } from "@/lib/ratelimit";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  // DO NOT WRAP THIS IN allowedOrFailOpen, and do not delete it as a duplicate
  // of the edge limiter. It is neither.
  //
  // Yes, middleware.ts already applies apiRateLimit on this same bucket and
  // key, and on any other read route that would make this a redundant second
  // call — see the RUN THIS ONCE note in lib/ratelimit.ts. This route is one of
  // the three exceptions, and it is here for the FAILURE MODE, not for a
  // second budget: the edge call fails OPEN by design, and failing open in
  // front of this handler costs real money.
  //
  // Both branches below reach a BILLED Google API with no spending cap in
  // front of them:
  //   * ?lat&lng  -> getDrivingDistanceKm (Distance Matrix), which has NO
  //                  cache at all (lib/distanceMatrix.ts uses
  //                  `cache: "no-store"`) over an unbounded coordinate space.
  //   * ?pincode  -> geocodePincode (Geocoding), then Distance Matrix on top.
  //
  // This route was PUBLIC, UNAUTHENTICATED and had NO route-level limiter at
  // all — measured at one limiter call per request against a counting stub,
  // versus two on its neighbours — so with Upstash unreachable the edge
  // limiter failed open and this was the cheapest path in the app to an
  // unbounded Google bill. Strictly cheaper than /api/service-areas/check,
  // which at least fails closed.
  //
  // A bare `.limit()` throws when Upstash is unreachable, which 500s the
  // request. That is the intended behaviour here: the customer loses a fee
  // preview and retries, and nobody is billed. An outage must not become an
  // invoice.
  const { success: notRateLimited } = await apiRateLimit.limit(getClientIP(req));
  if (!notRateLimited) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Please slow down." },
      { status: 429 },
    );
  }

  const { searchParams } = req.nextUrl;
  const rawLat = searchParams.get("lat");
  const rawLng = searchParams.get("lng");
  const pincode = (searchParams.get("pincode") ?? "").replace(/\D/g, "");

  // Unreachable while the pricing origin is a constant (lib/distanceMatrix).
  // Left in place so the quote route and the place-order path keep the same
  // shape — if the origin ever becomes configurable again, this is where the
  // quote refuses rather than guesses.
  if (!hasPricingOrigin()) {
    return NextResponse.json(
      { error: "Delivery fee calculation is not yet configured." },
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

  // Both the BAND and the serviceability cutoff are decided off the RAW
  // distance; only the returned display value is rounded, to 2 decimals.
  // The order of these two lines is load-bearing: compute first, round
  // second. Feeding the rounded value into computeDeliveryFee costs money in
  // both directions, because every band edge is a boundary rounding can cross:
  //
  //   4.996 km  → displays 5.00 → billed ₹30 instead of ₹15 (over by ₹15;
  //               band 1's bound is strict, so 5.00 is band 2)
  //   30.004 km → displays 30.00 → ACCEPTED instead of refused, and the
  //               serviceability gate is the one that must not be guessable
  //
  // The display number is for the customer's eyes; the raw one is the price.
  const { serviceable, feeInr } = computeDeliveryFee(distanceKm);
  return NextResponse.json({
    serviceable,
    feeInr,
    distanceKm: Math.round(distanceKm * 100) / 100,
  });
}
