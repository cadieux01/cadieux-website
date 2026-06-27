// /api/mobile/content
// Public-but-app-gated content reader for the mobile app. Returns the same
// PageContent shape used by the website's getPageContent. The app refreshes
// this on a cache pattern (memory + AsyncStorage, ~5min TTL).
//
// Query params:
//   page=pdp|shop|behind|making|story|reports
//   product_id=<slug>  (required when page=pdp|shop|reports for product scope)
//   locale=en|te|hi    (defaults to en)
//
// Auth: X-App-Key (friction layer; matches MOBILE_APP_KEY env var, same as
// the other /api/mobile/* routes). No phone bearer needed — content is
// public-rendering data.

import { NextRequest, NextResponse } from "next/server";

import { isValidMobileAppKey } from "@/lib/phone-cookie";
import { getPageContent, type ContentLocale, type Page } from "@/lib/content";

const PAGES: ReadonlySet<Page> = new Set<Page>([
  "pdp",
  "shop",
  "behind",
  "making",
  "story",
  "reports",
]);

const LOCALES: ReadonlySet<ContentLocale> = new Set<ContentLocale>([
  "en",
  "te",
  "hi",
]);

function isPage(v: string | null): v is Page {
  return v != null && PAGES.has(v as Page);
}
function isLocale(v: string | null): v is ContentLocale {
  return v != null && LOCALES.has(v as ContentLocale);
}

export async function GET(req: NextRequest) {
  if (!isValidMobileAppKey(req.headers.get("x-app-key"))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const page = url.searchParams.get("page");
  const productId = url.searchParams.get("product_id");
  const localeParam = url.searchParams.get("locale");

  if (!isPage(page)) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }
  const locale: ContentLocale = isLocale(localeParam) ? localeParam : "en";

  // Product scoping enforced for product-keyed pages.
  if ((page === "pdp" || page === "shop" || page === "reports") && !productId) {
    return NextResponse.json(
      { error: "product_id is required for this page" },
      { status: 400 },
    );
  }

  try {
    const content = await getPageContent({
      page,
      productId: productId ?? null,
      locale,
    });
    return NextResponse.json({ content });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Server error";
    console.error("[mobile/content GET]", msg);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
