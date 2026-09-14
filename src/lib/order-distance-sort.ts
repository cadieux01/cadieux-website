// Client-safe helpers for the "nearest from typed area" sort on
// /admin/orders. All pure — zero Supabase imports so it can be pulled
// into a client component without dragging server-only modules into
// the browser bundle.
//
// Precision model:
//   'gps'      — order has its own latitude/longitude (share-location
//                capture on checkout, ~52 of 177 orders as of writing).
//                Distance is exact within GPS accuracy.
//   'pincode'  — order lacks GPS but its delivery_address contains a
//                6-digit pincode we have in pincode_geocache. Distance
//                is *approximate* — the pincode centroid, not the
//                doorstep. Two orders on the same pincode tie.
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

/** Compute distance from anchor to one order, using GPS if present,
 *  else the pincode centroid, else null. */
export function orderDistanceFrom(
  order: {
    latitude?: number | null;
    longitude?: number | null;
    delivery_address?: string | null;
  },
  anchor: Anchor,
  pincodeCoords: Map<string, { latitude: number; longitude: number }>,
): DistanceInfo {
  const gps = coerce(order.latitude, order.longitude);
  if (gps) {
    return { km: haversineKm(gps, anchor), precision: "gps" };
  }
  const pin = extractPincode(order.delivery_address ?? null);
  if (pin) {
    const c = pincodeCoords.get(pin);
    if (c) {
      return { km: haversineKm(c, anchor), precision: "pincode" };
    }
  }
  return { km: null, precision: "none" };
}

/** Stable-ish sort: nearest first, no-location last. Ties broken by
 *  the caller-supplied tieBreak (usually the order's created_at) so
 *  the row order is deterministic between renders. */
export function sortByDistanceFromAnchor<
  T extends {
    id: string;
    latitude?: number | null;
    longitude?: number | null;
    delivery_address?: string | null;
    created_at: string;
  },
>(
  orders: T[],
  anchor: Anchor,
  pincodeCoords: Map<string, { latitude: number; longitude: number }>,
): Array<T & { distance: DistanceInfo }> {
  const withDist = orders.map((o) => ({
    ...o,
    distance: orderDistanceFrom(o, anchor, pincodeCoords),
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
