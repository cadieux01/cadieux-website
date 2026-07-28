// Server entry for the product detail page. Looks up the slug in the
// live products table (is_active=true, is_archived=false) and surfaces
// an `outOfStock` flag. Now also reads PageContent (content_strings +
// stat_tiles + ingredients + app_reports) via getPageContent and hands
// it to the client. pickString applies critical-string fallbacks so
// the heading / SEO / section titles never go blank.

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PRODUCTS } from "@/lib/data";
import {
  getProductAvailability,
  getProductBySlug,
  resolveHeroImage,
  resolveProductMedia,
} from "@/lib/products";
import { getProductReports } from "@/lib/product-reports";
import { getProductIngredients } from "@/lib/ingredients";
import { getPageContent, pickString } from "@/lib/content";

import ProductDetailClient from "./ProductDetailClient";

const SITE_URL = "https://www.cadieux.in";

// JSON-LD requires absolute URLs. Product image_url may be a Supabase
// storage URL (already absolute) or a repo-relative path like "/hero.jpg";
// this normalises either form.
function toAbsoluteUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/")) return `${SITE_URL}${src}`;
  return `${SITE_URL}/${src}`;
}

// Extract a positive number of grams from a product_stat_tiles row like
// "7g", "7 g", "7.5g", "12". Returns null for placeholders ("—", "", "TBD")
// so callers fall through to generic titles. Values are admin-editable, so
// we cannot assume any specific format — regex is intentionally lenient.
function parseProteinGrams(
  tiles: ReadonlyArray<{ tile_key: string; value: string }>,
): number | null {
  const tile = tiles.find((t) => t.tile_key === "protein_per_slice");
  if (!tile || !tile.value) return null;
  const m = tile.value.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Dynamic metadata for product pages. Slug resolution is DB-first
// (products table) so admin-created products get their OG payload;
// bundled PRODUCTS[] is only consulted for legacy display fallbacks.
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const { slug } = params;
  const productRow = await getProductBySlug(slug);
  const bundled = PRODUCTS.find((p) => p.slug === slug);

  if (!productRow && !bundled) {
    return {
      title: "Product Not Found",
      description: "The product you're looking for is not available.",
    };
  }

  // Content-backed SEO with critical fallbacks (CRITICAL_FALLBACKS map
  // in lib/content.ts guarantees a non-empty title/description per slug).
  const content = await getPageContent({ page: "pdp", productId: slug });
  const baseTitle = pickString(content, "pdp.seo.title", slug);
  const baseDescription = pickString(content, "pdp.seo.description", slug);
  const ogName =
    pickString(content, "pdp.name", slug) || productRow?.name || bundled?.name || slug;
  const ogImage = resolveHeroImage(productRow?.image_url, slug);

  // Prefer a protein-forward SEO title when the stat tile is a real number.
  // Placeholder "—" or empty admin values → fall back to the content-string
  // title (already backed by CRITICAL_FALLBACKS per slug).
  const proteinG = parseProteinGrams(content.stat_tiles);
  const title = proteinG !== null
    ? `${ogName} — High Protein Bread | Cadieux`
    : baseTitle;
  const description = proteinG !== null
    ? `${ogName} — high-protein bread, slow-fermented and lab-tested. Order fresh delivery in Vizag.`
    : baseDescription;

  return {
    title,
    description,
    alternates: { canonical: `/shop/${slug}` },
    openGraph: {
      type: "website",
      url: `https://www.cadieux.in/shop/${slug}`,
      title,
      description,
      images: [
        {
          url: ogImage,
          width: 1200,
          height: 630,
          alt: ogName,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [ogImage],
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug } = params;

  // Slug resolution is admin-driven: an active, non-archived row in
  // public.products IS the allowlist. Deleted from bundled PRODUCTS or
  // never listed there — doesn't matter. If the DB says the slug is
  // live, we render. If not, 404. This is what lets a newly-created
  // admin product resolve without a deploy.
  const availability = await getProductAvailability();
  if (availability && !availability.listed.has(slug)) {
    notFound();
  }

  const outOfStock = availability?.outOfStock.has(slug) ?? false;

  // Live product row + lab reports + ingredients (DB) + content.
  const [productRow, ingredients, content] = await Promise.all([
    getProductBySlug(slug),
    getProductIngredients(slug),
    getPageContent({ page: "pdp", productId: slug }),
  ]);

  // Second gate: availability is best-effort (returns null on Supabase
  // outage → we degrade to "show everything"). If BOTH the DB row and
  // any bundled fallback are missing, this really is a bad URL — 404.
  const bundled = PRODUCTS.find((p) => p.slug === slug);
  if (!productRow && !bundled) {
    notFound();
  }

  const reports = productRow ? await getProductReports(productRow.id) : [];

  // Resolve PDP strings (with critical fallbacks per slug) here so the
  // client doesn't have to import lib/content (server-only Supabase).
  const pdpStrings = {
    name: pickString(content, "pdp.name", slug),
    tag: pickString(content, "pdp.tag", slug),
    title: pickString(content, "pdp.title", slug),
    subtitle: pickString(content, "pdp.subtitle", slug),
    description: pickString(content, "pdp.description", slug),
    aboutEyebrow: pickString(content, "pdp.section.about.eyebrow"),
    aboutTitle: pickString(content, "pdp.section.about.title"),
    reportsEyebrow: pickString(content, "pdp.section.reports.eyebrow"),
    reportsTitle: pickString(content, "pdp.section.reports.title"),
    trialsBanner: pickString(content, "compliance.trials_banner"),
    outOfStockBanner: pickString(content, "pdp.out_of_stock_banner"),
  };

  const heroImage = resolveHeroImage(productRow?.image_url, slug);
  const media = resolveProductMedia(
    slug,
    productRow?.image_url,
    productRow?.gallery_urls,
  );

  // Product JSON-LD — price + availability are live from public.products
  // (price_inr int NOT NULL, in_stock bool via getProductAvailability).
  // Skip the offers block entirely when no DB row is available (bundled-only
  // legacy fallback) or price is missing — better no schema than a null price.
  const productSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: pdpStrings.name,
    image: [toAbsoluteUrl(heroImage)],
    description:
      pickString(content, "pdp.seo.description", slug) ||
      pdpStrings.description,
    brand: { "@type": "Brand", name: "Cadieux" },
    sku: slug,
  };
  if (productRow?.price_inr) {
    productSchema.offers = {
      "@type": "Offer",
      url: `${SITE_URL}/shop/${slug}`,
      priceCurrency: "INR",
      price: productRow.price_inr,
      availability: outOfStock
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
    };
  }

  const breadcrumbSchema = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Shop", item: `${SITE_URL}/shop` },
      {
        "@type": "ListItem",
        position: 3,
        name: pdpStrings.name,
        item: `${SITE_URL}/shop/${slug}`,
      },
    ],
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(productSchema) }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbSchema) }}
      />
      <ProductDetailClient
        slug={slug}
        outOfStock={outOfStock}
        reports={reports}
        ingredients={ingredients}
        price={productRow?.price_inr ?? null}
        pdpStrings={pdpStrings}
        statTiles={content.stat_tiles}
        media={media}
        heroImage={heroImage}
      />
    </>
  );
}
