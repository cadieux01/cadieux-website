// Client-side geocoding helpers — browser-safe (uses NEXT_PUBLIC_GOOGLE_MAPS_API_KEY).
// Mirror of the server-side lib/geocode.ts but callable from "use client" code.

const KEY = () => process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";

type GAddrComp = { long_name: string; types: string[] };

function pick(comps: GAddrComp[], type: string): string {
  return comps.find((c) => c.types.includes(type))?.long_name ?? "";
}

type GeoResult = {
  address_components: GAddrComp[];
  formatted_address: string;
  geometry: { location: { lat: number; lng: number } };
};

type GeoResponse = { status: string; results: GeoResult[] };

function parseResult(r: GeoResult): {
  line1: string; area: string; city: string; pincode: string;
  lat: number; lng: number;
} {
  const c = r.address_components;
  const streetNum = pick(c, "street_number");
  const route = pick(c, "route");
  const premise = pick(c, "premise") || pick(c, "subpremise");
  const line1Parts = [premise, streetNum, route].filter(Boolean);
  const line1 =
    line1Parts.join(" ").trim() || r.formatted_address.split(",")[0].trim();
  const area =
    pick(c, "sublocality_level_1") ||
    pick(c, "sublocality") ||
    pick(c, "neighborhood") ||
    pick(c, "sublocality_level_2") ||
    "";
  const city =
    pick(c, "locality") ||
    pick(c, "administrative_area_level_3") ||
    pick(c, "administrative_area_level_2") ||
    "";
  const pincode = pick(c, "postal_code");
  return { line1, area, city, pincode, lat: r.geometry.location.lat, lng: r.geometry.location.lng };
}

/** Reverse-geocode a lat/lng pair to address fields. Returns null on failure. */
export async function reverseGeocodeClient(
  lat: number,
  lng: number,
): Promise<{ line1: string; area: string; city: string; pincode: string; lat: number; lng: number } | null> {
  const key = KEY();
  if (!key) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&region=in&key=${encodeURIComponent(key)}`,
    );
    const json = (await res.json()) as GeoResponse;
    if (json.status !== "OK" || !json.results.length) return null;
    return parseResult(json.results[0]);
  } catch {
    return null;
  }
}

/** Geocode a 6-digit pincode to city + area. Returns null on failure. */
export async function geocodePincodeClient(
  pincode: string,
): Promise<{ city: string; area: string } | null> {
  const key = KEY();
  if (!key || !/^\d{6}$/.test(pincode)) return null;
  try {
    const res = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${pincode}+India&region=in&key=${encodeURIComponent(key)}`,
    );
    const json = (await res.json()) as GeoResponse;
    if (json.status !== "OK" || !json.results.length) return null;
    const c = json.results[0].address_components;
    const city =
      pick(c, "locality") ||
      pick(c, "administrative_area_level_3") ||
      pick(c, "administrative_area_level_2") ||
      "";
    const area =
      pick(c, "sublocality_level_1") ||
      pick(c, "sublocality") ||
      "";
    return { city, area };
  } catch {
    return null;
  }
}
