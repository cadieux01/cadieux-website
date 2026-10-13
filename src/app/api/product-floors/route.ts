// Public GET for each product's BAKING DAYS — the union of
// products.available_from and its product_open_dates rows, shaped as the
// PreorderInfo DTO (raw `from` + `openDates`, plus the resolved copy).
//
// Not sensitive — it is the same thing the shop page prints on the tile. The
// cart and checkout are client components with no server data of their own,
// so they read it here rather than talking to Supabase from the browser.
//
// This is PRESENTATION ONLY. The schedule is enforced server-side in
// enforceDeliveryDays (code "preorder_floor") on every order and
// subscription path; a client that never calls this route, or gets an empty
// map from it, still cannot book a day the kitchen is shut.
//
// The route name is kept: it is fetched by the shipped client bundle and by
// `useProductFloors`, and renaming it buys nothing.

import { NextResponse } from "next/server";
import { getProductAvailability } from "@/lib/products";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const availability = await getProductAvailability();
  // No-store on the response, but getProductAvailability is itself cached for
  // 60s behind the "products" tag — so a schedule change goes live within a
  // minute of the write, with no deploy.
  return NextResponse.json(
    { floors: Object.fromEntries(availability?.preorder ?? []) },
    { headers: { "cache-control": "no-store" } },
  );
}
