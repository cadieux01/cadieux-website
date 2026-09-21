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
import type { NutrientValue } from "@/lib/nutrition";
import { isVideoUrl } from "@/lib/product-media";
import {
  availabilityLine,
  preorderButtonNote,
  productFloor,
  type PreorderInfo,
} from "@/lib/product-availability";

export type { PreorderInfo };

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
  // Per-product delivery floor. NULL = no restriction. Distinct from
  // in_stock, which means "never sell" — a product with a floor is still
  // visible, browsable and sellable, it just cannot be DELIVERED before this
  // date. See lib/product-availability.ts.
  available_from: string | null;
  stock_message: string | null;
  sort_order: number;
  updated_at: string;
  // Regulatory label fields — free-form multiline. Rendered on the PDP
  // beneath the description as separate sections; empty/null hides.
  ingredients: string | null;
  allergens: string | null;
  // Per-slice nutrition JSONB. Open-ended shape; canonical keys are in
  // CANONICAL_NUTRIENT_KEYS, but custom keys are allowed and preserved by
  // admin edits. A value is a number, or a lower-bound string ("<0.04") for
  // a lab result reported as "less than" — see lib/nutrition.
  nutrition_per_slice: Record<string, NutrientValue> | null;
  slices_per_loaf: number | null;
  // Whether this product can be SUBSCRIBED to, as opposed to bought once.
  // Owned by the admin product form and already the filter behind the
  // subscription wizard's plan list; the PDP reads it so a one-time-only
  // product (burger buns) never offers a Subscribe tab. A new one-time
  // product needs no code change — just the flag off.
  is_subscription_plan: boolean;
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
        "id, slug, name, price_inr, weight, description, tagline, highlights, image_url, gallery_urls, is_active, in_stock, available_from, stock_message, sort_order, updated_at, ingredients, allergens, nutrition_per_slice, slices_per_loaf, is_subscription_plan",
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

// ── image / media resolution (DB-only) ──────────────────────────────────────
// Single source of truth for turning a product row's admin-owned image
// fields into what the storefront renders. The admin writes products.image_url
// (main) + products.gallery_urls (gallery) from /admin, and those are the ONLY
// sources of a product photo. There is deliberately no bundled-asset fallback:
// the old stock/AI bread-and-grain shots that used to fill this gap were not
// photos of the actual loaf, and showing them implied a product photo existed
// when it did not. A product with no admin image now resolves to null and the
// page renders its empty state. Video has no DB column, so it only ever comes
// from the bundled PRODUCT_DETAILS media (below) — never from the DB.

// Social-share preview ONLY. The Cadieux logo — real branding, never a stand-in
// photo of bread or ingredients. It is NOT a product photo and must never enter
// the product gallery or Product JSON-LD. Reachable only through
// resolveOgImage(); resolveHeroImage/resolveProductMedia cannot return it.
// Square: callers must declare 512x512, not the 1200x630 OG default.
export const OG_FALLBACK_IMAGE = "/icons/icon-512.png";
export const OG_FALLBACK_SIZE = 512;

// Resolve the product's primary photo. DB-only: products.image_url, or null.
// Callers must handle null by rendering a placeholder — NOT by substituting a
// bundled asset.
export function resolveHeroImage(
  imageUrl: string | null | undefined,
  slug: string,
): string | null {
  const trimmed = (imageUrl ?? "").trim();
  if (trimmed) return trimmed;
  console.info(
    `[lib/products] no product image for "${slug}" (products.image_url empty) — rendering empty state`,
  );
  return null;
}

// og:image for social scrapers. Prefers the real product photo and falls back
// to the Cadieux logo so a shared link is never previewed with a blank card —
// and never with a stock photo of bread the customer will not receive. Callers
// must pair this with hasRealProductImage() to pick the right declared
// dimensions. Kept separate from resolveHeroImage so the gallery can never
// pick this up.
export function resolveOgImage(
  imageUrl: string | null | undefined,
  slug: string,
): string {
  return resolveHeroImage(imageUrl, slug) ?? OG_FALLBACK_IMAGE;
}

// Companion to resolveHeroImage: true iff the DB row has a real admin-uploaded
// product photo. Callers that emit schema.image should gate on this and OMIT
// the field when false, so Google is never handed the decorative OG fallback
// as the canonical product photo.
export function hasRealProductImage(
  imageUrl: string | null | undefined,
): boolean {
  return typeof imageUrl === "string" && imageUrl.trim().length > 0;
}

