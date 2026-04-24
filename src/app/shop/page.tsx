"use client";

import Link from "next/link";
import ProductCard from "@/components/ProductCard";

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

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(28px,8vw,120px) 120px" }}>
        <h1 style={{ margin: "0 0 64px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
          Our Breads
        </h1>

        <div
          style={{
            overflowX: "auto",
            overflowY: "visible",
            overscrollBehaviorInline: "contain",
            scrollSnapType: "x mandatory",
            WebkitOverflowScrolling: "touch",
            marginLeft: "calc(-1 * clamp(28px, 8vw, 120px))",
            marginRight: "calc(-1 * clamp(28px, 8vw, 120px))",
            scrollbarWidth: "none",
          }}
          className="shop-scroll"
        >
          <div
            style={{
              display: "flex",
              gap: 24,
              padding: "12px calc(50vw - min(160px, 42.5vw))",
              width: "max-content",
              alignItems: "flex-start",
            }}
          >
            <ProductCard
              productIndex={0}
              name="Protein Bread Multigrain"
              tag="Protein Bread"
              title="Multigrain"
              subtitle="Ancient grains, seeds, whey protein. Baked to lock in structure."
              price={140}
              stats={[
                { target: 7, suffix: "g", label: "Protein/slice" },
                { target: 6, suffix: "g", label: "Fiber/slice" },
                { target: 14, label: "Ingredients" },
              ]}
            />
            <ProductCard
              productIndex={1}
              name="Protein Bread Plain"
              tag="Protein Bread"
              title="Plain"
              subtitle="Clean sandwich bread built for protein without the fuss. Soft slices, no compromise."
              price={110}
              stats={[
                { target: 7, suffix: "g", label: "Protein/slice" },
                { target: 10, label: "Slices" },
                { target: 400, suffix: "g", label: "Net Weight" },
              ]}
            />
          </div>
        </div>

        <div
          className="shop-swipe-hint"
          style={{
            margin: "40px 0 0",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            gap: 12,
            fontFamily: "var(--font-body)",
            fontSize: 10,
            fontWeight: 300,
            letterSpacing: "0.45em",
            textTransform: "uppercase",
            color: "rgba(201, 169, 110, 0.65)",
          }}
        >
          <span className="shop-swipe-arrow" style={{ fontSize: 14, color: "rgb(201, 169, 110)", display: "inline-block" }}>←</span>
          <span>Swipe to explore</span>
          <span className="shop-swipe-arrow shop-swipe-arrow-right" style={{ fontSize: 14, color: "rgb(201, 169, 110)", display: "inline-block" }}>→</span>
        </div>

        <style jsx>{`
          .shop-scroll::-webkit-scrollbar { display: none; }
          @keyframes shopSwipeLeft {
            0%, 100% { transform: translateX(0); opacity: 0.55; }
            50% { transform: translateX(-6px); opacity: 1; }
          }
          @keyframes shopSwipeRight {
            0%, 100% { transform: translateX(0); opacity: 0.55; }
            50% { transform: translateX(6px); opacity: 1; }
          }
          .shop-swipe-arrow { animation: shopSwipeLeft 1.8s ease-in-out infinite; }
          .shop-swipe-arrow-right { animation: shopSwipeRight 1.8s ease-in-out infinite; }
        `}</style>
      </div>
    </div>
  );
}
