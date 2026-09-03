// Match a subscription to GPS coordinates.
//
// subscriptions.delivery_address is a text/jsonb blob with NO lat/lng.
// public.addresses, keyed by customer_id, DOES carry latitude/longitude.
// So to pin a subscription on a map we look up that customer's saved
// addresses and pick the best match:
//
//   1. the row whose line1 + pincode match the subscription's address,
//   2. else the customer's default address,
//   3. else the first row.
//
// Coordinates are only returned when BOTH are finite and non-zero — a
// stored (0,0) is the "never geocoded" sentinel, not a real location.
// Callers fall back to an address-text Maps search when this returns null.

export type AddressCoordRow = {
  line1?: string | null;
  pincode?: string | null;
  is_default?: boolean | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type SubscriptionAddressLike = {
  line1: string | null;
  pincode: string | null;
};

function norm(v: unknown): string {
  return String(v ?? "").trim().toLowerCase();
}

function validCoords(
  lat: number | null | undefined,
  lng: number | null | undefined,
): { latitude: number; longitude: number } | null {
  if (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    !(lat === 0 && lng === 0)
  ) {
    return { latitude: lat, longitude: lng };
  }
  return null;
}

/**
 * Returns the best-matching non-zero coordinates for a subscription, or
 * null when no saved address has usable ones.
 */
export function matchSubscriptionCoordinates(
  addresses: AddressCoordRow[] | null | undefined,
  subAddress: SubscriptionAddressLike,
): { latitude: number; longitude: number } | null {
  if (!addresses || addresses.length === 0) return null;

  // 1. line1 + pincode match.
  const wantLine1 = norm(subAddress.line1);
  const wantPin = norm(subAddress.pincode);
  if (wantLine1 && wantPin) {
    const exact = addresses.find(
      (a) => norm(a.line1) === wantLine1 && norm(a.pincode) === wantPin,
    );
    if (exact) {
      const c = validCoords(exact.latitude, exact.longitude);
      if (c) return c;
    }
  }

  // 2. default address.
  const def = addresses.find((a) => a.is_default);
  if (def) {
    const c = validCoords(def.latitude, def.longitude);
    if (c) return c;
  }

  // 3. first row with usable coords.
  for (const a of addresses) {
    const c = validCoords(a.latitude, a.longitude);
    if (c) return c;
  }

  return null;
}
