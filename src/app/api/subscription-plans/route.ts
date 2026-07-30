// /api/subscription-plans
//
// Public, cached reader the /subscriptions/setup wizard hits so its price
// preview tracks DB changes without a redeploy. Returns one row per active,
// unarchived, in-stock product flagged `is_subscription_plan=true`.
//
// The actual DB read + shape lives in src/lib/subscription-plans.ts so
// server components (see /subscribe) can call it directly without a
// wasteful internal fetch. This route is a thin wrapper — kept because
// the wizard is a client component and needs a JSON endpoint.
//
// Cache invalidation: tag "subscription-plans" — busted by every admin
// product write (see src/app/api/admin/products/* routes).
//
// On any failure (Supabase down, env missing), returns an empty list and
// a 200 status. Callers MUST fall back to SETUP_PRODUCTS so the wizard
// stays usable when the network is flaky.

import { NextResponse } from "next/server";

import { getSubscriptionPlans } from "@/lib/subscription-plans";

// Re-export the DTO type so existing importers of the old inline
// definition keep working with one less rename.
export type { SubscriptionPlanDTO } from "@/lib/subscription-plans";

export async function GET() {
  const plans = await getSubscriptionPlans();
  return NextResponse.json({ plans });
}
