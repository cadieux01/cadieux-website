/**
 * Google Distance Matrix API wrapper for server-side driving-distance lookup.
 *
 * Distance is measured from the CUSTOMER to the NEAREST active
 * pickup_location. The previous STORE_ORIGIN_LAT / STORE_ORIGIN_LNG
 * env-var origin has been removed — the source of truth is now the
 * `pickup_locations` table (admin-managed at /admin/locations).
 *
 * Primary path: Google Distance Matrix API (driving mode) with the
 *               customer as origin and every active pickup as a
 *               destination in a single request; take the minimum.
 * Fallback:     Haversine straight-line distance to each pickup,
 *               then take the minimum. Haversine underestimates real
 *               driving distance, so fees may be slightly lower than
 *               actual — acceptable as graceful degradation when the
 *               Distance Matrix API is unavailable.
 */

import { haversineKm } from "@/lib/geocode";
import { getActiveLocations } from "@/lib/pickup-locations";

function getApiKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    null
  );
}

/**
 * Returns true when at least one active (non-archived) pickup_location
 * exists. Replaces the previous getStoreOrigin() env-var gate that
 * callers used to decide whether to apply distance-based fees.
 */
export async function hasActivePickups(): Promise<boolean> {
  const pickups = await getActiveLocations();
  return pickups.length > 0;
}

type MatrixElement = {
  status: string;
  distance?: { value: number; text: string };
};

type MatrixResponse = {
  status: string;
  rows?: Array<{ elements: MatrixElement[] }>;
};

/**
 * Returns the driving distance in km from the customer to the NEAREST
 * active pickup_location.
 *
 * Returns null when:
 *   - No active pickup_locations are configured
 *   - Both the Distance Matrix API AND haversine fallback fail (shouldn't happen)
 */
export async function getDrivingDistanceKm(
  custLat: number,
  custLng: number,
): Promise<number | null> {
  const pickups = await getActiveLocations();
  if (pickups.length === 0) {
    console.warn(
      "[distanceMatrix] no active pickup_locations — " +
      "distance-based delivery fee disabled; falling back to flat fee.",
    );
    return null;
  }

  const key = getApiKey();
  if (key) {
    try {
      const url = new URL(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
      );
      url.searchParams.set("origins", `${custLat},${custLng}`);
      url.searchParams.set(
        "destinations",
        pickups.map((p) => `${p.latitude},${p.longitude}`).join("|"),
      );
      url.searchParams.set("mode",   "driving");
      url.searchParams.set("units",  "metric");
      url.searchParams.set("region", "in");
      url.searchParams.set("key",    key);

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as MatrixResponse;
        if (json.status === "OK") {
          const elements = json.rows?.[0]?.elements ?? [];
          const distances = elements
            .filter(
              (el) =>
                el.status === "OK" &&
                typeof el.distance?.value === "number",
            )
            .map((el) => (el.distance!.value as number) / 1000);
          if (distances.length > 0) {
            return Math.min(...distances);
          }
          console.warn(
            "[distanceMatrix] no OK elements — falling back to haversine",
          );
        } else {
          console.warn(
            "[distanceMatrix] API status:", json.status,
            "— falling back to haversine",
          );
        }
      }
    } catch (e) {
      console.warn(
        "[distanceMatrix] fetch failed:", String(e),
        "— falling back to haversine",
      );
    }
  }

  // Haversine fallback — straight-line distance to each pickup, take min.
  const haversines = pickups.map((p) =>
    haversineKm(
      { latitude: custLat, longitude: custLng },
      { latitude: p.latitude, longitude: p.longitude },
    ),
  );
  return haversines.length > 0 ? Math.min(...haversines) : null;
}
