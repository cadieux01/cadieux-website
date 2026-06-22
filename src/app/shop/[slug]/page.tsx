// Server entry for the product detail page. Looks up the slug in the
// live products table (filtered for is_active=true, is_archived=
// false) and surfaces an `outOfStock` flag to the client so the Add-
// to-Cart button can be disabled. Falls back to "everything live"
// when the DB read returns nothing so the PDP never 404s on a real
// product because of a transient Supabase outage.

import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { PRODUCTS, PRODUCT_DETAILS } from "@/lib/data";
import { getProductAvailability, getProductBySlug } from "@/lib/products";
import { getProductReports } from "@/lib/product-reports";

import ProductDetailClient from "./ProductDetailClient";

// Dynamic metadata for product pages
export async function generateMetadata({
  params,
}: {
  params: { slug: string };
}): Promise<Metadata> {
  const { slug } = params;
  const product = PRODUCTS.find((p) => p.slug === slug);
  const productRow = await getProductBySlug(slug);

  if (!product) {
    return {
      title: "Product Not Found",
      description: "The product you're looking for is not available.",
    };
  }

  const title =
    slug === "multigrain"
      ? "Cadieux Multi-Grain Bread | High Protein, Lab-Tested"
      : slug === "high-protein"
        ? "Cadieux Plain Bread | High Protein, Fresh Delivery"
        : `${product.name} | Cadieux`;

  const description =
    slug === "multigrain"
      ? "Cadieux Multi-Grain: Ancient grains with high protein and rich fibre. Lab-verified ingredients. Order fresh delivery in Vizag."
      : slug === "high-protein"
        ? "Cadieux Plain Bread: Clean, high-protein sandwich bread. Fresh-baked daily in Visakhapatnam. Perfect for every meal."
        : product.subtitle || product.desc;

  const price = productRow?.price_inr ?? product.price;

  return {
    title,
    description,
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
          alt: product.name,
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
    // Active products table says this slug is archived / inactive.
    notFound();
  }

  const outOfStock = availability?.outOfStock.has(slug) ?? false;

  // Fetch lab reports for this product (empty array if the products table
  // is unreachable or the slug isn't tracked in Supabase yet).
  const productRow = await getProductBySlug(slug);
  const reports = productRow ? await getProductReports(productRow.id) : [];

  return (
    <ProductDetailClient
      slug={slug}
      outOfStock={outOfStock}
      reports={reports}
      price={productRow?.price_inr ?? null}
    />
  );
}
