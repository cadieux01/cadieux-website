import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import "./globals.css";
import ClientLayoutChrome from "@/components/ClientLayoutChrome";
import NavGate from "@/components/NavGate";
import SiteMusic from "@/components/SiteMusic";
import EdgeSwipeNav from "@/components/EdgeSwipeNav";
import PWAServiceWorker from "@/components/PWAServiceWorker";
import AndroidInstallPrompt from "@/components/AndroidInstallPrompt";
import IOSInstallHint from "@/components/IOSInstallHint";
import { CartProvider } from "@/context/CartContext";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  // Audit shows only 300/400/600 are actually used in styles. 700 was loaded
  // but never referenced — dropped to save one font file. fontWeight:500
  // sites (9) substitute to 400/600 just as before since 500 was never
  // loaded.
  weight: ["300", "400", "600"],
  variable: "--font-heading",
  display: "swap",
});

const jost = Jost({
  subsets: ["latin"],
  weight: ["300", "400", "500"],
  variable: "--font-body",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Cadieux",
  description: "Same Bread. Better Built.",
  applicationName: "Cadieux",
  manifest: "/manifest.json",
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
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: "#1a2e1a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${jost.variable}`} suppressHydrationWarning>
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
        </CartProvider>
      </body>
    </html>
  );
}
