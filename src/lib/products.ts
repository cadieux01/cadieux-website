// Single source of truth for live product data (price, name, slug, weight,
// availability). Reads from Supabase `products` table so price/name changes
// don't require a deploy. Mirrors what the mobile app fetches via /api/mobile.
//
// Rich PDP content (ingredients, lab reports, media URLs) still lives in
// lib/data.ts — that content is editorial and bundled with deploys anyway.

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

export type ProductRow = {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  weight: string;
  description: string | null;
  tagline: string | null;
  highlights: string[];
  image_url: string | null;
  // Admin-curated PDP gallery (ordered). Empty array = no gallery set, in
  // which case the PDP falls back to bundled editorial media. Non-empty =
  // these images become the PDP gallery (admin owns product photos).
  gallery_urls: string[];
  is_active: boolean;
  in_stock: boolean;
  sort_order: number;
};

const supabaseAnon = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } },
);

// Cache 60s — balances freshness against Supabase read budget on the
// homepage / shop list. Tag-based revalidation hook is exposed for an
// eventual admin "publish prices" action.
export const getActiveProducts = unstable_cache(
  async (): Promise<ProductRow[]> => {
    const { data, error } = await supabaseAnon
      .from("products")
      .select(
        "id, slug, name, price_inr, weight, description, tagline, highlights, image_url, gallery_urls, is_active, in_stock, sort_order",
      )
      .eq("is_active", true)
      .eq("is_archived", false)
      .order("sort_order", { ascending: true });

    if (error) {
      console.error("[lib/products] fetch failed:", error);
      return [];
    }
    return data ?? [];
  },
  ["products-active"],
  { revalidate: 60, tags: ["products"] },
);

export async function getProductBySlug(slug: string): Promise<ProductRow | null> {
  const products = await getActiveProducts();
  return products.find((p) => p.slug === slug) ?? null;
}

// Lightweight availability map for the public shop. Returns null when
// the upstream fetch failed entirely so callers can degrade gracefully
// (show everything as live) instead of hiding the catalogue.
export type AvailabilityMap = {
  listed: Set<string>;
  outOfStock: Set<string>;
};

export async function getProductAvailability(): Promise<AvailabilityMap | null> {
  const products = await getActiveProducts();
  if (products.length === 0) return null;
  const listed = new Set<string>();
  const outOfStock = new Set<string>();
  for (const p of products) {
    listed.add(p.slug);
    if (!p.in_stock) outOfStock.add(p.slug);
  }
  return { listed, outOfStock };
}
