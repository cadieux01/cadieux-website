"use client";

import { useRouter } from "next/navigation";
import { PRODUCTS } from "@/lib/data";
import { toUrlSlug } from "@/lib/product-slugs";
import BackLink from "@/components/BackLink";

const GRAIN = "url(/grain.svg)";

// Internal slugs this index does NOT list. The burger bun has no lab work
// of its own — it borrows the protein bread's (REPORT_SOURCE_BY_SLUG in
// lib/product-reports), and listing it here would offer the same documents
// under a second heading.
const HIDDEN_FROM_REPORTS_INDEX = new Set(["burger-bun"]);

export default function ReportsPage() {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: "multiply", pointerEvents: "none", zIndex: 0 }} />

      <BackLink href="/">Cadieux</BackLink>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
          Reports
        </h1>
        <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(2,70,40,0.7)" }}>
          Independent test reports for each loaf
        </p>

        {PRODUCTS.filter((p) => !HIDDEN_FROM_REPORTS_INDEX.has(p.slug)).map((p) => (
          <button
            key={p.slug}
            // PRODUCTS[].slug is the INTERNAL slug; /shop/[slug] resolves a
            // URL slug. Pushing the internal one sent every product except
            // burger-bun (the only slug that maps to itself) to notFound().
            onClick={() => router.push(`/shop/${toUrlSlug(p.slug)}/reports`)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "18px 0",
              textAlign: "left", borderBottom: "1px solid rgba(2,70,40,0.2)",
              display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
              width: "100%",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 300, color: "#024628", letterSpacing: "0.03em" }}>{p.title}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(2,70,40,0.75)" }}>View →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
