// Server-side subscription pricing registry.
//
// A subscription's grand total is a function of three inputs:
//   1. plan      — which bread the customer signed up for (the only field
//                  that determines per-loaf price);
//   2. qty       — loaves per delivery;
//   3. deliveryCount — total number of (non-skipped) deliveries the wizard
//                  produced for the chosen weeks × days.
//
// The wizard surfaces (1) as a slug-typed selection and computes (2) × (3)
// on the client. To prevent a tampered client from rewriting the per-loaf
// price (and therefore the order total), the API route MUST look the
// per-loaf price up here — never from the request body — and recompute the
// grand total before insert.
//
// Keep this file in sync with SETUP_PRODUCTS in lib/subscription-setup.ts
// and with the products table in Supabase. If a price changes, update all
// three.

export type SubscriptionPlanId = "multigrain" | "high-protein";

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  name: string;
  pricePerLoafInr: number;
};

export const SUBSCRIPTION_PLANS: Record<SubscriptionPlanId, SubscriptionPlan> = {
  multigrain: {
    id: "multigrain",
    name: "Multi-Grain High Protein Bread",
    pricePerLoafInr: 135,
  },
  "high-protein": {
    id: "high-protein",
    name: "High Protein Bread",
    pricePerLoafInr: 99,
  },
};

/** Look up a plan by id. Returns null for unknown ids so callers can
 *  return a 400 rather than throwing. */
export function getSubscriptionPlan(
  id: string | null | undefined,
): SubscriptionPlan | null {
  if (!id) return null;
  return (SUBSCRIPTION_PLANS as Record<string, SubscriptionPlan>)[id] ?? null;
}

/**
 * Compute the authoritative subscription grand total.
 *
 *   total = pricePerLoaf × qty × deliveryCount
 *
 * Returns null when the plan id is unknown — callers should surface this
 * as a 400 with a "unknown subscription plan" message. All inputs are
 * coerced via Number; non-finite/non-positive values are rejected.
 */
export function getServerPrice(
  planId: string | null | undefined,
  qty: number,
  deliveryCount: number,
): number | null {
  const plan = getSubscriptionPlan(planId);
  if (!plan) return null;
  const q = Number(qty);
  const d = Number(deliveryCount);
  if (!Number.isFinite(q) || q <= 0) return null;
  if (!Number.isFinite(d) || d <= 0) return null;
  return plan.pricePerLoafInr * q * d;
}
