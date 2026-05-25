/**
 * Distance-based delivery fee logic (server-authoritative).
 *
 * Fee table — distance rounds UP to the next whole km:
 *   ≤ 3 km  → ₹22
 *    4 km   → ₹30
 *    5 km   → ₹42
 *    6 km   → ₹52
 *    7 km   → ₹62
 *    8 km   → ₹72
 *    9 km   → ₹82
 *   10 km   → ₹92
 *  > 10 km  → unserviceable
 *
 * Pure function — no I/O, safe to import on client OR server.
 */
export function computeDeliveryFee(distanceKm: number): {
  serviceable: boolean;
  feeInr: number;
} {
  const c = Math.ceil(distanceKm);
  if (c <= 3)   return { serviceable: true,  feeInr: 22 };
  if (c === 4)  return { serviceable: true,  feeInr: 30 };
  if (c === 5)  return { serviceable: true,  feeInr: 42 };
  if (c === 6)  return { serviceable: true,  feeInr: 52 };
  if (c === 7)  return { serviceable: true,  feeInr: 62 };
  if (c === 8)  return { serviceable: true,  feeInr: 72 };
  if (c === 9)  return { serviceable: true,  feeInr: 82 };
  if (c === 10) return { serviceable: true,  feeInr: 92 };
  return { serviceable: false, feeInr: 0 };
}
