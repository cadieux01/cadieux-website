// Server-side geocoding helpers backed by the Google Geocoding API.
//
// Two entry points:
//   * geocodeArea(name, pincode?) — used when admin activates a new area.
//     Returns { lat, lng, postal_code? } or null on failure. Never throws.
//   * geocodePincode(pincode) — used by the public serviceability check.
//     Caches the result in pincode_geocache so we hit Google once per
//     pincode, ever.
//
// API key resolution: prefer GOOGLE_MAPS_API_KEY (server-only), fall back
// to NEXT_PUBLIC_GOOGLE_MAPS_API_KEY. Both are documented to have Maps +
// Places + Geocoding enabled on the GCP project. When no key is set we
// return null silently so the rest of the flow degrades gracefully.

import { supabaseAdmin } from "@/lib/admin-auth";

function getApiKey(): string | null {
  return (
    process.env.GOOGLE_MAPS_API_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
    null
  );
}

type GoogleAddrComponent = {
  long_name: string;
  short_name: string;
  types: string[];
};

type GoogleGeocodeResult = {
  geometry?: { location?: { lat: number; lng: number } };
  address_components?: GoogleAddrComponent[];
};

type GoogleGeocodeResponse = {
  status: string;
  results?: GoogleGeocodeResult[];
};

function pickComponent(
  components: GoogleAddrComponent[] | undefined,
  type: string,
): string | null {
  if (!components) return null;
  const hit = components.find((c) => c.types.includes(type));
  return hit?.long_name ?? null;
}

async function callGoogle(
  params: { address?: string; components?: string },
): Promise<GoogleGeocodeResult | null> {
  const key = getApiKey();
  if (!key) {
    console.warn("[geocode] no Google Maps API key in env — skipping");
    return null;
  }
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  if (params.address) url.searchParams.set("address", params.address);
  if (params.components) url.searchParams.set("components", params.components);
  url.searchParams.set("region", "in");
  url.searchParams.set("key", key);
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) {
      console.warn("[geocode] HTTP", r.status);
      return null;
    }
    const json = (await r.json()) as GoogleGeocodeResponse;
    if (json.status !== "OK" || !json.results?.length) {
      if (json.status !== "ZERO_RESULTS") {
        console.warn("[geocode] status:", json.status);
      }
      return null;
    }
    return json.results[0];
  } catch (e) {
    console.warn("[geocode] fetch failed:", String(e));
    return null;
  }
}

export type AreaGeocode = {
  latitude: number;
  longitude: number;
  postal_code: string | null;
};

/** Geocode an area inside Visakhapatnam (used by admin activation). */
export async function geocodeArea(
  areaName: string,
  pincode?: string | null,
): Promise<AreaGeocode | null> {
  const parts = [areaName.trim()];
  if (pincode) parts.push(pincode);
  parts.push("Visakhapatnam", "India");
  const address = parts.filter(Boolean).join(", ");
  const result = await callGoogle({ address });
  if (!result?.geometry?.location) return null;
  return {
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
    postal_code: pickComponent(result.address_components, "postal_code"),
  };
}

/**
 * Reverse-geocode a lat/lng pair into a pincode by walking every
 * returned result for a `postal_code` component. Used as a fallback
 * when a forward geocode succeeded (we have coords) but the chosen
 * result was a neighborhood / locality and Google didn't attach a
 * postal_code to it — reverse-geocoding on coordinates pulls in the
 * surrounding street_address / postal_code-typed results which almost
 * always have one. Returns null only when no result in the response
 * carries a 6-digit postal_code.
 */
export async function reverseGeocodePincode(
  latitude: number,
  longitude: number,
): Promise<string | null> {
  const key = getApiKey();
  if (!key) return null;
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("latlng", `${latitude},${longitude}`);
  url.searchParams.set("region", "in");
  url.searchParams.set("key", key);
  try {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) return null;
    const json = (await r.json()) as GoogleGeocodeResponse;
    if (json.status !== "OK" || !json.results?.length) return null;
    for (const result of json.results) {
      const pc = pickComponent(result.address_components, "postal_code");
      if (pc && /^\d{6}$/.test(pc)) return pc;
    }
    return null;
  } catch (e) {
    console.warn("[geocode] reverse-geocode failed:", String(e));
    return null;
  }
}

export type PincodeGeocode = {
  latitude: number;
  longitude: number;
};

type ServiceAreaCandidate = {
  pincode: string;
  area_name: string;
  latitude: number;
  longitude: number;
  added_at: string;
};

/**
 * Last-resort centroid for a pincode, read from `service_areas` when Google
 * returns ZERO_RESULTS (or errors, or no API key is configured). Admin has
 * already activated these areas and geocoded them, so the coordinate exists
 * even when Google won't resolve the bare postal code — 530077 KURMANA PALEM
 * is the live example: active, coordinates present, absent from the cache,
 * and therefore unpriceable until now.
 *
 * ── WHY THE SHARED-COORDINATE GUARD IS NOT OPTIONAL ──────────────────────
 * These rows were written by `geocodeArea()`, which geocodes an AREA NAME
 * anchored on "Visakhapatnam" — the exact pattern `geocodePincode` below was
 * rewritten to stop using, because Google answers an unresolvable name with
 * a generic city-centre point. That is not theoretical here: on prod, 18
 * active rows share the single coordinate 17.7343219 / 83.3129841, a spot
 * 1.54 km from the nearest origin. Those 18 span 18 DIFFERENT pincodes and
 * include `500004` (Hyderabad, ~500 km away) and `531151` (Araku, ~100 km
 * inland). Reading this table unfiltered would price Hyderabad as a ₹15
 * local delivery and re-open the out-of-area hole that the Rourkela
 * subscription (pincode 769008) originally exposed.
 *
 * So: a coordinate recorded against more than one distinct pincode is
 * REJECTED. A genuine centroid belongs to exactly one pincode; a Google
 * fallback point gets stamped on every row that failed. This single rule
 * drops all 18 poisoned rows and keeps the two real ones (530077 at
 * 15.05 km, 530015 at 8.18 km). Coordinates duplicated WITHIN one pincode
 * (530015 has two such rows) are fine and still resolve — the test is
 * `count(distinct pincode) > 1`, not `count(*) > 1`.
 *
 * Returns null rather than guessing. Under the banded fee, a wrong
 * coordinate is a wrong PRICE, and the cheapest band is the likeliest
 * wrong answer.
 */
