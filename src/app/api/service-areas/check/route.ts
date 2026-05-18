// Public pincode serviceability check. Used by the web checkout form
// and (later) the mobile app to swap the CTA between "Proceed to
// Checkout" and "Send Request to Deliver at Your Location".
//
// No auth — anyone typing a pincode in the address form hits this.
// Results are cached by Next under the "service-areas" tag, which the
// admin writes invalidate.

import { NextRequest, NextResponse } from "next/server";

import { apiRateLimit, getClientIP } from "@/lib/ratelimit";
import { lookupServiceArea, normalizePincode } from "@/lib/service-areas";

export async function GET(req: NextRequest) {
  // Cheap DDoS guardrail — the underlying DB query is cached anyway,
  // but a flood of distinct pincodes would still warm misses.
  const { success: ok } = await apiRateLimit.limit(getClientIP(req));
  if (!ok) {
    return NextResponse.json(
      { error: "Rate limit exceeded" },
      { status: 429 },
    );
  }

  const raw = req.nextUrl.searchParams.get("pincode");
  const pincode = normalizePincode(raw);
  if (!pincode) {
    return NextResponse.json(
      { serviceable: false, area_names: [], error: "Invalid pincode" },
      { status: 400 },
    );
  }

  const { serviceable, area_names } = await lookupServiceArea(pincode);
  return NextResponse.json({ serviceable, area_names });
}
