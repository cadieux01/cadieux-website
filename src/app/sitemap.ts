import { MetadataRoute } from "next";
import { BLOG_POSTS, PRODUCTS } from "@/lib/data";
import { getActiveProducts } from "@/lib/products";
import { toUrlSlug } from "@/lib/product-slugs";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = "https://www.cadieux.in";
  const today = new Date().toISOString().split("T")[0];

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: `${baseUrl}/`,
      lastModified: "2026-06-22",
      changeFrequency: "weekly",
      priority: 1.0,
    },
    {
      url: `${baseUrl}/shop`,
      lastModified: "2026-06-22",
      changeFrequency: "weekly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/blogs`,
      lastModified: today,
      changeFrequency: "weekly",
      priority: 0.8,
    },
    {
      url: `${baseUrl}/behind-cadieux`,
      lastModified: "2026-06-22",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/store-locator`,
      lastModified: "2026-06-22",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/making`,
      lastModified: "2026-06-22",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/find-us`,
      lastModified: "2026-06-22",
      changeFrequency: "monthly",
      priority: 0.6,
    },
    {
      url: `${baseUrl}/subscriptions/setup`,
      lastModified: "2026-06-22",
      changeFrequency: "monthly",
      priority: 0.7,
    },
    {
      url: `${baseUrl}/refunds`,
      lastModified: "2026-06-08",
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/shipping`,
      lastModified: "2026-06-08",
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/cookies`,
      lastModified: "2026-06-08",
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/delete-account`,
      lastModified: "2026-06-08",
      changeFrequency: "monthly",
      priority: 0.5,
    },
    {
      url: `${baseUrl}/terms`,
      lastModified: "2026-06-08",
      changeFrequency: "yearly",
      priority: 0.3,
    },
    {
      url: `${baseUrl}/privacy-policy`,
      lastModified: "2026-06-08",
      changeFrequency: "yearly",
      priority: 0.3,
    },
  ];

  // Dynamic blog posts
  const blogPages: MetadataRoute.Sitemap = BLOG_POSTS.map((post) => ({
    url: `${baseUrl}/blogs/${post.slug}`,
    lastModified: post.date,
    changeFrequency: "monthly" as const,
    priority: post.tier === 4 ? 0.7 : 0.6,
  }));

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
  const productSlugs =
    activeProducts.length > 0
      ? activeProducts.map((p) => p.slug)
      : PRODUCTS.map((p) => p.slug);
  const productPages: MetadataRoute.Sitemap = productSlugs.map((slug) => ({
    url: `${baseUrl}/shop/${toUrlSlug(slug)}`,
    lastModified: today,
    changeFrequency: "monthly" as const,
    priority: 0.9,
  }));

  return [...staticPages, ...productPages, ...blogPages];
}
