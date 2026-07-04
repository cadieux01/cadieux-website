// Server entry for the product detail page. Looks up the slug in the
// live products table (is_active=true, is_archived=false) and surfaces
// an `outOfStock` flag. Now also reads PageContent (content_strings +
// stat_tiles + ingredients + app_reports) via getPageContent and hands
// it to the client. pickString applies critical-string fallbacks so
// the heading / SEO / section titles never go blank.

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PRODUCTS } from "@/lib/data";
import { getProductAvailability, getProductBySlug } from "@/lib/products";
import { getProductReports } from "@/lib/product-reports";
import { getProductIngredients } from "@/lib/ingredients";
import { getPageContent, pickString } from "@/lib/content";

import ProductDetailClient from "./ProductDetailClient";

// Dynamic metadata for product pages
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const { slug } = params;
  const product = PRODUCTS.find((p) => p.slug === slug);

  if (!product) {
    return {
      title: "Product Not Found",
      description: "The product you're looking for is not available.",
    };
  }

  // Content-backed SEO with critical fallbacks (CRITICAL_FALLBACKS map
  // in lib/content.ts guarantees a non-empty title/description per slug).
  const content = await getPageContent({ page: "pdp", productId: slug });
  const title = pickString(content, "pdp.seo.title", slug);
  const description = pickString(content, "pdp.seo.description", slug);
  const ogName = pickString(content, "pdp.name", slug) || product.name;

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
          url: product.image || "/hero.jpg",
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
      images: [product.image || "/hero.jpg"],
    },
  };
}

export default async function ProductDetailPage({
  params,
}: {
  params: { slug: string };
}) {
  const { slug } = params;
  if (!PRODUCTS.some((p) => p.slug === slug)) {
    notFound();
  }

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

  return (
    <ProductDetailClient
      slug={slug}
      outOfStock={outOfStock}
      reports={reports}
      ingredients={ingredients}
      price={productRow?.price_inr ?? null}
      pdpStrings={pdpStrings}
      statTiles={content.stat_tiles}
    />
  );
}
