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
  // centroid of that pincode, or ZERO_RESULTS (→ null → not serviceable)
  // when the pincode doesn't exist.
  const result = await callGoogle({
    components: `country:IN|postal_code:${pincode}`,
  });
  if (!result?.geometry?.location) return null;
  const out = {
    latitude: result.geometry.location.lat,
    longitude: result.geometry.location.lng,
  };

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
