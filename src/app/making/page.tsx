// Making — five-step process page. Reads process_steps via
// getPageContent (content-driven); falls back to PROCESS_STEPS in
// lib/data.ts when the DB read returns empty so the page never blanks.

import type { Metadata } from "next";
import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { PROCESS_STEPS } from "@/lib/data";
import { getPageContent } from "@/lib/content";

const GRAIN = "url(/grain.svg)";

export const metadata: Metadata = {
  title: "How Cadieux Protein Bread Is Made | Cadieux",
  description:
    "Behind Cadieux protein bread — grain, dough, bake, and lab verification. A five-step process for high protein bread made fresh in Visakhapatnam.",
  alternates: { canonical: "/making" },
};

export default async function MakingPage() {
  const content = await getPageContent({ page: "making" });
  const steps =
    content.process_steps.length > 0
      ? content.process_steps.map((s) => ({
          num: s.step_num,
          title: s.title,
          desc: s.body,
        }))
      : PROCESS_STEPS.map((s) => ({ num: s.num, title: s.title, desc: s.desc }));

  return (
    <div style={{ minHeight: "100dvh", background: "#C0C8CE", position: "relative", overflowX: "clip" }}>
      <div style={{ position: "fixed", inset: 0, backgroundImage: GRAIN, opacity: 0.04, mixBlendMode: "multiply", pointerEvents: "none", zIndex: 0 }} />

      {/* Back link */}
      <Link href="/" style={{
        position: "fixed", top: "calc(24px + env(safe-area-inset-top))", left: "calc(20px + env(safe-area-inset-left))", zIndex: 101,
        fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200,
        letterSpacing: "0.35em", textTransform: "uppercase",
        color: "#024628", textDecoration: "none",
        display: "flex", alignItems: "center", gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>←</span> Cadieux
      </Link>

      <div style={{ position: "relative", zIndex: 1, padding: "100px clamp(28px,8vw,120px) 120px" }}>
        <ScrollReveal>
          <h1 data-stagger style={{ margin: "0 0 16px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#024628", letterSpacing: "0.02em", lineHeight: 1 }}>
            Precision Baking
          </h1>
          <p data-stagger style={{ margin: "0 0 56px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "rgba(2,70,40,0.7)", lineHeight: 2.2 }}>
            Five steps. No shortcuts.
          </p>
        </ScrollReveal>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {steps.map((step, i) => (
            <ScrollReveal key={i}>
              <div style={{ borderTop: "1px solid rgba(2,70,40,0.2)", paddingTop: 32, paddingBottom: 40 }}>
                <span data-stagger style={{ display: "block", marginBottom: 16, fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(2,70,40,0.55)" }}>{step.num}</span>
                <p data-stagger style={{ margin: "0 0 12px", fontFamily: "var(--font-heading)", fontSize: "clamp(22px,5vw,38px)", fontWeight: 300, color: "#024628", letterSpacing: "0.01em", lineHeight: 1.1 }}>{step.title}</p>
                <p data-stagger style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 200, lineHeight: 1.85, color: "rgba(2,70,40,0.8)", maxWidth: 520 }}>{step.desc}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </div>
  );
}
