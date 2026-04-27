"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { PRODUCTS } from "@/lib/data";

const GRAIN = "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='300'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

export default function ReportsPage() {
  const router = useRouter();
  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.055, pointerEvents: "none", zIndex: 0 }} />

      <Link href="/" style={{
        position: "fixed", top: 24, left: 20, zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#4369B2", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 720, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
          Reports
        </h1>
        <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(251,243,212,0.5)" }}>
          Independent test reports for each loaf
        </p>

        {PRODUCTS.map((p) => (
          <button
            key={p.slug}
            onClick={() => router.push(`/shop/${p.slug}/reports`)}
            style={{
              background: "none", border: "none", cursor: "pointer", padding: "18px 0",
              textAlign: "left", borderBottom: "1px solid rgba(240,223,200,0.06)",
              display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 12,
              width: "100%",
              WebkitTapHighlightColor: "transparent",
            }}
          >
            <span style={{ fontFamily: "var(--font-heading)", fontSize: 24, fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.03em" }}>{p.title}</span>
            <span style={{ fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.35em", textTransform: "uppercase", color: "rgba(200,144,58,0.65)" }}>View →</span>
          </button>
        ))}
      </div>
    </div>
  );
}
