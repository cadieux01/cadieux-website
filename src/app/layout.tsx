import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { DM_Sans } from "next/font/google";
import "./globals.css";
import ClientLayoutChrome from "@/components/ClientLayoutChrome";
import NavGate from "@/components/NavGate";
import SiteMusic from "@/components/SiteMusic";
import EdgeSwipeNav from "@/components/EdgeSwipeNav";
import PWAServiceWorker from "@/components/PWAServiceWorker";
import AndroidInstallPrompt from "@/components/AndroidInstallPrompt";
import IOSInstallHint from "@/components/IOSInstallHint";
import FloatingCartButton from "@/components/FloatingCartButton";
import { CartProvider } from "@/context/CartContext";

// Single source of the GA4 Measurement ID. Referenced only here.
const GA_ID = "G-HVBGHYD7M7";

// Unified on DM Sans for both headings and body (serif dropped). One family,
// multiple weights covers every call site — --font-heading and --font-body
// both resolve to DM Sans so existing var(--font-*) references keep working.
const dmSans = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-heading",
  display: "swap",
});

const dmSansBody = DM_Sans({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://www.cadieux.in"),
  title: "Cadieux | Premium Protein Bread, Visakhapatnam",
  description: "Premium protein bread baked fresh in Visakhapatnam. Lab-tested, nutrient-dense, delivered to your door. More Protein. Same Routine.",
  applicationName: "Cadieux",
  manifest: "/manifest.json",
  robots: "index, follow",
  openGraph: {
    type: "website",
    url: "https://www.cadieux.in",
    title: "Cadieux | Premium Protein Bread, Visakhapatnam",
    description: "Premium protein bread baked fresh in Visakhapatnam. Lab-tested, nutrient-dense, delivered to your door.",
    images: [
      {
        url: "https://www.cadieux.in/icons/icon-512.png",
        width: 512,
        height: 512,
        alt: "Cadieux logo",
      },
    ],
    siteName: "Cadieux",
  },
  twitter: {
    card: "summary_large_image",
    title: "Cadieux | Premium Protein Bread",
    description: "Baked fresh in Visakhapatnam. Lab-tested. More Protein. Same Routine.",
    images: ["https://www.cadieux.in/icons/icon-512.png"],
  },
  // Apple PWA: capable + black-translucent gives the immersive standalone
  // look that matches our walnut-green theme. Splash images are mapped to
  // every iPhone/iPad screen size we ship assets for; iOS picks the closest
  // match by media query at install time.
  appleWebApp: {
    capable: true,
    title: "Cadieux",
    statusBarStyle: "black-translucent",
    startupImage: [
      // iPhone SE (2nd/3rd gen), 6/7/8
      { url: "/splash/splash-750x1334.png", media: "(device-width: 375px) and (device-height: 667px) and (-webkit-device-pixel-ratio: 2)" },
      // iPhone XR, 11
      { url: "/splash/splash-828x1792.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 2)" },
      // iPhone X, XS, 11 Pro
      { url: "/splash/splash-1125x2436.png", media: "(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone 12, 12 Pro, 13, 13 Pro, 14
      { url: "/splash/splash-1170x2532.png", media: "(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone 15, 15 Pro, 14 Pro
      { url: "/splash/splash-1179x2556.png", media: "(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone XS Max, 11 Pro Max
      { url: "/splash/splash-1242x2688.png", media: "(device-width: 414px) and (device-height: 896px) and (-webkit-device-pixel-ratio: 3)" },
      // iPhone 14 Plus, 15 Plus, 15 Pro Max
      { url: "/splash/splash-1290x2796.png", media: "(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)" },
      // iPad mini, iPad 9.7"
      { url: "/splash/splash-1536x2048.png", media: "(device-width: 768px) and (device-height: 1024px) and (-webkit-device-pixel-ratio: 2)" },
      // iPad Pro 11"
      { url: "/splash/splash-1668x2388.png", media: "(device-width: 834px) and (device-height: 1194px) and (-webkit-device-pixel-ratio: 2)" },
      // iPad Pro 12.9"
      { url: "/splash/splash-2048x2732.png", media: "(device-width: 1024px) and (device-height: 1366px) and (-webkit-device-pixel-ratio: 2)" },
    ],
  },
  icons: {
    icon: [
      { url: "/icons/favicon-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/favicon-48.png", sizes: "48x48", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/icons/icon-76.png", sizes: "76x76" },
      { url: "/icons/icon-120.png", sizes: "120x120" },
      { url: "/icons/icon-152.png", sizes: "152x152" },
      { url: "/icons/icon-167.png", sizes: "167x167" },
      { url: "/icons/icon-180.png", sizes: "180x180" },
    ],
    shortcut: "/icons/favicon.ico",
  },
};

// Prevent iOS Safari from auto-zooming on input focus.
// themeColor matches manifest.json — used for the Android status bar tint
// and Safari pinned-tab tinting in standalone mode.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale / userScalable intentionally left at their defaults so
  // users can pinch-zoom (WCAG 1.4.4). Locking zoom fails accessibility.
  viewportFit: "cover",
  themeColor: "#C0C8CE",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Organization schema for homepage
  const organizationSchema = {
    "@context": "https://schema.org",
    "@type": "Organization",
    name: "Cadieux",
    url: "https://www.cadieux.in",
    logo: "https://www.cadieux.in/icons/icon-512.png",
    telephone: "+91 9989153747",
    sameAs: ["https://www.instagram.com/CadieuxIndia"],
    foundingLocation: {
      "@type": "City",
      name: "Visakhapatnam",
      addressCountry: "IN",
    },
    areaServed: "IN",
  };

  // LocalBusiness schema for Visakhapatnam-based operations
  const localBusinessSchema = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: "Cadieux",
    url: "https://www.cadieux.in",
    telephone: "+91 9989153747",
    address: {
      "@type": "PostalAddress",
      streetAddress: "Ward 4, Revenue, D.no.13/18, PLOT 78, PM Palem Main Rd",
      addressLocality: "Visakhapatnam",
      addressRegion: "Andhra Pradesh",
      postalCode: "530041",
      addressCountry: "IN",
    },
    image: "https://www.cadieux.in/icons/icon-512.png",
    priceRange: "₹119-₹150",
    areaServed: "IN",
  };

  return (
    <html lang="en" className={`${dmSans.variable} ${dmSansBody.variable}`} suppressHydrationWarning>
      <head>
        {/* JSON-LD structured data */}
        <Script id="organization-schema" type="application/ld+json">
          {JSON.stringify(organizationSchema)}
        </Script>
        <Script id="local-business-schema" type="application/ld+json">
          {JSON.stringify(localBusinessSchema)}
        </Script>
      </head>
      <body className="font-body" suppressHydrationWarning>
        <CartProvider>
          {/* SmoothScroll + CustomCursor are loaded only on fine-pointer
              devices via dynamic import, so phones/tablets skip the bundle. */}
          <ClientLayoutChrome />
          <NavGate />
          <SiteMusic />
          <EdgeSwipeNav />
          <PWAServiceWorker />
          <AndroidInstallPrompt />
          <IOSInstallHint />
          {children}
          <FloatingCartButton />
        </CartProvider>
        {/* GA4 loaded exactly once via next/script `lazyOnload`. Unlike
            @next/third-parties' <GoogleAnalytics> (which forces
            `afterInteractive` and emits a <link rel=preload> that the
            runtime-injected script never consumes → gtag.js downloaded
            TWICE), lazyOnload emits no preload and injects a single
            script during idle. Analytics is non-critical, so deferring it
            also frees the main thread during load. */}
        <Script
          id="ga-src"
          strategy="lazyOnload"
          src={`https://www.googletagmanager.com/gtag/js?id=${GA_ID}`}
        />
        <Script id="ga-init" strategy="lazyOnload">
          {`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');`}
        </Script>
      </body>
    </html>
  );
}
