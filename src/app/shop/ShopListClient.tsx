"use client";

// Client half of the shop catalogue. The parent server component
// hands in an availability map so we can:
//   - hide archived/inactive products (anything not in `listed`)
//   - badge out-of-stock items via ProductTile's outOfStock prop
//
// availability=null means the live fetch failed; we render every
// static product as if it's live and in-stock so the shop never
// goes blank.

import Link from "next/link";
import ProductTile from "@/components/ProductTile";
import ScrollReveal from "@/components/ScrollReveal";
import { PRODUCTS, PRODUCT_DETAILS, type ProductSlug } from "@/lib/data";
import type { AvailabilityMap } from "@/lib/products";

const GRAIN = "url(/grain.svg)";

export default function ShopListClient({
  availability,
  priceBySlug,
}: {
  availability: AvailabilityMap | null;
  // Live DB price per slug. Falls back to the bundled PRODUCTS price only
  // when a slug is missing (offline / fetch failure) so display + cart can
  // never silently disagree with the products table.
  priceBySlug?: Record<string, number>;
}) {
  const visibleProducts = availability
    ? PRODUCTS.filter((p) => availability.listed.has(p.slug))
    : PRODUCTS;

  return (
    <div style={{ minHeight: "100dvh", background: "#1D1D1F", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "72px clamp(18px,5vw,80px) 80px", maxWidth: 1200, margin: "0 auto" }}>
        <ScrollReveal>
          <h1 data-stagger style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(34px,8vw,80px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
            Our Breads
          </h1>
          <p data-stagger style={{
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
        </ScrollReveal>

        <ScrollReveal>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
              gap: 16,
              alignItems: "stretch",
            }}
          >
            {visibleProducts.map((p) => (
              <div data-stagger key={p.slug}>
                <ProductTile
                  slug={p.slug}
                  productIndex={PRODUCTS.findIndex((x) => x.slug === p.slug)}
                  name={p.name}
                  tag={p.tag}
                  title={p.title}
                  subtitle={p.subtitle}
                  price={priceBySlug?.[p.slug] ?? p.price}
                  stats={p.stats}
                  media={PRODUCT_DETAILS[p.slug as ProductSlug].media}
                  outOfStock={availability?.outOfStock.has(p.slug) ?? false}
                />
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </div>
  );
}
