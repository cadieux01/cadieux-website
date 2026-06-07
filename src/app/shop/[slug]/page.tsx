// Server entry for the product detail page. Looks up the slug in the
// live products table (filtered for is_active=true, is_archived=
// false) and surfaces an `outOfStock` flag to the client so the Add-
// to-Cart button can be disabled. Falls back to "everything live"
// when the DB read returns nothing so the PDP never 404s on a real
// product because of a transient Supabase outage.

import { notFound } from "next/navigation";

import { PRODUCTS } from "@/lib/data";
import { getProductAvailability, getProductBySlug } from "@/lib/products";
import { getProductReports } from "@/lib/product-reports";

import ProductDetailClient from "./ProductDetailClient";

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
