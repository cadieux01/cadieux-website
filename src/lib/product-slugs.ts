// Bidirectional mapping between URL-facing product slugs (the canonical,
// SEO-visible form) and internal slugs used by every DB read
// (public.products.slug), the bundled PRODUCTS / PRODUCT_DETAILS tables,
// product_stat_tiles seeds, content_strings keys (`pdp.*::<slug>`), the
// admin content editor, subscription-setup fallbacks, and review-scope
// keys in `public.reviews`.
//
// Prompts 4+5 (SEO) renamed the URLs to keyword-rich variants without
// touching any of the internal keying above — a full DB rename would
// require rewriting every seed, RLS policy, review row, admin tool
// entry, and mobile-app cached slug. The URL layer (dynamic [slug]
// route, sitemap, canonical, share link, breadcrumb items, ProductTile
// hrefs) uses the URL slug; every downstream lookup uses the internal
// slug returned by `resolveInternalSlug`. Old URLs are 301'd to the
// new URLs in next.config.js so this map never sees the old strings.
//
// Any URL param not in the URL_TO_INTERNAL map returns null →
// callers 404. That preserves the existing behaviour where an
// unknown slug is `notFound()` rather than a silent fallback.

import type { ProductSlug } from "@/lib/data";

const URL_TO_INTERNAL: Record<string, ProductSlug> = {
  "plain-protein-bread": "high-protein",
  "multigrain-protein-bread": "multigrain",
};

const INTERNAL_TO_URL: Record<ProductSlug, string> = {
  "high-protein": "plain-protein-bread",
  "multigrain": "multigrain-protein-bread",
};

// Resolve a URL slug (from the [slug] route param or a Link target)
// into the internal slug used by every DB / content / bundled lookup.
// Returns null when the param does not match a known product — the
// [slug] page then falls through to `notFound()`.
export function resolveInternalSlug(urlSlug: string): ProductSlug | null {
  return URL_TO_INTERNAL[urlSlug] ?? null;
}

// Reverse map — convert an internal slug (from products.slug,
// PRODUCTS[].slug, or a subscription_plans row) into the URL slug for
// use in an <a href>, canonical, breadcrumb link, or sitemap entry.
// For any slug that isn't in the URL map (e.g. a new admin-created
// product without an alias yet) we return the input unchanged so the
// link still resolves. This means new admin products keep working
// under `/shop/<their-db-slug>` until an alias is added here.
export function toUrlSlug(internalSlug: string): string {
  return INTERNAL_TO_URL[internalSlug as ProductSlug] ?? internalSlug;
}

// Enumerated list of the URL slugs — handy for generateStaticParams
// or any code that needs to iterate the public product URLs.
export const PRODUCT_URL_SLUGS: readonly string[] = Object.keys(URL_TO_INTERNAL);
