// Source-of-truth reader for the `pickup_locations` table. Powers:
//   • public GET /api/locations (mobile Find Us screen)
//   • public /find-us page (web)
// The admin CRUD APIs write to the same table and bust the
// "pickup-locations" tag so changes propagate within seconds.
//
// Cached aggressively because the marker set rarely changes — usually
// only when a new stall opens or a partner pickup is added.

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

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

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// 5-minute revalidate window keeps Supabase reads bounded; the admin
// CRUD routes also call `revalidateTag("pickup-locations")` after
// every write so the operator sees their edit reflected within seconds.
export const getActiveLocations = unstable_cache(
  async (): Promise<PickupLocationRow[]> => {
    const { data, error } = await supabaseAnon
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
