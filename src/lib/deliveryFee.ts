/**
 * Delivery fee logic (server-authoritative).
 *
 * TWO BANDS, by measured distance:
 *
 *        km < 5     → ₹15
 *      5 ≤ km ≤ 30  → ₹30
 *          km > 30  → not serviceable
 *
 * Pickup is ₹0 and never reaches this function — prepareOneTimeOrder short-
 * circuits before any distance is measured.
 *
 * This replaces the three-band 15/25/32 ladder (Raja, 29 Sep 2026). Three
 * deliberate details:
 *
 * 1. The boundary is BAND_1_MAX_KM = 5 and it is STRICT, so exactly 5.00 km
 *    pays ₹30. "Below 5 km" is the spec; `<` is what implements it.
 *
 * 2. The serviceability cutoff SURVIVES at MAX_DELIVERY_KM = 30. The two
 *    bands describe what we charge INSIDE the service area, not whether an
 *    address is in it. Dropping the cutoff would make every address on
 *    earth serviceable for ₹30 — and the poisoned-geocode rows make that
 *    concrete rather than theoretical: 18 distinct pincodes (including
 *    Hyderabad's 500004) resolve to one Vizag city-centre coordinate, so a
 *    Hyderabad order would measure ~8 km and be accepted. `geocode.ts`
 *    rejects those coordinates, and this cutoff is the second layer.
 *
 * 3. Distance is compared RAW — no Math.ceil. Rounding up is a price rise:
 *    4.2 km would be billed as 5, and a serviceable 29.4 km would round to
 *    30 while an out-of-range 30.1 rounds to 31. Bands are tested against
 *    what was actually measured.
 *
 * A non-finite or negative distance lands on `serviceable: false`. That is
 * the single most important property in this file: callers must never be
 * able to price off a distance we could not measure, because under a banded
 * fee the fallback would be the CHEAPEST band. Every comparison below is a
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
 *
 * WHAT THE DISTANCE IS MEASURED FROM changed in the same window: it is now
 * the single fixed P.M. Palem kitchen, not the nearest active pickup
 * location. See `lib/distanceMatrix.ts`.
 */
export const MAX_DELIVERY_KM = 30;

/** Top of band 1: below this many km the fee is ₹15. Deliberately NOT
 *  exported — this module is imported by client components, and every value
 *  exported from here ships in the browser bundle. Nothing outside this file
 *  needs the boundary; callers ask computeDeliveryFee for a fee. */
const BAND_1_MAX_KM = 5;

/** Top band. Also what an ADMIN OVERRIDE charges on an address that is out
 *  of range or whose distance could not be measured: those are the longest
 *  runs the rider makes, so the ceiling is the honest default and the
 *  cheaper band would be exactly the wrong guess. */
export const DELIVERY_FEE_TOP_BAND_INR = 30;

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
 *  Both rows must send delivery_fee EXPLICITLY. Since the 29 Sep 2026
 *  migration the column is NULLABLE with no default — it used to be
 *  NOT NULL DEFAULT 50, which silently charged ₹50 on an omitted key. The
 *  failure mode is now quieter, not gone: omit the key and the row stores
 *  NULL, which reads as "no fee recorded" on the admin screens and in any
 *  revenue sum. Send the number. Pickup groups send 0 on both rows.
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
  // is inclusive (`<=`), which is what puts exactly 5.0 km in band 2 —
  // matching the ruling "below 5 km → ₹15, 5 km and above → ₹30".
  if (distanceKm < BAND_1_MAX_KM) return { serviceable: true, feeInr: 15 };
  if (distanceKm <= MAX_DELIVERY_KM) {
    return { serviceable: true, feeInr: DELIVERY_FEE_TOP_BAND_INR };
  }
  return { serviceable: false, feeInr: 0 };
}

// ── Executable statement of intent ──────────────────────────────────
// The worked examples the ladder was agreed on, checked at module load in
// dev. They are here rather than in a test file because the repo has no test
// runner, and a pricing rule with no executable statement of intent is a rule
// that drifts: change a constant above and you find out here, immediately,
// instead of in a customer's bill.
//
// Every BOUNDARY is pinned, not just the middles — both sides of 5 and of
// 30 — because a boundary is the only thing a band edit can move silently.
// `null` means "refused" (serviceable: false); it is not a ₹0 price.
//
// 15.0 is in the list even though it is nowhere near a boundary: it was the
// old ladder's first boundary, so it is exactly the number a half-finished
// revert would put back. It must read ₹30 now.
//
// 30.01 is not in Raja's six but is pinned anyway — the >30 km refusal is
// the only thing keeping a poisoned Hyderabad coordinate out, and a list
// that stops at 30.0 would let the cutoff be deleted in silence.
//
// NOT exported, for the same reason BAND_1_MAX_KM is not: this module is
// imported by client components, so anything exported here can ship in the
// browser bundle.
const DELIVERY_FEE_EXAMPLES: ReadonlyArray<readonly [number, number | null]> = [
  [4.99, 15],
  [5.0, 30],
  [15.0, 30],
  [30.0, 30],
  [30.01, null],
  [NaN, null],
  [-1, null],
];

// DEV ONLY — must never throw in production.
//
// This runs at MODULE LOAD, and the module is on the checkout path. A throw
// here in production would not be a failed price check, it would be a dead
// checkout for every customer: the import fails, the route 500s, and nobody
// can buy anything. A pricing bug that overcharges is recoverable; a
// storefront that cannot take orders is not. So the loud failure is bought
// only where it is free — in dev, where a human is watching.
//
// Next inlines process.env.NODE_ENV at build time, so in a production build
// this whole block is dead code and is eliminated from both the server output
// and the client bundle.
if (process.env.NODE_ENV !== "production") {
  for (const [km, expected] of DELIVERY_FEE_EXAMPLES) {
    const { serviceable, feeInr } = computeDeliveryFee(km);
    const actual = serviceable ? feeInr : null;
    if (actual !== expected) {
      const show = (v: number | null) => (v === null ? "refused" : `₹${v}`);
      throw new Error(
        `[deliveryFee] bands broken: ${km} km should be ${show(expected)}, got ${show(actual)}`,
      );
    }
  }
}
