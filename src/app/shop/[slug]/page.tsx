// Server entry for the product detail page.
//
// Two slugs travel through this file:
//   • `urlSlug`      — the [slug] route param, i.e. what appears in the
//     browser bar (`plain-protein-bread`, `multigrain-protein-bread`).
//     Used for canonical, OG url, breadcrumb item, and the JSON-LD
//     Offer.url. This is the SEO-visible form and the only slug the
//     external world ever sees post-Prompt-5.
//   • `internalSlug` — the DB / content key (`high-protein`, `multigrain`).
//     Used for every products-table lookup, PRODUCTS/PRODUCT_DETAILS
//     bundled fallback, content_strings key, product_stat_tiles fetch,
//     product_ingredients fetch, and review-scope key. Never changes
//     across the URL rename.
//
// If the URL slug does not resolve to an internal slug, we 404 — the
// old `/shop/high-protein` and `/shop/multigrain` paths never reach
// this route because next.config.js 301s them at the edge.

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PRODUCTS } from "@/lib/data";
import {
  getProductAvailability,
  getProductBySlug,
  hasRealProductImage,
  resolveHeroImage,
  resolveOgImage,
  resolveProductMedia,
} from "@/lib/products";
import { parseWeightGrams } from "@/lib/stat-tiles";
import { getProductReports } from "@/lib/product-reports";
import { getProductIngredients } from "@/lib/ingredients";
import { getPageContent, pickString } from "@/lib/content";
import { resolveInternalSlug } from "@/lib/product-slugs";

import ProductDetailClient from "./ProductDetailClient";
import { PDP_FAQS } from "./faqs";

const SITE_URL = "https://www.cadieux.in";

