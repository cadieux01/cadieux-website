import { MetadataRoute } from "next";
import { BLOG_POSTS, PRODUCTS } from "@/lib/data";
import { getActiveProducts } from "@/lib/products";
import { toUrlSlug } from "@/lib/product-slugs";
import { getServiceAreaGroups } from "@/lib/service-areas";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://www.cadieux.in";

  // Static pages — lastModified omitted intentionally. Google accepts an
  // absent lastmod (and treats present-but-stale/fabricated dates as a
  // trust signal to ignore). Only the pages below with a RELIABLE source
  // of truth (product updated_at, blog post.date) carry a real lastmod.
  const staticPages: MetadataRoute.Sitemap = [
    { url: `${baseUrl}/`,                    changeFrequency: "weekly",  priority: 1.0 },
    { url: `${baseUrl}/behind-cadieux`,      changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/store-locator`,       changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/making`,              changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/find-us`,             changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/connect`,             changeFrequency: "monthly", priority: 0.6 },
    { url: `${baseUrl}/feedback`,            changeFrequency: "weekly",  priority: 0.6 },
    { url: `${baseUrl}/subscriptions/setup`, changeFrequency: "monthly", priority: 0.7 },
    { url: `${baseUrl}/refunds`,             changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/shipping`,            changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/cookies`,             changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/delete-account`,      changeFrequency: "monthly", priority: 0.5 },
    { url: `${baseUrl}/terms`,               changeFrequency: "yearly",  priority: 0.3 },
    { url: `${baseUrl}/privacy-policy`,      changeFrequency: "yearly",  priority: 0.3 },
  ];

  // Dynamic product PDPs — pulled from the live `products` table so any
  // admin-created slug (is_active=true, is_archived=false) appears here
  // without a deploy. Falls back to the bundled PRODUCTS[] slugs when
  // Supabase is unreachable so the sitemap never loses its two shipped
  // product URLs.
  //
  // The DB stores the INTERNAL slug (`high-protein`, `multigrain`); we
  // map each one through toUrlSlug() so the sitemap emits the canonical
  // URL slug (`plain-protein-bread`, `multigrain-protein-bread`) —
  // matching what canonical + Google-indexed URLs return post-Prompt-5.
  // Unaliased DB slugs (future admin-created products) pass through
  // unchanged so their `/shop/<db-slug>` URL keeps working.
  const activeProducts = await getActiveProducts();
  const productPages: MetadataRoute.Sitemap =
    activeProducts.length > 0
      ? activeProducts.map((p) => ({
          url: `${baseUrl}/shop/${toUrlSlug(p.slug)}`,
          lastModified: new Date(p.updated_at),
          changeFrequency: "monthly" as const,
          priority: 0.9,
        }))
      : PRODUCTS.map((p) => ({
          // Fallback branch (Supabase unreachable): omit lastModified
          // rather than fabricate a date. The URL still ships.
          url: `${baseUrl}/shop/${toUrlSlug(p.slug)}`,
          changeFrequency: "monthly" as const,
          priority: 0.9,
        }));

  // Listing pages — /shop and /subscribe both key off the products table
  // (price / availability); /blogs keys off the latest post.date. Reuse
  // the same MAX() the product/blog loops compute below so listing pages
  // move whenever their underlying content moves.
  const productsMaxUpdated =
    activeProducts.length > 0
      ? new Date(
          activeProducts.reduce(
            (max, p) => (p.updated_at > max ? p.updated_at : max),
            activeProducts[0].updated_at,
          ),
        )
      : undefined;
  const blogsMaxDate =
    BLOG_POSTS.length > 0
      ? BLOG_POSTS.reduce((max, p) => (p.date > max ? p.date : max), BLOG_POSTS[0].date)
      : undefined;
  const listingPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/shop`,
      ...(productsMaxUpdated ? { lastModified: productsMaxUpdated } : {}),
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/subscribe`,
      ...(productsMaxUpdated ? { lastModified: productsMaxUpdated } : {}),
      changeFrequency: "monthly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/blogs`,
      ...(blogsMaxDate ? { lastModified: blogsMaxDate } : {}),
      changeFrequency: "weekly",
      priority: 0.8,
    },
  ];

  // Dynamic blog posts — post.date is the reliable source of truth.
  const blogPages: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${baseUrl}/blogs/${post.slug}`,
    lastModified: post.date,
    changeFrequency: "monthly" as const,
    priority: post.tier === 4 ? 0.7 : 0.6,
  }));

  // Dynamic /delivery/[area] pages — one entry per row in
  // public.service_areas with a populated slug (Prompt 8). lastModified
  // omitted: the table has no updated_at column, so any date here would
  // be fabricated. Empty array when Supabase is unreachable so the
  // sitemap degrades cleanly rather than emitting broken URLs.
  const areaGroups = await getServiceAreaGroups();
  const deliveryPages: MetadataRoute.Sitemap = areaGroups.map((g) => ({
    url: `${baseUrl}/delivery/${g.slug}`,
    changeFrequency: "monthly" as const,
    priority: 0.7,
  }));

  return [...staticPages, ...listingPages, ...productPages, ...deliveryPages, ...blogPages];
}
