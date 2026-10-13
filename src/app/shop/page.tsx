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
import { getPageContent, pickProductTitle, pickString } from "@/lib/content";
import { getSubscriptionPlans } from "@/lib/subscription-plans";
import { getSandwichKitchenState } from "@/lib/sandwich-kitchen";
import { proteinPerLoafGrams } from "@/lib/stat-tiles";
import type { ProductMedia } from "@/lib/data";

import ShopListClient, {
  type ShopContentBySlug,
  type ShopSubscribeBySlug,
} from "./ShopListClient";

const SITE_URL = "https://www.cadieux.in";

// Which slugs this page pulls CONTENT for. Must list every slug the grid can
// render — a missing entry leaves that tile with no name, tag or stat strip.
// The grid itself is driven by the bundled PRODUCTS array filtered against
// live availability (see ShopListClient), not by this list.
const SLUGS = [
  "multigrain",
  "high-protein",
  "burger-bun",
  "pizza-base",
  // Listed before they are active. This fetches CONTENT, not tiles — the grid
  // is PRODUCTS filtered against live availability, so these two stay off the
  // page until their rows are flipped active, and listing them here early
  // only means the content is ready the moment they are.
  "multigrain-bun",
  "multigrain-pizza-base",
] as const;

export const metadata: Metadata = {
  title: "Shop Protein Bread & Burger Buns | Cadieux",
  description:
    "Premium high-protein bread and burger buns, baked fresh in Visakhapatnam. Choose your delivery day and slot across Vizag.",
  alternates: { canonical: "/shop" },
};

// ISR window for this page. PINNED, not inherited — and the value is the one
// it already resolves to today, so this changes no behaviour.
//
// Why state it at all: every tile's baking-days state is computed from
// `products.available_from` + `product_open_dates` against TODAY
// (productOpenSet in lib/product-availability), so this page's HTML carries a
// date-dependent answer. It goes wrong when the CLOCK crosses a start date or
// an open day, not when any row changes — which means the page cache, not the
// data cache, is what bounds how long a stale "Out of stock / Baking days"
// badge can be served.
//
// Next derives a route's revalidate from the SMALLEST nested cache. Today
// that is getSandwichKitchenState's 10 s unstable_cache, awaited in the root
// layout (lib/sandwich-kitchen.ts) — nothing on this page at all. The
// products cache is 60 s. So deleting that one unrelated layout call would
// silently stretch this page's stale window from 10 s to 60 s, with no
// failing build and nothing to review. This export is the ceiling that stops
// it.
//
// It IS a ceiling and not an override: the effective value is
// min(this, smallest nested cache), verified by building at 7 (page went to
// 7) and at 20 (page stayed at 10, i.e. the layout's number still won). So
// raising this number cannot make the page staler, and lowering it works.
// 10 matches today's inherited value, which is why nothing moves now — the
// export only becomes load-bearing on the day the layout's number rises.
export const revalidate = 10;

export default async function ShopPage() {
  const availability = await getProductAvailability();
  // Sandwich kitchen switch drives the extra tile after the three products.
  // Read server-side so the grid ships with the tile either present or not —
  // never a hydration flash.
  const sandwichKitchen = await getSandwichKitchenState();
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
  // Live DB product name per slug. The tile heading is the same `pdp.title`
  // the PDP <h1> resolves, so it has to be resolved the same way or the grid
  // and the product page would print two different names for one product.
  const nameBySlug: Record<string, string> = {};
  for (const p of products) {
    priceBySlug[p.slug] = p.price_inr;
    nameBySlug[p.slug] = p.name;
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
      title: pickProductTitle(c, slug, nameBySlug[slug]),
      // Printed unconditionally. There used to be a `preorder ? "" : …`
      // suppression here, to stop an app-only pre-order announcement living
      // in this row from being printed in the product's voice slot. It keyed
      // on whether the product HAS a schedule and never looked at the value,
      // so it also blanked three genuine product subtitles. The dated copy is
      // gone from the data instead — see migration 20261013150000.
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
        showSandwich={sandwichKitchen.enabled}
      />
    </>
  );
}
