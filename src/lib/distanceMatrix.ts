/**
 * Google Distance Matrix API wrapper for server-side driving-distance lookup.
 *
 * ORIGIN: the P.M. Palem kitchen, and ONLY the P.M. Palem kitchen.
 *
 * This file used to measure to the NEAREST active pickup_location and take
 * the minimum. Raja's ruling (29 Sep 2026) is a single fixed origin — every
 * rider run starts at the kitchen, so that is what the fee should reflect.
 * The other active locations (the two dark stores) are still real pickup
 * points and still appear on /find-us, /store-locator, /delivery/[area] and
 * GET /api/locations; they simply stop affecting PRICE.
 *
 * Why the coordinates are hardcoded rather than read from the table:
 *
 *   The old min-over-rows behaviour meant that adding ANY pickup location
 *   in /admin/locations silently re-priced the whole city — a delivery-fee
 *   change made from a screen that says nothing about fees. Pinning the
 *   origin here makes a repricing a code change and a deploy. It also makes
 *   the fee independent of `is_archived`: archiving the kitchen row by
 *   accident would otherwise have removed the origin and refused every
 *   address in the country.
 *
 *   The tradeoff is that these numbers and the `cadieux` row in
 *   pickup_locations (id fixed below for the record) can drift apart. If the
 *   kitchen moves, BOTH have to change. That is the intended cost.
 *
 * Primary path: Google Distance Matrix API, driving mode, kitchen → customer.
 * Fallback:     Haversine straight-line distance. Haversine underestimates
 *               real driving distance, so fees may be slightly lower than
 *               actual — acceptable as graceful degradation when the
 *               Distance Matrix API is unavailable. Unlike the API path it
 *               cannot fail, so there is no "unmeasurable" outcome left for
 *               a valid coordinate.
 */

import { haversineKm } from "@/lib/geocode";

/**
 * The single pricing origin. Matches pickup_locations row
 * `Cadieux` (type `kitchen`, Pothinamallayya Palem, pincode 530041) on
 * production, but is NOT read from it — see the header for why.
 */
const PRICING_ORIGIN = {
  latitude: 17.7955894,
  longitude: 83.3500975,
} as const;

function getApiKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    null
  );
}

/**
 * Whether an origin exists to measure delivery distance from. Callers gate
 * their fee calculation on this.
 *
 * Now always true, because PRICING_ORIGIN is a constant. It used to read
 * `getActiveLocations().length > 0`, which coupled the ability to price ANY
 * delivery to the contents of an admin-managed table: archive the last
 * pickup row from /admin/locations and the whole country became
 * unserviceable. That is gone.
 *
 * Kept as a named call rather than deleting the five call-site branches
 * because those branches sit inside the checkout path and removing them is
 * a re-indent of code that charges customers money, for no behaviour
 * change. Sync, not async — there is nothing to await any more.
 */
export function hasPricingOrigin(): boolean {
  return true;
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
 * Returns the driving distance in km from the P.M. Palem kitchen to the
 * customer. The kitchen is the ONLY origin — the other active
 * pickup_locations do not enter into it.
 *
 * Note the direction: the kitchen is the ORIGIN and the customer is the
 * DESTINATION. It was the other way round when there were many pickups
 * (one origin, N destinations, take the min). Driving distance is not
 * perfectly symmetric — one-ways and medians differ — and this direction is
 * the one the rider actually travels, so it is the one we charge for.
 *
 * Returns null only if both the Distance Matrix API AND the haversine
 * fallback fail, which the fallback makes practically impossible for a
 * valid coordinate. Callers still handle null by REFUSING the address; no
 * fee is ever guessed, because under a banded fee a guess would be the
 * CHEAPEST band and would skip the serviceability gate on the way past.
 */
export async function getDrivingDistanceKm(
  custLat: number,
  custLng: number,
): Promise<number | null> {
  const key = getApiKey();
  if (key) {
    try {
      const url = new URL(
        "https://maps.googleapis.com/maps/api/distancematrix/json",
      );
      url.searchParams.set(
        "origins",
        `${PRICING_ORIGIN.latitude},${PRICING_ORIGIN.longitude}`,
      );
      url.searchParams.set("destinations", `${custLat},${custLng}`);
      url.searchParams.set("mode",   "driving");
      url.searchParams.set("units",  "metric");
      url.searchParams.set("region", "in");
      url.searchParams.set("key",    key);

      const res = await fetch(url.toString(), { cache: "no-store" });
      if (res.ok) {
        const json = (await res.json()) as MatrixResponse;
        if (json.status === "OK") {
          const elements = json.rows?.[0]?.elements ?? [];
          // One origin, one destination — exactly one element, no min().
          const el = elements[0];
          if (el?.status === "OK" && typeof el.distance?.value === "number") {
            return el.distance.value / 1000;
          }
          console.warn(
            "[distanceMatrix] element status:", el?.status ?? "missing",
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

  // Haversine fallback — straight-line kitchen → customer. Always returns a
  // number for a valid coordinate, so the null branch above is now the only
  // realistic way a caller sees "unmeasurable".
  return haversineKm(PRICING_ORIGIN, { latitude: custLat, longitude: custLng });
}
