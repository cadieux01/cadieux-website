/**
 * Delivery fee logic (server-authoritative).
 *
 * The fee is FLAT: ₹12 per delivery at every distance inside the service
 * area. The distance-banded ladder that used to live here (₹5 under half a
 * km rising to ₹212 at 20 km) is gone — distance no longer moves the price.
 *
 * Distance still decides SERVICEABILITY, and that gate is unchanged: the
 * driving distance rounds UP to the next whole km and anything past
 * MAX_DELIVERY_KM is refused. An address out of range is still rejected
 * exactly as before; it simply no longer carries a different fee on the way
 * in. A non-finite distance also lands on `serviceable: false`, same as the
 * old table's fall-through — callers must never price off a distance we
 * could not measure.
 *
 * `feeInr: 0` alongside `serviceable: false` is a sentinel, not a price.
 * Callers gate on `serviceable`. The only genuine ₹0 is pickup, decided by
 * the caller (prepareOneTimeOrder) before this function is ever reached.
 *
 * Pure function — no I/O, safe to import on client OR server. Single
 * source of truth: /api/delivery-quote (fee shown to customer) AND
 * prepareOneTimeOrder + /api/mobile/checkout|create-order (fee actually
 * charged) all call this — shown == charged by construction.
 */
export const MAX_DELIVERY_KM = 20;

/** The whole fee, every delivery, every distance inside the service area. */
export const DELIVERY_FEE_FLAT_INR = 12;

export function computeDeliveryFee(distanceKm: number): {
  serviceable: boolean;
  feeInr: number;
} {
  // Negated comparison, not `c > MAX_DELIVERY_KM`, so a NaN distance falls
  // out as unserviceable rather than sailing through as a ₹12 delivery.
  const c = Math.ceil(distanceKm);
  if (!(c <= MAX_DELIVERY_KM)) return { serviceable: false, feeInr: 0 };
  return { serviceable: true, feeInr: DELIVERY_FEE_FLAT_INR };
}
