"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PRODUCTS } from "@/lib/data";

const GRAIN = "url(/grain.svg)";

export default function ReportsPage() {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: "multiply", pointerEvents: "none", zIndex: 0 }} />

      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#024628", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 16 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
          Reports
        </h1>
        <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(2,70,40,0.7)" }}>
          Independent test reports for each loaf
        </p>

        {PRODUCTS.map((p) => (
          <button
            key={p.slug}
            onClick={() => router.push(`/shop/${p.slug}/reports`)}
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
