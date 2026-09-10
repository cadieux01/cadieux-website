// Server component. Fetches live product availability + content
// (PageContent per slug from the new content_strings system) and
// hands them down. Hides archived rows, badges OOS items. Falls back
// to bundled PRODUCTS values + critical fallbacks if Supabase is dark.

import type { Metadata } from "next";
import {
  getActiveProducts,
  getProductAvailability,
  resolveProductMedia,
} from "@/lib/products";
import { getPageContent, pickString } from "@/lib/content";
import { getSubscriptionPlans } from "@/lib/subscription-plans";
import { proteinPerLoafGrams } from "@/lib/stat-tiles";
import type { ProductMedia } from "@/lib/data";

import ShopListClient, {
  type ShopContentBySlug,
  type ShopSubscribeBySlug,
} from "./ShopListClient";

const SITE_URL = "https://www.cadieux.in";

const SLUGS = ["multigrain", "high-protein"] as const;

export const metadata: Metadata = {
  title: "Shop Protein Bread — Multigrain & High Protein | Cadieux",
  description:
    "Premium high-protein bread, baked fresh in Visakhapatnam. Choose your delivery day and slot across Vizag.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage() {
  const availability = await getProductAvailability();
  // Live DB price per slug — single source of truth for the catalogue.
  const products = await getActiveProducts();
  const priceBySlug: Record<string, number> = {};
  // Live DB image/gallery per slug — admin owns product photos from /admin
  // (products.image_url + products.gallery_urls). resolveProductMedia falls
  // back to the bundled editorial media (videos + images) when the admin
  // gallery is empty, so tiles never go blank and today's behaviour is kept.
  const mediaBySlug: Record<string, ProductMedia[]> = {};
  // Grams of protein per loaf — the denominator for the per-gram price under
  // each tile. Null for any product whose per-slice protein or slice count
  // is missing, and that tile then shows no per-gram line at all.
  const proteinPerLoafBySlug: Record<string, number | null> = {};
  for (const p of products) {
    priceBySlug[p.slug] = p.price_inr;
    mediaBySlug[p.slug] = resolveProductMedia(p.slug, p.image_url, p.gallery_urls);
    proteinPerLoafBySlug[p.slug] = proteinPerLoafGrams(p);
  }

  // Subscribe price per slug, resolved SERVER-side through the same cached
  // reader the wizard and /subscribe use, so the tile can never quote a
  // number the checkout would reject. Read here rather than fetched from
  // the client so the figure is in the first paint — a late client fetch
  // would pop the price line in after hydration.
  //
  // A slug is absent when it isn't flagged is_subscription_plan, or when the
  // DB read failed (getSubscriptionPlans returns [] on error). Both cases
  // land on the same safe outcome: the tile shows the one-time price alone.
  const subscribeBySlug: ShopSubscribeBySlug = {};
  for (const plan of await getSubscriptionPlans()) {
    subscribeBySlug[plan.slug] = {
      price: plan.price,
      discountPct: plan.subscription_discount_pct,
    };
  }

  // Content per slug (parallel). pickString applies critical fallbacks
  // so name/tag/subtitle are never empty.
  const contents = await Promise.all(
    SLUGS.map((slug) => getPageContent({ page: "shop", productId: slug })),
  );
  const contentBySlug: ShopContentBySlug = {};
  SLUGS.forEach((slug, i) => {
    const c = contents[i];
    contentBySlug[slug] = {
      name: pickString(c, "pdp.name", slug),
      tag: pickString(c, "pdp.tag", slug),
      title: pickString(c, "pdp.title", slug),
      subtitle: pickString(c, "pdp.subtitle", slug),
      // Same DB tiles the PDP renders (net weight + slices already read
      // through to the products row by getPageContent), so the grid can
      // never disagree with the product page.
      stats: c.stat_tiles.map((t) => ({
        id: t.id,
        value: t.value,
        label: t.label,
      })),
    };
  });

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Shop", item: `${SITE_URL}/shop` },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <ShopListClient
        availability={availability}
        priceBySlug={priceBySlug}
        mediaBySlug={mediaBySlug}
        contentBySlug={contentBySlug}
        subscribeBySlug={subscribeBySlug}
        proteinPerLoafBySlug={proteinPerLoafBySlug}
      />
    </>
  );
}
