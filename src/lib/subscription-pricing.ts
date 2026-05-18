// @deprecated — subscription pricing now lives in the products table
// (column `subscription_per_loaf_inr`) and is enforced server-side by
// /api/checkout?action=place_subscription via a direct Supabase lookup.
// The admin editor at /admin/products is the single source of truth.
//
// This file is kept only so that any stale `import type` references in
// older client code still resolve. The runtime constants and helper
// functions have been removed — anything that needs a subscription
// price must read the products row by slug.

export type SubscriptionPlanId = string;

export type SubscriptionPlan = {
  id: SubscriptionPlanId;
  name: string;
  pricePerLoafInr: number;
};
