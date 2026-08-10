// Pure great-circle distance between two lat/lng points, in kilometres.
//
// ZERO imports on purpose — this file is client-safe.
//
// Background: geocode.ts also exports a haversineKm, but that module imports
// the Supabase admin client (which reads SUPABASE_SERVICE_ROLE_KEY at load
// time). Importing geocode.ts from a client component drags the whole
// server-only graph into the browser bundle and crashes at hydration with
// "supabaseUrl is required" → blank page. Client code must import from
// this file instead.

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
