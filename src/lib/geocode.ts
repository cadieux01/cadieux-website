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

import { Redis } from "@upstash/redis";

import { supabaseAdmin } from "@/lib/admin-auth";

// ---------------------------------------------------------------------------
// NEGATIVE GEOCODE CACHE
//
// pincode_geocache only ever held SUCCESSES: geocodePincode returned early on
// a null result, so a well-formed but non-existent 6-digit pincode resolved to
// nothing, cached nothing, and was re-sent to a BILLED Google Geocoding call on
// every single request. Verified against prod: 625 rows, zero of them negative.
// Across a 900k-pincode keyspace that is an unbounded bill for a fixed, tiny
// set of real answers.
//
// Why Redis and not a column: pincode_geocache declares
// `latitude/longitude double precision NOT NULL` (sql/service-areas-geocoding.sql),
// so there is no nullable column to put a sentinel in and Postgres rejects a
// null-coordinate row outright. A `not_found boolean` flag — or dropping those
// NOT NULLs — is a migration, and this change ships without one. Upstash is
// already a hard dependency of every API request via the rate limiter, so this
// adds no new service, no new env var and no new failure mode.
//
// The sentinel resolves to NULL, never to coordinates. That is deliberate and
// load-bearing — see the note above negativeHit() in geocodePincode.
// ---------------------------------------------------------------------------

/** 7 days. See NEGATIVE_TTL_SECONDS for why this is a backstop, not the
 *  invalidation story. */
export const NEGATIVE_TTL_SECONDS = 7 * 24 * 60 * 60;

const negativeRedis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

function negativeKey(pincode: string): string {
  return `geocache:neg:${pincode}`;
}

/**
 * Has this pincode already been proven not to exist?
 *
 * Fails OPEN (returns false, i.e. "no cached negative") on any Redis problem.
 * A broken negative cache must never invent a serviceability answer; the worst
 * it may do is let the request fall through to the behaviour we had before.
 */
async function hasNegative(pincode: string): Promise<boolean> {
  try {
    return (await negativeRedis.exists(negativeKey(pincode))) === 1;
  } catch (e) {
    console.warn("[geocode] negative-cache read failed:", String(e));
    return false;
  }
}

/** Record that Google authoritatively has no such pincode. Never blocks the
 *  caller, never throws. */
function rememberNegative(pincode: string): void {
  void negativeRedis
    .set(negativeKey(pincode), Date.now(), { ex: NEGATIVE_TTL_SECONDS })
    .catch((e: unknown) =>
      console.warn("[geocode] negative-cache write failed:", String(e)),
    );
}

/**
 * Drop the cached "no such pincode" verdicts for these pincodes.
 *
 * Call this whenever `service_areas` changes, because geocodePincode's fallback
 * leg (geocodeFromServiceAreas) reads that table — so admin activating an area
 * can make a pincode resolvable that Google alone could not, and a stale
 * negative would keep answering "we don't deliver there" after we started to.
 * The TTL above is only a backstop for the case nobody thought to invalidate.
 *
 * Wired into invalidateServiceAreas() in lib/service-areas.ts, which replaced
 * the bare revalidateTag(SERVICE_AREAS_TAG) calls precisely so these two
 * invalidations cannot drift apart.
 */
export async function dropNegativeGeocodes(
  pincodes: readonly string[],
): Promise<void> {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const p of pincodes) {
    if (!/^\d{6}$/.test(p) || seen.has(p)) continue;
    seen.add(p);
    keys.push(negativeKey(p));
  }
  if (keys.length === 0) return;
  try {
    await negativeRedis.del(...keys);
  } catch (e) {
    // Non-fatal: the TTL still expires the stale verdict within a week.
    console.warn("[geocode] negative-cache invalidation failed:", String(e));
  }
}

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

/**
 * Why this is a three-way result and not `T | null`.
 *
 * The negative cache may only record an answer Google is AUTHORITATIVE about.
 * ZERO_RESULTS means "there is no such postal code in India" — a fact, stable
 * enough to cache. Everything else that used to collapse into the same `null`
 * is a statement about US, not about the pincode: a missing API key, an HTTP
 * error, a thrown fetch, OVER_QUERY_LIMIT, REQUEST_DENIED.
 *
 * Caching those as negatives is how a cost fix becomes an outage: one Google
 * blip, or a deploy that forgets GOOGLE_MAPS_API_KEY, and we would persist
 * "unserviceable" for seven days for every pincode a customer happened to try
 * during it — and keep serving it long after Google recovered. `unavailable`
 * exists so that path writes nothing.
 */
