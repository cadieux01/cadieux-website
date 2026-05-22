import Link from "next/link";
import ScrollReveal from "@/components/ScrollReveal";
import { PROCESS_STEPS } from "@/lib/data";

const GRAIN = "url(/grain.svg)";

export default function MakingPage() {
  return (
    <div style={{ minHeight: "100dvh", background: "rgb(6,4,2)", position: "relative", overflowX: "clip" }}>
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
        <ScrollReveal>
          <h1 data-stagger style={{ margin: "0 0 16px", fontFamily: "var(--font-heading)", fontSize: "clamp(52px,12vw,96px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.02em", lineHeight: 1 }}>
            Precision Baking
          </h1>
          <p data-stagger style={{ margin: "0 0 56px", fontFamily: "var(--font-body)", fontSize: 11, fontWeight: 200, letterSpacing: "0.25em", textTransform: "uppercase", color: "#4369B2", lineHeight: 2.2 }}>
            Six steps. No shortcuts.
          </p>
        </ScrollReveal>

        <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
          {PROCESS_STEPS.map((step, i) => (
            <ScrollReveal key={i}>
              <div style={{ borderTop: "1px solid rgba(240,223,200,0.08)", paddingTop: 32, paddingBottom: 40 }}>
                <div data-stagger style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 10, fontWeight: 200, letterSpacing: "0.3em", color: "rgba(251,243,212,0.3)" }}>{step.num}</span>
                  <span style={{ fontFamily: "var(--font-body)", fontSize: 9, fontWeight: 400, letterSpacing: "0.2em", textTransform: "uppercase", color: "rgba(30,30,30,0.85)", background: step.tagColor, padding: "3px 10px", borderRadius: 20 }}>{step.tag}</span>
                </div>
                <p data-stagger style={{ margin: "0 0 8px", fontFamily: "var(--font-heading)", fontSize: "clamp(22px,5vw,38px)", fontWeight: 300, color: "#FBF3D4", letterSpacing: "0.01em", lineHeight: 1.1 }}>{step.title}</p>
                <p data-stagger style={{ margin: "0 0 16px", fontFamily: "var(--font-body)", fontSize: 13, fontWeight: 300, letterSpacing: "0.05em", color: "#4369B2" }}>{step.highlight}</p>
                <p data-stagger style={{ margin: 0, fontFamily: "var(--font-body)", fontSize: 12, fontWeight: 200, lineHeight: 1.85, color: "rgba(251,243,212,0.45)", maxWidth: 520 }}>{step.desc}</p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </div>
  );
}
