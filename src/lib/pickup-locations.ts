// Source-of-truth reader for the `pickup_locations` table. Powers:
//   • public GET /api/locations (mobile Find Us screen)
//   • public /find-us page (web)
// The admin CRUD APIs write to the same table and bust the
// "pickup-locations" tag so changes propagate within seconds.
//
// Cached aggressively because the marker set rarely changes — usually
// only when a new stall opens or a partner pickup is added.

import { unstable_cache } from "next/cache";

import { supabaseAdmin } from "@/lib/admin-auth";

export type PickupLocationType = "kitchen" | "stall" | "partner_pickup";

export type PickupLocationRow = {
  id: string;
  name: string;
  type: PickupLocationType;
  area: string;
  address: string;
  latitude: number;
  longitude: number;
  notes: string | null;
  /** Optional 6-digit Indian pincode — auto-filled by the admin Maps
   *  autocomplete / reverse geocoder. Nullable for back-compat with
   *  rows seeded before the column was added. */
  pincode: string | null;
  /** Optional Google Maps Place ID. When present, /find-us uses it to
   *  hand off a higher-accuracy "Get Directions" link. */
  google_place_id: string | null;
  sort_order: number;
};

// 5-minute revalidate window keeps Supabase reads bounded; the admin
// CRUD routes also call `revalidateTag("pickup-locations")` after
// every write so the operator sees their edit reflected within seconds.
//
// Uses service-role (admin) client because the table has RLS enabled
// with no anon-read policy ("no policy = no access"). All callers are
// server-side (API routes, server components, server lib utilities),
// so the key never leaves the server.
export const getActiveLocations = unstable_cache(
  async (): Promise<PickupLocationRow[]> => {
    const { data, error } = await supabaseAdmin
      .from("pickup_locations")
      .select(
        "id, name, type, area, address, latitude, longitude, notes, pincode, google_place_id, sort_order",
      )
      .eq("is_archived", false)
      .order("sort_order", { ascending: true })
      .order("name", { ascending: true });

    if (error) {
      console.error("[lib/pickup-locations] fetch failed:", error.message);
      return [];
    }
    return (data ?? []) as PickupLocationRow[];
  },
  ["pickup-locations-active"],
  { revalidate: 300, tags: ["pickup-locations"] },
);

// Lowercase-hyphen slug form of a pickup_locations.area string. Matches
// the slug convention used by service_areas.slug — e.g.
// "Pothinamallayya Palem" → "pothinamallayya-palem", "MVP Colony" →
// "mvp-colony". Zero-maintenance join: any area whose plain-text name
// slugifies to the service-area's slug is automatically bucketed onto
// the corresponding /delivery/[area] page.
export function slugifyArea(area: string): string {
  return area
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// Returns every active pickup_location whose slugified `area` matches
// the given service-area slug. Powers /delivery/[area] pages so their
// "Also stocked at" block reflects live admin state instead of a
// hardcoded RETAILERS map. Same cache + tag as getActiveLocations()
// so admin CRUD invalidates both together.
export async function getActiveLocationsByAreaSlug(
  slug: string,
): Promise<PickupLocationRow[]> {
  const all = await getActiveLocations();
  return all.filter((row) => slugifyArea(row.area) === slug);
}
