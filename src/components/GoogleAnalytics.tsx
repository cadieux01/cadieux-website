"use client";

// GoogleAnalytics — GA4 (gtag.js) for the Cadieux Next.js App Router site.
//
// Loads gtag.js via next/script (afterInteractive) so it never blocks paint,
// and fires a manual `page_view` on every client-side route change. Next's
// App Router SPA navigation does NOT emit gtag pageviews on its own, so we
// listen to usePathname() + useSearchParams() and dispatch them ourselves.
//
// Guards:
//   * NEXT_PUBLIC_GA_MEASUREMENT_ID must be set — no ID, no script loaded.
//   * Only active in production (process.env.NODE_ENV === "production") so
//     localhost/dev builds do NOT pollute analytics.
//
// Mount once at the root layout. Safe on server (renders null when guarded).

import Script from "next/script";
import { usePathname, useSearchParams } from "next/navigation";
import { Suspense, useEffect } from "react";

const GA_ID = process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID;
const ENABLED =
  process.env.NODE_ENV === "production" && !!GA_ID && GA_ID.length > 0;

declare global {
  interface Window {
    // gtag.js sets these on the window during boot.
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
  }
}

// Inner component reads useSearchParams(), which requires a Suspense boundary
// under App Router. Split so the outer component can wrap it.
function RouteChangeTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  useEffect(() => {
    if (!ENABLED || !GA_ID || typeof window === "undefined") return;
    if (typeof window.gtag !== "function") return;
    const qs = searchParams?.toString();
    const page_path = qs ? `${pathname}?${qs}` : pathname;
    window.gtag("event", "page_view", {
      page_path,
      page_location: window.location.href,
      page_title: document.title,
      send_to: GA_ID,
    });
  }, [pathname, searchParams]);

  return null;
}

export default function GoogleAnalytics() {
  if (!ENABLED || !GA_ID) return null;

  return (
    <>
      <Script
        id="ga4-src"
        strategy="afterInteractive"
        src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
      />
      <Script id="ga4-init" strategy="afterInteractive">
        {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          window.gtag = gtag;
          gtag('js', new Date());
          // send_page_view:false — the RouteChangeTracker below fires the
          // initial pageview via the effect on mount, avoiding a double-count
          // on hard load and keeping SPA + hard-load behaviour identical.
          gtag('config', '${GA_ID}', { send_page_view: false });
        `}
      </Script>
      <Suspense fallback={null}>
        <RouteChangeTracker />
      </Suspense>
    </>
  );
}
