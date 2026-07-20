// Server component. Fetches live product availability + content
// (PageContent per slug from the new content_strings system) and
// hands them down. Hides archived rows, badges OOS items. Falls back
// to bundled PRODUCTS values + critical fallbacks if Supabase is dark.

import type { Metadata } from "next";
import { getActiveProducts, getProductAvailability } from "@/lib/products";
import { getPageContent, pickString } from "@/lib/content";

import ShopListClient, { type ShopContentBySlug } from "./ShopListClient";

const SLUGS = ["multigrain", "high-protein"] as const;

export const metadata: Metadata = {
  title: "Shop Protein Bread — Multigrain & High Protein | Cadieux",
  description:
    "Shop Cadieux protein bread online — high protein and multigrain loaves, baked fresh in Visakhapatnam with same-day delivery across Vizag.",
  alternates: { canonical: "/shop" },
};

export default async function ShopPage() {
  const availability = await getProductAvailability();
  // Live DB price per slug — single source of truth for the catalogue.
  const products = await getActiveProducts();
  const priceBySlug: Record<string, number> = {};
  for (const p of products) priceBySlug[p.slug] = p.price_inr;

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
    };
  });

  return (
    <ShopListClient
      availability={availability}
      priceBySlug={priceBySlug}
      contentBySlug={contentBySlug}
    />
  );
}