async function geocodeFromServiceAreas(
  pincode: string,
): Promise<PincodeGeocode | null> {
  const { data, error } = await supabaseAdmin
    .from("service_areas")
    .select("pincode, area_name, latitude, longitude, added_at")
    .eq("pincode", pincode)
    .eq("is_active", true)
    .not("latitude", "is", null)
    .not("longitude", "is", null);
  if (error) {
    console.warn("[geocode] service_areas fallback failed:", error.message);
    return null;
  }

  // Tie-break, explicit because 32 live pincodes have more than one usable
  // row: prefer the catch-all 'General' row, then the OLDEST by added_at,
  // then area_name alphabetically. 530047 has two rows 3.7 km apart and is
  // resolved by the 'General' preference; 531163 is the one pincode with
  // several rows and no 'General', and is resolved by added_at.
  const candidates = ((data ?? []) as ServiceAreaCandidate[]).sort((a, b) => {
    const aGeneral = a.area_name === "General" ? 0 : 1;
    const bGeneral = b.area_name === "General" ? 0 : 1;
    if (aGeneral !== bGeneral) return aGeneral - bGeneral;
    const byAdded = a.added_at.localeCompare(b.added_at);
    if (byAdded !== 0) return byAdded;
    return a.area_name.localeCompare(b.area_name);
  });

  for (const row of candidates) {
    // Is this coordinate claimed by any OTHER pincode? One hit is enough to
    // condemn it. Runs on the cache-miss path only, over ≤3 candidates.
    const { data: collision, error: collisionErr } = await supabaseAdmin
      .from("service_areas")
      .select("pincode")
      .eq("latitude", row.latitude)
      .eq("longitude", row.longitude)
      .neq("pincode", pincode)
      .limit(1);
    if (collisionErr) {
      console.warn(
        "[geocode] shared-coordinate check failed:",
        collisionErr.message,
      );
      return null; // cannot prove the coordinate is clean → do not use it
    }
    if (collision && collision.length > 0) {
      console.warn(
        `[geocode] service_areas row ${pincode}/${row.area_name} rejected — ` +
          `coordinate also recorded for pincode ${collision[0].pincode}`,
      );
      continue;
    }
    return { latitude: row.latitude, longitude: row.longitude };
  }

  return null;
}

/** Geocode a customer pincode. Caches forever in pincode_geocache. */
export async function geocodePincode(
  pincode: string,
): Promise<PincodeGeocode | null> {
  if (!/^\d{6}$/.test(pincode)) return null;

  // Cache hit?
  const { data: cached } = await supabaseAdmin
    .from("pincode_geocache")
    .select("latitude, longitude")
    .eq("pincode", pincode)
    .maybeSingle();
  if (cached && typeof cached.latitude === "number" && typeof cached.longitude === "number") {
    return { latitude: cached.latitude, longitude: cached.longitude };
  }

  // Cache miss → call Google. Resolve the EXACT postal code anywhere in
  // India via the components filter — never anchor the query to a city.
  // Anchoring on "Visakhapatnam" used to make Google fall back to the
  // Vizag city centre for any non-Vizag pincode, so Delhi/Mumbai/Hyderabad
  // pincodes looked ~1km from a Vizag area and were wrongly serviceable.
  // With components=postal_code:<pin>|country:IN Google returns the true
  // centroid of that pincode, or ZERO_RESULTS when the pincode doesn't
  // exist — which now falls through to the service_areas check below
  // instead of straight to null.
  const result = await callGoogle({
    components: `country:IN|postal_code:${pincode}`,
  });

  // Google couldn't resolve it (ZERO_RESULTS, an HTTP/network failure, or no
  // API key). Before giving up, check whether admin has already geocoded an
  // active area on this pincode — see geocodeFromServiceAreas for why that
  // read is guarded rather than trusted.
  const out = result?.geometry?.location
    ? {
        latitude: result.geometry.location.lat,
        longitude: result.geometry.location.lng,
      }
    : await geocodeFromServiceAreas(pincode);
  if (!out) return null;

  // Persist cache. Don't block the caller if this fails.
  void supabaseAdmin
    .from("pincode_geocache")
    .upsert({ pincode, ...out }, { onConflict: "pincode" })
    .then(({ error }) => {
      if (error) console.warn("[geocode] cache write failed:", error.message);
    });

  return out;
}

/** Haversine distance in kilometres. */
export function haversineKm(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  const R = 6371; // km
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const lat1 = toRad(a.latitude);
  const lat2 = toRad(b.latitude);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
