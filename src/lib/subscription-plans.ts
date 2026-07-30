// Shared reader for the "which products are on the subscription wizard"
// catalogue. Extracted from src/app/api/subscription-plans/route.ts so
// server components (currently /subscribe) can call it directly without
// going through an internal fetch to the API route.
//
// Both the API route and the SSR /subscribe page share the same cached
// helper here, which means:
//   • one Supabase query per revalidate window, not two.
//   • one shared cache tag ("subscription-plans") that busts both the
//     wizard preview AND the SEO landing when admin writes.
//
// Data policy is unchanged from the old inline helper:
//   • price === subscriptionUnitPrice(row) — derived from MRP × (1 −
//     discount%). Vestigial `subscription_per_loaf_inr` is ignored.
//   • title/blurb fall back to SETUP_PRODUCTS entries by slug, then to
//     `name` / "" so new admin-flagged plans still surface.
//   • On any DB error → empty list. Callers must degrade gracefully
//     (wizard falls back to SETUP_PRODUCTS; /subscribe omits price copy).

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

import { SETUP_PRODUCTS } from "@/lib/subscription-setup";
import {
  subscriptionUnitPrice,
  subscriptionDiscountPct,
  subscriptionSavingsInr,
} from "@/lib/subscription-pricing";

export const SUBSCRIPTION_PLANS_TAG = "subscription-plans";

// Slug widened to `string` — DB-catalogued plans can carry slugs the
// literal `ProductSlug` union doesn't know about. Wizard merges by slug
// string so this stays type-safe at the call site.
export type SubscriptionPlanDTO = {
  slug: string;
  name: string;
  title: string;
  price: number;
  blurb: string;
  mrp_inr: number;
  subscription_discount_pct: number;
  subscription_savings_inr: number;
};

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Hardcoded SETUP_PRODUCTS now acts purely as a per-slug fallback for
// title/blurb when the DB row hasn't populated them yet. New plans
// added via the admin UI MUST set their own title/blurb (the form
// requires it) so this map only ever matters for the seeded pair.
const FALLBACK_META: Record<string, { title: string; blurb: string }> =
  SETUP_PRODUCTS.reduce(
    (acc, p) => {
      acc[p.slug] = { title: p.title, blurb: p.blurb };
      return acc;
    },
    {} as Record<string, { title: string; blurb: string }>,
  );

const getSubscriptionPlansCached = unstable_cache(
  async (): Promise<SubscriptionPlanDTO[]> => {
    const { data, error } = await supabaseAnon
      .from("products")
      .select(
        "slug, name, price_inr, subscription_per_loaf_inr, subscription_discount_pct, is_active, is_archived, in_stock, sort_order, is_subscription_plan, subscription_title, subscription_blurb",
      )
      .eq("is_active", true)
      .eq("is_archived", false)
      .eq("in_stock", true)
      .eq("is_subscription_plan", true)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[subscription-plans] fetch failed:", error.message);
      return [];
    }

    const out: SubscriptionPlanDTO[] = [];
    for (const row of data ?? []) {
      const slug = row.slug as string;
      const subPrice = subscriptionUnitPrice(row);
      if (typeof subPrice !== "number" || subPrice <= 0) continue;
      const mrp = Number(row.price_inr) || 0;
      const fallback = FALLBACK_META[slug];
      const title =
        typeof row.subscription_title === "string" &&
        row.subscription_title.trim().length > 0
          ? row.subscription_title.trim()
          : (fallback?.title ?? row.name);
      const blurb =
        typeof row.subscription_blurb === "string" &&
        row.subscription_blurb.trim().length > 0
          ? row.subscription_blurb.trim()
          : (fallback?.blurb ?? "");
      out.push({
        slug,
        name: row.name,
        title,
        price: subPrice,
        blurb,
        mrp_inr: mrp,
        subscription_discount_pct: subscriptionDiscountPct(row),
        subscription_savings_inr: subscriptionSavingsInr(row),
      });
    }
    return out;
  },
  ["subscription-plans-v2"],
  { revalidate: 60, tags: [SUBSCRIPTION_PLANS_TAG] },
);

/** Public accessor. Cached 60s, tag-busted by admin product writes. */
export async function getSubscriptionPlans(): Promise<SubscriptionPlanDTO[]> {
  return getSubscriptionPlansCached();
}
