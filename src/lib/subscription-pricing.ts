// Subscription pricing — the SINGLE SOURCE OF TRUTH for the per-unit
// subscription price of a product.
//
// V10 model: the admin editor sets the one-time MRP (`price_inr`) and a
// per-product `subscription_discount_pct` (default 10). The subscription
// price is DERIVED from those two — admins no longer type a raw sub price.
// Every read path (wizard preview, mobile endpoints) and every server-side
// validation (checkout `place_subscription`, mobile subscriptions POST)
// MUST run through `subscriptionUnitPrice` so the preview a customer sees
// always equals the amount the server will reconcile against.
//
// Existing subscriptions are NOT affected by discount edits: their bills
// are snapshot-locked in subscription_items.price_snapshot_inr at signup.

export type SubscriptionPlanId = string;

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  name: string;
  pricePerLoafInr: number;
};

// Minimal shape the helper needs. Accepts a full products row or any
// object exposing the MRP + discount columns.
export type PricingInput = {
  price_inr?: number | string | null;
  subscription_discount_pct?: number | string | null;
};

function clamp(n: number, lo: number, hi: number): number {
  if (!Number.isFinite(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/** Round to 2 decimal places (paisa precision). */
export function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/** The effective per-unit subscription discount %, clamped to [0, 100].
 *  Missing/invalid → 0 (no discount) so we never silently over-discount. */
export function subscriptionDiscountPct(p: PricingInput): number {
  const raw = Number(p.subscription_discount_pct ?? 0);
  return clamp(raw, 0, 100);
}

/** DERIVED per-unit subscription price = MRP × (1 − discount%/100), to the
 *  paisa. This is the ONLY place the sub price is computed. Returns 0 when
 *  the MRP is missing/invalid so callers can guard on `<= 0`. */
export function subscriptionUnitPrice(p: PricingInput): number {
  const mrp = Number(p.price_inr ?? 0);
  if (!Number.isFinite(mrp) || mrp <= 0) return 0;
  const disc = subscriptionDiscountPct(p);
  return round2(mrp * (1 - disc / 100));
}

/** Per-unit rupee saving vs the one-time MRP (never negative). */
export function subscriptionSavingsInr(p: PricingInput): number {
  const mrp = Number(p.price_inr ?? 0);
  if (!Number.isFinite(mrp) || mrp <= 0) return 0;
  return round2(Math.max(0, mrp - subscriptionUnitPrice(p)));
}