// Build the PDP / shop-tile media gallery, DB-first:
//   1. products.gallery_urls (admin) non-empty → these image tiles ARE the
//      gallery (Sunny owns product photos from /admin).
//   2. bundled PRODUCT_DETAILS[slug].media — editorial videos + images.
//   3. a single tile derived from products.image_url.
// When all three are empty this returns an EMPTY array and the caller renders
// its empty state. It never substitutes a decorative brand asset — a tile
// showing a generic flour-and-wheat stock shot reads as "here is the loaf"
// when no photo exists.
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
      type: isVideoUrl(src) ? "video" : "image",
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
  if (!heroImage) return [];
  return [
    {
      type: "image",
      src: heroImage,
      alt: bundledName ? `${bundledName} — hero` : "Product image",
    },
  ];
}

// PDP-ONLY gallery list. Deliberately separate from resolveProductMedia:
// the shop LIST tiles keep their existing one-photo-per-card behaviour, and
// folding image_url into the shared helper would silently turn every tile
// into a two-photo carousel.
//
// The PDP shows the FULL set the admin has uploaded, main photo first:
// [image_url, ...gallery_urls]. These are two independent admin fields with
// no constraint keeping them disjoint — image_url is routinely also pasted
// into gallery_urls — so the list is de-duplicated by URL or the same photo
// renders twice and the dots claim an image that isn't there.
//
// Dedup is on the trimmed URL string. Storage keys are unique per upload, so
// two different keys are two different files even if the bytes are identical;
// re-uploading the same photo yields a new key and legitimately shows twice.
// That is an upload-hygiene problem, not something to paper over here.
//
// alt text comes from the caller's live DB product name, not the bundled
// PRODUCTS table, so a product that exists only in the DB still gets a real
// alt instead of "Product image".
export function resolvePdpGallery(
  productName: string | null | undefined,
  imageUrl: string | null | undefined,
  galleryUrls: string[] | null | undefined,
): ProductMedia[] {
  const urls = [imageUrl, ...(galleryUrls ?? [])]
    .map((u) => (typeof u === "string" ? u.trim() : ""))
    .filter((u) => u.length > 0);

  const seen = new Set<string>();
  const unique = urls.filter((u) => (seen.has(u) ? false : (seen.add(u), true)));

  const name = (productName ?? "").trim();
  return unique.map((src, i) => ({
    // The media type comes from the URL's extension — the upload route
    // stamps one on from the verified MIME. Hardcoding "image" here is what
    // sent admin-uploaded videos to next/image, whose optimizer 400s on a
    // video content-type and leaves a blank slide.
    type: isVideoUrl(src) ? "video" : "image",
    src,
    // Single-photo products get a plain product-name alt; numbering a list of
    // one reads as broken to a screen reader.
    alt: name
      ? unique.length > 1
        ? `${name} — photo ${i + 1} of ${unique.length}`
        : name
      : "Product image",
  }));
}

// Lightweight availability map for the public shop. Returns null when
// the upstream fetch failed entirely so callers can degrade gracefully
// (show everything as live) instead of hiding the catalogue.
export type AvailabilityMap = {
  listed: Set<string>;
  outOfStock: Set<string>;
  /** Slug → pre-order info, for products with a live delivery floor. A slug
   *  here is NOT out of stock: it is sellable, and the customer pre-orders
   *  it. Absent for everything unrestricted. */
  preorder: Map<string, PreorderInfo>;
};

export async function getProductAvailability(): Promise<AvailabilityMap | null> {
  const products = await getActiveProducts();
  if (products.length === 0) return null;
  const listed = new Set<string>();
  const outOfStock = new Set<string>();
  const preorder = new Map<string, PreorderInfo>();
  const now = new Date();
  for (const p of products) {
    listed.add(p.slug);
    if (!p.in_stock) outOfStock.add(p.slug);
    const floor = productFloor(p, now);
    if (floor) {
      preorder.set(p.slug, {
        date: floor,
        line: availabilityLine(p, now) ?? "",
        buttonNote: preorderButtonNote(p, now) ?? "",
      });
    }
  }
  return { listed, outOfStock, preorder };
}
