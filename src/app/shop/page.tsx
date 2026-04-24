"use client";

import Link from "next/link";
import ProductTile from "@/components/ProductTile";
import { PRODUCTS, PRODUCT_DETAILS, type ProductSlug } from "@/lib/data";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function ShopPage() {
  return (
    <div style={{ minHeight: "100dvh", background: "#1D1D1F", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "72px clamp(18px,5vw,80px) 80px", maxWidth: 1200, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(34px,8vw,80px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
          Our Breads
        </h1>
        <p style={{
          margin: "0 0 28px",
          fontFamily: "var(--font-body)",
          fontSize: 12,
          fontWeight: 300,
          lineHeight: 1.55,
          color: "rgba(251, 243, 212, 0.55)",
          maxWidth: 520,
        }}>
          Two clean, high-protein loaves. Slow-fermented, lab-tested, and baked with nothing hidden. Pick a variant to see photos, ingredients, and reports.
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
            gap: 16,
            alignItems: "stretch",
          }}
        >
          {PRODUCTS.map((p) => (
            <ProductTile
              key={p.slug}
              slug={p.slug}
              tag={p.tag}
              title={p.title}
              subtitle={p.subtitle}
              price={p.price}
              stats={p.stats}
              media={PRODUCT_DETAILS[p.slug as ProductSlug].media[0]}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
