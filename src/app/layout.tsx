import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import SmoothScroll from "@/components/SmoothScroll";
import CustomCursor from "@/components/CustomCursor";
import NavGate from "@/components/NavGate";
import SiteMusic from "@/components/SiteMusic";
import EdgeSwipeNav from "@/components/EdgeSwipeNav";
import { CartProvider } from "@/context/CartContext";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "600", "700"],
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
};

// Prevent iOS Safari from auto-zooming on input focus
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${cormorant.variable} ${jost.variable}`} suppressHydrationWarning>
      <head>
        {/* Preload only the loading-screen video — it gates first paint.
            Other section videos load on their own with preload="metadata"
            so we don't blow the network budget on first visit.
            hero.jpg is 3.2 MB and only used on /shop/[slug] — load it on
            demand there, not on every visit. */}
        <link rel="preload" as="video" href="/logo-intro.mp4" type="video/mp4" />
        {/* Cloudflare Turnstile loader — explicit-render mode. Loaded once
            globally so individual <TurnstileWidget /> mounts can render
            instantly instead of injecting + polling for the script each
            time. ?render=explicit prevents auto-rendering on .cf-turnstile
            divs we don't control. */}
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
          strategy="afterInteractive"
        />
      </head>
      <body className="font-body" suppressHydrationWarning>
        <CartProvider>
          <SmoothScroll />
          <CustomCursor />
          <NavGate />
          <SiteMusic />
          <EdgeSwipeNav />
          {children}
        </CartProvider>
      </body>
    </html>
  );
}
