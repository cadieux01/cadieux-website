import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Jost } from "next/font/google";
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
    <html lang="en" className={`${cormorant.variable} ${jost.variable}`}>
      <head>
        {/* Preload hero video so navigating back to home plays instantly */}
        <link rel="preload" as="video" href="/bread-intro.mp4" type="video/mp4" />
        <link rel="preload" as="image" href="/hero.jpg" />
      </head>
      <body className="font-body">
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
