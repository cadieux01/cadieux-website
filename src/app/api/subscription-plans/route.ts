// /api/subscription-plans
//
// Public, cached reader the /subscriptions/setup wizard hits so its price
// preview tracks DB changes without a redeploy. Returns one row per active,
// unarchived, in-stock product that the wizard supports (slug must appear in
// SETUP_PRODUCTS — title/blurb are wizard-specific display strings kept in
// lib/subscription-setup.ts).
//
// price === subscription_per_loaf_inr (falls back to price_inr if not set).
// This is the same precedence the server-side place_subscription handler
// uses, so the wizard preview matches what /api/checkout will validate.
//
// Cache invalidation: tag "subscription-plans" — busted by every admin
// product write (see src/app/api/admin/products/* routes).
//
// On any failure (Supabase down, env missing), returns an empty list and a
// 200 status. Callers MUST fall back to SETUP_PRODUCTS so the wizard stays
// usable when the network is flaky.

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

import { SETUP_PRODUCTS, type ProductSlug } from "@/lib/subscription-setup";

export type SubscriptionPlanDTO = {
  slug: ProductSlug;
  name: string;
  title: string;
  price: number;
  blurb: string;
};

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

const WIZARD_META: Record<ProductSlug, { title: string; blurb: string }> =
  SETUP_PRODUCTS.reduce(
    (acc, p) => {
      acc[p.slug] = { title: p.title, blurb: p.blurb };
      return acc;
    },
    {} as Record<ProductSlug, { title: string; blurb: string }>,
  );

const getSubscriptionPlans = unstable_cache(
  async (): Promise<SubscriptionPlanDTO[]> => {
    const { data, error } = await supabaseAnon
      .from("products")
      .select(
        "slug, name, price_inr, subscription_per_loaf_inr, is_active, is_archived, in_stock, sort_order",
      )
      .eq("is_active", true)
      .eq("is_archived", false)
      .eq("in_stock", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[api/subscription-plans] fetch failed:", error.message);
      return [];
    }

    const out: SubscriptionPlanDTO[] = [];
    for (const row of data ?? []) {
      const slug = row.slug as string;
      if (!(slug in WIZARD_META)) continue;
      const subPrice = row.subscription_per_loaf_inr ?? row.price_inr;
      if (typeof subPrice !== "number" || subPrice <= 0) continue;
      const meta = WIZARD_META[slug as ProductSlug];
      out.push({
        slug: slug as ProductSlug,
        name: row.name,
        title: meta.title,
        price: subPrice,
        blurb: meta.blurb,
      });
    }
    return out;
  },
  ["subscription-plans-v1"],
  { revalidate: 60, tags: ["subscription-plans"] },
);

export async function GET() {
  const plans = await getSubscriptionPlans();
  return NextResponse.json({ plans });
}
