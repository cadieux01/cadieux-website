// Client-safe helpers for the "nearest from typed area" sort, shared by
// /admin/orders and /admin/subscriptions. All pure — zero Supabase
// imports so it can be pulled into a client component without dragging
// server-only modules into the browser bundle.
//
// Precision model:
//   'gps'      — the row has its own latitude/longitude (share-location
//                capture on checkout for orders; a matched saved address
//                for subscriptions). Exact within GPS accuracy.
//   'pincode'  — no coordinates, but a 6-digit pincode we have in
//                pincode_geocache. Distance is *approximate* — the
//                pincode centroid, not the doorstep. Two rows on the
//                same pincode tie.
//   'none'     — neither. Goes last, grouped, order-neutral.
//
// The sort is a display sort — it never writes back. This is why we
// never call Distance Matrix here: we would burn API credit on a
// 177-row sort that only needs relative ordering, and driving distance
// and haversine agree to within a few percent on the intra-city
// distances we care about at 5am.

import { haversineKm } from "@/lib/haversine";

export type DistancePrecision = "gps" | "pincode" | "none";

export type DistanceInfo = {
  km: number | null;
  precision: DistancePrecision;
};

export type Anchor = {
  latitude: number;
  longitude: number;
  /** Human label shown in the strip: "MVP Colony (530017)". */
  label: string;
};

/** An anchor that came back from /api/admin/areas/resolve, carrying how
 *  it was matched so the chip can say so. Lives here rather than in
 *  AreaSortControl because the URL codec below round-trips it and both
 *  boards parse it before any component renders. */
export type ResolvedArea = Anchor & { matched_via: string };

/**
 * WHERE A ROW IS, reduced to the only two things distance needs.
 *
 * This deliberately does NOT take the row itself. The orders board keeps
 * its address as one free-text string and has to regex a pincode out of
 * it; subscriptions keep theirs as a jsonb object that already holds the
 * pincode in its own field. Typing the parameter as "the row" would have
 * forced one of those two shapes onto the other — and applying the regex
 * heuristic to a structured field that already holds the answer is a
 * worse answer arrived at more expensively.
 *
 * So each board supplies its own locator (orderLocation /
 * subscriptionLocation) and the arithmetic below stays board-agnostic.
 */
export type Locatable = {
  latitude?: number | null;
  longitude?: number | null;
  pincode?: string | null;
};

/** Any 6-digit block, first digit 1-9 (Indian pincode format). We
 *  return the LAST match in the address because customers habitually
 *  put the pincode near the end. This is a heuristic, not a guarantee —
 *  a stray "530017" appearing in a flat number would be picked up too,
 *  which is why the caller labels these rows 'approximate'. */
const PINCODE_RE = /\b([1-9]\d{5})\b/g;

export function extractPincode(address: string | null | undefined): string | null {
  if (!address) return null;
  const matches = address.match(PINCODE_RE);
  if (!matches || matches.length === 0) return null;
  return matches[matches.length - 1] ?? null;
}

/** Orders: one free-text delivery_address, pincode extracted by regex. */
export function orderLocation(order: {
  latitude?: number | null;
  longitude?: number | null;
  delivery_address?: string | null;
}): Locatable {
  return {
    latitude: order.latitude,
    longitude: order.longitude,
    pincode: extractPincode(order.delivery_address ?? null),
  };
}

/**
 * Subscriptions: coordinates are attached server-side by
 * matchSubscriptionCoordinates and only on ?enrich=1 — without that flag
 * every row reads as 'pincode' at best.
 *
 * The `customer_pincode` fallback is the flat snapshot the original
 * wizard wrote before the `delivery_address` jsonb existed; rows from
 * that era carry no jsonb at all. Same pair, same precedence, as the
 * route uses when it matches the coordinates in the first place.
 */
export function subscriptionLocation(sub: {
  latitude?: number | null;
  longitude?: number | null;
  delivery_address?: { pincode?: string | null } | null;
  customer_pincode?: string | null;
}): Locatable {
  return {
    latitude: sub.latitude,
    longitude: sub.longitude,
    pincode: sub.delivery_address?.pincode ?? sub.customer_pincode ?? null,
  };
}

function coerce(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { latitude: number; longitude: number } | null {
  if (
    typeof lat !== "number" ||
    typeof lng !== "number" ||
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    (lat === 0 && lng === 0)
  ) {
    return null;
  }
  return { latitude: lat, longitude: lng };
}

/** Distance from anchor to one located row, using GPS if present,
 *  else the pincode centroid, else null. */
export function distanceFrom(
  loc: Locatable,
  anchor: Anchor,
  pincodeCoords: Map<string, { latitude: number; longitude: number }>,
): DistanceInfo {
  const gps = coerce(loc.latitude, loc.longitude);
  if (gps) {
    return { km: haversineKm(gps, anchor), precision: "gps" };
  }
  if (loc.pincode) {
    const c = pincodeCoords.get(loc.pincode);
    if (c) {
      return { km: haversineKm(c, anchor), precision: "pincode" };
    }
  }
  return { km: null, precision: "none" };
}

/** Stable-ish sort: nearest first, no-location last. Ties broken by
 *  created_at so the row order is deterministic between renders. */
export function sortByDistanceFromAnchor<T extends { created_at: string }>(
  rows: T[],
  anchor: Anchor,
  pincodeCoords: Map<string, { latitude: number; longitude: number }>,
  locate: (row: T) => Locatable,
): Array<T & { distance: DistanceInfo }> {
  const withDist = rows.map((r) => ({
    ...r,
    distance: distanceFrom(locate(r), anchor, pincodeCoords),
  }));

  withDist.sort((a, b) => {
    // 'none' always last; among 'none' rows, preserve created_at order.
    if (a.distance.precision === "none" && b.distance.precision !== "none") return 1;
    if (b.distance.precision === "none" && a.distance.precision !== "none") return -1;
    if (a.distance.precision === "none" && b.distance.precision === "none") {
      return b.created_at.localeCompare(a.created_at);
    }
    const aKm = a.distance.km ?? Number.POSITIVE_INFINITY;
    const bKm = b.distance.km ?? Number.POSITIVE_INFINITY;
    if (aKm !== bKm) return aKm - bKm;
    return b.created_at.localeCompare(a.created_at);
  });

  return withDist;
}

// ── the anchor's four URL params ──────────────────────────────────────────
// `area` / `area_lat` / `area_lng` / `area_via`, identical on both boards
// so the same link reads the same way on either. ALL FOUR are required: a
// partial anchor would name a sort with no way to compute a distance,
// which is how you get a board that claims to be sorted and is not.

export function parseAnchorParams(sp: URLSearchParams): ResolvedArea | null {
  const label = sp.get("area");
  const via = sp.get("area_via");
  const lat = Number(sp.get("area_lat"));
  const lng = Number(sp.get("area_lng"));
  if (!label || !via || !Number.isFinite(lat) || !Number.isFinite(lng)) {
    return null;
  }
  return { label, latitude: lat, longitude: lng, matched_via: via };
}

export function writeAnchorParams(
  params: URLSearchParams,
  anchor: ResolvedArea | null,
): void {
  if (!anchor) return;
  params.set("area", anchor.label);
  params.set("area_lat", String(anchor.latitude));
  params.set("area_lng", String(anchor.longitude));
  params.set("area_via", anchor.matched_via);
}
