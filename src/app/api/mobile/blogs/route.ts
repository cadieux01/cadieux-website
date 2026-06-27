// /api/mobile/blogs
// Public list of published blog posts for the mobile app's Journal screen.
// Returns title + brief (as `summary`) only — full article body lives on the
// website at https://www.cadieux.in/blogs/<slug> and the app deep-links there.
//
// Source of truth: BLOG_POSTS in src/lib/data.ts (the same array the website
// renders at /blogs and /blogs/[slug]). The public.blog_posts Supabase table
// is currently empty and unused; if/when it becomes populated this route can
// be rewritten to read it without changing the response shape.
//
// Auth: X-App-Key (friction layer matching MOBILE_APP_KEY). No phone bearer —
// blog posts are public content. Same pattern as /api/mobile/content.
//
// Cache: unstable_cache tag 'blogs', revalidate 300s. Tag invalidation is a
// no-op today (data ships in the JS bundle) but keeps the shape ready for
// a future admin blog editor.

import { NextRequest, NextResponse } from "next/server";
import { unstable_cache } from "next/cache";

import { isValidMobileAppKey } from "@/lib/phone-cookie";
import { BLOG_POSTS } from "@/lib/data";

export type MobileBlogListItem = {
  slug: string;
  title: string;
  summary: string;
  cover_image_url: string | null;
  published_at: string;
};

const getBlogList = unstable_cache(
  async (): Promise<MobileBlogListItem[]> => {
    // BLOG_POSTS in data.ts is hand-ordered newest-first. The dates are
    // identical at the moment (all 2026-06-22), so a sort would not move
    // anything — preserve the editorial order from the source file.
    return BLOG_POSTS.map((p) => ({
      slug: p.slug,
      title: p.title,
      // `brief` on the website type is the same ~1-2 sentence summary the
      // website's BlogsClient renders under each card. Already plain text.
      summary: p.brief,
      // No cover image field exists on BLOG_POSTS today. Surface null so
      // the app can render a text-only card gracefully.
      cover_image_url: null,
      // `date` is a free-form string (e.g. "2026-06-22" today, "May 2026"
      // historically). The app treats it as opaque display text.
      published_at: p.date,
    }));
  },
  ["mobile-blogs-v1"],
  { revalidate: 300, tags: ["blogs"] },
);

export async function GET(req: NextRequest) {
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const blogs = await getBlogList();
  return NextResponse.json({ blogs });
}