type GoogleGeocodeOutcome =
  | { kind: "ok"; result: GoogleGeocodeResult }
  /** Google answered, authoritatively, that no such place exists. */
  | { kind: "zero_results" }
  /** We could not get an answer. Says nothing about the pincode. */
  | { kind: "unavailable"; detail: string };

async function callGoogle(
  params: { address?: string; components?: string },
): Promise<GoogleGeocodeOutcome> {
  const key = getApiKey();
  if (!key) {
    console.warn("[geocode] no Google Maps API key in env — skipping");
    return { kind: "unavailable", detail: "no_api_key" };
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
      return { kind: "unavailable", detail: `http_${r.status}` };
    }
    const json = (await r.json()) as GoogleGeocodeResponse;
    if (json.status === "ZERO_RESULTS") {
      return { kind: "zero_results" };
    }
    if (json.status !== "OK" || !json.results?.length) {
      console.warn("[geocode] status:", json.status);
      // Includes OVER_QUERY_LIMIT / REQUEST_DENIED / INVALID_REQUEST, and the
      // odd OK-with-empty-results. None of these are facts about the pincode.
      return { kind: "unavailable", detail: json.status || "empty_results" };
    }
    return { kind: "ok", result: json.results[0] };
  } catch (e) {
    console.warn("[geocode] fetch failed:", String(e));
    return { kind: "unavailable", detail: "fetch_failed" };
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
  // Unchanged behaviour: anything that is not a usable result is still null.
  // Only geocodePincode needs to tell the failure kinds apart.
  const outcome = await callGoogle({ address });
  if (outcome.kind !== "ok") return null;
  const { result } = outcome;
  if (!result.geometry?.location) return null;
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

/**
 * Geocode a customer pincode.
 *
 * Successes cache forever in pincode_geocache. Authoritative failures cache for
 * NEGATIVE_TTL_SECONDS in Redis — see the NEGATIVE GEOCODE CACHE block at the
 * top of this file.
 */
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

  // Negative cache hit → return NULL, exactly as this function already did
  // for an unresolvable pincode. We are skipping a billed call, not answering
  // the serviceability question differently.
  //
  // THE SENTINEL MUST NEVER BE COORDINATES. A (0,0) or similar in-band marker
  // would satisfy the `typeof === "number"` guard above, be handed back as a
  // real centroid, and then be fed to getDrivingDistanceKm — a SECOND billed
  // Google API — producing a distance from the Gulf of Guinea and a delivery
  // fee computed off it. That this is not hypothetical is visible at
  // api/delivery-quote/route.ts:51, which already guards
  // `!(lat === 0 && lng === 0)` on its GPS input: somebody has been bitten by
  // a (0,0) coordinate on this exact path before.
  //
  // Returning null keeps every downstream consumer on the path it already
  // takes for "we could not locate this": resolveServiceability() maps null to
  // { serviceable: false, reason: "no_match" }, and the three fee consumers
  // (lib/order-checkout.ts, api/delivery-quote, lib/subscription-delivery-fee)
  // all treat a null centroid as a refusal rather than a free delivery.
  if (await hasNegative(pincode)) {
    return null;
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
  const outcome = await callGoogle({
    components: `country:IN|postal_code:${pincode}`,
  });

  // Google couldn't resolve it (ZERO_RESULTS, an HTTP/network failure, or no
  // API key). Before giving up, check whether admin has already geocoded an
  // active area on this pincode — see geocodeFromServiceAreas for why that
  // read is guarded rather than trusted.
  const out =
    outcome.kind === "ok" && outcome.result.geometry?.location
      ? {
          latitude: outcome.result.geometry.location.lat,
          longitude: outcome.result.geometry.location.lng,
        }
      : await geocodeFromServiceAreas(pincode);

  if (!out) {
    // Only now do we know enough to cache a negative, and only for one of the
    // two reasons we can be here. BOTH conditions are required:
    //
    //   1. Google said ZERO_RESULTS — an authoritative "no such Indian postal
    //      code", not an outage, a bad key or a quota wall. An `unavailable`
    //      outcome writes nothing and is simply re-tried next request, which
    //      is the pre-existing behaviour.
    //   2. geocodeFromServiceAreas also found nothing, so no active admin area
    //      can locate it either. If it had, we would not be in this branch.
    //
    // Condition 2 is why dropNegativeGeocodes exists: a later admin write can
    // change that second answer, and the cached verdict has to go with it.
    if (outcome.kind === "zero_results") {
      rememberNegative(pincode);
    }
    return null;
  }

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
