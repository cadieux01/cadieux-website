import type { Metadata } from "next";
import Link from "next/link";
import ReviewSection from "@/components/ReviewSection";

export const metadata: Metadata = {
  title: "Cadieux Reviews — Customers on Protein Bread | Cadieux",
  description:
    "Read real reviews from Cadieux customers eating high protein bread in Visakhapatnam. Share your feedback and help shape the next loaf.",
  alternates: { canonical: "/feedback" },
};

const GRAIN = "url(/grain.svg)";

export default function FeedbackPage() {
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

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(24px,6vw,80px) 120px", maxWidth: 820, margin: "0 auto" }}>
        <h1 style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(48px,11vw,88px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
          Reviews
        </h1>
        <p style={{ margin: "0 0 36px", fontFamily: "var(--font-body)", fontSize: 14, fontWeight: 500, letterSpacing: "0.3em", textTransform: "uppercase", color: "rgba(2,70,40,0.7)" }}>
          What everyone is saying
        </p>

        <ReviewSection scope="all" />
      </div>
    </div>
  );
}
