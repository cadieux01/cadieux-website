import { MetadataRoute } from "next";
import { BLOG_POSTS } from "@/lib/data";

export default function sitemap(): MetadataRoute.Sitemap {
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
      url: `${baseUrl}/shop/multigrain`,
      lastModified: "2026-06-22",
      changeFrequency: "monthly",
      priority: 0.9,
    },
    {
      url: `${baseUrl}/shop/high-protein`,
      lastModified: "2026-06-22",
      changeFrequency: "monthly",
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

  return [...staticPages, ...blogPages];
}
