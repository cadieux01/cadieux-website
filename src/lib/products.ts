// Single source of truth for live product data (price, name, slug, weight,
// availability). Reads from Supabase `products` table so price/name changes
// don't require a deploy. Mirrors what the mobile app fetches via /api/mobile.
//
// Rich PDP content (ingredients, lab reports, media URLs) still lives in
// lib/data.ts — that content is editorial and bundled with deploys anyway.

import { createClient } from "@supabase/supabase-js";
import { unstable_cache } from "next/cache";

import {
  PRODUCTS,
  PRODUCT_DETAILS,
  type ProductMedia,
  type ProductSlug,
} from "@/lib/data";

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
  updated_at: string;
  // Regulatory label fields — free-form multiline. Rendered on the PDP
  // beneath the description as separate sections; empty/null hides.
  ingredients: string | null;
  allergens: string | null;
  // Per-slice nutrition JSONB. Open-ended shape; canonical keys are
  // protein_g / carbs_g / fat_g / fibre_g / sugar_g / calories, but
  // custom keys are allowed and preserved by admin edits.
  nutrition_per_slice: Record<string, number> | null;
  slices_per_loaf: number | null;
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
        "id, slug, name, price_inr, weight, description, tagline, highlights, image_url, gallery_urls, is_active, in_stock, sort_order, updated_at, ingredients, allergens, nutrition_per_slice, slices_per_loaf",
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

// ── image / media resolution (DB-first, hardcoded fallback) ──────────────────
// Single source of truth for turning a product row's admin-owned image
// fields into what the storefront renders. The admin writes products.image_url
// (main) + products.gallery_urls (gallery) from /admin; these resolvers prefer
// those and fall back to the bundled lib/data.ts assets so an image NEVER goes
// blank. Fallbacks are logged server-side so a missing admin image is visible
// in the logs. Video has no DB column, so it only ever comes from the bundled
// PRODUCT_DETAILS media (below) — never from the DB.

const OG_FALLBACK_IMAGE = "/hero.jpg";

// Resolve the main / hero / OG image with a DB-first fallback chain:
//   products.image_url (admin) → bundled PRODUCTS[].image → /hero.jpg.
export function resolveHeroImage(
  imageUrl: string | null | undefined,
  slug: string,
): string {
  const trimmed = (imageUrl ?? "").trim();
  if (trimmed) return trimmed;
  const bundled = PRODUCTS.find((p) => p.slug === slug)?.image;
  if (bundled) {
    console.info(
      `[lib/products] hero image fallback → bundled asset for "${slug}" (products.image_url empty)`,
    );
    return bundled;
  }
  console.info(
    `[lib/products] hero image fallback → brand default for "${slug}" (no bundled image)`,
  );
  return OG_FALLBACK_IMAGE;
}

// Companion to resolveHeroImage: true iff the DB row has a real admin-uploaded
// product photo. When false, resolveHeroImage falls through to a decorative
// bundled asset (e.g. /grains.jpg, /hero.jpg) that is NOT a photo of the
// actual product — safe to render on the page and pass to OG scrapers, but
// NOT safe to claim as `image` in the Product JSON-LD (Google will treat a
// mismatched decorative image as the canonical product photo). Callers that
// emit schema.image should gate on this and OMIT the field when false.
export function hasRealProductImage(
  imageUrl: string | null | undefined,
): boolean {
  return typeof imageUrl === "string" && imageUrl.trim().length > 0;
}

// Build the PDP / shop-tile media gallery, DB-first:
//   1. products.gallery_urls (admin) non-empty → these image tiles ARE the
//      gallery (Sunny owns product photos from /admin).
//   2. bundled PRODUCT_DETAILS[slug].media — editorial videos + images.
//   3. a single tile derived from the resolved hero image.
// An empty admin gallery never yields an empty gallery — it falls through to
// the bundled media (today's exact behaviour), so shipped editorial videos
// stay until a gallery is uploaded. No live regression.
export function resolveProductMedia(
  slug: string,
  imageUrl: string | null | undefined,
  galleryUrls: string[] | null | undefined,
): ProductMedia[] {
  const bundledName = PRODUCTS.find((p) => p.slug === slug)?.name;
  const gallery = (galleryUrls ?? []).filter(
    (u) => typeof u === "string" && u.trim().length > 0,
  );
  if (gallery.length > 0) {
    return gallery.map((src, i) => ({
      type: "image",
      src,
      alt: bundledName ? `${bundledName} — ${i + 1}` : "Product image",
    }));
  }
  const bundled = PRODUCT_DETAILS[slug as ProductSlug]?.media;
  if (bundled && bundled.length > 0) {
    console.info(
      `[lib/products] gallery fallback → bundled media for "${slug}" (products.gallery_urls empty)`,
    );
    return bundled;
  }
  const heroImage = resolveHeroImage(imageUrl, slug);
  return [
    {
      type: "image",
      src: heroImage,
      alt: bundledName ? `${bundledName} — hero` : "Product image",
    },
  ];
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
