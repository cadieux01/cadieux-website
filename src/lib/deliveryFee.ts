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

/** How the delivery fee is apportioned when ONE payment produces TWO orders
 *  (mixed cart → OLF bread row + OLW sandwich row, per the OLF/OLW split
 *  plan). Two modes:
 *
 *    "per_order" — Each row carries its own DELIVERY_FEE_FLAT_INR. Two
 *                  rider trips (bread on its own slot, sandwich on its own
 *                  same-day slot under Option C), two fees. CURRENT — Sunny
 *                  ruled 2026-09-23: two trips means two fees.
 *
 *    "single"    — RETIRED 2026-09-23. ONE fee on the OLF row only, OLW
 *                  zero. That was two trips against one collected fee — a
 *                  margin choice, and the wrong one. The branch is kept so
 *                  the apportionment stays an explicit, named decision at
 *                  the call site rather than a bare constant; it is not a
 *                  mode to go back to without a reason.
 *
 *  Both rows must send delivery_fee EXPLICITLY. public.orders.delivery_fee
 *  is NOT NULL DEFAULT 50 — omit the key and the row silently takes ₹50, a
 *  fee this file no longer charges at any distance. Pickup groups send 0 on
 *  both rows.
 *
 *  Read server-side only; a constant, not a DB flag, so a change is a
 *  deploy-visible audit event rather than a silent runtime flip. */
export const DELIVERY_FEE_SPLIT_MODE: "single" | "per_order" = "per_order";

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
