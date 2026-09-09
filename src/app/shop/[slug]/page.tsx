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
//     and review-scope key. Never changes across the URL rename.
//
// If the URL slug does not resolve to an internal slug, we 404 — the
// old `/shop/high-protein` and `/shop/multigrain` paths never reach
// this route because next.config.js 301s them at the edge.

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PRODUCTS } from "@/lib/data";
import {
  OG_FALLBACK_SIZE,
  getProductAvailability,
  getProductBySlug,
  hasRealProductImage,
  resolveHeroImage,
  resolveOgImage,
  resolveProductMedia,
} from "@/lib/products";
import { parseWeightGrams, proteinPerLoafGrams } from "@/lib/stat-tiles";
import { getProductReports } from "@/lib/product-reports";
import { getPageContent, pickString } from "@/lib/content";
import { resolveInternalSlug } from "@/lib/product-slugs";

import { getSubscriptionPlans } from "@/lib/subscription-plans";

import ProductDetailClient from "./ProductDetailClient";
import { PDP_FAQS } from "./faqs";

const SITE_URL = "https://www.cadieux.in";

// JSON-LD requires absolute URLs. Product image_url may be a Supabase
// storage URL (already absolute) or a repo-relative path like
// "/icons/icon-512.png"; this normalises either form.
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
  const baseDescription = pickString(content, "pdp.seo.description", internalSlug);
  const ogName =
    pickString(content, "pdp.name", internalSlug) || productRow?.name || bundled?.name || internalSlug;

  // Price for the OG description + product:price:* structured tags. Read live
  // from public.products.price_inr — same source as the on-page display and
  // the checkout, so a WhatsApp/FB preview can never quote a stale figure.
  //
  // NUTRITION FIGURES ARE DELIBERATELY OMITTED. protein per slice lives in
  // products.nutrition_per_slice.protein_g and is currently being corrected
  // in another branch; WhatsApp/Facebook cache OG payloads aggressively, so
  // a wrong number shared today would outlive the DB fix. Reintroduce with
  // a runtime read of nutrition_per_slice?.protein_g once corrected values
  // are live and cards are re-scraped.
  const priceInr =
    typeof productRow?.price_inr === "number" && Number.isFinite(productRow.price_inr)
      ? productRow.price_inr
      : null;
  const description = priceInr !== null
    ? `${baseDescription} ₹${priceInr} per loaf.`
    : baseDescription;
  // OG card only — resolveOgImage is the one path allowed to fall back to the
  // Cadieux logo, so a shared link never previews blank. The on-page gallery
  // and Product JSON-LD use resolveHeroImage/hasRealProductImage and stay null
  // when no admin photo exists.
  //
  // The declared dimensions must describe the image we actually sent: an admin
  // upload is a landscape product shot (1200x630), the logo fallback is square
  // (512x512). Declaring 1200x630 for a square file makes WhatsApp/Instagram
  // letterbox or crop the preview.
  const ogImage = resolveOgImage(productRow?.image_url, internalSlug);
  const ogIsProductPhoto = hasRealProductImage(productRow?.image_url);
  const ogWidth = ogIsProductPhoto ? 1200 : OG_FALLBACK_SIZE;
  const ogHeight = ogIsProductPhoto ? 630 : OG_FALLBACK_SIZE;

  return {
    title,
    description,
    alternates: { canonical: `/shop/${urlSlug}` },
    openGraph: {
      // og:type is deliberately OMITTED here — Next 14's OpenGraph.type
      // union does not include "product". The correct e-commerce value is
      // emitted as a raw <meta property="og:type" content="product"> in the
      // page body (see ProductDetailPage) so Facebook's OGP parser will
      // actually read the accompanying product:price:{amount,currency} +
      // product:brand tags, which it only honours under og:type=product.
      url: `${SITE_URL}/shop/${urlSlug}`,
      title,
      description,
      images: [
        {
          url: ogImage,
          width: ogWidth,
          height: ogHeight,
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
    // NB: product:brand + product:price:{amount,currency} are emitted in the
    // page body as raw <meta property="..."> tags. Next 14's Metadata.other
    // renders them as <meta name="..."> which Facebook's OGP parser accepts
    // laxly but is not the OGP-spec attribute; property= is the correct one
    // for a namespaced OG tag. See ProductDetailPage below.
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

  // Live product row + lab reports + content — all keyed on the INTERNAL
  // slug (public.products.slug + content_strings).
  const [productRow, content, subscriptionPlans] = await Promise.all([
    getProductBySlug(internalSlug),
    getPageContent({ page: "pdp", productId: internalSlug }),
    getSubscriptionPlans(),
  ]);

  // Derived subscribe price for THIS product, or null when it isn't a
  // subscription plan (or the read failed — getSubscriptionPlans returns []).
  // Same figure the wizard quotes and checkout revalidates.
  const subscriptionPlan =
    subscriptionPlans.find((p) => p.slug === internalSlug) ?? null;

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
  // Deliberately the ONE-TIME price, even for products that also sell on
  // subscription. Google reads Offer.price as the price a visitor can pay for
  // this URL right now; the subscribe figure is conditional on committing to a
  // recurring plan through the wizard, so publishing it here would risk a
  // rich-result mismatch against the visible page. One-time is the genuinely
  // purchasable price. Do not switch this to the derived subscribe price.
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

  // Product-flavoured OpenGraph tags, emitted inline so they render as
  // <meta property="..."> — the correct OGP attribute for a namespaced tag
  // (product:*, og:*). Next 14's Metadata.other emits <meta name="...">
  // which Facebook accepts leniently but is not spec-correct. WhatsApp,
  // FB, Instagram e-commerce previews key on product:price:{amount,currency}
  // and product:brand. Emitted only for the product page (not on /shop),
  // and amount is only added when we actually have a numeric DB price.
  const priceInrForPage =
    typeof productRow?.price_inr === "number" && Number.isFinite(productRow.price_inr)
      ? productRow.price_inr
      : null;

  return (
    <>
      {/* og:type=product is required for Facebook's OGP parser to honour the
          product:* namespace tags below. Emitted here (not in Metadata.openGraph)
          because Next 14's OpenGraph.type union does not include "product". */}
      <meta property="og:type" content="product" />
      <meta property="product:brand" content="Cadieux" />
      {priceInrForPage !== null ? (
        <>
          <meta property="product:price:amount" content={String(priceInrForPage)} />
          <meta property="product:price:currency" content="INR" />
        </>
      ) : null}
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
        price={productRow?.price_inr ?? null}
        subscribePrice={subscriptionPlan?.price ?? null}
        subscribeDiscountPct={subscriptionPlan?.subscription_discount_pct ?? null}
        proteinPerLoafG={productRow ? proteinPerLoafGrams(productRow) : null}
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
