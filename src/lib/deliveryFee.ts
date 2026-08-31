/**
 * Distance-based delivery fee logic (server-authoritative).
 *
 * Fee table — sub-1 km is banded on the RAW distance; from 1 km up the
 * distance rounds UP to the next whole km:
 *  < 0.5 km → ₹5
 *  < 1 km   → ₹10
 *   ≤ 3 km  → ₹22
 *    4 km   → ₹30
 *    5 km   → ₹42
 *    6 km   → ₹52
 *    7 km   → ₹62
 *    8 km   → ₹72
 *    9 km   → ₹82
 *   10 km   → ₹92
 *  11–20 km → ₹92 + (km − 10) × ₹12
 *              → 11:₹104, 12:₹116, 13:₹128, 14:₹140, 15:₹152,
 *                16:₹164, 17:₹176, 18:₹188, 19:₹200, 20:₹212
 *  > 20 km  → unserviceable
 *
 * The ≤10 km tiers are frozen — existing customers pay exactly what
 * they paid before this change. The 10→20 km extension charges the
 * outer band at a flat ₹12/km on top of the ₹92 base at 10 km. Whole
 * ₹1 arithmetic (12 × integer km) — no rounding style needed.
 *
 * Pure function — no I/O, safe to import on client OR server. Single
 * source of truth: /api/delivery-quote (fee shown to customer) AND
 * prepareOneTimeOrder + /api/mobile/checkout|create-order (fee actually
 * charged) all call this — shown == charged by construction.
 */
export const MAX_DELIVERY_KM = 20;

export function computeDeliveryFee(distanceKm: number): {
  serviceable: boolean;
  feeInr: number;
} {
  // Doorstep bands. Checked on the RAW distance before the ceil, because
  // rounding up would collapse everything under 1 km into the ≤3 km tier.
  if (distanceKm < 0.5) return { serviceable: true, feeInr: 5 };
  if (distanceKm < 1)   return { serviceable: true, feeInr: 10 };

  const c = Math.ceil(distanceKm);
  if (c <= 3)   return { serviceable: true,  feeInr: 22 };
  if (c === 4)  return { serviceable: true,  feeInr: 30 };
  if (c === 5)  return { serviceable: true,  feeInr: 42 };
  if (c === 6)  return { serviceable: true,  feeInr: 52 };
  if (c === 7)  return { serviceable: true,  feeInr: 62 };
  if (c === 8)  return { serviceable: true,  feeInr: 72 };
  if (c === 9)  return { serviceable: true,  feeInr: 82 };
  if (c === 10) return { serviceable: true,  feeInr: 92 };
  if (c <= MAX_DELIVERY_KM) {
    return { serviceable: true, feeInr: 92 + (c - 10) * 12 };
  }
  return { serviceable: false, feeInr: 0 };
}
