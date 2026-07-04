// Robots policy. Admin and API surfaces must not be indexed — they're
// gated by password/x-admin-token but search engines can still try to
// crawl them, which clutters indexes and tempts brute-force bots.
//
// Public pages (home, shop, subscriptions, blog) are crawlable.

import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/"],
        disallow: ["/admin", "/admin/", "/api/"],
      },
    ],
    sitemap: "https://www.cadieux.in/sitemap.xml",
  };
}
