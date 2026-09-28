/**
 * Delivery fee logic (server-authoritative).
 *
 * THREE BANDS, by measured distance:
 *
 *        km < 15.7   → ₹15
 *   15.7 ≤ km ≤ 25   → ₹25
 *     25 < km ≤ 30   → ₹32
 *          km > 30   → not serviceable
 *
 * This replaces the flat ₹12-at-any-distance fee. Two deliberate details:
 *
 * 1. The first boundary is 15.7 km, not 15.0, and it sits in EMPTY SPACE.
 *    Measured against the live pincode set, band 1 tops out at 530051
 *    (14.94 km) and band 2 opens at 530047 (16.43 km) — a 1.49 km gap with
 *    no pincode in it. 15.7 splits that gap, leaving ~0.75 km of margin on
 *    each side, so no existing pincode changes band and a small drift in
 *    Google's driving distance cannot silently re-price an address. Moving
 *    this number to a round 15.0 puts the line 0.06 km from a real pincode.
 *
 * 2. Distance is compared RAW — no Math.ceil. The old flat fee could round
 *    up harmlessly because every distance mapped to the same ₹12. With a
 *    ladder, rounding up is a price rise: 14.2 km would be billed as 15,
 *    and at the top end a serviceable 29.4 km would round to 30 while an
 *    out-of-range 30.1 rounds to 31. Bands are tested against what was
 *    actually measured.
 *
 * A non-finite or negative distance lands on `serviceable: false`. That is
 * the single most important property in this file: callers must never be
 * able to price off a distance we could not measure, because under a ladder
 * the fallback would be the CHEAPEST band. Every comparison below is a
 * positive test against an upper bound, so NaN fails all of them rather
 * than passing one.
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
export const MAX_DELIVERY_KM = 30;

/** Top band. Also what an ADMIN OVERRIDE charges on an address that is out
 *  of range or whose distance could not be measured: those are the longest
 *  runs the rider makes, so the ladder's ceiling is the honest default and
 *  the cheapest band would be exactly the wrong guess. */
export const DELIVERY_FEE_TOP_BAND_INR = 32;

/** How the delivery fee is apportioned when ONE payment produces TWO orders
 *  (mixed cart → OLF bread row + OLW sandwich row, per the OLF/OLW split
 *  plan). Two modes:
 *
 *    "per_order" — Each row carries its OWN banded fee. Both rows go to the
 *                  same address, so both land in the same band and the
 *                  customer pays that band twice. Two rider trips (bread on
 *                  its own slot, sandwich on its own same-day slot under
 *                  Option C), two fees. CURRENT — Sunny ruled 2026-09-23:
 *                  two trips means two fees.
 *
 *    "single"    — RETIRED 2026-09-23. ONE fee on the OLF row only, OLW
 *                  zero. That was two trips against one collected fee — a
 *                  margin choice, and the wrong one. The branch is kept so
 *                  the apportionment stays an explicit, named decision at
 *                  the call site rather than a bare constant; it is not a
 *                  mode to go back to without a reason.
 *
 *  Both rows must send delivery_fee EXPLICITLY. public.orders.delivery_fee
 *  is NOT NULL DEFAULT 50 — omit the key and the row silently takes ₹50,
 *  above even the top band this file charges. Pickup groups send 0 on both
 *  rows.
 *
 *  Read server-side only; a constant, not a DB flag, so a change is a
 *  deploy-visible audit event rather than a silent runtime flip. */
export const DELIVERY_FEE_SPLIT_MODE: "single" | "per_order" = "per_order";

export function computeDeliveryFee(distanceKm: number): {
  serviceable: boolean;
  feeInr: number;
} {
  // Reject before banding, so NaN / Infinity / a negative never reach the
  // comparisons at all.
  if (!Number.isFinite(distanceKm) || distanceKm < 0) {
    return { serviceable: false, feeInr: 0 };
  }
  // Ascending, first match wins. Band 1's bound is STRICT (`<`) and band 2's
  // is inclusive (`<=`), which is what puts exactly 15.7 km in band 2 —
  // matching the ruling "km < 15.7 → ₹15, 15.7 ≤ km ≤ 25 → ₹25".
  if (distanceKm < 15.7) return { serviceable: true, feeInr: 15 };
  if (distanceKm <= 25) return { serviceable: true, feeInr: 25 };
  if (distanceKm <= MAX_DELIVERY_KM) {
    return { serviceable: true, feeInr: DELIVERY_FEE_TOP_BAND_INR };
  }
  return { serviceable: false, feeInr: 0 };
}
