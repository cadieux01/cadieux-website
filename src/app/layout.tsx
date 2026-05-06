import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
import "./globals.css";
import ClientLayoutChrome from "@/components/ClientLayoutChrome";
import NavGate from "@/components/NavGate";
import SiteMusic from "@/components/SiteMusic";
import EdgeSwipeNav from "@/components/EdgeSwipeNav";
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
      <body className="font-body" suppressHydrationWarning>
        <CartProvider>
          {/* SmoothScroll + CustomCursor are loaded only on fine-pointer
              devices via dynamic import, so phones/tablets skip the bundle. */}
          <ClientLayoutChrome />
          <NavGate />
          <SiteMusic />
          <EdgeSwipeNav />
          {children}
        </CartProvider>
      </body>
    </html>
  );
}
