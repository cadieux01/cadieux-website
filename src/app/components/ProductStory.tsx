"use client";

import SplitText from "@/components/SplitTextLazy";

export default function ProductStory() {
  return (
    <section style={{ minHeight: "100vh", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: "1.5rem", padding: "4rem 2rem" }}>
      <div style={{ fontFamily: "var(--font-heading)", fontSize: "clamp(2rem, 4vw, 3.5rem)", fontWeight: 300, color: "#fbf3d4" }}>
        <SplitText text="The Story Behind Every Loaf" repelStrength={70} repelRadius={130} staggerDelay={0.04} />
      </div>
      <p className="label-text">
        <SplitText text="PRODUCT STORY — PHASE 4" repelStrength={35} repelRadius={90} staggerDelay={0.03} />
      </p>
      <div style={{ maxWidth: "600px", textAlign: "center", fontFamily: "var(--font-body)", fontSize: "1rem", lineHeight: 1.7, color: "rgba(192,200,206,0.7)" }}>
        <SplitText text="Every Cadieux loaf is built from twelve carefully sourced ingredients. No shortcuts, no fillers — just real food engineered for strength and flavour." repelStrength={22} repelRadius={75} staggerDelay={0.025} wordMode={true} />
      </div>
    </section>
  );
}
