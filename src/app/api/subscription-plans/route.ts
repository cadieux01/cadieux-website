// /api/subscription-plans
//
// Public, cached reader the /subscriptions/setup wizard hits so its price
// preview tracks DB changes without a redeploy. Returns one row per active,
// unarchived, in-stock product flagged `is_subscription_plan=true`.
//
// As of Merge 4 the whitelist + title/blurb are DB-driven: admins toggle
// products onto the wizard via /admin/subscriptions/plans (which sets
// is_subscription_plan + subscription_title + subscription_blurb on the
// products row). SETUP_PRODUCTS in lib/subscription-setup.ts is now only
// a NETWORK-FALLBACK reference — its values are still served if a row's
// title/blurb is null AND its slug matches a hardcoded fallback entry.
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

import { SETUP_PRODUCTS } from "@/lib/subscription-setup";
import {
  subscriptionUnitPrice,
  subscriptionDiscountPct,
  subscriptionSavingsInr,
} from "@/lib/subscription-pricing";

// Slug is intentionally widened to plain `string` — once plans are
// catalogued in the DB, the API can return slugs the wizard's literal
// `ProductSlug` union doesn't know about. The wizard merges by slug
// string so this stays type-safe at the call site.
export type SubscriptionPlanDTO = {
  slug: string;
  name: string;
  title: string;
  // `price` = the DERIVED per-unit subscription price (MRP × (1 − disc%)).
  // Kept named `price` for back-compat with the existing wizard callers.
  price: number;
  blurb: string;
  // V10 additive fields — safe for older clients to ignore.
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

const getSubscriptionPlans = unstable_cache(
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
      console.error("[api/subscription-plans] fetch failed:", error.message);
      return [];
    }

    const out: SubscriptionPlanDTO[] = [];
    for (const row of data ?? []) {
      const slug = row.slug as string;
      // V10: subscription price is DERIVED from MRP × (1 − discount%).
      // The stored `subscription_per_loaf_inr` column is now vestigial —
      // the discount helper is the single source of truth so the wizard
      // preview matches what /api/checkout will validate.
      const subPrice = subscriptionUnitPrice(row);
      if (typeof subPrice !== "number" || subPrice <= 0) continue;
      const mrp = Number(row.price_inr) || 0;
      const fallback = FALLBACK_META[slug];
      // Prefer DB-supplied title/blurb. Fall back to the hardcoded SETUP
      // entry when present (for the seeded multigrain / high-protein
      // pair); else use the product name + empty blurb so newly-flagged
      // plans surface even before the admin enters wizard copy.
      const title =
        (typeof row.subscription_title === "string" &&
          row.subscription_title.trim().length > 0)
          ? row.subscription_title.trim()
          : fallback?.title ?? row.name;
      const blurb =
        (typeof row.subscription_blurb === "string" &&
          row.subscription_blurb.trim().length > 0)
          ? row.subscription_blurb.trim()
          : fallback?.blurb ?? "";
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
  { revalidate: 60, tags: ["subscription-plans"] },
);

export async function GET() {
  const plans = await getSubscriptionPlans();
  return NextResponse.json({ plans });
}
