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
import type { ProductMedia } from "@/lib/data";

import ShopListClient, { type ShopContentBySlug } from "./ShopListClient";

const SITE_URL = "https://www.cadieux.in";

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
  // Live DB image/gallery per slug — admin owns product photos from /admin
  // (products.image_url + products.gallery_urls). resolveProductMedia falls
  // back to the bundled editorial media (videos + images) when the admin
  // gallery is empty, so tiles never go blank and today's behaviour is kept.
  const mediaBySlug: Record<string, ProductMedia[]> = {};
  for (const p of products) {
    priceBySlug[p.slug] = p.price_inr;
    mediaBySlug[p.slug] = resolveProductMedia(p.slug, p.image_url, p.gallery_urls);
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
      />
    </>
  );
}
