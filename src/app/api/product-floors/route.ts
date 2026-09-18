// Public GET for the per-product delivery floors (products.available_from).
//
// Not sensitive — it is the same thing the shop page prints on the tile. The
// cart and checkout are client components with no server data of their own,
// so they read it here rather than talking to Supabase from the browser.
//
// This is PRESENTATION ONLY. The floor is enforced server-side in
// enforceDeliveryFloor (code "preorder_floor") on every order and
// subscription path; a client that never calls this route, or gets an empty
// map from it, still cannot book an early date.

import { NextResponse } from "next/server";
import { getProductAvailability } from "@/lib/products";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const availability = await getProductAvailability();
  // No-store on the response, but getProductAvailability is itself cached for
  // 60s behind the "products" tag — so lifting a floor goes live within a
  // minute of the UPDATE, with no deploy.
  return NextResponse.json(
    { floors: Object.fromEntries(availability?.preorder ?? []) },
    { headers: { "cache-control": "no-store" } },
  );
}