// JSON-LD requires absolute URLs. Product image_url may be a Supabase
// storage URL (already absolute) or a repo-relative path like "/hero.jpg";
// this normalises either form.
function toAbsoluteUrl(src: string): string {
  if (/^https?:\/\//i.test(src)) return src;
  if (src.startsWith("/")) return `${SITE_URL}${src}`;
  return `${SITE_URL}/${src}`;
}

// Dynamic metadata for product pages. Resolves the URL slug → internal
// slug for every DB / content lookup; keeps the URL slug for canonical
// + OG.url so social crawlers see the SEO-visible form only. Hero /
// gallery resolution now lives in @/lib/products (phase-2 DB image
// support) — this file only wires internalSlug into those helpers.
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const urlSlug = params.slug;
  const internalSlug = resolveInternalSlug(urlSlug);

  if (!internalSlug) {
    return {
      title: "Product Not Found",
      description: "The product you're looking for is not available.",
    };
  }

  const productRow = await getProductBySlug(internalSlug);
  const bundled = PRODUCTS.find((p) => p.slug === internalSlug);

  if (!productRow && !bundled) {
    return {
      title: "Product Not Found",
      description: "The product you're looking for is not available.",
    };
  }

  // Content-backed SEO with critical fallbacks (CRITICAL_FALLBACKS map
  // in lib/content.ts guarantees a non-empty title/description per
  // internal slug). No conditional protein-title branching — the
  // FSSAI-labelled figures aren't public yet, so a single stable
  // title per slug avoids leaking placeholder values into <title>.
  const content = await getPageContent({ page: "pdp", productId: internalSlug });
  const title = pickString(content, "pdp.seo.title", internalSlug);
  const description = pickString(content, "pdp.seo.description", internalSlug);
  const ogName =
    pickString(content, "pdp.name", internalSlug) || productRow?.name || bundled?.name || internalSlug;
  // OG card only — resolveOgImage is the one path allowed to fall back to the
  // decorative brand image, so a shared link never previews blank. The on-page
  // gallery and Product JSON-LD use resolveHeroImage/hasRealProductImage and
  // stay null when no admin photo exists.
  const ogImage = resolveOgImage(productRow?.image_url, internalSlug);

  return {
    title,
    description,
    alternates: { canonical: `/shop/${urlSlug}` },
    openGraph: {
      type: "website",
      url: `${SITE_URL}/shop/${urlSlug}`,
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
  const urlSlug = params.slug;
  const internalSlug = resolveInternalSlug(urlSlug);

  // Unknown URL slug → immediate 404. The old `/shop/high-protein` and
  // `/shop/multigrain` paths are 301'd in next.config.js and never
  // reach this route; anything else typed by hand is a genuine miss.
  if (!internalSlug) {
    notFound();
  }

  // Slug resolution is admin-driven: an active, non-archived row in
  // public.products IS the allowlist. If the DB says the internal slug
  // is live, we render. If not, 404. This is what lets a newly-created
  // admin product resolve without a deploy (once its URL slug is aliased
  // in @/lib/product-slugs).
  const availability = await getProductAvailability();
  if (availability && !availability.listed.has(internalSlug)) {
    notFound();
  }

  const outOfStock = availability?.outOfStock.has(internalSlug) ?? false;

  // Live product row + lab reports + ingredients (DB) + content — all
  // keyed on the INTERNAL slug (public.products.slug + content_strings).
  const [productRow, ingredients, content] = await Promise.all([
    getProductBySlug(internalSlug),
    getProductIngredients(internalSlug),
    getPageContent({ page: "pdp", productId: internalSlug }),
  ]);

  // Second gate: availability is best-effort (returns null on Supabase
  // outage → we degrade to "show everything"). If BOTH the DB row and
  // any bundled fallback are missing, this really is a bad URL — 404.
  const bundled = PRODUCTS.find((p) => p.slug === internalSlug);
  if (!productRow && !bundled) {
    notFound();
  }

  const reports = productRow ? await getProductReports(productRow.id) : [];

  // Resolve PDP strings (with critical fallbacks per internal slug) here
  // so the client doesn't have to import lib/content (server-only Supabase).
  const pdpStrings = {
    name: pickString(content, "pdp.name", internalSlug),
    tag: pickString(content, "pdp.tag", internalSlug),
    title: pickString(content, "pdp.title", internalSlug),
    subtitle: pickString(content, "pdp.subtitle", internalSlug),
    description: pickString(content, "pdp.description", internalSlug),
    aboutEyebrow: pickString(content, "pdp.section.about.eyebrow"),
    aboutTitle: pickString(content, "pdp.section.about.title"),
    reportsEyebrow: pickString(content, "pdp.section.reports.eyebrow"),
    reportsTitle: pickString(content, "pdp.section.reports.title"),
    trialsBanner: pickString(content, "compliance.trials_banner"),
    outOfStockBanner: pickString(content, "pdp.out_of_stock_banner"),
  };

  const heroImage = resolveHeroImage(productRow?.image_url, internalSlug);
  const media = resolveProductMedia(
    internalSlug,
    productRow?.image_url,
    productRow?.gallery_urls,
  );

  // Product JSON-LD — price + availability are live from public.products
  // (price_inr int NOT NULL, in_stock bool via getProductAvailability).
  // `url` + Offer.url are the CANONICAL, URL-slug form so Google links
  // the schema to the SEO-visible URL. Skip the offers block when no DB
  // row is available (bundled-only legacy fallback) or price is missing
  // — better no schema than a null price.
  //
  // NO aggregateRating field: we do not yet render individual reviews
  // in the initial HTML, and Google penalises rating markup that isn't
  // backed by visible reviews on the same page (Search Console flags
  // it as a manual action risk).
  const canonicalUrl = `${SITE_URL}/shop/${urlSlug}`;
  const productSchema: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Product",
    // Use pdp.title (keyword-rich, e.g. "Cadieux Multigrain Protein Bread")
    // rather than pdp.name (generic "Protein Bread" fallback) so Google's
    // product rich result reflects the on-page H1 and canonical URL slug.
    name: pdpStrings.title,
    description:
      pickString(content, "pdp.seo.description", internalSlug) ||
      pdpStrings.description,
    brand: { "@type": "Brand", name: "Cadieux" },
    sku: internalSlug,
    url: canonicalUrl,
  };
  // Only claim a product image in JSON-LD when an admin-uploaded photo
  // exists. heroImage is null in that case, so this also keeps the
  // decorative OG fallback out of the schema.
  if (heroImage && hasRealProductImage(productRow?.image_url)) {
    productSchema.image = [toAbsoluteUrl(heroImage)];
  }
  if (productRow?.price_inr) {
    productSchema.offers = {
      "@type": "Offer",
      url: canonicalUrl,
      priceCurrency: "INR",
      price: productRow.price_inr,
      // Search Console flags Offers without priceValidUntil. Rolling
      // annual expiry — bump when repricing or on next SEO sweep.
      priceValidUntil: "2027-03-31",
      availability: outOfStock
        ? "https://schema.org/OutOfStock"
        : "https://schema.org/InStock",
    };
  }
  // Physical loaf weight, read live from products.weight. Google treats
  // this as a food label, so it must match the row that feeds the on-page
  // stat strip and nutrition table — never a hardcoded number. Omitted
  // entirely when the weight is missing or not parseable to grams.
  const weightGrams = parseWeightGrams(productRow?.weight);
  if (weightGrams !== null) {
    productSchema.weight = {
      "@type": "QuantitativeValue",
      value: weightGrams,
      unitCode: "GRM",
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
        // Keyword-rich H1-matching label for the breadcrumb rich result.
        name: pdpStrings.title,
        item: canonicalUrl,
      },
    ],
  };

  // No FAQPage JSON-LD: Google deprecated FAQ rich results in May 2026
  // (feature switched off for ecommerce since Aug 2023), so the schema
  // renders nothing while forcing byte-identical drift maintenance
  // between schema.text and visible answers. The visible FAQ section
  // below is kept — it still has UX + on-page-content value.

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
        slug={internalSlug}
        urlSlug={urlSlug}
        outOfStock={outOfStock}
        reports={reports}
        ingredients={ingredients}
        price={productRow?.price_inr ?? null}
        pdpStrings={pdpStrings}
        statTiles={content.stat_tiles}
        media={media}
        heroImage={heroImage}
        faqs={PDP_FAQS}
        labelInfo={{
          ingredients: productRow?.ingredients ?? null,
          allergens: productRow?.allergens ?? null,
          nutritionPerSlice: productRow?.nutrition_per_slice ?? null,
          slicesPerLoaf: productRow?.slices_per_loaf ?? null,
        }}
      />
    </>
  );
}
