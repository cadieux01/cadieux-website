/**
 * Google Distance Matrix API wrapper for server-side driving-distance lookup.
 *
 * Store origin is configured via env vars:
 *   STORE_ORIGIN_LAT   e.g. 17.7271677
 *   STORE_ORIGIN_LNG   e.g. 83.3007613
 *
 * Set these to the Cadieux kitchen's coordinates in Vercel / .env.local.
 * If the env vars are absent, getDrivingDistanceKm() returns null and callers
 * should fall back to the flat DELIVERY_FEE_INR.
 *
 * Primary path: Google Distance Matrix API (driving mode).
 * Fallback:     Haversine straight-line distance (haversineKm from geocode.ts).
 *               Haversine underestimates real driving distance, so fees may be
 *               slightly lower than actual — acceptable as a graceful degradation
 *               when the Distance Matrix API is unavailable.
 */

import { haversineKm } from "@/lib/geocode";

function getApiKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    null
  );
}

/** Returns the configured store origin, or null if env vars are not set. */
export function getStoreOrigin(): { lat: number; lng: number } | null {
  const lat = Number(process.env.STORE_ORIGIN_LAT);
  const lng = Number(process.env.STORE_ORIGIN_LNG);
  if (Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0)) {
    return { lat, lng };
  }
  return null;
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
 * Returns the driving distance in km from the store to the given coordinates.
 *
 * Returns null when:
 *   - STORE_ORIGIN_LAT / STORE_ORIGIN_LNG are not configured
 *   - Both the Distance Matrix API AND haversine fallback fail (shouldn't happen)
 */
export async function getDrivingDistanceKm(
  destLat: number,
  destLng: number,
): Promise<number | null> {
  const origin = getStoreOrigin();
  if (!origin) {
    console.warn(
      "[distanceMatrix] STORE_ORIGIN_LAT / STORE_ORIGIN_LNG not set — " +
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
      url.searchParams.set("origins",      `${origin.lat},${origin.lng}`);
      url.searchParams.set("destinations", `${destLat},${destLng}`);
      url.searchParams.set("mode",   "driving");
      url.searchParams.set("units",  "metric");
      url.searchParams.set("region", "in");
      url.searchParams.set("key",    key);

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as MatrixResponse;
        if (json.status === "OK") {
          const el = json.rows?.[0]?.elements?.[0];
          if (el?.status === "OK" && typeof el.distance?.value === "number") {
            return el.distance.value / 1000;
          }
          console.warn(
            "[distanceMatrix] element status:", el?.status,
            "— falling back to haversine",
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

  // Haversine fallback — straight-line, slightly shorter than driving.
  return haversineKm(
    { latitude: origin.lat, longitude: origin.lng },
    { latitude: destLat,    longitude: destLng    },
  );
}
